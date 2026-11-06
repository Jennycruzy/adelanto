// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MorphoProxy} from "../../src/ethereum/MorphoProxy.sol";
import {MorphoProxyFactory} from "../../src/ethereum/MorphoProxyFactory.sol";
import {IMorpho, IRipioBridge, IOFT, IIrm, MarketParams} from "../../src/ethereum/Interfaces.sol";

/// @dev Runs against Ethereum mainnet state: real Morpho, the wARS/USDT market, Ripio Bridge and USDT0. Needs ETH_RPC_URL.
contract EthereumForkTest is Test {
    address constant MORPHO = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant WARS = 0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D;
    address constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant RIPIO = 0x465e642387d3d73a57CDc1368fFA53A800bA5D47;
    address constant USDT0 = 0x1F748c76dE468e9D11bd340fA9D5CBADf315dFB0;
    bytes32 constant MARKET = 0x8e6271e428ee5b41c98a3765919e359f16b0c6261c85d84f9b9b8b5242ab9c9e;

    MorphoProxyFactory factory;
    MorphoProxy proxy;
    address user;
    uint256 userKey;
    address agent = makeAddr("agent");
    bool live;

    function setUp() public {
        string memory rpc = vm.envOr("ETH_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        (user, userKey) = makeAddrAndKey("user");
        factory =
            new MorphoProxyFactory(IMorpho(MORPHO), IERC20(USDT), IERC20(WARS), IRipioBridge(RIPIO), IOFT(USDT0));
        vm.deal(agent, 1 ether);
    }

    modifier onlyLive() {
        if (!live) return;
        _;
    }

    function _sign(MorphoProxy.Order memory o) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                proxy.ORDER_TYPEHASH(),
                o.borrower,
                uint8(o.action),
                o.marketId,
                o.collateralUsdt,
                o.borrowWars,
                o.maxRateBps,
                o.nonce,
                o.deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", proxy.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _order(MorphoProxy.Action a, uint256 col, uint256 amt, uint256 nonce)
        internal
        view
        returns (MorphoProxy.Order memory)
    {
        return MorphoProxy.Order({
            borrower: user,
            action: a,
            marketId: MARKET,
            collateralUsdt: col,
            borrowWars: amt,
            maxRateBps: 500,
            nonce: nonce,
            deadline: block.timestamp + 1 hours
        });
    }

    function _deployAndFund() internal {
        address predicted = factory.proxyOf(user);
        deal(USDT, predicted, 3_498_950); // what USDT0 delivered in the live test
        proxy = MorphoProxy(payable(factory.deploy(user)));
        assertEq(address(proxy), predicted);
    }

    function test_fork_proxyAddressKnownBeforeDeploy() public onlyLive {
        address predicted = factory.proxyOf(user);
        assertEq(predicted.code.length, 0);
        proxy = MorphoProxy(payable(factory.deploy(user)));
        assertEq(address(proxy), predicted);
        assertEq(factory.deploy(user), predicted); // idempotent
        assertEq(proxy.owner(), user);
    }

    function test_fork_openSendsPesosHome() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        bytes memory sig = _sign(o);
        vm.prank(agent);
        proxy.execute(o, sig);
        (, uint128 shares, uint128 col) = IMorpho(MORPHO).position(MARKET, address(proxy));
        assertEq(col, 3_498_950);
        assertGt(shares, 0);
        assertEq(IERC20(WARS).balanceOf(address(proxy)), 0, "all pesos went into the bridge");
    }

    function test_fork_proxyDestinationFixed() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        bytes memory sig = _sign(o);
        vm.recordLogs();
        vm.prank(agent);
        proxy.execute(o, sig);
        // The bridge deposit is addressed to the owner on Celo: look for the owner's address in the bridge's event data.
        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != RIPIO) continue;
            for (uint256 t; t < logs[i].topics.length; t++) {
                if (logs[i].topics[t] == bytes32(uint256(uint160(user)))) found = true;
            }
            bytes memory d = logs[i].data;
            for (uint256 j; j + 32 <= d.length; j += 32) {
                bytes32 w;
                assembly {
                    w := mload(add(add(d, 32), j))
                }
                if (w == bytes32(uint256(uint160(user)))) found = true;
            }
        }
        assertTrue(found, "bridge deposit names the owner");
    }

    function test_fork_closeBringsDollarsHome() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        bytes memory sig = _sign(o);
        vm.prank(agent);
        proxy.execute(o, sig);
        vm.warp(block.timestamp + 1 days);
        deal(WARS, address(proxy), 3_100e18); // pesos that came back through the bridge
        MorphoProxy.Order memory c = _order(MorphoProxy.Action.Close, 0, 0, 2);
        bytes memory sig2 = _sign(c);
        vm.prank(agent);
        proxy.execute{value: 0.001 ether}(c, sig2);
        (, uint128 shares, uint128 col) = IMorpho(MORPHO).position(MARKET, address(proxy));
        assertEq(shares, 0);
        assertEq(col, 0);
        assertEq(IERC20(USDT).balanceOf(address(proxy)), 0, "collateral sent home via USDT0");
    }

    function test_fork_replayRejected() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.AddCollateral, 0, 0, 7);
        bytes memory sig = _sign(o);
        proxy.execute(o, sig);
        vm.expectRevert(MorphoProxy.NonceUsed.selector);
        proxy.execute(o, sig);
    }

    function test_fork_wrongSignerRejected() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        (, uint256 otherKey) = makeAddrAndKey("mallory");
        bytes32 structHash = keccak256(
            abi.encode(
                proxy.ORDER_TYPEHASH(),
                o.borrower,
                uint8(o.action),
                o.marketId,
                o.collateralUsdt,
                o.borrowWars,
                o.maxRateBps,
                o.nonce,
                o.deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(otherKey, keccak256(abi.encodePacked("\x19\x01", proxy.domainSeparator(), structHash)));
        vm.expectRevert(MorphoProxy.BadSignature.selector);
        proxy.execute(o, abi.encodePacked(r, s, v));
    }

    function test_fork_expiredOrderRejected() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        bytes memory sig = _sign(o);
        vm.warp(o.deadline + 1);
        vm.expectRevert(MorphoProxy.OrderExpired.selector);
        proxy.execute(o, sig);
    }

    function test_fork_rateCeilingEnforced() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        o.maxRateBps = 0;
        bytes memory sig = _sign(o);
        vm.expectRevert();
        proxy.execute(o, sig);
    }

    function test_fork_wrongMarketRejected() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        o.marketId = bytes32(uint256(1));
        bytes memory sig = _sign(o);
        vm.expectRevert(MorphoProxy.WrongMarket.selector);
        proxy.execute(o, sig);
    }

    function test_fork_wrongBorrowerRejected() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        o.borrower = agent;
        bytes memory sig = _sign(o);
        vm.expectRevert(MorphoProxy.WrongBorrower.selector);
        proxy.execute(o, sig);
    }

    function test_fork_ownerExitWithoutOrder() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        bytes memory sig = _sign(o);
        proxy.execute(o, sig);
        deal(WARS, address(proxy), 3_100e18);
        vm.deal(user, 1 ether);
        vm.prank(user);
        proxy.exit{value: 0.001 ether}(MARKET);
        (, uint128 shares, uint128 col) = IMorpho(MORPHO).position(MARKET, address(proxy));
        assertEq(shares, 0);
        assertEq(col, 0);
    }

    function test_fork_strangerCannotExitOrSendHome() public onlyLive {
        _deployAndFund();
        vm.startPrank(agent);
        vm.expectRevert(MorphoProxy.NotOwner.selector);
        proxy.exit(MARKET);
        vm.expectRevert(MorphoProxy.NotOwner.selector);
        proxy.sendDollarsHome();
        vm.expectRevert(MorphoProxy.NotOwner.selector);
        proxy.sendPesosHome();
        vm.stopPrank();
    }

    function test_fork_partialRepay() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        bytes memory sig = _sign(o);
        proxy.execute(o, sig);
        deal(WARS, address(proxy), 1_000e18);
        MorphoProxy.Order memory r = _order(MorphoProxy.Action.Repay, 0, 1_000e18, 2);
        bytes memory sig2 = _sign(r);
        proxy.execute(r, sig2);
        (, uint128 shares,) = IMorpho(MORPHO).position(MARKET, address(proxy));
        assertGt(shares, 0);
        assertEq(IERC20(WARS).balanceOf(address(proxy)), 0);
    }

    function _open() internal {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 3_000e18, 1);
        proxy.execute(o, _sign(o));
    }

    /// Regression: a signed repayment sent before the pesos arrived used to succeed as a no-op and burn its nonce.
    function test_fork_unfundedRepayRevertsAndCanBeRetried() public onlyLive {
        _open();
        MorphoProxy.Order memory r = _order(MorphoProxy.Action.Repay, 0, 1_000e18, 2);
        bytes memory sig = _sign(r);
        vm.expectRevert(MorphoProxy.NotFunded.selector);
        proxy.execute(r, sig);
        assertFalse(proxy.nonceUsed(2));
        deal(WARS, address(proxy), 1_000e18);
        proxy.execute(r, sig);
        assertTrue(proxy.nonceUsed(2));
    }

    function test_fork_unfundedAddCollateralReverts() public onlyLive {
        _open();
        MorphoProxy.Order memory a = _order(MorphoProxy.Action.AddCollateral, 1e6, 0, 2);
        bytes memory sig = _sign(a);
        vm.expectRevert(MorphoProxy.NotFunded.selector);
        proxy.execute(a, sig);
        assertFalse(proxy.nonceUsed(2));
    }

    function test_fork_openWithMissingCollateralReverts() public onlyLive {
        _deployAndFund();
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 10e6, 3_000e18, 1); // only 3.5 USDT there
        bytes memory sig = _sign(o);
        vm.expectRevert(MorphoProxy.NotFunded.selector);
        proxy.execute(o, sig);
    }

    function test_fork_exitOrderWithDebtLeftReverts() public onlyLive {
        _open();
        MorphoProxy.Order memory e = _order(MorphoProxy.Action.Exit, 0, 0, 2);
        bytes memory sig = _sign(e);
        vm.expectRevert(MorphoProxy.NotDone.selector);
        proxy.execute(e, sig);
        assertFalse(proxy.nonceUsed(2));
    }

    /// Regression: the rate ceiling used to be checked before the borrow, so a borrow that pushed the market's rate
    /// above it still went through.
    function test_fork_rateCeilingAppliesAfterBorrow() public onlyLive {
        address predicted = factory.proxyOf(user);
        deal(USDT, predicted, 3_000e6);
        proxy = MorphoProxy(payable(factory.deploy(user)));
        IMorpho m = IMorpho(MORPHO);
        MarketParams memory mp = m.idToMarketParams(MARKET);
        m.accrueInterest(mp);
        uint256 before = IIrm(mp.irm).borrowRateView(mp, m.market(MARKET)) * 365 days * 10_000 / 1e18;
        // 2M wARS on a ~21M market moves its use, and so its rate, well past one basis point.
        MorphoProxy.Order memory o = _order(MorphoProxy.Action.Open, 0, 2_000_000e18, 1);
        o.maxRateBps = before; // fine before the borrow, above it after
        bytes memory sig = _sign(o);
        vm.expectRevert();
        proxy.execute(o, sig);
        o.maxRateBps = before + 2_000;
        o.nonce = 2;
        proxy.execute(o, _sign(o)); // with room for its own effect, the same borrow goes through
    }
}

import {Vm} from "forge-std/Vm.sol";
