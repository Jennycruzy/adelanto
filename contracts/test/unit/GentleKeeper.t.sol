// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {GentleKeeper} from "../../src/GentleKeeper.sol";
import {PesoPool} from "../../src/PesoPool.sol";

/// @dev GentleKeeper against the real PesoPool with mock tokens and a mock Uniswap pool (no network needed).
contract GentleKeeperTest is Base {
    GentleKeeper gk;
    address other = makeAddr("other");

    function setUp() public override {
        super.setUp();
        gk = new GentleKeeper(pool, keeper);
        vm.prank(keeper);
        wars.approve(address(gk), type(uint256).max);
        _fund(other, 50_000_000e18, 0);
    }

    /// The pool's exact test (no rounding up): is the loan above `bps` of its collateral at the 30-minute price?
    function _above(uint256 id, uint256 bps) internal view returns (bool) {
        PesoPool.Loan memory l = pool.loans(id);
        uint256 value = uint256(l.collateral) * price.liquidationPrice() / 1e6;
        return pool.debtOf(id) * 10_000 > value * bps;
    }

    /// A loan of `pesos` at 59% of 1,650 pesos per dollar, then the dollar falls until it passes `bps`.
    function _loanPast(uint256 pesos, uint256 bps) internal returns (uint256 id) {
        uint256 dollars = pesos * 1e6 * 10_000 / (5_900 * _px()) + 1;
        _fund(alice, 0, dollars);
        id = _borrow(alice, dollars, pesos, 30);
        int24 t = TICK_1650;
        while (!_above(id, bps)) {
            t += 20; // a cheaper dollar in pesos
            _setTick(t);
        }
    }

    function _noLeftovers() internal view {
        assertEq(wars.balanceOf(address(gk)), 0, "no pesos left in the keeper");
        assertEq(usdt.balanceOf(address(gk)), 0, "no dollars left in the keeper");
        assertEq(wars.allowance(address(gk), address(pool)), 0, "no approval left to the pool");
    }

    function test_smallLoanBackTo78AndMinimal() public {
        uint256 id = _loanPast(5_000e18, 8_000);
        uint256 want = gk.wanted(id);
        uint256 step = price.liquidationPrice() / 1e6; // one micro-USDT of seized value
        uint256 slack = step * 7_800 / (10_000 - 8_190) + 1e12;

        uint256 snap = vm.snapshotState();
        vm.prank(other);
        pool.liquidate(id, want - slack);
        assertTrue(_above(id, 7_800), "less than wanted by more than rounding is not enough");
        vm.revertToState(snap);

        uint256 usdtBefore = usdt.balanceOf(keeper);
        vm.prank(keeper);
        (uint256 repaid, uint256 seized) = gk.liquidateGently(id, type(uint256).max);
        assertEq(repaid, want);
        assertFalse(_above(id, 7_800), "back to 78%");
        assertEq(usdt.balanceOf(keeper) - usdtBefore, seized);
        _noLeftovers();
    }

    function test_takesFarLessThanTheOldTarget() public {
        uint256 id = _loanPast(5_000e18, 8_000);
        // what the old 70% target would have repaid, by the same formula
        PesoPool.Loan memory l = pool.loans(id);
        uint256 value = uint256(l.collateral) * price.liquidationPrice() / 1e6;
        uint256 old = (pool.debtOf(id) * 10_000 - 7_000 * value) * 10_000 / (10_000 * 10_000 - 7_000 * 10_500);
        // to 78% from just over 80% repays well under a third of that (about 14% of the debt instead of about 47%)
        assertLt(gk.wanted(id), old / 3);
        assertLt(gk.wanted(id), pool.debtOf(id) / 6);
    }

    function test_neverAboveTheCeiling() public {
        uint256 id = _loanPast(5_000e18, 8_000);
        vm.prank(keeper);
        (uint256 repaid,) = gk.liquidateGently(id, 100e18);
        assertEq(repaid, 100e18);
        assertTrue(_above(id, 7_800));
        _noLeftovers();
    }

    function test_closeFactorCapReturnsTheRest() public {
        // 200,000 wARS (above the 10,000 small-debt line) far past 80%: the pool repays at most half the debt
        uint256 id = _loanPast(200_000e18, 9_500);
        uint256 debt = pool.debtOf(id);
        uint256 before = wars.balanceOf(keeper);
        vm.prank(keeper);
        (uint256 repaid,) = gk.liquidateGently(id, type(uint256).max);
        assertLe(repaid, debt / 2 + 1);
        assertEq(before - wars.balanceOf(keeper), repaid, "only what the pool took left the agent");
        _noLeftovers();
    }

    function test_underwaterTakesAllCollateralAndReturnsTheRest() public {
        // past 105%: the pool hands over all the collateral and takes only what it is worth
        uint256 id = _loanPast(5_000e18, 10_600);
        uint256 before = wars.balanceOf(keeper);
        vm.prank(keeper);
        (uint256 repaid, uint256 seized) = gk.liquidateGently(id, type(uint256).max);
        PesoPool.Loan memory l = pool.loans(id);
        assertEq(l.collateral, 0);
        assertGt(seized, 0);
        assertEq(before - wars.balanceOf(keeper), repaid);
        _noLeftovers();
    }

    function test_lateLoanIncludesTheExtra() public {
        uint256 dollars = uint256(5_000e18) * 1e6 * 10_000 / (5_900 * _px()) + 1;
        _fund(alice, 0, dollars);
        uint256 id = _borrow(alice, dollars, 5_000e18, 7);
        _skip(400 days); // late: +5 points on top of the interest
        int24 t = TICK_1650;
        while (!_above(id, 8_000)) {
            t += 20;
            _setTick(t);
        }
        vm.prank(keeper);
        gk.liquidateGently(id, type(uint256).max);
        assertFalse(_above(id, 7_800));
        _noLeftovers();
    }

    function test_onlyTheAgent() public {
        uint256 id = _loanPast(5_000e18, 8_000);
        vm.prank(other);
        vm.expectRevert(GentleKeeper.NotAgent.selector);
        gk.liquidateGently(id, type(uint256).max);
    }

    function test_onlyPast80() public {
        uint256 dollars = uint256(5_000e18) * 1e6 * 10_000 / (5_900 * _px()) + 1;
        _fund(alice, 0, dollars);
        uint256 id = _borrow(alice, dollars, 5_000e18, 30);
        assertEq(gk.wanted(id), 0);
        vm.prank(keeper);
        vm.expectRevert(GentleKeeper.NotNeeded.selector);
        gk.liquidateGently(id, type(uint256).max);
    }

    function testFuzz_alwaysUnder78WhenNotCapped(uint256 pesos, uint16 pastBps) public {
        pesos = bound(pesos, 1_000e18, 9_000e18); // small debts: the pool lets one call repay all of it
        uint256 bps = bound(pastBps, 8_000, 9_800);
        uint256 id = _loanPast(pesos, bps);
        vm.prank(keeper);
        gk.liquidateGently(id, type(uint256).max);
        PesoPool.Loan memory l = pool.loans(id);
        if (l.open) assertFalse(_above(id, 7_800));
        _noLeftovers();
    }
}
