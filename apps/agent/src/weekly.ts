// A7 Weekly summary, every Sunday at 20:00 in Buenos Aires (23:00 UTC). One summary per person who borrowed,
// repaid, lent or had a loan open that week, and one for the pool. Balances and debts are read from the chain at one
// block when the summary is written; the week's flows come from the indexed chain events. Every number in a
// sentence must come from those facts: a sentence holding any other number is never written.
import { encodeFunctionData, getAddress, type Address, type Hex, type PublicClient } from "viem";
import { creditBookAbi, poolAbi } from "@adelanto/chain";
import { pesos, percent } from "@adelanto/core";
import { PAUSE_GAP } from "@adelanto/price";
import { getMeta, setMeta, tx, type Db } from "./db.ts";
import { sameAnswers, type PaidRpc } from "./buy.ts";

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
const TZ = "America/Argentina/Buenos_Aires";
const PAUSE_BPS = BigInt(Math.round(PAUSE_GAP * 10_000)); // the agent's price-pause line

/** The latest Sunday 23:00 UTC (20:00 in Buenos Aires, which keeps no daylight saving) at or before `now`. */
export function lastSummaryTime(now: number): number {
  const d = new Date(now);
  const sunday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay(), 23);
  return sunday <= now ? sunday : sunday - WEEK;
}

export type LoanNow = { id: number; open: boolean; debt: bigint; dueAt: number };
export type PersonWeek = {
  who: Address;
  borrowed: bigint;
  opened: number[];
  repaid: bigint; // all repayments on this person's loans in the week
  repaidByAgent: bigint; // of which the agent repaid under the person's rule
  usdtAddedByAgent: bigint; // 6 decimals
  closedOnTime: number[];
  closedLate: number[];
  liquidated: number[];
  openNow: LoanNow[]; // from chain at the summary block
  deposited: bigint;
  withdrawn: bigint;
  lendingNow: bigint; // pool shares held, valued in pesos at the summary block
  earned: bigint | null; // lendingNow minus (share value a week ago + deposits − withdrawals); null if unreadable
  step: number; // CreditBook tier at the summary block
};
export type PoolWeek = {
  opened: number;
  lent: bigint;
  repaid: bigint;
  closed: number;
  agentActs: number;
  priceChecks: number;
  maxGapBps: number | null;
  cash: bigint;
  totalDebt: bigint;
  borrowRateBps: bigint;
  lenderRateBps: bigint;
};
export type Week = { start: number; end: number; block: bigint; people: PersonWeek[]; pool: PoolWeek };
export type Said = { es: string; en: string };

// ------------------------------------------------------------------ the number check

