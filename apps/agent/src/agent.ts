// The agent loop. Each tick: settle any signed-but-unsettled transaction, index, read prices, then for every open
// loan decide liquidation (A5), protection (A1) and auto-repay (A2) from fresh chain reads, then price watch (A4)
// and notices (A6). In "watch" mode every decision is logged with its sentence and nothing is sent.
import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex, type PublicClient } from "viem";
import { CELO, TaggedSender, guardAbi, morphoWarsMarket, poolAbi, priceAbi } from "@adelanto/chain";
import {
  decideAutoRepay,
  decideLiquidation,
  decideProtect,
  dollars,
  pesos,
  percent,
  perSecondToBps,
  rateWatch,
  sayDecision,
  type Decision,
  type Limits,
  type LoanState,
} from "@adelanto/core";
import { chainToNumber, offChainQuotes, verdict, type Reading } from "@adelanto/price";
import { getMeta, json, setMeta, tx, type Db } from "./db.ts";
import { guardedBorrowers, indexOnce, openLoanIds, refreshLoan, sweepLoans, type Addresses } from "./indexer.ts";
import { loanNotices, poolNotices } from "./notices.ts";

export type Mode = "watch" | "live";

export type AgentDeps = {
  db: Db;
  pub: PublicClient;
  addresses: Addresses & { priceModule: Address };
  mode: Mode;
  keeper: TaggedSender; // the agent wallet: guard calls and liquidations
  guardian?: TaggedSender; // pause / unpause
  eth?: PublicClient; // Ethereum reads for the rate watch (A3); omitted = A3 off
  labels: Map<string, string>; // address -> OURS / JUDGE
  now?: () => number; // ms; injectable for tests
  log?: (s: string) => void;
};

type Job = "A1_protect" | "A2_autorepay" | "A3_rates" | "A4_price" | "A5_liquidate" | "approve";

export class Agent {
  private readonly now: () => number;
  private readonly log: (s: string) => void;
  private readonly d: AgentDeps;
  /** The block every decision in this tick is read at; set fresh (uncached) at the start of each tick. */
  private block = 0n;
  constructor(d: AgentDeps) {
    this.d = d;
    this.now = d.now ?? Date.now;
    this.log = d.log ?? ((s) => console.log(`${new Date(this.now()).toISOString()} ${s}`));
  }

  // ------------------------------------------------------------------ recording and sending

