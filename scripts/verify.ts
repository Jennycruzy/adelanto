// Checks ADELANTO's public claims from Celo alone: no database, no API of ours. Reads every event of the pool, the
// guard and the gentle keeper since deployment, rebuilds each loan's history and the transparency counts, compares
// them with the contracts' state now, and checks that every transaction behind those events carries our ERC-8021
// attribution tag. Exits non-zero on any mismatch.
//   npm run verify            all loans, counts, tags
//   npm run verify -- 5       one loan's history in full
// Env: CELO_RPC_URL (optional; defaults to forno).
import { getAddress, type Address, type Hex } from "viem";
import { carriesCode, celoPublicClient, poolAbi } from "../packages/chain/src/index.ts";
import { FROM_BLOCK as FROM, GUARD, KEEPER, POOL, allEvents, dep, label, wallets } from "./lib/chain.ts";

const code: string = dep.attributionCode;
const pub = celoPublicClient();
const one = process.argv[2] ? BigInt(process.argv[2]) : null;

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
const pesos = (w: bigint) => `$ ${(Number(w / 10n ** 15n) / 1000).toLocaleString("es-AR", { maximumFractionDigits: 3 })}`;
const usd = (u: bigint) => `US$ ${(Number(u) / 1e6).toFixed(6)}`;

const head = await pub.getBlockNumber();
console.log(`Reading Celo from block ${FROM} to ${head} (PesoPool ${POOL}, LoanGuard ${GUARD}${KEEPER ? `, GentleKeeper ${KEEPER}` : ""})…`);
const events = await allEvents(pub, head);
console.log(`${events.length} events.\n`);

// ------------------------------------------------------------------ loans

type LoanHist = { id: bigint; borrower: Address; pesos: bigint; fee: bigint; collateral: bigint; repaid: bigint; byAgent: bigint; added: bigint; withdrawn: bigint; liquidated: bigint; closed: boolean; onTime: boolean | null; lines: string[]; txs: Set<Hex> };
const loans = new Map<bigint, LoanHist>();
const L = (id: bigint) => loans.get(id)!;
for (const e of events) {
  const a = e.args;
  const id: bigint | undefined = a.loanId;
  if (e.contract === POOL && e.name === "Borrowed") {
    loans.set(id!, { id: id!, borrower: getAddress(a.borrower), pesos: a.pesos, fee: a.fee, collateral: a.collateral, repaid: 0n, byAgent: 0n, added: 0n, withdrawn: 0n, liquidated: 0n, closed: false, onTime: null, lines: [], txs: new Set() });
    L(id!).lines.push(`block ${e.block}: borrowed ${pesos(a.pesos)} for ${a.termDays} days against ${usd(a.collateral)}, fee ${pesos(a.fee)}, rate ${Number(a.rateBps) / 100}%  ${e.tx}`);
  } else if (id !== undefined && loans.has(id)) {
    const l = L(id);
    if (e.name === "Repaid") { l.repaid += a.pesos; l.lines.push(`block ${e.block}: repaid ${pesos(a.pesos)} by ${getAddress(a.payer) === GUARD ? "LoanGuard (the agent, from the borrower's wallet)" : label(a.payer) === "USER" ? a.payer : `${a.payer} (${label(a.payer)})`}, left ${pesos(a.debtLeft)}  ${e.tx}`); }
    else if (e.name === "AutoRepaid" || e.name === "ProtectedByRepay") { l.byAgent += a.warsRepaid; l.lines.push(`block ${e.block}: the agent repaid ${pesos(a.warsRepaid)} under rule ${String(a.ruleHash).slice(0, 10)}…  ${e.tx}`); }
    else if (e.name === "Protected") { l.lines.push(`block ${e.block}: the agent added ${usd(a.usdtAdded)} of the borrower's dollars  ${e.tx}`); }
    else if (e.name === "CollateralAdded") { l.added += a.usdt; l.lines.push(`block ${e.block}: ${usd(a.usdt)} added  ${e.tx}`); }
    else if (e.name === "CollateralWithdrawn") { l.withdrawn += a.usdt; l.lines.push(`block ${e.block}: ${usd(a.usdt)} taken back  ${e.tx}`); }
    else if (e.name === "Liquidated") { l.liquidated += a.usdtSeized; l.lines.push(`block ${e.block}: ${usd(a.usdtSeized)} sold for ${pesos(a.pesosRepaid)}  ${e.tx}`); }
    else if (e.name === "LoanClosed") { l.closed = true; l.onTime = a.onTime; l.lines.push(`block ${e.block}: closed ${a.onTime ? "on time" : "late"}, ${usd(a.collateralReturned)} returned  ${e.tx}`); }
    l.txs.add(e.tx);
  }
  if (id !== undefined && loans.has(id)) L(id).txs.add(e.tx);
}

