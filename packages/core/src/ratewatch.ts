// A3 Rate watch: tell a borrower when the other market would save them clearly more than moving costs.
// Moves no money. The saving is simple interest on today's debt over the days left in the term.
import { BPS, USDT_UNIT } from "./health.ts";

/** Fixed cost of one Ethereum round trip (USDT0 out, Ripio Bridge back, gas), as measured with real funds: US$ 3.50. */
export const MOVE_COST_USDT = 3_500_000n;
const YEAR = 365n * 86_400n;

export type RateWatch = { save: bigint; moveCost: bigint; worthIt: boolean };

/**
 * `poolRateBps` and `otherRateBps` are yearly rates; `price` is wARS (18 decimals) per USDT; amounts in wARS.
 * Worth telling only when the saving is more than twice the cost of moving.
 */
export function rateWatch(debt: bigint, poolRateBps: bigint, otherRateBps: bigint, secondsLeft: bigint, price: bigint): RateWatch {
  const moveCost = (MOVE_COST_USDT * price) / USDT_UNIT;
  if (otherRateBps >= poolRateBps || secondsLeft <= 0n) return { save: 0n, moveCost, worthIt: false };
  const save = (debt * (poolRateBps - otherRateBps) * secondsLeft) / (BPS * YEAR);
  return { save, moveCost, worthIt: save > 2n * moveCost };
}

/** Morpho's per-second borrow rate (WAD) as a yearly simple rate in basis points, rounded up. */
export function perSecondToBps(ratePerSecondWad: bigint): bigint {
  const n = ratePerSecondWad * YEAR * BPS;
  const d = 10n ** 18n;
  return n === 0n ? 0n : (n - 1n) / d + 1n;
}
