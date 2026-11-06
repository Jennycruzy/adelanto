// A2 credit: the pesos that arrived in a guarded borrower's wallet and have not been spent or repaid since.
// Recomputed from chain-derived rows every tick, in exact on-chain order (block, log index), so a crash, a timeout,
// a restart or watch mode can neither count an arrival twice nor lose one.
//
// Policy, chosen to be conservative:
//   - an arrival counts only while the borrower's guard is on and the borrower has an open loan;
//   - any wARS leaving the wallet (spending, the borrower's own repayment, the agent's repayment) uses the credit
//     first, so credit never pays for pesos the borrower already used;
//   - pesos from the pool or the guard (the loan itself, refunds, lender withdrawals) are not income and are ignored;
//   - turning the guard off clears the credit.
// A borrower who routes borrowed pesos through another wallet and back creates credit; that is their own choice,
// still bound by the limits they signed (daily cap and the pesos they keep).

export type LedgerItem =
  | { kind: "guardOn"; block: bigint; logIndex: number }
  | { kind: "guardOff"; block: bigint; logIndex: number }
  | { kind: "loanOpened"; block: bigint; logIndex: number; loanId: bigint }
  | { kind: "loanEnded"; block: bigint; logIndex: number; loanId: bigint }
  | { kind: "in"; block: bigint; logIndex: number; amount: bigint }
  | { kind: "out"; block: bigint; logIndex: number; amount: bigint };

export function credit(items: LedgerItem[]): bigint {
  const ordered = [...items].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  let on = false;
  const open = new Set<bigint>();
  let c = 0n;
  for (const it of ordered) {
    switch (it.kind) {
      case "guardOn":
        on = true;
        break;
      case "guardOff":
        on = false;
        c = 0n;
        break;
      case "loanOpened":
        open.add(it.loanId);
        break;
      case "loanEnded":
        open.delete(it.loanId);
        if (open.size === 0) c = 0n; // nothing left to repay: arrivals so far are just income
        break;
      case "in":
        if (on && open.size > 0) c += it.amount;
        break;
      case "out":
        c = it.amount >= c ? 0n : c - it.amount;
        break;
    }
  }
  return c;
}
