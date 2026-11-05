// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PesoPool} from "../../src/PesoPool.sol";
import {PriceModule} from "../../src/PriceModule.sol";
import {ICreditBook} from "../../src/interfaces/ICreditBook.sol";
import {IPriceModule} from "../../src/interfaces/IPriceModule.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {CreditBook} from "../../src/CreditBook.sol";

contract PesoPoolLendTest is Base {
    function test_depositMintsSharesAndTracksCash() public view {
        assertEq(pool.cash(), 10_000_000e18);
        assertEq(pool.totalAssets(), 10_000_000e18);
        assertEq(pool.balanceOf(lender), 10_000_000e18 * 1e6);
    }

    function test_withdrawReturnsPesos() public {
        vm.prank(lender);
        pool.withdraw(1_000_000e18, lender, lender);
        assertEq(wars.balanceOf(lender), 1_000_000e18);
        assertEq(pool.cash(), 9_000_000e18);
    }

    function test_redeemAll() public {
        uint256 s = pool.balanceOf(lender);
        vm.prank(lender);
        uint256 got = pool.redeem(s, lender, lender);
        assertEq(got, 10_000_000e18);
    }

    function test_donationDoesNotChangeSharePrice() public {
        uint256 before = pool.convertToAssets(1e24);
        wars.mint(address(pool), 5_000_000e18);
        assertEq(pool.convertToAssets(1e24), before);
        assertEq(pool.totalAssets(), 10_000_000e18);
    }

    function test_firstDepositorInflationBlocked() public {
        PesoPool fresh = _freshPool();
        address attacker = makeAddr("attacker");
        wars.mint(attacker, 1_000_001e18);
        vm.startPrank(attacker);
        wars.approve(address(fresh), type(uint256).max);
        fresh.deposit(1, attacker);
        wars.transfer(address(fresh), 1_000_000e18); // donation is ignored by internal cash
        vm.stopPrank();
        wars.mint(lender2, 0);
        vm.startPrank(lender2);
        wars.approve(address(fresh), type(uint256).max);
        uint256 s = fresh.deposit(1_000e18, lender2);
        vm.stopPrank();
        assertApproxEqAbs(fresh.convertToAssets(s), 1_000e18, 1);
    }

    function test_maxWithdrawLimitedByCash() public {
        _borrowMany(6_000_000e18, 30);
        assertEq(pool.maxWithdraw(lender), pool.cash());
        assertLt(pool.maxRedeem(lender), pool.balanceOf(lender));
    }

    function test_withdrawAboveCashReverts() public {
        _borrowMany(6_000_000e18, 30);
        vm.prank(lender);
        vm.expectRevert();
        pool.withdraw(5_000_000e18, lender, lender);
    }

    function test_depositPausedReverts() public {
        vm.prank(guardian);
        pool.pause();
        vm.prank(lender2);
        vm.expectRevert();
        pool.deposit(1e18, lender2);
        vm.prank(lender2);
        vm.expectRevert();
        pool.mint(1e24, lender2);
    }

    function test_withdrawWorksWhilePaused() public {
        vm.prank(guardian);
        pool.pause();
        vm.prank(lender);
        pool.withdraw(1e18, lender, lender);
        assertEq(wars.balanceOf(lender), 1e18);
    }

    function test_interestRaisesSharePrice() public {
        _borrowMany(5_000_000e18, 90);
        uint256 before = pool.convertToAssets(1e24);
        _skip(30 days);
        assertGt(pool.convertToAssets(1e24), before);
    }

    function test_secondLenderGetsFairShares() public {
        _borrowMany(5_000_000e18, 90);
        _skip(30 days);
        uint256 s = _lend(lender2, 1_000_000e18);
        assertApproxEqRel(pool.convertToAssets(s), 1_000_000e18, 1e12);
    }

    function test_mintPathWorks() public {
        vm.prank(lender2);
        uint256 a = pool.mint(1e24, lender2);
        assertApproxEqAbs(a, 1e18, 1);
    }

    function _freshPool() internal returns (PesoPool p) {
        CreditBook b2 = new CreditBook();
        p = new PesoPool(
            IERC20(address(wars)),
            IERC20(address(usdt)),
            IPriceModule(address(price)),
            ICreditBook(address(b2)),
            IUniswapV3Pool(address(uni)),
            treasury,
            guardian,
            PesoPool.Caps({absolute: 20_000_000e18, depositsBps: 7_000, depthBps: 1_500})
        );
        b2.bindPool(address(p));
    }
}

