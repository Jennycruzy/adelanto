// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "../Base.t.sol";
import {PesoPool} from "../../src/PesoPool.sol";
import {PriceModule} from "../../src/PriceModule.sol";
import {MockToken} from "../mocks/MockToken.sol";
import {MockUniswapPool} from "../mocks/MockUniswapPool.sol";

/// @dev Drives random sequences of every pool action and price move.
contract PoolHandler is Test {
    PesoPool public pool;
    MockToken public wars;
    MockToken public usdt;
    MockUniswapPool public uni;
    int24 public baseTick;

    address[] public actors;
    uint256[] public loanIds;

    // ghosts
    uint256 public maxDebtAfterBorrowOverCap; // stays 0 if every borrow respected caps
    uint256[4] public lastIndex;
    bool public indexWentDown;
    uint256 public usdtToNonActors;

    constructor(PesoPool pool_, MockToken wars_, MockToken usdt_, MockUniswapPool uni_, int24 tick) {
        pool = pool_;
        wars = wars_;
        usdt = usdt_;
        uni = uni_;
        baseTick = tick;
        for (uint256 i; i < 5; i++) {
            address a = makeAddr(string(abi.encode("actor", i)));
            actors.push(a);
            wars.mint(a, 5_000_000e18);
            usdt.mint(a, 50_000e6);
            vm.startPrank(a);
            wars.approve(address(pool), type(uint256).max);
            usdt.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
        for (uint256 i; i < 4; i++) {
            lastIndex[i] = pool.borrowIndex(i);
        }
    }

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function _loan(uint256 s) internal view returns (uint256) {
        if (loanIds.length == 0) return 0;
        return loanIds[s % loanIds.length];
    }

    function _after() internal {
        for (uint256 i; i < 4; i++) {
            uint256 idx = pool.borrowIndex(i);
            if (idx < lastIndex[i]) indexWentDown = true;
            lastIndex[i] = idx;
        }
    }

    function deposit(uint256 s, uint256 amt) external {
        address a = _actor(s);
        amt = bound(amt, 1, 1_000_000e18);
        vm.prank(a);
        try pool.deposit(amt, a) {} catch {}
        _after();
    }

    function withdraw(uint256 s, uint256 amt) external {
        address a = _actor(s);
        amt = bound(amt, 1, pool.maxWithdraw(a) + 1);
        vm.prank(a);
        try pool.withdraw(amt, a, a) {} catch {}
        _after();
    }

    function borrow(uint256 s, uint256 col, uint256 pesos, uint256 termSeed) external {
        address a = _actor(s);
        col = bound(col, 1e6, 5_000e6);
        pesos = bound(pesos, 1_000e18, 1_000_000e18);
        uint16[4] memory terms = [uint16(7), 30, 60, 90];
        vm.prank(a);
        try pool.borrow(col, pesos, terms[termSeed % 4], 100_000) returns (uint256 id) {
            loanIds.push(id);
            (uint128 capAbs, uint16 depBps, uint16 depthBps) = pool.caps();
            uint256 d = pool.totalDebt();
            uint256 assets = pool.totalAssets();
            uint256 depth = PriceModule(address(pool.priceModule())).warsDepth();
            // the new total is within all three caps (interest on old loans was accrued first)
            if (d > capAbs || d > assets * depBps / 10_000 + 1 || d > depth * depthBps / 10_000) {
                maxDebtAfterBorrowOverCap = d;
            }
        } catch {}
        _after();
    }

    function repay(uint256 s, uint256 ls, uint256 amt) external {
        uint256 id = _loan(ls);
        if (id == 0) return;
        amt = bound(amt, 1, 2_000_000e18);
        vm.prank(_actor(s));
        try pool.repay(id, amt) {} catch {}
        _after();
    }

    function addCollateral(uint256 s, uint256 ls, uint256 amt) external {
        uint256 id = _loan(ls);
        if (id == 0) return;
        amt = bound(amt, 1, 1_000e6);
        vm.prank(_actor(s));
        try pool.addCollateral(id, amt) {} catch {}
        _after();
    }

    function withdrawCollateral(uint256 ls, uint256 amt) external {
        uint256 id = _loan(ls);
        if (id == 0) return;
        address b = pool.loans(id).borrower;
        amt = bound(amt, 1, 5_000e6);
        vm.prank(b);
        try pool.withdrawCollateral(id, amt) {} catch {}
        _after();
    }

    function liquidate(uint256 s, uint256 ls, uint256 amt) external {
        uint256 id = _loan(ls);
        if (id == 0) return;
        amt = bound(amt, 1, 2_000_000e18);
        vm.prank(_actor(s));
        try pool.liquidate(id, amt) {} catch {}
        _after();
    }

    function movePrice(int256 d) external {
        d = bound(d, -3000, 6000);
        int24 t = int24(baseTick + int24(d));
        uni.setAllTicks(t);
        _after();
    }

    function spikeSpot(int256 d) external {
        d = bound(d, -500, 500);
        (, int24 cur,,,,,) = uni.slot0();
        uni.setSpot(int24(cur + int24(d)));
        _after();
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 1, 20 days);
        vm.warp(block.timestamp + secs);
        uni.setLastObservation(uint32(block.timestamp));
        _after();
    }

    function accrue() external {
        pool.accrue();
        _after();
    }

    function loanCount() external view returns (uint256) {
        return loanIds.length;
    }

    function loanAt(uint256 i) external view returns (uint256) {
        return loanIds[i];
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}

contract PoolInvariants is Base {
    PoolHandler h;

    function setUp() public override {
        super.setUp();
        h = new PoolHandler(pool, wars, usdt, uni, TICK_1650);
        targetContract(address(h));
    }

    /// Every lender's pesos are backed: the pool really holds the cash it counts, and shares never claim more than the
    /// pool's assets.
    function invariant_sharesBackedByAssets() public view {
        assertGe(wars.balanceOf(address(pool)), pool.cash());
        assertLe(pool.convertToAssets(pool.totalSupply()), pool.totalAssets() + 1);
        assertLe(pool.reserve(), pool.cash() + pool.totalDebt());
    }

    /// Collateral is all accounted for, loan by loan, and none ever reached anyone but borrowers and liquidators.
    function invariant_collateralOnlyToOwnerOrLiquidation() public view {
        assertEq(usdt.balanceOf(address(pool)), pool.totalCollateral());
        uint256 sum;
        for (uint256 i; i < h.loanCount(); i++) {
            PesoPool.Loan memory l = pool.loans(h.loanAt(i));
            if (l.open) sum += l.collateral;
            else assertEq(l.collateral, 0);
        }
        assertEq(sum, pool.totalCollateral());
        assertEq(usdt.balanceOf(treasury), 0);
        assertEq(usdt.balanceOf(guardian), 0);
        assertEq(usdt.balanceOf(deployer), 0);
        assertEq(usdt.balanceOf(address(guard)), 0);
    }

    /// Every borrow kept the total borrowed within all three caps.
    function invariant_caps() public view {
        assertEq(h.maxDebtAfterBorrowOverCap(), 0);
    }

    /// The interest index never goes down.
    function invariant_indexMonotonic() public view {
        assertFalse(h.indexWentDown());
    }

    /// Debt adds up: the per-tier totals match the sum over open loans (up to rounding).
    function invariant_debtAddsUp() public view {
        uint256[4] memory scaled;
        for (uint256 i; i < h.loanCount(); i++) {
            PesoPool.Loan memory l = pool.loans(h.loanAt(i));
            if (l.open) scaled[l.tier] += l.scaledDebt;
        }
        for (uint256 t; t < 4; t++) {
            assertEq(scaled[t], pool.scaledTotal(t));
        }
    }

    /// A closed loan owes nothing.
    function invariant_closedLoansOweNothing() public view {
        for (uint256 i; i < h.loanCount(); i++) {
            uint256 id = h.loanAt(i);
            if (!pool.loans(id).open) assertEq(pool.debtOf(id), 0);
        }
    }
}
