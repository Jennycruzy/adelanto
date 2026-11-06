import { describe, expect, it } from "vitest";
import { credit, type LedgerItem } from "../src/ledger.ts";

const W = 10n ** 18n;
let n = 0;
const at = (block: number) => ({ block: BigInt(block), logIndex: n++ });
const on = (b: number, autoRepay = true): LedgerItem => ({ kind: "guardOn", autoRepay, ...at(b) });
const off = (b: number): LedgerItem => ({ kind: "guardOff", ...at(b) });
const opened = (b: number, id = 1n): LedgerItem => ({ kind: "loanOpened", loanId: id, ...at(b) });
const ended = (b: number, id = 1n): LedgerItem => ({ kind: "loanEnded", loanId: id, ...at(b) });
const inn = (b: number, x: number): LedgerItem => ({ kind: "in", amount: BigInt(x) * W, ...at(b) });
const out = (b: number, x: number): LedgerItem => ({ kind: "out", amount: BigInt(x) * W, ...at(b) });

describe("auto-repay credit", () => {
  it("counts pesos that arrive while guarded with a loan open", () => {
    expect(credit([opened(1), on(2), inn(3, 800)])).toBe(800n * W);
  });
  it("ignores pesos that arrived before the loan or before the guard", () => {
    expect(credit([inn(1, 500), opened(2), inn(3, 100), on(4), inn(5, 50)])).toBe(50n * W);
  });
  it("the agent's own repayment uses the credit: repaid once, never twice", () => {
    expect(credit([opened(1), on(2), inn(3, 800), out(4, 800)])).toBe(0n);
  });
  it("a partial repayment keeps the rest for later", () => {
    expect(credit([opened(1), on(2), inn(3, 1000), out(4, 100)])).toBe(900n * W);
  });
  it("spending uses the credit first, so borrowed pesos are never repaid as if they had arrived", () => {
    // 900 borrowed pesos in the wallet, 100 arrive, the borrower spends 100: nothing is left to auto-repay
    expect(credit([opened(1), on(2), inn(3, 100), out(4, 100)])).toBe(0n);
  });
  it("turning the guard off clears it; on again starts from zero", () => {
    expect(credit([opened(1), on(2), inn(3, 300), off(4), on(5), inn(6, 20)])).toBe(20n * W);
  });
  it("same block: order by log index (guard on after the arrival does not count it)", () => {
    const items: LedgerItem[] = [
      { kind: "loanOpened", loanId: 1n, block: 10n, logIndex: 0 },
      { kind: "in", amount: 5n * W, block: 10n, logIndex: 1 },
      { kind: "guardOn", autoRepay: true, block: 10n, logIndex: 2 },
      { kind: "in", amount: 7n * W, block: 10n, logIndex: 3 },
    ];
    expect(credit(items.reverse())).toBe(7n * W);
  });
  it("once every loan has ended, credit is cleared", () => {
    expect(credit([opened(1), on(2), inn(3, 300), ended(4), opened(5, 2n)])).toBe(0n);
  });
  it("savings that arrived before auto-repay was turned on are never repaid", () => {
    expect(credit([opened(1), on(2, false), inn(3, 300_000), on(4, true)])).toBe(0n);
    expect(credit([opened(1), on(2, false), inn(3, 300_000), on(4, true), inn(5, 10)])).toBe(10n * W);
  });
  it("a renewal of the limits starts from zero (covers arrivals while the guard was expired)", () => {
    expect(credit([opened(1), on(2), inn(3, 500), on(9), inn(10, 20)])).toBe(20n * W);
  });
  it("turning auto-repay off stops counting", () => {
    expect(credit([opened(1), on(2), inn(3, 50), on(4, false), inn(5, 70)])).toBe(0n);
  });
  it("credit never goes below zero", () => {
    expect(credit([opened(1), on(2), out(3, 999), inn(4, 10)])).toBe(10n * W);
  });
});
