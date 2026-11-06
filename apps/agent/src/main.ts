// Entry point. Watch-only unless AGENT_MODE=live: in watch mode the agent reads, decides and logs everything and
// sends nothing. Env: ATTRIBUTION_TAG, AGENT_KEY_FILE, GUARDIAN_KEY_FILE (optional), DB_PATH, AGENT_MODE,
// CELO_RPC_URL(_2), TICK_SECONDS (default 60), OURS_ADDRESSES / JUDGE_ADDRESSES (comma separated).
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getAddress } from "viem";
import { TaggedSender, attributionCode, celoDeployment, celoPublicClient, ethPublicClient, gentleKeeperAbi } from "@adelanto/chain";
import { Agent, type Mode } from "./agent.ts";
import { holdLock, openDb, setMeta } from "./db.ts";

const mode: Mode = process.env.AGENT_MODE === "live" ? "live" : "watch";
const code = attributionCode();
const deployment = celoDeployment(process.env.DEPLOYMENT_FILE);
if (deployment.attributionCode !== code) throw new Error("ATTRIBUTION_TAG differs from the code the contracts were deployed with");
const pub = celoPublicClient();
const keyFile = process.env.AGENT_KEY_FILE;
if (!keyFile) throw new Error("AGENT_KEY_FILE is required");
const keeper = new TaggedSender(keyFile, pub, code);
const guardian = process.env.GUARDIAN_KEY_FILE ? new TaggedSender(process.env.GUARDIAN_KEY_FILE, pub, code) : undefined;
const dbPath = process.env.DB_PATH ?? join(homedir(), "adelanto-data", "agent.sqlite");
// One agent per database and per signing wallet, held by the OS for the life of the process (before anything opens).
const unlockDb = holdLock(dirname(dbPath), `db-${basename(dbPath)}`);
const unlockKey = holdLock(join(homedir(), "adelanto-data"), `wallet-${keeper.address}`);
const db = openDb(dbPath);

const labels = new Map<string, string>();
for (const a of (process.env.OURS_ADDRESSES ?? "").split(",").filter(Boolean)) labels.set(getAddress(a.trim()), "OURS");
for (const a of (process.env.JUDGE_ADDRESSES ?? "").split(",").filter(Boolean)) labels.set(getAddress(a.trim()), "JUDGE");
labels.set(keeper.address, "OURS");

const agent = new Agent({
  db,
  pub,
  addresses: { pool: deployment.pool, guard: deployment.guard, priceModule: deployment.priceModule, deployBlock: deployment.deployBlock, gentleKeeper: deployment.gentleKeeper },
  mode,
  keeper,
  guardian,
  eth: ethPublicClient(),
  labels,
});
// GentleKeeper only accepts calls from the agent it was deployed for: refuse to run live against any other.
if (deployment.gentleKeeper) {
  const k = await pub.readContract({ address: deployment.gentleKeeper, abi: gentleKeeperAbi, functionName: "agent" });
  if (getAddress(k) !== keeper.address) {
    if (mode === "live") throw new Error(`GentleKeeper ${deployment.gentleKeeper} answers to ${k}, not to this agent ${keeper.address}`);
    console.log(`warning: GentleKeeper answers to ${k}, not ${keeper.address}`);
  }
}
setMeta(db, "mode", mode);
console.log(`agent ${keeper.address} mode=${mode} guardian=${guardian?.address ?? "none"} pool=${deployment.pool}`);

const tickMs = Number(process.env.TICK_SECONDS ?? 60) * 1000;
const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

// A4 samples prices once a minute on its own loop, so a long loan loop can never leave gaps in its readings.
const priceLoop = (async () => {
  while (!stopping && !once) {
    const started = Date.now();
    try {
      await agent.priceTick();
    } catch (e: any) {
      console.error(`price tick failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, Math.max(5_000, 60_000 - (Date.now() - started))));
  }
})();
if (once) await agent.priceTick();

for (;;) {
  const started = Date.now();
  try {
    await agent.tick();
  } catch (e: any) {
    console.error(`tick failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 400)}`);
  }
  if (once || stopping) break;
  const wait = Math.max(5_000, tickMs - (Date.now() - started));
  await new Promise((r) => setTimeout(r, wait));
  if (stopping) break;
}
await priceLoop;
db.close();
unlockDb();
unlockKey();
