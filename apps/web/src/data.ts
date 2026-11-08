// Everything a page shows comes from here: live reads from Celo (one multicall per page) and the agent's own
// database, opened read-only. Each number keeps its source and the time it was read.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { erc20Abi, getAddress, parseAbi, type Address, type PublicClient } from "viem";
import { CELO, celoDeployment, celoPublicClient, creditBookAbi, guardAbi, poolAbi, priceAbi } from "@adelanto/chain";
import { band, ltvBps, priceAtLtv, quote, type PoolState, type Quote } from "@adelanto/core";
import { AGENT_ID, FEEDBACK_TAG, REPUTATION, reputationAbi } from "../client/feedback.ts";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const dep = celoDeployment();
export const pub: PublicClient = celoPublicClient();
const ROOT = join(import.meta.dirname, "..", "..", "..");

/** Reference rates shown next to ours, each with its source and date. */
export const REFS = {
  bankLoan: { bps: 6_463n, es: "préstamo personal en bancos", en: "bank personal loan", source: "BCRA, 2 nov 2026" },
  badlar: { bps: 2_230n, es: "BADLAR (depósitos a plazo)", en: "BADLAR (term deposits)", source: "BCRA, 2 nov 2026" },
  inflation: { bps: 3_340n, es: "inflación anual", en: "inflation, 12 months", source: "INDEC, septiembre 2026" },
} as const;

const capsAbi = parseAbi(["function caps() view returns (uint128 absolute, uint16 depositsBps, uint16 depthBps)", "function reserve() view returns (uint256)"]);
const celoUsdtPool = "0x6cde5f5a192fBf3fD84df983aa6DC30dbd9f8Fac"; // Uniswap v3 CELO/USDT 0.01%: CELO price for network costs
const slot0Abi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)"]);

export type PoolView = {
  readAt: number;
  block: bigint;
  pool: PoolState;
  totalAssets: bigint;
  utilizationBps: bigint;
  borrowRateBps: bigint;
  lenderRateBps: bigint;
  paused: boolean;
  priceOk: boolean;
  priceReason: number;
  borrowPrice: bigint | null; // null when the price module refuses
  liquidationPrice: bigint;
  spot: bigint;
  gasPriceWei: bigint;
  celoInUsdt: number; // dollars per CELO, for showing network costs
};

export async function poolView(): Promise<PoolView> {
  const block = await pub.getBlockNumber({ cacheTime: 0 });
  const at = { blockNumber: block };
  const r = await pub.multicall({
    allowFailure: true,
    ...at,
    contracts: [
      { address: dep.pool, abi: poolAbi, functionName: "cash" },
      { address: dep.pool, abi: poolAbi, functionName: "totalDebt" },
      { address: dep.pool, abi: capsAbi, functionName: "reserve" },
      { address: dep.pool, abi: capsAbi, functionName: "caps" },
      { address: dep.priceModule, abi: priceAbi, functionName: "warsDepth" },
      { address: dep.pool, abi: poolAbi, functionName: "totalAssets" },
      { address: dep.pool, abi: poolAbi, functionName: "utilizationBps" },
      { address: dep.pool, abi: poolAbi, functionName: "borrowRateBps", args: [0] },
      { address: dep.pool, abi: poolAbi, functionName: "lenderRateBps" },
      { address: dep.pool, abi: poolAbi, functionName: "paused" },
      { address: dep.priceModule, abi: priceAbi, functionName: "status" },
      { address: dep.priceModule, abi: parseAbi(["function borrowPrice() view returns (uint256)"]), functionName: "borrowPrice" },
      { address: dep.priceModule, abi: priceAbi, functionName: "liquidationPrice" },
      { address: dep.priceModule, abi: priceAbi, functionName: "spot" },
      { address: celoUsdtPool, abi: slot0Abi, functionName: "slot0" },
    ],
  });
  const ok = <T>(i: number): T => {
    if (r[i].status !== "success") throw new Error(`read ${i} failed`);
    return r[i].result as T;
  };
  const caps = ok<readonly [bigint, number, number]>(3);
  const [okPrice, reason] = ok<readonly [boolean, number]>(10);
  const sqrt = ok<readonly [bigint, ...unknown[]]>(14)[0];
  // CELO is token0 (18 decimals), USDT token1 (6): price = (sqrt/2^96)^2 * 1e12 dollars per CELO
  const celoInUsdt = (Number(sqrt) / 2 ** 96) ** 2 * 1e12;
  return {
    readAt: Date.now(),
    block,
    pool: {
      cash: ok<bigint>(0),
      totalDebt: ok<bigint>(1),
      reserve: ok<bigint>(2),
      caps: { absolute: caps[0], depositsBps: BigInt(caps[1]), depthBps: BigInt(caps[2]) },
      warsDepth: ok<bigint>(4),
    },
    totalAssets: ok<bigint>(5),
    utilizationBps: ok<bigint>(6),
    borrowRateBps: ok<bigint>(7),
    lenderRateBps: ok<bigint>(8),
    paused: ok<boolean>(9),
    priceOk: okPrice,
    priceReason: reason,
    borrowPrice: r[11].status === "success" ? (r[11].result as bigint) : null,
    liquidationPrice: ok<bigint>(12),
    spot: ok<bigint>(13),
    gasPriceWei: await pub.getGasPrice(),
    celoInUsdt,
  };
}

