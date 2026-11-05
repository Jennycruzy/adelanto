// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Turns a Uniswap v3 tick into sqrt(1.0001^tick) * 2^96, the same way Uniswap's TickMath does
/// (multiplying the precomputed powers 1.0001^(-2^i / 2) in 128.128 fixed point).
library TickPrice {
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    error TickOutOfRange();

    function sqrtPriceX96AtTick(int24 tick) internal pure returns (uint160) {
        if (tick < MIN_TICK || tick > MAX_TICK) revert TickOutOfRange();
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        uint256 ratio = absTick & 0x1 != 0 ? 0xfffcb933bd6fad37aa2d162d1a594001 : 0x100000000000000000000000000000000;
        if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;
        if (tick > 0) ratio = type(uint256).max / ratio;
        return uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
    }

    /// @notice Pesos per dollar (1e18 scale) from a pool sqrt price.
    /// @param warsIsToken0 true when wARS is the pool's token0.
    /// @param scale 10^(18 + usdtDecimals - warsDecimals).
    function pesosPerDollar(uint160 sqrtPriceX96, bool warsIsToken0, uint256 scale) internal pure returns (uint256) {
        // q = price(token1 per token0, raw units) * 2^128
        uint256 q = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
        if (warsIsToken0) {
            // raw = USDT units per wARS unit -> pesos per dollar = scale / raw
            return Math.mulDiv(scale, 1 << 128, q);
        }
        // raw = wARS units per USDT unit -> pesos per dollar = scale * raw
        return Math.mulDiv(scale, q, 1 << 128);
    }
}
