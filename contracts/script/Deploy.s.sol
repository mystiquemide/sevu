// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SevuLock} from "../src/SevuLock.sol";

/// @notice Deploys SevuLock for USDT0 on Polygon. The deployer gets no privileges.
/// With DEPLOYER_PRIVATE_KEY set, the key is read from the environment and never appears in argv.
/// Otherwise pass a signer flag, e.g. --account <keystore>.
/// forge script script/Deploy.s.sol --rpc-url polygon --broadcast
contract Deploy is Script {
    address constant USDT0 = 0xc2132D05D31c914a87C6611C10748AEb04B58e8F;

    function run() external returns (SevuLock lock) {
        require(block.chainid == 137, "not Polygon");
        require(USDT0.code.length > 0, "USDT0 missing");
        uint256 key = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (key != 0) vm.startBroadcast(key);
        else vm.startBroadcast();
        lock = new SevuLock(IERC20(USDT0));
        vm.stopBroadcast();
        require(address(lock.token()) == USDT0, "token mismatch");
        require(lock.lockCount() == 0 && lock.totalLocked() == 0, "not empty");
        console.log("SevuLock deployed at", address(lock));
    }
}
