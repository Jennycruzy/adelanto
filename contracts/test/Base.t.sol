// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PesoPool} from "../src/PesoPool.sol";
import {PriceModule} from "../src/PriceModule.sol";
import {CreditBook} from "../src/CreditBook.sol";
import {LoanGuard} from "../src/LoanGuard.sol";
import {IPriceModule} from "../src/interfaces/IPriceModule.sol";
import {ICreditBook} from "../src/interfaces/ICreditBook.sol";
import {IUniswapV3Pool} from "../src/interfaces/IUniswapV3Pool.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {MockUniswapPool} from "./mocks/MockUniswapPool.sol";

/// @dev Shared setup: wARS (18 dec) is token0 and USDT (6 dec) token1, like the real Celo pool.
abstract contract Base is Test {
    int24 internal constant TICK_1650 = -350413; // about 1,650 pesos per dollar
    uint256 internal constant DEPTH = 127_500_000e18;

    MockToken internal wars;
    MockToken internal usdt;
    MockUniswapPool internal uni;
    PriceModule internal price;
    CreditBook internal book;
    PesoPool internal pool;
    LoanGuard internal guard;

    address internal deployer = address(this);
    address internal treasury = makeAddr("treasury");
    address internal guardian = makeAddr("guardian");
    address internal agent = makeAddr("agent");
    address internal lender = makeAddr("lender");
    address internal lender2 = makeAddr("lender2");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    function setUp() public virtual {
        vm.warp(1_762_300_000);
        wars = new MockToken("Wrapped ARS", "wARS", 18);
        usdt = new MockToken("Tether USD", "USDT", 6);
        uni = new MockUniswapPool(address(wars), address(usdt), TICK_1650);
        wars.mint(address(uni), DEPTH);
        price = new PriceModule(IUniswapV3Pool(address(uni)), address(wars), address(usdt), 30_000_000e18);
        book = new CreditBook();
        pool = new PesoPool(
            IERC20(address(wars)),
            IERC20(address(usdt)),
            IPriceModule(address(price)),
            ICreditBook(address(book)),
            IUniswapV3Pool(address(uni)),
            treasury,
            guardian,
            PesoPool.Caps({absolute: 20_000_000e18, depositsBps: 7_000, depthBps: 1_500})
        );
        book.bindPool(address(pool));
        guard = new LoanGuard(pool, agent);

        _fund(lender, 10_000_000e18, 0);
        _fund(lender2, 10_000_000e18, 0);
        _fund(alice, 0, 100_000e6);
        _fund(bob, 0, 100_000e6);
        _fund(keeper, 50_000_000e18, 0);
        _lend(lender, 10_000_000e18);
    }

    function _fund(address who, uint256 pesos, uint256 dollars) internal {
        if (pesos > 0) wars.mint(who, pesos);
        if (dollars > 0) usdt.mint(who, dollars);
        vm.startPrank(who);
        wars.approve(address(pool), type(uint256).max);
        usdt.approve(address(pool), type(uint256).max);
        wars.approve(address(guard), type(uint256).max);
        usdt.approve(address(guard), type(uint256).max);
        vm.stopPrank();
    }

    function _lend(address who, uint256 pesos) internal returns (uint256 shares) {
        vm.prank(who);
        shares = pool.deposit(pesos, who);
    }

    function _borrow(address who, uint256 dollars, uint256 pesos, uint16 term) internal returns (uint256 id) {
        vm.prank(who);
        id = pool.borrow(dollars, pesos, term, 100_000);
    }

    /// @dev Borrows `total` pesos spread over fresh borrowers (first loans are capped at 1M each).
    function _borrowMany(uint256 total, uint16 term) internal {
        uint256 i;
        while (total > 0) {
            uint256 a = total > 1_000_000e18 ? 1_000_000e18 : total;
            address w = makeAddr(string(abi.encode("many", i++, total)));
            _fund(w, 0, 10_000e6);
            _borrow(w, 10_000e6, a, term);
            total -= a;
        }
    }

    function _px() internal view returns (uint256) {
        return price.spot();
    }

    /// @dev Moves spot and both averages to `t`.
    function _setTick(int24 t) internal {
        uni.setAllTicks(t);
    }

    function _skip(uint256 secs) internal {
        vm.warp(block.timestamp + secs);
        uni.setLastObservation(uint32(block.timestamp));
    }
}
