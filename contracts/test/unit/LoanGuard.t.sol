// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {LoanGuard} from "../../src/LoanGuard.sol";

contract LoanGuardTest is Base {
    uint256 id;
    bytes32 constant RULE = keccak256(unicode"Que mi préstamo nunca llegue a riesgo; usá hasta 20 dólares más por semana.");

    function setUp() public override {
        super.setUp();
        id = _borrow(alice, 1_000e6, 980_000e18, 30);
        wars.mint(alice, 500_000e18);
    }

    function _limits() internal view returns (LoanGuard.Limits memory l) {
        l = LoanGuard.Limits({
            autoRepay: true,
            rateWatch: false,
            protectOrder: LoanGuard.ProtectOrder.TopUpFirst,
            expiry: uint64(block.timestamp + 90 days),
            keepWarsBuffer: 50_000e18,
            maxRepayWarsPerDay: 200_000e18,
            maxTopUpUsdtPerDay: 100e6,
            maxRateBps: 4_000
        });
    }

    function _set() internal {
        vm.prank(alice);
        guard.setLimits(_limits(), RULE);
    }

    function _atRisk() internal {
        _setTick(TICK_1650 + 1700); // about 71%
        assertGe(pool.loanLtvBps(id), 7_000);
    }

    // ---------------------------------------------------------------- borrower controls

    function test_setLimitsStoresRuleHash() public {
        _set();
        assertEq(guard.ruleHashOf(alice), RULE);
        LoanGuard.Limits memory l = guard.limitsOf(alice);
        assertEq(l.maxTopUpUsdtPerDay, 100e6);
        assertTrue(l.autoRepay);
    }

    function test_expiryMustBeFuture() public {
        LoanGuard.Limits memory l = _limits();
        l.expiry = uint64(block.timestamp);
        vm.prank(alice);
        vm.expectRevert(LoanGuard.BadExpiry.selector);
        guard.setLimits(l, RULE);
    }

    function test_expiryAtMost180Days() public {
        LoanGuard.Limits memory l = _limits();
        l.expiry = uint64(block.timestamp + 181 days);
        vm.prank(alice);
        vm.expectRevert(LoanGuard.BadExpiry.selector);
        guard.setLimits(l, RULE);
    }

    function test_revokeClears() public {
        _set();
        vm.prank(alice);
        guard.revoke();
        assertEq(guard.ruleHashOf(alice), bytes32(0));
        _atRisk();
        vm.prank(agent);
        vm.expectRevert(LoanGuard.NoLimits.selector);
        guard.protectWithTopUp(id, 10e6);
    }

    // ---------------------------------------------------------------- protect with top-up

    function test_topUpWhenAtRisk() public {
        _set();
        _atRisk();
        uint256 before = pool.loanLtvBps(id);
        vm.prank(agent);
        guard.protectWithTopUp(id, 100e6);
        assertEq(pool.loans(id).collateral, 1_100e6);
        assertLt(pool.loanLtvBps(id), before);
        assertEq(usdt.balanceOf(address(guard)), 0);
    }

    function test_topUpNotAtRiskReverts() public {
        _set();
        vm.prank(agent);
        vm.expectRevert();
        guard.protectWithTopUp(id, 10e6);
    }

    function test_topUpOnlyAgent() public {
        _set();
        _atRisk();
        vm.prank(bob);
        vm.expectRevert(LoanGuard.NotAgent.selector);
        guard.protectWithTopUp(id, 10e6);
    }

    function test_topUpDailyLimit() public {
        _set();
        _atRisk();
        vm.prank(agent);
        guard.protectWithTopUp(id, 60e6);
        _setTick(TICK_1650 + 2600); // at risk again
        vm.prank(agent);
        vm.expectRevert(LoanGuard.OverDailyLimit.selector);
        guard.protectWithTopUp(id, 41e6);
    }

    function test_topUpLimitResetsNextDay() public {
        _set();
        _atRisk();
        vm.prank(agent);
        guard.protectWithTopUp(id, 100e6);
        _skip(1 days);
        _setTick(TICK_1650 + 2600);
        vm.prank(agent);
        guard.protectWithTopUp(id, 100e6);
        assertEq(pool.loans(id).collateral, 1_200e6);
    }

    function test_topUpAfterExpiryReverts() public {
        _set();
        _skip(91 days);
        _atRisk();
        vm.prank(agent);
        vm.expectRevert(LoanGuard.Expired.selector);
        guard.protectWithTopUp(id, 10e6);
    }

    function test_topUpWhenPriceRefusedReverts() public {
        _set();
        _setTick(TICK_1650 + 1700);
        uni.setSpot(TICK_1650 + 2200); // spot 5% from the average
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LoanGuard.PriceRefused.selector, uint8(2)));
        guard.protectWithTopUp(id, 10e6);
    }

    function test_topUpZeroReverts() public {
        _set();
        vm.prank(agent);
        vm.expectRevert(LoanGuard.ZeroAmount.selector);
        guard.protectWithTopUp(id, 0);
    }

    function test_topUpOnClosedLoanReverts() public {
        _set();
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        vm.prank(agent);
        vm.expectRevert(LoanGuard.NotThisBorrower.selector);
        guard.protectWithTopUp(id, 10e6);
    }

    function test_topUpOnlyBorrowersOwnFunds() public {
        // Bob has funds approved to the guard but no limits; Alice's loan never pulls Bob's money.
        _set();
        _atRisk();
        uint256 bobBefore = usdt.balanceOf(bob);
        vm.prank(agent);
        guard.protectWithTopUp(id, 50e6);
        assertEq(usdt.balanceOf(bob), bobBefore);
    }

    // ---------------------------------------------------------------- protect with repay

    function test_repayToProtect() public {
        _set();
        _atRisk();
        uint256 d = pool.debtOf(id);
        vm.prank(agent);
        guard.protectWithRepay(id, 100_000e18);
        assertApproxEqAbs(pool.debtOf(id), d - 100_000e18, 2);
    }

    function test_repayToProtectNotAtRiskReverts() public {
        _set();
        vm.prank(agent);
        vm.expectRevert();
        guard.protectWithRepay(id, 100_000e18);
    }

    function test_repayKeepsBuffer() public {
        _set();
        _atRisk();
        // leave Alice 100,000 pesos; repaying 60,000 would drop her under the 50,000 buffer
        uint256 bal = wars.balanceOf(alice);
        vm.prank(alice);
        wars.transfer(bob, bal - 100_000e18);
        vm.prank(agent);
        vm.expectRevert(LoanGuard.BufferBreached.selector);
        guard.protectWithRepay(id, 60_000e18);
        vm.prank(agent);
        guard.protectWithRepay(id, 50_000e18); // exactly the buffer left is fine
        assertEq(wars.balanceOf(alice), 50_000e18);
    }

    // ---------------------------------------------------------------- auto repay

    function test_autoRepay() public {
        _set();
        uint256 d = pool.debtOf(id);
        vm.prank(agent);
        guard.autoRepay(id, 150_000e18);
        assertApproxEqAbs(pool.debtOf(id), d - 150_000e18, 2);
    }

    function test_autoRepayOffReverts() public {
        LoanGuard.Limits memory l = _limits();
        l.autoRepay = false;
        vm.prank(alice);
        guard.setLimits(l, RULE);
        vm.prank(agent);
        vm.expectRevert(LoanGuard.AutoRepayOff.selector);
        guard.autoRepay(id, 1e18);
    }

    function test_autoRepayDailyLimit() public {
        _set();
        vm.prank(agent);
        guard.autoRepay(id, 150_000e18);
        vm.prank(agent);
        vm.expectRevert(LoanGuard.OverDailyLimit.selector);
        guard.autoRepay(id, 60_000e18);
    }

    function test_autoRepayCappedAtDebtAndClosesLoan() public {
        LoanGuard.Limits memory l = _limits();
        l.maxRepayWarsPerDay = 2_000_000e18;
        l.keepWarsBuffer = 0;
        vm.prank(alice);
        guard.setLimits(l, RULE);
        wars.mint(alice, 1_000_000e18);
        uint256 d = pool.debtOf(id);
        uint256 bal = wars.balanceOf(alice);
        vm.prank(agent);
        guard.autoRepay(id, 2_000_000e18);
        assertFalse(pool.loans(id).open);
        assertEq(wars.balanceOf(alice), bal - d);
        assertEq(usdt.balanceOf(alice), 100_000e6); // collateral back to Alice, not the guard
        assertEq(wars.balanceOf(address(guard)), 0);
    }

    function test_autoRepayOnlyAgent() public {
        _set();
        vm.prank(alice);
        vm.expectRevert(LoanGuard.NotAgent.selector);
        guard.autoRepay(id, 1e18);
    }

    function test_usageResetsView() public {
        _set();
        vm.prank(agent);
        guard.autoRepay(id, 10_000e18);
        assertEq(guard.usageOf(alice).repaidWars, 10_000e18);
        _skip(1 days);
        assertEq(guard.usageOf(alice).repaidWars, 0);
    }

    // ---------------------------------------------------------------- the agent can never exceed limits

    function testFuzz_guardLimits(uint256 topUp, uint256 repayAmt, uint8 calls) public {
        _set();
        _setTick(TICK_1650 + 2200);
        calls = uint8(bound(calls, 1, 8));
        uint256 usdtStart = usdt.balanceOf(alice);
        uint256 warsStart = wars.balanceOf(alice);
        for (uint256 i; i < calls; i++) {
            topUp = bound(uint256(keccak256(abi.encode(topUp, i))), 1, 200e6);
            repayAmt = bound(uint256(keccak256(abi.encode(repayAmt, i))), 1, 300_000e18);
            vm.startPrank(agent);
            try guard.protectWithTopUp(id, topUp) {} catch {}
            try guard.protectWithRepay(id, repayAmt) {} catch {}
            try guard.autoRepay(id, repayAmt) {} catch {}
            vm.stopPrank();
        }
        assertLe(usdtStart - usdt.balanceOf(alice), 100e6, "USDT per day");
        assertLe(warsStart - wars.balanceOf(alice), 200_000e18, "wARS per day");
        assertGe(wars.balanceOf(alice), 50_000e18, "buffer");
        assertEq(usdt.balanceOf(address(guard)), 0);
        assertEq(wars.balanceOf(address(guard)), 0);
    }

    function testFuzz_agentCannotTouchStrangers(uint256 amt) public {
        amt = bound(amt, 1, 1_000e6);
        // Bob approved the guard but has no loan and no limits.
        vm.startPrank(agent);
        vm.expectRevert();
        guard.protectWithTopUp(999, amt);
        vm.expectRevert();
        guard.autoRepay(999, amt);
        vm.stopPrank();
        assertEq(usdt.balanceOf(bob), 100_000e6);
    }
}
