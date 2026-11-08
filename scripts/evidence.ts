// Regenerates evidence/ from Celo and the agent's own database. Every number in the README and the submission comes
// from these files; nothing here is typed by hand.
//   loans.json             every loan with its events, transactions and the borrower's label (chain)
//   deposits.json          every deposit and withdrawal with the lender's label (chain)
//   agent-actions.json     what the agent decided and did, with its sentences and transactions (agent database)
//   x402-sales.json        every x402 payment settled into the agent wallet, with the buyer's label (Blockscout)
//   price-study.json       the agent's once-a-minute price check: pool against Binance and dolarapi (agent database)
//   weekly-summaries.json  the Sunday summaries the agent wrote (agent database)
//   ratings.json           the agent's ERC-8004 feedback (chain)
//   buy/purchases.json     every purchase through buy, what it served and its settlement (agent database)
//   summary.json, README.md  the headline numbers, each with the file it comes from
// Env: CELO_RPC_URL (optional), DB_PATH (default ~/adelanto-data/agent.sqlite; without it the database files are kept as they are).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import { celoPublicClient, poolAbi } from "../packages/chain/src/index.ts";
import { AGENT_ID, REPUTATION, reputationAbi } from "../apps/web/client/feedback.ts";
import { AGENT, AGENT_EVENTS, GUARD, KEEPER, POOL, allEvents, label, root, roleOf } from "./lib/chain.ts";

const out = join(root, "evidence");
const pub = celoPublicClient();
const W = 10n ** 18n;
const tx = (h: string) => `https://celoscan.io/tx/${h}`;
const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) + "\n";
const write = (name: string, v: unknown) => writeFileSync(join(out, name), ser(v));
const pesosNum = (w: bigint) => Number(w / 10n ** 14n) / 10_000;
const head = await pub.getBlockNumber();
const headTime = new Date(Number((await pub.getBlock({ blockNumber: head })).timestamp) * 1000).toISOString();
const generated = { generatedAt: new Date().toISOString(), block: head.toString(), blockTime: headTime };
console.log(`Celo block ${head}…`);

// ------------------------------------------------------------------ chain: loans, deposits

const events = await allEvents(pub, head);
const loans = new Map<string, any>();
for (const e of events) {
  const id = e.args.loanId?.toString();
  if (e.contract === POOL && e.name === "Borrowed") {
    loans.set(id, {
      id: Number(id), borrower: getAddress(e.args.borrower), label: label(e.args.borrower), pesos: pesosNum(e.args.pesos), fee: pesosNum(e.args.fee),
      collateralUsdt: Number(e.args.collateral) / 1e6, termDays: Number(e.args.termDays), rateBps: Number(e.args.rateBps), repaid: 0, repaidByAgent: 0, open: true, onTime: null, events: [],
    });
  }
  const l = id !== undefined ? loans.get(id) : undefined;
  if (!l) continue;
  if (e.name === "Repaid") l.repaid += pesosNum(e.args.pesos);
  if (e.name === "AutoRepaid" || e.name === "ProtectedByRepay") l.repaidByAgent += pesosNum(e.args.warsRepaid);
  if (e.contract === POOL && e.name === "LoanClosed") { l.open = false; l.onTime = e.args.onTime; }
  l.events.push({ block: Number(e.block), event: e.name, by: e.contract === GUARD || e.contract === KEEPER ? "agent" : "wallet", tx: e.tx, url: tx(e.tx) });
}
const loanList = [...loans.values()];
for (const l of loanList) { l.repaid = Math.round(l.repaid * 1e4) / 1e4; l.repaidByAgent = Math.round(l.repaidByAgent * 1e4) / 1e4; }
write("loans.json", { ...generated, source: "PesoPool, LoanGuard and GentleKeeper events on Celo; labels from deployments/wallets.json", loans: loanList });

const deposits = events
  .filter((e) => e.contract === POOL && (e.name === "Deposit" || e.name === "Withdraw"))
  .map((e) => ({ block: Number(e.block), kind: e.name, lender: getAddress(e.args.owner), label: label(e.args.owner), pesos: pesosNum(e.args.assets), tx: e.tx, url: tx(e.tx) }));
write("deposits.json", { ...generated, source: "PesoPool Deposit and Withdraw events on Celo", deposits });

// ------------------------------------------------------------------ chain: ERC-8004 ratings