contract PesoPoolBorrowTest is Base {
    function test_borrowPaysPesosMinusFee() public {
        uint256 id = _borrow(alice, 1_000e6, 900_000e18, 30);
        uint256 fee = 900_000e18 * 25 / 10_000;
        assertEq(wars.balanceOf(alice), 900_000e18 - fee);
        assertEq(wars.balanceOf(treasury), fee);
        assertEq(usdt.balanceOf(address(pool)), 1_000e6);
        assertEq(pool.totalCollateral(), 1_000e6);
        assertApproxEqAbs(pool.debtOf(id), 900_000e18, 1);
        assertEq(pool.cash(), 10_000_000e18 - 900_000e18);
    }

    function test_loanFields() public {
        uint256 id = _borrow(alice, 1_000e6, 900_000e18, 60);
        PesoPool.Loan memory l = pool.loans(id);
        assertEq(l.borrower, alice);
        assertEq(l.tier, 0);
        assertTrue(l.open);
        assertEq(l.termDays, 60);
        assertEq(l.dueAt, block.timestamp + 60 days);
        assertEq(l.collateral, 1_000e6);
        assertEq(pool.nextLoanId(), id + 1);
    }

    function test_recordsOpenInCreditBook() public {
        _borrow(alice, 1_000e6, 900_000e18, 30);
        ICreditBook.Record memory r = book.recordOf(alice);
        assertEq(r.opened, 1);
        assertEq(r.pesosBorrowed, 900_000e18);
    }

    function testFuzz_badTermReverts(uint16 term) public {
        vm.assume(term != 7 && term != 30 && term != 60 && term != 90);
        vm.prank(alice);
        vm.expectRevert(PesoPool.BadTerm.selector);
        pool.borrow(1_000e6, 100_000e18, term, 10_000);
    }

    function test_allTermsWork() public {
        _borrow(alice, 100e6, 50_000e18, 7);
        _borrow(alice, 100e6, 50_000e18, 30);
        _borrow(alice, 100e6, 50_000e18, 60);
        _borrow(alice, 100e6, 50_000e18, 90);
        assertEq(pool.nextLoanId(), 5);
    }

    function test_belowMinimumReverts() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.BelowMinimum.selector);
        pool.borrow(10e6, 999e18, 30, 10_000);
    }

    function test_minimumLoanWorksWithOneDollarAndAHalf() public {
        _borrow(alice, 1.5e6, 1_000e18, 7);
    }

    function test_aboveFirstLoanLimitReverts() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.AboveLoanLimit.selector);
        pool.borrow(10_000e6, 1_000_001e18, 30, 10_000);
    }

    function test_aboveLtvReverts() public {
        uint256 max = 1_000e6 * _px() / 1e6 * 6_000 / 10_000;
        vm.prank(alice);
        vm.expectRevert(PesoPool.AboveBorrowLimit.selector);
        pool.borrow(1_000e6, max + 1e18, 30, 10_000);
    }

    function test_atLtvLimitWorks() public {
        uint256 max = 1_000e6 * _px() / 1e6 * 6_000 / 10_000;
        _borrow(alice, 1_000e6, max, 30);
    }

    function test_usesLowerSpotWhenSpotDips() public {
        uni.setSpot(TICK_1650 + 150); // spot fewer pesos per dollar
        uint256 maxAtTwap = 1_000e6 * price.twap(1800) / 1e6 * 6_000 / 10_000;
        vm.prank(alice);
        vm.expectRevert(PesoPool.AboveBorrowLimit.selector);
        pool.borrow(1_000e6, maxAtTwap, 30, 10_000);
    }

    function test_priceRefusedBlocksBorrow() public {
        uni.setSpot(TICK_1650 + 400);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PriceModule.PriceRefused.selector, uint8(2)));
        pool.borrow(1_000e6, 100_000e18, 30, 10_000);
    }

    function test_pausedBlocksBorrow() public {
        vm.prank(guardian);
        pool.pause();
        vm.prank(alice);
        vm.expectRevert(PesoPool.IsPaused.selector);
        pool.borrow(1_000e6, 100_000e18, 30, 10_000);
    }

    function test_depositsCap() public {
        // 70% of 10M = 7M
        _borrowMany(7_000_000e18, 30); // exactly 70% of 10M
        vm.prank(bob);
        vm.expectRevert(PesoPool.AboveCap.selector);
        pool.borrow(10_000e6, 1_000e18, 30, 100_000);
    }

    function test_absoluteCap() public {
        pool.lowerCaps(PesoPool.Caps({absolute: 500_000e18, depositsBps: 7_000, depthBps: 1_500}));
        vm.prank(alice);
        vm.expectRevert(PesoPool.AboveCap.selector);
        pool.borrow(1_000e6, 500_001e18, 30, 10_000);
        _borrow(alice, 1_000e6, 500_000e18, 30);
    }

    function test_depthCap() public {
        pool.lowerCaps(PesoPool.Caps({absolute: 20_000_000e18, depositsBps: 7_000, depthBps: 1}));
        // 0.01% of 127.5M = 12,750
        vm.prank(alice);
        vm.expectRevert(PesoPool.AboveCap.selector);
        pool.borrow(1_000e6, 12_751e18, 30, 10_000);
        _borrow(alice, 1_000e6, 12_750e18, 30);
    }

    function test_notEnoughCash() public {
        pool.scheduleCaps(PesoPool.Caps({absolute: 20_000_000e18, depositsBps: 10_000, depthBps: 10_000}));
        _skip(1 days);
        pool.executeCaps();
        for (uint256 i; i < 10; i++) {
            address w = makeAddr(string(abi.encode("c", i)));
            _fund(w, 0, 10_000e6);
            _borrow(w, 10_000e6, 1_000_000e18, 30);
        }
        vm.prank(alice);
        vm.expectRevert(PesoPool.NotEnoughCash.selector);
        pool.borrow(10_000e6, 1_000e18, 30, 100_000);
    }

    function test_rateAboveMaxReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PesoPool.RateAboveMax.selector, uint256(2_357)));
        pool.borrow(1_000e6, 900_000e18, 30, 2_356);
    }

    function test_maxRateExactlyAllowed() public {
        vm.prank(alice);
        pool.borrow(1_000e6, 900_000e18, 30, 2_357); // 9% use: 22 + 14 * 0.09 / 0.8
    }

    function test_noCollateralApprovalReverts() public {
        address c = makeAddr("carol");
        usdt.mint(c, 1_000e6);
        vm.prank(c);
        vm.expectRevert();
        pool.borrow(1_000e6, 100_000e18, 30, 10_000);
    }

    function test_borrowWithPermit() public {
        (address dan, uint256 pk) = makeAddrAndKey("dan");
        usdt.mint(dan, 1_000e6);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdt.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        dan,
                        address(pool),
                        1_000e6,
                        0,
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        vm.prank(dan);
        uint256 id = pool.borrowWithPermit(1_000e6, 500_000e18, 30, 10_000, deadline, v, r, s);
        assertEq(pool.loans(id).collateral, 1_000e6);
    }

    function test_permitFrontRunStillBorrows() public {
        (address dan, uint256 pk) = makeAddrAndKey("dan");
        usdt.mint(dan, 1_000e6);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdt.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        dan,
                        address(pool),
                        1_000e6,
                        0,
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        usdt.permit(dan, address(pool), 1_000e6, deadline, v, r, s); // someone else submits it first
        vm.prank(dan);
        pool.borrowWithPermit(1_000e6, 500_000e18, 30, 10_000, deadline, v, r, s);
    }
}

