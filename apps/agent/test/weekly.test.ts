import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { openDb } from "../src/db.ts";
import { Facts, hasNews, lastSummaryTime, numbersIn, personSummary, poolSummary, writeWeek, type PersonWeek, type Week } from "../src/weekly.ts";

const W = 10n ** 18n;
const who = getAddress("0x0d11e997afca7723e4216579c48bf3842555ad46");
const end = Date.UTC(2026, 10, 8, 23); // Sunday 8 Nov 2026, 20:00 in Buenos Aires
const person = (o: Partial<PersonWeek> = {}): PersonWeek => ({
  who, borrowed: 0n, opened: [], repaid: 0n, repaidByAgent: 0n, usdtAddedByAgent: 0n, closedOnTime: [], closedLate: [], liquidated: [],
  openNow: [], deposited: 0n, withdrawn: 0n, lendingNow: 0n, earned: null, step: 0, ...o,
});
const week = (people: PersonWeek[]): Week => ({
  start: end - 7 * 86_400_000, end, block: 100n, people,
  pool: { opened: 2, lent: 2000n * W, repaid: 1000n * W, closed: 1, agentActs: 3, priceChecks: 10080, maxGapBps: 70, cash: 5517n * W, totalDebt: 1000n * W, borrowRateBps: 3075n, lenderRateBps: 410n },
});

describe("A7 schedule", () => {
  it("is Sunday 23:00 UTC, 20:00 in Buenos Aires", () => {
    expect(lastSummaryTime(end)).toBe(end);
    expect(lastSummaryTime(end - 1)).toBe(end - 7 * 86_400_000);
    expect(lastSummaryTime(end + 3 * 86_400_000)).toBe(end);
    expect(new Date(lastSummaryTime(Date.UTC(2026, 10, 11, 9))).toISOString()).toBe("2026-11-08T23:00:00.000Z");
  });
});

describe("A7 sentences", () => {
  it("tells a borrower the week from the facts, in both languages", () => {
    const p = person({ borrowed: 1000n * W, opened: [5], repaid: 1000n * W, repaidByAgent: 300n * W, closedOnTime: [5] });
    const s = personSummary(week([p]), p);
    expect(s.unknown).toEqual([]);
    expect(s.said.es).toContain("pediste $ 1.000 (préstamo #5)");
    expect(s.said.es).toContain("El agente pagó $ 300 con pesos que te entraron");
    expect(s.said.es).toContain("Cerraste a tiempo el préstamo #5.");
    expect(s.said.es).toContain("Hoy no debés nada.");
    expect(s.said.en).toContain("You closed loan #5 on time.");
  });

  it("says several loans in the plural", () => {
    const p = person({ borrowed: 2000n * W, opened: [3, 4], closedOnTime: [3, 4] });
    const s = personSummary(week([p]), p);
    expect(s.said.es).toContain("(préstamos #3 y #4)");
    expect(s.said.es).toContain("Cerraste a tiempo los préstamos #3 y #4.");
    expect(s.said.en).toContain("You closed loans #3 and #4 on time.");
  });

  it("tells what is owed on an open loan, and what a lender earned", () => {
    const p = person({ openNow: [{ id: 7, open: true, debt: 1003n * W, dueAt: Date.UTC(2026, 10, 15, 12) / 1000 }], lendingNow: 5600n * W, earned: 12n * W });
    const s = personSummary(week([p]), p);
    expect(s.unknown).toEqual([]);
    expect(s.said.es).toContain("Hoy debés $ 1.003 en el préstamo #7, que vence el 15 de noviembre.");
    expect(s.said.es).toContain("Tu parte del fondo vale hoy $ 5.600; esta semana ganaste $ 12.");
  });

  it("writes the pool's week with the pause line", () => {
    const s = poolSummary(week([]));
    expect(s.unknown).toEqual([]);
    expect(s.said.es).toContain("revisó el precio 10.080 veces");
    expect(s.said.es).toContain("fue 0,7%; frena préstamos nuevos recién pasado 1,5%.");
    expect(s.said.en).toContain("borrowing costs 30.8% a year and lending earns 4.1%");
  });
});

describe("A7 number check", () => {
  it("finds every number in a sentence", () => {
    expect(numbersIn("Pagaste $ 1.000 y 30,8% el 8 de noviembre (#5)")).toEqual(["1.000", "30,8", "8", "5"]);
  });

  it("flags a number no fact produced", () => {
    const f = new Facts();
    const text = `Debés ${f.add("$ 1.000")}`;
    expect(f.check(text)).toEqual([]);
    expect(f.check(text + " y 2.500 más")).toEqual(["2.500"]);
  });
});

describe("A7 writing", () => {
  it("writes one notice per person with news and one for the pool, once", () => {
    const db = openDb(":memory:");
    const quiet = person({ who: getAddress("0x0cff67325Ba688921C36bDf0ff59E351100e2A3d") });
    expect(hasNews(quiet)).toBe(false);
    const w = week([person({ borrowed: 1000n * W, opened: [5] }), quiet]);
    expect(writeWeek(db, w, end, () => {})).toEqual({ written: 2, blocked: [] });
    writeWeek(db, w, end, () => {});
    const rows = db.prepare("SELECT key, kind, borrower FROM notices ORDER BY key").all() as any[];
    expect(rows.map((r) => r.kind)).toEqual(["weekly", "weekly_pool"]);
    expect(rows[0].key).toBe(`weekly:2026-11-08:${who}`);
    expect((db.prepare("SELECT value FROM meta WHERE key = 'weekly:last'").get() as any).value).toBe("2026-11-08");
  });
});
