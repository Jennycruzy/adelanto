// MCP server at /mcp (Streamable HTTP, stateless): the same answers as the site and the free API, as tools another
// agent can call, plus unsigned transactions for the caller's own wallet. Every transaction it builds goes only to
// our published contracts or the two tokens, carries our ERC-8021 attribution suffix, and moves nothing until the
// wallet that owns the funds signs it. The server holds no keys.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { toDataSuffix } from "@celo/attribution-tags";
import { concatHex, encodeFunctionData, erc20Abi, getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { poolAbi } from "@adelanto/chain";
import { pesos as fmtPesos, dollars as fmtDollars, maxLtvBpsForTier, maxPesosForTier } from "@adelanto/core";
import { REFS, balancesOf, creditOf, dep, loanView, poolView, priceHistory, pub, quoteFor } from "./data.ts";

const WAD = 10n ** 18n;
const USDT = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");
const WARS = getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D");
const SITE = process.env.PUBLIC_URL ?? "https://adelanto.space";

export type UnsignedTx = { to: Address; data: Hex; value: "0"; chainId: 42220; does: string };

const tagged = (data: Hex): Hex => concatHex([data, toDataSuffix(dep.attributionCode) as Hex]);
const tx = (to: Address, data: Hex, does: string): UnsignedTx => ({ to, data: tagged(data), value: "0", chainId: 42220, does });
const approve = (token: Address, amount: bigint, what: string) =>
  tx(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [dep.pool, amount] }), `Approve exactly ${what} for PesoPool ${dep.pool}`);

/** USDT in words, with all six decimals when under a cent so a small amount never reads as zero. */
const usdtWords = (u: bigint) => (u > 0n && u < 10_000n ? `US$${(Number(u) / 1e6).toFixed(6)}` : fmtDollars(u, "en"));
const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: ser(v) }] });
const refuse = (why: string) => ({ content: [{ type: "text" as const, text: why }], isError: true });
const wallet = z.string().refine(isAddress, "a 0x address").describe("The Celo wallet that will sign and that holds the funds");

/** The transactions to borrow `pesosWhole` for `days` from `who`'s own USDT, or why not. */
export async function buildBorrow(who: Address, pesosWhole: bigint, days: number) {
  const [v, c, bal] = await Promise.all([poolView(), creditOf(who), balancesOf(who)]);
  const q = quoteFor(v, pesosWhole, days, c.tier);
  if (!q.ok) return { ok: false as const, reason: q.reason, limit: (q as any).limit ?? null };
  if (bal.usdt < q.collateral) return { ok: false as const, reason: "NOT_ENOUGH_USDT", need: q.collateral, have: bal.usdt };
  const allowance = await pub.readContract({ address: USDT, abi: erc20Abi, functionName: "allowance", args: [who, dep.pool] });
  const txs: UnsignedTx[] = [];
  if (allowance < q.collateral) txs.push(approve(USDT, q.collateral, `${usdtWords(q.collateral)} USDT`));
  txs.push(
    tx(
      dep.pool,
      encodeFunctionData({ abi: poolAbi, functionName: "borrow", args: [q.collateral, q.pesos, days, q.maxRateBps] }),
      `Borrow ${fmtPesos(q.pesos, "en")} for ${days} days, leaving ${usdtWords(q.collateral)} USDT; reverts if the rate is above ${Number(q.maxRateBps) / 100}% a year`,
    ),
  );
  return { ok: true as const, quote: q, block: v.block, txs };
}

