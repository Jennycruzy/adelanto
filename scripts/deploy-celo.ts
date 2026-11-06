// Deploys the Celo contracts with the attribution tag on every transaction, contract creation included.
// Each step is recorded in deployments/<network>.json as soon as it lands, and a step already recorded is never
// sent again: a rerun continues where the last one stopped instead of retrying a send that may have landed.
//
// Env: ATTRIBUTION_TAG, DEPLOYER_KEY_FILE, GUARDIAN_ADDRESS, AGENT_ADDRESS, TREASURY_ADDRESS,
//      CELO_RPC_URL (optional), DEPLOY_NETWORK (default "celo"; "celo-fork" for a local fork rehearsal).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { concatHex, encodeAbiParameters, formatEther, getAddress, parseAbi, type Address, type Hex } from "viem";
import { CELO, attributionCode, carriesCode, celoPublicClient, celoWalletClient } from "../packages/chain/src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const network = process.env.DEPLOY_NETWORK ?? "celo";
const recordPath = join(root, "deployments", `${network}.json`);

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const code = attributionCode();
const deployerKey = need("DEPLOYER_KEY_FILE");
const guardian = getAddress(need("GUARDIAN_ADDRESS"));
const agent = getAddress(need("AGENT_ADDRESS"));
const treasury = getAddress(need("TREASURY_ADDRESS"));

const MIN_WARS_DEPTH = 10_000_000n * 10n ** 18n;
const CAPS = { absolute: 20_000_000n * 10n ** 18n, depositsBps: 7_000, depthBps: 6_500 };

type Step = { address?: Address; tx: Hex; block: string; gasUsed: string; tagged: boolean };
type Record = { network: string; chainId: number; attributionCode: string; deployer: Address; steps: { [name: string]: Step } };

const pub = celoPublicClient();
const wallet = celoWalletClient(deployerKey, code);
const deployer = wallet.account.address;

const record: Record = existsSync(recordPath)
  ? JSON.parse(readFileSync(recordPath, "utf8"))
  : { network, chainId: CELO.chainId, attributionCode: code, deployer, steps: {} };
if (record.attributionCode !== code) throw new Error(`record was written with code ${record.attributionCode}, not ${code}`);
if (record.deployer !== deployer) throw new Error(`record was written by ${record.deployer}, not ${deployer}`);

function save() {
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
}

function artifact(name: string): Hex {
  const file = join(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  const json = JSON.parse(readFileSync(file, "utf8"));
  return json.bytecode.object as Hex;
}

async function confirm(name: string, hash: Hex): Promise<Step> {
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${name} reverted: ${hash}`);
  const tx = await pub.getTransaction({ hash });
  const tagged = carriesCode(tx.input, code);
  if (!tagged) throw new Error(`${name} landed without the attribution tag: ${hash}`);
  const step: Step = { tx: hash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), tagged };
  if (receipt.contractAddress) step.address = getAddress(receipt.contractAddress);
  record.steps[name] = step;
  save();
  console.log(`${name}: ${step.address ?? "call"} tx ${hash} gas ${receipt.gasUsed} tagged`);
  return step;
}

async function deploy(name: string, args: Hex = "0x"): Promise<Address> {
  const done = record.steps[name];
  if (done?.address) {
    console.log(`${name}: already at ${done.address}`);
    return done.address;
  }
  const data = concatHex([artifact(name), args]);
  // sendTransaction (not deployContract) so the attribution extension appends the tag to the init code.
  const hash = await wallet.sendTransaction({ data });
  return (await confirm(name, hash)).address!;
}

async function preflight() {
  const chainId = await pub.getChainId();
  if (chainId !== CELO.chainId) throw new Error(`connected to chain ${chainId}, not Celo`);
  const slot0 = await pub.readContract({
    address: CELO.uniswapWarsUsdt,
    abi: parseAbi(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"]),
    functionName: "slot0",
  });
  if (slot0[3] < 600) throw new Error(`Uniswap pool keeps ${slot0[3]} observations, need 600`);
  const balance = await pub.getBalance({ address: deployer });
  console.log(`network ${network}, deployer ${deployer}, ${formatEther(balance)} CELO, code ${code}, observations ${slot0[3]}`);
  if (balance === 0n) throw new Error("deployer has no CELO for gas");
}

await preflight();

const price = await deploy(
  "PriceModule",
  encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
    [CELO.uniswapWarsUsdt, CELO.wars, CELO.usdt, MIN_WARS_DEPTH],
  ),
);
const book = await deploy("CreditBook");
const pool = await deploy(
  "PesoPool",
  encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "tuple", components: [{ type: "uint128" }, { type: "uint16" }, { type: "uint16" }] },
    ],
    [CELO.wars, CELO.usdt, price, book, CELO.uniswapWarsUsdt, treasury, guardian, [CAPS.absolute, CAPS.depositsBps, CAPS.depthBps]],
  ),
);

if (!record.steps["CreditBook.bindPool"]) {
  const hash = await wallet.writeContract({
    address: book,
    abi: parseAbi(["function bindPool(address pool_)"]),
    functionName: "bindPool",
    args: [pool],
  });
  await confirm("CreditBook.bindPool", hash);
}

const guard = await deploy("LoanGuard", encodeAbiParameters([{ type: "address" }, { type: "address" }], [pool, agent]));

// Read back what the chain now holds.
const poolAbi = parseAbi([
  "function priceModule() view returns (address)",
  "function creditBook() view returns (address)",
  "function guardian() view returns (address)",
  "function treasury() view returns (address)",
  "function owner() view returns (address)",
  "function asset() view returns (address)",
]);
const read = (fn: "priceModule" | "creditBook" | "guardian" | "treasury" | "owner" | "asset") =>
  pub.readContract({ address: pool, abi: poolAbi, functionName: fn });
const checks: [string, Address, Address][] = [
  ["pool.priceModule", await read("priceModule"), price],
  ["pool.creditBook", await read("creditBook"), book],
  ["pool.guardian", await read("guardian"), guardian],
  ["pool.treasury", await read("treasury"), treasury],
  ["pool.owner", await read("owner"), deployer],
  ["pool.asset", await read("asset"), CELO.wars],
  ["book.pool", await pub.readContract({ address: book, abi: parseAbi(["function pool() view returns (address)"]), functionName: "pool" }), pool],
  ["guard.agent", await pub.readContract({ address: guard, abi: parseAbi(["function agent() view returns (address)"]), functionName: "agent" }), agent],
];
for (const [label, got, want] of checks) {
  if (getAddress(got) !== getAddress(want)) throw new Error(`${label} is ${got}, expected ${want}`);
}
console.log("all read-backs match");
console.log(JSON.stringify({ PRICE_ADDRESS: price, CREDITBOOK_ADDRESS: book, POOL_ADDRESS: pool, GUARD_ADDRESS: guard }, null, 2));
