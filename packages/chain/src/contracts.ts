import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, parseAbi, type Address } from "viem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Deployed Celo addresses, read from the deploy record so code and chain cannot drift apart. */
export function celoDeployment(file = join(root, "deployments", "celo.json")) {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const at = (name: string): Address => {
    const a = d.steps?.[name]?.address;
    if (!a) throw new Error(`deployments: ${name} has no address`);
    return getAddress(a);
  };
  return {
    pool: at("PesoPool"),
    guard: at("LoanGuard"),
    creditBook: at("CreditBook"),
    priceModule: at("PriceModule"),
    deployBlock: BigInt(d.steps.PriceModule.block),
    attributionCode: d.attributionCode as string,
  };
}

// The ABIs below are copied from the Solidity sources in contracts/src; the ABI test compares them with the
// compiler output, so a change in a contract that is not mirrored here fails the build.

export const loanTuple =
  "(address borrower,uint8 tier,bool open,bool liquidated,uint16 termDays,uint64 openedAt,uint64 dueAt,uint64 penaltyFrom,uint128 collateral,uint256 scaledDebt)";
export const limitsTuple =
  "(bool autoRepay,bool rateWatch,uint8 protectOrder,uint64 expiry,uint128 keepWarsBuffer,uint128 maxRepayWarsPerDay,uint128 maxTopUpUsdtPerDay,uint32 maxRateBps)";

export const poolAbi = parseAbi([
  `function loans(uint256 loanId) view returns (${loanTuple})`,
  "function debtOf(uint256 loanId) view returns (uint256)",
  "function loanLtvBps(uint256 loanId) view returns (uint256)",
  "function nextLoanId() view returns (uint256)",
  "function paused() view returns (bool)",
  "function guardian() view returns (address)",
  "function cash() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalDebt() view returns (uint256)",
  "function utilizationBps() view returns (uint256)",
  "function borrowRateBps(uint8 tier) view returns (uint256)",
  "function lenderRateBps() view returns (uint256)",
  "function RISK_LTV_BPS() view returns (uint256)",
  "function LIQUIDATION_LTV_BPS() view returns (uint256)",
  "function liquidate(uint256 loanId, uint256 pesos) returns (uint256 repaid, uint256 seized)",
  "function borrow(uint256 collateral, uint256 pesos, uint16 termDays, uint256 maxRateBps) returns (uint256 loanId)",
  "function borrowWithPermit(uint256 collateral, uint256 pesos, uint16 termDays, uint256 maxRateBps, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256 loanId)",
  "function addCollateral(uint256 loanId, uint256 amount)",
  "function repay(uint256 loanId, uint256 pesos) returns (uint256 paid)",
  "function repayWithSwap(uint256 loanId, uint256 usdtIn, uint256 minPesosOut) returns (uint256 paid)",
  "function withdrawCollateral(uint256 loanId, uint256 amount)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address holder) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address holder) returns (uint256)",
  "function maxWithdraw(address holder) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function pause()",
  "function unpause()",
  "event Borrowed(uint256 indexed loanId, address indexed borrower, uint256 collateral, uint256 pesos, uint256 fee, uint16 termDays, uint8 tier, uint256 price, uint256 rateBps)",
  "event CollateralAdded(uint256 indexed loanId, address indexed from, uint256 usdt)",
  "event Repaid(uint256 indexed loanId, address indexed payer, uint256 pesos, uint256 debtLeft)",
  "event LoanClosed(uint256 indexed loanId, address indexed borrower, bool onTime, uint256 collateralReturned)",
  "event CollateralWithdrawn(uint256 indexed loanId, uint256 usdt)",
  "event Liquidated(uint256 indexed loanId, address indexed liquidator, uint256 pesosRepaid, uint256 usdtSeized, uint256 price)",
  "event BadDebt(uint256 indexed loanId, uint256 pesos, uint256 coveredByReserve)",
  "event PenaltyAdded(uint256 indexed loanId, uint256 pesos)",
  "event Paused(address indexed by)",
  "event Unpaused(address indexed by)",
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
]);

export const guardAbi = parseAbi([
  `function limitsOf(address borrower) view returns (${limitsTuple})`,
  "function usageOf(address borrower) view returns ((uint64 day,uint128 repaidWars,uint128 toppedUpUsdt))",
  "function ruleHashOf(address borrower) view returns (bytes32)",
  "function agent() view returns (address)",
  `function setLimits(${limitsTuple} l, bytes32 ruleHash)`,
  "function revoke()",
  "function protectWithTopUp(uint256 loanId, uint256 usdtAmount)",
  "function protectWithRepay(uint256 loanId, uint256 pesos)",
  "function autoRepay(uint256 loanId, uint256 pesos)",
  `event LimitsSet(address indexed borrower, bytes32 indexed ruleHash, ${limitsTuple} limits)`,
  "event Revoked(address indexed borrower)",
  "event Protected(address indexed borrower, uint256 indexed loanId, bytes32 indexed ruleHash, uint256 usdtAdded, uint256 ltvBps)",
  "event ProtectedByRepay(address indexed borrower, uint256 indexed loanId, bytes32 indexed ruleHash, uint256 warsRepaid, uint256 ltvBps)",
  "event AutoRepaid(address indexed borrower, uint256 indexed loanId, bytes32 indexed ruleHash, uint256 warsRepaid)",
]);

export const priceAbi = parseAbi([
  "function status() view returns (bool ok, uint8 reason)",
  "function spot() view returns (uint256)",
  "function twap(uint32 secondsAgo) view returns (uint256)",
  "function liquidationPrice() view returns (uint256)",
  "function warsDepth() view returns (uint256)",
]);

export const erc20TransferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
