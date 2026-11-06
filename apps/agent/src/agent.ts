// The agent loop. Each tick, every job isolated from the others:
//   settle signed transactions -> index (safe head) -> for each open loan, from reads pinned to one fresh block:
//   A5 gentle liquidation (through GentleKeeper), else A1 protect, else A2 auto-repay from the chain-derived credit
//   -> A3 rate watch -> A4 price watch -> A6 notices.
// In "watch" mode every decision is logged with its sentence and nothing is ever broadcast, not even a transaction
// signed by an earlier live run.
import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex, type PublicClient } from "viem";
import { CELO, NonceConsumedError, TaggedSender, erc20TransferEvent, gentleKeeperAbi as keeperAbi, guardAbi, morphoWarsMarket, poolAbi, priceAbi, type Signed } from "@adelanto/chain";
import {
  decideAutoRepay,
  decideLiquidation,
  decideProtect,
  dollars,
  isLiquidatable,
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
import { indexOnce, openLoanIds, refreshLoan, sweepLoans, type Addresses } from "./indexer.ts";
import { credit, type LedgerItem } from "./ledger.ts";
import { loanNotices, poolNotices } from "./notices.ts";

export type Mode = "watch" | "live";

export type AgentDeps = {
  db: Db;
  pub: PublicClient;
  addresses: Addresses & { priceModule: Address; gentleKeeper?: Address };
  mode: Mode;
  keeper: TaggedSender; // the agent wallet: guard calls and liquidations
  guardian?: TaggedSender; // pause / unpause
  eth?: PublicClient; // Ethereum reads for the rate watch (A3); omitted = A3 off
  labels: Map<string, string>; // address -> OURS / JUDGE
  now?: () => number; // ms; injectable for tests
  log?: (s: string) => void;
};

type Job = "A1_protect" | "A2_autorepay" | "A3_rates" | "A4_price" | "A5_liquidate" | "approve";
type Outcome = "quiet" | "refused" | "watch" | "landed" | "failed";


export class Agent {
  private readonly now: () => number;
  private readonly log: (s: string) => void;
  private readonly d: AgentDeps;
  /** The block every decision in this tick is read at; set fresh (uncached) each tick. */
  private block = 0n;
  /** The block the indexer has reached (safe head). */
  private indexed = 0n;

  constructor(d: AgentDeps) {
    this.d = d;
    this.now = d.now ?? Date.now;
    this.log = d.log ?? ((s) => console.log(`${new Date(this.now()).toISOString()} ${s}`));
  }

  // ------------------------------------------------------------------ recording

  private record(job: Job, loanId: bigint | null, borrower: string | null, trigger: unknown, inputs: unknown, decision: unknown, status: string, said?: { es: string; en: string }, txHash?: string, error?: string): number {
    const r = this.d.db
      .prepare(
        `INSERT INTO agent_actions (job, loan_id, borrower, trigger_json, inputs_json, decision, mode, status, tx, sentence_es, sentence_en, error, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(job, loanId === null ? null : Number(loanId), borrower, json(trigger), json(inputs), json(decision), this.d.mode, status, txHash ?? null, said?.es ?? null, said?.en ?? null, error ?? null, this.now());
    return Number(r.lastInsertRowid);
  }

  /** The same decision for the same loan inside the last hour is not logged again (watch mode repeats every tick). */
  private seenRecently(key: string, signature: string): boolean {
    const prev = getMeta(this.d.db, `last:${key}`);
    if (prev) {
      const [sig, at] = prev.split("@");
      if (sig === signature && this.now() - Number(at) < 3_600_000) return true;
    }
    setMeta(this.d.db, `last:${key}`, `${signature}@${this.now()}`);
    return false;
  }

  private notice(key: string, loan: LoanState | null, kind: string, said: { es: string; en: string }) {
    this.d.db
      .prepare("INSERT OR IGNORE INTO notices (key, borrower, loan_id, kind, text_es, text_en, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(key, loan?.borrower ?? null, loan ? Number(loan.id) : null, kind, said.es, said.en, this.now());
  }

  private day() {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  /** Remembers the block an action landed in, per loan and per borrower, so nothing decides from an older view. */
  private markActed(loanId: bigint | null, borrower: string | null, block: bigint) {
    if (loanId !== null) setMeta(this.d.db, `actedBlock:${loanId}`, block.toString());
    if (borrower) setMeta(this.d.db, `actedBorrower:${getAddress(borrower)}`, block.toString());
  }

  // ------------------------------------------------------------------ sending

  private unsettled(from: Address): number {
    const r = this.d.db.prepare("SELECT COUNT(*) AS n FROM pending_tx WHERE from_addr = ? AND status = 'signed'").get(from) as any;
    return Number(r.n);
  }

  /** Sends one call, recording the signed bytes before they leave this machine. Live mode only. */
  private async send(sender: TaggedSender, actionId: number, to: Address, data: Hex): Promise<{ hash: Hex; block: bigint }> {
    if (this.d.mode !== "live") throw new Error("send called outside live mode");
    if (this.unsettled(sender.address) > 0) throw new Error("an earlier transaction from this wallet is not settled yet");
    const res = await sender.send(to, data, (s) => {
      tx(this.d.db, () => {
        this.d.db
          .prepare("INSERT INTO pending_tx (hash, action_id, from_addr, nonce, to_addr, data, raw, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?)")
          .run(s.hash, actionId, s.from, s.nonce, s.to, s.data, s.raw, this.now());
        this.d.db.prepare("UPDATE agent_actions SET status = 'signed', tx = ? WHERE id = ?").run(s.hash, actionId);
      });
    });
    this.settle(res.hash, actionId, "landed", res.receipt.blockNumber);
    return { hash: res.hash, block: res.receipt.blockNumber };
  }

  private settle(hash: Hex, actionId: number, status: "landed" | "reverted" | "replaced", block?: bigint, error?: string) {
    const action = this.d.db.prepare("SELECT loan_id, borrower FROM agent_actions WHERE id = ?").get(actionId) as any;
    tx(this.d.db, () => {
      this.d.db.prepare("UPDATE pending_tx SET status = ?, settled_at = ? WHERE hash = ?").run(status, this.now(), hash);
      // An action that landed is never downgraded by a later record of a sibling transaction at the same nonce.
      this.d.db.prepare("UPDATE agent_actions SET status = ?, error = COALESCE(?, error) WHERE id = ? AND status <> 'landed'").run(status === "landed" ? "landed" : "failed", error ?? null, actionId);
      if (status === "landed" && block !== undefined) {
        const loanId = action?.loan_id === null || action?.loan_id === undefined ? null : BigInt(action.loan_id);
        this.markActed(loanId, action?.borrower ?? null, block);
      }
    });
  }

  /**
   * Signed transactions from an earlier tick or run. Watch mode never broadcasts: it only looks for receipts. Live
   * mode re-broadcasts the same bytes (same nonce, so they land at most once) for up to STUCK_AFTER; after that it
   * never sends the old decision again: it replaces the nonce with an empty self-transfer at a higher fee, and the
   * next tick decides again from fresh state.
   */
  async settlePending() {
    const STUCK_AFTER = 10 * 60_000;
    const rows = this.d.db.prepare("SELECT * FROM pending_tx WHERE status IN ('signed', 'replacing') ORDER BY created_at").all() as any[];
    for (const r of rows) {
      const signed: Signed = { hash: r.hash, raw: r.raw, nonce: r.nonce, to: r.to_addr, data: r.data, from: r.from_addr };
      const receipt = await this.d.pub.getTransactionReceipt({ hash: r.hash }).catch(() => null);
      if (receipt) {
        this.settle(r.hash, r.action_id, receipt.status === "success" ? "landed" : "reverted", receipt.blockNumber);
        continue;
      }
      if (this.d.mode !== "live") {
        if (!this.seenRecently(`pending:${r.hash}`, "unsent")) this.log(`[watch] signed ${r.hash} from an earlier live run is not on chain; watch mode will not send it`);
        continue;
      }
      const sender = getAddress(r.from_addr) === this.d.keeper.address ? this.d.keeper : this.d.guardian && getAddress(r.from_addr) === this.d.guardian.address ? this.d.guardian : undefined;
      if (!sender) {
        if (!this.seenRecently(`pending:${r.hash}`, "no-key")) this.log(`signed ${r.hash} is from ${r.from_addr}, whose key is not loaded; left as it is`);
        continue;
      }
      if (r.status === "replacing") continue; // its replacement is the 'signed' row with the same nonce
      try {
        if (this.now() - Number(r.created_at) > STUCK_AFTER) {
          const cancel = await sender.prepareCancel(signed);
          tx(this.d.db, () => {
            this.d.db.prepare("UPDATE pending_tx SET status = 'replacing' WHERE hash = ?").run(r.hash);
            this.d.db
              .prepare("INSERT INTO pending_tx (hash, action_id, from_addr, nonce, to_addr, data, raw, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?)")
              .run(cancel.hash, r.action_id, cancel.from, cancel.nonce, cancel.to, cancel.data, cancel.raw, this.now());
          });
          this.log(`${r.hash} stuck over 10 minutes: replacing nonce ${r.nonce} with ${cancel.hash}`);
          const res = await sender.broadcast(cancel, 20_000);
          this.d.db.prepare("UPDATE pending_tx SET status = 'landed', settled_at = ? WHERE hash = ?").run(this.now(), cancel.hash);
          this.settle(r.hash, r.action_id, "replaced", undefined, "replaced after 10 minutes stuck");
          this.markActed(null, null, res.receipt.blockNumber);
          continue;
        }
        const res = await sender.broadcast(signed, 20_000);
        this.settle(r.hash, r.action_id, "landed", res.receipt.blockNumber);
        this.log(`resumed ${r.hash}: landed`);
      } catch (e: any) {
        const msg = String(e?.shortMessage ?? e?.message ?? e).slice(0, 300);
        if (e instanceof NonceConsumedError) {
          // Another transaction used the nonce. If it was the replacement, the old intent can never land now.
          const other = this.d.db.prepare("SELECT hash, to_addr, data FROM pending_tx WHERE from_addr = ? AND nonce = ? AND hash <> ?").all(r.from_addr, r.nonce, r.hash) as any[];
          for (const o of other) {
            const rc = await this.d.pub.getTransactionReceipt({ hash: o.hash }).catch(() => null);
            if (!rc) continue;
            // The sibling that used the nonce is the one that landed: record it at its block (a landed original keeps the action landed).
            const isCancel = getAddress(o.to_addr) === getAddress(r.from_addr); // cancels are tagged self-transfers
            if (rc.status === "success" && !isCancel) this.settle(o.hash, r.action_id, "landed", rc.blockNumber);
            else this.d.db.prepare("UPDATE pending_tx SET status = ?, settled_at = ? WHERE hash = ?").run(rc.status === "success" ? "landed" : "reverted", this.now(), o.hash);
          }
          this.d.db.prepare("UPDATE pending_tx SET status = 'replaced', settled_at = ? WHERE hash = ? AND status <> 'landed'").run(this.now(), r.hash);
          this.d.db.prepare("UPDATE agent_actions SET status = 'failed', error = COALESCE(?, error) WHERE id = ? AND status <> 'landed'").run(msg, r.action_id);
          // A2 must not decide again until the index has seen whatever used that nonce.
          const action = this.d.db.prepare("SELECT borrower FROM agent_actions WHERE id = ?").get(r.action_id) as any;
          if (action?.borrower) this.markActed(null, action.borrower, this.block > 0n ? this.block : await this.d.pub.getBlockNumber({ cacheTime: 0 }));
        } else if (/reverted on chain/.test(msg)) this.settle(r.hash, r.action_id, "reverted", undefined, msg);
        this.log(`resume ${r.hash}: ${msg}`); // anything else stays 'signed' and is tried again next tick
      }
    }
  }

  // ------------------------------------------------------------------ reads (pinned to this.block)

  private at() {
    return { blockNumber: this.block };
  }

  private async priceState() {
    const { pub, addresses: a } = this.d;
    const [[ok, reason], liq] = await Promise.all([
      pub.readContract({ address: a.priceModule, abi: priceAbi, functionName: "status", ...this.at() }),
      pub.readContract({ address: a.priceModule, abi: priceAbi, functionName: "liquidationPrice", ...this.at() }),
    ]);
    return { ok, reason, liq };
  }

  private async loanState(id: bigint): Promise<LoanState> {
    const { pub, addresses: a } = this.d;
    const [l, debt] = await Promise.all([
      pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loans", args: [id], ...this.at() }),
      pub.readContract({ address: a.pool, abi: poolAbi, functionName: "debtOf", args: [id], ...this.at() }),
    ]);
    return { id, borrower: getAddress(l.borrower), open: l.open, collateral: l.collateral, debt, dueAt: l.dueAt };
  }

  private async guardState(borrower: Address) {
    const { pub, addresses: a } = this.d;
    const [lim, usage, usdtBal, warsBal, usdtAllow, warsAllow] = await Promise.all([
      pub.readContract({ address: a.guard, abi: guardAbi, functionName: "limitsOf", args: [borrower], ...this.at() }),
      pub.readContract({ address: a.guard, abi: guardAbi, functionName: "usageOf", args: [borrower], ...this.at() }),
      pub.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "balanceOf", args: [borrower], ...this.at() }),
      pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "balanceOf", args: [borrower], ...this.at() }),
      pub.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "allowance", args: [borrower, a.guard], ...this.at() }),
      pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "allowance", args: [borrower, a.guard], ...this.at() }),
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

  /**
   * The A2 credit for a borrower, rebuilt from indexed chain events (see ledger.ts), plus every wARS that left the
   * wallet after the indexed range, read live up to this tick's block: outflows only ever lower the credit, so the
   * newest spending always counts.
   */
  private async creditOf(borrower: Address): Promise<bigint> {
    const { db, addresses: a } = this.d;
    const items: LedgerItem[] = [];
    const ev = db
      .prepare(
        `SELECT name, block, log_index, args FROM events WHERE
           (name IN ('LimitsSet', 'Revoked') AND json_extract(args, '$.borrower') = ?)
           OR (name IN ('Borrowed', 'LoanClosed') AND json_extract(args, '$.borrower') = ?)
           OR (name = 'BadDebt' AND json_extract(args, '$.loanId') IN
                (SELECT json_extract(args, '$.loanId') FROM events WHERE name = 'Borrowed' AND json_extract(args, '$.borrower') = ?))`,
      )
      .all(borrower, borrower, borrower) as any[];
    for (const e of ev) {
      const pos = { block: BigInt(e.block), logIndex: Number(e.log_index) };
      const args = JSON.parse(e.args);
      if (e.name === "LimitsSet") items.push({ kind: "guardOn", autoRepay: Boolean(args.limits?.autoRepay), ...pos });
      else if (e.name === "Revoked") items.push({ kind: "guardOff", ...pos });
      else if (e.name === "Borrowed") items.push({ kind: "loanOpened", loanId: BigInt(args.loanId), ...pos });
      else items.push({ kind: "loanEnded", loanId: BigInt(args.loanId), ...pos });
    }
    const flows = db.prepare("SELECT direction, counterparty, amount, block, log_index FROM wars_flows WHERE borrower = ?").all(borrower) as any[];
    const notIncome = new Set([a.pool, a.guard, borrower].map((x) => getAddress(x)));
    for (const f of flows) {
      const pos = { block: BigInt(f.block), logIndex: Number(f.log_index) };
      if (f.direction === "out") items.push({ kind: "out", amount: BigInt(f.amount), ...pos });
      else if (!notIncome.has(getAddress(f.counterparty))) items.push({ kind: "in", amount: BigInt(f.amount), ...pos });
    }
    if (this.block > this.indexed) {
      const tail = await this.d.pub.getLogs({ address: CELO.wars, event: erc20TransferEvent[0], args: { from: borrower }, fromBlock: this.indexed + 1n, toBlock: this.block });
      for (const t of tail) items.push({ kind: "out", amount: t.args.value!, block: t.blockNumber!, logIndex: Number(t.logIndex) });
    }
    return credit(items);
  }

  // ------------------------------------------------------------------ jobs

  /** Logs and, in live mode, sends. Returns what happened. */
  private async act(job: Job, loan: LoanState, d: Decision, price: bigint, inputs: unknown, call?: { to: Address; data: Hex }): Promise<Outcome> {
    const said = sayDecision(d, price, this.ruleText(loan.borrower));
    const amount = "usdt" in d ? d.usdt : "wars" in d ? d.wars : 0n;
    const signature = d.kind === "none" ? `${d.kind}:${d.reason}` : `${d.kind}:${amount}`;
    if (d.kind === "none") {
      if (!said.es) return "quiet";
      if (this.seenRecently(`${job}:${loan.id}`, signature)) return "refused";
      this.record(job, loan.id, loan.borrower, { price }, inputs, d, "refused", said);
      this.notice(`${loan.id}:${d.reason}:${this.day()}`, loan, d.reason, said);
      return "refused";
    }
    if (this.d.mode !== "live") {
      if (!this.seenRecently(`${job}:${loan.id}`, signature)) {
        this.record(job, loan.id, loan.borrower, { price }, inputs, d, "watch_only", said);
        this.log(`[watch] ${job} loan ${loan.id}: ${said.en}`);
      }
      return "watch";
    }
    const id = this.record(job, loan.id, loan.borrower, { price }, inputs, d, "decided", said);
    try {
      const { hash } = await this.send(this.d.keeper, id, call!.to, call!.data);
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

  /** A5 for one loan past 80%, used only when the borrower's own protection could not act. */
  private async liquidate(loan: LoanState, price: bigint) {
    const { pub, addresses: a, keeper } = this.d;
    const keeperWars = await pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "balanceOf", args: [keeper.address], ...this.at() });
    const d = decideLiquidation(loan, price, keeperWars, keeperWars);
    if (d.kind === "none" && d.reason === "NOT_LIQUIDATABLE") return;
    if (!a.gentleKeeper) {
      if (!this.seenRecently(`A5:${loan.id}`, "no-keeper")) this.log(`loan ${loan.id} is past 80% and no GentleKeeper is configured`);
      return;
    }
    if (d.kind === "liquidate" && this.d.mode === "live") {
      // GentleKeeper can pull from the agent only when the agent itself calls it, so one unlimited approval is safe
      // and avoids changing a non-zero allowance (some tokens refuse that).
      const allowance = await pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "allowance", args: [keeper.address, a.gentleKeeper] });
      if (allowance < keeperWars) {
        const id = this.record("approve", loan.id, null, { for: "GentleKeeper" }, { allowance, keeperWars }, { kind: "approve" }, "decided");
        await this.send(keeper, id, CELO.wars, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [a.gentleKeeper, 2n ** 256n - 1n] }));
      }
    }
    // The amount is decided again on chain from the price in the block; the agent only sets the ceiling.
    const call = d.kind === "liquidate" ? { to: a.gentleKeeper, data: encodeFunctionData({ abi: keeperAbi, functionName: "liquidateGently", args: [loan.id, keeperWars] }) } : undefined;
    await this.act("A5_liquidate", loan, d, price, { keeperWars, debt: loan.debt, collateral: loan.collateral }, call);
  }

  /**
   * One loan per tick: the borrower's own protection first (A1, also past 80%: their signed dollars beat a sale);
   * a gentle liquidation (A5) only when protection could not act; auto-repay (A2) only for a loan that is not at risk.
   */
  private async decide(loan: LoanState, price: bigint, priceOk: boolean, chainNow: bigint, indexedOk: boolean) {
    const { addresses: a } = this.d;
    const g = await this.guardState(loan.borrower);
    const guarded = g.limits.expiry !== 0n;
    const inputs = { limits: g.limits, usage: g.usage, wallet: g.wallet, debt: loan.debt, collateral: loan.collateral };
    let protectedNow: Outcome | null = null;
    if (guarded) {
      const p = decideProtect(loan, g.limits, g.usage, g.wallet, price, priceOk, chainNow);
      if (p.kind !== "none" || p.reason !== "NOT_AT_RISK") {
        const call =
          p.kind === "topUp"
            ? { to: a.guard, data: encodeFunctionData({ abi: guardAbi, functionName: "protectWithTopUp", args: [loan.id, p.usdt] }) }
            : p.kind === "protectRepay"
              ? { to: a.guard, data: encodeFunctionData({ abi: guardAbi, functionName: "protectWithRepay", args: [loan.id, p.wars] }) }
              : undefined;
        const outcome = await this.act("A1_protect", loan, p, price, inputs, call);
        if (p.kind !== "none" && outcome !== "failed") protectedNow = outcome;
      }
    }
    if (isLiquidatable(loan.debt, loan.collateral, price)) {
      if (!protectedNow) await this.liquidate(loan, price);
      return;
    }
    if (protectedNow || !guarded) return; // one action per loan per tick; the next tick sees the new state

    // A2 decides only from an index that has seen every earlier action on this borrower's wallet.
    if (!indexedOk) return;
    const actedOnBorrower = BigInt(getMeta(this.d.db, `actedBorrower:${loan.borrower}`) ?? "0");
    if (actedOnBorrower > this.indexed) return;
    const arrived = await this.creditOf(loan.borrower);
    if (arrived === 0n) return;
    const r = decideAutoRepay(loan, g.limits, g.usage, g.wallet, arrived, priceOk, chainNow);
    const call = r.kind === "autoRepay" ? { to: a.guard, data: encodeFunctionData({ abi: guardAbi, functionName: "autoRepay", args: [loan.id, r.wars] }) } : undefined;
    await this.act("A2_autorepay", loan, r, price, { ...inputs, credit: arrived }, call);
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
      const lim = await pub.readContract({ address: a.guard, abi: guardAbi, functionName: "limitsOf", args: [loan.borrower], ...this.at() });
      if (!lim.rateWatch || lim.expiry < chainNow) continue;
      const l = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loans", args: [id], ...this.at() });
      const poolBps = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "borrowRateBps", args: [l.tier], ...this.at() });
      const w = rateWatch(loan.debt, poolBps, otherBps, loan.dueAt - chainNow, price);
      if (!w.worthIt || loan.debt > m.freeWars) continue;
      this.notice(`${id}:ratewatch:${this.day()}`, loan, "rate_watch", {
        es: `En Morpho (Ethereum) la tasa está en ${percent(otherBps)} contra ${percent(poolBps)} acá. Para tu préstamo de ${pesos(loan.debt)} serían ${pesos(w.save)} menos hasta el vencimiento; mudarse cuesta unos ${dollars(3_500_000n)}. Tu próximo préstamo o renovación puede ir por ahí.`,
        en: `On Morpho (Ethereum) the rate is ${percent(otherBps, "en")} against ${percent(poolBps, "en")} here. For your ${pesos(loan.debt, "en")} loan that is ${pesos(w.save, "en")} less until it is due; moving costs about ${dollars(3_500_000n, "en")}. Your next loan or renewal can go there.`,
      });
      this.record("A3_rates", id, loan.borrower, { otherBps, poolBps }, { debt: loan.debt, save: w.save, moveCost: w.moveCost }, { kind: "notice" }, "noticed");
    }
  }

  /**
   * Who made the pool's current pause: the newest Paused/Unpaused event, read from the index and then live from the
   * blocks the index has not reached yet. The agent's own pause is a Paused event whose `by` is its guardian.
   */
  private async pausedByUs(block: bigint): Promise<boolean> {
    const { db, pub, addresses: a, guardian } = this.d;
    if (!guardian) return false;
    let last = db.prepare("SELECT name, args FROM events WHERE name IN ('Paused', 'Unpaused') ORDER BY block DESC, log_index DESC LIMIT 1").get() as any;
    const tail = await pub.getLogs({
      address: a.pool,
      events: poolAbi.filter((x: any) => x.type === "event" && (x.name === "Paused" || x.name === "Unpaused")) as any,
      fromBlock: BigInt(getMeta(db, "celo.indexedTo") ?? "0") + 1n,
      toBlock: block,
    });
    if (tail.length > 0) {
      const t: any = tail[tail.length - 1];
      last = { name: t.eventName, args: JSON.stringify({ by: t.args.by }) };
    }
    if (!last || last.name !== "Paused") return false;
    return getAddress(JSON.parse(last.args).by) === guardian.address;
  }

  /**
   * A4, on its own loop (main.ts) so its once-a-minute readings never wait for the loan loop: pause new borrowing
   * when the chain price disagrees with every outside source; resume only our own pause.
   */
  async priceTick() {
    const { pub, addresses: a, db } = this.d;
    const block = await pub.getBlockNumber({ cacheTime: 0 });
    const [spot, twap] = await Promise.all([
      pub.readContract({ address: a.priceModule, abi: priceAbi, functionName: "spot", blockNumber: block }),
      pub.readContract({ address: a.priceModule, abi: priceAbi, functionName: "liquidationPrice", blockNumber: block }),
    ]);
    const { quotes, failed } = await offChainQuotes();
    const at = this.now();
    const ins = db.prepare("INSERT INTO prices (source, value, observed_at, raw) VALUES (?, ?, ?, ?)");
    ins.run("uniswap_spot", chainToNumber(spot), at, null);
    ins.run("uniswap_twap30", chainToNumber(twap), at, null);
    for (const q of quotes) ins.run(q.source, q.pesosPerDollar, at, json(q.raw));
    for (const f of failed) if (!this.seenRecently(`source:${f.source}`, "down")) this.log(`price source down: ${f.source}: ${f.error}`);

    const paused = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "paused", blockNumber: block });
    const ours = paused && (await this.pausedByUs(block));
    const v = verdict(this.readings(at), at, ours, paused);
    if (v.action === "hold") return;
    if (this.unsettled(this.d.guardian?.address ?? "0x0000000000000000000000000000000000000000") > 0) return; // one guardian decision at a time
    if (this.d.mode !== "live" || !this.d.guardian) {
      if (!this.seenRecently("A4", v.action)) {
        this.record("A4_price", null, null, { why: v.why }, {}, { kind: v.action }, "watch_only", { es: "", en: v.why });
        this.log(`[watch] A4 would ${v.action}: ${v.why}`);
      }
      return;
    }
    const id = this.record("A4_price", null, null, { why: v.why }, {}, { kind: v.action }, "decided", { es: "", en: v.why });
    try {
      await this.send(this.d.guardian, id, a.pool, encodeFunctionData({ abi: poolAbi, functionName: v.action === "pause" ? "pause" : "unpause" }));
      this.log(`A4 ${v.action}: ${v.why}`);
    } catch (e: any) {
      this.d.db.prepare("UPDATE agent_actions SET status = 'failed', error = ? WHERE id = ?").run(String(e?.shortMessage ?? e).slice(0, 500), id);
    }
  }

  /** The last 15 minutes of readings: the chain's 30-minute price against each outside source. */
  private readings(now: number): Reading[] {
    const rows = this.d.db.prepare("SELECT source, value, observed_at FROM prices WHERE observed_at >= ? ORDER BY observed_at").all(now - 15 * 60_000) as any[];
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

  // ------------------------------------------------------------------ tick

  private async phase(name: string, fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (e: any) {
      this.log(`${name}: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 300)}`);
      return false;
    }
  }

  async tick() {
    const { db, pub, addresses: a, labels } = this.d;
    await this.phase("settle", () => this.settlePending());
    const indexedOk = await this.phase("index", async () => {
      this.indexed = await indexOnce(db, pub, a, labels, this.log);
      await sweepLoans(db, pub, a, labels);
    });
    if (!indexedOk) this.indexed = BigInt(getMeta(db, "celo.indexedTo") ?? "0");
    let price: { ok: boolean; reason: number; liq: bigint } | undefined;
    let chainNow = 0n;
    await this.phase("block", async () => {
      this.block = await pub.getBlockNumber({ cacheTime: 0 });
      price = await this.priceState();
      chainNow = (await pub.getBlock({ blockNumber: this.block })).timestamp;
    });
    if (price) {
      const p = price;
      for (const id of openLoanIds(db)) {
        await this.phase(`loan ${id}`, async () => {
          // Never decide on a loan from a view older than the agent's own last action on it.
          const acted = BigInt(getMeta(db, `actedBlock:${id}`) ?? "0");
          if (acted >= this.block) return;
          await refreshLoan(db, pub, a, id, labels);
          const loan = await this.loanState(id);
          if (!loan.open) return;
          await this.decide(loan, p.liq, p.ok, chainNow, indexedOk);
          for (const n of loanNotices(loan, p.liq, chainNow, db)) this.notice(n.key, loan, n.kind, n.said);
        });
      }
      await this.phase("rates", () => this.watchRates(chainNow, p.liq));
    }
    await this.phase("pool notices", async () => {
      for (const n of await poolNotices(pub, a, db)) this.notice(n.key, null, n.kind, n.said);
    });
    setMeta(db, "lastTick", String(this.now()));
  }
}