/** Network cost of one transaction of `gas` units, in dollars, at today's gas price. */
export function networkCostUsd(v: PoolView, gas: bigint): number {
  return (Number(v.gasPriceWei * gas) / 1e18) * v.celoInUsdt;
}

export function quoteFor(v: PoolView, pesosWhole: bigint, termDays: number, tier = 0): Quote | { ok: false; reason: "PRICE_REFUSED" | "PAUSED" } {
  if (v.paused) return { ok: false, reason: "PAUSED" };
  if (!v.borrowPrice) return { ok: false, reason: "PRICE_REFUSED" };
  return quote({ pesos: pesosWhole * 10n ** 18n, termDays, borrowPrice: v.borrowPrice, tier, pool: v.pool });
}

export type LoanView = {
  id: bigint;
  borrower: Address;
  open: boolean;
  liquidated: boolean;
  tier: number;
  termDays: number;
  openedAt: bigint;
  dueAt: bigint;
  collateral: bigint;
  debt: bigint;
  ltvBps: bigint;
  band: ReturnType<typeof band>;
  riskPrice: bigint;
  salePrice: bigint;
  guard: { limits: any; ruleHash: string } | null;
};

export async function loanView(id: bigint, v: PoolView): Promise<LoanView | null> {
  const at = { blockNumber: v.block };
  const [l, debt] = await Promise.all([
    pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "loans", args: [id], ...at }),
    pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "debtOf", args: [id], ...at }),
  ]);
  if (l.borrower === "0x0000000000000000000000000000000000000000") return null;
  const borrower = getAddress(l.borrower);
  const [limits, ruleHash] = await Promise.all([
    pub.readContract({ address: dep.guard, abi: guardAbi, functionName: "limitsOf", args: [borrower], ...at }),
    pub.readContract({ address: dep.guard, abi: guardAbi, functionName: "ruleHashOf", args: [borrower], ...at }),
  ]);
  const ltv = ltvBps(debt, l.collateral, v.liquidationPrice);
  return {
    id,
    borrower,
    open: l.open,
    liquidated: l.liquidated,
    tier: l.tier,
    termDays: l.termDays,
    openedAt: l.openedAt,
    dueAt: l.dueAt,
    collateral: l.collateral,
    debt,
    ltvBps: ltv,
    band: band(ltv),
    riskPrice: priceAtLtv(debt, l.collateral, 7_000n),
    salePrice: priceAtLtv(debt, l.collateral, 8_000n),
    guard: limits.expiry > 0n ? { limits, ruleHash } : null,
  };
}

export async function balancesOf(who: Address) {
  const [usdt, wars, shares] = await Promise.all([
    pub.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
    pub.readContract({ address: CELO.wars, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
    pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "balanceOf", args: [who] }),
  ]);
  const deposit = shares === 0n ? 0n : await pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "convertToAssets", args: [shares] });
  return { usdt, wars, shares, deposit };
}

// ------------------------------------------------------------------ the agent's database (read-only)

const dbPath = process.env.DB_PATH ?? join(process.env.HOME ?? "", "adelanto-data", "agent.sqlite");
let db: InstanceType<typeof DatabaseSync> | null = null;
function agentDb() {
  if (db) return db;
  if (!existsSync(dbPath)) return null;
  db = new DatabaseSync(dbPath, { readOnly: true });
  return db;
}

export type EventRow = { tx: string; block: number; name: string; args: any; byAgent?: boolean };

export function loanEvents(id: bigint): EventRow[] {
  const d = agentDb();
  if (!d) return [];
  const rows = d
    .prepare(
      `SELECT tx, block, name, args FROM events WHERE json_extract(args, '$.loanId') = ?
       ORDER BY block, log_index`,
    )
    .all(id.toString()) as any[];
  const all = rows.map((r) => ({ tx: r.tx, block: Number(r.block), name: r.name, args: JSON.parse(r.args) }) as EventRow);
  // The agent's own events (LoanGuard) ride on the pool event of the same transaction: one line, marked as the agent's.
  const GUARD = new Set(["AutoRepaid", "Protected", "ProtectedByRepay"]);
  const byAgent = new Set(all.filter((e) => GUARD.has(e.name)).map((e) => e.tx));
  return all
    .filter((e) => !GUARD.has(e.name) || !all.some((o) => o.tx === e.tx && !GUARD.has(o.name)))
    .map((e) => (byAgent.has(e.tx) && !GUARD.has(e.name) ? { ...e, byAgent: true } : e));
}

