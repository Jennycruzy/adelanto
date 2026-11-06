import { describe, expect, it } from "vitest";
import { chainToNumber, verdict, type Quote, type Reading } from "../src/index.ts";

const q = (source: Quote["source"], v: number): Quote => ({ source, pesosPerDollar: v, fetchedAt: 0, raw: null });
const MIN = 60_000;
const NOW = 1_000 * MIN;
// one reading a minute, oldest first, ending now
const series = (n: number, make: (i: number) => Omit<Reading, "at">): Reading[] =>
  Array.from({ length: n }, (_, i) => ({ at: NOW - (n - 1 - i) * MIN, ...make(i) }));

describe("pause and resume", () => {
  it("holds on normal days (the 10-hour log never passed 0.74%)", () => {
    const rs = series(10, () => ({ chain: 1656.3, quotes: [q("binance", 1665.5), q("dolarapi", 1652.8)] }));
    expect(verdict(rs, NOW, false, false).action).toBe("hold");
  });
  it("pauses when the chain disagrees with every source for 3 minutes", () => {
    const rs = series(5, () => ({ chain: 1600, quotes: [q("binance", 1665), q("dolarapi", 1660)] }));
    expect(verdict(rs, NOW, false, false)).toMatchObject({ action: "pause" });
  });
  it("does not pause on one bad feed", () => {
    const rs = series(5, () => ({ chain: 1656, quotes: [q("binance", 1800), q("dolarapi", 1655)] }));
    expect(verdict(rs, NOW, false, false).action).toBe("hold");
  });
  it("does not pause on a 2-minute blip", () => {
    const rs = series(5, (i) => ({ chain: i >= 3 ? 1600 : 1656, quotes: [q("binance", 1665)] }));
    expect(verdict(rs, NOW, false, false).action).toBe("hold");
  });
  it("does not pause before 3 minutes of readings exist", () => {
    const rs = series(2, () => ({ chain: 1600, quotes: [q("binance", 1665)] }));
    expect(verdict(rs, NOW, false, false).action).toBe("hold");
  });
  it("pauses when both sources are down for 10 minutes", () => {
    const rs = series(11, () => ({ chain: 1656, quotes: [] }));
    expect(verdict(rs, NOW, false, false)).toMatchObject({ action: "pause" });
  });
  it("resumes only its own pause, after 10 minutes of agreement", () => {
    const ok = series(11, () => ({ chain: 1656, quotes: [q("binance", 1660)] }));
    expect(verdict(ok, NOW, true, true).action).toBe("resume");
    expect(verdict(ok, NOW, false, true).action).toBe("hold"); // someone else paused: leave it
    const mixed = series(11, (i) => ({ chain: i === 6 ? 1600 : 1656, quotes: [q("binance", 1660)] }));
    expect(verdict(mixed, NOW, true, true).action).toBe("hold");
  });
  it("converts the chain price", () => {
    expect(chainToNumber(1656201701372096371684n)).toBeCloseTo(1656.2017, 3);
  });
});