const clients = (await pub.readContract({ address: REPUTATION, abi: reputationAbi, functionName: "getClients", args: [AGENT_ID] })) as Address[];
let ratings: any[] = [];
if (clients.length) {
  const [who, idx, values, decimals, tag1s, tag2s, revoked] = (await pub.readContract({ address: REPUTATION, abi: reputationAbi, functionName: "readAllFeedback", args: [AGENT_ID, clients, "", "", true] })) as unknown as any[];
  ratings = (who as string[]).map((c, i) => {
    const loan = loans.get(String(tag2s[i]));
    const value = Number(values[i]) / 10 ** Number(decimals[i]);
    const counts = tag1s[i] === "closed-loan" && !revoked[i] && !!loan && !loan.open && loan.borrower === getAddress(c) && label(c) !== "OURS";
    return { client: getAddress(c), label: label(c), index: Number(idx[i]), value, stars: Math.round(value / 20), tag1: tag1s[i], tag2: tag2s[i], revoked: revoked[i], counts };
  });
}
write("ratings.json", { ...generated, source: `ReputationRegistry ${REPUTATION}, agent #${AGENT_ID}; a rating counts if its wallet closed that loan and is not ours`, ratings });

// ------------------------------------------------------------------ Blockscout: x402 sales into the agent wallet

// Blockscout gives the method by name or, when it has not decoded it, by selector.
const SETTLE = new Set(["settleWithPermit", "transferWithAuthorization", "receiveWithAuthorization", "permitTransferFrom", "0xfa340378", "0xe3ee160e", "0xcf092995", "0xef55bec6"]);
const sales: any[] = [];
let params = "";
for (;;) {
  const r = await fetch(`https://celo.blockscout.com/api/v2/addresses/${AGENT}/token-transfers?type=ERC-20&filter=to${params}`);
  if (!r.ok) throw new Error(`blockscout ${r.status}`);
  const j = await r.json();
  for (const t of j.items) {
    if (!SETTLE.has(t.method)) continue;
    sales.push({ at: t.timestamp, token: t.token.symbol, amount: Number(t.total.value) / 10 ** Number(t.total.decimals), buyer: getAddress(t.from.hash), buyerLabel: label(t.from.hash), buyerRole: roleOf(t.from.hash), method: t.method, tx: t.transaction_hash, url: tx(t.transaction_hash) });
  }
  if (!j.next_page_params) break;
  params = "&" + new URLSearchParams(j.next_page_params).toString();
}
write("x402-sales.json", { ...generated, source: "ERC-20 transfers into the agent wallet settled by an x402 facilitator (Blockscout)", payTo: AGENT, sales });

// ------------------------------------------------------------------ the agent's database

