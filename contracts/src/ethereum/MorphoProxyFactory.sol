// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MorphoProxy} from "./MorphoProxy.sol";
import {IMorpho, IRipioBridge, IOFT} from "./Interfaces.sol";

/// @title MorphoProxyFactory
/// @notice Deploys one MorphoProxy per person with CREATE2 (salt = their address), so the proxy's address is known
/// before it exists and dollars can be sent to it from Celo first.
contract MorphoProxyFactory {
    IMorpho public immutable morpho;
    IERC20 public immutable usdt;
    IERC20 public immutable wars;
    IRipioBridge public immutable ripio;
    IOFT public immutable usdt0;

    event ProxyDeployed(address indexed owner, address proxy);

    constructor(IMorpho morpho_, IERC20 usdt_, IERC20 wars_, IRipioBridge ripio_, IOFT usdt0_) {
        morpho = morpho_;
        usdt = usdt_;
        wars = wars_;
        ripio = ripio_;
        usdt0 = usdt0_;
    }

    function proxyOf(address owner) public view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(uint256(uint160(owner))), keccak256(_initCode(owner)))
        );
        return address(uint160(uint256(h)));
    }

    function deploy(address owner) external returns (address proxy) {
        proxy = proxyOf(owner);
        if (proxy.code.length > 0) return proxy;
        bytes memory code = _initCode(owner);
        bytes32 salt = bytes32(uint256(uint160(owner)));
        assembly {
            proxy := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(proxy != address(0), "deploy failed");
        emit ProxyDeployed(owner, proxy);
    }

    function _initCode(address owner) internal view returns (bytes memory) {
        return abi.encodePacked(type(MorphoProxy).creationCode, abi.encode(owner, morpho, usdt, wars, ripio, usdt0));
    }
}
