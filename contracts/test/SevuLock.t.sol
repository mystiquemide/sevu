// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SevuLock} from "../src/SevuLock.sol";
import {MockPermitToken, ReentrantToken} from "./mocks/MockPermitToken.sol";

contract SevuLockTest is Test {
    SevuLock lock;
    MockPermitToken token;
    address owner;
    uint256 ownerKey;
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");

    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new MockPermitToken();
        lock = new SevuLock(IERC20(address(token)));
        (owner, ownerKey) = makeAddrAndKey("owner");
        token.mint(owner, 1_000e6);
    }

    // ---------- helpers ----------

    function _intent(uint256 amount, uint64 unlockAt) internal view returns (SevuLock.LockIntent memory) {
        return SevuLock.LockIntent({
            owner: owner,
            amount: amount,
            unlockAt: unlockAt,
            nonce: lock.nonces(owner),
            deadline: block.timestamp + 1 hours
        });
    }

    function _signIntent(SevuLock.LockIntent memory i, uint256 key) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(lock.LOCK_INTENT_TYPEHASH(), i.owner, i.amount, i.unlockAt, i.nonce, i.deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", lock.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPermit(uint256 value) internal view returns (SevuLock.Permit memory p) {
        p.deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, address(lock), value, token.nonces(owner), p.deadline))
            )
        );
        (p.v, p.r, p.s) = vm.sign(ownerKey, digest);
    }

    function _deposit(uint256 amount, uint64 unlockAt) internal returns (uint256) {
        SevuLock.LockIntent memory i = _intent(amount, unlockAt);
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(amount);
        vm.prank(relayer);
        return lock.depositWithPermit(i, sig, p);
    }

    // ---------- happy path ----------

    function test_DepositWithPermit_StoresLock() public {
        uint64 unlockAt = uint64(block.timestamp + 30 days);
        uint256 id = _deposit(10e6, unlockAt);
        SevuLock.Lock memory l = lock.getLock(id);
        assertEq(l.owner, owner);
        assertEq(l.amount, 10e6);
        assertEq(l.unlockAt, unlockAt);
        assertEq(l.lockedAt, block.timestamp);
        assertFalse(l.withdrawn);
        assertEq(lock.totalLocked(), 10e6);
        assertEq(lock.nonces(owner), 1);
        assertEq(lock.locksOf(owner).length, 1);
        assertEq(token.balanceOf(address(lock)), 10e6);
        assertEq(token.balanceOf(relayer), 0);
    }

    function test_LockedAtIsBlockTimeAndStaysPut() public {
        uint256 t0 = block.timestamp;
        uint256 id = _deposit(10e6, uint64(t0 + 1 days));
        vm.warp(t0 + 2 days);
        lock.withdraw(id);
        assertEq(lock.getLock(id).lockedAt, t0);
    }

    function test_LockFitsTwoStorageSlots() public {
        _deposit(10e6, uint64(block.timestamp + 1 days));
        // _locks is slot 3 (forge inspect storageLayout); element 0 starts at keccak256(3).
        bytes32 base = keccak256(abi.encode(uint256(3)));
        bytes32 slot2 = vm.load(address(lock), bytes32(uint256(base) + 2));
        assertEq(slot2, bytes32(0), "Lock must use exactly two slots");
        assertTrue(vm.load(address(lock), bytes32(uint256(base) + 1)) != bytes32(0));
    }

    /// Documents audit pass 2 lead L-1: two intents signed with the same nonce are both valid until one lands.
    /// The first one submitted wins and the other becomes stale. Both were signed by the owner.
    function test_SameNonceIntents_FirstSubmittedWins() public {
        SevuLock.LockIntent memory a = _intent(5e6, uint64(block.timestamp + 365 days));
        SevuLock.LockIntent memory b = _intent(5e6, uint64(block.timestamp + 7 days));
        bytes memory sigA = _signIntent(a, ownerKey);
        bytes memory sigB = _signIntent(b, ownerKey);
        SevuLock.Permit memory p = _signPermit(5e6);
        uint256 id = lock.depositWithPermit(a, sigA, p);
        assertEq(lock.getLock(id).unlockAt, a.unlockAt);
        vm.expectRevert(SevuLock.InvalidNonce.selector);
        lock.depositWithPermit(b, sigB, p);
    }

    function test_AllowanceZeroAfterDeposit() public {
        _deposit(10e6, uint64(block.timestamp + 1 days));
        assertEq(token.allowance(owner, address(lock)), 0);
    }

    function test_DirectDeposit() public {
        vm.startPrank(owner);
        token.approve(address(lock), 5e6);
        uint256 id = lock.deposit(5e6, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        assertEq(lock.getLock(id).owner, owner);
        assertEq(token.allowance(owner, address(lock)), 0);
    }

    function test_WithdrawAfterUnlock_PaysOwnerWhenStrangerCalls() public {
        uint64 unlockAt = uint64(block.timestamp + 1 days);
        uint256 id = _deposit(10e6, unlockAt);
        uint256 before = token.balanceOf(owner);
        vm.warp(unlockAt);
        vm.prank(stranger);
        lock.withdraw(id);
        assertEq(token.balanceOf(owner), before + 10e6);
        assertEq(token.balanceOf(stranger), 0);
        assertTrue(lock.getLock(id).withdrawn);
        assertEq(lock.totalLocked(), 0);
    }

    // ---------- T1 tampering ----------

    function test_RevertWhen_UnlockAtTampered() public {
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 30 days));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(10e6);
        i.unlockAt = uint64(block.timestamp + 700 days);
        vm.expectRevert(SevuLock.InvalidSignature.selector);
        lock.depositWithPermit(i, sig, p);
    }

    function test_RevertWhen_AmountTampered() public {
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 30 days));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(10e6);
        i.amount = 20e6;
        vm.expectRevert(SevuLock.InvalidSignature.selector);
        lock.depositWithPermit(i, sig, p);
    }

    function test_RevertWhen_SignedByOtherKey() public {
        (, uint256 otherKey) = makeAddrAndKey("other");
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 30 days));
        bytes memory sig = _signIntent(i, otherKey);
        SevuLock.Permit memory p = _signPermit(10e6);
        vm.expectRevert(SevuLock.InvalidSignature.selector);
        lock.depositWithPermit(i, sig, p);
    }

    // ---------- T2 replay ----------

    function test_RevertWhen_IntentReplayed() public {
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 30 days));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(10e6);
        lock.depositWithPermit(i, sig, p);
        vm.expectRevert(SevuLock.InvalidNonce.selector);
        lock.depositWithPermit(i, sig, p);
    }

    function test_RevertWhen_IntentExpired() public {
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 30 days));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(10e6);
        vm.warp(i.deadline + 1);
        vm.expectRevert(SevuLock.IntentExpired.selector);
        lock.depositWithPermit(i, sig, p);
    }

    // ---------- T3 permit front-run ----------

    function test_DepositSucceeds_WhenPermitFrontrun() public {
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 30 days));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(10e6);
        token.permit(owner, address(lock), 10e6, p.deadline, p.v, p.r, p.s);
        uint256 id = lock.depositWithPermit(i, sig, p);
        assertEq(lock.getLock(id).amount, 10e6);
    }

    function test_RevertWhen_NoPermitAndNoAllowance() public {
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 30 days));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory bad;
        vm.expectRevert();
        lock.depositWithPermit(i, sig, bad);
        assertEq(lock.nonces(owner), 0);
    }

    // ---------- bounds ----------

    function test_RevertWhen_AmountBelowMinimum() public {
        SevuLock.LockIntent memory i = _intent(1e6 - 1, uint64(block.timestamp + 1 days));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(1e6 - 1);
        vm.expectRevert(SevuLock.AmountTooSmall.selector);
        lock.depositWithPermit(i, sig, p);
    }

    function test_RevertWhen_UnlockTooSoon() public {
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 5 minutes - 1));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(10e6);
        vm.expectRevert(SevuLock.UnlockTooSoon.selector);
        lock.depositWithPermit(i, sig, p);
    }

    function test_RevertWhen_UnlockTooLate() public {
        SevuLock.LockIntent memory i = _intent(10e6, uint64(block.timestamp + 730 days + 1));
        bytes memory sig = _signIntent(i, ownerKey);
        SevuLock.Permit memory p = _signPermit(10e6);
        vm.expectRevert(SevuLock.UnlockTooLate.selector);
        lock.depositWithPermit(i, sig, p);
    }

    // ---------- T4 early withdrawal ----------

    function test_RevertWhen_WithdrawEarly() public {
        uint64 unlockAt = uint64(block.timestamp + 1 days);
        uint256 id = _deposit(10e6, unlockAt);
        vm.warp(unlockAt - 1);
        vm.expectRevert(abi.encodeWithSelector(SevuLock.StillLocked.selector, unlockAt));
        lock.withdraw(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SevuLock.StillLocked.selector, unlockAt));
        lock.withdraw(id);
        assertEq(token.balanceOf(address(lock)), 10e6);
    }

    function testFuzz_NoWithdrawBeforeUnlock(uint64 duration, uint64 elapsed, address caller) public {
        duration = uint64(bound(duration, 5 minutes, 730 days));
        elapsed = uint64(bound(elapsed, 0, duration - 1));
        uint64 unlockAt = uint64(block.timestamp) + duration;
        uint256 id = _deposit(10e6, unlockAt);
        vm.warp(block.timestamp + elapsed);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(SevuLock.StillLocked.selector, unlockAt));
        lock.withdraw(id);
    }

    // ---------- T5 payout to owner ----------

    function testFuzz_WithdrawAlwaysPaysOwner(address caller, uint256 amount, uint64 extra) public {
        vm.assume(caller != owner && caller != address(lock));
        amount = bound(amount, 1e6, 1_000e6);
        uint64 unlockAt = uint64(block.timestamp + 1 days);
        uint256 id = _deposit(amount, unlockAt);
        uint256 ownerBefore = token.balanceOf(owner);
        uint256 callerBefore = token.balanceOf(caller);
        vm.warp(uint256(unlockAt) + bound(extra, 0, 3650 days));
        vm.prank(caller);
        lock.withdraw(id);
        assertEq(token.balanceOf(owner), ownerBefore + amount);
        assertEq(token.balanceOf(caller), callerBefore);
    }

    // ---------- T6 double withdrawal ----------

    function test_RevertWhen_DoubleWithdraw() public {
        uint64 unlockAt = uint64(block.timestamp + 1 days);
        uint256 id = _deposit(10e6, unlockAt);
        vm.warp(unlockAt);
        lock.withdraw(id);
        vm.expectRevert(SevuLock.AlreadyWithdrawn.selector);
        lock.withdraw(id);
    }

    function test_RevertWhen_UnknownLock() public {
        vm.expectRevert(SevuLock.NoLock.selector);
        lock.withdraw(0);
        vm.expectRevert(SevuLock.NoLock.selector);
        lock.getLock(0);
    }

    function test_LocksAreIndependent() public {
        uint64 a = uint64(block.timestamp + 1 days);
        uint64 b = uint64(block.timestamp + 10 days);
        uint256 idA = _deposit(3e6, a);
        uint256 idB = _deposit(4e6, b);
        vm.warp(a);
        lock.withdraw(idA);
        vm.expectRevert(abi.encodeWithSelector(SevuLock.StillLocked.selector, b));
        lock.withdraw(idB);
        assertEq(lock.totalLocked(), 4e6);
        assertEq(token.balanceOf(address(lock)), 4e6);
    }

    // ---------- T7 reentrancy ----------

    function test_RevertWhen_ReentrantWithdraw() public {
        ReentrantToken rt = new ReentrantToken();
        SevuLock rl = new SevuLock(IERC20(address(rt)));
        rt.mint(address(this), 10e6);
        rt.approve(address(rl), 10e6);
        uint64 unlockAt = uint64(block.timestamp + 1 days);
        uint256 id = rl.deposit(10e6, unlockAt);
        vm.warp(unlockAt);
        rt.arm(address(rl), abi.encodeCall(SevuLock.withdraw, (id)));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        rl.withdraw(id);
        assertEq(rt.balanceOf(address(rl)), 10e6);
    }

    // ---------- T8 no privileged functions ----------

    function test_AbiSelectorAllowlist() public view {
        string[15] memory allowed = [
            "DOMAIN_SEPARATOR()",
            "LOCK_INTENT_TYPEHASH()",
            "MAX_DURATION()",
            "MIN_AMOUNT()",
            "MIN_DURATION()",
            "deposit(uint256,uint64)",
            "depositWithPermit((address,uint256,uint64,uint256,uint256),bytes,(uint256,uint8,bytes32,bytes32))",
            "eip712Domain()",
            "getLock(uint256)",
            "lockCount()",
            "locksOf(address)",
            "nonces(address)",
            "token()",
            "totalLocked()",
            "withdraw(uint256)"
        ];
        string memory json = vm.readFile("out/SevuLock.sol/SevuLock.json");
        string[] memory keys = vm.parseJsonKeys(json, ".methodIdentifiers");
        assertEq(keys.length, allowed.length, "unexpected external function count");
        for (uint256 k; k < keys.length; k++) {
            bool found;
            for (uint256 a; a < allowed.length; a++) {
                if (keccak256(bytes(keys[k])) == keccak256(bytes(allowed[a]))) found = true;
            }
            assertTrue(found, string.concat("unexpected function: ", keys[k]));
        }
    }
}
