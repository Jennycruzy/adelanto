import { describe, expect, it } from "vitest";
import { openDb, getMeta } from "../src/db.ts";
import { poolCheckIfDue } from "../src/poolcheck.ts";

const POOL = "0xCfeafCDd06d3a0E3Bf1596F8Afa1caC1Dc19ed60";
const word = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const answers = [word(5_516_000), word(0), word(5_516_907), word(2200)];
// Our RPC: answers in call order (cash, totalDebt, totalAssets, borrowRateBps), always at the block asked.
function pub() {
  let i = 0;
  const blocks: bigint[] = [];
  return { blocks, call: async ({ blockNumber }: any) => (blocks.push(blockNumber), { data: answers[i++ % 4] }) } as any;
}
// The paid node: records what it was asked and a receipt, as PaidRpc does.
function paid(db: any, theirs: string[] | null) {
  const asked: any[] = [];
  return {
    asked,
    batch: async (calls: any[], served: any) => {
      asked.push({ calls, served });
      if (!theirs) return null;
      db.prepare("INSERT INTO buy_purchases (capability, url, payer, token, amount, settlement_tx, served, outcome, detail, at) VALUES ('chainstack.celo', 'u', 'p', 'USDT', '10000', '0xfee', ?, 'paid', NULL, 1)").run(JSON.stringify(served));
      return theirs;
    },
  } as any;
}
const day = Date.UTC(2026, 10, 8, 18);

describe("daily pool check through buy", () => {
  it("buys the same reads at the same block once a day and keeps the answer with the payment", async () => {
    const db = openDb(":memory:");
    const p = paid(db, answers);
    const r = await poolCheckIfDue(db, pub(), POOL, 100n, day, p, () => {});
    expect(r).toMatchObject({ day: "2026-11-08", block: "100", outcome: "match", cash: "5516000", totalAssets: "5516907", borrowRateBps: "2200", tx: "0xfee" });
    expect(p.asked[0].calls.every((c: any) => c.method === "eth_call" && c.params[1] === "0x64")).toBe(true);
    expect(p.asked[0].served).toEqual({ action: "A8_pool_check", block: "100" });
    expect(JSON.parse(getMeta(db, "poolcheck:last")!).outcome).toBe("match");
    expect(await poolCheckIfDue(db, pub(), POOL, 200n, day + 3_600_000, p, () => {})).toBeNull();
    expect(p.asked).toHaveLength(1);
    expect((await poolCheckIfDue(db, pub(), POOL, 300n, day + 86_400_000, p, () => {}))?.day).toBe("2026-11-09");
  });

  it("says mismatch when the outside node disagrees, and tries again later when it cannot answer", async () => {
    const db = openDb(":memory:");
    expect((await poolCheckIfDue(db, pub(), POOL, 100n, day, paid(db, [word(1), ...answers.slice(1)]), () => {}))?.outcome).toBe("mismatch");
    const db2 = openDb(":memory:");
    expect((await poolCheckIfDue(db2, pub(), POOL, 100n, day, paid(db2, null), () => {}))?.outcome).toBe("unavailable");
    expect(getMeta(db2, "poolcheck:last")).toBeUndefined();
  });

  it("does nothing without buy switched on", async () => {
    expect(await poolCheckIfDue(openDb(":memory:"), pub(), POOL, 100n, day, undefined, () => {})).toBeNull();
  });
});
