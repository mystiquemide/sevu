// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SevuLock
/// @notice Time-locked savings. Funds can only leave to their owner, and only after the unlock time.
/// There is no owner, admin, pause or upgrade path.
contract SevuLock is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Lock {
        address owner;
        uint128 amount;
        uint64 unlockAt;
        bool withdrawn;
    }

    struct LockIntent {
        address owner;
        uint256 amount;
        uint64 unlockAt;
        uint256 nonce;
        uint256 deadline;
    }

    struct Permit {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    bytes32 public constant LOCK_INTENT_TYPEHASH =
        keccak256("LockIntent(address owner,uint256 amount,uint64 unlockAt,uint256 nonce,uint256 deadline)");

    uint256 public constant MIN_AMOUNT = 1e6;
    uint256 public constant MIN_DURATION = 5 minutes;
    uint256 public constant MAX_DURATION = 730 days;

    IERC20 public immutable token;

    Lock[] private _locks;
    mapping(address => uint256[]) private _ownerLocks;
    mapping(address => uint256) public nonces;
    uint256 public totalLocked;

    event Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint64 unlockAt);
    event Withdrawn(uint256 indexed lockId, address indexed owner, uint256 amount, address caller);

    error IntentExpired();
    error InvalidNonce();
    error InvalidSignature();
    error AmountTooSmall();
    error AmountTooLarge();
    error UnlockTooSoon();
    error UnlockTooLate();
    error NoLock();
    error StillLocked(uint64 unlockAt);
    error AlreadyWithdrawn();

    constructor(IERC20 token_) EIP712("Sevu", "1") {
        token = token_;
    }

    /// @notice Gasless deposit: anyone may submit an owner-signed intent plus the owner's token permit.
    function depositWithPermit(LockIntent calldata intent, bytes calldata intentSig, Permit calldata permit)
        external
        nonReentrant
        returns (uint256 lockId)
    {
        if (block.timestamp > intent.deadline) revert IntentExpired();
        if (intent.nonce != nonces[intent.owner]) revert InvalidNonce();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LOCK_INTENT_TYPEHASH, intent.owner, intent.amount, intent.unlockAt, intent.nonce, intent.deadline
                )
            )
        );
        if (ECDSA.recover(digest, intentSig) != intent.owner) revert InvalidSignature();
        nonces[intent.owner] = intent.nonce + 1;

        // A front-run permit is tolerated: transferFrom below still requires the allowance.
        try IERC20Permit(address(token))
            .permit(intent.owner, address(this), intent.amount, permit.deadline, permit.v, permit.r, permit.s) {}
            catch {}

        lockId = _lock(intent.owner, intent.amount, intent.unlockAt);
    }

    /// @notice Direct deposit by an owner who already approved this contract.
    function deposit(uint256 amount, uint64 unlockAt) external nonReentrant returns (uint256 lockId) {
        lockId = _lock(msg.sender, amount, unlockAt);
    }

    /// @notice Anyone may trigger withdrawal after the unlock time. Funds always go to the lock owner.
    function withdraw(uint256 lockId) external nonReentrant {
        if (lockId >= _locks.length) revert NoLock();
        Lock storage l = _locks[lockId];
        if (l.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < l.unlockAt) revert StillLocked(l.unlockAt);
        l.withdrawn = true;
        uint256 amount = l.amount;
        totalLocked -= amount;
        token.safeTransfer(l.owner, amount);
        emit Withdrawn(lockId, l.owner, amount, msg.sender);
    }

    function getLock(uint256 lockId) external view returns (Lock memory) {
        if (lockId >= _locks.length) revert NoLock();
        return _locks[lockId];
    }

    function locksOf(address owner) external view returns (uint256[] memory) {
        return _ownerLocks[owner];
    }

    function lockCount() external view returns (uint256) {
        return _locks.length;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _lock(address owner, uint256 amount, uint64 unlockAt) private returns (uint256 lockId) {
        if (amount < MIN_AMOUNT) revert AmountTooSmall();
        if (unlockAt < block.timestamp + MIN_DURATION) revert UnlockTooSoon();
        if (unlockAt > block.timestamp + MAX_DURATION) revert UnlockTooLate();

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(owner, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received < MIN_AMOUNT) revert AmountTooSmall();
        if (received > type(uint128).max) revert AmountTooLarge();

        lockId = _locks.length;
        // forge-lint: disable-next-line(unsafe-typecast) bounded by the check above
        _locks.push(Lock({owner: owner, amount: uint128(received), unlockAt: unlockAt, withdrawn: false}));
        _ownerLocks[owner].push(lockId);
        totalLocked += received;
        emit Locked(lockId, owner, received, unlockAt);
    }
}
