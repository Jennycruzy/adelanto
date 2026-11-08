import { describe, expect, it } from "vitest";
import { pivotPrices, thin } from "../src/data.ts";
import { priceChart } from "../src/views.ts";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    { source: "uniswap_twap30", value: 1650 + i, observed_at: 1000 + i * 60_000 },
    { source: "uniswap_spot", value: 9999, observed_at: 1000 + i * 60_000 },
    { source: "binance", value: 1660 + i, observed_at: 1000 + i * 60_000 },
    ...(i % 2 ? [] : [{ source: "dolarapi", value: 1655, observed_at: 1000 + i * 60_000 }]),
  ]).flat();

describe("price history from the agent's readings", () => {
  it("makes one point per reading, oldest first, and ignores the spot price", () => {
    const p = pivotPrices(rows(3).reverse());
    expect(p.map((x) => x.t)).toEqual([1000, 61_000, 121_000]);
    expect(p[0]).toEqual({ t: 1000, pool: 1650, binance: 1660, dolarapi: 1655 });
    expect(p[1].dolarapi).toBeNull();
  });

  it("drops readings that lack the pool or Binance", () => {
    const p = pivotPrices([{ source: "uniswap_twap30", value: 1650, observed_at: 1 }, { source: "binance", value: 1660, observed_at: 2 }]);
    expect(p).toEqual([]);
  });

  it("thins evenly and always keeps the newest point", () => {
    const all = Array.from({ length: 1000 }, (_, i) => i);
    const t = thin(all, 100);
    expect(t.length).toBe(100);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(999);
    expect(thin([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});

describe("price chart", () => {
  it("draws nothing from fewer than ten readings", () => {
    expect(priceChart("es", pivotPrices(rows(9)))).toBe("");
  });

  it("states the real largest gaps and the pause rule", () => {
    const out = String(priceChart("en", pivotPrices(rows(20))));
    // Binance gap is largest first (1650 vs 1660 = 0.60%); dolarapi last with a reading (i=18: 1668 vs 1655 = 0.79%)
    expect(out).toContain("<b>0.60%</b> from Binance");
    expect(out).toContain("<b>0.79%</b> from dolarapi");
    expect(out).toContain("more than 1.5% from every source for 3 minutes");
    expect(out).toContain('class="l-pool"');
  });
});
