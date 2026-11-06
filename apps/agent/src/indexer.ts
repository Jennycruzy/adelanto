// Follows PesoPool and LoanGuard on Celo, two blocks behind the head, and keeps loans and guard limits in step with
// the chain. Events are the history; the current state of each touched loan or guard is re-read from the contracts,
// which stay the source of truth. Pesos arriving in a guarded borrower's wallet are recorded for auto-repay, except
// the loan's own pesos and refunds from the pool or the guard.
import { decodeEventLog, getAddress, type Address, type Log, type PublicClient } from "viem";
import { CELO, erc20TransferEvent, guardAbi, poolAbi } from "@adelanto/chain";
import { getMeta, json, setMeta, tx, type Db } from "./db.ts";

export const CONFIRMATIONS = 2n;
const CHUNK = 2_000n;

export type Addresses = { pool: Address; guard: Address; deployBlock: bigint };

const LOAN_EVENTS = new Set([
  "Borrowed",
  "CollateralAdded",
  "Repaid",
  "LoanClosed",
  "CollateralWithdrawn",
  "Liquidated",
  "BadDebt",
  "PenaltyAdded",
]);

function decode(log: Log, a: Addresses) {
  const abi = getAddress(log.address) === a.pool ? poolAbi : guardAbi;
  try {
    return decodeEventLog({ abi, data: log.data, topics: log.topics }) as { eventName: string; args: any };
  } catch {
    return null; // an event we don't follow (e.g. ERC-20 Transfer/Approval of pool shares)
  }
}

/** Re-reads one loan from PesoPool and stores it. */
export async function refreshLoan(db: Db, pub: PublicClient, a: Addresses, id: bigint, labels: Map<string, string>) {
  const [loan, debt] = await Promise.all([
    pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loans", args: [id] }),
    pub.readContract({ address: a.pool, abi: poolAbi, functionName: "debtOf", args: [id] }),
  ]);
  let ltv: bigint | null = null;
  if (loan.open) {
    ltv = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "loanLtvBps", args: [id] });
  }
  const borrower = getAddress(loan.borrower);
  db.prepare(
    `INSERT INTO loans (id, borrower, open, collateral, debt, ltv_bps, tier, term_days, opened_at, due_at, liquidated, label, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET open = excluded.open, collateral = excluded.collateral, debt = excluded.debt,
       ltv_bps = excluded.ltv_bps, liquidated = excluded.liquidated, label = excluded.label, updated_at = excluded.updated_at`,
  ).run(
    Number(id),
    borrower,
    loan.open ? 1 : 0,
    loan.collateral.toString(),
    debt.toString(),
    ltv === null ? null : Number(ltv),
    loan.tier,
    loan.termDays,
    Number(loan.openedAt),
    Number(loan.dueAt),
    loan.liquidated ? 1 : 0,
    labels.get(borrower) ?? "USER",
    Date.now(),
  );
}

/** Re-reads one borrower's guard limits from LoanGuard and stores them. */
export async function refreshGuard(db: Db, pub: PublicClient, a: Addresses, borrower: Address, setBlock: bigint, setTx: string) {
  const [limits, ruleHash] = await Promise.all([
    pub.readContract({ address: a.guard, abi: guardAbi, functionName: "limitsOf", args: [borrower] }),
    pub.readContract({ address: a.guard, abi: guardAbi, functionName: "ruleHashOf", args: [borrower] }),
  ]);
  const active = limits.expiry > 0n ? 1 : 0;
  db.prepare(
    `INSERT INTO guard_limits (borrower, limits, rule_hash, tx, set_block, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(borrower) DO UPDATE SET limits = excluded.limits, rule_hash = excluded.rule_hash, tx = excluded.tx,
       set_block = excluded.set_block, active = excluded.active, updated_at = excluded.updated_at`,
  ).run(getAddress(borrower), json(limits), ruleHash, setTx, Number(setBlock), active, Date.now());
}

