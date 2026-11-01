import { createPublicClient, http, type Address, type Hash } from 'viem'
import { polygon } from 'viem/chains'
import { config, USDT0 } from '../config'

const lockAbi = [
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'locksOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256[]' }] },
  {
    type: 'function', name: 'getLock', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint128' },
      { name: 'unlockAt', type: 'uint64' }, { name: 'withdrawn', type: 'bool' },
    ] }],
  },
] as const

const tokenAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export interface LockRecord {
  id: bigint
  amount: bigint
  unlockAt: bigint
  withdrawn: boolean
}

export const publicClient = createPublicClient({ chain: polygon, transport: http(config.rpcUrl, { timeout: 20_000 }) })

function lockAddress(): Address {
  if (!config.lockAddress) throw new Error('NOT_CONFIGURED')
  return config.lockAddress
}

export async function chainTime(): Promise<bigint> {
  return (await publicClient.getBlock({ blockTag: 'latest' })).timestamp
}

export function usdtBalance(owner: Address) {
  return publicClient.readContract({ address: USDT0, abi: tokenAbi, functionName: 'balanceOf', args: [owner] })
}

export function tokenNonce(owner: Address) {
  return publicClient.readContract({ address: USDT0, abi: tokenAbi, functionName: 'nonces', args: [owner] })
}

export function lockNonce(owner: Address) {
  return publicClient.readContract({ address: lockAddress(), abi: lockAbi, functionName: 'nonces', args: [owner] })
}

/** All locks of an owner, newest first, read straight from the contract. */
export async function locksOf(owner: Address): Promise<LockRecord[]> {
  const address = lockAddress()
  const ids = await publicClient.readContract({ address, abi: lockAbi, functionName: 'locksOf', args: [owner] })
  const locks = await Promise.all(
    ids.map((id) => publicClient.readContract({ address, abi: lockAbi, functionName: 'getLock', args: [id] })),
  )
  return locks
    .map((l, i) => ({ id: ids[i]!, amount: l.amount, unlockAt: l.unlockAt, withdrawn: l.withdrawn }))
    .reverse()
}

export async function waitForSuccess(hash: Hash): Promise<'success' | 'reverted' | 'unknown'> {
  try {
    const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
    return r.status
  } catch {
    return 'unknown'
  }
}
