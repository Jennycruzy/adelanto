// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MorphoProxyFactory} from "../src/ethereum/MorphoProxyFactory.sol";
import {IMorpho, IRipioBridge, IOFT} from "../src/ethereum/Interfaces.sol";

/// @notice Deploys the proxy factory on Ethereum.
contract DeployEthereum is Script {
    function run() external {
        require(block.chainid == 1, "Ethereum only");
        vm.startBroadcast();
        MorphoProxyFactory f = new MorphoProxyFactory(
            IMorpho(0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb),
            IERC20(0xdAC17F958D2ee523a2206206994597C13D831ec7),
            IERC20(0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D),
            IRipioBridge(0x465e642387d3d73a57CDc1368fFA53A800bA5D47),
            IOFT(0x1F748c76dE468e9D11bd340fA9D5CBADf315dFB0)
        );
        vm.stopBroadcast();
        console2.log("MorphoProxyFactory", address(f));
    }
}