export function agentActions(loanId?: bigint, limit = 20) {
  const d = agentDb();
  if (!d) return [];
  const q = loanId === undefined
    ? d.prepare("SELECT job, loan_id, status, tx, sentence_es, sentence_en, at FROM agent_actions WHERE status IN ('landed','refused','noticed') AND sentence_es IS NOT NULL AND sentence_es <> '' ORDER BY id DESC LIMIT ?").all(limit)
    : d.prepare("SELECT job, loan_id, status, tx, sentence_es, sentence_en, at FROM agent_actions WHERE loan_id = ? AND sentence_es IS NOT NULL AND sentence_es <> '' ORDER BY id DESC LIMIT ?").all(Number(loanId), limit);
  return q as any[];
}

/** What the agent told one wallet (A6 notices, A7 weekly summaries), newest first. */
export function noticesFor(who: string, limit = 12) {
  const d = agentDb();
  if (!d) return [];
  return d.prepare("SELECT key, loan_id, kind, text_es, text_en, created_at FROM notices WHERE borrower = ? ORDER BY created_at DESC LIMIT ?").all(getAddress(who), limit) as any[];
}

/** The latest weekly summary of the whole pool (A7), if one has been written. */
export function weeklyPool(): { key: string; text_es: string; text_en: string; created_at: number } | null {
  const d = agentDb();
  if (!d) return null;
  return (d.prepare("SELECT key, text_es, text_en, created_at FROM notices WHERE kind = 'weekly_pool' ORDER BY created_at DESC LIMIT 1").get() as any) ?? null;
}

export function loanRows() {
  const d = agentDb();
  if (!d) return [];
  return d.prepare("SELECT id, borrower, open, collateral, debt, liquidated, label, opened_at, due_at FROM loans ORDER BY id DESC").all() as any[];
}

export function depositRows() {
  const d = agentDb();
  if (!d) return [];
  return d.prepare("SELECT tx, block, name, args FROM events WHERE name IN ('Deposit', 'Withdraw') ORDER BY block DESC, log_index DESC").all() as any[];
}

export function adminEvents() {
  const d = agentDb();
  if (!d) return [];
  return d
    .prepare("SELECT tx, block, name, args FROM events WHERE name IN ('Paused','Unpaused','GuardianSet','CapsLowered','CapsRaiseScheduled','CapsRaised','ReserveMoveScheduled','ReserveMoveCancelled','ReserveMoved','OwnershipTransferStarted','OwnershipTransferred','BadDebt') ORDER BY block DESC")
    .all() as any[];
}

export function lastTick(): number | null {
  const d = agentDb();
  if (!d) return null;
  const r = d.prepare("SELECT value FROM meta WHERE key = 'lastTick'").get() as any;
  return r ? Number(r.value) : null;
}

export function attributionAudit(): { totals: any; checkedAt: string; firstTagged: any } | null {
  const f = join(ROOT, "evidence", "attribution-audit.json");
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, "utf8"));
  return { totals: j.totals, checkedAt: j.checkedAt, firstTagged: j.firstTagged };
}

/** Labels for our own wallets (deployments/wallets.json); everyone else is a user. */
export const LABELS: Record<string, "OURS" | "JUDGE"> = Object.fromEntries(
  (JSON.parse(readFileSync(join(ROOT, "deployments", "wallets.json"), "utf8")).wallets as { address: string; label: "OURS" | "JUDGE" }[]).map((w) => [getAddress(w.address), w.label]),
);
export const labelOf = (a: string) => LABELS[getAddress(a)] ?? "USER";

export type PricePoint = { t: number; pool: number; binance: number | null; dolarapi: number | null };

/** Pivots the agent's price rows (one row per source per reading) into one point per reading, oldest first. */
export function pivotPrices(rows: { source: string; value: number; observed_at: number }[]): PricePoint[] {
  const by = new Map<number, PricePoint>();
  for (const r of rows) {
    const t = Number(r.observed_at);
    const p = by.get(t) ?? { t, pool: 0, binance: null, dolarapi: null };
    if (r.source === "uniswap_twap30") p.pool = Number(r.value);
    else if (r.source === "binance") p.binance = Number(r.value);
    else if (r.source === "dolarapi") p.dolarapi = Number(r.value);
    by.set(t, p);
  }
  return [...by.values()].filter((p) => p.pool > 0 && (p.binance ?? 0) > 0).sort((x, y) => x.t - y.t);
}

