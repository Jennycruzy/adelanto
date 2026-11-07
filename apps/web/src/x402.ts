// Paid endpoints for other agents, settled through Celo's own x402 facilitator (api.x402.celo.org). Each answer
// costs a small fixed amount in USD₮ (EIP-3009) or wARS (Permit2, gas sponsored by the facilitator), paid straight
// to the ADELANTO agent's wallet; the facilitator never holds the money. The attribution code is declared in the
// builder-code extension, which the facilitator applies to the settlement once it supports it.
import { readFileSync } from "node:fs";
import type { Context } from "hono";
import { getAddress, isAddress, type Address } from "viem";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient, type RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareBuilderCodeExtension } from "@x402/extensions";
import { maxLtvBpsForTier, maxPesosForTier } from "@adelanto/core";
import { offChainQuotes } from "@adelanto/price";
import { attributionCode } from "@adelanto/chain";
import { creditOf, poolView, quoteFor } from "./data.ts";

export const X402_FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://api.x402.celo.org";
export const NETWORK = "eip155:42220" as const;
export const USDT = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");
export const WARS = getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D");
const PAY_TO = getAddress(process.env.X402_PAY_TO ?? process.env.AGENT_ADDRESS ?? "0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1");

/** Prices: [USD₮ base units (6 decimals), wARS base units (18 decimals)]. */
export const PRICES = {
  rate: { usdt: "5000", wars: (8n * 10n ** 18n).toString(), what: "Peso-dollar rate: the pool's on-chain price against Binance and the dolarapi rates, with the agent's verdict" },
  quote: { usdt: "10000", wars: (15n * 10n ** 18n).toString(), what: "A firm borrow quote from the live pool: rate, fee, dollars to leave, the price at which it reaches risk" },
  credit: { usdt: "10000", wars: (15n * 10n ** 18n).toString(), what: "A wallet's repayment record on ADELANTO: credit step, on-time loans, liquidations, the line it unlocks" },
} as const;

const accepts = (p: { usdt: string; wars: string }) => [
  { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: { amount: p.usdt, asset: USDT, extra: { name: "Tether USD", version: "1" } } },
  { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: { amount: p.wars, asset: WARS, extra: { name: "Peso Argentino", version: "1", assetTransferMethod: "permit2" } } },
];

const extensions = () => ({
  // the facilitator sponsors the EIP-2612 permit to Permit2 for wARS payers
  eip2612GasSponsoring: { info: { description: "The facilitator sponsors the EIP-2612 permit to Permit2.", version: "1" } },
  "builder-code": declareBuilderCodeExtension(attributionCode()),
});

export const routes: RoutesConfig = {
  "GET /x402/peso-rate": { accepts: accepts(PRICES.rate), description: PRICES.rate.what, mimeType: "application/json", extensions: extensions() } as any,
  "GET /x402/quote": { accepts: accepts(PRICES.quote), description: PRICES.quote.what, mimeType: "application/json", extensions: extensions() } as any,
  "GET /x402/credit/:address": { accepts: accepts(PRICES.credit), description: PRICES.credit.what, mimeType: "application/json", extensions: extensions() } as any,
};

export function x402Middleware() {
  // the key comes from X402_API_KEY or, so it never sits in a shell history, from the file X402_API_KEY_FILE names
  let key = process.env.X402_API_KEY?.trim();
  if (!key && process.env.X402_API_KEY_FILE) {
    try { key = readFileSync(process.env.X402_API_KEY_FILE, "utf8").trim() || undefined; } catch { key = undefined; }
  }
  const facilitator = new HTTPFacilitatorClient({
    url: X402_FACILITATOR,
    createAuthHeaders: async () => {
      const h: Record<string, string> = key ? { "X-API-Key": key } : {};
      return { verify: h, settle: h, supported: h };
    },
  });
  const server = new x402ResourceServer(facilitator);
  server.register("eip155:*", new ExactEvmScheme());
  return paymentMiddleware(routes, server);
}

const ser = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const WAD = 10n ** 18n;
const num = (wars: bigint) => Number(wars / 10n ** 14n) / 10_000; // wARS (or pesos per dollar) to a JS number, 4 places

export async function pesoRate(c: Context) {
  const [v, off] = await Promise.all([poolView(), offChainQuotes()]);
  const pool = num(v.liquidationPrice);
  const outside = off.quotes.map((q) => ({ source: q.source, pesosPerDollar: q.pesosPerDollar, gapPct: Math.round(((pool - q.pesosPerDollar) / q.pesosPerDollar) * 10_000) / 100 }));
  const worst = Math.max(0, ...outside.map((q) => Math.abs(q.gapPct)));
  return c.json({
    at: new Date(v.readAt).toISOString(),
    block: v.block.toString(),
    pool: { twap30PesosPerDollar: pool, spotPesosPerDollar: num(v.spot), priceOk: v.priceOk },
    outside,
    failedSources: off.failed.map((f) => f.source),
    verdict: !v.priceOk ? "refused" : worst > 1.5 ? "disagree" : "agree",
    note: "pesos per US dollar; the pool price is the 30-minute Uniswap v3 wARS/USDT average the ADELANTO contracts use",
  });
}

export async function quote(c: Context) {
  const pesos = BigInt(Math.max(0, Math.min(10_000_000, Number(c.req.query("pesos") ?? 1000) | 0)));
  const days = Math.max(7, Math.min(90, Number(c.req.query("days") ?? 30) | 0));
  const tier = Math.max(0, Math.min(3, Number(c.req.query("tier") ?? 0) | 0));
  const v = await poolView();
  const q = quoteFor(v, pesos, days, tier);
  return c.json(ser({ at: new Date(v.readAt).toISOString(), block: v.block, request: { pesos: pesos.toString(), days, tier }, quote: q, units: { pesos: "wARS, 18 decimals", collateral: "USD₮, 6 decimals", rateBps: "yearly, basis points" } }));
}

export async function credit(c: Context) {
  const a = c.req.param("address") ?? "";
  if (!isAddress(a)) return c.json({ error: "not an address" }, 400);
  const who = getAddress(a) as Address;
  const r = await creditOf(who);
  return c.json(ser({ address: who, record: r, step: r.tier, unlocks: { maxLtvBps: maxLtvBpsForTier(r.tier), maxPesos: maxPesosForTier(r.tier) / WAD }, source: "ADELANTO CreditBook on Celo, read now" }));
}

/** Free: what is for sale and how to pay. */
export function catalog(c: Context) {
  const base = new URL(c.req.url).origin;
  const item = (path: string, p: { usdt: string; wars: string; what: string }) => ({
    url: base + path,
    what: p.what,
    price: [
      { asset: "USD₮", address: USDT, amount: p.usdt, decimals: 6, method: "eip3009" },
      { asset: "wARS", address: WARS, amount: p.wars, decimals: 18, method: "permit2" },
    ],
  });
  return c.json({
    protocol: "x402 v2, scheme exact, network eip155:42220",
    facilitator: X402_FACILITATOR,
    payTo: PAY_TO,
    endpoints: [item("/x402/peso-rate", PRICES.rate), item("/x402/quote?pesos=1000&days=30", PRICES.quote), item("/x402/credit/0x…", PRICES.credit)],
  });
}