const dbPath = process.env.DB_PATH ?? join(homedir(), "adelanto-data", "agent.sqlite");
let actions: any = null, study: any = null, weekly: any = null;
if (existsSync(dbPath)) {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare("SELECT id, job, loan_id, borrower, decision, mode, status, tx, sentence_es, sentence_en, at FROM agent_actions ORDER BY id").all() as any[];
  actions = {
    ...generated, source: "agent_actions in the agent's database; landed actions also appear on chain (loans.json)",
    byStatus: rows.reduce((m: any, r) => ((m[`${r.job}:${r.status}`] = (m[`${r.job}:${r.status}`] ?? 0) + 1), m), {}),
    actions: rows.map((r) => ({ ...r, at: new Date(Number(r.at)).toISOString(), url: r.tx ? tx(r.tx) : null, decision: JSON.parse(r.decision) })),
  };
  write("agent-actions.json", actions);

  const pr = db
    .prepare(
      `SELECT p.observed_at t, p.value pool, b.value binance, d.value dolarapi FROM prices p
       JOIN prices b ON b.observed_at = p.observed_at AND b.source = 'binance'
       LEFT JOIN prices d ON d.observed_at = p.observed_at AND d.source = 'dolarapi'
       WHERE p.source = 'uniswap_twap30' ORDER BY p.observed_at`,
    )
    .all() as any[];
  const gaps = (k: "binance" | "dolarapi") => pr.filter((r) => r[k] > 0).map((r) => Math.abs(r.pool / r[k] - 1) * 100).sort((a, b) => a - b);
  const q = (a: number[], f: number) => (a.length ? Math.round(a[Math.floor(f * (a.length - 1))] * 100) / 100 : null);
  const gb = gaps("binance"), gd = gaps("dolarapi");
  study = {
    ...generated, source: "prices table in the agent's database: the agent's own once-a-minute readings (A4 price check)",
    readings: pr.length, from: pr.length ? new Date(pr[0].t).toISOString() : null, to: pr.length ? new Date(pr[pr.length - 1].t).toISOString() : null,
    gapFromBinancePct: { median: q(gb, 0.5), p95: q(gb, 0.95), max: q(gb, 1) },
    gapFromDolarapiPct: { median: q(gd, 0.5), p95: q(gd, 0.95), max: q(gd, 1) },
    readingsPastPauseLineFromBoth: pr.filter((r) => r.dolarapi > 0 && Math.abs(r.pool / r.binance - 1) > 0.015 && Math.abs(r.pool / r.dolarapi - 1) > 0.015).length,
    pauseRule: "new loans pause only if the pool is more than 1.5% from every outside source for 3 minutes",
  };
  write("price-study.json", study);

  const wk = db.prepare("SELECT key, kind, borrower, text_es, text_en, created_at FROM notices WHERE kind IN ('weekly', 'weekly_pool') ORDER BY created_at, key").all() as any[];
  weekly = { ...generated, source: "notices in the agent's database (A7, Sundays 20:00 Buenos Aires)", summaries: wk.map((r) => ({ ...r, label: r.borrower ? label(r.borrower) : "POOL", created_at: new Date(Number(r.created_at)).toISOString() })) };
  write("weekly-summaries.json", weekly);

  const bought = db.prepare("SELECT capability, url, payer, token, amount, settlement_tx, served, outcome, detail, at FROM buy_purchases ORDER BY id").all() as any[];
  mkdirSync(join(out, "buy"), { recursive: true });
  writeFileSync(
    join(out, "buy", "purchases.json"),
    ser({
      ...generated,
      source: "buy_purchases in the agent's database: every purchase through buy (usebuy.ai), what it served and its settlement",
      paidUsd: bought.filter((b) => b.outcome === "paid").reduce((t, b) => t + Number(b.amount) / 1e6, 0),
      purchases: bought.map((b) => ({ ...b, served: JSON.parse(b.served), at: new Date(Number(b.at)).toISOString(), url: b.settlement_tx ? tx(b.settlement_tx) : null })),
    }),
  );
  db.close();
} else {
  console.log(`No agent database at ${dbPath}: agent-actions.json, price-study.json and weekly-summaries.json are left as they are.`);
  const read = (n: string) => (existsSync(join(out, n)) ? JSON.parse(readFileSync(join(out, n), "utf8")) : null);
  actions = read("agent-actions.json");
  study = read("price-study.json");
  weekly = read("weekly-summaries.json");
}

// ------------------------------------------------------------------ summary

