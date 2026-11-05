// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PesoPool} from "./PesoPool.sol";
import {IPriceModule} from "./interfaces/IPriceModule.sol";

/// @title LoanGuard
/// @notice Holds each borrower's signed limits and nothing else. It is the only way the agent can act on a loan, and
/// it can only move the borrower's own USDT or wARS into the borrower's own loan, never anywhere else, never above the
/// daily limits, never after expiry and never while the price module refuses. The borrower sets limits from a rule in
/// their own words; `ruleHash` (keccak256 of the exact words) ties those words to the chain.
contract LoanGuard is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum ProtectOrder {
        TopUpFirst,
        RepayFirst
    }

    struct Limits {
        bool autoRepay;
        bool allowRefinance;
        ProtectOrder protectOrder;
        uint64 expiry;
        uint128 keepWarsBuffer;
        uint128 maxRepayWarsPerDay;
        uint128 maxTopUpUsdtPerDay;
        uint32 maxRateBps;
    }

    struct Usage {
        uint64 day;
        uint128 repaidWars;
        uint128 toppedUpUsdt;
    }

    uint256 public constant MAX_EXPIRY = 180 days;
    uint256 internal constant BPS = 10_000;

    PesoPool public immutable pool;
    IERC20 public immutable wars;
    IERC20 public immutable usdt;
    address public immutable agent;

    mapping(address => Limits) internal _limits;
    mapping(address => bytes32) public ruleHashOf;
    mapping(address => Usage) internal _usage;

    event LimitsSet(address indexed borrower, bytes32 indexed ruleHash, Limits limits);
    event Revoked(address indexed borrower);
    event Protected(
        address indexed borrower, uint256 indexed loanId, bytes32 indexed ruleHash, uint256 usdtAdded, uint256 ltvBps
    );
    event ProtectedByRepay(
        address indexed borrower, uint256 indexed loanId, bytes32 indexed ruleHash, uint256 warsRepaid, uint256 ltvBps
    );
    event AutoRepaid(address indexed borrower, uint256 indexed loanId, bytes32 indexed ruleHash, uint256 warsRepaid);

    error NotAgent();
    error NoLimits();
    error Expired();
    error BadExpiry();
    error NotThisBorrower();
    error NotAtRisk(uint256 ltvBps);
    error OverDailyLimit();
    error AutoRepayOff();
    error BufferBreached();
    error PriceRefused(uint8 reason);
    error ZeroAmount();

    constructor(PesoPool pool_, address agent_) {
        pool = pool_;
        wars = IERC20(pool_.asset());
        usdt = pool_.usdt();
        agent = agent_;
        wars.forceApprove(address(pool_), type(uint256).max);
        usdt.forceApprove(address(pool_), type(uint256).max);
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    // ---------------------------------------------------------------- borrower

    function setLimits(Limits calldata l, bytes32 ruleHash) external {
        if (l.expiry <= block.timestamp || l.expiry > block.timestamp + MAX_EXPIRY) revert BadExpiry();
        _limits[msg.sender] = l;
        ruleHashOf[msg.sender] = ruleHash;
        emit LimitsSet(msg.sender, ruleHash, l);
    }

    function revoke() external {
        delete _limits[msg.sender];
        delete ruleHashOf[msg.sender];
        emit Revoked(msg.sender);
    }

    // ---------------------------------------------------------------- agent

    /// @notice Add up to `usdtAmount` of the borrower's USDT to their loan. Only when the loan is at risk (70% or more).
    function protectWithTopUp(uint256 loanId, uint256 usdtAmount) external onlyAgent nonReentrant {
        if (usdtAmount == 0) revert ZeroAmount();
        (address borrower, Limits storage l) = _active(loanId);
        uint256 ltv = _requireAtRisk(loanId);
        Usage storage u = _today(borrower);
        if (uint256(u.toppedUpUsdt) + usdtAmount > l.maxTopUpUsdtPerDay) revert OverDailyLimit();
        u.toppedUpUsdt += uint128(usdtAmount);
        usdt.safeTransferFrom(borrower, address(this), usdtAmount);
        pool.addCollateral(loanId, usdtAmount);
        emit Protected(borrower, loanId, ruleHashOf[borrower], usdtAmount, ltv);
    }

    /// @notice Repay up to `pesos` from the borrower's wallet to protect a loan at risk.
    function protectWithRepay(uint256 loanId, uint256 pesos) external onlyAgent nonReentrant {
        (address borrower,) = _active(loanId);
        uint256 ltv = _requireAtRisk(loanId);
        uint256 paid = _repayFromWallet(borrower, loanId, pesos);
        emit ProtectedByRepay(borrower, loanId, ruleHashOf[borrower], paid, ltv);
    }

    /// @notice When pesos arrive in the borrower's wallet, repay up to `pesos`, keeping the buffer they chose.
    function autoRepay(uint256 loanId, uint256 pesos) external onlyAgent nonReentrant {
        (address borrower, Limits storage l) = _active(loanId);
        if (!l.autoRepay) revert AutoRepayOff();
        uint256 paid = _repayFromWallet(borrower, loanId, pesos);
        emit AutoRepaid(borrower, loanId, ruleHashOf[borrower], paid);
    }

    // ---------------------------------------------------------------- internals

    function _repayFromWallet(address borrower, uint256 loanId, uint256 pesos) internal returns (uint256 paid) {
        if (pesos == 0) revert ZeroAmount();
        Limits storage l = _limits[borrower];
        uint256 debt = pool.debtOf(loanId);
        uint256 amount = pesos < debt ? pesos : debt;
        uint256 bal = wars.balanceOf(borrower);
        if (bal < amount || bal - amount < l.keepWarsBuffer) revert BufferBreached();
        Usage storage u = _today(borrower);
        if (uint256(u.repaidWars) + amount > l.maxRepayWarsPerDay) revert OverDailyLimit();
        u.repaidWars += uint128(amount);
        wars.safeTransferFrom(borrower, address(this), amount);
        paid = pool.repay(loanId, amount);
        // The pool never takes more than it is owed; anything left goes straight back.
        if (paid < amount) wars.safeTransfer(borrower, amount - paid);
    }

    function _active(uint256 loanId) internal view returns (address borrower, Limits storage l) {
        PesoPool.Loan memory loan = pool.loans(loanId);
        borrower = loan.borrower;
        if (!loan.open || borrower == address(0)) revert NotThisBorrower();
        l = _limits[borrower];
        if (l.expiry == 0) revert NoLimits();
        if (block.timestamp > l.expiry) revert Expired();
        (bool ok, uint8 reason) = IPriceModule(address(pool.priceModule())).status();
        if (!ok) revert PriceRefused(reason);
    }

    function _requireAtRisk(uint256 loanId) internal view returns (uint256 ltv) {
        ltv = pool.loanLtvBps(loanId);
        if (ltv < pool.RISK_LTV_BPS()) revert NotAtRisk(ltv);
    }

    function _today(address borrower) internal returns (Usage storage u) {
        u = _usage[borrower];
        uint64 day = uint64(block.timestamp / 1 days);
        if (u.day != day) {
            u.day = day;
            u.repaidWars = 0;
            u.toppedUpUsdt = 0;
        }
    }

    // ---------------------------------------------------------------- views

    function limitsOf(address borrower) external view returns (Limits memory) {
        return _limits[borrower];
    }

    function usageOf(address borrower) external view returns (Usage memory u) {
        u = _usage[borrower];
        if (u.day != uint64(block.timestamp / 1 days)) {
            u.repaidWars = 0;
            u.toppedUpUsdt = 0;
        }
    }
}
