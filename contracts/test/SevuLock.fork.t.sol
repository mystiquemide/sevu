// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SevuLock} from "../src/SevuLock.sol";

interface IUSDT0 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function permit(address, address, uint256, uint256, uint8, bytes32, bytes32) external;
}

/// @dev Runs against Polygon mainnet state. Set POLYGON_RPC to run; skipped otherwise.
contract SevuLockForkTest is Test {
    address constant USDT0 = 0xc2132D05D31c914a87C6611C10748AEb04B58e8F;
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    SevuLock lock;
    IUSDT0 t = IUSDT0(USDT0);
    address owner;
    uint256 ownerKey;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("POLYGON_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        lock = new SevuLock(IERC20(USDT0));
        (owner, ownerKey) = makeAddrAndKey("forkOwner");
        deal(USDT0, owner, 100e6);
    }

    function _deposit(uint256 amount, uint64 unlockAt) internal returns (uint256) {
        SevuLock.LockIntent memory i =
            SevuLock.LockIntent(owner, amount, unlockAt, lock.nonces(owner), block.timestamp + 1 hours);
        bytes32 d = keccak256(
            abi.encodePacked(
                "\x19\x01",
                lock.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(lock.LOCK_INTENT_TYPEHASH(), i.owner, i.amount, i.unlockAt, i.nonce, i.deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, d);
        SevuLock.Permit memory p;
        p.deadline = block.timestamp + 1 hours;
        bytes32 pd = keccak256(
            abi.encodePacked(
                "\x19\x01",
                t.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, address(lock), amount, t.nonces(owner), p.deadline))
            )
        );
        (p.v, p.r, p.s) = vm.sign(ownerKey, pd);
        vm.prank(makeAddr("relayer"));
        return lock.depositWithPermit(i, abi.encodePacked(r, s, v), p);
    }

    function test_Fork_FullCycleWithRealUsdt0() public {
        if (!forked) return vm.skip(true);
        uint64 unlockAt = uint64(block.timestamp + 1 days);
        uint256 id = _deposit(10e6, unlockAt);
        assertEq(lock.getLock(id).amount, 10e6, "credited measured delta");
        assertEq(t.balanceOf(address(lock)), 10e6);
        assertEq(t.allowance(owner, address(lock)), 0, "no leftover allowance");

        vm.expectRevert(abi.encodeWithSelector(SevuLock.StillLocked.selector, unlockAt));
        lock.withdraw(id);

        vm.warp(unlockAt);
        vm.prank(makeAddr("anyone"));
        lock.withdraw(id);
        assertEq(t.balanceOf(owner), 100e6);
        assertEq(t.balanceOf(address(lock)), 0);
    }

    function test_Fork_FrontrunPermitTolerated() public {
        if (!forked) return vm.skip(true);
        SevuLock.Permit memory p;
        p.deadline = block.timestamp + 1 hours;
        bytes32 pd = keccak256(
            abi.encodePacked(
                "\x19\x01",
                t.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, address(lock), uint256(5e6), t.nonces(owner), p.deadline))
            )
        );
        (p.v, p.r, p.s) = vm.sign(ownerKey, pd);
        t.permit(owner, address(lock), 5e6, p.deadline, p.v, p.r, p.s);

        SevuLock.LockIntent memory i =
            SevuLock.LockIntent(owner, 5e6, uint64(block.timestamp + 1 days), 0, block.timestamp + 1 hours);
        uint256 id = lock.depositWithPermit(i, _signIntent(i), p);
        assertEq(lock.getLock(id).amount, 5e6);
    }

    function _signIntent(SevuLock.LockIntent memory i) internal view returns (bytes memory) {
        bytes32 d = keccak256(
            abi.encodePacked(
                "\x19\x01",
                lock.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(lock.LOCK_INTENT_TYPEHASH(), i.owner, i.amount, i.unlockAt, i.nonce, i.deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, d);
        return abi.encodePacked(r, s, v);
    }
}