const audit = existsSync(join(out, "attribution-audit.json")) ? JSON.parse(readFileSync(join(out, "attribution-audit.json"), "utf8")) : null;
const [cash, totalDebt] = await Promise.all([
  pub.readContract({ address: POOL, abi: poolAbi, functionName: "cash" }),
  pub.readContract({ address: POOL, abi: poolAbi, functionName: "totalDebt" }),
]);
const count = (xs: { label: string }[], l: string) => xs.filter((x) => x.label === l).length;
const agentOnChain = events.filter((e) => AGENT_EVENTS.has(e.name) || e.contract === KEEPER).length;
const lenders = [...new Map(deposits.filter((d) => d.kind === "Deposit").map((d) => [d.lender, d])).values()];
const counted = ratings.filter((r) => r.counts);
const s = {
  ...generated,
  loans: { total: loanList.length, ours: count(loanList, "OURS"), judge: count(loanList, "JUDGE"), otherPeople: count(loanList, "USER"), closed: loanList.filter((l) => !l.open).length, closedOnTime: loanList.filter((l) => l.onTime === true).length, from: "loans.json" },
  pesosLent: { total: loanList.reduce((t, l) => t + l.pesos, 0), repaid: Math.round(loanList.reduce((t, l) => t + l.repaid, 0) * 100) / 100, repaidByAgent: Math.round(loanList.reduce((t, l) => t + l.repaidByAgent, 0) * 100) / 100, from: "loans.json" },
  lenders: { total: lenders.length, ours: count(lenders, "OURS"), otherPeople: count(lenders, "USER"), from: "deposits.json" },
  pool: { freePesos: pesosNum(cash), lentPesos: pesosNum(totalDebt), from: `PesoPool ${POOL} at block ${head}` },
  agent: { actionsOnChain: agentOnChain, from: "loans.json (agent events)" },
  x402: { sales: sales.length, fromOurWallets: sales.filter((x) => x.buyerLabel !== "USER").length, fromOtherPeople: sales.filter((x) => x.buyerLabel === "USER").length, byToken: sales.reduce((m: any, x) => ((m[x.token] = Math.round(((m[x.token] ?? 0) + x.amount) * 1e6) / 1e6), m), {}), from: "x402-sales.json" },
  ratings: { counted: counted.length, averageStars: counted.length ? Math.round((counted.reduce((t, r) => t + r.stars, 0) / counted.length) * 10) / 10 : null, from: "ratings.json" },
  priceCheck: study ? { readings: study.readings, medianGapFromBinancePct: study.gapFromBinancePct.median, maxGapFromBinancePct: study.gapFromBinancePct.max, readingsPastPauseLineFromBoth: study.readingsPastPauseLineFromBoth, from: "price-study.json" } : null,
  weeklySummaries: weekly ? { written: weekly.summaries.length, from: "weekly-summaries.json" } : null,
  attribution: audit ? { ...audit.totals, checkedAt: audit.checkedAt, from: "attribution-audit.json (npm run audit:attribution)" } : null,
};
write("summary.json", s);

const md = `# Evidence

Generated by \`npm run evidence\` at ${s.generatedAt} from Celo (block ${s.block}) and the agent's database. Every
number in the README and the submission comes from these files.

| What | Number | File |
|---|---|---|
| Loans | ${s.loans.total} (ours ${s.loans.ours}, judge ${s.loans.judge}, other people ${s.loans.otherPeople}); ${s.loans.closedOnTime} closed on time | [loans.json](loans.json) |
| Pesos lent / repaid | ${s.pesosLent.total.toLocaleString("en-US")} / ${s.pesosLent.repaid.toLocaleString("en-US")}, of which the agent repaid ${s.pesosLent.repaidByAgent.toLocaleString("en-US")} | [loans.json](loans.json) |
| Lenders | ${s.lenders.total} (ours ${s.lenders.ours}, other people ${s.lenders.otherPeople}) | [deposits.json](deposits.json) |
| Pool now | ${s.pool.freePesos.toLocaleString("en-US")} pesos free, ${s.pool.lentPesos.toLocaleString("en-US")} lent | PesoPool at block ${s.block} |
| Agent actions on chain | ${s.agent.actionsOnChain} | [loans.json](loans.json), [agent-actions.json](agent-actions.json) |
| x402 sales | ${s.x402.sales} (${Object.entries(s.x402.byToken).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}); bought by our own wallets ${s.x402.fromOurWallets}, by other people ${s.x402.fromOtherPeople} | [x402-sales.json](x402-sales.json) |
${s.ratings.counted ? `| ERC-8004 ratings from people who closed a loan | ${s.ratings.counted}, average ${s.ratings.averageStars} / 5 | [ratings.json](ratings.json) |\n` : ""}${s.priceCheck ? `| Price check | ${s.priceCheck.readings.toLocaleString("en-US")} readings; pool vs Binance median ${s.priceCheck.medianGapFromBinancePct}%, max ${s.priceCheck.maxGapFromBinancePct}%; past the pause line against both: ${s.priceCheck.readingsPastPauseLineFromBoth} | [price-study.json](price-study.json) |\n` : ""}${s.weeklySummaries?.written ? `| Weekly summaries written | ${s.weeklySummaries.written} | [weekly-summaries.json](weekly-summaries.json) |\n` : ""}${s.attribution ? `| Attribution tag | ${s.attribution.tagged} tagged, ${s.attribution.untaggedAfterCodeIssued} untagged after the code was issued (checked ${s.attribution.checkedAt}) | [attribution-audit.json](attribution-audit.json) |\n` : ""}
Check the chain side yourself with \`npm run verify\` (chain alone, no database).
`;
writeFileSync(join(out, "README.md"), md);
console.log(md);
