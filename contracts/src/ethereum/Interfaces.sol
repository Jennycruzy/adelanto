// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

struct MarketState {
    uint128 totalSupplyAssets;
    uint128 totalSupplyShares;
    uint128 totalBorrowAssets;
    uint128 totalBorrowShares;
    uint128 lastUpdate;
    uint128 fee;
}

/// @notice The Morpho Blue calls the proxy uses.
interface IMorpho {
    function idToMarketParams(bytes32 id) external view returns (MarketParams memory);
    function market(bytes32 id) external view returns (MarketState memory);
    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
    function accrueInterest(MarketParams memory marketParams) external;
    function supplyCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, bytes memory data)
        external;
    function borrow(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256, uint256);
    function repay(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256, uint256);
    function withdrawCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, address receiver)
        external;
}

interface IIrm {
    function borrowRateView(MarketParams memory marketParams, MarketState memory market) external view returns (uint256);
}

/// @notice Ripio's wFIAT bridge (burn on this chain, mint on the destination).
interface IRipioBridge {
    function depositForBridge(
        address token,
        uint256 amount,
        uint256 destChainId,
        address destRecipient,
        bytes32 clientDepositId
    ) external returns (uint256 depositId);
    function routeConfigs(address token, uint256 destChainId) external view returns (bool enabled, uint256 fixedFee);
}

struct SendParam {
    uint32 dstEid;
    bytes32 to;
    uint256 amountLD;
    uint256 minAmountLD;
    bytes extraOptions;
    bytes composeMsg;
    bytes oftCmd;
}

struct MessagingFee {
    uint256 nativeFee;
    uint256 lzTokenFee;
}

struct MessagingReceipt {
    bytes32 guid;
    uint64 nonce;
    MessagingFee fee;
}

struct OFTReceipt {
    uint256 amountSentLD;
    uint256 amountReceivedLD;
}

/// @notice USDT0 (LayerZero OFT) adapter for USDT.
interface IOFT {
    function quoteSend(SendParam calldata sendParam, bool payInLzToken) external view returns (MessagingFee memory);
    function send(SendParam calldata sendParam, MessagingFee calldata fee, address refundAddress)
        external
        payable
        returns (MessagingReceipt memory, OFTReceipt memory);
}
