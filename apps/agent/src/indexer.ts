// Follows PesoPool and LoanGuard on Celo up to the chain's "safe" head (blocks already posted to Ethereum, ~3-4
// minutes behind the tip), and keeps loans and guard limits in step with the chain. Events are the history; the
// current state of each touched loan or guard is re-read from the contracts, which stay the source of truth.
// Every wARS transfer into or out of a borrower who has ever turned the guard on is recorded, so the auto-repay
// credit (ledger.ts) can be rebuilt from the chain at any time.
// A reorg below the safe head is not expected; if the stored block hash ever disagrees with the chain, the indexer
// rewinds and indexes again.
import { decodeEventLog, getAddress, type Address, type Hex, type Log, type PublicClient } from "viem";
import { CELO, erc20TransferEvent, guardAbi, poolAbi } from "@adelanto/chain";
import { getMeta, json, setMeta, tx, type Db } from "./db.ts";

const CHUNK = 2_000n;
const REWIND = 512n;

export type Addresses = { pool: Address; guard: Address; deployBlock: bigint };

const LOAN_EVENTS = new Set(["Borrowed", "CollateralAdded", "Repaid", "LoanClosed", "CollateralWithdrawn", "Liquidated", "BadDebt", "PenaltyAdded"]);
const GUARD_ACTIONS = new Set(["Protected", "ProtectedByRepay", "AutoRepaid"]);

function decode(log: Log, a: Addresses) {
  const abi = getAddress(log.address) === a.pool ? poolAbi : guardAbi;
  try {
    return decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
  } catch {
    return null; // an event we don't follow (e.g. ERC-20 Transfer/Approval of pool shares)
  }
}

/** Re-reads one loan from PesoPool and stores it (a cache for pages; decisions always read the chain). */
export async function refreshLoan(db: Db, pub: PublicClient, a: Addresses, id: bigint, labels: Map<string, string>) {
  const [loan, debt] = await Promise.all([
    pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loans", args: [id] }),
    pub.readContract({ address: a.pool, abi: poolAbi, functionName: "debtOf", args: [id] }),
  ]);
  let ltv: bigint | null = null;
  if (loan.open) ltv = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loanLtvBps", args: [id] });
  const borrower = getAddress(loan.borrower);
  db.prepare(
    `INSERT INTO loans (id, borrower, open, collateral, debt, ltv_bps, tier, term_days, opened_at, due_at, liquidated, label, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET open = excluded.open, collateral = excluded.collateral, debt = excluded.debt,
       ltv_bps = excluded.ltv_bps, liquidated = excluded.liquidated, label = excluded.label, updated_at = excluded.updated_at`,
  ).run(Number(id), borrower, loan.open ? 1 : 0, loan.collateral.toString(), debt.toString(), ltv === null ? null : Number(ltv), loan.tier, loan.termDays, Number(loan.openedAt), Number(loan.dueAt), loan.liquidated ? 1 : 0, labels.get(borrower) ?? "USER", Date.now());
}

/** Re-reads one borrower's guard limits from LoanGuard and stores them (a cache for pages). */
export async function refreshGuard(db: Db, pub: PublicClient, a: Addresses, borrower: Address, setTx: string) {
  const [limits, ruleHash] = await Promise.all([
    pub.readContract({ address: a.guard, abi: guardAbi, functionName: "limitsOf", args: [borrower] }),
    pub.readContract({ address: a.guard, abi: guardAbi, functionName: "ruleHashOf", args: [borrower] }),
  ]);
  db.prepare(
    `INSERT INTO guard_limits (borrower, limits, rule_hash, tx, active, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(borrower) DO UPDATE SET limits = excluded.limits, rule_hash = excluded.rule_hash, tx = excluded.tx,
       active = excluded.active, updated_at = excluded.updated_at`,
  ).run(getAddress(borrower), json(limits), ruleHash, setTx, limits.expiry > 0n ? 1 : 0, Date.now());
}

/** Every borrower who has ever set guard limits (from indexed events). */
export function followedBorrowers(db: Db): Address[] {
  return (db.prepare("SELECT DISTINCT json_extract(args, '$.borrower') AS b FROM events WHERE name = 'LimitsSet'").all() as any[]).map((r) => getAddress(r.b));
}

/** The safe head, or 64 blocks behind the tip on a node that does not serve it. */
async function safeHead(pub: PublicClient): Promise<bigint> {
  try {
    const b = await pub.getBlock({ blockTag: "safe" });
    if (b.number !== null) return b.number;
  } catch {}
  return (await pub.getBlockNumber({ cacheTime: 0 })) - 64n;
}

