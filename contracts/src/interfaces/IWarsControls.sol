// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The pause and blocklist reads on Ripio's wARS token.
interface IWarsControls {
    function paused() external view returns (bool);
    function isBlocked(address account) external view returns (bool);
    function enforceBlocklist() external view returns (bool);
}
