// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {PriceModule} from "../../src/PriceModule.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {MockToken} from "../mocks/MockToken.sol";
import {MockUniswapPool} from "../mocks/MockUniswapPool.sol";

contract PriceModuleTest is Base {
    function test_spotNear1650() public view {
        assertApproxEqRel(price.spot(), 1650e18, 0.001e18);
    }

    function test_twapEqualsSpotWhenFlat() public view {
        assertEq(price.twap(1800), price.spot());
    }

    function test_borrowPriceIsMinOfSpotAndTwap_spotLower() public {
        uni.setSpot(TICK_1650 + 100); // fewer pesos per dollar at spot
        assertEq(price.borrowPrice(), price.spot());
        assertLt(price.spot(), price.twap(1800));
    }

    function test_borrowPriceIsMinOfSpotAndTwap_twapLower() public {
        uni.setSpot(TICK_1650 - 100);
        assertEq(price.borrowPrice(), price.twap(1800));
    }

    function test_liquidationPriceIsTwapOnly() public {
        uni.setSpot(TICK_1650 - 150);
        assertEq(price.liquidationPrice(), price.twap(1800));
    }

    function test_refusesWhenShallow() public {
        vm.prank(address(uni));
        wars.transfer(address(1), DEPTH - 29_000_000e18);
        (bool ok, uint8 r) = price.status();
        assertFalse(ok);
        assertEq(r, price.SHALLOW());
        vm.expectRevert(abi.encodeWithSelector(PriceModule.PriceRefused.selector, uint8(1)));
        price.borrowPrice();
    }

    function test_refusesWhenSpotFarFromTwap() public {
        uni.setSpot(TICK_1650 + 250); // ~2.5%
        (bool ok, uint8 r) = price.status();
        assertFalse(ok);
        assertEq(r, price.SPOT_VS_TWAP());
        vm.expectRevert(abi.encodeWithSelector(PriceModule.PriceRefused.selector, uint8(2)));
        price.borrowPrice();
    }

    function test_allowsSmallSpotGap() public {
        uni.setSpot(TICK_1650 + 150); // ~1.5%
        (bool ok,) = price.status();
        assertTrue(ok);
    }

    function test_refusesQuietPoolDrift() public {
        vm.warp(block.timestamp + 3 hours);
        uni.setSpot(TICK_1650 + 150);
        uni.setAvg(1800, TICK_1650 + 150);
        (bool ok, uint8 r) = price.status();
        assertFalse(ok);
        assertEq(r, price.QUIET_DRIFT());
    }

    function test_quietPoolWithoutDriftIsFine() public {
        vm.warp(block.timestamp + 3 hours);
        (bool ok,) = price.status();
        assertTrue(ok);
    }

    function test_activePoolDriftFromLongTwapIsFine() public {
        uni.setSpot(TICK_1650 + 150);
        uni.setAvg(1800, TICK_1650 + 150);
        (bool ok,) = price.status();
        assertTrue(ok);
    }

    function test_liquidationPriceWorksWhileRefused() public {
        uni.setSpot(TICK_1650 + 500);
        (bool ok,) = price.status();
        assertFalse(ok);
        assertGt(price.liquidationPrice(), 0);
    }

    function test_constructorRejectsWrongPool() public {
        MockToken other = new MockToken("X", "X", 18);
        MockUniswapPool p = new MockUniswapPool(address(other), address(usdt), 0);
        vm.expectRevert(PriceModule.PoolMismatch.selector);
        new PriceModule(IUniswapV3Pool(address(p)), address(wars), address(usdt), 1);
    }

    function test_tokenOrderReversed() public {
        MockUniswapPool p = new MockUniswapPool(address(usdt), address(wars), -TICK_1650);
        wars.mint(address(p), DEPTH);
        PriceModule m = new PriceModule(IUniswapV3Pool(address(p)), address(wars), address(usdt), 1);
        assertFalse(m.warsIsToken0());
        assertApproxEqRel(m.spot(), price.spot(), 0.0002e18);
    }

    function test_warsDepthReadsPoolBalance() public view {
        assertEq(price.warsDepth(), DEPTH);
    }

    function test_negativeTickAverageRoundsDown() public {
        // An average of -0.5 ticks must floor to -1, as Uniswap's OracleLibrary does.
        MockUniswapPool p = new MockUniswapPool(address(wars), address(usdt), 0);
        wars.mint(address(p), DEPTH);
        PriceModule m = new PriceModule(IUniswapV3Pool(address(p)), address(wars), address(usdt), 1);
        assertEq(m.twap(1800), m.spot());
    }

    function testFuzz_borrowPriceNeverAboveEither(int24 dSpot) public {
        dSpot = int24(bound(int256(dSpot), -190, 190));
        uni.setSpot(TICK_1650 + dSpot);
        uint256 b = price.borrowPrice();
        assertLe(b, price.spot());
        assertLe(b, price.twap(1800));
    }

    function testFuzz_refusalMatchesGap(int24 dSpot) public {
        dSpot = int24(bound(int256(dSpot), -400, 400));
        uni.setSpot(TICK_1650 + dSpot);
        uint256 s = price.spot();
        uint256 t = price.twap(1800);
        uint256 gap = (s > t ? s - t : t - s) * 10_000 / t;
        (bool ok,) = price.status();
        assertEq(ok, gap <= 200);
    }
}