/** Every number written in a sentence, as it appears ("1.000", "30,8", "5"). */
export function numbersIn(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

/**
 * Formats numbers for sentences and remembers each one, so the finished text can be checked: a number in the text
 * that no fact produced (a typo in a template, a model writing its own figure) blocks the summary.
 */
export class Facts {
  readonly allowed = new Set<string>();
  add(s: string): string {
    for (const n of numbersIn(s)) this.allowed.add(n);
    return s;
  }
  check(text: string): string[] {
    return numbersIn(text).filter((n) => !this.allowed.has(n));
  }
}

const day = (ms: number, lang: "es" | "en") => new Date(ms).toLocaleDateString(lang === "es" ? "es-AR" : "en-GB", { timeZone: TZ, day: "numeric", month: "long" });
const list = (parts: string[], lang: "es" | "en") =>
  parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} ${lang === "es" ? "y" : "and"} ${parts[parts.length - 1]}`;
const ids = (xs: number[], f: Facts, lang: "es" | "en") => list(xs.map((x) => f.add(`#${x}`)), lang);
const loanWord = (n: number, lang: "es" | "en") => (lang === "es" ? (n > 1 ? "los préstamos" : "el préstamo") : n > 1 ? "loans" : "loan");
const usd = (u: bigint, lang: "es" | "en") => {
  const n = (Number((u + 5_000n) / 10_000n) / 100).toLocaleString(lang === "es" ? "es-AR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return lang === "es" ? `US$ ${n}` : `US$${n}`;
};

export function personSummary(w: Week, p: PersonWeek): { said: Said; unknown: string[] } {
  const out = { es: "", en: "" } as Said;
  const unknown: string[] = [];
  for (const lang of ["es", "en"] as const) {
    const es = lang === "es";
    const f = new Facts();
    const P = (v: bigint) => f.add(pesos(v, lang));
    const parts: string[] = [];
    parts.push(es ? `Tu semana en Adelanto, del ${f.add(day(w.start, lang))} al ${f.add(day(w.end, lang))}.` : `Your week on Adelanto, ${f.add(day(w.start, lang))} to ${f.add(day(w.end, lang))}.`);
    const did: string[] = [];
    if (p.borrowed > 0n) did.push(es ? `pediste ${P(p.borrowed)} (${p.opened.length > 1 ? "préstamos" : "préstamo"} ${ids(p.opened, f, lang)})` : `you borrowed ${P(p.borrowed)} (${loanWord(p.opened.length, lang)} ${ids(p.opened, f, lang)})`);
    if (p.repaid > 0n) did.push(es ? `se pagaron ${P(p.repaid)} de tus préstamos` : `${P(p.repaid)} of your loans was repaid`);
    if (p.deposited > 0n) did.push(es ? `prestaste ${P(p.deposited)} al fondo` : `you lent ${P(p.deposited)} to the pool`);
    if (p.withdrawn > 0n) did.push(es ? `retiraste ${P(p.withdrawn)} del fondo` : `you withdrew ${P(p.withdrawn)} from the pool`);
    if (did.length) parts.push(es ? `Esta semana ${list(did, lang)}.` : `This week ${list(did, lang)}.`);
    const agent: string[] = [];
    if (p.repaidByAgent > 0n) agent.push(es ? `pagó ${P(p.repaidByAgent)} con pesos que te entraron, como dice tu regla` : `repaid ${P(p.repaidByAgent)} from pesos that came in, as your rule says`);
    if (p.usdtAddedByAgent > 0n) agent.push(es ? `agregó ${f.add(usd(p.usdtAddedByAgent, lang))} de tus dólares para alejarte del riesgo` : `added ${f.add(usd(p.usdtAddedByAgent, lang))} of your dollars to keep you away from risk`);
    if (agent.length) parts.push(es ? `El agente ${list(agent, lang)}; cada paso está en Celo con su motivo.` : `The agent ${list(agent, lang)}; every step is on Celo with its reason.`);
    if (p.closedOnTime.length) parts.push(es ? `Cerraste a tiempo ${loanWord(p.closedOnTime.length, lang)} ${ids(p.closedOnTime, f, lang)}.` : `You closed ${loanWord(p.closedOnTime.length, lang)} ${ids(p.closedOnTime, f, lang)} on time.`);
    if (p.closedLate.length) parts.push(es ? `${p.closedLate.length > 1 ? "Los préstamos" : "El préstamo"} ${ids(p.closedLate, f, lang)} se ${p.closedLate.length > 1 ? "cerraron" : "cerró"} tarde.` : `${p.closedLate.length > 1 ? "Loans" : "Loan"} ${ids(p.closedLate, f, lang)} closed late.`);
    if (p.liquidated.length) parts.push(es ? `En ${loanWord(p.liquidated.length, lang)} ${ids(p.liquidated, f, lang)} se vendió una parte de tu garantía por el precio.` : `Part of your guarantee was sold on ${loanWord(p.liquidated.length, lang)} ${ids(p.liquidated, f, lang)} because of the price.`);
    const open = p.openNow.filter((l) => l.open);
    if (open.length)
      for (const l of open)
        parts.push(es ? `Hoy debés ${P(l.debt)} en el préstamo ${f.add(`#${l.id}`)}, que vence el ${f.add(day(l.dueAt * 1000, lang))}.` : `Today you owe ${P(l.debt)} on loan ${f.add(`#${l.id}`)}, due ${f.add(day(l.dueAt * 1000, lang))}.`);
    else if (p.borrowed > 0n || p.repaid > 0n) parts.push(es ? "Hoy no debés nada." : "Today you owe nothing.");
    if (p.lendingNow > 0n) {
      const earned = p.earned !== null && p.earned >= WAD / 2n ? p.earned : null; // under half a peso rounds to nothing
      parts.push(
        es
          ? `Tu parte del fondo vale hoy ${P(p.lendingNow)}${earned ? `; esta semana ganaste ${P(earned)}` : ""}.`
          : `Your share of the pool is worth ${P(p.lendingNow)} today${earned ? `; you earned ${P(earned)} this week` : ""}.`,
      );
    }
    if (p.borrowed > 0n || p.repaid > 0n || open.length) parts.push(es ? `Tu historial está en el paso ${f.add(String(p.step))} de ${f.add("3")}.` : `Your record is on step ${f.add(String(p.step))} of ${f.add("3")}.`);
    const text = parts.join(" ");
    out[lang] = text;
    unknown.push(...f.check(text));
  }
  return { said: out, unknown };
}

export function poolSummary(w: Week): { said: Said; unknown: string[] } {
  const out = { es: "", en: "" } as Said;
  const unknown: string[] = [];
  const q = w.pool;
  for (const lang of ["es", "en"] as const) {
    const es = lang === "es";
    const f = new Facts();
    const P = (v: bigint) => f.add(pesos(v, lang));
    const N = (n: number) => f.add(n.toLocaleString(es ? "es-AR" : "en-US"));
    const pct = (bps: bigint) => f.add(percent(bps, lang));
    const parts = [
      es ? `La semana del fondo, del ${f.add(day(w.start, lang))} al ${f.add(day(w.end, lang))}:` : `The pool's week, ${f.add(day(w.start, lang))} to ${f.add(day(w.end, lang))}:`,
      es
        ? `${N(q.opened)} préstamos nuevos por ${P(q.lent)}, ${N(q.closed)} cerrados y ${P(q.repaid)} pagados.`
        : `${N(q.opened)} new loans for ${P(q.lent)}, ${N(q.closed)} closed and ${P(q.repaid)} repaid.`,
      es ? `El agente actuó ${N(q.agentActs)} veces en Celo y revisó el precio ${N(q.priceChecks)} veces.` : `The agent acted ${N(q.agentActs)} times on Celo and checked the price ${N(q.priceChecks)} times.`,
    ];
    if (q.maxGapBps !== null)
      parts.push(es ? `La mayor diferencia entre el fondo y Binance fue ${pct(BigInt(q.maxGapBps))}; frena préstamos nuevos recién pasado ${pct(PAUSE_BPS)}.` : `The largest gap between the pool and Binance was ${pct(BigInt(q.maxGapBps))}; it pauses new loans only past ${pct(PAUSE_BPS)}.`);
    parts.push(
      es
        ? `Hoy el fondo tiene ${P(q.cash)} libres y ${P(q.totalDebt)} prestados; pedir cuesta ${pct(q.borrowRateBps)} al año y prestar rinde ${pct(q.lenderRateBps)}.`
        : `Today the pool has ${P(q.cash)} free and ${P(q.totalDebt)} lent; borrowing costs ${pct(q.borrowRateBps)} a year and lending earns ${pct(q.lenderRateBps)}.`,
    );
    const text = parts.join(" ");
    out[lang] = text;
    unknown.push(...f.check(text));
  }
  return { said: out, unknown };
}

// ------------------------------------------------------------------ gathering

/** The first block at or after `ms`, found from the head by a few timestamp corrections (Celo makes ~1 block/s). */
export async function blockAt(pub: PublicClient, ms: number, head: bigint): Promise<bigint> {
  const target = BigInt(Math.floor(ms / 1000));
  let b = head;
  for (let i = 0; i < 6; i++) {
    const t = (await pub.getBlock({ blockNumber: b })).timestamp;
    const diff = t - target;
    if (diff >= 0n && diff <= 2n) return b;
    let next = b - diff;
    if (next > head) next = head;
    if (next < 0n) next = 0n;
    if (next === b) return b;
    b = next;
  }
  return b;
}

const big = (v: unknown) => BigInt(String(v ?? "0"));
const WAD = 10n ** 18n;

export async function gatherWeek(db: Db, pub: PublicClient, a: { pool: Address; guard: Address; creditBook?: Address }, end: number): Promise<Week> {
  const start = end - WEEK;
  const block = await pub.getBlockNumber({ cacheTime: 0 });
  const headTime = Number((await pub.getBlock({ blockNumber: block })).timestamp) * 1000;
  const endBlock = headTime <= end ? block : await blockAt(pub, end, block);
  const startBlock = await blockAt(pub, start, endBlock);
  const ev = (name: string, contract: Address) =>
    (db.prepare("SELECT args FROM events WHERE chain = 'celo' AND name = ? AND contract = ? AND block >= ? AND block <= ? ORDER BY block, log_index").all(name, contract, Number(startBlock), Number(endBlock)) as any[]).map((r) => JSON.parse(r.args));
  const borrowerOf = new Map<string, Address>((db.prepare("SELECT id, borrower FROM loans").all() as any[]).map((r) => [String(r.id), getAddress(r.borrower)]));
  const people = new Map<Address, PersonWeek>();
  const person = (who: string) => {
    const k = getAddress(who);
    let p = people.get(k);
    if (!p) {
      p = { who: k, borrowed: 0n, opened: [], repaid: 0n, repaidByAgent: 0n, usdtAddedByAgent: 0n, closedOnTime: [], closedLate: [], liquidated: [], openNow: [], deposited: 0n, withdrawn: 0n, lendingNow: 0n, earned: null, step: 0 };
      people.set(k, p);
    }
    return p;
  };
  const pool: PoolWeek = { opened: 0, lent: 0n, repaid: 0n, closed: 0, agentActs: 0, priceChecks: 0, maxGapBps: null, cash: 0n, totalDebt: 0n, borrowRateBps: 0n, lenderRateBps: 0n };
  for (const e of ev("Borrowed", a.pool)) {
    const p = person(e.borrower);
    p.borrowed += big(e.pesos);
    p.opened.push(Number(e.loanId));
    pool.opened++;
    pool.lent += big(e.pesos);
  }
  for (const e of ev("Repaid", a.pool)) {
    const b = borrowerOf.get(String(e.loanId));
    if (b) person(b).repaid += big(e.pesos);
    pool.repaid += big(e.pesos);
  }
  for (const e of ev("Liquidated", a.pool)) {
    const b = borrowerOf.get(String(e.loanId));
    if (b && !person(b).liquidated.includes(Number(e.loanId))) person(b).liquidated.push(Number(e.loanId));
  }
  for (const e of ev("LoanClosed", a.pool)) {
    const p = person(e.borrower);
    (e.onTime ? p.closedOnTime : p.closedLate).push(Number(e.loanId));
    pool.closed++;
  }
  for (const e of ev("AutoRepaid", a.guard)) person(e.borrower).repaidByAgent += big(e.warsRepaid);
  for (const e of ev("ProtectedByRepay", a.guard)) person(e.borrower).repaidByAgent += big(e.warsRepaid);
  for (const e of ev("Protected", a.guard)) person(e.borrower).usdtAddedByAgent += big(e.usdtAdded);
  for (const e of ev("Deposit", a.pool)) person(e.owner).deposited += big(e.assets);
  for (const e of ev("Withdraw", a.pool)) person(e.owner).withdrawn += big(e.assets);

  // Everyone with a loan open now, and everyone who ever lent, gets a summary too, even in a quiet week.
  for (const r of db.prepare("SELECT DISTINCT json_extract(args, '$.owner') o FROM events WHERE chain = 'celo' AND name = 'Deposit' AND contract = ?").all(a.pool) as any[]) person(r.o);
  const openIds = (db.prepare("SELECT id, borrower FROM loans WHERE open = 1").all() as any[]).map((r) => ({ id: BigInt(r.id), who: getAddress(r.borrower) }));
  for (const o of openIds) person(o.who);

  // Read from chain at one block: each person's open loans, their pool share and their credit step; the pool.
  const at = { blockNumber: endBlock };
  for (const p of people.values()) {
    for (const o of openIds.filter((x) => x.who === p.who)) {
      const [l, debt] = await Promise.all([
        pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loans", args: [o.id], ...at }),
        pub.readContract({ address: a.pool, abi: poolAbi, functionName: "debtOf", args: [o.id], ...at }),
      ]);
      p.openNow.push({ id: Number(o.id), open: l.open, debt, dueAt: Number(l.dueAt) });
    }
    const shares = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "balanceOf", args: [p.who], ...at });
    p.lendingNow = shares > 0n ? await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "convertToAssets", args: [shares], ...at }) : 0n;
    if (p.lendingNow > 0n || p.deposited > 0n || p.withdrawn > 0n) {
      try {
        const was = { blockNumber: startBlock };
        const s0 = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "balanceOf", args: [p.who], ...was });
        const v0 = s0 > 0n ? await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "convertToAssets", args: [s0], ...was }) : 0n;
        p.earned = p.lendingNow - (v0 + p.deposited - p.withdrawn);
      } catch {
        p.earned = null; // the node keeps no state that old: say nothing about earnings rather than guess
      }
    }
    if (a.creditBook) p.step = Number(await pub.readContract({ address: a.creditBook, abi: creditBookAbi, functionName: "tier", args: [p.who], ...at }));
  }
  [pool.cash, pool.totalDebt, pool.borrowRateBps, pool.lenderRateBps] = await Promise.all([
    pub.readContract({ address: a.pool, abi: poolAbi, functionName: "cash", ...at }),
    pub.readContract({ address: a.pool, abi: poolAbi, functionName: "totalDebt", ...at }),
    pub.readContract({ address: a.pool, abi: poolAbi, functionName: "borrowRateBps", args: [0], ...at }),
    pub.readContract({ address: a.pool, abi: poolAbi, functionName: "lenderRateBps", ...at }),
  ]);
  pool.agentActs = Number((db.prepare("SELECT COUNT(*) n FROM agent_actions WHERE status = 'landed' AND at >= ? AND at < ?").get(start, end) as any).n);
  const pr = db
    .prepare(
      `SELECT COUNT(*) n, MAX(ABS(p.value / b.value - 1)) gap FROM prices p JOIN prices b ON b.observed_at = p.observed_at AND b.source = 'binance'
       WHERE p.source = 'uniswap_twap30' AND p.observed_at >= ? AND p.observed_at < ?`,
    )
    .get(start, end) as any;
  pool.priceChecks = Number(pr.n);
  pool.maxGapBps = pr.gap === null ? null : Math.round(Number(pr.gap) * 10_000);
  return { start, end, block: endBlock, people: [...people.values()], pool };
}

