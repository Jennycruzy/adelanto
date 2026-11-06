import { describe, expect, it } from "vitest";
import { MOVE_COST_USDT, perSecondToBps, rateWatch } from "../src/ratewatch.ts";

const WAD = 10n ** 18n;
const P = 1658n * WAD;
const DAY = 86_400n;

describe("A3 rate watch", () => {
  it("Morpho's 86,994,808 per second is 0.28% a year", () => {
    expect(perSecondToBps(86_994_808n)).toBe(28n);
  });
  it("a small 30-day loan is not worth moving", () => {
    // 100,000 pesos at 25% vs 0.28% for 30 days saves ~2,030 pesos; moving costs ~5,803
    const r = rateWatch(100_000n * WAD, 2_500n, 28n, 30n * DAY, P);
    expect(r.worthIt).toBe(false);
    expect(r.moveCost).toBe((MOVE_COST_USDT * P) / 1_000_000n);
  });
  it("a big 90-day loan is", () => {
    const r = rateWatch(1_000_000n * WAD, 2_500n, 28n, 90n * DAY, P);
    expect(r.save / WAD).toBe(60_953n);
    expect(r.worthIt).toBe(true);
  });
  it("never when the other market is dearer or the term is over", () => {
    expect(rateWatch(1_000_000n * WAD, 2_500n, 3_000n, 90n * DAY, P).worthIt).toBe(false);
    expect(rateWatch(1_000_000n * WAD, 2_500n, 28n, 0n, P).worthIt).toBe(false);
  });
});
