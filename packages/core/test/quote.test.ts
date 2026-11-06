import { describe, expect, it } from "vitest";
import { ltvBps, collateralValue } from "../src/health.ts";
import { quote, poolRateBps, type PoolState } from "../src/quote.ts";

const W = 10n ** 18n;
// The pool as it stood before our first mainnet loan (6 Nov 2026): 5,616.86 wARS deposited, nothing lent.
const pool: PoolState = {
  cash: 5_616_858_843_855_710_031_998n,
  totalDebt: 0n,
  reserve: 0n,
  caps: { absolute: 20_000_000n * W, depositsBps: 7_000n, depthBps: 6_500n },
  warsDepth: 27_779_259_382_734_893_698_115_924n,
};
const price = 1_657_398_579_949_054_644_881n; // borrowPrice in that block

describe("quote matches PesoPool", () => {
  it("reproduces loan 1: 25.11% and a 2.5 wARS fee", () => {
    const q = quote({ pesos: 1_000n * W, termDays: 7, borrowPrice: price, tier: 0, pool });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.rateBps).toBe(2_511n); // what the Borrowed event recorded on chain
    expect(q.fee).toBe(25n * 10n ** 17n);
    expect(q.received).toBe(9_975n * 10n ** 17n);
  });
  it("leaves enough dollars to start at 50% and passes the contract's 60% check", () => {
    const q = quote({ pesos: 1_000n * W, termDays: 30, borrowPrice: price, tier: 0, pool });
    if (!q.ok) throw new Error();
    expect(ltvBps(1_000n * W, q.collateral, price)).toBeLessThanOrEqual(5_000n);
    expect(1_000n * W <= (collateralValue(q.collateral, price) * 6_000n) / 10_000n).toBe(true);
  });
  it("never starts above the step's limit", () => {
    const q = quote({ pesos: 1_000n * W, termDays: 30, borrowPrice: price, tier: 0, pool, startLtvBps: 9_000n });
    if (!q.ok) throw new Error();
    expect(q.startLtvBps).toBe(6_000n);
  });
  it("compares with the bank", () => {
    const q = quote({ pesos: 100_000n * W, termDays: 30, borrowPrice: price, tier: 0, pool: { ...pool, cash: 1_000_000n * W } });
    if (!q.ok) throw new Error();
    expect(q.bankInterest / W).toBe(5_312n); // 100,000 at 64.63% for 30 days
    expect(q.saving).toBeGreaterThan(0n);
    expect(q.riskPrice).toBeLessThan(price);
    expect(q.salePrice).toBeLessThan(q.riskPrice);
  });
  it("refuses what the contract would refuse", () => {
    expect(quote({ pesos: 999n * W, termDays: 7, borrowPrice: price, tier: 0, pool })).toMatchObject({ ok: false, reason: "BELOW_MIN" });
    expect(quote({ pesos: 1_000n * W, termDays: 14, borrowPrice: price, tier: 0, pool })).toMatchObject({ ok: false, reason: "BAD_TERM" });
    // 6,000 is more than the free pesos, but the cap (70% of deposits, 3,931.8) binds first: say the real limit
    expect(quote({ pesos: 6_000n * W, termDays: 7, borrowPrice: price, tier: 0, pool })).toMatchObject({ ok: false, reason: "CAP_REACHED", limit: (pool.cash * 7_000n) / 10_000n });
    expect(quote({ pesos: 6_000n * W, termDays: 7, borrowPrice: price, tier: 0, pool: { ...pool, caps: { ...pool.caps, depositsBps: 10_000n } } })).toMatchObject({ ok: false, reason: "POOL_TOO_THIN", limit: pool.cash });
    // 70% of deposits: 3,931 wARS is the most all loans together can reach today
    expect(quote({ pesos: 4_000n * W, termDays: 7, borrowPrice: price, tier: 0, pool })).toMatchObject({ ok: false, reason: "CAP_REACHED" });
    expect(quote({ pesos: 3_900n * W, termDays: 7, borrowPrice: price, tier: 0, pool }).ok).toBe(true);
  });
  it("rate curve: 22% idle, 36% at 80% use, 156% full", () => {
    expect(poolRateBps(0n, 100n)).toBe(2_200n);
    expect(poolRateBps(80n, 20n)).toBe(3_600n);
    expect(poolRateBps(100n, 0n)).toBe(15_600n);
  });
});