contract PesoPoolRateTest is Base {
    function test_rateAtZeroUse() public view {
        assertEq(pool.borrowRateBps(0), 2_200);
    }

    function test_rateAtHalfUse() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        _borrow(bob, 10_000e6, 1_000_000e18, 90);
        for (uint256 i; i < 3; i++) {
            address w = makeAddr(string(abi.encode("r", i)));
            _fund(w, 0, 10_000e6);
            _borrow(w, 10_000e6, 1_000_000e18, 90);
        }
        // 5M of 10M = 50%: 22 + 14 * 0.5/0.8 = 30.75%
        assertEq(pool.utilizationBps(), 5_000);
        assertEq(pool.borrowRateBps(0), 3_075);
    }

    function test_rateCurveAboveKink() public {
        pool.scheduleCaps(PesoPool.Caps({absolute: 20_000_000e18, depositsBps: 10_000, depthBps: 10_000}));
        _skip(1 days);
        pool.executeCaps();
        for (uint256 i; i < 9; i++) {
            address w = makeAddr(string(abi.encode("k", i)));
            _fund(w, 0, 10_000e6);
            _borrow(w, 10_000e6, 1_000_000e18, 90);
        }
        // 90%: 36 + 120 * 0.1/0.2 = 96%
        assertApproxEqAbs(pool.borrowRateBps(0), 9_600, 2);
    }

    function test_tierDiscount() public view {
        assertEq(pool.borrowRateBps(1), 2_100);
        assertEq(pool.borrowRateBps(2), 2_000);
        assertEq(pool.borrowRateBps(3), 1_900);
    }

    function test_lenderRate() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        // u = 10%: borrow 22 + 14*0.125 = 23.75%; lender = 23.75% * 10% * 90%
        uint256 expected = uint256(2_375) * 1_000 / 10_000 * 9_000 / 10_000;
        assertApproxEqAbs(pool.lenderRateBps(), expected, 1);
    }

    function test_lenderRateZeroWhenEmpty() public {
        uint256 sh = pool.balanceOf(lender);
        vm.prank(lender);
        pool.redeem(sh, lender, lender);
        assertEq(pool.lenderRateBps(), 0);
        assertEq(pool.utilizationBps(), 0);
    }

    function test_interestOverAYear() public {
        uint256 id = _borrow(alice, 10_000e6, 1_000_000e18, 90);
        uint256 r = pool.borrowRateBps(0);
        _skip(90 days);
        pool.accrue();
        // compounding per accrual over 90 days at the 10% use rate
        uint256 debt = pool.debtOf(id);
        uint256 simple = 1_000_000e18 + 1_000_000e18 * r * 90 days / (10_000 * 365 days);
        assertGt(debt, simple);
        assertApproxEqRel(debt, simple, 0.01e18);
    }

    function test_reserveGetsTenPercent() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        uint256 d0 = pool.totalDebt();
        _skip(30 days);
        pool.accrue();
        uint256 interest = pool.totalDebt() - d0;
        assertApproxEqAbs(pool.reserve(), interest / 10, 2);
    }

    function test_totalAssetsIdentity() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        _skip(10 days);
        pool.accrue();
        assertEq(pool.totalAssets(), pool.cash() + pool.totalDebt() - pool.reserve());
    }

    function test_viewMatchesAccrued() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        _skip(10 days);
        uint256 viewAssets = pool.totalAssets();
        pool.accrue();
        assertEq(pool.totalAssets(), viewAssets);
    }

    function test_accrueTwiceSameBlockNoop() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        _skip(1 days);
        pool.accrue();
        uint256 d = pool.totalDebt();
        pool.accrue();
        assertEq(pool.totalDebt(), d);
    }

    function test_indexOnlyGrows() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        uint256 last = pool.borrowIndex(0);
        for (uint256 i; i < 10; i++) {
            _skip(3 days);
            pool.accrue();
            assertGe(pool.borrowIndex(0), last);
            last = pool.borrowIndex(0);
        }
    }
}

