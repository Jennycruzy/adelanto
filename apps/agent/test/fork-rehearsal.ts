// End-to-end rehearsal of the agent against a local fork of Celo mainnet (anvil --fork-url ... --port 8548).
// A test borrower takes a real loan in the deployed pool; fork time moves forward until interest pushes the loan
// past 70% and then 80%; the agent, in live mode on the fork, must protect it (A1), repay arriving pesos (A2),
// liquidate gently (A5), resume a signed-but-unsent transaction after a "crash", and never act twice.
// Safety: before anything is signed, the agent wallet's nonce on the fork is set to 1,000,000, so no transaction
// signed here can ever be valid on mainnet.
//   FORK_RPC=http://127.0.0.1:8548 AGENT_KEY_FILE=... ATTRIBUTION_TAG=... node apps/agent/test/fork-rehearsal.ts
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const FORK = process.env.FORK_RPC ?? "http://127.0.0.1:8548";
process.env.CELO_RPC_URL = FORK; // every client in the packages below talks to the fork only
delete process.env.CELO_RPC_URL_2;

const { CELO, TaggedSender, attributionCode, celoDeployment, guardAbi, poolAbi } = await import("@adelanto/chain");
const { Agent } = await import("../src/agent.ts");
const { openDb } = await import("../src/db.ts");

const pub = createPublicClient({ chain: celo, transport: http(FORK) }) as unknown as PublicClient;
const rpc = (method: string, params: unknown[]) => (pub as any).request({ method, params });
const chainId = await pub.getChainId();
assert.equal(chainId, 42220);
const head = await pub.getBlockNumber();
const local = await rpc("anvil_nodeInfo", []).catch(() => null);
assert.ok(local, "FORK_RPC must be a local anvil fork");

const code = attributionCode();
const dep = celoDeployment();
const keeper = new TaggedSender(process.env.AGENT_KEY_FILE!, pub, code);
await rpc("anvil_setNonce", [keeper.address, "0xF4240"]); // 1,000,000
assert.equal(await pub.getTransactionCount({ address: keeper.address }), 1_000_000);

// Test borrower: anvil's first well-known key. Funded on the fork only, from the Uniswap pool's balances.
const borrowerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const borrower = privateKeyToAccount(borrowerKey);
const bw = createWalletClient({ account: borrower, chain: celo, transport: http(FORK) });
const UNI = CELO.uniswapWarsUsdt;
await rpc("anvil_setBalance", [borrower.address, "0x56BC75E2D63100000"]); // 100 CELO
await rpc("anvil_setBalance", [UNI, "0x56BC75E2D63100000"]);
await rpc("anvil_impersonateAccount", [UNI]);
const fromUni = async (token: Address, to: Address, amount: bigint) => {
  const hash = await rpc("eth_sendTransaction", [{ from: UNI, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) }]);
  await pub.waitForTransactionReceipt({ hash });
};
await fromUni(CELO.usdt, borrower.address, parseUnits("5", 6));
await fromUni(CELO.wars, borrower.address, parseEther("1000"));

