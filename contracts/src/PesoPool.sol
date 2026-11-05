// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPriceModule} from "./interfaces/IPriceModule.sol";
import {ICreditBook} from "./interfaces/ICreditBook.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";

/// @title PesoPool
/// @notice Lenders deposit wARS and get aPESO shares (ERC-4626). Borrowers lock USDT and borrow wARS.
/// Nobody but a borrower or lender can take their money: collateral leaves only to its owner or to a liquidator under
/// the published rule, lender wARS leave only to that lender, and there is no admin withdraw. The owner can only lower
/// caps at once, raise them after 24 hours, set the guardian, and move the reserve to the treasury after 48 hours.
/// The guardian can only pause new borrowing and new deposits; repay, withdraw and liquidation never pause.
contract PesoPool is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ---------------------------------------------------------------- constants

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;

    uint256 public constant BASE_RATE_BPS = 2_200; // 22% a year at zero use
    uint256 public constant KINK_RATE_BPS = 3_600; // 36% at the 80% target
    uint256 public constant KINK_UTIL_BPS = 8_000;
    uint256 public constant TOP_RATE_BPS = 15_600; // 156% at 100% use
    uint256 public constant RESERVE_BPS = 1_000; // 10% of interest
    uint256 public constant OPEN_FEE_BPS = 25; // 0.25% of pesos borrowed
    uint256 public constant LATE_EXTRA_BPS = 500; // +5 points after the term
    uint256 public constant GRACE = 7 days;
    uint256 public constant WITHDRAW_LTV_BPS = 6_000;
    uint256 public constant RISK_LTV_BPS = 7_000;
    uint256 public constant LIQUIDATION_LTV_BPS = 8_000;
    uint256 public constant LIQUIDATION_BONUS_BPS = 500;
    uint256 public constant CLOSE_FACTOR_BPS = 5_000;
    uint256 public constant SMALL_DEBT = 10_000e18;
    uint256 public constant MIN_LOAN = 1_000e18;
    uint256 public constant CAP_DELAY = 24 hours;
    uint256 public constant RESERVE_DELAY = 48 hours;
    uint256 public constant FREEZE_DELAY = 24 hours;
    uint8 public constant TIERS = 4;

    uint160 internal constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 internal constant MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    // ---------------------------------------------------------------- immutables

    IERC20 public immutable usdt;
    IERC20 internal immutable _wars;
    uint256 public immutable usdtUnit;
    IPriceModule public immutable priceModule;
    ICreditBook public immutable creditBook;
    IUniswapV3Pool public immutable swapPool;
    bool internal immutable _usdtIsToken0;
    address public immutable treasury;

    // ---------------------------------------------------------------- state

    struct Loan {
        address borrower;
        uint8 tier;
        bool open;
        bool liquidated;
        uint16 termDays;
        uint64 openedAt;
        uint64 dueAt;
        uint64 penaltyFrom;
        uint128 collateral;
        uint256 scaledDebt;
    }

    struct Caps {
        uint128 absolute; // wARS
        uint16 depositsBps; // share of pool assets
        uint16 depthBps; // share of the price pool's wARS side
    }

    address public owner;
    address public pendingOwner;
    address public guardian;
    bool public paused;

    uint256 public cash; // wARS held for lenders (not raw balance: donations change nothing)
    uint256 public reserve; // wARS owed to the reserve, inside cash + debt
    uint256 public totalCollateral; // USDT held as collateral
    uint64 public lastAccrual;
    uint256[TIERS] public borrowIndex;
    uint256[TIERS] public scaledTotal;

    Caps public caps;
    Caps public pendingCaps;
    uint64 public pendingCapsEta;

    uint256 public pendingReserveMove;
    uint64 public pendingReserveEta;

    uint64 public frozenSince;

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) internal _loans;

    address private _swapPayer;

    // ---------------------------------------------------------------- events

    event Borrowed(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 collateral,
        uint256 pesos,
        uint256 fee,
        uint16 termDays,
        uint8 tier,
        uint256 price,
        uint256 rateBps
    );
    event CollateralAdded(uint256 indexed loanId, address indexed from, uint256 usdt);
    event Repaid(uint256 indexed loanId, address indexed payer, uint256 pesos, uint256 debtLeft);
    event LoanClosed(uint256 indexed loanId, address indexed borrower, bool onTime, uint256 collateralReturned);
    event CollateralWithdrawn(uint256 indexed loanId, uint256 usdt);
    event Liquidated(
        uint256 indexed loanId, address indexed liquidator, uint256 pesosRepaid, uint256 usdtSeized, uint256 price
    );
    event BadDebt(uint256 indexed loanId, uint256 pesos, uint256 coveredByReserve);
    event PenaltyAdded(uint256 indexed loanId, uint256 pesos);
    event Accrued(uint256 interest, uint256 toReserve, uint256 rateBps);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event GuardianSet(address indexed guardian);
    event CapsLowered(uint128 absolute, uint16 depositsBps, uint16 depthBps);
    event CapsRaiseScheduled(uint128 absolute, uint16 depositsBps, uint16 depthBps, uint64 eta);
    event CapsRaised(uint128 absolute, uint16 depositsBps, uint16 depthBps);
    event ReserveMoveScheduled(uint256 amount, uint64 eta);
    event ReserveMoveCancelled();
    event ReserveMoved(uint256 amount, address treasury);
    event FreezeProbe(bool frozen, uint64 frozenSince);
    event EmergencyCollateralReleased(uint256 indexed loanId, uint256 usdt);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ---------------------------------------------------------------- errors

    error NotOwner();
    error NotGuardianOrOwner();
    error NotBorrower();
    error IsPaused();
    error BadTerm();
    error BelowMinimum();
    error AboveLoanLimit();
    error AboveBorrowLimit();
    error AboveCap();
    error NotEnoughCash();
    error RateAboveMax(uint256 rateBps);
    error LoanNotOpen();
    error NotLiquidatable();
    error TooMuchWithdrawn();
    error NothingToRepay();
    error SlippageExceeded();
    error NotSwapPool();
    error CapsNotLower();
    error NotReady();
    error NothingScheduled();
    error NotFrozen();
    error ZeroAmount();
    error ZeroAddress();

    // ---------------------------------------------------------------- setup

    constructor(
        IERC20 wars_,
        IERC20 usdt_,
        IPriceModule priceModule_,
        ICreditBook creditBook_,
        IUniswapV3Pool swapPool_,
        address treasury_,
        address guardian_,
        Caps memory caps_
    ) ERC20("ADELANTO pesos", "aPESO") ERC4626(wars_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        _wars = wars_;
        usdt = usdt_;
        usdtUnit = 10 ** IERC20Metadata(address(usdt_)).decimals();
        priceModule = priceModule_;
        creditBook = creditBook_;
        swapPool = swapPool_;
        _usdtIsToken0 = swapPool_.token0() == address(usdt_);
        treasury = treasury_;
        owner = msg.sender;
        guardian = guardian_;
        caps = caps_;
        lastAccrual = uint64(block.timestamp);
        for (uint256 i; i < TIERS; ++i) {
            borrowIndex[i] = WAD;
        }
        emit OwnershipTransferred(address(0), msg.sender);
        emit GuardianSet(guardian_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    // ================================================================ lenders (ERC-4626)

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6; // virtual shares: blocks the first-depositor share inflation trick
    }

    function totalAssets() public view override returns (uint256) {
        (uint256[TIERS] memory idx, uint256 res) = _accruedView();
        return cash + _sumDebt(idx) - res;
    }

    function maxDeposit(address) public view override returns (uint256) {
        return paused ? 0 : type(uint256).max;
    }

    function maxMint(address) public view override returns (uint256) {
        return paused ? 0 : type(uint256).max;
    }

    function maxWithdraw(address holder) public view override returns (uint256) {
        uint256 assets = convertToAssets(balanceOf(holder));
        return assets < cash ? assets : cash;
    }

    function maxRedeem(address holder) public view override returns (uint256) {
        uint256 shares = balanceOf(holder);
        uint256 cashShares = convertToShares(cash);
        return shares < cashShares ? shares : cashShares;
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        _accrue();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        _accrue();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address holder) public override nonReentrant returns (uint256) {
        _accrue();
        return super.withdraw(assets, receiver, holder);
    }

    function redeem(uint256 shares, address receiver, address holder) public override nonReentrant returns (uint256) {
        _accrue();
        return super.redeem(shares, receiver, holder);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        cash += assets;
    }

    function _withdraw(address caller, address receiver, address holder, uint256 assets, uint256 shares)
        internal
        override
    {
        if (assets > cash) revert NotEnoughCash();
        cash -= assets;
        super._withdraw(caller, receiver, holder, assets, shares);
    }

    // ================================================================ borrowers

    /// @notice Lock `collateral` USDT and borrow `pesos` wARS for `termDays` (7, 30, 60 or 90).
    /// Reverts if the yearly rate for this loan would be above `maxRateBps`.
    function borrow(uint256 collateral, uint256 pesos, uint16 termDays, uint256 maxRateBps)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 loanId)
    {
        return _borrow(msg.sender, collateral, pesos, termDays, maxRateBps);
    }

    /// @notice Same as `borrow`, with a USDT permit so approval and borrowing are one transaction.
    function borrowWithPermit(
        uint256 collateral,
        uint256 pesos,
        uint16 termDays,
        uint256 maxRateBps,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused returns (uint256 loanId) {
        // A front-run permit leaves the allowance in place, so a failed permit is not fatal.
        try IERC20Permit(address(usdt)).permit(msg.sender, address(this), collateral, deadline, v, r, s) {} catch {}
        return _borrow(msg.sender, collateral, pesos, termDays, maxRateBps);
    }

    function _borrow(address borrower, uint256 collateral, uint256 pesos, uint16 termDays, uint256 maxRateBps)
        internal
        returns (uint256 loanId)
    {
        if (termDays != 7 && termDays != 30 && termDays != 60 && termDays != 90) revert BadTerm();
        if (pesos < MIN_LOAN) revert BelowMinimum();
        _accrue();

        uint8 tier = creditBook.tier(borrower);
        if (pesos > maxPesosForTier(tier)) revert AboveLoanLimit();

        uint256 price = priceModule.borrowPrice();
        uint256 value = collateral.mulDiv(price, usdtUnit);
        if (pesos > value.mulDiv(maxLtvBpsForTier(tier), BPS)) revert AboveBorrowLimit();

        uint256 debt = _sumDebt(_indices());
        if (pesos > cash) revert NotEnoughCash();
        Caps memory c = caps;
        uint256 assets = cash + debt - reserve;
        if (
            debt + pesos > c.absolute || debt + pesos > assets.mulDiv(c.depositsBps, BPS)
                || debt + pesos > priceModule.warsDepth().mulDiv(c.depthBps, BPS)
        ) revert AboveCap();

        uint256 rateBps = _poolRateBps(debt + pesos, cash - pesos) - _discountBps(tier);
        if (rateBps > maxRateBps) revert RateAboveMax(rateBps);

        usdt.safeTransferFrom(borrower, address(this), collateral);
        totalCollateral += collateral;

        uint256 scaled = pesos.mulDiv(WAD, borrowIndex[tier], Math.Rounding.Ceil);
        scaledTotal[tier] += scaled;
        cash -= pesos;

        loanId = nextLoanId++;
        uint64 due = uint64(block.timestamp + uint256(termDays) * 1 days);
        _loans[loanId] = Loan({
            borrower: borrower,
            tier: tier,
            open: true,
            liquidated: false,
            termDays: termDays,
            openedAt: uint64(block.timestamp),
            dueAt: due,
            penaltyFrom: due,
            collateral: uint128(collateral),
            scaledDebt: scaled
        });

        uint256 fee = pesos.mulDiv(OPEN_FEE_BPS, BPS, Math.Rounding.Ceil);
        creditBook.recordOpen(borrower, pesos);
        _wars.safeTransfer(borrower, pesos - fee);
        if (fee > 0) _wars.safeTransfer(treasury, fee);
        emit Borrowed(loanId, borrower, collateral, pesos, fee, termDays, tier, price, rateBps);
    }

    /// @notice Anyone can add USDT to any open loan (the guard uses this to protect a loan).
    function addCollateral(uint256 loanId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Loan storage l = _openLoan(loanId);
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        l.collateral += uint128(amount);
        totalCollateral += amount;
        emit CollateralAdded(loanId, msg.sender, amount);
    }

    /// @notice Anyone can repay any open loan. Pays at most what is owed; returns what was paid.
    /// A full repayment returns all collateral to the borrower in the same transaction.
    function repay(uint256 loanId, uint256 pesos) external nonReentrant returns (uint256 paid) {
        return _repayFrom(msg.sender, loanId, pesos);
    }

    function repayWithPermit(uint256 loanId, uint256 pesos, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 paid)
    {
        try IERC20Permit(address(_wars)).permit(msg.sender, address(this), pesos, deadline, v, r, s) {} catch {}
        return _repayFrom(msg.sender, loanId, pesos);
    }

    function _repayFrom(address payer, uint256 loanId, uint256 pesos) internal returns (uint256 paid) {
        if (pesos == 0) revert ZeroAmount();
        _accrue();
        Loan storage l = _openLoan(loanId);
        _applyPenalty(loanId, l);
        uint256 debt = _loanDebt(l);
        paid = pesos < debt ? pesos : debt;
        _wars.safeTransferFrom(payer, address(this), paid);
        _settleRepayment(loanId, l, paid, debt, payer);
    }

    /// @notice Repay with USDT: swaps `usdtIn` USDT for wARS in the Uniswap pool and repays. Reverts if fewer than
    /// `minPesosOut` pesos come out. Pesos beyond the debt go back to the caller.
    function repayWithSwap(uint256 loanId, uint256 usdtIn, uint256 minPesosOut)
        external
        nonReentrant
        returns (uint256 paid)
    {
        if (usdtIn == 0) revert ZeroAmount();
        _accrue();
        Loan storage l = _openLoan(loanId);
        _applyPenalty(loanId, l);

        uint256 before = _wars.balanceOf(address(this));
        _swapPayer = msg.sender;
        uint160 limit = _usdtIsToken0 ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE;
        swapPool.swap(address(this), _usdtIsToken0, int256(usdtIn), limit, "");
        _swapPayer = address(0);
        uint256 received = _wars.balanceOf(address(this)) - before;
        if (received < minPesosOut) revert SlippageExceeded();

        uint256 debt = _loanDebt(l);
        paid = received < debt ? received : debt;
        _settleRepayment(loanId, l, paid, debt, msg.sender);
        if (received > paid) _wars.safeTransfer(msg.sender, received - paid);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != address(swapPool) || _swapPayer == address(0)) revert NotSwapPool();
        uint256 owed = uint256(_usdtIsToken0 ? amount0Delta : amount1Delta);
        usdt.safeTransferFrom(_swapPayer, msg.sender, owed);
    }

    function _settleRepayment(uint256 loanId, Loan storage l, uint256 paid, uint256 debt, address payer) internal {
        _reduceDebt(l, paid, debt);
        cash += paid;
        emit Repaid(loanId, payer, paid, debt - paid);
        address borrower = l.borrower;
        if (paid == debt) _close(loanId, l);
        creditBook.recordRepayment(borrower, paid);
    }

    /// @notice The borrower takes back part of the collateral while the loan stays under 60% of what is left.
    function withdrawCollateral(uint256 loanId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _accrue();
        Loan storage l = _openLoan(loanId);
        if (msg.sender != l.borrower) revert NotBorrower();
        _applyPenalty(loanId, l);
        if (amount > l.collateral) revert TooMuchWithdrawn();
        uint256 left = l.collateral - amount;
        uint256 debt = _loanDebt(l);
        uint256 value = left.mulDiv(priceModule.borrowPrice(), usdtUnit);
        if (debt > value.mulDiv(WITHDRAW_LTV_BPS, BPS)) revert TooMuchWithdrawn();
        l.collateral = uint128(left);
        totalCollateral -= amount;
        usdt.safeTransfer(l.borrower, amount);
        emit CollateralWithdrawn(loanId, amount);
    }

    // ================================================================ liquidation

    /// @notice When a loan's debt is over 80% of its collateral at the 30-minute price, anyone may repay up to half of
    /// it (all of it under 10,000 wARS) and receive collateral worth the pesos repaid plus 5%.
    function liquidate(uint256 loanId, uint256 pesos) external nonReentrant returns (uint256 repaid, uint256 seized) {
        if (pesos == 0) revert ZeroAmount();
        _accrue();
        Loan storage l = _openLoan(loanId);
        _applyPenalty(loanId, l);
        uint256 price = priceModule.liquidationPrice();
        uint256 debt = _loanDebt(l);
        uint256 value = uint256(l.collateral).mulDiv(price, usdtUnit);
        if (debt * BPS <= value * LIQUIDATION_LTV_BPS) revert NotLiquidatable();

        uint256 maxRepay = debt < SMALL_DEBT ? debt : debt.mulDiv(CLOSE_FACTOR_BPS, BPS);
        repaid = pesos < maxRepay ? pesos : maxRepay;
        seized = repaid.mulDiv(BPS + LIQUIDATION_BONUS_BPS, BPS).mulDiv(usdtUnit, price);
        if (seized > l.collateral) {
            seized = l.collateral;
            repaid = value.mulDiv(BPS, BPS + LIQUIDATION_BONUS_BPS, Math.Rounding.Ceil);
            if (repaid > debt) repaid = debt;
        }

        _wars.safeTransferFrom(msg.sender, address(this), repaid);
        _reduceDebt(l, repaid, debt);
        cash += repaid;
        l.collateral -= uint128(seized);
        totalCollateral -= seized;
        l.liquidated = true;
        emit Liquidated(loanId, msg.sender, repaid, seized, price);

        uint256 left = debt - repaid;
        if (left == 0) {
            _close(loanId, l);
        } else if (l.collateral == 0) {
            _writeOff(loanId, l, left);
        }
        address borrower = l.borrower;
        creditBook.recordRepayment(borrower, repaid);
        creditBook.recordLiquidation(borrower);
        usdt.safeTransfer(msg.sender, seized);
    }

    function _writeOff(uint256 loanId, Loan storage l, uint256 amount) internal {
        scaledTotal[l.tier] -= l.scaledDebt;
        l.scaledDebt = 0;
        l.open = false;
        uint256 covered = amount < reserve ? amount : reserve;
        reserve -= covered;
        emit BadDebt(loanId, amount, covered);
    }

    // ================================================================ wARS freeze exit

    /// @notice Records whether wARS can currently leave the pool. Anyone may call it.
    function probeFreeze() public returns (bool frozen) {
        frozen = !_warsMoves();
        if (frozen && frozenSince == 0) frozenSince = uint64(block.timestamp);
        if (!frozen) frozenSince = 0;
        emit FreezeProbe(frozen, frozenSince);
    }

    /// @notice If wARS has not been able to leave the pool for 24 hours, a borrower can take back the collateral above
    /// the dollar value of their debt. The rest stays as the lenders' claim and the loan stays open.
    function emergencyReleaseCollateral(uint256 loanId) external nonReentrant returns (uint256 released) {
        probeFreeze();
        if (frozenSince == 0 || block.timestamp - frozenSince < FREEZE_DELAY) revert NotFrozen();
        _accrue();
        Loan storage l = _openLoan(loanId);
        if (msg.sender != l.borrower) revert NotBorrower();
        _applyPenalty(loanId, l);
        uint256 keep = _loanDebt(l).mulDiv(usdtUnit, priceModule.liquidationPrice(), Math.Rounding.Ceil);
        if (keep >= l.collateral) return 0;
        released = l.collateral - keep;
        l.collateral = uint128(keep);
        totalCollateral -= released;
        usdt.safeTransfer(l.borrower, released);
        emit EmergencyCollateralReleased(loanId, released);
    }

    function _warsMoves() internal returns (bool) {
        try IERC20(address(_wars)).transfer(address(this), 0) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    // ================================================================ owner and guardian

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner) revert NotGuardianOrOwner();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external {
        if (msg.sender != guardian && msg.sender != owner) revert NotGuardianOrOwner();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Lowering caps takes effect at once.
    function lowerCaps(Caps calldata c) external onlyOwner {
        Caps memory cur = caps;
        if (c.absolute > cur.absolute || c.depositsBps > cur.depositsBps || c.depthBps > cur.depthBps) {
            revert CapsNotLower();
        }
        caps = c;
        emit CapsLowered(c.absolute, c.depositsBps, c.depthBps);
    }

    /// @notice Raising caps waits 24 hours on chain.
    function scheduleCaps(Caps calldata c) external onlyOwner {
        if (c.depositsBps > BPS || c.depthBps > BPS) revert AboveCap();
        pendingCaps = c;
        pendingCapsEta = uint64(block.timestamp + CAP_DELAY);
        emit CapsRaiseScheduled(c.absolute, c.depositsBps, c.depthBps, pendingCapsEta);
    }

    function executeCaps() external onlyOwner {
        if (pendingCapsEta == 0) revert NothingScheduled();
        if (block.timestamp < pendingCapsEta) revert NotReady();
        caps = pendingCaps;
        pendingCapsEta = 0;
        emit CapsRaised(caps.absolute, caps.depositsBps, caps.depthBps);
    }

    /// @notice Moving reserve to the treasury is public for 48 hours first.
    function scheduleReserveMove(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        pendingReserveMove = amount;
        pendingReserveEta = uint64(block.timestamp + RESERVE_DELAY);
        emit ReserveMoveScheduled(amount, pendingReserveEta);
    }

    function cancelReserveMove() external onlyOwner {
        pendingReserveMove = 0;
        pendingReserveEta = 0;
        emit ReserveMoveCancelled();
    }

    function executeReserveMove() external onlyOwner nonReentrant {
        if (pendingReserveEta == 0) revert NothingScheduled();
        if (block.timestamp < pendingReserveEta) revert NotReady();
        _accrue();
        uint256 amount = pendingReserveMove;
        if (amount > reserve) amount = reserve;
        if (amount > cash) amount = cash;
        pendingReserveMove = 0;
        pendingReserveEta = 0;
        reserve -= amount;
        cash -= amount;
        _wars.safeTransfer(treasury, amount);
        emit ReserveMoved(amount, treasury);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ================================================================ interest

    function accrue() external {
        _accrue();
    }

    function _accrue() internal {
        if (block.timestamp == lastAccrual) return;
        uint256[TIERS] memory before = _indices();
        uint256 debtBefore = _sumDebt(before);
        uint256 rate = _poolRateBps(debtBefore, cash);
        (uint256[TIERS] memory idx, uint256 res) = _accruedView();
        borrowIndex = idx;
        uint256 interest = _sumDebt(idx) - debtBefore;
        reserve = res;
        lastAccrual = uint64(block.timestamp);
        if (interest > 0) emit Accrued(interest, interest.mulDiv(RESERVE_BPS, BPS), rate);
    }

    function _accruedView() internal view returns (uint256[TIERS] memory idx, uint256 res) {
        idx = _indices();
        res = reserve;
        uint256 dt = block.timestamp - lastAccrual;
        if (dt == 0) return (idx, res);
        uint256 debtBefore = _sumDebt(idx);
        if (debtBefore == 0) return (idx, res);
        uint256 base = _poolRateBps(debtBefore, cash);
        for (uint256 i; i < TIERS; ++i) {
            uint256 x = ((base - _discountBps(uint8(i))) * WAD * dt) / (BPS * YEAR);
            idx[i] = idx[i].mulDiv(WAD + _compound(x), WAD);
        }
        uint256 interest = _sumDebt(idx) - debtBefore;
        res += interest.mulDiv(RESERVE_BPS, BPS);
    }

    /// @dev e^x - 1 to three terms (x in WAD); exact enough for the seconds-to-days gaps between accruals.
    function _compound(uint256 x) internal pure returns (uint256) {
        uint256 x2 = x.mulDiv(x, 2 * WAD);
        uint256 x3 = x2.mulDiv(x, 3 * WAD);
        return x + x2 + x3;
    }

    function _applyPenalty(uint256 loanId, Loan storage l) internal {
        if (block.timestamp <= l.dueAt) return;
        uint256 from = l.penaltyFrom > l.dueAt ? l.penaltyFrom : l.dueAt;
        if (block.timestamp <= from) return;
        uint256 debt = _loanDebt(l);
        uint256 extra = debt.mulDiv(LATE_EXTRA_BPS * (block.timestamp - from), BPS * YEAR, Math.Rounding.Ceil);
        l.penaltyFrom = uint64(block.timestamp);
        if (extra == 0) return;
        uint256 scaled = extra.mulDiv(WAD, borrowIndex[l.tier], Math.Rounding.Ceil);
        l.scaledDebt += scaled;
        scaledTotal[l.tier] += scaled;
        reserve += extra.mulDiv(RESERVE_BPS, BPS);
        emit PenaltyAdded(loanId, extra);
    }

    function _reduceDebt(Loan storage l, uint256 paid, uint256 debt) internal {
        if (paid == debt) {
            scaledTotal[l.tier] -= l.scaledDebt;
            l.scaledDebt = 0;
        } else {
            uint256 s = paid.mulDiv(WAD, borrowIndex[l.tier]);
            if (s >= l.scaledDebt) s = l.scaledDebt - 1;
            l.scaledDebt -= s;
            scaledTotal[l.tier] -= s;
        }
    }

    /// @dev A loan that was ever liquidated closes without counting as a repayment; the liquidation is its record.
    function _close(uint256 loanId, Loan storage l) internal {
        l.open = false;
        uint256 back = l.collateral;
        l.collateral = 0;
        totalCollateral -= back;
        bool onTime = !l.liquidated && block.timestamp <= uint256(l.dueAt) + GRACE;
        address borrower = l.borrower;
        emit LoanClosed(loanId, borrower, onTime, back);
        if (!l.liquidated) creditBook.recordClosed(borrower, onTime);
        if (back > 0) usdt.safeTransfer(borrower, back);
    }

    function _openLoan(uint256 loanId) internal view returns (Loan storage l) {
        l = _loans[loanId];
        if (!l.open) revert LoanNotOpen();
    }

    function _loanDebt(Loan storage l) internal view returns (uint256) {
        return l.scaledDebt.mulDiv(borrowIndex[l.tier], WAD, Math.Rounding.Ceil);
    }

    function _indices() internal view returns (uint256[TIERS] memory idx) {
        for (uint256 i; i < TIERS; ++i) {
            idx[i] = borrowIndex[i];
        }
    }

    function _sumDebt(uint256[TIERS] memory idx) internal view returns (uint256 total) {
        for (uint256 i; i < TIERS; ++i) {
            total += scaledTotal[i].mulDiv(idx[i], WAD, Math.Rounding.Ceil);
        }
    }

    function _poolRateBps(uint256 debt, uint256 free) internal pure returns (uint256) {
        uint256 u = debt + free == 0 ? 0 : debt.mulDiv(BPS, debt + free);
        if (u <= KINK_UTIL_BPS) return BASE_RATE_BPS + (KINK_RATE_BPS - BASE_RATE_BPS) * u / KINK_UTIL_BPS;
        return KINK_RATE_BPS + (TOP_RATE_BPS - KINK_RATE_BPS) * (u - KINK_UTIL_BPS) / (BPS - KINK_UTIL_BPS);
    }

    function _discountBps(uint8 tier) internal pure returns (uint256) {
        return uint256(tier) * 100;
    }

    // ================================================================ limits by credit step

    function maxLtvBpsForTier(uint8 tier) public pure returns (uint256) {
        if (tier >= 3) return 6_500;
        if (tier == 2) return 6_400;
        if (tier == 1) return 6_200;
        return 6_000;
    }

    function maxPesosForTier(uint8 tier) public pure returns (uint256) {
        if (tier >= 3) return 5_000_000e18;
        if (tier == 2) return 3_000_000e18;
        if (tier == 1) return 2_000_000e18;
        return 1_000_000e18;
    }

    // ================================================================ views

    function loans(uint256 loanId) external view returns (Loan memory) {
        return _loans[loanId];
    }

    /// @notice What a loan owes right now, including interest and any late extra not yet written.
    function debtOf(uint256 loanId) public view returns (uint256) {
        Loan storage l = _loans[loanId];
        if (!l.open) return 0;
        (uint256[TIERS] memory idx,) = _accruedView();
        uint256 debt = l.scaledDebt.mulDiv(idx[l.tier], WAD, Math.Rounding.Ceil);
        if (block.timestamp > l.dueAt) {
            uint256 from = l.penaltyFrom > l.dueAt ? l.penaltyFrom : l.dueAt;
            if (block.timestamp > from) {
                debt += debt.mulDiv(LATE_EXTRA_BPS * (block.timestamp - from), BPS * YEAR, Math.Rounding.Ceil);
            }
        }
        return debt;
    }

    /// @notice Debt as a share of collateral value at the 30-minute price, in basis points.
    function loanLtvBps(uint256 loanId) external view returns (uint256) {
        Loan storage l = _loans[loanId];
        if (!l.open || l.collateral == 0) return 0;
        uint256 value = uint256(l.collateral).mulDiv(priceModule.liquidationPrice(), usdtUnit);
        return debtOf(loanId).mulDiv(BPS, value, Math.Rounding.Ceil);
    }

    function totalDebt() public view returns (uint256) {
        (uint256[TIERS] memory idx,) = _accruedView();
        return _sumDebt(idx);
    }

    function utilizationBps() external view returns (uint256) {
        uint256 d = totalDebt();
        return d + cash == 0 ? 0 : d.mulDiv(BPS, d + cash);
    }

    /// @notice Yearly borrow rate for a borrower at this credit step, right now.
    function borrowRateBps(uint8 tier) external view returns (uint256) {
        return _poolRateBps(totalDebt(), cash) - _discountBps(tier);
    }

    /// @notice Yearly rate lenders earn right now (before compounding), in basis points.
    function lenderRateBps() external view returns (uint256) {
        uint256 d = totalDebt();
        if (d + cash == 0) return 0;
        uint256 u = d.mulDiv(BPS, d + cash);
        return _poolRateBps(d, cash).mulDiv(u, BPS).mulDiv(BPS - RESERVE_BPS, BPS);
    }
}