contract PesoPoolRepayTest is Base {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = _borrow(alice, 1_000e6, 900_000e18, 30);
        wars.mint(alice, 100_000e18); // enough to cover interest and the fee
    }

    function test_partialRepay() public {
        vm.prank(alice);
        pool.repay(id, 400_000e18);
        assertApproxEqAbs(pool.debtOf(id), 500_000e18, 2);
        assertTrue(pool.loans(id).open);
    }

    function test_fullRepayReturnsCollateralAndCloses() public {
        _skip(10 days);
        uint256 debt = pool.debtOf(id);
        vm.prank(alice);
        uint256 paid = pool.repay(id, type(uint256).max);
        assertEq(paid, debt);
        assertFalse(pool.loans(id).open);
        assertEq(usdt.balanceOf(alice), 100_000e6);
        assertEq(pool.totalCollateral(), 0);
        assertEq(pool.debtOf(id), 0);
    }

    function test_overpayTakesOnlyDebt() public {
        uint256 bal = wars.balanceOf(alice);
        uint256 debt = pool.debtOf(id);
        vm.prank(alice);
        pool.repay(id, debt + 50_000e18);
        assertEq(wars.balanceOf(alice), bal - debt);
    }

    function test_anyoneCanRepay() public {
        vm.prank(keeper);
        pool.repay(id, 100_000e18);
        assertApproxEqAbs(pool.debtOf(id), 800_000e18, 2);
    }

    function test_repayClosedReverts() public {
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(PesoPool.LoanNotOpen.selector);
        pool.repay(id, 1);
    }

    function test_repayZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.ZeroAmount.selector);
        pool.repay(id, 0);
    }

    function test_repayUnknownLoanReverts() public {
        vm.expectRevert(PesoPool.LoanNotOpen.selector);
        pool.repay(999, 1);
    }

    function test_onTimeRaisesTier() public {
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        assertEq(book.tier(alice), 1);
        assertEq(book.recordOf(alice).repaidOnTime, 1);
    }

    function test_withinGraceIsOnTime() public {
        _skip(36 days);
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        assertEq(book.recordOf(alice).repaidOnTime, 1);
    }

    function test_afterGraceIsLate() public {
        _skip(38 days);
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        assertEq(book.recordOf(alice).repaidLate, 1);
        assertEq(book.tier(alice), 0);
    }

    function test_noPenaltyBeforeDue() public {
        _skip(29 days);
        uint256 d = pool.debtOf(id);
        vm.prank(alice);
        pool.repay(id, 1e18);
        assertApproxEqAbs(pool.debtOf(id), d - 1e18, 2);
    }

    function test_penaltyAfterDue() public {
        _skip(30 days);
        uint256 atDue = pool.debtOf(id);
        _skip(36.5 days); // a tenth of a year late
        uint256 withPenalty = pool.debtOf(id);
        vm.prank(alice);
        pool.repay(id, 1e18);
        // +5 points for a tenth of a year adds about 0.5% on top of normal interest
        assertGt(withPenalty, atDue * 1005 / 1000);
    }

    function test_penaltyNotChargedTwice() public {
        _skip(40 days);
        vm.prank(alice);
        pool.repay(id, 1e18);
        uint256 d = pool.debtOf(id);
        vm.prank(alice);
        pool.repay(id, 1e18);
        assertApproxEqAbs(pool.debtOf(id), d - 1e18, 2);
    }

    function test_secondLoanAtTierOneGetsMore() public {
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        uint256 max = 1_000e6 * _px() / 1e6 * 6_200 / 10_000;
        uint256 id2 = _borrow(alice, 1_000e6, max, 30);
        assertEq(pool.loans(id2).tier, 1);
    }

    function test_repayWithPermit() public {
        (address dan, uint256 pk) = makeAddrAndKey("dan2");
        _fund(dan, 0, 1_000e6);
        uint256 lid = _borrow(dan, 1_000e6, 100_000e18, 30);
        wars.mint(dan, 1_000e18);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 amt = 50_000e18;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                wars.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        dan,
                        address(pool),
                        amt,
                        wars.nonces(dan),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        vm.prank(dan);
        wars.approve(address(pool), 0);
        vm.prank(dan);
        pool.repayWithPermit(lid, amt, deadline, v, r, s);
        assertApproxEqAbs(pool.debtOf(lid), 50_000e18, 2);
    }

    function test_repayWithSwapPartial() public {
        vm.prank(alice);
        pool.repayWithSwap(id, 100e6, 1);
        assertLt(pool.debtOf(id), 900_000e18 - 160_000e18);
        assertTrue(pool.loans(id).open);
    }

    function test_repayWithSwapFullReturnsExtra() public {
        uint256 warsBefore = wars.balanceOf(alice);
        vm.prank(alice);
        pool.repayWithSwap(id, 700e6, 1);
        assertFalse(pool.loans(id).open);
        assertGt(wars.balanceOf(alice), warsBefore); // the swap gave more pesos than owed
        // collateral came back
        assertEq(usdt.balanceOf(alice), 100_000e6 - 700e6);
    }

    function test_repayWithSwapSlippage() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.SlippageExceeded.selector);
        pool.repayWithSwap(id, 100e6, 200_000e18);
    }

    function test_swapCallbackOnlyFromPool() public {
        vm.expectRevert(PesoPool.NotSwapPool.selector);
        pool.uniswapV3SwapCallback(0, 1, "");
    }

    function test_swapCallbackFromPoolOutsideSwapReverts() public {
        vm.prank(address(uni));
        vm.expectRevert(PesoPool.NotSwapPool.selector);
        pool.uniswapV3SwapCallback(0, 1, "");
    }

    function test_repayWorksWhilePausedAndPriceRefused() public {
        vm.prank(guardian);
        pool.pause();
        uni.setSpot(TICK_1650 + 500);
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        assertFalse(pool.loans(id).open);
    }

    function testFuzz_repayRoundTrip(uint256 pesos, uint256 waitDays) public {
        pesos = bound(pesos, 1_000e18, 980_000e18);
        waitDays = bound(waitDays, 0, 120);
        uint256 lid = _borrow(bob, 1_000e6, pesos, 90);
        _skip(waitDays * 1 days);
        wars.mint(bob, pesos);
        vm.prank(bob);
        pool.repay(lid, type(uint256).max);
        assertFalse(pool.loans(lid).open);
        assertEq(pool.debtOf(lid), 0);
        assertEq(usdt.balanceOf(bob), 100_000e6);
    }

    function testFuzz_partialRepaysNeverIncreaseDebt(uint256 a, uint256 b) public {
        a = bound(a, 1, 400_000e18);
        b = bound(b, 1, 400_000e18);
        uint256 d0 = pool.debtOf(id);
        vm.prank(alice);
        pool.repay(id, a);
        uint256 d1 = pool.debtOf(id);
        assertLe(d1, d0 - a + 1);
        vm.prank(alice);
        pool.repay(id, b);
        assertLe(pool.debtOf(id), d1 - b + 1);
    }
}