const mine = async (n = 1) => { for (let i = 0; i < n; i++) await rpc("evm_mine", []); };
const warp = async (sec: number) => { await rpc("evm_increaseTime", [sec]); await mine(3); };
const bsend = async (to: Address, abi: any, functionName: string, args: any[]) => {
  const hash = await bw.writeContract({ address: to, abi, functionName, args } as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", `${functionName} reverted`);
  return r;
};
const read = (address: Address, abi: any, functionName: string, args: any[] = []) => pub.readContract({ address, abi, functionName, args } as any) as Promise<any>;
const ltv = (id: bigint) => read(dep.pool, poolAbi, "loanLtvBps", [id]) as Promise<bigint>;

// GentleKeeper is deployed on the fork from the test borrower (any account works; only the agent can call it).
const { readFileSync } = await import("node:fs");
const gk = JSON.parse(readFileSync(new URL("../../../contracts/out/GentleKeeper.sol/GentleKeeper.json", import.meta.url), "utf8"));
const gkHash = await bw.deployContract({ abi: gk.abi, bytecode: gk.bytecode.object, args: [dep.pool, keeper.address] } as any);
const gentleKeeper = (await pub.waitForTransactionReceipt({ hash: gkHash })).contractAddress!;
console.log(`   GentleKeeper on the fork: ${gentleKeeper}`);

const dbPath = join(tmpdir(), `adelanto-fork-${process.pid}.sqlite`);
rmSync(dbPath, { force: true }); rmSync(dbPath + "-wal", { force: true }); rmSync(dbPath + "-shm", { force: true });
const db = openDb(dbPath);
const logs: string[] = [];
const agent = (mode: "watch" | "live") =>
  new Agent({ db, pub, addresses: { ...dep, gentleKeeper }, mode, keeper, labels: new Map(), log: (s) => { logs.push(s); console.log("   agent:", s); } });
const step = (s: string) => console.log(`\n== ${s}`);
const actions = () => db.prepare("SELECT id, job, status, tx, sentence_es FROM agent_actions ORDER BY id").all() as any[];

// ---------------------------------------------------------------- borrow near 60%
step("borrow 1,000 wARS near 60%");
const price = (await read(dep.priceModule, parseAbi(["function borrowPrice() view returns (uint256)"]), "borrowPrice")) as bigint;
const collateral = (1000n * 10n ** 18n * 10n ** 6n * 10_000n) / (5_950n * price) + 1n;
await bsend(CELO.usdt, erc20Abi, "approve", [dep.pool, collateral]);
const br = await bsend(dep.pool, poolAbi, "borrow", [collateral, parseEther("1000"), 7, 9_000n]);
const loanId = parseEventLogs({ abi: poolAbi, logs: br.logs, eventName: "Borrowed" })[0].args.loanId;
console.log(`   loan ${loanId}: ${formatUnits(collateral, 6)} USDT, ltv ${await ltv(loanId)}`);

// ---------------------------------------------------------------- guard on, then interest past 70%
step("borrower signs limits: dollars first, US$ 1/day, 2,000 wARS/day, auto-repay on");
let days = 0;
while ((await ltv(loanId)) < 7_000n) { await warp(15 * 86_400); days += 15; }
const now1 = (await pub.getBlock()).timestamp;
const limits = { autoRepay: true, rateWatch: false, protectOrder: 0, expiry: now1 + 30n * 86_400n, keepWarsBuffer: parseEther("100"), maxRepayWarsPerDay: parseEther("2000"), maxTopUpUsdtPerDay: parseUnits("1", 6), maxRateBps: 9_000 };
await bsend(dep.guard, guardAbi, "setLimits" as any, [limits, "0x" + "11".repeat(32)]);
await bsend(CELO.usdt, erc20Abi, "approve", [dep.guard, parseUnits("3", 6)]);
await bsend(CELO.wars, erc20Abi, "approve", [dep.guard, parseEther("5000")]);
await mine(3);
const ltvAtRisk = await ltv(loanId);
console.log(`   after ${days} days of interest: ltv ${ltvAtRisk}`);
assert.ok(ltvAtRisk >= 7_000n);

step("watch mode first: decides, logs, sends nothing");
const nonce0 = await pub.getTransactionCount({ address: keeper.address });
await agent("watch").tick();
assert.equal(await pub.getTransactionCount({ address: keeper.address }), nonce0, "watch mode must not send");
assert.ok(actions().some((a) => a.job === "A1_protect" && a.status === "watch_only"));

step("A1 live: protect back to 60% with the borrower's dollars");
const usdtBefore = await read(CELO.usdt, erc20Abi, "balanceOf", [borrower.address]);
await agent("live").tick();
const a1 = actions().filter((a) => a.job === "A1_protect" && a.status === "landed");
assert.equal(a1.length, 1, "exactly one protect");
const ltvAfterA1 = await ltv(loanId);
const usdtSpent = usdtBefore - (await read(CELO.usdt, erc20Abi, "balanceOf", [borrower.address]));
console.log(`   tx ${a1[0].tx}: added ${formatUnits(usdtSpent, 6)} USDT, ltv ${ltvAtRisk} -> ${ltvAfterA1}`);
console.log(`   es: ${a1[0].sentence_es}`);
assert.ok(ltvAfterA1 <= 6_000n, "back to 60%");
assert.ok(usdtSpent <= parseUnits("1", 6), "inside the daily dollar cap");

step("second tick: nothing more to do");
await mine(3);
await agent("live").tick();
assert.equal(actions().filter((a) => a.job === "A1_protect" && a.status === "landed").length, 1, "no second protect");

// ---------------------------------------------------------------- pesos arrive -> auto-repay
step("A2: 800 wARS arrive from outside; agent repays, keeping the 100 wARS buffer");
const debtBefore = (await read(dep.pool, poolAbi, "debtOf", [loanId])) as bigint;
await fromUni(CELO.wars, borrower.address, parseEther("800"));
await mine(40); // the indexer follows the safe head (32 blocks behind on anvil)
await agent("live").tick();
const a2 = actions().filter((a) => a.job === "A2_autorepay" && a.status === "landed");
assert.equal(a2.length, 1, "one auto-repay");
const debtAfter = (await read(dep.pool, poolAbi, "debtOf", [loanId])) as bigint;
console.log(`   tx ${a2[0].tx}: debt ${formatEther(debtBefore)} -> ${formatEther(debtAfter)}`);
console.log(`   es: ${a2[0].sentence_es}`);
assert.ok(debtBefore - debtAfter >= parseEther("799") && debtBefore - debtAfter <= parseEther("801"));
await agent("live").tick(); // right after: the index has not seen the repayment yet, so A2 must wait, not repeat
await mine(40);
await agent("live").tick(); // the index now has the repayment: credit is 0
assert.equal(actions().filter((a) => a.job === "A2_autorepay" && a.status === "landed").length, 1, "an arrival is repaid once");

// ---------------------------------------------------------------- crash after signing, before broadcast
step("restart safety: a signed transaction saved before a crash is sent exactly once");
const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [dep.pool, 1n] });
const signed = await keeper.prepare(CELO.wars, approveData);
db.prepare("INSERT INTO agent_actions (job, trigger_json, inputs_json, decision, mode, status, tx, at) VALUES ('approve', '{}', '{}', '{}', 'live', 'signed', ?, ?)").run(signed.hash, Date.now());
const aid = Number((db.prepare("SELECT MAX(id) AS id FROM agent_actions").get() as any).id);
db.prepare("INSERT INTO pending_tx (hash, action_id, from_addr, nonce, to_addr, data, raw, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?)").run(signed.hash, aid, signed.from, signed.nonce, signed.to, signed.data, signed.raw, Date.now());
const nonceW = await pub.getTransactionCount({ address: keeper.address });
await agent("watch").tick(); // watch mode after a crash: reports, never sends
assert.equal((db.prepare("SELECT status FROM pending_tx WHERE hash = ?").get(signed.hash) as any).status, "signed");
assert.equal(await pub.getTransactionCount({ address: keeper.address }), nonceW, "watch mode must not broadcast");
console.log("   watch mode left the signed transaction unsent");
await agent("live").tick(); // a new live agent instance, as after a restart
const p = db.prepare("SELECT status FROM pending_tx WHERE hash = ?").get(signed.hash) as any;
assert.equal(p.status, "landed");
const tx = await pub.getTransaction({ hash: signed.hash });
assert.equal(tx.nonce, signed.nonce);
console.log(`   resumed ${signed.hash} at nonce ${signed.nonce}: landed once`);

