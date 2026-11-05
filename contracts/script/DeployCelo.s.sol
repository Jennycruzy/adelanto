// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PesoPool} from "../src/PesoPool.sol";
import {PriceModule} from "../src/PriceModule.sol";
import {CreditBook} from "../src/CreditBook.sol";
import {LoanGuard} from "../src/LoanGuard.sol";
import {IPriceModule} from "../src/interfaces/IPriceModule.sol";
import {ICreditBook} from "../src/interfaces/ICreditBook.sol";
import {IUniswapV3Pool} from "../src/interfaces/IUniswapV3Pool.sol";

/// @notice Deploys the Celo contracts. Reads GUARDIAN, AGENT and TREASURY from the environment.
contract DeployCelo is Script {
    address constant WARS = 0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant UNI = 0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391;

    function run() external {
        address guardian = vm.envAddress("GUARDIAN");
        address agent = vm.envAddress("AGENT");
        address treasury = vm.envAddress("TREASURY");
        require(block.chainid == 42220, "Celo only");

        vm.startBroadcast();
        PriceModule price = new PriceModule(IUniswapV3Pool(UNI), WARS, USDT, 30_000_000e18);
        CreditBook book = new CreditBook();
        PesoPool pool = new PesoPool(
            IERC20(WARS),
            IERC20(USDT),
            IPriceModule(address(price)),
            ICreditBook(address(book)),
            IUniswapV3Pool(UNI),
            treasury,
            guardian,
            PesoPool.Caps({absolute: 20_000_000e18, depositsBps: 7_000, depthBps: 1_500})
        );
        book.bindPool(address(pool));
        LoanGuard guard = new LoanGuard(pool, agent);
        vm.stopBroadcast();

        console2.log("PriceModule", address(price));
        console2.log("CreditBook", address(book));
        console2.log("PesoPool", address(pool));
        console2.log("LoanGuard", address(guard));
    }
}
