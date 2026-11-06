import { describe, expect, it } from "vitest";
import { decideAutoRepay, decideLiquidation, decideProtect, type Limits, type LoanState, type Usage, type Wallet } from "../src/guard.ts";
import { WAD, ltvBps } from "../src/health.ts";
import { sayDecision } from "../src/sentences.ts";

const usdt = (n: number) => BigInt(Math.round(n * 1e6));
const wars = (n: number) => BigInt(Math.round(n)) * WAD;
const P = 1000n * WAD; // 1,000 pesos per dollar
const NOW = 1_800_000_000n;
const borrower = "0x00000000000000000000000000000000000000b0" as const;

const limits = (o: Partial<Limits> = {}): Limits => ({
  autoRepay: true,
  rateWatch: false,
  protectOrder: 0,
  expiry: NOW + 86_400n,
  keepWarsBuffer: wars(500),
  maxRepayWarsPerDay: wars(5_000),
  maxTopUpUsdtPerDay: usdt(5),
  maxRateBps: 4000,
  ...o,
});
const usage = (o: Partial<Usage> = {}): Usage => ({ repaidWars: 0n, toppedUpUsdt: 0n, ...o });
const wallet = (o: Partial<Wallet> = {}): Wallet => ({
  usdt: usdt(50),
  wars: wars(10_000),
  usdtAllowanceToGuard: usdt(35),
  warsAllowanceToGuard: wars(35_000),
  ...o,
});
const loan = (debtPesos: number, collateralUsd = 10, o: Partial<LoanState> = {}): LoanState => ({
  id: 1n,
  borrower,
  open: true,
  collateral: usdt(collateralUsd),
  debt: wars(debtPesos),
  dueAt: NOW + 86_400n * 7n,
  ...o,
});

describe("A1 protect", () => {
  it("does nothing below 70%", () => {
    expect(decideProtect(loan(6_999), limits(), usage(), wallet(), P, true, NOW)).toMatchObject({ kind: "none", reason: "NOT_AT_RISK" });
  });
  it("adds dollars first, enough to get back to 60%", () => {
    const d = decideProtect(loan(7_200), limits(), usage(), wallet(), P, true, NOW);
    expect(d.kind).toBe("topUp");
    if (d.kind !== "topUp") return;
    expect(d.partial).toBe(false);
    expect(ltvBps(wars(7_200), usdt(10) + d.usdt, P)).toBeLessThanOrEqual(6000n);
  });
  it("repays first when the borrower chose that", () => {
    const d = decideProtect(loan(7_200), limits({ protectOrder: 1 }), usage(), wallet(), P, true, NOW);
    expect(d).toMatchObject({ kind: "protectRepay", wars: wars(1_200), partial: false });
  });
  it("never goes over today's dollar cap", () => {
    const d = decideProtect(loan(7_900), limits({ maxTopUpUsdtPerDay: usdt(1) }), usage({ toppedUpUsdt: usdt(0.4) }), wallet(), P, true, NOW);
    expect(d).toMatchObject({ kind: "topUp", usdt: usdt(0.6), partial: true });
  });
  it("falls back to pesos when no dollars can move", () => {
    const d = decideProtect(loan(7_200), limits(), usage({ toppedUpUsdt: usdt(5) }), wallet(), P, true, NOW);
    expect(d.kind).toBe("protectRepay");
  });
  it("keeps the peso buffer", () => {
    const d = decideProtect(loan(7_200), limits({ protectOrder: 1, keepWarsBuffer: wars(9_500) }), usage(), wallet({ usdt: 0n }), P, true, NOW);
    expect(d).toMatchObject({ kind: "protectRepay", wars: wars(500), partial: true });
  });
  it("respects the allowance to the guard", () => {
    const d = decideProtect(loan(7_200), limits(), usage(), wallet({ usdtAllowanceToGuard: usdt(0.25) }), P, true, NOW);
    expect(d).toMatchObject({ kind: "topUp", usdt: usdt(0.25), partial: true });
  });
  it("says why when nothing can move", () => {
    expect(decideProtect(loan(7_200), limits(), usage({ toppedUpUsdt: usdt(5), repaidWars: wars(5_000) }), wallet(), P, true, NOW)).toMatchObject({ reason: "GUARD_LIMIT" });
    expect(decideProtect(loan(7_200), limits(), usage(), wallet({ usdt: 0n, wars: wars(100) }), P, true, NOW)).toMatchObject({ reason: "WALLET_LOW" });
  });
  it("stops when limits are missing, expired, or the price is refused", () => {
    expect(decideProtect(loan(7_500), limits({ expiry: 0n }), usage(), wallet(), P, true, NOW)).toMatchObject({ reason: "NO_GUARD" });
    expect(decideProtect(loan(7_500), limits({ expiry: NOW - 1n }), usage(), wallet(), P, true, NOW)).toMatchObject({ reason: "GUARD_EXPIRED" });
    expect(decideProtect(loan(7_500), limits(), usage(), wallet(), P, false, NOW)).toMatchObject({ reason: "PRICE_REFUSED" });
    expect(decideProtect(loan(7_500, 10, { open: false }), limits(), usage(), wallet(), P, true, NOW)).toMatchObject({ reason: "LOAN_CLOSED" });
  });
  it("fuzz: never exceeds any limit, wallet or allowance", () => {
    let s = 1;
    const r = () => ((s = (s * 1103515245 + 12345) % 2 ** 31), s / 2 ** 31);
    for (let i = 0; i < 20_000; i++) {
      const l = limits({ protectOrder: r() < 0.5 ? 0 : 1, keepWarsBuffer: wars(r() * 5_000), maxRepayWarsPerDay: wars(r() * 8_000), maxTopUpUsdtPerDay: usdt(r() * 8) });
      const u = usage({ repaidWars: wars(r() * 8_000), toppedUpUsdt: usdt(r() * 8) });
      const w = wallet({ usdt: usdt(r() * 20), wars: wars(r() * 20_000), usdtAllowanceToGuard: usdt(r() * 20), warsAllowanceToGuard: wars(r() * 20_000) });
      const ln = loan(5_000 + r() * 4_500);
      const d = decideProtect(ln, l, u, w, P, true, NOW);
      if (d.kind === "topUp") {
        expect(u.toppedUpUsdt + d.usdt).toBeLessThanOrEqual(l.maxTopUpUsdtPerDay);
        expect(d.usdt).toBeLessThanOrEqual(w.usdt);
        expect(d.usdt).toBeLessThanOrEqual(w.usdtAllowanceToGuard);
        expect(d.usdt).toBeGreaterThan(0n);
      } else if (d.kind === "protectRepay") {
        expect(u.repaidWars + d.wars).toBeLessThanOrEqual(l.maxRepayWarsPerDay);
        expect(w.wars - d.wars).toBeGreaterThanOrEqual(l.keepWarsBuffer);
        expect(d.wars).toBeLessThanOrEqual(w.warsAllowanceToGuard);
        expect(d.wars).toBeLessThanOrEqual(ln.debt);
        expect(d.wars).toBeGreaterThan(0n);
      } else {
        expect(d.kind).toBe("none");
      }
    }
  });
});

