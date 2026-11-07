import { describe, expect, it } from "vitest";
import { MAX_INDEX_LAG, indexHead } from "../src/indexer.ts";

describe("indexHead", () => {
  it("uses the safe head when it is recent", () => {
    expect(indexHead(1_000_000n, 999_990n)).toBe(999_990n);
  });
  it("never stays more than 10 minutes behind the tip when the safe head stalls", () => {
    // seen on Celo mainnet: safe 81,817,229 against tip 82,152,748
    expect(indexHead(82_152_748n, 81_817_229n)).toBe(82_152_748n - MAX_INDEX_LAG);
  });
  it("falls back to 10 minutes behind when the node has no safe head", () => {
    expect(indexHead(5_000n, null)).toBe(4_400n);
  });
  it("does not go below block 0 on a young chain", () => {
    expect(indexHead(100n, null)).toBe(0n);
  });
});