// ------------------------------------------------------------------ writing

/** Someone with nothing this week, no open loan and nothing lent gets no summary. */
export const hasNews = (p: PersonWeek) =>
  p.borrowed > 0n || p.repaid > 0n || p.deposited > 0n || p.withdrawn > 0n || p.lendingNow > 0n || p.liquidated.length > 0 || p.closedOnTime.length + p.closedLate.length > 0 || p.openNow.some((l) => l.open);

/** Writes the week's summaries as notices, all or none, unless every number checks out it writes nothing. */
export function writeWeek(db: Db, w: Week, now: number, log: (s: string) => void = console.log): { written: number; blocked: string[] } {
  const key = new Date(w.end).toISOString().slice(0, 10);
  const rows: { key: string; who: string | null; said: Said }[] = [];
  const blocked: string[] = [];
  const pool = poolSummary(w);
  if (pool.unknown.length) blocked.push(`pool: ${pool.unknown.join(" ")}`);
  else rows.push({ key: `weekly:${key}:pool`, who: null, said: pool.said });
  for (const p of w.people) {
    if (!hasNews(p)) continue;
    const s = personSummary(w, p);
    if (s.unknown.length) blocked.push(`${p.who}: ${s.unknown.join(" ")}`);
    else rows.push({ key: `weekly:${key}:${p.who}`, who: p.who, said: s.said });
  }
  for (const b of blocked) log(`A7 weekly summary blocked, numbers not in the facts: ${b}`);
  tx(db, () => {
    const ins = db.prepare("INSERT OR IGNORE INTO notices (key, borrower, loan_id, kind, text_es, text_en, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)");
    for (const r of rows) ins.run(r.key, r.who, r.who ? "weekly" : "weekly_pool", r.said.es, r.said.en, now);
    setMeta(db, "weekly:last", key);
    setMeta(db, `weekly:${key}:block`, w.block.toString());
  });
  return { written: rows.length, blocked };
}

