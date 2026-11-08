// Shared by the verify and evidence scripts: our addresses, our wallets' labels, and every event of the pool, the
// guard and the gentle keeper since deployment, read from Celo alone.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEventLog, getAddress, type Address, type Hex, type Log, type PublicClient } from "viem";
import { gentleKeeperAbi, guardAbi, poolAbi } from "../../packages/chain/src/index.ts";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dep = JSON.parse(readFileSync(join(root, "deployments", "celo.json"), "utf8"));
export const wallets: { address: string; label: string; role: string }[] = JSON.parse(readFileSync(join(root, "deployments", "wallets.json"), "utf8")).wallets;
export const label = (a: string) => wallets.find((w) => getAddress(w.address) === getAddress(a))?.label ?? "USER";
export const roleOf = (a: string) => wallets.find((w) => getAddress(w.address) === getAddress(a))?.role ?? null;
const at = (n: string) => getAddress(dep.steps[n].address as string);
export const POOL = at("PesoPool");
export const GUARD = at("LoanGuard");
export const KEEPER: Address | null = dep.steps.GentleKeeper ? at("GentleKeeper") : null;
export const CREDIT_BOOK = at("CreditBook");
export const FROM_BLOCK = BigInt(dep.steps.PriceModule.block);
export const AGENT = getAddress("0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1");

export type Ev = { name: string; args: any; tx: Hex; block: bigint; logIndex: number; contract: Address };

async function logsSince(pub: PublicClient, addresses: Address[], from: bigint, head: bigint): Promise<Log[]> {
  const out: Log[] = [];
  let step = 20_000n;
  for (let start = from; start <= head; ) {
    const end = start + step - 1n > head ? head : start + step - 1n;
    try {
      out.push(...(await pub.getLogs({ address: addresses, fromBlock: start, toBlock: end })));
      start = end + 1n;
    } catch (e) {
      if (step <= 500n) throw e;
      step /= 2n; // the node limits the range: halve and retry
    }
  }
  return out;
}

const abis = [poolAbi, guardAbi, gentleKeeperAbi] as const;
function decode(l: Log): Ev | null {
  for (const abi of abis) {
    try {
      const d = decodeEventLog({ abi, data: l.data, topics: l.topics }) as any;
      return { name: d.eventName, args: d.args, tx: l.transactionHash!, block: l.blockNumber!, logIndex: l.logIndex!, contract: getAddress(l.address) };
    } catch {
      /* try the next ABI */
    }
  }
  return null;
}

/** Every event of our contracts from deployment to `head`, in chain order. */
export async function allEvents(pub: PublicClient, head: bigint): Promise<Ev[]> {
  const evs = (await logsSince(pub, [POOL, GUARD, ...(KEEPER ? [KEEPER] : [])], FROM_BLOCK, head)).map(decode).filter((e): e is Ev => e !== null);
  return evs.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : Number(a.block - b.block)));
}

export const AGENT_EVENTS = new Set(["AutoRepaid", "ProtectedByRepay", "Protected"]);
