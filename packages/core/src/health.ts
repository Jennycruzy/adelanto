// Loan health math, mirroring PesoPool exactly. Amounts are integers in token units:
//   pesos (wARS) have 18 decimals; dollars (USDT) have 6; `price` is wARS (18 decimals) per one whole USDT,
//   which is what PriceModule returns and what PesoPool uses: value = collateral * price / 1e6.
// Every rounding goes the way that keeps the borrower safe: amounts the agent adds or repays round up, so the loan
// ends at or below the target, never just above it.

export const BPS = 10_000n;
export const USDT_UNIT = 1_000_000n;
export const WAD = 10n ** 18n;

export const RISK_LTV_BPS = 7_000n; // PesoPool.RISK_LTV_BPS
export const LIQUIDATION_LTV_BPS = 8_000n; // PesoPool.LIQUIDATION_LTV_BPS
export const LIQUIDATION_BONUS_BPS = 500n; // PesoPool.LIQUIDATION_BONUS_BPS
export const CLOSE_FACTOR_BPS = 5_000n; // PesoPool.CLOSE_FACTOR_BPS
export const SMALL_DEBT = 10_000n * WAD; // PesoPool.SMALL_DEBT
export const MIN_LOAN = 1_000n * WAD; // PesoPool.MIN_LOAN

/** The agent protects a loan back down to this share: the borrowing line, so the loan is as safe as on day one. */
export const PROTECT_TARGET_BPS = 6_000n;
/** A gentle liquidation stops here (GentleKeeper.TARGET_LTV_BPS): 2 points under the 80% line, so the borrower loses
 * as little as possible and ordinary price noise does not sell again at once. */
export const LIQUIDATION_TARGET_BPS = 7_800n;

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

/** wARS value of `collateral` USDT at `price`, rounded down as PesoPool does. */
export function collateralValue(collateral: bigint, price: bigint): bigint {
  return (collateral * price) / USDT_UNIT;
}

/**
 * Debt as a share of collateral value, in basis points, rounded up, exactly as PesoPool.loanLtvBps: 0 when there is
 * no collateral (the pool has written the loan off or closed it). Collateral so small that its value rounds to zero
 * makes the contract divide by zero; here it reads as far past every line, so nothing treats it as safe.
 */
export function ltvBps(debt: bigint, collateral: bigint, price: bigint): bigint {
  if (collateral === 0n) return 0n;
  const value = collateralValue(collateral, price);
  if (value === 0n) return debt === 0n ? 0n : BPS * 100n;
  return ceilDiv(debt * BPS, value);
}

/** True when PesoPool.liquidate would accept the loan: debt * BPS > value * 8000. */
export function isLiquidatable(debt: bigint, collateral: bigint, price: bigint): boolean {
  return debt * BPS > collateralValue(collateral, price) * LIQUIDATION_LTV_BPS;
}

/** USDT to add so the loan is at or below `targetBps`. Zero if it already is. */
export function topUpToTarget(debt: bigint, collateral: bigint, price: bigint, targetBps = PROTECT_TARGET_BPS): bigint {
  if (price === 0n || targetBps === 0n) throw new Error("price and target must be positive");
  // The pool floors value = collateral * price / 1e6, so first find the smallest whole value that keeps the loan at
  // or below the target, then the smallest collateral whose floored value reaches it.
  const value = ceilDiv(debt * BPS, targetBps);
  const needed = ceilDiv(value * USDT_UNIT, price);
  return needed > collateral ? needed - collateral : 0n;
}

/** Pesos to repay so the loan is at or below `targetBps`. Zero if it already is; at most the whole debt. */
export function repayToTarget(debt: bigint, collateral: bigint, price: bigint, targetBps = PROTECT_TARGET_BPS): bigint {
  const allowed = (collateralValue(collateral, price) * targetBps) / BPS;
  if (debt <= allowed) return 0n;
  return debt - allowed;
}

/** The most PesoPool lets one liquidation repay: all of a small debt, half of a bigger one. */
export function maxLiquidationRepay(debt: bigint): bigint {
  return debt < SMALL_DEBT ? debt : (debt * CLOSE_FACTOR_BPS) / BPS;
}

/**
 * The smallest repayment that brings a liquidatable loan back to `targetBps`, given that the liquidator takes
 * collateral worth the repayment plus 5%. Solves (debt - x) * BPS <= target * (value - 1.05x) for x, rounds up,
 * and caps it at what PesoPool allows. Zero when the loan is not liquidatable.
 */
export function gentleLiquidationRepay(
  debt: bigint,
  collateral: bigint,
  price: bigint,
  targetBps = LIQUIDATION_TARGET_BPS,
): bigint {
  if (!isLiquidatable(debt, collateral, price)) return 0n;
  const value = collateralValue(collateral, price);
  const numerator = debt * BPS - targetBps * value; // > 0 because ltv > 80% > target
  const denominator = BPS * BPS - targetBps * (BPS + LIQUIDATION_BONUS_BPS); // in BPS^2 units
  if (denominator <= 0n) return maxLiquidationRepay(debt); // target too high to reach by liquidating: take the most
  const x = ceilDiv(numerator * BPS, denominator) + 12n; // same margin as GentleKeeper
  const cap = maxLiquidationRepay(debt);
  return x > cap ? cap : x;
}

/** Plain-words health band shown to people. */
export type Band = "tranquilo" | "atencion" | "riesgo" | "liquidable";
export function band(ltv: bigint): Band {
  if (ltv > LIQUIDATION_LTV_BPS) return "liquidable";
  if (ltv >= RISK_LTV_BPS) return "riesgo";
  if (ltv >= 6_500n) return "atencion";
  return "tranquilo";
}

/** Price (wARS per USDT) at which a loan would reach `targetBps`. Used for "the dollar can fall to $ X". */
export function priceAtLtv(debt: bigint, collateral: bigint, targetBps: bigint): bigint {
  if (collateral === 0n) return 0n;
  return ceilDiv(debt * BPS * USDT_UNIT, targetBps * collateral);
}
