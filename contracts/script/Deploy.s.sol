// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SevuLock} from "../src/SevuLock.sol";

/// @notice Deploys SevuLock for USDT0 on Polygon. The deployer gets no privileges.
/// forge script script/Deploy.s.sol --rpc-url polygon --broadcast --interactives 1
contract Deploy is Script {
    address constant USDT0 = 0xc2132D05D31c914a87C6611C10748AEb04B58e8F;

    function run() external returns (SevuLock lock) {
        require(block.chainid == 137, "not Polygon");
        require(USDT0.code.length > 0, "USDT0 missing");
        vm.startBroadcast();
        lock = new SevuLock(IERC20(USDT0));
        vm.stopBroadcast();
        require(address(lock.token()) == USDT0, "token mismatch");
        require(lock.lockCount() == 0 && lock.totalLocked() == 0, "not empty");
        console.log("SevuLock deployed at", address(lock));
    }
}
