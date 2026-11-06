// What the agent may do for one loan right now. Pure functions: every input is read from chain by the caller just
// before deciding, and every check mirrors one LoanGuard or PesoPool makes, so the agent never sends a transaction
// the contract would refuse, and never asks for more than the borrower signed.
import { RISK_LTV_BPS, gentleLiquidationRepay, isLiquidatable, ltvBps, repayToTarget, topUpToTarget } from "./health.ts";

export type Limits = {
  autoRepay: boolean;
  rateWatch: boolean;
  protectOrder: number; // 0 = add dollars first, 1 = repay pesos first
  expiry: bigint; // unix seconds; 0 = no limits set
  keepWarsBuffer: bigint;
  maxRepayWarsPerDay: bigint;
  maxTopUpUsdtPerDay: bigint;
  maxRateBps: number;
};

export type Usage = { repaidWars: bigint; toppedUpUsdt: bigint }; // LoanGuard.usageOf: already today's values

export type Wallet = {
  usdt: bigint;
  wars: bigint;
  usdtAllowanceToGuard: bigint;
  warsAllowanceToGuard: bigint;
};

export type LoanState = {
  id: bigint;
  borrower: `0x${string}`;
  open: boolean;
  collateral: bigint; // USDT, 6 decimals
  debt: bigint; // PesoPool.debtOf, wARS 18 decimals
  dueAt: bigint;
};

export type Refusal =
  | "LOAN_CLOSED"
  | "NO_GUARD"
  | "GUARD_EXPIRED"
  | "PRICE_REFUSED"
  | "NOT_AT_RISK"
  | "GUARD_LIMIT"
  | "WALLET_LOW"
  | "AUTO_REPAY_OFF"
  | "NOTHING_ARRIVED"
  | "BUFFER"
  | "NOT_LIQUIDATABLE"
  | "KEEPER_LOW";

export type Decision =
  | { kind: "topUp"; loanId: bigint; usdt: bigint; needed: bigint; ltvBefore: bigint; partial: boolean }
  | { kind: "protectRepay"; loanId: bigint; wars: bigint; needed: bigint; ltvBefore: bigint; partial: boolean }
  | { kind: "autoRepay"; loanId: bigint; wars: bigint; arrived: bigint }
  | { kind: "liquidate"; loanId: bigint; wars: bigint; ltvBefore: bigint; partial: boolean }
  | { kind: "none"; loanId: bigint; reason: Refusal; detail?: { [k: string]: bigint | number | string } };

const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
const pos = (x: bigint) => (x > 0n ? x : 0n);

/** Checks LoanGuard._active makes, in the same order. Returns a refusal or null when the guard would proceed. */
export function guardBlocks(loan: LoanState, limits: Limits, priceOk: boolean, now: bigint): Refusal | null {
  if (!loan.open) return "LOAN_CLOSED";
  if (limits.expiry === 0n) return "NO_GUARD";
  if (now > limits.expiry) return "GUARD_EXPIRED";
  if (!priceOk) return "PRICE_REFUSED";
  return null;
}

/** USDT the guard can pull now: inside today's cap, the wallet balance and the allowance to LoanGuard. */
export function topUpRoom(limits: Limits, usage: Usage, wallet: Wallet): bigint {
  return pos(min(limits.maxTopUpUsdtPerDay - usage.toppedUpUsdt, wallet.usdt, wallet.usdtAllowanceToGuard));
}

/** wARS the guard can pull now: inside today's cap and allowance, leaving the buffer in the wallet. */
export function repayRoom(limits: Limits, usage: Usage, wallet: Wallet, debt: bigint): bigint {
  const aboveBuffer = pos(wallet.wars - limits.keepWarsBuffer);
  return pos(min(limits.maxRepayWarsPerDay - usage.repaidWars, aboveBuffer, wallet.warsAllowanceToGuard, debt));
}

/**
 * A1 Protect: when a loan reaches 70% at the 30-minute price, add the borrower's dollars or repay their pesos
 * (in the order they chose; the other way if the first can't move anything) to bring it back to 60%, never above
 * what the limits, the wallet and the allowance permit.
 */