  private record(job: Job, loanId: bigint | null, borrower: string | null, trigger: unknown, inputs: unknown, decision: Decision | { kind: string }, status: string, said?: { es: string; en: string }, txHash?: string, error?: string): number {
    const r = this.d.db
      .prepare(
        `INSERT INTO agent_actions (job, loan_id, borrower, trigger_json, inputs_json, decision, mode, status, tx, sentence_es, sentence_en, error, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(job, loanId === null ? null : Number(loanId), borrower, json(trigger), json(inputs), json(decision), this.d.mode, status, txHash ?? null, said?.es ?? null, said?.en ?? null, error ?? null, this.now());
    return Number(r.lastInsertRowid);
  }

  /** Same decision for the same loan inside the last hour is not logged again (watch mode would repeat every tick). */
  private seenRecently(key: string, signature: string): boolean {
    const prev = getMeta(this.d.db, `last:${key}`);
    if (prev) {
      const [sig, at] = prev.split("@");
      if (sig === signature && this.now() - Number(at) < 3_600_000) return true;
    }
    setMeta(this.d.db, `last:${key}`, `${signature}@${this.now()}`);
    return false;
  }

  private unsettled(from: Address): number {
    const r = this.d.db.prepare("SELECT COUNT(*) AS n FROM pending_tx WHERE from_addr = ? AND status = 'signed'").get(from) as any;
    return Number(r.n);
  }

  /** Sends one call through a tagged sender, recording the signed bytes before they leave this machine. */
  private async send(sender: TaggedSender, actionId: number, to: Address, data: Hex): Promise<{ hash: Hex; block: bigint }> {
    if (this.unsettled(sender.address) > 0) throw new Error("an earlier transaction from this wallet is not settled yet");
    const res = await sender.send(to, data, (s) => {
      tx(this.d.db, () => {
        this.d.db
          .prepare("INSERT INTO pending_tx (hash, action_id, from_addr, nonce, to_addr, data, raw, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?)")
          .run(s.hash, actionId, s.from, s.nonce, s.to, s.data, s.raw, this.now());
        this.d.db.prepare("UPDATE agent_actions SET status = 'signed', tx = ? WHERE id = ?").run(s.hash, actionId);
      });
    });
    tx(this.d.db, () => {
      this.d.db.prepare("UPDATE pending_tx SET status = 'landed', settled_at = ? WHERE hash = ?").run(this.now(), res.hash);
      this.d.db.prepare("UPDATE agent_actions SET status = 'landed' WHERE id = ?").run(actionId);
    });
    return { hash: res.hash, block: res.receipt.blockNumber };
  }

  /** After a restart: every signed transaction is re-broadcast (same bytes, same nonce) and settled. */
  async resumePending() {
    const rows = this.d.db.prepare("SELECT * FROM pending_tx WHERE status = 'signed' ORDER BY created_at").all() as any[];
    for (const r of rows) {
      const sender = getAddress(r.from_addr) === this.d.keeper.address ? this.d.keeper : this.d.guardian;
      if (!sender) continue;
      try {
        await sender.broadcast({ hash: r.hash, raw: r.raw, nonce: r.nonce, to: r.to_addr, data: r.data, from: r.from_addr });
        this.d.db.prepare("UPDATE pending_tx SET status = 'landed', settled_at = ? WHERE hash = ?").run(this.now(), r.hash);
        this.d.db.prepare("UPDATE agent_actions SET status = 'landed' WHERE id = ?").run(r.action_id);
        this.log(`resumed ${r.hash}: landed`);
      } catch (e: any) {
        const msg = String(e?.shortMessage ?? e?.message ?? e);
        if (/reverted on chain/.test(msg)) {
          this.d.db.prepare("UPDATE pending_tx SET status = 'reverted', settled_at = ? WHERE hash = ?").run(this.now(), r.hash);
          this.d.db.prepare("UPDATE agent_actions SET status = 'failed', error = ? WHERE id = ?").run(msg, r.action_id);
        }
        this.log(`resume ${r.hash}: ${msg.slice(0, 160)}`); // anything else stays 'signed' and is retried next tick
      }
    }
  }

  // ------------------------------------------------------------------ reads

  private async priceState() {
    const { pub, addresses: a } = this.d;
    const [[ok, reason], liq] = await Promise.all([
      pub.readContract({ address: a.priceModule, abi: priceAbi, functionName: "status", blockNumber: this.block }),
      pub.readContract({ address: a.priceModule, abi: priceAbi, functionName: "liquidationPrice", blockNumber: this.block }),
    ]);
    return { ok, reason, liq };
  }

  private async loanState(id: bigint): Promise<LoanState> {
    const { pub, addresses: a } = this.d;
    const [l, debt] = await Promise.all([
      pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loans", args: [id], blockNumber: this.block }),
      pub.readContract({ address: a.pool, abi: poolAbi, functionName: "debtOf", args: [id], blockNumber: this.block }),
    ]);
    return { id, borrower: getAddress(l.borrower), open: l.open, collateral: l.collateral, debt, dueAt: l.dueAt };
  }

  private async guardState(borrower: Address) {
    const { pub, addresses: a } = this.d;
    const [lim, usage, usdtBal, warsBal, usdtAllow, warsAllow] = await Promise.all([
      pub.readContract({ address: a.guard, abi: guardAbi, functionName: "limitsOf", args: [borrower] , blockNumber: this.block }),
      pub.readContract({ address: a.guard, abi: guardAbi, functionName: "usageOf", args: [borrower] , blockNumber: this.block }),
      pub.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "balanceOf", args: [borrower] , blockNumber: this.block }),
      pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "balanceOf", args: [borrower] , blockNumber: this.block }),
      pub.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "allowance", args: [borrower, a.guard] , blockNumber: this.block }),
      pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "allowance", args: [borrower, a.guard] , blockNumber: this.block }),
    ]);
    const limits: Limits = {
      autoRepay: lim.autoRepay,
      rateWatch: lim.rateWatch,
      protectOrder: lim.protectOrder,
      expiry: lim.expiry,
      keepWarsBuffer: lim.keepWarsBuffer,
      maxRepayWarsPerDay: lim.maxRepayWarsPerDay,
      maxTopUpUsdtPerDay: lim.maxTopUpUsdtPerDay,
      maxRateBps: lim.maxRateBps,
    };
    const wallet = { usdt: usdtBal, wars: warsBal, usdtAllowanceToGuard: usdtAllow, warsAllowanceToGuard: warsAllow };
    return { limits, usage: { repaidWars: usage.repaidWars, toppedUpUsdt: usage.toppedUpUsdt }, wallet };
  }

  private ruleText(borrower: Address): string | undefined {
    const r = this.d.db.prepare("SELECT rule_text FROM guard_limits WHERE borrower = ?").get(borrower) as any;
    return r?.rule_text ?? undefined;
  }

  private chainNow = async () => (await this.d.pub.getBlock({ blockNumber: this.block })).timestamp;

  // ------------------------------------------------------------------ jobs

  /** Logs and, in live mode, sends. Returns what happened so callers only consume inputs once an action is done. */
  private async act(job: Job, loan: LoanState, d: Decision, price: bigint, inputs: unknown, call?: { to: Address; data: Hex }): Promise<"quiet" | "refused" | "watch" | "landed" | "failed"> {
    const said = sayDecision(d, price, this.ruleText(loan.borrower));
    const amount = "usdt" in d ? d.usdt : "wars" in d ? d.wars : 0n;
    const signature = d.kind === "none" ? `${d.kind}:${d.reason}` : `${d.kind}:${amount}`;
    if (d.kind === "none") {
      if (!said.es) return "quiet";
      if (this.seenRecently(`${job}:${loan.id}`, signature)) return "refused";
      this.record(job, loan.id, loan.borrower, { ltvPrice: price }, inputs, d, "refused", said);
      this.notice(`${loan.id}:${d.reason}:${this.day()}`, loan, d.reason, said);
      return "refused";
    }
    if (this.d.mode === "watch") {
      if (this.seenRecently(`${job}:${loan.id}`, signature)) return "watch";
      this.record(job, loan.id, loan.borrower, { ltvPrice: price }, inputs, d, "watch_only", said);
      this.log(`[watch] ${job} loan ${loan.id}: ${said.en}`);
      return "watch";
    }
    const id = this.record(job, loan.id, loan.borrower, { ltvPrice: price }, inputs, d, "decided", said);
    try {
      const { hash, block } = await this.send(this.d.keeper, id, call!.to, call!.data);
      setMeta(this.d.db, `actedBlock:${loan.id}`, block.toString());
      this.notice(`${loan.id}:${job}:${hash}`, loan, job, said);
      this.log(`${job} loan ${loan.id}: ${hash} ${said.en}`);
      return "landed";
    } catch (e: any) {
      const msg = String(e?.shortMessage ?? e?.message ?? e).slice(0, 500);
      this.d.db.prepare("UPDATE agent_actions SET status = CASE WHEN status = 'signed' THEN status ELSE 'failed' END, error = ? WHERE id = ?").run(msg, id);
      this.log(`${job} loan ${loan.id} failed: ${msg}`);
      return "failed";
    }
  }

  private day() {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private notice(key: string, loan: LoanState | null, kind: string, said: { es: string; en: string }) {
    this.d.db
      .prepare("INSERT OR IGNORE INTO notices (key, borrower, loan_id, kind, text_es, text_en, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(key, loan?.borrower ?? null, loan ? Number(loan.id) : null, kind, said.es, said.en, this.now());
  }

  /** A5 for one loan. Returns true when the loan was (or would be) liquidated, so protection is skipped this tick. */
  private async liquidateIfNeeded(loan: LoanState, price: bigint): Promise<boolean> {
    const { pub, addresses: a, keeper } = this.d;
    const keeperWars = await pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "balanceOf", args: [keeper.address], blockNumber: this.block });
    const d = decideLiquidation(loan, price, keeperWars, keeperWars); // allowance is topped up just below
    if (d.kind === "none" && d.reason === "NOT_LIQUIDATABLE") return false;
    if (d.kind === "liquidate" && this.d.mode === "live") {
      const allowance = await pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "allowance", args: [keeper.address, a.pool] });
      if (allowance < d.wars) {
        const id = this.record("approve", loan.id, keeper.address, { for: "liquidation" }, { allowance }, { kind: "approve" }, "decided");
        await this.send(keeper, id, CELO.wars, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [a.pool, d.wars] }));
      }
    }
    const call = d.kind === "liquidate" ? { to: a.pool, data: encodeFunctionData({ abi: poolAbi, functionName: "liquidate", args: [loan.id, d.wars] }) } : undefined;
    await this.act("A5_liquidate", loan, d, price, { keeperWars, debt: loan.debt, collateral: loan.collateral }, call);
    return true;
  }

  private async protectAndRepay(loan: LoanState, price: bigint, priceOk: boolean, chainNow: bigint) {
    const { addresses: a } = this.d;
    const g = await this.guardState(loan.borrower);
    if (g.limits.expiry === 0n) return; // no guard: nothing for the agent to do with this loan
    const inputs = { limits: g.limits, usage: g.usage, wallet: g.wallet, debt: loan.debt, collateral: loan.collateral };

    const p = decideProtect(loan, g.limits, g.usage, g.wallet, price, priceOk, chainNow);
    if (p.kind !== "none" || p.reason !== "NOT_AT_RISK") {
      const call =
        p.kind === "topUp"
          ? { to: a.guard, data: encodeFunctionData({ abi: guardAbi, functionName: "protectWithTopUp", args: [loan.id, p.usdt] }) }
          : p.kind === "protectRepay"
            ? { to: a.guard, data: encodeFunctionData({ abi: guardAbi, functionName: "protectWithRepay", args: [loan.id, p.wars] }) }
            : undefined;
      await this.act("A1_protect", loan, p, price, inputs, call);
      if (p.kind !== "none") return; // one action per loan per tick; the next tick sees the new state
    }

    // A2: pesos that arrived since the guard was set and are not handled yet
    // Only pesos that arrived after this loan was opened count; earlier ones are marked handled and ignored.
    const opened = this.d.db
      .prepare("SELECT block FROM events WHERE name = 'Borrowed' AND json_extract(args, '$.loanId') = ? ORDER BY block LIMIT 1")
      .get(loan.id.toString()) as any;
    if (!opened) return; // the indexer has not seen this loan's opening yet
    this.d.db.prepare("UPDATE arrivals SET handled = 1 WHERE borrower = ? AND handled = 0 AND block <= ?").run(loan.borrower, opened.block);
    const rows = this.d.db.prepare("SELECT tx, log_index, amount FROM arrivals WHERE borrower = ? AND handled = 0").all(loan.borrower) as any[];
    if (rows.length === 0) return;
    const arrived = rows.reduce((s, r) => s + BigInt(r.amount), 0n);
    const r = decideAutoRepay(loan, g.limits, g.usage, g.wallet, arrived, priceOk, chainNow);
    const call = r.kind === "autoRepay" ? { to: a.guard, data: encodeFunctionData({ abi: guardAbi, functionName: "autoRepay", args: [loan.id, r.wars] }) } : undefined;
    const outcome = await this.act("A2_autorepay", loan, r, price, { ...inputs, arrivals: rows }, call);
    // An arrival is handled once: repaid (or would be, in watch mode), or refused for a reason the borrower is told.
    // A failed send or a refused price keeps it for the next tick.
    const keep = outcome === "failed" || (r.kind === "none" && r.reason === "PRICE_REFUSED");
    if (!keep) {
      const mark = this.d.db.prepare("UPDATE arrivals SET handled = 1 WHERE chain = 'celo' AND tx = ? AND log_index = ?");
      for (const row of rows) mark.run(row.tx, row.log_index);
    }
  }

  /** A4: pause new borrowing when the chain price disagrees with every outside source; resume only our own pause. */
  private async watchPrice() {
    const { pub, addresses: a, db } = this.d;
    const [spot, twap] = await Promise.all([
      pub.readContract({ address: a.priceModule, abi: priceAbi, functionName: "spot" }),
      pub.readContract({ address: a.priceModule, abi: priceAbi, functionName: "liquidationPrice" }),
    ]);
    const { quotes, failed } = await offChainQuotes();
    const at = this.now();
    const ins = db.prepare("INSERT INTO prices (source, value, observed_at, raw) VALUES (?, ?, ?, ?)");
    ins.run("uniswap_spot", chainToNumber(spot), at, null);
    ins.run("uniswap_twap30", chainToNumber(twap), at, null);
    for (const q of quotes) ins.run(q.source, q.pesosPerDollar, at, json(q.raw));
    for (const f of failed) this.log(`price source down: ${f.source}: ${f.error}`);

    const readings = this.readings(at);
    const paused = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "paused" });
    const pausedByUs = getMeta(db, "pausedByUs") === "1" && paused;
    const v = verdict(readings, at, pausedByUs, paused);
    if (v.action === "hold") return;
    const signature = `${v.action}`;
    if (this.d.mode === "watch" || !this.d.guardian) {
      if (!this.seenRecently("A4", signature)) {
        this.record("A4_price", null, null, { readings: readings.slice(-3) }, {}, { kind: v.action }, "watch_only", { es: "", en: v.why });
        this.log(`[watch] A4 would ${v.action}: ${v.why}`);
      }
      return;
    }
    const id = this.record("A4_price", null, null, { readings: readings.slice(-3) }, {}, { kind: v.action }, "decided", { es: "", en: v.why });
    try {
      await this.send(this.d.guardian, id, a.pool, encodeFunctionData({ abi: poolAbi, functionName: v.action === "pause" ? "pause" : "unpause" }));
      setMeta(db, "pausedByUs", v.action === "pause" ? "1" : "0");
      this.log(`A4 ${v.action}: ${v.why}`);
    } catch (e: any) {
      this.d.db.prepare("UPDATE agent_actions SET status = 'failed', error = ? WHERE id = ?").run(String(e?.shortMessage ?? e).slice(0, 500), id);
    }
  }

  /** The last 15 minutes of readings: the chain's 30-minute price against each outside source. */
  private readings(now: number): Reading[] {
    const rows = this.d.db.prepare("SELECT source, value, observed_at, raw FROM prices WHERE observed_at >= ? ORDER BY observed_at").all(now - 15 * 60_000) as any[];
    const byAt = new Map<number, Reading>();
    for (const r of rows) {
      const at = Number(r.observed_at);
      const rd = byAt.get(at) ?? { at, chain: 0, quotes: [] };
      if (r.source === "uniswap_twap30") rd.chain = r.value;
      else if (r.source === "binance" || r.source === "dolarapi") rd.quotes.push({ source: r.source, pesosPerDollar: r.value, fetchedAt: at, raw: null });
      byAt.set(at, rd);
    }
    return [...byAt.values()].filter((r) => r.chain > 0);
  }

  /** A3: every 30 minutes, tell borrowers who asked when Morpho would save them more than twice the moving cost. */
  private async watchRates(chainNow: bigint, price: bigint) {
    const { db, pub, addresses: a, eth } = this.d;
    if (!eth) return;
    const last = Number(getMeta(db, "rateWatchAt") ?? 0);
    if (this.now() - last < 30 * 60_000) return;
    setMeta(db, "rateWatchAt", String(this.now()));
    const m = await morphoWarsMarket(eth);
    const otherBps = perSecondToBps(m.ratePerSecond);
    for (const id of openLoanIds(db)) {
      const loan = await this.loanState(id);
      if (!loan.open) continue;
      const lim = await pub.readContract({ address: a.guard, abi: guardAbi, functionName: "limitsOf", args: [loan.borrower] });
      if (!lim.rateWatch || lim.expiry < chainNow) continue;
      const l = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loans", args: [id] });
      const poolBps = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "borrowRateBps", args: [l.tier] });
      const w = rateWatch(loan.debt, poolBps, otherBps, loan.dueAt - chainNow, price);
      if (!w.worthIt || loan.debt > m.freeWars) continue;
      this.notice(`${id}:ratewatch:${this.day()}`, loan, "rate_watch", {
        es: `En Morpho (Ethereum) la tasa está en ${percent(otherBps)} contra ${percent(poolBps)} acá. Para tu préstamo de ${pesos(loan.debt)} serían ${pesos(w.save)} menos hasta el vencimiento; mudarse cuesta unos ${dollars(3_500_000n)}. Tu próximo préstamo o renovación puede ir por ahí.`,
        en: `On Morpho (Ethereum) the rate is ${percent(otherBps, "en")} against ${percent(poolBps, "en")} here. For your ${pesos(loan.debt, "en")} loan that is ${pesos(w.save, "en")} less until it is due; moving costs about ${dollars(3_500_000n, "en")}. Your next loan or renewal can go there.`,
      });
      this.record("A3_rates", id, loan.borrower, { otherBps, poolBps }, { debt: loan.debt, save: w.save, moveCost: w.moveCost }, { kind: "notice" }, "noticed");
    }
  }

  // ------------------------------------------------------------------ tick

  async tick() {
    const { db, pub, addresses: a, labels } = this.d;
    await this.resumePending();
    await indexOnce(db, pub, a, labels);
    await sweepLoans(db, pub, a, labels);
    this.block = await pub.getBlockNumber({ cacheTime: 0 });
    const price = await this.priceState();
    const chainNow = await this.chainNow();
    for (const id of openLoanIds(db)) {
      await refreshLoan(db, pub, a, id, labels);
      // Never decide on a loan from a view older than the agent's own last action on it.
      const acted = BigInt(getMeta(db, `actedBlock:${id}`) ?? "0");
      if (acted >= this.block) continue;
      const loan = await this.loanState(id);
      if (!loan.open) continue;
      try {
        if (await this.liquidateIfNeeded(loan, price.liq)) continue;
        await this.protectAndRepay(loan, price.liq, price.ok, chainNow);
        for (const n of loanNotices(loan, price.liq, chainNow, db)) this.notice(n.key, loan, n.kind, n.said);
      } catch (e: any) {
        this.log(`loan ${id}: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 300)}`);
      }
    }
    try {
      await this.watchRates(chainNow, price.liq);
    } catch (e: any) {
      this.log(`rate watch: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 300)}`);
    }
    try {
      await this.watchPrice();
    } catch (e: any) {
      this.log(`price watch: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 300)}`);
    }
    for (const n of await poolNotices(pub, a, db)) this.notice(n.key, null, n.kind, n.said);
    setMeta(db, "lastTick", String(this.now()));
  }
}

export { guardedBorrowers };
