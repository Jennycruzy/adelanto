// What the agent buys through buy (usebuy.ai, Celo's catalogue of paid agent services), paid over x402 from the agent
// wallet in USD₮. One purchase today: a batch on Chainstack's Celo RPC, a node we do not run, to confirm what our own
// RPC told the agent before it moves anyone's money and before it writes the weekly summaries. Each purchase is tied
// to the action it served and kept as a receipt (buy_purchases, exported to evidence/buy/). Hard caps: one payment is
// at most US$0.01 and the agent spends at most BUY_DAILY_CAP_USD (default US$0.05) a day; past that it buys nothing.
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { Db } from "./db.ts";

export const CHAINSTACK_CELO = "https://gateway.usebuy.ai/chainstack/celo";
const USDT = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");
const PRICE_ATOMIC = 10_000n; // US$0.01 in USD₮ base units: the catalogue's price for one batch
const NETWORK = "eip155:42220";

export type RpcCall = { method: string; params: unknown[] };
export type Served = { action: string; loanId?: number; wallets?: string[]; block?: string };
type FetchLike = typeof fetch;

export class PaidRpc {
  readonly payer: `0x${string}`;
  private readonly pay: FetchLike;
  private readonly db: Db;
  private readonly dailyCapUsd: number;
  private readonly now: () => number;
  constructor(db: Db, keyFile: string, dailyCapUsd = Number(process.env.BUY_DAILY_CAP_USD ?? 0.05), now: () => number = Date.now, baseFetch: FetchLike = fetch) {
    this.db = db;
    this.dailyCapUsd = dailyCapUsd;
    this.now = now;
    const account = privateKeyToAccount(readFileSync(keyFile, "utf8").trim() as Hex);
    this.payer = account.address;
    const client = new x402Client((_v, reqs) => reqs.find((r: any) => getAddress(r.asset) === USDT) ?? null as any);
    client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: USDT, maxAmountPerPayment: PRICE_ATOMIC.toString() }] });
    client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: process.env.CELO_RPC_URL ?? "https://forno.celo.org" }));
    this.pay = wrapFetchWithPayment(baseFetch, client);
  }

  /** US$ spent in the last 24 hours, from our own receipts. */
  spentToday(): number {
    const r = this.db.prepare("SELECT COUNT(*) n FROM buy_purchases WHERE outcome = 'paid' AND at >= ?").get(this.now() - 86_400_000) as any;
    return Number(r.n) * Number(PRICE_ATOMIC) / 1e6;
  }

  private receipt(served: Served, outcome: string, tx: string | null, detail: string | null) {
    this.db
      .prepare("INSERT INTO buy_purchases (capability, url, payer, token, amount, settlement_tx, served, outcome, detail, at) VALUES ('chainstack.celo', ?, ?, 'USDT', ?, ?, ?, ?, ?, ?)")
      .run(CHAINSTACK_CELO, this.payer, outcome === "paid" ? PRICE_ATOMIC.toString() : "0", tx, JSON.stringify(served), outcome, detail, this.now());
  }

  /** One paid JSON-RPC batch (up to 2,000 calls). Returns the results in order, or null if nothing was bought. */
  async batch(calls: RpcCall[], served: Served): Promise<unknown[] | null> {
    if (!calls.length || calls.length > 2000) throw new Error("a batch is 1 to 2,000 calls");
    if (this.spentToday() + Number(PRICE_ATOMIC) / 1e6 > this.dailyCapUsd + 1e-9) {
      this.receipt(served, "skipped_cap", null, `daily cap US$${this.dailyCapUsd} reached`);
      return null;
    }
    const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c })));
    let res: Response;
    try {
      res = await this.pay(CHAINSTACK_CELO, { method: "POST", headers: { "content-type": "application/json" }, body });
    } catch (e: any) {
      this.receipt(served, "failed", null, String(e?.message ?? e).slice(0, 300));
      return null;
    }
    const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    let tx: string | null = null;
    try {
      tx = header ? ((decodePaymentResponseHeader(header) as any).transaction ?? null) : null;
    } catch {
      tx = null;
    }
    if (!res.ok) {
      this.receipt(served, tx ? "paid" : "failed", tx, `HTTP ${res.status}`);
      return null;
    }
    const out = (await res.json()) as { id: number; result?: unknown; error?: unknown }[];
    this.receipt(served, "paid", tx, null);
    const byId = new Map(out.map((r) => [r.id, r]));
    return calls.map((_, i) => {
      const r = byId.get(i + 1);
      if (!r || r.error !== undefined) throw new Error(`paid RPC call ${i + 1} failed: ${JSON.stringify(r?.error ?? "missing")}`);
      return r.result;
    });
  }
}

/** eth_call results to compare: the same calls at the same block from our RPC and from the paid one must match. */
export function sameAnswers(ours: Hex[], theirs: unknown[]): { ok: boolean; first?: number } {
  for (let i = 0; i < ours.length; i++) if (String(theirs[i]).toLowerCase() !== ours[i].toLowerCase()) return { ok: false, first: i };
  return { ok: true };
}