for (const l of loans.values()) {
  if (one !== null && l.id !== one) continue;
  const [now, debt] = await Promise.all([
    pub.readContract({ address: POOL, abi: poolAbi, functionName: "loans", args: [l.id] }),
    pub.readContract({ address: POOL, abi: poolAbi, functionName: "debtOf", args: [l.id] }),
  ]);
  console.log(`Loan #${l.id} · ${l.borrower} (${label(l.borrower)})`);
  if (one !== null) for (const s of l.lines) console.log(`  ${s}`);
  check(getAddress(now.borrower) === l.borrower, `  borrower on chain matches the Borrowed event`);
  check(now.open === !l.closed, `  ${l.closed ? "closed" : "open"} on chain, as the events say`);
  if (l.closed) {
    check(debt === 0n && now.collateral === 0n, `  nothing owed and no dollars left in it`);
    check(l.liquidated > 0n || l.repaid >= l.pesos, `  repaid ${pesos(l.repaid)} of ${pesos(l.pesos)} borrowed (the agent ${pesos(l.byAgent)})`);
  } else {
    check(now.collateral === l.collateral + l.added - l.withdrawn - l.liquidated, `  dollars in it (${usd(now.collateral)}) = left + added − taken back − sold`);
    console.log(`       owes ${pesos(debt)} now`);
  }
}

// ------------------------------------------------------------------ transparency counts

const byLabel = (xs: string[]) => ({ OURS: xs.filter((x) => label(x) === "OURS").length, JUDGE: xs.filter((x) => label(x) === "JUDGE").length, USER: xs.filter((x) => label(x) === "USER").length });
const loanCounts = byLabel([...loans.values()].map((l) => l.borrower));
const lenders = [...new Set(events.filter((e) => e.contract === POOL && e.name === "Deposit").map((e) => getAddress(e.args.owner)))];
const lenderCounts = byLabel(lenders);
const agentActs = events.filter((e) => ["AutoRepaid", "ProtectedByRepay", "Protected"].includes(e.name) || (e.contract === KEEPER));
console.log(`\nLoans: ${loans.size} (ours ${loanCounts.OURS}, judge ${loanCounts.JUDGE}, other people ${loanCounts.USER}); lenders: ${lenders.length} (ours ${lenderCounts.OURS}, other people ${lenderCounts.USER}); agent actions on chain: ${agentActs.length}.`);
const [cash, totalDebt, nextId] = await Promise.all([
  pub.readContract({ address: POOL, abi: poolAbi, functionName: "cash" }),
  pub.readContract({ address: POOL, abi: poolAbi, functionName: "totalDebt" }),
  pub.readContract({ address: POOL, abi: poolAbi, functionName: "nextLoanId" }).catch(() => null),
]);
if (nextId !== null) check(BigInt(loans.size) === (nextId as bigint) - 1n, `every loan the pool numbered has a Borrowed event (${loans.size})`);
const openDebt = (await Promise.all([...loans.values()].filter((l) => !l.closed).map((l) => pub.readContract({ address: POOL, abi: poolAbi, functionName: "debtOf", args: [l.id] })))).reduce((s, d) => s + d, 0n);
check(openDebt <= totalDebt + 10n ** 15n && openDebt + 10n ** 15n >= totalDebt, `open loans' debts add up to the pool's total debt (${pesos(totalDebt)})`);
console.log(`       free pesos in the pool: ${pesos(cash)}`);

// ------------------------------------------------------------------ attribution on every transaction behind those events

const txs = [...new Set(events.map((e) => e.tx))];
let tagged = 0;
const untagged: Hex[] = [];
for (const h of txs) {
  const t = await pub.getTransaction({ hash: h });
  if (carriesCode(t.input, code)) tagged++;
  else untagged.push(h);
}
check(untagged.length === 0, `attribution tag ${code} on ${tagged} of ${txs.length} transactions behind these events${untagged.length ? `; untagged: ${untagged.join(", ")}` : ""}`);
const agentTxs = [...new Set(agentActs.map((e) => e.tx))];
const fromAgent = await Promise.all(agentTxs.map((h) => pub.getTransaction({ hash: h }).then((t) => getAddress(t.from))));
check(fromAgent.every((f) => label(f) === "OURS" && wallets.find((w) => getAddress(w.address) === f)?.role.startsWith("agent")), `every agent action was sent by the agent wallet (${agentTxs.length})`);

console.log(failures ? `\n${failures} check(s) failed.` : `\nAll checks passed, from chain alone (block ${head}).`);
process.exit(failures ? 1 : 0);
