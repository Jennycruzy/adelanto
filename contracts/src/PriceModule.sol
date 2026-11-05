// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {IPriceModule} from "./interfaces/IPriceModule.sol";
import {TickPrice} from "./libraries/TickPrice.sol";

/// @title PriceModule
/// @notice Pesos per dollar from the Celo wARS/USDT Uniswap v3 pool. Borrowing uses the lower of the spot price and
/// the 30-minute average, so a short spike never lends more pesos. Liquidation uses the 30-minute average only, so a
/// one-block push can't liquidate anyone. The module refuses (borrowing pauses; repay and liquidation don't) when the
/// pool is too shallow, when spot and the 30-minute average are more than 2% apart, or when the pool has been quiet for
/// over 2 hours and spot is more than 1% from the 2-hour average. All settings are fixed at deploy.
contract PriceModule is IPriceModule {
    uint8 public constant OK = 0;
    uint8 public constant SHALLOW = 1;
    uint8 public constant SPOT_VS_TWAP = 2;
    uint8 public constant QUIET_DRIFT = 3;

    uint32 public constant TWAP_SHORT = 30 minutes;
    uint32 public constant TWAP_LONG = 2 hours;
    uint32 public constant QUIET_AFTER = 2 hours;
    uint256 public constant MAX_SPOT_GAP_BPS = 200; // 2%
    uint256 public constant MAX_QUIET_GAP_BPS = 100; // 1%

    IUniswapV3Pool public immutable pool;
    address public immutable wars;
    bool public immutable warsIsToken0;
    uint256 public immutable scale;
    uint256 public immutable minWarsDepth;

    error PriceRefused(uint8 reason);
    error PoolMismatch();

    constructor(IUniswapV3Pool pool_, address wars_, address usdt_, uint256 minWarsDepth_) {
        address t0 = pool_.token0();
        address t1 = pool_.token1();
        if (!((t0 == wars_ && t1 == usdt_) || (t0 == usdt_ && t1 == wars_))) revert PoolMismatch();
        pool = pool_;
        wars = wars_;
        warsIsToken0 = t0 == wars_;
        scale = 10 ** (18 + uint256(IERC20Metadata(usdt_).decimals()) - uint256(IERC20Metadata(wars_).decimals()));
        minWarsDepth = minWarsDepth_;
    }

    function spot() public view returns (uint256) {
        (uint160 sqrtP,,,,,,) = pool.slot0();
        return TickPrice.pesosPerDollar(sqrtP, warsIsToken0, scale);
    }

    /// @notice Average price over the last `secondsAgo` seconds (geometric mean through the tick average).
    function twap(uint32 secondsAgo) public view returns (uint256) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = secondsAgo;
        ago[1] = 0;
        (int56[] memory cum,) = pool.observe(ago);
        int56 delta = cum[1] - cum[0];
        int24 meanTick = int24(delta / int56(uint56(secondsAgo)));
        if (delta < 0 && (delta % int56(uint56(secondsAgo)) != 0)) meanTick--;
        return TickPrice.pesosPerDollar(TickPrice.sqrtPriceX96AtTick(meanTick), warsIsToken0, scale);
    }

    function warsDepth() public view returns (uint256) {
        return IERC20(wars).balanceOf(address(pool));
    }

    function status() public view returns (bool, uint8) {
        uint8 r = _check(spot(), twap(TWAP_SHORT));
        return (r == OK, r);
    }

    function borrowPrice() external view returns (uint256) {
        uint256 s = spot();
        uint256 t = twap(TWAP_SHORT);
        uint8 r = _check(s, t);
        if (r != OK) revert PriceRefused(r);
        return s < t ? s : t;
    }

    function liquidationPrice() external view returns (uint256) {
        return twap(TWAP_SHORT);
    }

    function _check(uint256 s, uint256 t) internal view returns (uint8) {
        if (warsDepth() < minWarsDepth) return SHALLOW;
        if (_gapBps(s, t) > MAX_SPOT_GAP_BPS) return SPOT_VS_TWAP;
        (,, uint16 idx,,,,) = pool.slot0();
        (uint32 lastTs,,,) = pool.observations(idx);
        if (block.timestamp - lastTs > QUIET_AFTER) {
            if (_gapBps(s, twap(TWAP_LONG)) > MAX_QUIET_GAP_BPS) return QUIET_DRIFT;
        }
        return OK;
    }

    function _gapBps(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 d = a > b ? a - b : b - a;
        return d * 10_000 / b;
    }
}
