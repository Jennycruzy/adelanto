// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PesoPool} from "../../src/PesoPool.sol";
import {PriceModule} from "../../src/PriceModule.sol";
import {CreditBook} from "../../src/CreditBook.sol";
import {LoanGuard} from "../../src/LoanGuard.sol";
import {IPriceModule} from "../../src/interfaces/IPriceModule.sol";
import {ICreditBook} from "../../src/interfaces/ICreditBook.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {TickPrice} from "../../src/libraries/TickPrice.sol";

/// @dev Runs against Celo mainnet state: real wARS, USDT and the wARS/USDT Uniswap pool. Needs CELO_RPC_URL.
contract CeloForkTest is Test {
    address constant WARS = 0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant UNI = 0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391;

    PriceModule price;
    CreditBook book;
    PesoPool pool;
    LoanGuard guard;
    address lender = makeAddr("lender");
    address alice = makeAddr("alice");
    address agent = makeAddr("agent");
    address treasury = makeAddr("treasury");
    bool live;

    function setUp() public {
        string memory rpc = vm.envOr("CELO_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        price = new PriceModule(IUniswapV3Pool(UNI), WARS, USDT, 30_000_000e18);
        book = new CreditBook();
        pool = new PesoPool(
            IERC20(WARS),
            IERC20(USDT),
            IPriceModule(address(price)),
            ICreditBook(address(book)),
            IUniswapV3Pool(UNI),
            treasury,
            address(this),
            PesoPool.Caps({absolute: 20_000_000e18, depositsBps: 7_000, depthBps: 1_500})
        );
        book.bindPool(address(pool));
        guard = new LoanGuard(pool, agent);
        deal(WARS, lender, 2_000_000e18);
        deal(USDT, alice, 1_000e6);
        vm.prank(lender);
        IERC20(WARS).approve(address(pool), type(uint256).max);
        vm.prank(lender);
        pool.deposit(2_000_000e18, lender);
        vm.startPrank(alice);
        IERC20(USDT).approve(address(pool), type(uint256).max);
        IERC20(WARS).approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    modifier onlyLive() {
        if (!live) return;
        _;
    }

    function test_fork_tickMathMatchesPool() public onlyLive {
        (uint160 sqrtP, int24 tick,,,,,) = IUniswapV3Pool(UNI).slot0();
        assertLe(TickPrice.sqrtPriceX96AtTick(tick), sqrtP);
        assertGt(TickPrice.sqrtPriceX96AtTick(tick + 1), sqrtP);
    }

    function test_fork_priceIsSane() public onlyLive {
        assertTrue(price.warsIsToken0());
        uint256 s = price.spot();
        uint256 t = price.twap(1800);
        emit log_named_decimal_uint("spot pesos per dollar", s, 18);
        emit log_named_decimal_uint("30-min average", t, 18);
        assertGt(s, 500e18);
        assertLt(s, 5_000e18);
        assertApproxEqRel(s, t, 0.02e18);
        assertGt(price.warsDepth(), 30_000_000e18);
    }

    function test_fork_statusOkOrExplained() public onlyLive {
        (bool ok, uint8 reason) = price.status();
        emit log_named_uint("status reason", reason);
        if (ok) assertGt(price.borrowPrice(), 0);
    }

    function test_fork_twoHourAverageAvailable() public onlyLive {
        assertGt(price.twap(7200), 0);
    }

    function test_fork_borrowRepayRoundTrip() public onlyLive {
        (bool ok,) = price.status();
        if (!ok) return;
        vm.prank(alice);
        uint256 id = pool.borrow(10e6, 9_000e18, 7, 10_000);
        assertGt(IERC20(WARS).balanceOf(alice), 8_900e18);
        vm.warp(block.timestamp + 3 days);
        deal(WARS, alice, 20_000e18);
        vm.prank(alice);
        pool.repay(id, type(uint256).max);
        assertFalse(pool.loans(id).open);
        assertEq(IERC20(USDT).balanceOf(alice), 1_000e6);
        assertEq(book.tier(alice), 1);
    }

    function test_fork_repayWithRealSwap() public onlyLive {
        (bool ok,) = price.status();
        if (!ok) return;
        vm.prank(alice);
        uint256 id = pool.borrow(10e6, 5_000e18, 7, 10_000);
        uint256 debt = pool.debtOf(id);
        vm.prank(alice);
        pool.repayWithSwap(id, 4e6, debt * 99 / 100);
        assertFalse(pool.loans(id).open);
    }

    function test_fork_warsTransferZeroToSelfWorks() public onlyLive {
        // The freeze probe relies on a zero transfer to itself succeeding while wARS is live.
        assertFalse(pool.probeFreeze());
    }

    function test_fork_guardTopUpOnRealTokens() public onlyLive {
        (bool ok,) = price.status();
        if (!ok) return;
        uint256 p = price.borrowPrice();
        uint256 pesos = 10e6 * p / 1e6 * 5_900 / 10_000;
        vm.prank(alice);
        uint256 id = pool.borrow(10e6, pesos, 30, 10_000);
        vm.startPrank(alice);
        IERC20(USDT).approve(address(guard), type(uint256).max);
        guard.setLimits(
            LoanGuard.Limits({
                autoRepay: true,
                allowRefinance: false,
                protectOrder: LoanGuard.ProtectOrder.TopUpFirst,
                expiry: uint64(block.timestamp + 30 days),
                keepWarsBuffer: 0,
                maxRepayWarsPerDay: 10_000e18,
                maxTopUpUsdtPerDay: 5e6,
                maxRateBps: 4_000
            }),
            keccak256("rule")
        );
        vm.stopPrank();
        // not at risk yet
        vm.prank(agent);
        vm.expectRevert();
        guard.protectWithTopUp(id, 1e6);
    }
}