contract PesoPoolCollateralTest is Base {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = _borrow(alice, 1_000e6, 500_000e18, 30);
    }

    function test_anyoneAddsCollateral() public {
        _fund(keeper, 0, 100e6);
        vm.prank(keeper);
        pool.addCollateral(id, 100e6);
        assertEq(pool.loans(id).collateral, 1_100e6);
    }

    function test_addZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.ZeroAmount.selector);
        pool.addCollateral(id, 0);
    }

    function test_addToClosedReverts() public {
        wars.mint(alice, 10_000e18);
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(PesoPool.LoanNotOpen.selector);
        pool.addCollateral(id, 1e6);
    }

    function test_withdrawWithinLimit() public {
        // debt 500k; the 60% line needs collateral worth 833k pesos (~505 USDT at 1650), so ~495 can come out
        vm.prank(alice);
        pool.withdrawCollateral(id, 150e6);
        assertEq(pool.loans(id).collateral, 850e6);
        assertEq(usdt.balanceOf(alice), 99_150e6);
    }

    function test_withdrawTooMuchReverts() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.TooMuchWithdrawn.selector);
        pool.withdrawCollateral(id, 500e6);
    }

    function test_withdrawMoreThanCollateralReverts() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.TooMuchWithdrawn.selector);
        pool.withdrawCollateral(id, 1_001e6);
    }

    function test_onlyBorrowerWithdraws() public {
        vm.prank(bob);
        vm.expectRevert(PesoPool.NotBorrower.selector);
        pool.withdrawCollateral(id, 1e6);
    }

    function test_withdrawZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.ZeroAmount.selector);
        pool.withdrawCollateral(id, 0);
    }

    function test_withdrawBlockedWhenPriceRefused() public {
        uni.setSpot(TICK_1650 + 500);
        vm.prank(alice);
        vm.expectRevert();
        pool.withdrawCollateral(id, 1e6);
    }
}

