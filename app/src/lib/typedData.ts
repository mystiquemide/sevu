import type { Address } from 'viem'

export const POLYGON_CHAIN_ID = 137

export const lockIntentTypes = {
  LockIntent: [
    { name: 'owner', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'unlockAt', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export const permitTypes = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export function lockIntentDomain(lock: Address, chainId = POLYGON_CHAIN_ID) {
  return { name: 'Sevu', version: '1', chainId, verifyingContract: lock } as const
}

/** USDT0 on Polygon uses a salt of bytes32(137) and no chainId (verified against the on-chain DOMAIN_SEPARATOR). */
export function usdt0Domain(token: Address) {
  return {
    name: 'USDT0',
    version: '1',
    verifyingContract: token,
    salt: '0x0000000000000000000000000000000000000000000000000000000000000089',
  } as const
}
