// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMorpho, IIrm, IRipioBridge, IOFT, MarketParams, MarketState, SendParam, MessagingFee} from "./Interfaces.sol";

/// @title MorphoProxy
/// @notice Holds one person's Morpho position on Ethereum. It acts only on orders that person signed, and it can send
/// money to one place only: that person's own address on Celo (pesos through Ripio's bridge, dollars through USDT0).
/// There is no other way out, no owner and no upgrade. Anyone may submit a signed order and pay its gas.
contract MorphoProxy is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    enum Action {
        Open,
        AddCollateral,
        Repay,
        Close,
        Exit
    }

    struct Order {
        address borrower;
        Action action;
        bytes32 marketId;
        uint256 collateralUsdt;
        uint256 borrowWars;
        uint256 maxRateBps;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address borrower,uint8 action,bytes32 marketId,uint256 collateralUsdt,uint256 borrowWars,uint256 maxRateBps,uint256 nonce,uint256 deadline)"
    );
    uint256 public constant CELO_CHAIN_ID = 42220;
    uint32 public constant CELO_EID = 30125;
    uint256 internal constant YEAR = 365 days;

    address public immutable owner; // the person's address (same on Celo and Ethereum)
    IMorpho public immutable morpho;
    IERC20 public immutable usdt;
    IERC20 public immutable wars;
    IRipioBridge public immutable ripio;
    IOFT public immutable usdt0;

    mapping(uint256 => bool) public nonceUsed;

    event OrderExecuted(Action indexed action, bytes32 indexed marketId, uint256 nonce);
    event Borrowed(bytes32 indexed marketId, uint256 collateralUsdt, uint256 wars, uint256 rateBps);
    event Repaid(bytes32 indexed marketId, uint256 wars, uint256 sharesLeft);
    event CollateralHome(bytes32 indexed marketId, uint256 usdt);
    event PesosHome(uint256 wars, uint256 depositId);

    error BadSignature();
    error NonceUsed();
    error OrderExpired();
    error WrongBorrower();
    error WrongMarket();
    error RateAboveMax(uint256 rateBps);
    error NotOwner();
    error NothingToSend();
    error NotFunded();
    error NotDone();

    constructor(address owner_, IMorpho morpho_, IERC20 usdt_, IERC20 wars_, IRipioBridge ripio_, IOFT usdt0_)
        EIP712("ADELANTO", "1")
    {
        owner = owner_;
        morpho = morpho_;
        usdt = usdt_;
        wars = wars_;
        ripio = ripio_;
        usdt0 = usdt0_;
    }

    // ---------------------------------------------------------------- orders

    function execute(Order calldata o, bytes calldata signature) external payable nonReentrant {
        if (o.borrower != owner) revert WrongBorrower();
        if (block.timestamp > o.deadline) revert OrderExpired();
        if (nonceUsed[o.nonce]) revert NonceUsed();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    o.borrower,
                    uint8(o.action),
                    o.marketId,
                    o.collateralUsdt,
                    o.borrowWars,
                    o.maxRateBps,
                    o.nonce,
                    o.deadline
                )
            )
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != owner) revert BadSignature();
        nonceUsed[o.nonce] = true;

        // A signed order either does what it says or reverts, so its nonce is never spent on a no-op and the owner's
        // signature can be submitted again once the money has arrived.
        MarketParams memory mp = _market(o.marketId);
        if (o.action == Action.Open) {
            if (_supply(mp, o.collateralUsdt) < o.collateralUsdt) revert NotFunded();
            _borrowAndSend(o.marketId, mp, o.borrowWars, o.maxRateBps, o.nonce);
        } else if (o.action == Action.AddCollateral) {
            uint256 supplied = _supply(mp, o.collateralUsdt);
            if (supplied == 0 || supplied < o.collateralUsdt) revert NotFunded();
        } else if (o.action == Action.Repay) {
            uint256 before = wars.balanceOf(address(this));
            uint256 left = _repay(o.marketId, mp, o.borrowWars);
            uint256 paid = before - wars.balanceOf(address(this));
            if (left != 0 && (o.borrowWars == 0 || paid < o.borrowWars)) revert NotFunded();
        } else {
            if (_exit(o.marketId, mp) != 0) revert NotDone();
        }
        emit OrderExecuted(o.action, o.marketId, o.nonce);
    }

    /// @notice The owner can always unwind from Ethereum directly, without an order.
    function exit(bytes32 marketId) external payable nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        _exit(marketId, _market(marketId));
    }

    /// @notice The owner can send any balance home; it can only go to the owner on Celo.
    function sendPesosHome() external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        _sendPesosHome(0);
    }

    function sendDollarsHome() external payable nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        _sendDollarsHome(bytes32(0));
    }

    // ---------------------------------------------------------------- internals

    function _market(bytes32 id) internal view returns (MarketParams memory mp) {
        mp = morpho.idToMarketParams(id);
        if (mp.loanToken != address(wars) || mp.collateralToken != address(usdt)) revert WrongMarket();
    }

    function _supply(MarketParams memory mp, uint256 amount) internal returns (uint256 a) {
        uint256 bal = usdt.balanceOf(address(this));
        a = amount == 0 || amount > bal ? bal : amount;
        if (a == 0) return 0;
        usdt.forceApprove(address(morpho), a);
        morpho.supplyCollateral(mp, a, address(this), "");
    }

    function _borrowAndSend(bytes32 id, MarketParams memory mp, uint256 amount, uint256 maxRateBps, uint256 nonce)
        internal
    {
        morpho.accrueInterest(mp);
        (, , uint128 col) = morpho.position(id, address(this));
        morpho.borrow(mp, amount, 0, address(this), address(this));
        // The ceiling applies to the rate this borrow leaves the market at, not the rate before it.
        uint256 rateBps = IIrm(mp.irm).borrowRateView(mp, morpho.market(id)) * YEAR * 10_000 / 1e18;
        if (rateBps > maxRateBps) revert RateAboveMax(rateBps);
        emit Borrowed(id, col, amount, rateBps);
        _sendPesosHome(nonce);
    }

    function _repay(bytes32 id, MarketParams memory mp, uint256 amount) internal returns (uint256 sharesLeft) {
        morpho.accrueInterest(mp);
        (, uint128 shares,) = morpho.position(id, address(this));
        if (shares == 0) return 0;
        uint256 bal = wars.balanceOf(address(this));
        MarketState memory m = morpho.market(id);
        uint256 owed = uint256(shares).mulDiv(m.totalBorrowAssets + 1, m.totalBorrowShares + 1e6, Math.Rounding.Ceil);
        wars.forceApprove(address(morpho), bal);
        if (bal >= owed && (amount == 0 || amount >= owed)) {
            morpho.repay(mp, 0, shares, address(this), "");
        } else {
            uint256 a = amount == 0 || amount > bal ? bal : amount;
            if (a > 0) morpho.repay(mp, a, 0, address(this), "");
        }
        wars.forceApprove(address(morpho), 0);
        (, uint128 left,) = morpho.position(id, address(this));
        emit Repaid(id, bal - wars.balanceOf(address(this)), left);
        return left;
    }

    function _exit(bytes32 id, MarketParams memory mp) internal returns (uint256 left) {
        left = _repay(id, mp, 0);
        if (left == 0) {
            (, , uint128 col) = morpho.position(id, address(this));
            if (col > 0) {
                morpho.withdrawCollateral(mp, col, address(this), address(this));
                emit CollateralHome(id, col);
            }
            if (usdt.balanceOf(address(this)) > 0 && msg.value > 0) _sendDollarsHome(id);
        }
        (bool enabled, uint256 fee) = ripio.routeConfigs(address(wars), CELO_CHAIN_ID);
        if (enabled && wars.balanceOf(address(this)) > fee) _sendPesosHome(uint256(id));
    }

    function _sendPesosHome(uint256 tag) internal {
        uint256 bal = wars.balanceOf(address(this));
        if (bal == 0) revert NothingToSend();
        wars.forceApprove(address(ripio), bal);
        uint256 depositId = ripio.depositForBridge(
            address(wars), bal, CELO_CHAIN_ID, owner, keccak256(abi.encode(address(this), tag, block.number))
        );
        emit PesosHome(bal, depositId);
    }

    function _sendDollarsHome(bytes32) internal {
        uint256 bal = usdt.balanceOf(address(this));
        if (bal == 0) revert NothingToSend();
        SendParam memory p = SendParam({
            dstEid: CELO_EID,
            to: bytes32(uint256(uint160(owner))),
            amountLD: bal,
            minAmountLD: bal * 995 / 1000,
            extraOptions: "",
            composeMsg: "",
            oftCmd: ""
        });
        MessagingFee memory fee = usdt0.quoteSend(p, false);
        usdt.forceApprove(address(usdt0), bal);
        usdt0.send{value: fee.nativeFee}(p, fee, msg.sender);
        // Only what this caller paid and the fee did not use goes back to them.
        if (msg.value > fee.nativeFee) {
            (bool ok,) = msg.sender.call{value: msg.value - fee.nativeFee}("");
            ok; // a refund that fails stays here and pays the next send home
        }
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    receive() external payable {}
}