/** Runs the summary once its Sunday 20:00 has passed and it has not been written yet. */
/**
 * Before writing, a node we do not run (Chainstack through buy) re-reads every balance, debt, step and pool total the
 * summaries quote, at the same block. A disagreement blocks the week for an hour; if the node cannot be bought the
 * summaries rest on our RPC alone.
 */
export async function crossCheckWeek(pub: PublicClient, paid: PaidRpc, a: { pool: Address; creditBook?: Address }, w: Week): Promise<"match" | "mismatch" | "unavailable"> {
  const calls: { to: Address; data: Hex }[] = [
    { to: a.pool, data: encodeFunctionData({ abi: poolAbi, functionName: "cash" }) },
    { to: a.pool, data: encodeFunctionData({ abi: poolAbi, functionName: "totalDebt" }) },
    { to: a.pool, data: encodeFunctionData({ abi: poolAbi, functionName: "borrowRateBps", args: [0] }) },
    { to: a.pool, data: encodeFunctionData({ abi: poolAbi, functionName: "lenderRateBps" }) },
  ];
  for (const p of w.people) {
    calls.push({ to: a.pool, data: encodeFunctionData({ abi: poolAbi, functionName: "balanceOf", args: [p.who] }) });
    if (a.creditBook) calls.push({ to: a.creditBook, data: encodeFunctionData({ abi: creditBookAbi, functionName: "tier", args: [p.who] }) });
    for (const l of p.openNow) calls.push({ to: a.pool, data: encodeFunctionData({ abi: poolAbi, functionName: "debtOf", args: [BigInt(l.id)] }) });
  }
  const ours = await Promise.all(calls.map(async (c) => (await pub.call({ to: c.to, data: c.data, blockNumber: w.block })).data ?? "0x"));
  const theirs = await paid
    .batch(calls.map((c) => ({ method: "eth_call", params: [{ to: c.to, data: c.data }, `0x${w.block.toString(16)}`] })), { action: "A7_weekly", wallets: w.people.map((p) => p.who), block: w.block.toString() })
    .catch(() => null);
  if (!theirs) return "unavailable";
  return sameAnswers(ours as Hex[], theirs).ok ? "match" : "mismatch";
}

