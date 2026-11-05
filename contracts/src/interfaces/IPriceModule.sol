// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Pesos per dollar, scaled by 1e18 (1 USDT = price / 1e18 wARS).
interface IPriceModule {
    /// @notice Price used to value collateral when borrowing or withdrawing: min(spot, 30-minute average).
    /// Reverts with a reason code when the price can't be trusted right now.
    function borrowPrice() external view returns (uint256);
    /// @notice Price used for liquidation: the 30-minute average only.
    function liquidationPrice() external view returns (uint256);
    /// @notice (ok, reasonCode). reasonCode is 0 when ok.
    function status() external view returns (bool ok, uint8 reason);
    /// @notice wARS held by the price source pool (its depth).
    function warsDepth() external view returns (uint256);
}