/** Keeps about `points` evenly spaced points, always ending on the newest one. */
export function thin<T>(all: T[], points: number): T[] {
  if (all.length <= points) return all;
  const step = all.length / points;
  const out: T[] = [];
  for (let i = 0; i < points - 1; i++) out.push(all[Math.floor(i * step)]);
  out.push(all[all.length - 1]);
  return out;
}

/**
 * The prices the agent itself reads once a minute (its A4 price check): the chain's 30-minute pool price against
 * Binance and dolarapi, over the last `hours`, thinned to `points`. Read from the agent's database, so it is live.
 */
export function priceHistory(hours = 24, points = 120): PricePoint[] {
  const d = agentDb();
  if (!d) return [];
  const since = Date.now() - hours * 3_600_000;
  const rows = d
    .prepare("SELECT source, value, observed_at FROM prices WHERE observed_at >= ? AND source IN ('uniswap_twap30','binance','dolarapi') ORDER BY observed_at")
    .all(since) as any[];
  return thin(pivotPrices(rows), points);
}

/** A wallet's public credit record from CreditBook, and the step it is on. */
export async function creditOf(who: Address) {
  const [r, tier] = await Promise.all([
    pub.readContract({ address: dep.creditBook, abi: creditBookAbi, functionName: "recordOf", args: [who] }),
    pub.readContract({ address: dep.creditBook, abi: creditBookAbi, functionName: "tier", args: [who] }),
  ]);
  return { ...r, tier: Number(tier) };
}

// ------------------------------------------------------------------ ERC-8004 reputation (read from chain)

export const SITE = process.env.PUBLIC_URL ?? "https://adelanto.space";
export type Rating = { client: Address; loanId: number; stars: number; label: string; counts: boolean };
let repCache: { at: number; ratings: Rating[] } | null = null;

/**
 * Every rating the agent has on the ReputationRegistry, newest last. A rating counts only if it is about a closed
 * loan, given by that loan's borrower, not one of our own wallets, and not revoked.
 */
export async function reputation(fresh = false): Promise<Rating[]> {
  if (!fresh && repCache && Date.now() - repCache.at < 60_000) return repCache.ratings;
  const clients = (await pub.readContract({ address: REPUTATION, abi: reputationAbi, functionName: "getClients", args: [AGENT_ID] })) as Address[];
  let ratings: Rating[] = [];
  if (clients.length) {
    const [who, , values, decimals, tag1s, tag2s, revoked] = (await pub.readContract({ address: REPUTATION, abi: reputationAbi, functionName: "readAllFeedback", args: [AGENT_ID, clients, "", "", true] })) as unknown as any[];
    const loans = new Map(loanRows().map((r) => [Number(r.id), r]));
    ratings = (who as Address[]).map((client, i) => {
      const loanId = Number(tag2s[i]);
      const loan = loans.get(loanId);
      const value = Number(values[i]) / 10 ** Number(decimals[i]);
      const label = labelOf(client);
      const counts = tag1s[i] === FEEDBACK_TAG && !revoked[i] && !!loan && !loan.open && getAddress(loan.borrower) === getAddress(client) && label !== "OURS" && value >= 0 && value <= 100;
      return { client: getAddress(client), loanId, stars: Math.round(value / 20), label, counts };
    });
  }
  repCache = { at: Date.now(), ratings };
  return ratings;
}

/** Count and average stars of the ratings that count. */
export async function reputationSummary(): Promise<{ count: number; avg: number } | null> {
  const r = (await reputation().catch(() => [])).filter((x) => x.counts);
  return r.length ? { count: r.length, avg: r.reduce((s, x) => s + x.stars, 0) / r.length } : null;
}

/** The agent's latest daily pool check against an outside node bought through buy, and its paid purchases. */
export function buyView(): { check: any | null; paid: { settlement_tx: string; served: string; at: number }[] } {
  const d = agentDb();
  if (!d) return { check: null, paid: [] };
  let check: any = null;
  try {
    const r = d.prepare("SELECT value FROM meta WHERE key = 'poolcheck:last'").get() as any;
    check = r ? JSON.parse(r.value) : null;
  } catch {}
  let paid: any[] = [];
  try {
    paid = d.prepare("SELECT settlement_tx, served, at FROM buy_purchases WHERE outcome = 'paid' AND settlement_tx IS NOT NULL ORDER BY id DESC").all() as any[];
  } catch {}
  return { check, paid };
}
