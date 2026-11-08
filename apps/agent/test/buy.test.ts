import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { CHAINSTACK_CELO, PaidRpc, sameAnswers } from "../src/buy.ts";

// A throwaway key (never funded): anvil's first well-known key.
const dir = mkdtempSync(join(tmpdir(), "buy-"));
const keyFile = join(dir, "k");
writeFileSync(keyFile, "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
// The gateway's real 402 for this route (x402 v1 body), trimmed to the USD₮ offer.
const challenge = {
  x402Version: 1,
  accepts: [
    { scheme: "exact", network: "celo", maxAmountRequired: "10000", resource: CHAINSTACK_CELO, description: "Celo mainnet JSON-RPC, batch of up to 2000 calls", mimeType: "application/json", payTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B", maxTimeoutSeconds: 60, asset: USDT, extra: { name: "Tether USD", version: "1" } },
  ],
};

function gateway(price = "10000") {
  const seen: { paid: boolean; body: any; signed?: any }[] = [];
  const f = (async (input: any, init?: any) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const h = req.headers;
    const paid = Boolean(h.get("x-payment") ?? h.get("payment-signature"));
    const text = await req.text();
    init = { body: text };
    const sig = h.get("payment-signature") ?? h.get("x-payment");
    seen.push({ paid, body: JSON.parse(text), signed: sig ? JSON.parse(Buffer.from(sig, "base64").toString()) : undefined });
    if (!paid) {
      // As the gateway answers: the v2 offer in the payment-required header, the v1 offer in the body.
      const v2 = { x402Version: 2, error: "payment_required", resource: { url: CHAINSTACK_CELO, description: "Celo mainnet JSON-RPC, batch of up to 2000 calls", mimeType: "application/json" }, accepts: [{ scheme: "exact", network: "eip155:42220", amount: price, asset: USDT, payTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B", maxTimeoutSeconds: 60, extra: { name: "Tether USD", version: "1" } }] };
      return new Response(JSON.stringify({ ...challenge, accepts: [{ ...challenge.accepts[0], maxAmountRequired: price }] }), { status: 402, headers: { "content-type": "application/json", "payment-required": Buffer.from(JSON.stringify(v2)).toString("base64") } });
    }
    const settle = Buffer.from(JSON.stringify({ success: true, transaction: "0xabc", network: "eip155:42220" })).toString("base64");
    const out = JSON.parse(init.body).map((c: any) => ({ jsonrpc: "2.0", id: c.id, result: `0x${c.id}` }));
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json", "payment-response": settle } });
  }) as typeof fetch;
  return { f, seen };
}

describe("paid second RPC through buy", () => {
  it("pays the 402 in USD₮, returns the results in order and keeps a receipt of what it served", async () => {
    const db = openDb(":memory:");
    const g = gateway();
    const rpc = new PaidRpc(db, keyFile, 0.05, () => 1_000_000, g.f);
    const r = await rpc.batch([{ method: "eth_blockNumber", params: [] }, { method: "eth_chainId", params: [] }], { action: "A1_protect", loanId: 7 });
    expect(r).toEqual(["0x1", "0x2"]);
    expect(g.seen.map((s) => s.paid)).toEqual([false, true]);
    const auth = g.seen[1].signed.payload.authorization;
    expect(auth.to.toLowerCase()).toBe("0x20faaca5f980e29639a0fcc6dca6988e18ed333b");
    expect(auth.value).toBe("10000");
    expect(auth.from).toBe(rpc.payer);
    expect(g.seen[1].signed.accepted.asset).toBe(USDT);
    const rows = db.prepare("SELECT * FROM buy_purchases").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ capability: "chainstack.celo", outcome: "paid", amount: "10000", settlement_tx: "0xabc", token: "USDT" });
    expect(JSON.parse(rows[0].served)).toEqual({ action: "A1_protect", loanId: 7 });
  });

  it("refuses to pay more than the catalogue price", async () => {
    const db = openDb(":memory:");
    const g = gateway("50000");
    const rpc = new PaidRpc(db, keyFile, 1, () => 1_000_000, g.f);
    const r = await rpc.batch([{ method: "eth_blockNumber", params: [] }], { action: "A7_weekly" });
    expect(r).toBeNull();
    expect(g.seen.every((s) => !s.paid)).toBe(true);
    expect((db.prepare("SELECT outcome FROM buy_purchases").get() as any).outcome).toBe("failed");
  });

  it("stops buying at the daily cap", async () => {
    const db = openDb(":memory:");
    const g = gateway();
    const rpc = new PaidRpc(db, keyFile, 0.02, () => 1_000_000, g.f);
    for (let i = 0; i < 3; i++) await rpc.batch([{ method: "eth_blockNumber", params: [] }], { action: "A4_pause" });
    const outcomes = (db.prepare("SELECT outcome FROM buy_purchases ORDER BY id").all() as any[]).map((r) => r.outcome);
    expect(outcomes).toEqual(["paid", "paid", "skipped_cap"]);
    expect(g.seen.filter((s) => s.paid)).toHaveLength(2);
    expect(rpc.spentToday()).toBeCloseTo(0.02);
  });

  it("compares answers exactly", () => {
    expect(sameAnswers(["0xAB", "0x01"], ["0xab", "0x01"])).toEqual({ ok: true });
    expect(sameAnswers(["0xab", "0x01"], ["0xab", "0x02"])).toEqual({ ok: false, first: 1 });
  });
});
