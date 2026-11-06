// Checks on a local fork of Celo mainnet that the permit the browser code builds is accepted by the real tokens and
// the deployed pool: borrowWithPermit with a USDT permit, then repayWithPermit with a wARS permit for the whole debt.
//   FORK_RPC=http://127.0.0.1:8548 node apps/web/test/permit-fork.ts
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseAbi, parseEther, parseEventLogs, parseSignature, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { permitTypedData } from "../client/permit.ts";

const FORK = process.env.FORK_RPC ?? "http://127.0.0.1:8548";
process.env.CELO_RPC_URL = FORK;
const { CELO, celoDeployment, poolAbi } = await import("@adelanto/chain");
const dep = celoDeployment();
const pub = createPublicClient({ chain: celo, transport: http(FORK) });
const rpc = (method: string, params: unknown[]) => (pub as any).request({ method, params });
assert.ok(await rpc("anvil_nodeInfo", []).catch(() => null), "FORK_RPC must be a local anvil fork");

// A fresh key: anvil's well-known keys carry EIP-7702 delegations on Celo mainnet, which Tether's permit treats as
// contract wallets (ERC-1271), so they can't sign USDT permits.
const me = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account: me, chain: celo, transport: http(FORK) });
const UNI = CELO.uniswapWarsUsdt;
await rpc("anvil_setBalance", [me.address, "0x56BC75E2D63100000"]);
await rpc("anvil_setBalance", [UNI, "0x56BC75E2D63100000"]);
await rpc("anvil_impersonateAccount", [UNI]);
for (const [token, amount] of [[CELO.usdt, parseUnits("3", 6)], [CELO.wars, parseEther("100")]] as const) {
  const hash = await rpc("eth_sendTransaction", [{ from: UNI, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [me.address, amount] }) }]);
  await pub.waitForTransactionReceipt({ hash });
}

async function permit(token: Address, name: string, spender: Address, value: bigint) {
  const nonce = await pub.readContract({ address: token, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [me.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) + 10n ** 9n; // far ahead: fork time may have moved
  const t = permitTypedData(token, name, me.address, spender, value, nonce, deadline);
  const { EIP712Domain: _omit, ...types } = t.types; // viem derives the domain type itself
  const sig = await me.signTypedData({ domain: t.domain, types, primaryType: "Permit", message: { ...t.message, value, nonce, deadline } as any });
  const { r, s, v, yParity } = parseSignature(sig);
  return { deadline, r, s, v: Number(v ?? BigInt(27 + (yParity ?? 0))) };
}
const send = async (data: Hex) => {
  const hash = await wallet.sendTransaction({ to: dep.pool, data });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success");
  return r;
};

// 1. borrow 1,000 wARS with a USDT permit (no approval transaction)
assert.equal(await pub.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "allowance", args: [me.address, dep.pool] }), 0n);
const collateral = parseUnits("1.25", 6);
const p1 = await permit(CELO.usdt, "Tether USD", dep.pool, collateral);
const r1 = await send(encodeFunctionData({ abi: poolAbi, functionName: "borrowWithPermit", args: [collateral, parseEther("1000"), 30, 9_000n, p1.deadline, p1.v, p1.r, p1.s] }));
const loanId = parseEventLogs({ abi: poolAbi, logs: r1.logs, eventName: "Borrowed" })[0].args.loanId;
console.log(`borrowWithPermit: loan ${loanId} opened with a USDT permit`);

// 2. repay everything with a wARS permit (debt + 0.1%, as the browser does)
const debt = await pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "debtOf", args: [loanId] });
const pay = debt + debt / 1000n + 1n;
const usdtBefore = await pub.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "balanceOf", args: [me.address] });
const p2 = await permit(CELO.wars, "Peso Argentino", dep.pool, pay);
await send(encodeFunctionData({ abi: poolAbi, functionName: "repayWithPermit", args: [loanId, pay, p2.deadline, p2.v, p2.r, p2.s] }));
const loan = await pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "loans", args: [loanId] });
assert.equal(loan.open, false, "loan closed");
const back = (await pub.readContract({ address: CELO.usdt, abi: erc20Abi, functionName: "balanceOf", args: [me.address] })) - usdtBefore;
assert.equal(back, collateral, "all dollars returned");
console.log(`repayWithPermit: loan ${loanId} closed with a wARS permit; ${Number(back) / 1e6} USDT returned`);
console.log("PERMITS OK");