contract PesoPoolLiquidationTest is Base {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = _borrow(alice, 1_000e6, 980_000e18, 90); // ~59% at 1650
    }

    /// @dev Peso strengthens: fewer pesos per dollar. +3000 ticks is about -26% pesos per dollar.
    function _pesoUp(int24 ticks) internal {
        _setTick(TICK_1650 + ticks);
    }

    function test_notLiquidatableWhenHealthy() public {
        vm.prank(keeper);
        vm.expectRevert(PesoPool.NotLiquidatable.selector);
        pool.liquidate(id, 100_000e18);
    }

    function test_atRiskButNotLiquidatable() public {
        _pesoUp(1700); // ~ -16%: ltv ~71%
        assertGt(pool.loanLtvBps(id), 7_000);
        assertLt(pool.loanLtvBps(id), 8_000);
        vm.prank(keeper);
        vm.expectRevert(PesoPool.NotLiquidatable.selector);
        pool.liquidate(id, 100_000e18);
    }

    function test_liquidateHalfWithBonus() public {
        _pesoUp(3500);
        assertGt(pool.loanLtvBps(id), 8_000);
        uint256 debt = pool.debtOf(id);
        uint256 px = price.liquidationPrice();
        vm.prank(keeper);
        (uint256 repaid, uint256 seized) = pool.liquidate(id, type(uint256).max);
        assertEq(repaid, debt / 2);
        assertEq(seized, repaid * 10_500 / 10_000 * 1e6 / px);
        assertEq(usdt.balanceOf(keeper), seized);
        assertTrue(pool.loans(id).open);
        assertEq(book.recordOf(alice).liquidated, 1);
    }

    function test_partialLiquidationImprovesHealth() public {
        _pesoUp(3500);
        uint256 before = pool.loanLtvBps(id);
        assertGt(before, 8_000);
        vm.prank(keeper);
        pool.liquidate(id, 100_000e18);
        assertLt(pool.loanLtvBps(id), before);
    }

    function test_smallDebtFullyLiquidated() public {
        uint256 small = _borrow(bob, 10e6, 9_000e18, 30);
        _pesoUp(4500);
        uint256 debt = pool.debtOf(small);
        vm.prank(keeper);
        (uint256 repaid,) = pool.liquidate(small, type(uint256).max);
        assertEq(repaid, debt);
        assertFalse(pool.loans(small).open);
        assertGt(usdt.balanceOf(bob), 100_000e6 - 10e6); // leftover collateral returned
    }

    function test_underwaterSeizesAllAndReserveCovers() public {
        _skip(60 days); // build some reserve
        pool.accrue();
        uint256 res = pool.reserve();
        assertGt(res, 0);
        uint256 small = _borrow(bob, 10e6, 9_000e18, 30);
        _pesoUp(8000); // pesos per dollar down ~55%
        uint256 debt = pool.debtOf(small);
        uint256 assetsBefore = pool.totalAssets();
        vm.prank(keeper);
        (uint256 repaid, uint256 seized) = pool.liquidate(small, type(uint256).max);
        assertEq(seized, 10e6);
        assertLt(repaid, debt);
        assertFalse(pool.loans(small).open);
        uint256 loss = debt - repaid;
        uint256 covered = loss < res ? loss : res;
        assertEq(pool.reserve(), res - covered);
        // lenders lose only what the reserve could not cover
        assertApproxEqAbs(pool.totalAssets(), assetsBefore + repaid - debt + covered, 5);
    }

    function test_liquidationWorksWhilePaused() public {
        vm.prank(guardian);
        pool.pause();
        _pesoUp(3500);
        vm.prank(keeper);
        pool.liquidate(id, 100_000e18);
    }

    function test_liquidationIgnoresSpotSpike() public {
        // A one-block spot push does not move the 30-minute average, so no liquidation.
        uni.setSpot(TICK_1650 + 5000);
        vm.prank(keeper);
        vm.expectRevert(PesoPool.NotLiquidatable.selector);
        pool.liquidate(id, 100_000e18);
    }

    function test_liquidateZeroReverts() public {
        vm.expectRevert(PesoPool.ZeroAmount.selector);
        pool.liquidate(id, 0);
    }

    function test_liquidationResetsTier() public {
        // first build a tier
        uint256 a = _borrow(bob, 100e6, 50_000e18, 7);
        wars.mint(bob, 10_000e18);
        vm.prank(bob);
        pool.repay(a, type(uint256).max);
        assertEq(book.tier(bob), 1);
        uint256 b = _borrow(bob, 100e6, 100_000e18, 30);
        _pesoUp(3500);
        vm.prank(keeper);
        pool.liquidate(b, type(uint256).max);
        assertEq(book.tier(bob), 0);
    }

    /// Regression: a liquidation that clears the whole debt used to count as an on-time repayment and raise the
    /// borrower's credit step.
    function test_fullLiquidationDoesNotRaiseTier() public {
        uint256 small = _borrow(bob, 10e6, 9_000e18, 30);
        _pesoUp(4500);
        vm.prank(keeper);
        pool.liquidate(small, type(uint256).max);
        assertFalse(pool.loans(small).open);
        assertEq(book.tier(bob), 0);
        assertEq(book.recordOf(bob).repaidOnTime, 0);
        assertEq(book.recordOf(bob).liquidated, 1);
    }

    /// Regression: repaying the rest of a loan after a partial liquidation must not count as on time either.
    function test_repayAfterPartialLiquidationDoesNotRaiseTier() public {
        _pesoUp(3500);
        vm.prank(keeper);
        pool.liquidate(id, 100_000e18);
        wars.mint(alice, 1_000_000e18);
        uint256 left = pool.loans(id).collateral;
        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        assertFalse(pool.loans(id).open);
        assertEq(book.tier(alice), 0);
        assertEq(book.recordOf(alice).repaidOnTime, 0);
        assertEq(usdt.balanceOf(alice), before + left, "what was left of the collateral comes back");
    }

    function testFuzz_seizeBounded(int24 move, uint256 want) public {
        move = int24(bound(int256(move), 3100, 9000));
        want = bound(want, 1e18, 2_000_000e18);
        _pesoUp(move);
        uint256 col = pool.loans(id).collateral;
        uint256 px = price.liquidationPrice();
        vm.prank(keeper);
        (uint256 repaid, uint256 seized) = pool.liquidate(id, want);
        assertLe(seized, col);
        // the liquidator never gets more than 5% over what they paid (1 unit rounding)
        assertLe(seized * px / 1e6, repaid * 10_500 / 10_000 + px / 1e6);
    }
}

