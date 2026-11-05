// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickPrice} from "../../src/libraries/TickPrice.sol";
import {MockToken} from "./MockToken.sol";

interface ISwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @dev Uniswap v3 pool stand-in: the spot tick, the average tick for each window and the last observation time are
/// all set by the test. Swaps fill at the spot price, minus `feeBps`.
contract MockUniswapPool {
    address public token0;
    address public token1;
    int24 public spotTick;
    mapping(uint32 => int24) public avgTick;
    uint32 public lastObservation;
    uint256 public feeBps = 1;
    bool public observeReverts;

    constructor(address t0, address t1, int24 tick) {
        token0 = t0;
        token1 = t1;
        setAllTicks(tick);
        lastObservation = uint32(block.timestamp);
    }

    function setAllTicks(int24 t) public {
        spotTick = t;
        avgTick[1800] = t;
        avgTick[7200] = t;
    }

    function setSpot(int24 t) external {
        spotTick = t;
    }

    function setAvg(uint32 window, int24 t) external {
        avgTick[window] = t;
    }

    function setLastObservation(uint32 ts) external {
        lastObservation = ts;
    }

    function setObserveReverts(bool r) external {
        observeReverts = r;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (TickPrice.sqrtPriceX96AtTick(spotTick), spotTick, 0, 1200, 1200, 0, true);
    }

    function observations(uint256) external view returns (uint32, int56, uint160, bool) {
        return (lastObservation, 0, 0, true);
    }

    function observe(uint32[] calldata ago) external view returns (int56[] memory cum, uint160[] memory spl) {
        require(!observeReverts, "OLD");
        cum = new int56[](2);
        spl = new uint160[](2);
        int24 t = avgTick[ago[0]];
        cum[0] = 0;
        cum[1] = int56(t) * int56(uint56(ago[0]));
    }

    /// @dev Exact-input swap of token `zeroForOne ? token0 : token1` for the other, at the spot price.
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "exact input only");
        uint256 inAmt = uint256(amountSpecified);
        // raw price token1 per token0 = (sqrtP / 2^96)^2
        uint256 sqrtP = TickPrice.sqrtPriceX96AtTick(spotTick);
        uint256 q = sqrtP * sqrtP >> 64; // price * 2^128
        uint256 out;
        if (zeroForOne) out = inAmt * q >> 128;
        else out = (inAmt << 128) / q;
        out = out * (10_000 - feeBps) / 10_000;
        address outToken = zeroForOne ? token1 : token0;
        address inToken = zeroForOne ? token0 : token1;
        MockToken(outToken).mint(recipient, out);
        uint256 before = IERC20(inToken).balanceOf(address(this));
        if (zeroForOne) {
            amount0 = int256(inAmt);
            amount1 = -int256(out);
        } else {
            amount0 = -int256(out);
            amount1 = int256(inAmt);
        }
        ISwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        require(IERC20(inToken).balanceOf(address(this)) >= before + inAmt, "not paid");
    }
}
