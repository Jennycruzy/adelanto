// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TickPrice} from "../../src/libraries/TickPrice.sol";

contract TickHarness {
    function at(int24 t) external pure returns (uint160) {
        return TickPrice.sqrtPriceX96AtTick(t);
    }
}

contract TickPriceTest is Test {
    TickHarness h = new TickHarness();

    function test_tickZeroIsOne() public view {
        assertEq(h.at(0), uint160(1 << 96));
    }

    function test_minTickMatchesUniswap() public view {
        assertEq(h.at(-887272), 4295128739);
    }

    function test_maxTickMatchesUniswap() public view {
        assertEq(h.at(887272), 1461446703485210103287273052203988822378723970342);
    }

    function test_knownTicksMatchUniswap() public view {
        // Values from Uniswap v3-core TickMath tests.
        assertEq(h.at(50), 79426470787362580746886972461);
        assertEq(h.at(-50), 79030349367926598376800521322);
        assertEq(h.at(100), 79625275426524748796330556128);
        assertEq(h.at(-100), 78833030112140176575862854579);
        assertEq(h.at(250), 80224679980005306637834519095);
        assertEq(h.at(1000), 83290069058676223003182343270);
        assertEq(h.at(-1000), 75364347830767020784054125655);
        // High-precision 2^96 * sqrt(1.0001^-350413) = 1950466071381590638918.87; Uniswap rounds up.
        assertEq(h.at(-350413), 1950466071381590638919);
    }

    function test_revertsOutOfRange() public {
        vm.expectRevert(TickPrice.TickOutOfRange.selector);
        h.at(887273);
        vm.expectRevert(TickPrice.TickOutOfRange.selector);
        h.at(-887273);
    }

    function testFuzz_monotonic(int24 t) public view {
        t = int24(bound(int256(t), -887271, 887271));
        assertLt(h.at(t), h.at(t + 1));
    }

    function testFuzz_priceDirection(int24 t) public pure {
        t = int24(bound(int256(t), -400000, -300000));
        uint256 a = TickPrice.pesosPerDollar(TickPrice.sqrtPriceX96AtTick(t), true, 1e6);
        uint256 b = TickPrice.pesosPerDollar(TickPrice.sqrtPriceX96AtTick(t + 100), true, 1e6);
        assertGt(a, b, "higher tick = stronger peso = fewer pesos per dollar");
    }

    function test_pesosPerDollarBothOrders() public pure {
        uint160 sp = TickPrice.sqrtPriceX96AtTick(-350413);
        uint256 p = TickPrice.pesosPerDollar(sp, true, 1e6);
        assertApproxEqRel(p, 1650e18, 0.001e18);
        // Same market seen with tokens the other way round: tick negated.
        uint160 sp2 = TickPrice.sqrtPriceX96AtTick(350413);
        uint256 p2 = TickPrice.pesosPerDollar(sp2, false, 1e6);
        assertApproxEqRel(p2, p, 0.0002e18);
    }
}