contract PesoPoolAdminTest is Base {
    function test_onlyOwnerFunctions() public {
        vm.startPrank(alice);
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.setGuardian(alice);
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.lowerCaps(PesoPool.Caps(0, 0, 0));
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.scheduleCaps(PesoPool.Caps(0, 0, 0));
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.executeCaps();
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.scheduleReserveMove(1);
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.executeReserveMove();
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.cancelReserveMove();
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.transferOwnership(alice);
        vm.stopPrank();
    }

    function test_lowerCapsImmediate() public {
        pool.lowerCaps(PesoPool.Caps({absolute: 1e18, depositsBps: 100, depthBps: 100}));
        (uint128 a, uint16 d, uint16 p) = pool.caps();
        assertEq(a, 1e18);
        assertEq(d, 100);
        assertEq(p, 100);
    }

    function test_lowerCapsRejectsRaise() public {
        vm.expectRevert(PesoPool.CapsNotLower.selector);
        pool.lowerCaps(PesoPool.Caps({absolute: 30_000_000e18, depositsBps: 7_000, depthBps: 1_500}));
    }

    function test_raiseCapsWaits24h() public {
        pool.scheduleCaps(PesoPool.Caps({absolute: 30_000_000e18, depositsBps: 8_000, depthBps: 2_000}));
        _skip(23 hours);
        vm.expectRevert(PesoPool.NotReady.selector);
        pool.executeCaps();
        _skip(1 hours);
        pool.executeCaps();
        (uint128 a,,) = pool.caps();
        assertEq(a, 30_000_000e18);
    }

    function test_executeCapsWithoutScheduleReverts() public {
        vm.expectRevert(PesoPool.NothingScheduled.selector);
        pool.executeCaps();
    }

    function test_scheduleCapsRejectsOver100Percent() public {
        vm.expectRevert(PesoPool.AboveCap.selector);
        pool.scheduleCaps(PesoPool.Caps({absolute: 1, depositsBps: 10_001, depthBps: 1}));
    }

    function test_reserveMoveWaits48hAndIsCapped() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        _skip(60 days);
        pool.accrue();
        uint256 res = pool.reserve();
        pool.scheduleReserveMove(type(uint128).max);
        _skip(47 hours);
        vm.expectRevert(PesoPool.NotReady.selector);
        pool.executeReserveMove();
        _skip(1 hours);
        uint256 t0 = wars.balanceOf(treasury);
        pool.executeReserveMove();
        uint256 moved = wars.balanceOf(treasury) - t0;
        assertGe(moved, res);
        assertEq(pool.reserve(), 0);
    }

    function test_reserveMoveCancel() public {
        pool.scheduleReserveMove(1);
        pool.cancelReserveMove();
        vm.expectRevert(PesoPool.NothingScheduled.selector);
        pool.executeReserveMove();
    }

    function test_reserveMoveZeroReverts() public {
        vm.expectRevert(PesoPool.ZeroAmount.selector);
        pool.scheduleReserveMove(0);
    }

    function test_reserveMoveDoesNotTouchLenders() public {
        _borrow(alice, 10_000e6, 1_000_000e18, 90);
        _skip(60 days);
        pool.accrue();
        uint256 lenderAssets = pool.convertToAssets(pool.balanceOf(lender));
        pool.scheduleReserveMove(type(uint128).max);
        _skip(48 hours);
        uint256 lenderAfterWait = pool.convertToAssets(pool.balanceOf(lender));
        pool.executeReserveMove();
        assertApproxEqAbs(pool.convertToAssets(pool.balanceOf(lender)), lenderAfterWait, 2);
        assertGt(lenderAfterWait, lenderAssets);
    }

    function test_pauseGuardianOrOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.NotGuardianOrOwner.selector);
        pool.pause();
        vm.prank(guardian);
        pool.pause();
        assertTrue(pool.paused());
        vm.prank(alice);
        vm.expectRevert(PesoPool.NotGuardianOrOwner.selector);
        pool.unpause();
        pool.unpause();
        assertFalse(pool.paused());
    }

    function test_setGuardian() public {
        pool.setGuardian(bob);
        assertEq(pool.guardian(), bob);
        vm.prank(bob);
        pool.pause();
    }

    function test_ownershipTwoStep() public {
        pool.transferOwnership(bob);
        assertEq(pool.owner(), address(this));
        vm.prank(alice);
        vm.expectRevert(PesoPool.NotOwner.selector);
        pool.acceptOwnership();
        vm.prank(bob);
        pool.acceptOwnership();
        assertEq(pool.owner(), bob);
        assertEq(pool.pendingOwner(), address(0));
    }

    function test_constructorRejectsZeroTreasury() public {
        vm.expectRevert(PesoPool.ZeroAddress.selector);
        new PesoPool(
            IERC20(address(wars)),
            IERC20(address(usdt)),
            IPriceModule(address(price)),
            ICreditBook(address(book)),
            IUniswapV3Pool(address(uni)),
            address(0),
            guardian,
            PesoPool.Caps(1, 1, 1)
        );
    }

    /// @dev Every owner and guardian power, used at once, moves no user money out of the pool except reserve to the
    /// treasury.
    function test_noPrivilegedTransfers() public {
        uint256 id = _borrow(alice, 1_000e6, 500_000e18, 30);
        uint256 usdtBefore = usdt.balanceOf(address(pool));
        uint256 lenderAssets = pool.convertToAssets(pool.balanceOf(lender));
        pool.setGuardian(address(this));
        pool.pause();
        pool.lowerCaps(PesoPool.Caps(0, 0, 0));
        pool.scheduleCaps(PesoPool.Caps(1, 1, 1));
        pool.scheduleReserveMove(type(uint128).max);
        _skip(3 days);
        pool.executeCaps();
        pool.executeReserveMove();
        pool.unpause();
        assertEq(usdt.balanceOf(address(pool)), usdtBefore);
        assertEq(pool.loans(id).collateral, 1_000e6);
        assertGe(pool.convertToAssets(pool.balanceOf(lender)), lenderAssets);
    }

    function test_pauseScope() public {
        uint256 id = _borrow(alice, 1_000e6, 900_000e18, 30);
        vm.prank(guardian);
        pool.pause();
        // borrow and deposit stop
        vm.prank(bob);
        vm.expectRevert(PesoPool.IsPaused.selector);
        pool.borrow(1_000e6, 100_000e18, 30, 10_000);
        // repay, withdraw-own-funds, add collateral and liquidation go on
        wars.mint(alice, 10_000e18);
        vm.prank(alice);
        pool.repay(id, 1_000e18);
        vm.prank(alice);
        pool.addCollateral(id, 1e6);
        vm.prank(lender);
        pool.withdraw(1e18, lender, lender);
        _setTick(TICK_1650 + 4500);
        vm.prank(keeper);
        pool.liquidate(id, 1_000e18);
    }
}

