// Everything a page shows comes from here: live reads from Celo (one multicall per page) and the agent's own
// database, opened read-only. Each number keeps its source and the time it was read.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { erc20Abi, getAddress, parseAbi, type Address, type PublicClient } from "viem";
import { CELO, celoDeployment, celoPublicClient, creditBookAbi, guardAbi, poolAbi, priceAbi } from "@adelanto/chain";
import { band, ltvBps, priceAtLtv, quote, type PoolState, type Quote } from "@adelanto/core";

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

export type EventRow = { tx: string; block: number; name: string; args: any };

export function loanEvents(id: bigint): EventRow[] {
  const d = agentDb();
  if (!d) return [];
  const rows = d
    .prepare(
      `SELECT tx, block, name, args FROM events WHERE json_extract(args, '$.loanId') = ?
       ORDER BY block, log_index`,
    )
    .all(id.toString()) as any[];
  return rows.map((r) => ({ tx: r.tx, block: Number(r.block), name: r.name, args: JSON.parse(r.args) }));
}

export function agentActions(loanId?: bigint, limit = 20) {
  const d = agentDb();
  if (!d) return [];
  const q = loanId === undefined
    ? d.prepare("SELECT job, loan_id, status, tx, sentence_es, sentence_en, at FROM agent_actions WHERE status IN ('landed','refused','noticed') AND sentence_es IS NOT NULL AND sentence_es <> '' ORDER BY id DESC LIMIT ?").all(limit)
    : d.prepare("SELECT job, loan_id, status, tx, sentence_es, sentence_en, at FROM agent_actions WHERE loan_id = ? AND sentence_es IS NOT NULL AND sentence_es <> '' ORDER BY id DESC LIMIT ?").all(Number(loanId), limit);
  return q as any[];
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

/** Labels for our own wallets; everyone else is a user. */
export const LABELS: Record<string, "OURS" | "JUDGE"> = {
  [getAddress("0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1")]: "OURS",
  [getAddress("0xF689c0620b9a9D7A1a0312e1F0778bAa440989BE")]: "OURS",
  [getAddress("0x0d11e997afca7723e4216579c48bf3842555ad46")]: "OURS",
  [getAddress("0x0cff67325Ba688921C36bDf0ff59E351100e2A3d")]: "JUDGE",
};
export const labelOf = (a: string) => LABELS[getAddress(a)] ?? "USER";

/** The minute-by-minute price watch (pool 30-min average against Binance), newest last, thinned to `points`. */
export function priceHistory(points = 96): { t: number; pool: number; binance: number }[] {
  const candidates = [process.env.PRICE_LOG, join(process.env.HOME ?? "", "adelanto-private", "g0", "p6", "prices.csv"), join(process.cwd(), "evidence", "price-watch.csv")].filter(Boolean) as string[];
  for (const f of candidates) {
    try {
      const rows = readFileSync(f, "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
      const ok = rows.filter((r) => r.length >= 5 && Number(r[2]) > 0 && Number(r[4]) > 0).map((r) => ({ t: Date.parse(r[0]), pool: Number(r[2]), binance: Number(r[4]) }));
      if (ok.length < 2) continue;
      const step = Math.max(1, Math.floor(ok.length / points));
      const out = ok.filter((_, i) => i % step === 0);
      if (out[out.length - 1] !== ok[ok.length - 1]) out.push(ok[ok.length - 1]);
      return out;
    } catch {
      /* try the next source */
    }
  }
  return [];
}

/** A wallet's public credit record from CreditBook, and the step it is on. */
export async function creditOf(who: Address) {
  const [r, tier] = await Promise.all([
    pub.readContract({ address: dep.creditBook, abi: creditBookAbi, functionName: "recordOf", args: [who] }),
    pub.readContract({ address: dep.creditBook, abi: creditBookAbi, functionName: "tier", args: [who] }),
  ]);
  return { ...r, tier: Number(tier) };
}
