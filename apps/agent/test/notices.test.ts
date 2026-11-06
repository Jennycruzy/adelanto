import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { loanNotices } from "../src/notices.ts";

const W = 10n ** 18n;
const P = 1000n * W;
const loanAt = (ltvPct: number) => ({ id: 1n, borrower: "0x00000000000000000000000000000000000000b0" as const, open: true, collateral: 10_000_000n, debt: BigInt(Math.round(ltvPct * 100)) * W, dueAt: 10n ** 12n });

describe("health notices", () => {
  it("do not flap when the loan sits on a line", () => {
    const db = openDb(":memory:");
    let told = 0;
    for (let i = 0; i < 60; i++) told += loanNotices(loanAt(i % 2 ? 64.99 : 65.0), P, BigInt(1_000 + i * 60), db).length;
    expect(told).toBe(1); // "Atención" once; the dips to 64.99% are inside the 2-point band
  });
  it("tell at once when it gets worse, and calm again only after risk", () => {
    const db = openDb(":memory:");
    expect(loanNotices(loanAt(66), P, 1_000n, db)).toHaveLength(1);
    expect(loanNotices(loanAt(71), P, 1_060n, db)[0].said.es).toMatch(/Riesgo/);
    expect(loanNotices(loanAt(50), P, 1_120n, db)[0].said.es).toMatch(/volvió a «Tranquilo»/);
  });
});
