// A loan quote for the Celo pool, computed with PesoPool's own rules so a quote that says "yes" is a borrow the
// contract accepts, and the numbers people see before signing are the numbers the contract will use.
import { BPS, MIN_LOAN, RISK_LTV_BPS, LIQUIDATION_LTV_BPS, USDT_UNIT, priceAtLtv } from "./health.ts";

// PesoPool rate curve (BASE / KINK / TOP) and fee.
export const BASE_RATE_BPS = 2_200n;
export const KINK_RATE_BPS = 3_600n;
export const KINK_UTIL_BPS = 8_000n;
export const TOP_RATE_BPS = 15_600n;
export const OPEN_FEE_BPS = 25n;
export const TERMS = [7, 30, 60, 90] as const;

/** Personal-loan rate at Argentine banks, TNA, as published by BCRA on 2 Nov 2026. */
export const BANK = { tnaBps: 6_463n, source: "BCRA, préstamos personales, 2 nov 2026" } as const;

/** PesoPool._poolRateBps. */
export function poolRateBps(debt: bigint, free: bigint): bigint {
  const u = debt + free === 0n ? 0n : (debt * BPS) / (debt + free);
  if (u <= KINK_UTIL_BPS) return BASE_RATE_BPS + ((KINK_RATE_BPS - BASE_RATE_BPS) * u) / KINK_UTIL_BPS;
  return KINK_RATE_BPS + ((TOP_RATE_BPS - KINK_RATE_BPS) * (u - KINK_UTIL_BPS)) / (BPS - KINK_UTIL_BPS);
}

export const discountBps = (tier: number) => BigInt(tier) * 100n;

export function maxLtvBpsForTier(tier: number): bigint {
  if (tier >= 3) return 6_500n;
  if (tier === 2) return 6_400n;
  if (tier === 1) return 6_200n;
  return 6_000n;
}

export function maxPesosForTier(tier: number): bigint {
  const W = 10n ** 18n;
  if (tier >= 3) return 5_000_000n * W;
  if (tier === 2) return 3_000_000n * W;
  if (tier === 1) return 2_000_000n * W;
  return 1_000_000n * W;
}

export type PoolState = {
  cash: bigint;
  totalDebt: bigint;
  reserve: bigint;
  caps: { absolute: bigint; depositsBps: bigint; depthBps: bigint };
  warsDepth: bigint;
};

export type QuoteInput = {
  pesos: bigint;
  termDays: number;
  borrowPrice: bigint; // PriceModule.borrowPrice: the lower of spot and the 30-minute average
  tier: number;
  pool: PoolState;
  /** Share of the dollars' value the loan starts at; lower is safer. Never above the tier's limit. */
  startLtvBps?: bigint;
};

export type QuoteRefusal = "BELOW_MIN" | "BAD_TERM" | "OVER_LOAN_LIMIT" | "POOL_TOO_THIN" | "CAP_REACHED";

export type Quote =
  | {
      ok: true;
      pesos: bigint;
      termDays: number;
      collateral: bigint; // USDT to leave
      startLtvBps: bigint;
      rateBps: bigint; // yearly, at the pool's use after this loan, with the credit-step discount
      fee: bigint; // wARS, taken from the pesos at borrow time
      received: bigint; // wARS that reach the wallet
      interest: bigint; // wARS over the full term at today's rate (the rate moves with use)
      owedAtTerm: bigint;
      riskPrice: bigint; // pesos per dollar at which the loan reaches 70%
      salePrice: bigint; // ... and 80%, where part of the dollars can be sold
      bankInterest: bigint; // the same pesos at the bank's TNA over the same days
      saving: bigint;
      maxRateBps: bigint; // passed to borrow(): refuse if the rate moved more than 1 point before signing
    }
  | { ok: false; reason: QuoteRefusal; limit?: bigint };

const YEAR_DAYS = 365n;
const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

export function quote(q: QuoteInput): Quote {
  const { pesos, termDays, borrowPrice, tier, pool } = q;
  if (pesos < MIN_LOAN) return { ok: false, reason: "BELOW_MIN", limit: MIN_LOAN };
  if (!(TERMS as readonly number[]).includes(termDays)) return { ok: false, reason: "BAD_TERM" };
  const tierMax = maxPesosForTier(tier);
  if (pesos > tierMax) return { ok: false, reason: "OVER_LOAN_LIMIT", limit: tierMax };
  if (pesos > pool.cash) return { ok: false, reason: "POOL_TOO_THIN", limit: pool.cash };
  const assets = pool.cash + pool.totalDebt - pool.reserve;
  const room = [
    pool.caps.absolute,
    (assets * pool.caps.depositsBps) / BPS,
    (pool.warsDepth * pool.caps.depthBps) / BPS,
  ].reduce((a, b) => (b < a ? b : a));
  if (pool.totalDebt + pesos > room) return { ok: false, reason: "CAP_REACHED", limit: room > pool.totalDebt ? room - pool.totalDebt : 0n };

  const maxLtv = maxLtvBpsForTier(tier);
  const wanted = q.startLtvBps ?? 5_000n; // start at half the dollars' value: the price can fall 28% before risk
  if (wanted <= 0n) throw new Error("startLtvBps must be positive");
  const start = wanted > maxLtv ? maxLtv : wanted;
  // dollars so that pesos <= value * start / BPS (and so the contract's own check, at maxLtv, passes too)
  const collateral = ceilDiv(pesos * BPS * USDT_UNIT, start * borrowPrice) + 1n;

  const rateBps = poolRateBps(pool.totalDebt + pesos, pool.cash - pesos) - discountBps(tier);
  const fee = ceilDiv(pesos * OPEN_FEE_BPS, BPS);
  const days = BigInt(termDays);
  const interest = (pesos * rateBps * days) / (BPS * YEAR_DAYS);
  const bankInterest = (pesos * BANK.tnaBps * days) / (BPS * YEAR_DAYS);
  const owedAtTerm = pesos + interest;
  return {
    ok: true,
    pesos,
    termDays,
    collateral,
    startLtvBps: start,
    rateBps,
    fee,
    received: pesos - fee,
    interest,
    owedAtTerm,
    riskPrice: priceAtLtv(owedAtTerm, collateral, RISK_LTV_BPS),
    salePrice: priceAtLtv(owedAtTerm, collateral, LIQUIDATION_LTV_BPS),
    bankInterest,
    saving: bankInterest > interest + fee ? bankInterest - interest - fee : 0n,
    maxRateBps: rateBps + 100n,
  };
}
