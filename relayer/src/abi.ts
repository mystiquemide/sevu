export const sevuLockAbi = [
  {
    type: 'function', name: 'depositWithPermit', stateMutability: 'nonpayable',
    inputs: [
      { name: 'intent', type: 'tuple', components: [
        { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint256' },
        { name: 'unlockAt', type: 'uint64' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      ] },
      { name: 'intentSig', type: 'bytes' },
      { name: 'permit', type: 'tuple', components: [
        { name: 'deadline', type: 'uint256' }, { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
      ] },
    ],
    outputs: [{ name: 'lockId', type: 'uint256' }],
  },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'lockId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lockCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'getLock', stateMutability: 'view', inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint128' },
      { name: 'unlockAt', type: 'uint64' }, { name: 'lockedAt', type: 'uint40' }, { name: 'withdrawn', type: 'bool' },
    ] }],
  },
  { type: 'error', name: 'IntentExpired', inputs: [] },
  { type: 'error', name: 'InvalidNonce', inputs: [] },
  { type: 'error', name: 'InvalidSignature', inputs: [] },
  { type: 'error', name: 'AmountTooSmall', inputs: [] },
  { type: 'error', name: 'AmountTooLarge', inputs: [] },
  { type: 'error', name: 'UnlockTooSoon', inputs: [] },
  { type: 'error', name: 'UnlockTooLate', inputs: [] },
  { type: 'error', name: 'NoLock', inputs: [] },
  { type: 'error', name: 'StillLocked', inputs: [{ name: 'unlockAt', type: 'uint64' }] },
  { type: 'error', name: 'AlreadyWithdrawn', inputs: [] },
] as const

export const usdt0Abi = [
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

/** getLock on the candidate contract (0x27eb...00ef), deployed before lockedAt existed. */
export const getLockV0Abi = [
  {
    type: 'function', name: 'getLock', stateMutability: 'view', inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint128' },
      { name: 'unlockAt', type: 'uint64' }, { name: 'withdrawn', type: 'bool' },
    ] }],
  },
] as const