/** If the last indexed block's hash no longer matches the chain, drop everything after a safe distance and redo it. */
async function checkContinuity(db: Db, pub: PublicClient, a: Addresses, log: (s: string) => void) {
  const to = getMeta(db, "celo.indexedTo");
  const hash = getMeta(db, "celo.indexedHash");
  if (!to || !hash) return;
  const block = await pub.getBlock({ blockNumber: BigInt(to) });
  if (block.hash === hash) return;
  const back = BigInt(to) - REWIND < a.deployBlock - 1n ? a.deployBlock - 1n : BigInt(to) - REWIND;
  log(`indexer: block ${to} changed (${hash} -> ${block.hash}); rewinding to ${back}`);
  tx(db, () => {
    db.prepare("DELETE FROM events WHERE chain = 'celo' AND block > ?").run(Number(back));
    db.prepare("DELETE FROM wars_flows WHERE chain = 'celo' AND block > ?").run(Number(back));
    setMeta(db, "celo.indexedTo", back.toString());
    db.prepare("DELETE FROM meta WHERE key = 'celo.indexedHash'").run();
  });
}

/** One indexing pass up to the safe head. Returns the block reached. */
export async function indexOnce(db: Db, pub: PublicClient, a: Addresses, labels: Map<string, string>, log: (s: string) => void = console.log): Promise<bigint> {
  await checkContinuity(db, pub, a, log);
  const head = await safeHead(pub);
  let from = BigInt(getMeta(db, "celo.indexedTo") ?? (a.deployBlock - 1n).toString()) + 1n;
  while (from <= head) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const logs = await pub.getLogs({ address: [a.pool, a.guard], fromBlock: from, toBlock: to });
    const touchedLoans = new Set<bigint>();
    const touchedGuards = new Map<Address, string>();
    const rows: any[] = [];
    for (const l of logs) {
      const ev = decode(l, a);
      if (!ev) continue;
      rows.push([l.transactionHash, Number(l.logIndex), Number(l.blockNumber), getAddress(l.address), ev.eventName, json(ev.args)]);
      if ((LOAN_EVENTS.has(ev.eventName) || GUARD_ACTIONS.has(ev.eventName)) && ev.args.loanId !== undefined) touchedLoans.add(ev.args.loanId);
      if ((ev.eventName === "LimitsSet" || ev.eventName === "Revoked") && ev.args.borrower) touchedGuards.set(getAddress(ev.args.borrower), l.transactionHash!);
    }
    // Transfers for everyone who has ever set limits, including those who first do so inside this range.
    const follow = new Set(followedBorrowers(db));
    for (const r of rows) if (r[4] === "LimitsSet") follow.add(getAddress(JSON.parse(r[5]).borrower));
    const flows: any[] = [];
    if (follow.size > 0) {
      const list = [...follow];
      const [ins, outs] = await Promise.all([
        pub.getLogs({ address: CELO.wars, event: erc20TransferEvent[0], args: { to: list }, fromBlock: from, toBlock: to }),
        pub.getLogs({ address: CELO.wars, event: erc20TransferEvent[0], args: { from: list }, fromBlock: from, toBlock: to }),
      ]);
      for (const t of ins) {
        const b = getAddress(t.args.to!);
        if (follow.has(b)) flows.push([t.transactionHash, Number(t.logIndex), b, "in", getAddress(t.args.from!), t.args.value!.toString(), Number(t.blockNumber)]);
      }
      for (const t of outs) {
        const b = getAddress(t.args.from!);
        if (follow.has(b)) flows.push([t.transactionHash, Number(t.logIndex), b, "out", getAddress(t.args.to!), t.args.value!.toString(), Number(t.blockNumber)]);
      }
    }
    // Re-read touched state first and save the cursor last: a crash in between repeats this range, harmlessly.
    for (const id of touchedLoans) await refreshLoan(db, pub, a, id, labels);
    for (const [b, setTx] of touchedGuards) await refreshGuard(db, pub, a, b, setTx);
    const toBlock = await pub.getBlock({ blockNumber: to });
    tx(db, () => {
      const ins = db.prepare("INSERT OR IGNORE INTO events (chain, tx, log_index, block, contract, name, args) VALUES ('celo', ?, ?, ?, ?, ?, ?)");
      for (const r of rows) ins.run(...r);
      const fl = db.prepare("INSERT OR IGNORE INTO wars_flows (chain, tx, log_index, borrower, direction, counterparty, amount, block) VALUES ('celo', ?, ?, ?, ?, ?, ?, ?)");
      for (const f of flows) fl.run(...f);
      setMeta(db, "celo.indexedTo", to.toString());
      setMeta(db, "celo.indexedHash", toBlock.hash as Hex);
    });
    from = to + 1n;
  }
  return head;
}

/** Backstop: every loan id the pool has issued is in the table (catches anything a crash could have skipped). */
export async function sweepLoans(db: Db, pub: PublicClient, a: Addresses, labels: Map<string, string>) {
  const next = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "nextLoanId" });
  const known = new Set((db.prepare("SELECT id FROM loans").all() as any[]).map((r) => BigInt(r.id)));
  for (let id = 1n; id < next; id++) if (!known.has(id)) await refreshLoan(db, pub, a, id, labels);
}

/** Open loans as stored; the caller refreshes each from chain before deciding anything. */
export function openLoanIds(db: Db): bigint[] {
  return (db.prepare("SELECT id FROM loans WHERE open = 1 ORDER BY id").all() as any[]).map((r) => BigInt(r.id));
}