// ---------------------------------------------------------------- past 80% -> gentle liquidation
step("A5: guard revoked, interest past 80%, the agent liquidates gently back to 78% through GentleKeeper");
await bsend(dep.guard, guardAbi, "revoke" as any, []);
while ((await ltv(loanId)) <= 8_000n) await warp(15 * 86_400);
await mine(3);
// First with too few pesos in the keeper: it repays what it has and says so plainly.
const keeperWars = (await read(CELO.wars, erc20Abi, "balanceOf", [keeper.address])) as bigint;
const send = async (to: Address, amount: bigint) => {
  await rpc("anvil_impersonateAccount", [keeper.address]);
  const hash = await rpc("eth_sendTransaction", [{ from: keeper.address, to: CELO.wars, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) }]);
  await pub.waitForTransactionReceipt({ hash });
  await rpc("anvil_stopImpersonatingAccount", [keeper.address]);
};
await send(borrower.address, keeperWars - parseEther("100")); // keeper keeps 100 wARS
await mine(3);
const ltvLiq = await ltv(loanId);
await agent("live").tick();
let a5 = actions().filter((a) => a.job === "A5_liquidate" && a.status === "landed");
assert.equal(a5.length, 1, "one liquidation");
const ltvPartial = await ltv(loanId);
console.log(`   short keeper (100 wARS) tx ${a5[0].tx}: ltv ${ltvLiq} -> ${ltvPartial}`);
console.log(`   es: ${a5[0].sentence_es}`);
assert.ok(ltvPartial < ltvLiq);
assert.match(a5[0].sentence_es, /todo lo que el agente tenía/);

// Then with enough pesos: the next liquidation brings it back to 78% at most.
while ((await ltv(loanId)) <= 8_000n) await warp(5 * 86_400);
await fromUni(CELO.wars, keeper.address, parseEther("5000"));
await mine(3);
const ltvLiq2 = await ltv(loanId);
await agent("live").tick();
a5 = actions().filter((a) => a.job === "A5_liquidate" && a.status === "landed");
assert.equal(a5.length, 2, "second liquidation");
const loanAfter = await read(dep.pool, poolAbi, "loans", [loanId]);
const ltvAfterA5 = loanAfter.open ? await ltv(loanId) : 0n;
console.log(`   funded keeper tx ${a5[1].tx}: ltv ${ltvLiq2} -> ${loanAfter.open ? ltvAfterA5 : "closed"}`);
console.log(`   es: ${a5[1].sentence_es}`);
assert.ok(!loanAfter.open || ltvAfterA5 <= 7_800n);
assert.equal(await read(CELO.wars, erc20Abi, "balanceOf", [gentleKeeper]), 0n, "nothing left in GentleKeeper");
assert.match(a5[1].sentence_es, /lo mínimo para volver al 78%/);

