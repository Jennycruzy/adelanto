// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PesoPool} from "./PesoPool.sol";
import {IPriceModule} from "./interfaces/IPriceModule.sol";

/// @title GentleKeeper
/// @notice The agent's way to liquidate: it repays the smallest amount that brings a loan back to 78% of its
/// collateral (2 points under the 80% line, so ordinary price noise does not sell again at once), computed inside the
/// liquidation transaction from that moment's debt and price. A price move between the agent's decision and the block
/// can never make it take more of the borrower's dollars than needed, and the 5% bonus is paid only on that small
/// amount.
/// The agent supplies the pesos and receives the dollars; nothing stays here between calls.
contract GentleKeeper is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 public constant TARGET_LTV_BPS = 7_800;
    uint256 internal constant BPS = 10_000;

    PesoPool public immutable pool;
    IERC20 public immutable wars;
    IERC20 public immutable usdt;
    address public immutable agent;

    event GentleLiquidation(uint256 indexed loanId, uint256 wanted, uint256 repaid, uint256 seized);

    error NotAgent();
    error NotNeeded();

    constructor(PesoPool pool_, address agent_) {
        pool = pool_;
        wars = IERC20(pool_.asset());
        usdt = pool_.usdt();
        agent = agent_;
    }

    /// @notice The smallest repayment that brings `loanId` back to 78% right now (0 if it is not past 80%), before the
    /// pool's cap of half the debt (all of it under 10,000 wARS).
    function wanted(uint256 loanId) public view returns (uint256) {
        PesoPool.Loan memory l = pool.loans(loanId);
        if (!l.open) return 0;
        uint256 debt = pool.debtOf(loanId);
        uint256 price = IPriceModule(address(pool.priceModule())).liquidationPrice();
        uint256 value = uint256(l.collateral).mulDiv(price, pool.usdtUnit());
        if (debt * BPS <= value * pool.LIQUIDATION_LTV_BPS()) return 0;
        // Solve (debt - x) * BPS <= target * (value - x * (1 + bonus)) for x.
        uint256 num = debt * BPS - TARGET_LTV_BPS * value;
        uint256 den = BPS * BPS - TARGET_LTV_BPS * (BPS + pool.LIQUIDATION_BONUS_BPS());
        return num.mulDiv(BPS, den, Math.Rounding.Ceil) + 12; // covers the pool's debt rounding with a provable margin
    }

    /// @notice Liquidate `loanId` gently, using at most `maxPesos` of the agent's wARS.
    function liquidateGently(uint256 loanId, uint256 maxPesos) external nonReentrant returns (uint256 repaid, uint256 seized) {
        if (msg.sender != agent) revert NotAgent();
        uint256 want = wanted(loanId);
        if (want == 0) revert NotNeeded();
        uint256 pesos = want < maxPesos ? want : maxPesos;
        wars.safeTransferFrom(agent, address(this), pesos);
        wars.forceApprove(address(pool), pesos);
        (repaid, seized) = pool.liquidate(loanId, pesos);
        wars.forceApprove(address(pool), 0);
        uint256 left = wars.balanceOf(address(this));
        if (left > 0) wars.safeTransfer(agent, left);
        usdt.safeTransfer(agent, usdt.balanceOf(address(this)));
        emit GentleLiquidation(loanId, want, repaid, seized);
    }
}
