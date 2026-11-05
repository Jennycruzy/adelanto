// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICreditBook} from "./interfaces/ICreditBook.sol";

/// @title CreditBook
/// @notice A credit record per address that anyone can read. Only the peso pool writes to it.
/// Repaying on time moves a borrower up a step (better rate, higher limit); a liquidation resets the steps.
/// Nothing is ever erased.
contract CreditBook is ICreditBook {
    address public immutable deployer;
    address public pool;

    mapping(address => Record) private _records;

    event PoolBound(address indexed pool);
    event LoanOpened(address indexed borrower, uint256 pesos);
    event Repayment(address indexed borrower, uint256 pesos);
    event LoanClosed(address indexed borrower, bool onTime, uint8 newTier);
    event Liquidated(address indexed borrower);

    error NotPool();
    error AlreadyBound();
    error NotDeployer();
    error ZeroAddress();

    constructor() {
        deployer = msg.sender;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    /// @notice Binds the one pool allowed to write. Can be called once.
    function bindPool(address pool_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (pool != address(0)) revert AlreadyBound();
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;
        emit PoolBound(pool_);
    }

    function recordOpen(address borrower, uint256 pesos) external onlyPool {
        Record storage r = _records[borrower];
        r.opened += 1;
        r.pesosBorrowed += uint128(pesos);
        if (r.firstLoanAt == 0) r.firstLoanAt = uint64(block.timestamp);
        r.lastLoanAt = uint64(block.timestamp);
        emit LoanOpened(borrower, pesos);
    }

    function recordRepayment(address borrower, uint256 pesos) external onlyPool {
        _records[borrower].pesosRepaid += uint128(pesos);
        emit Repayment(borrower, pesos);
    }

    function recordClosed(address borrower, bool onTime) external onlyPool {
        Record storage r = _records[borrower];
        if (onTime) {
            r.repaidOnTime += 1;
            r.onTimeSinceLiquidation += 1;
        } else {
            r.repaidLate += 1;
        }
        emit LoanClosed(borrower, onTime, _tier(r.onTimeSinceLiquidation));
    }

    function recordLiquidation(address borrower) external onlyPool {
        Record storage r = _records[borrower];
        r.liquidated += 1;
        r.onTimeSinceLiquidation = 0;
        emit Liquidated(borrower);
    }

    /// @notice 0 = first loan, 1 = after 1 on-time repayment, 2 = after 3, 3 = after 6 (since the last liquidation).
    function tier(address borrower) external view returns (uint8) {
        return _tier(_records[borrower].onTimeSinceLiquidation);
    }

    function recordOf(address borrower) external view returns (Record memory) {
        return _records[borrower];
    }

    function _tier(uint32 onTime) private pure returns (uint8) {
        if (onTime >= 6) return 3;
        if (onTime >= 3) return 2;
        if (onTime >= 1) return 1;
        return 0;
    }
}