describe("A2 repay when pesos arrive", () => {
  it("repays what arrived", () => {
    expect(decideAutoRepay(loan(5_000), limits(), usage(), wallet(), wars(2_000), true, NOW)).toMatchObject({ kind: "autoRepay", wars: wars(2_000) });
  });
  it("never more than the debt", () => {
    expect(decideAutoRepay(loan(300), limits(), usage(), wallet(), wars(2_000), true, NOW)).toMatchObject({ wars: wars(300) });
  });
  it("keeps the buffer", () => {
    expect(decideAutoRepay(loan(5_000), limits({ keepWarsBuffer: wars(9_000) }), usage(), wallet(), wars(2_000), true, NOW)).toMatchObject({ wars: wars(1_000) });
    expect(decideAutoRepay(loan(5_000), limits({ keepWarsBuffer: wars(10_000) }), usage(), wallet(), wars(2_000), true, NOW)).toMatchObject({ reason: "BUFFER" });
  });
  it("off unless the borrower turned it on", () => {
    expect(decideAutoRepay(loan(5_000), limits({ autoRepay: false }), usage(), wallet(), wars(2_000), true, NOW)).toMatchObject({ reason: "AUTO_REPAY_OFF" });
  });
  it("nothing when nothing arrived", () => {
    expect(decideAutoRepay(loan(5_000), limits(), usage(), wallet(), 0n, true, NOW)).toMatchObject({ reason: "NOTHING_ARRIVED" });
  });
});

describe("A5 liquidate gently", () => {
  it("only above 80%", () => {
    expect(decideLiquidation(loan(8_000), P, wars(100_000), wars(100_000))).toMatchObject({ reason: "NOT_LIQUIDATABLE" });
    expect(decideLiquidation(loan(8_500), P, wars(100_000), wars(100_000)).kind).toBe("liquidate");
  });
  it("uses only the keeper's own pesos and allowance", () => {
    expect(decideLiquidation(loan(8_500), P, wars(1_000), wars(100_000))).toMatchObject({ kind: "liquidate", wars: wars(1_000), partial: true });
    expect(decideLiquidation(loan(8_500), P, 0n, wars(100_000))).toMatchObject({ reason: "KEEPER_LOW" });
  });
});

describe("sentences", () => {
  it("top-up in Spanish quotes the rule and the numbers", () => {
    const d = decideProtect(loan(7_200), limits(), usage(), wallet(), P, true, NOW);
    const s = sayDecision(d, P, "Que nunca llegue a riesgo");
    expect(s.es).toMatch(/^Tu regla: «Que nunca llegue a riesgo»\. Agregué US\$ 2,00 a tu préstamo porque el dólar está a \$ 1\.000 y tu préstamo llegó al 72%\.$/);
    expect(s.en).toContain("I added US$2.00");
  });
});
