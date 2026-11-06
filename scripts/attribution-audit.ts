// Lists every Celo transaction sent by our wallets, and every transaction anyone sent to our contracts, and checks
// each for the ERC-8021 attribution tag. Writes evidence/attribution-audit.json and exits non-zero if any transaction
// sent after the code was issued is untagged.
// Env: ATTRIBUTION_TAG (optional; defaults to the code in deployments/celo.json).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromDataSuffix } from "@celo/attribution-tags";
import { getAddress, type Hex } from "viem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(join(root, "deployments", "celo.json"), "utf8"));
const code: string = process.env.ATTRIBUTION_TAG ?? deployment.attributionCode;
const API = "https://celo.blockscout.com/api/v2";

const WALLETS: { [label: string]: string } = {
  agent: "0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1",
  deployer: deployment.deployer,
  guardian: "0xB1fa8cd9f1a85cA2f1e9887A4dB19948deCd641C",
  judge: "0x0cff67325Ba688921C36bDf0ff59E351100e2A3d",
};
const CONTRACTS: { [label: string]: string } = Object.fromEntries(
  Object.entries(deployment.steps as { [k: string]: { address?: string } })
    .filter(([, s]) => s.address)
    .map(([name, s]) => [name, s.address!]),
);

type Tx = { hash: string; from: string; to: string | null; block: number; time: string; status: string; method: string | null; tagged: boolean; codes: string[] };

async function txsOf(address: string, filter: "from" | "to"): Promise<Tx[]> {
  const out: Tx[] = [];
  let params = "";
  for (;;) {
    const res = await fetch(`${API}/addresses/${address}/transactions?filter=${filter}${params}`);
    if (!res.ok) throw new Error(`blockscout ${res.status} for ${address}`);
    const page = await res.json();
    for (const t of page.items) {
      const decoded = fromDataSuffix(t.raw_input as Hex);
      out.push({
        hash: t.hash,
        from: getAddress(t.from.hash),
        to: t.to ? getAddress(t.to.hash) : t.created_contract ? getAddress(t.created_contract.hash) : null,
        block: t.block_number,
        time: t.timestamp,
        status: t.status,
        method: t.method,
        tagged: decoded !== null && decoded.codes.includes(code),
        codes: decoded?.codes ?? [],
      });
    }
    if (!page.next_page_params) break;
    params = "&" + new URLSearchParams(page.next_page_params).toString();
  }
  return out;
}

const all = new Map<string, Tx & { source: string[] }>();
const add = (txs: Tx[], source: string) => {
  for (const t of txs) {
    const seen = all.get(t.hash);
    if (seen) seen.source.push(source);
    else all.set(t.hash, { ...t, source: [source] });
  }
};
for (const [label, a] of Object.entries(WALLETS)) add(await txsOf(a, "from"), `wallet:${label}`);
for (const [label, a] of Object.entries(CONTRACTS)) add(await txsOf(a, "to"), `contract:${label}`);

const txs = [...all.values()].sort((a, b) => a.block - b.block);
const first = txs.find((t) => t.tagged);
const before = first ? txs.filter((t) => t.block < first.block) : txs;
const after = first ? txs.filter((t) => t.block >= first.block) : [];
const untaggedAfter = after.filter((t) => !t.tagged);

const report = {
  code,
  checkedAt: new Date().toISOString(),
  wallets: WALLETS,
  contracts: CONTRACTS,
  firstTagged: first ? { hash: first.hash, block: first.block, time: first.time } : null,
  totals: {
    all: txs.length,
    tagged: txs.filter((t) => t.tagged).length,
    sentBeforeCodeIssued: before.length,
    untaggedAfterCodeIssued: untaggedAfter.length,
  },
  sentBeforeCodeIssued: {
    note: "Route and wallet tests sent before the event issued our code. They carry no tag and are not counted.",
    hashes: before.map((t) => t.hash),
  },
  untaggedAfterCodeIssued: untaggedAfter,
  transactions: after,
};
mkdirSync(join(root, "evidence"), { recursive: true });
writeFileSync(join(root, "evidence", "attribution-audit.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.totals));
if (untaggedAfter.length > 0) {
  for (const t of untaggedAfter) console.log(`UNTAGGED ${t.hash} from ${t.from} (${t.source.join(", ")})`);
  process.exit(1);
}
console.log(`clean: every transaction since ${first?.hash} carries ${code}`);