/** The transactions for `who` to repay `pesos` (or everything) on a loan, from their wARS and, if short, their USDT. */
export async function buildRepay(who: Address, loanId: bigint, pesosWhole?: bigint) {
  const v = await poolView();
  const loan = await loanView(loanId, v);
  if (!loan) return { ok: false as const, reason: "NO_SUCH_LOAN" };
  if (!loan.open) return { ok: false as const, reason: "LOAN_CLOSED" };
  const all = pesosWhole === undefined;
  // Interest grows by the second; repaying everything allows 0.1% more and the pool takes only what is owed.
  const need = all ? loan.debt + loan.debt / 1000n + 1n : pesosWhole * WAD;
  if (need <= 0n) return { ok: false as const, reason: "ZERO_AMOUNT" };
  const bal = await balancesOf(who);
  const txs: UnsignedTx[] = [];
  if (bal.wars >= need) {
    txs.push(approve(WARS, need, fmtPesos(need, "en")));
    txs.push(tx(dep.pool, encodeFunctionData({ abi: poolAbi, functionName: "repay", args: [loanId, need] }), `Repay up to ${fmtPesos(need, "en")} on loan #${loanId}`));
    return { ok: true as const, debt: loan.debt, block: v.block, txs };
  }
  if (!all) return { ok: false as const, reason: "NOT_ENOUGH_WARS", need, have: bal.wars };
  // A borrower holding only the borrowed pesos is a few pesos short (fee out, interest in): the pool swaps spare
  // dollars for the gap in the same transaction it repays, then the wallet's pesos repay the rest.
  const gap = need - bal.wars;
  const usdtIn = (gap * 10n ** 6n * 103n) / (v.spot * 100n) + 1n; // 3% for price movement and the pool fee
  if (bal.usdt < usdtIn) return { ok: false as const, reason: "NOT_ENOUGH_WARS_OR_USDT", needWars: need, haveWars: bal.wars, orUsdt: usdtIn, haveUsdt: bal.usdt };
  txs.push(approve(USDT, usdtIn, `${usdtWords(usdtIn)} USDT`));
  txs.push(tx(dep.pool, encodeFunctionData({ abi: poolAbi, functionName: "repayWithSwap", args: [loanId, usdtIn, gap] }), `Swap up to ${usdtWords(usdtIn)} USDT for the ${fmtPesos(gap, "en")} gap and repay it on loan #${loanId}`));
  if (bal.wars > 0n) {
    txs.push(approve(WARS, bal.wars, fmtPesos(bal.wars, "en")));
    txs.push(tx(dep.pool, encodeFunctionData({ abi: poolAbi, functionName: "repay", args: [loanId, bal.wars] }), `Repay the rest, ${fmtPesos(bal.wars, "en")}, on loan #${loanId}`));
  }
  return { ok: true as const, debt: loan.debt, block: v.block, txs };
}