export function guardedBorrowers(db: Db): { borrower: Address; setBlock: bigint }[] {
  return (db.prepare("SELECT borrower, set_block FROM guard_limits WHERE active = 1").all() as any[]).map((r) => ({
    borrower: getAddress(r.borrower),
    setBlock: BigInt(r.set_block),
  }));
}

/** One indexing pass up to head - CONFIRMATIONS. Returns the block reached. */
export async function indexOnce(db: Db, pub: PublicClient, a: Addresses, labels: Map<string, string>): Promise<bigint> {
  // cacheTime 0: viem caches the block number for a few seconds by default; the indexer must see the real head.
  const head = (await pub.getBlockNumber({ cacheTime: 0 })) - CONFIRMATIONS;
  let from = BigInt(getMeta(db, "celo.indexedTo") ?? (a.deployBlock - 1n).toString()) + 1n;
  while (from <= head) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const logs = await pub.getLogs({ address: [a.pool, a.guard], fromBlock: from, toBlock: to });
    const touchedLoans = new Set<bigint>();
    const touchedGuards = new Map<Address, { block: bigint; tx: string }>();
    const rows: any[] = [];
    for (const log of logs) {
      const ev = decode(log, a);
      if (!ev) continue;
      rows.push([log.transactionHash, Number(log.logIndex), Number(log.blockNumber), getAddress(log.address), ev.eventName, json(ev.args)]);
      if (LOAN_EVENTS.has(ev.eventName) && ev.args.loanId !== undefined) touchedLoans.add(ev.args.loanId);
      if ((ev.eventName === "LimitsSet" || ev.eventName === "Revoked") && ev.args.borrower) {
        touchedGuards.set(getAddress(ev.args.borrower), { block: log.blockNumber!, tx: log.transactionHash! });
      }
      if (["Protected", "ProtectedByRepay", "AutoRepaid"].includes(ev.eventName) && ev.args.loanId !== undefined) {
        touchedLoans.add(ev.args.loanId);
      }
    }
    // Arrivals for borrowers already guarded before this range, plus those guarded inside it (filtered by block).
    const guarded = new Map(guardedBorrowers(db).map((g) => [g.borrower, g.setBlock]));
    for (const [b, g] of touchedGuards) if (!guarded.has(b)) guarded.set(b, g.block);
    const arrivals: any[] = [];
    if (guarded.size > 0) {
      const transfers = await pub.getLogs({
        address: CELO.wars,
        event: erc20TransferEvent[0],
        args: { to: [...guarded.keys()] },
        fromBlock: from,
        toBlock: to,
      });
      for (const t of transfers) {
        const fromAddr = getAddress(t.args.from!);
        const toAddr = getAddress(t.args.to!);
        const since = guarded.get(toAddr);
        if (since === undefined || t.blockNumber! <= since) continue; // before the borrower turned the guard on
        if (fromAddr === a.pool || fromAddr === a.guard || fromAddr === toAddr) continue; // the loan's own pesos, refunds
        arrivals.push([t.transactionHash, Number(t.logIndex), toAddr, fromAddr, t.args.value!.toString(), Number(t.blockNumber)]);
      }
    }
    // Re-read touched state first and save the cursor last: a crash in between repeats this range, harmlessly.
    for (const id of touchedLoans) await refreshLoan(db, pub, a, id, labels);
    for (const [b, g] of touchedGuards) await refreshGuard(db, pub, a, b, g.block, g.tx);
    tx(db, () => {
      const ins = db.prepare("INSERT OR IGNORE INTO events (chain, tx, log_index, block, contract, name, args) VALUES ('celo', ?, ?, ?, ?, ?, ?)");
      for (const r of rows) ins.run(...r);
      const arr = db.prepare("INSERT OR IGNORE INTO arrivals (chain, tx, log_index, borrower, from_addr, amount, block) VALUES ('celo', ?, ?, ?, ?, ?, ?)");
      for (const r of arrivals) arr.run(...r);
      setMeta(db, "celo.indexedTo", to.toString());
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