/** Runs the summary once its Sunday 20:00 has passed and it has not been written yet. */
export async function weeklyIfDue(db: Db, pub: PublicClient, a: { pool: Address; guard: Address; creditBook?: Address }, now: number, log: (s: string) => void = console.log, paid?: PaidRpc) {
  const end = lastSummaryTime(now);
  const key = new Date(end).toISOString().slice(0, 10);
  if (getMeta(db, "weekly:last") === key) return null;
  if (now - end > 6 * 24 * HOUR) return null; // never write a week that is long gone
  if (Number(getMeta(db, "weekly:heldUntil") ?? 0) > now) return null;
  const w = await gatherWeek(db, pub, a, end);
  const indexed = BigInt(getMeta(db, "celo.indexedTo") ?? "0");
  if (indexed < w.block) return null; // the indexer has not reached the week's last block yet: next tick
  if (paid) {
    const second = await crossCheckWeek(pub, paid, a, w);
    log(`A7 weekly summary ${key}: second RPC ${second}`);
    if (second === "mismatch") {
      setMeta(db, "weekly:heldUntil", String(now + HOUR));
      return null;
    }
  }
  const r = writeWeek(db, w, now, log);
  log(`A7 weekly summary ${key}: ${r.written} written, ${r.blocked.length} blocked (block ${w.block})`);
  return r;
}