export function decideProtect(
  loan: LoanState,
  limits: Limits,
  usage: Usage,
  wallet: Wallet,
  price: bigint,
  priceOk: boolean,
  now: bigint,
): Decision {
  const blocked = guardBlocks(loan, limits, priceOk, now);
  if (blocked) return { kind: "none", loanId: loan.id, reason: blocked };
  const ltv = ltvBps(loan.debt, loan.collateral, price);
  if (ltv < RISK_LTV_BPS) return { kind: "none", loanId: loan.id, reason: "NOT_AT_RISK", detail: { ltv } };

  const tryTopUp = (): Decision | null => {
    const needed = topUpToTarget(loan.debt, loan.collateral, price);
    const amount = min(needed, topUpRoom(limits, usage, wallet));
    return amount > 0n ? { kind: "topUp", loanId: loan.id, usdt: amount, needed, ltvBefore: ltv, partial: amount < needed } : null;
  };
  const tryRepay = (): Decision | null => {
    const needed = repayToTarget(loan.debt, loan.collateral, price);
    const amount = min(needed, repayRoom(limits, usage, wallet, loan.debt));
    return amount > 0n ? { kind: "protectRepay", loanId: loan.id, wars: amount, needed, ltvBefore: ltv, partial: amount < needed } : null;
  };
  const order = limits.protectOrder === 1 ? [tryRepay, tryTopUp] : [tryTopUp, tryRepay];
  for (const attempt of order) {
    const d = attempt();
    if (d) return d;
  }
  // Nothing can move: say why, so the borrower can act.
  const capsUsed =
    limits.maxTopUpUsdtPerDay - usage.toppedUpUsdt <= 0n && limits.maxRepayWarsPerDay - usage.repaidWars <= 0n;
  return {
    kind: "none",
    loanId: loan.id,
    reason: capsUsed ? "GUARD_LIMIT" : "WALLET_LOW",
    detail: { ltv, usdtNeeded: topUpToTarget(loan.debt, loan.collateral, price), usdtInWallet: wallet.usdt },
  };
}

/**
 * A2 Repay when pesos arrive: repay up to what arrived (never the loan's own pesos, which the caller excludes),
 * keeping the buffer, inside the daily cap and allowance.
 */
export function decideAutoRepay(
  loan: LoanState,
  limits: Limits,
  usage: Usage,
  wallet: Wallet,
  arrived: bigint,
  priceOk: boolean,
  now: bigint,
): Decision {
  const blocked = guardBlocks(loan, limits, priceOk, now);
  if (blocked) return { kind: "none", loanId: loan.id, reason: blocked };
  if (!limits.autoRepay) return { kind: "none", loanId: loan.id, reason: "AUTO_REPAY_OFF" };
  if (arrived <= 0n) return { kind: "none", loanId: loan.id, reason: "NOTHING_ARRIVED" };
  const amount = min(arrived, repayRoom(limits, usage, wallet, loan.debt));
  if (amount <= 0n) {
    const buffer = wallet.wars <= limits.keepWarsBuffer;
    return { kind: "none", loanId: loan.id, reason: buffer ? "BUFFER" : "GUARD_LIMIT", detail: { arrived } };
  }
  return { kind: "autoRepay", loanId: loan.id, wars: amount, arrived };
}

/**
 * A5 Liquidate gently: when a loan passes 80% at the 30-minute price, repay the smallest amount that brings it back
 * to 70%, from the keeper's own wARS. Liquidation never needs the borrower's limits and never pauses.
 */
export function decideLiquidation(loan: LoanState, price: bigint, keeperWars: bigint, keeperAllowance: bigint): Decision {
  if (!loan.open) return { kind: "none", loanId: loan.id, reason: "LOAN_CLOSED" };
  if (!isLiquidatable(loan.debt, loan.collateral, price)) {
    return { kind: "none", loanId: loan.id, reason: "NOT_LIQUIDATABLE" };
  }
  const ltv = ltvBps(loan.debt, loan.collateral, price);
  const wanted = gentleLiquidationRepay(loan.debt, loan.collateral, price);
  const amount = min(wanted, keeperWars, keeperAllowance);
  if (amount <= 0n) return { kind: "none", loanId: loan.id, reason: "KEEPER_LOW", detail: { wanted, keeperWars } };
  return { kind: "liquidate", loanId: loan.id, wars: amount, ltvBefore: ltv, partial: amount < wanted };
}