export function mcpServer() {
  const s = new McpServer(
    { name: "adelanto", version: "1.0.0", title: "ADELANTO: peso loans on Celo" },
    {
      instructions:
        "ADELANTO lends Ripio wARS (Argentine pesos) on Celo against USDT, with an agent (ERC-8004 #10043) that looks after each loan inside limits the borrower signs. Read tools answer from chain. build_* tools return unsigned, attribution-tagged transactions for the caller's own wallet, to sign in order on Celo (chain 42220); nothing moves until that wallet signs. Amounts: pesos in whole pesos; on-chain values are wARS with 18 decimals and USDT with 6.",
    },
  );
  const ro = { readOnlyHint: true, openWorldHint: true } as const;

  s.registerTool("rates", { title: "Rates now", description: "Borrow and lend rates of the peso pool now, free and lent pesos, pesos per dollar, the Argentine bank reference rates, and the contract addresses. Read from chain.", annotations: ro }, async () => {
    const v = await poolView();
    return ok({
      block: v.block,
      borrowRateBps: v.borrowRateBps,
      lenderRateBps: v.lenderRateBps,
      utilizationBps: v.utilizationBps,
      freePesos: v.pool.cash,
      lentPesos: v.pool.totalDebt,
      pesosPerDollar: { borrow: v.borrowPrice, average30m: v.liquidationPrice, spot: v.spot },
      newLoans: v.paused ? "paused" : v.priceOk ? "open" : "price_refused",
      references: REFS,
      contracts: { pool: dep.pool, guard: dep.guard, creditBook: dep.creditBook, priceModule: dep.priceModule, wars: WARS, usdt: USDT },
    });
  });

  s.registerTool(
    "price_history",
    { title: "Price the agent checks", description: "The agent's own once-a-minute price check: the Celo wARS/USDT pool's 30-minute average against Binance USDTARS and dolarapi, pesos per dollar.", inputSchema: { hours: z.number().int().min(1).max(168).default(24) }, annotations: ro },
    async ({ hours }) => ok({ hours, points: priceHistory(hours, 200).map((p) => ({ at: new Date(p.t).toISOString(), pool30m: p.pool, binance: p.binance, dolarapi: p.dolarapi })) }),
  );

  s.registerTool(
    "quote",
    {
      title: "Borrow quote",
      description: "A quote to borrow pesos for 7, 30, 60 or 90 days: dollars to leave, rate, opening fee, pesos received, interest, and what a bank would charge. Give a wallet to use its credit step.",
      inputSchema: { pesos: z.number().int().min(1000).max(10_000_000).describe("Whole pesos"), days: z.union([z.literal(7), z.literal(30), z.literal(60), z.literal(90)]).default(30), wallet: wallet.optional() },
      annotations: ro,
    },
    async ({ pesos, days, wallet: w }) => {
      const [v, tier] = await Promise.all([poolView(), w ? creditOf(getAddress(w)).then((c) => c.tier) : Promise.resolve(0)]);
      const q = quoteFor(v, BigInt(pesos), days, tier);
      return q.ok ? ok({ block: v.block, tier, ...q }) : refuse(`Refused: ${q.reason}${(q as any).limit !== undefined ? `; most the pool can lend now: ${fmtPesos((q as any).limit, "en")}` : ""}`);
    },
  );

  s.registerTool(
    "credit_record",
    { title: "Credit record", description: "A wallet's public credit record from CreditBook on Celo, its step (0-3) and what that step unlocks.", inputSchema: { wallet }, annotations: ro },
    async ({ wallet: w }) => {
      const c = await creditOf(getAddress(w));
      return ok({ wallet: getAddress(w), ...c, unlocks: { maxPesos: maxPesosForTier(c.tier), maxLtvBps: maxLtvBpsForTier(c.tier) }, page: `${SITE}/historial?w=${getAddress(w)}` });
    },
  );

  s.registerTool(
    "loan_status",
    { title: "Loan status", description: "One loan read from chain now: debt with today's interest, dollars left, health, the prices at which it reaches risk (70%) and sale (80%), due date, and the agent's signed limits if any.", inputSchema: { loanId: z.number().int().min(1) }, annotations: ro },
    async ({ loanId }) => {
      const v = await poolView();
      const l = await loanView(BigInt(loanId), v);
      return l ? ok({ block: v.block, ...l, page: `${SITE}/prestamo/${loanId}` }) : refuse(`No loan #${loanId}`);
    },
  );

  s.registerTool(
    "build_borrow",
    {
      title: "Build a borrow",
      description: "Unsigned transactions for `wallet` to borrow pesos against its own USDT: an exact USDT approval if needed, then PesoPool.borrow with the quoted maximum rate. Sign them in order with that wallet on Celo.",
      inputSchema: { wallet, pesos: z.number().int().min(1000).max(10_000_000).describe("Whole pesos"), days: z.union([z.literal(7), z.literal(30), z.literal(60), z.literal(90)]).default(30) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ wallet: w, pesos, days }) => {
      const r = await buildBorrow(getAddress(w), BigInt(pesos), days);
      return r.ok ? ok(r) : refuse(ser(r));
    },
  );

  s.registerTool(
    "build_repay",
    {
      title: "Build a repayment",
      description: "Unsigned transactions for `wallet` to repay part of a loan or all of it (omit pesos). Repaying all returns the dollars in the same transaction. If the wallet is a few pesos short, the gap is covered from its USDT through the pool's swap.",
      inputSchema: { wallet, loanId: z.number().int().min(1), pesos: z.number().int().min(1).optional().describe("Whole pesos; omit to repay everything") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ wallet: w, loanId, pesos }) => {
      const r = await buildRepay(getAddress(w), BigInt(loanId), pesos === undefined ? undefined : BigInt(pesos));
      return r.ok ? ok(r) : refuse(ser(r));
    },
  );
  return s;
}

/** One stateless MCP exchange per HTTP request. */
export async function handleMcp(req: Request): Promise<Response> {
  const server = mcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}
