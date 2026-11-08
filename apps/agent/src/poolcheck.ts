// A8 Daily pool check. Once a day the agent reads the pool's books (free pesos, what is owed, what lenders own, the
// borrow rate) at one block from our own RPC and buys the same reads from a node we do not run (Chainstack, through
// buy, paid over x402 in USD₮). Transparencia shows the result with the payment's transaction, so anyone can see the
// numbers on the page were confirmed by an outside node that day.
import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { poolAbi } from "@adelanto/chain";
import { getMeta, setMeta, type Db } from "./db.ts";
import { sameAnswers, type PaidRpc } from "./buy.ts";

export type PoolCheck = {
  day: string;
  block: string;
  outcome: "match" | "mismatch" | "unavailable";
  cash: string;
  totalDebt: string;
  totalAssets: string;
  borrowRateBps: string;
  tx: string | null;
  at: number;
};

const FIELDS = ["cash", "totalDebt", "totalAssets"] as const;

export async function poolCheckIfDue(db: Db, pub: PublicClient, pool: Address, block: bigint, now: number, paid?: PaidRpc, log: (s: string) => void = console.log): Promise<PoolCheck | null> {
  if (!paid) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  const last = getMeta(db, "poolcheck:last");
  if (last && (JSON.parse(last) as PoolCheck).day === day) return null;
  const calls: { to: Address; data: Hex }[] = [
    ...FIELDS.map((f) => ({ to: pool, data: encodeFunctionData({ abi: poolAbi, functionName: f as any }) })),
    { to: pool, data: encodeFunctionData({ abi: poolAbi, functionName: "borrowRateBps", args: [0] }) },
  ];
  const ours = (await Promise.all(calls.map(async (c) => (await pub.call({ to: c.to, data: c.data, blockNumber: block })).data ?? "0x"))) as Hex[];
  const theirs = await paid
    .batch(calls.map((c) => ({ method: "eth_call", params: [{ to: c.to, data: c.data }, `0x${block.toString(16)}`] })), { action: "A8_pool_check", block: block.toString() })
    .catch(() => null);
  const outcome = !theirs ? "unavailable" : sameAnswers(ours, theirs).ok ? "match" : "mismatch";
  const r = db.prepare("SELECT settlement_tx FROM buy_purchases WHERE outcome = 'paid' ORDER BY id DESC LIMIT 1").get() as any;
  const big = (h: Hex) => (h === "0x" ? "0" : BigInt(h).toString());
  const check: PoolCheck = {
    day,
    block: block.toString(),
    outcome,
    cash: big(ours[0]),
    totalDebt: big(ours[1]),
    totalAssets: big(ours[2]),
    borrowRateBps: big(ours[3]),
    tx: theirs ? (r?.settlement_tx ?? null) : null,
    at: now,
  };
  // An unavailable gateway is tried again on a later tick; a match or mismatch is the day's answer.
  if (outcome !== "unavailable") setMeta(db, "poolcheck:last", JSON.stringify(check));
  log(`A8 pool check ${day} at block ${block}: ${outcome}${check.tx ? ` (paid ${check.tx})` : ""}`);
  return check;
}