// ---------------------------------------------------------------- past 80% WITH a guard: protection beats a sale
step("N3: a guarded loan past 80% gets the borrower's own protection, not a liquidation");
await fromUni(CELO.usdt, borrower.address, parseUnits("5", 6));
const price2 = (await read(dep.priceModule, parseAbi(["function borrowPrice() view returns (uint256)"]), "borrowPrice")) as bigint;
const coll2 = (1000n * 10n ** 18n * 10n ** 6n * 10_000n) / (5_950n * price2) + 1n;
await bsend(CELO.usdt, erc20Abi, "approve", [dep.pool, coll2]);
const br2 = await bsend(dep.pool, poolAbi, "borrow", [coll2, parseEther("1000"), 7, 9_000n]);
const loan2 = parseEventLogs({ abi: poolAbi, logs: br2.logs, eventName: "Borrowed" })[0].args.loanId;
while ((await ltv(loan2)) <= 8_000n) await warp(15 * 86_400);
const now2 = (await pub.getBlock()).timestamp;
await bsend(dep.guard, guardAbi, "setLimits" as any, [{ ...limits, expiry: now2 + 30n * 86_400n, maxTopUpUsdtPerDay: parseUnits("2", 6), autoRepay: false }, "0x" + "22".repeat(32)]);
await bsend(CELO.usdt, erc20Abi, "approve", [dep.guard, parseUnits("10", 6)]);
await mine(3);
const ltv2 = await ltv(loan2);
const liqBefore = actions().filter((a) => a.job === "A5_liquidate" && a.status === "landed").length;
await agent("live").tick();
const a1b = actions().filter((a) => a.job === "A1_protect" && a.status === "landed" && a.tx);
assert.equal(actions().filter((a) => a.job === "A5_liquidate" && a.status === "landed").length, liqBefore, "no sale while the borrower's dollars can protect it");
assert.ok((await ltv(loan2)) < ltv2, "protection lowered it");
console.log(`   loan ${loan2}: ltv ${ltv2} -> ${await ltv(loan2)} with the borrower's dollars (tx ${a1b[a1b.length - 1].tx}); no liquidation`);

// ---------------------------------------------------------------- a stuck transaction is replaced, never re-sent
step("N4: a signed transaction stuck over 10 minutes is replaced at its nonce, so the old decision can never land");
const stuck = await keeper.prepare(CELO.wars, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [dep.pool, 7n] }));
db.prepare("INSERT INTO agent_actions (job, trigger_json, inputs_json, decision, mode, status, tx, at) VALUES ('approve', '{}', '{}', '{}', 'live', 'signed', ?, ?)").run(stuck.hash, Date.now());
const sid = Number((db.prepare("SELECT MAX(id) AS id FROM agent_actions").get() as any).id);
db.prepare("INSERT INTO pending_tx (hash, action_id, from_addr, nonce, to_addr, data, raw, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?)").run(stuck.hash, sid, stuck.from, stuck.nonce, stuck.to, stuck.data, stuck.raw, Date.now() - 11 * 60_000);
await agent("live").tick();
assert.equal((db.prepare("SELECT status FROM pending_tx WHERE hash = ?").get(stuck.hash) as any).status, "replaced");
const replacement = db.prepare("SELECT hash, status FROM pending_tx WHERE nonce = ? AND hash <> ?").get(stuck.nonce, stuck.hash) as any;
assert.equal(replacement.status, "landed");
const late = await pub.sendRawTransaction({ serializedTransaction: stuck.raw }).then(() => "accepted", (e: any) => String(e?.details ?? e?.shortMessage ?? e));
assert.match(late, /nonce/i, "the old bytes can no longer land");
console.log(`   ${stuck.hash} replaced by ${replacement.hash} at nonce ${stuck.nonce}; the old bytes are refused (${late.slice(0, 40)})`);

// ---------------------------------------------------------------- every agent transaction tagged
step("every agent transaction on the fork carries the attribution code");
const { carriesCode } = await import("@adelanto/chain");
for (const r of db.prepare("SELECT hash FROM pending_tx WHERE status = 'landed'").all() as any[]) {
  const t = await pub.getTransaction({ hash: r.hash });
  assert.ok(carriesCode(t.input, code), `untagged ${r.hash}`);
}
console.log(`   ${actions().filter((a) => a.status === "landed").length} landed, all tagged`);
console.log("\nREHEARSAL PASSED");
db.close();