contract PesoPoolFreezeTest is Base {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = _borrow(alice, 1_000e6, 500_000e18, 30);
    }

    function test_probeNotFrozen() public {
        assertFalse(pool.probeFreeze());
        assertEq(pool.frozenSince(), 0);
    }

    function test_probeFrozenRecordsTime() public {
        wars.setFrozen(true);
        assertTrue(pool.probeFreeze());
        assertEq(pool.frozenSince(), block.timestamp);
        _skip(1 hours);
        pool.probeFreeze();
        assertEq(pool.frozenSince(), block.timestamp - 1 hours);
    }

    function test_unfreezeResets() public {
        wars.setFrozen(true);
        pool.probeFreeze();
        wars.setFrozen(false);
        pool.probeFreeze();
        assertEq(pool.frozenSince(), 0);
    }

    function test_releaseBefore24hReverts() public {
        wars.setFrozen(true);
        pool.probeFreeze();
        _skip(23 hours);
        vm.prank(alice);
        vm.expectRevert(PesoPool.NotFrozen.selector);
        pool.emergencyReleaseCollateral(id);
    }

    function test_releaseAfter24hKeepsDebtValue() public {
        wars.setFrozen(true);
        pool.probeFreeze();
        _skip(25 hours);
        uint256 debt = pool.debtOf(id);
        vm.prank(alice);
        uint256 released = pool.emergencyReleaseCollateral(id);
        uint256 keep = pool.loans(id).collateral;
        assertEq(keep + released, 1_000e6);
        assertApproxEqAbs(keep * price.liquidationPrice() / 1e6, debt, price.liquidationPrice() / 1e6 + 1);
        assertTrue(pool.loans(id).open);
    }

    function test_releaseOnlyBorrower() public {
        wars.setFrozen(true);
        pool.probeFreeze();
        _skip(25 hours);
        vm.prank(bob);
        vm.expectRevert(PesoPool.NotBorrower.selector);
        pool.emergencyReleaseCollateral(id);
    }

    function test_releaseWhenNotFrozenReverts() public {
        vm.prank(alice);
        vm.expectRevert(PesoPool.NotFrozen.selector);
        pool.emergencyReleaseCollateral(id);
    }

    function test_releaseTwiceGivesNothingMore() public {
        wars.setFrozen(true);
        pool.probeFreeze();
        _skip(25 hours);
        vm.prank(alice);
        pool.emergencyReleaseCollateral(id);
        vm.prank(alice);
        uint256 again = pool.emergencyReleaseCollateral(id);
        assertLe(again, 1);
    }
}
