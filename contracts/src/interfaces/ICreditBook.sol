// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ICreditBook {
    struct Record {
        uint32 opened;
        uint32 repaidOnTime;
        uint32 repaidLate;
        uint32 liquidated;
        uint32 onTimeSinceLiquidation;
        uint64 firstLoanAt;
        uint64 lastLoanAt;
        uint128 pesosBorrowed;
        uint128 pesosRepaid;
    }

    function recordOpen(address borrower, uint256 pesos) external;
    function recordRepayment(address borrower, uint256 pesos) external;
    function recordClosed(address borrower, bool onTime) external;
    function recordLiquidation(address borrower) external;
    function tier(address borrower) external view returns (uint8);
    function recordOf(address borrower) external view returns (Record memory);
}
