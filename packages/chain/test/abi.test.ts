import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatAbiItem } from "viem/utils";
import { creditBookAbi, gentleKeeperAbi, guardAbi, poolAbi, priceAbi } from "../src/contracts.ts";

const out = join(__dirname, "..", "..", "..", "contracts", "out");
const compiled = (name: string) => JSON.parse(readFileSync(join(out, `${name}.sol`, `${name}.json`), "utf8")).abi as any[];
// Needs the compiler's output (cd contracts && forge build). CI builds it first and sets REQUIRE_FORGE_OUT=1, so there
// a missing build fails instead of skipping.
const built = existsSync(join(out, "PesoPool.sol", "PesoPool.json"));
if (!built && process.env.REQUIRE_FORGE_OUT === "1") throw new Error("contracts/out is missing: run forge build");
if (!built) console.warn("ABI check skipped: run `cd contracts && forge build` first to compare the TypeScript ABIs with the compiler");

// Canonical shape of an item: name, input types, output types (tuples expanded) and which event fields are indexed.
const shape = (item: any) => {
  const t = (p: any): string => (p.type.startsWith("tuple") ? `(${p.components.map(t).join(",")})${p.type.slice(5)}` : p.type);
  return {
    type: item.type,
    name: item.name,
    inputs: item.inputs.map((p: any) => `${t(p)}${p.indexed ? " indexed" : ""}`),
    outputs: (item.outputs ?? []).map(t),
  };
};

for (const [name, ours] of [["PesoPool", poolAbi], ["LoanGuard", guardAbi], ["PriceModule", priceAbi], ["GentleKeeper", gentleKeeperAbi], ["CreditBook", creditBookAbi]] as const) {
  describe.skipIf(!built)(`${name} ABI matches the compiler`, () => {
    const theirs = built ? compiled(name) : [];
    for (const item of ours as readonly any[]) {
      it(formatAbiItem(item as any), () => {
        const match = theirs.find((c) => c.type === item.type && c.name === item.name && JSON.stringify(shape(c).inputs.map((s: string) => s.replace(" indexed", ""))) === JSON.stringify(shape(item).inputs.map((s: string) => s.replace(" indexed", ""))));
        expect(match, `no ${item.type} ${item.name} with these inputs in ${name}`).toBeTruthy();
        expect(shape(item)).toEqual(shape(match));
      });
    }
  });
}
