// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PesoPool} from "../../src/PesoPool.sol";
import {PriceModule} from "../../src/PriceModule.sol";
import {CreditBook} from "../../src/CreditBook.sol";
import {GentleKeeper} from "../../src/GentleKeeper.sol";
import {IPriceModule} from "../../src/interfaces/IPriceModule.sol";
import {ICreditBook} from "../../src/interfaces/ICreditBook.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";

/// @dev Celo mainnet state (real wARS, USDT, Uniswap pool). Needs CELO_RPC_URL.
contract GentleKeeperForkTest is Test {
    address constant WARS = 0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant UNI = 0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391;

    PriceModule price;
    PesoPool pool;
    GentleKeeper keeper;
    address lender = makeAddr("lender");
    address alice = makeAddr("alice");
    address agent = makeAddr("agent");
    address other = makeAddr("other");
    bool live;
    uint256 loanId;

    function setUp() public {
        string memory rpc = vm.envOr("CELO_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        price = new PriceModule(IUniswapV3Pool(UNI), WARS, USDT, 10_000_000e18);
        CreditBook book = new CreditBook();
        pool = new PesoPool(
            IERC20(WARS), IERC20(USDT), IPriceModule(address(price)), ICreditBook(address(book)), IUniswapV3Pool(UNI),
            makeAddr("treasury"), address(this), PesoPool.Caps({absolute: 20_000_000e18, depositsBps: 7_000, depthBps: 6_500})
        );
        book.bindPool(address(pool));
        keeper = new GentleKeeper(pool, agent);

        deal(WARS, lender, 1_000_000e18);
        vm.startPrank(lender);
        IERC20(WARS).approve(address(pool), type(uint256).max);
        pool.deposit(1_000_000e18, lender);
        vm.stopPrank();

        // alice borrows 50,000 wARS close to the 60% line
        uint256 p = price.borrowPrice();
        uint256 collateral = uint256(50_000e18) * 1e6 * 10_000 / (5_990 * p) + 1;
        deal(USDT, alice, collateral);
        vm.startPrank(alice);
        IERC20(USDT).approve(address(pool), collateral);
        loanId = pool.borrow(collateral, 50_000e18, 7, 20_000);
        vm.stopPrank();

        // interest (and the late extra) push it past 80%
        uint256 t = block.timestamp; // a local clock: with via_ir, block.timestamp can be cached inside one function
        while (pool.loanLtvBps(loanId) <= 8_000) {
            t += 10 days;
            vm.warp(t);
        }

        deal(WARS, agent, 100_000e18);
        vm.prank(agent);
        IERC20(WARS).approve(address(keeper), type(uint256).max);
        deal(WARS, other, 100_000e18);
        vm.prank(other);
        IERC20(WARS).approve(address(pool), type(uint256).max);
    }

    /// The pool's exact test, without the rounding up that loanLtvBps applies for display.
    function aboveTarget() internal view returns (bool) {
        PesoPool.Loan memory l = pool.loans(loanId);
        uint256 value = uint256(l.collateral) * price.liquidationPrice() / 1e6;
        return pool.debtOf(loanId) * 10_000 > value * 7_000;
    }

    function test_backTo70AndNoMore() public {
        if (!live) return;
        uint256 want = keeper.wanted(loanId);
        assertGt(want, 0);

        // Minimal to within the pool's own rounding: it floors the dollars it hands over to whole micro-USDT, which
        // leaves up to one micro-USDT of slack. Less than `want` by more than that slack (~0.0044 pesos at 1,660
        // pesos per dollar) leaves the loan strictly above 70% by the pool's exact ratio (on a copy of the state).
        uint256 step = price.liquidationPrice() / 1e6; // wARS value of one micro-USDT
        uint256 slack = step * 7_000 / (10_000 - 7_350) + 1e12;
        uint256 snap = vm.snapshotState();
        vm.prank(other);
        pool.liquidate(loanId, want - slack);
        assertTrue(aboveTarget(), "less than want by more than one micro-USDT of rounding must not be enough");
        vm.revertToState(snap);

        uint256 usdtBefore = IERC20(USDT).balanceOf(agent);
        vm.prank(agent);
        (uint256 repaid, uint256 seized) = keeper.liquidateGently(loanId, type(uint256).max);
        assertEq(repaid, want);
        assertFalse(aboveTarget(), "back to 70% by the exact ratio");
        assertLe(pool.loanLtvBps(loanId), 7_000);
        assertEq(IERC20(USDT).balanceOf(agent) - usdtBefore, seized);
        assertEq(IERC20(WARS).balanceOf(address(keeper)), 0, "no pesos left behind");
        assertEq(IERC20(USDT).balanceOf(address(keeper)), 0, "no dollars left behind");
        assertEq(IERC20(WARS).allowance(address(keeper), address(pool)), 0, "no approval left behind");
    }

    function test_neverAboveTheAgentsCeiling() public {
        if (!live) return;
        vm.prank(agent);
        (uint256 repaid,) = keeper.liquidateGently(loanId, 1_000e18);
        assertEq(repaid, 1_000e18);
        assertGt(pool.loanLtvBps(loanId), 7_000);
    }

    function test_onlyTheAgent() public {
        if (!live) return;
        vm.prank(other);
        vm.expectRevert(GentleKeeper.NotAgent.selector);
        keeper.liquidateGently(loanId, type(uint256).max);
    }

    function test_onlyPast80() public {
        if (!live) return;
        vm.prank(agent);
        keeper.liquidateGently(loanId, type(uint256).max);
        assertEq(keeper.wanted(loanId), 0);
        vm.prank(agent);
        vm.expectRevert(GentleKeeper.NotNeeded.selector);
        keeper.liquidateGently(loanId, type(uint256).max);
    }
}
