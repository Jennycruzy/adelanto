// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CreditBook} from "../../src/CreditBook.sol";
import {ICreditBook} from "../../src/interfaces/ICreditBook.sol";

contract CreditBookTest is Test {
    CreditBook b;
    address p = makeAddr("pool");
    address u = makeAddr("user");

    function setUp() public {
        vm.warp(1_762_300_000);
        b = new CreditBook();
        b.bindPool(p);
    }

    /// @dev A loan opened a week and a day ago, after the last one closed, closes now.
    function _close(bool onTime) internal {
        vm.warp(block.timestamp + 8 days);
        b.recordClosed(u, onTime, uint64(block.timestamp - 7 days - 1));
    }

    function test_bindOnlyOnce() public {
        vm.expectRevert(CreditBook.AlreadyBound.selector);
        b.bindPool(address(1));
    }

    function test_bindOnlyDeployer() public {
        CreditBook c = new CreditBook();
        vm.prank(u);
        vm.expectRevert(CreditBook.NotDeployer.selector);
        c.bindPool(p);
    }

    function test_bindRejectsZero() public {
        CreditBook c = new CreditBook();
        vm.expectRevert(CreditBook.ZeroAddress.selector);
        c.bindPool(address(0));
    }

    function test_onlyPoolWrites() public {
        vm.expectRevert(CreditBook.NotPool.selector);
        b.recordOpen(u, 1);
        vm.expectRevert(CreditBook.NotPool.selector);
        b.recordRepayment(u, 1);
        vm.expectRevert(CreditBook.NotPool.selector);
        b.recordClosed(u, true, 0);
        vm.expectRevert(CreditBook.NotPool.selector);
        b.recordLiquidation(u);
    }

    function test_openRecordsAmountsAndTimes() public {
        vm.warp(1000);
        vm.prank(p);
        b.recordOpen(u, 5e18);
        vm.warp(2000);
        vm.prank(p);
        b.recordOpen(u, 7e18);
        ICreditBook.Record memory r = b.recordOf(u);
        assertEq(r.opened, 2);
        assertEq(r.pesosBorrowed, 12e18);
        assertEq(r.firstLoanAt, 1000);
        assertEq(r.lastLoanAt, 2000);
    }

    function test_repaymentAccumulates() public {
        vm.startPrank(p);
        b.recordRepayment(u, 3e18);
        b.recordRepayment(u, 4e18);
        vm.stopPrank();
        assertEq(b.recordOf(u).pesosRepaid, 7e18);
    }

    function test_tierSteps() public {
        assertEq(b.tier(u), 0);
        vm.startPrank(p);
        _close(true);
        assertEq(b.tier(u), 1);
        _close(true);
        assertEq(b.tier(u), 1);
        _close(true);
        assertEq(b.tier(u), 2);
        _close(true);
        _close(true);
        assertEq(b.tier(u), 2);
        _close(true);
        assertEq(b.tier(u), 3);
        _close(true);
        assertEq(b.tier(u), 3);
        vm.stopPrank();
    }

    function test_lateDoesNotRaiseTier() public {
        vm.startPrank(p);
        _close(false);
        _close(false);
        vm.stopPrank();
        assertEq(b.tier(u), 0);
        assertEq(b.recordOf(u).repaidLate, 2);
    }

    function test_liquidationResetsStepsButKeepsHistory() public {
        vm.startPrank(p);
        for (uint256 i; i < 6; i++) {
            _close(true);
        }
        b.recordLiquidation(u);
        vm.stopPrank();
        ICreditBook.Record memory r = b.recordOf(u);
        assertEq(b.tier(u), 0);
        assertEq(r.repaidOnTime, 6);
        assertEq(r.liquidated, 1);
    }

    function testFuzz_tierMatchesCount(uint8 n) public {
        n = uint8(bound(n, 0, 20));
        vm.startPrank(p);
        for (uint256 i; i < n; i++) {
            _close(true);
        }
        vm.stopPrank();
        uint8 expected = n >= 6 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0;
        assertEq(b.tier(u), expected);
    }

    function test_instantRepayDoesNotCount() public {
        vm.startPrank(p);
        for (uint256 i; i < 6; i++) {
            b.recordClosed(u, true, uint64(block.timestamp));
        }
        vm.stopPrank();
        assertEq(b.tier(u), 0);
        assertEq(b.recordOf(u).repaidOnTime, 6);
    }

    function test_loanHeldUnderAWeekDoesNotCount() public {
        uint64 opened = uint64(block.timestamp);
        vm.warp(block.timestamp + 7 days - 1);
        vm.prank(p);
        b.recordClosed(u, true, opened);
        assertEq(b.tier(u), 0);
        vm.warp(block.timestamp + 1);
        vm.prank(p);
        b.recordClosed(u, true, opened);
        assertEq(b.tier(u), 1);
    }

    function test_parallelLoansCountOnce() public {
        // Six loans opened together and repaid together after a week earn one step, not three.
        uint64 opened = uint64(block.timestamp);
        vm.warp(block.timestamp + 8 days);
        vm.startPrank(p);
        for (uint256 i; i < 6; i++) {
            b.recordClosed(u, true, opened);
        }
        vm.stopPrank();
        assertEq(b.tier(u), 1);
        assertEq(b.recordOf(u).onTimeSinceLiquidation, 1);
    }
}
