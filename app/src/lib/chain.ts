import { BaseError, ContractFunctionRevertedError, createPublicClient, encodeFunctionData, http, type Address, type Hash, type Hex } from 'viem'
import { polygon } from 'viem/chains'
import { config, USDT0 } from '../config'

const lockAbi = [
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'locksOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256[]' }] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'error', name: 'StillLocked', inputs: [{ name: 'unlockAt', type: 'uint64' }] },
  { type: 'error', name: 'AlreadyWithdrawn', inputs: [] },
  { type: 'error', name: 'NoLock', inputs: [] },
  {
    type: 'function', name: 'getLock', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint128' },
      { name: 'unlockAt', type: 'uint64' }, { name: 'lockedAt', type: 'uint40' }, { name: 'withdrawn', type: 'bool' },
    ] }],
  },
] as const

/** getLock on the candidate contract, deployed before lockedAt existed. */
const getLockV0Abi = [
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
  /** The SevuLock deployment holding this lock. */
  contract: Address
  id: bigint
  /** Unique across deployments: contract plus id. */
  key: string
  amount: bigint
  unlockAt: bigint
  /** Block time the lock was created; null on the candidate contract, which did not record it. */
  lockedAt: number | null
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

async function locksIn(address: Address, owner: Address, legacy: boolean): Promise<LockRecord[]> {
  const ids = await publicClient.readContract({ address, abi: lockAbi, functionName: 'locksOf', args: [owner] })
  return Promise.all(
    ids.map(async (id) => {
      const base = { contract: address, id, key: `${address}:${id}` }
      if (legacy) {
        const l = await publicClient.readContract({ address, abi: getLockV0Abi, functionName: 'getLock', args: [id] })
        return { ...base, amount: l.amount, unlockAt: l.unlockAt, lockedAt: null, withdrawn: l.withdrawn }
      }
      const l = await publicClient.readContract({ address, abi: lockAbi, functionName: 'getLock', args: [id] })
      return { ...base, amount: l.amount, unlockAt: l.unlockAt, lockedAt: l.lockedAt, withdrawn: l.withdrawn }
    }),
  )
}

/** All locks of an owner across the current and earlier deployments, newest first, read straight from the chain. */
export async function locksOf(owner: Address): Promise<LockRecord[]> {
  const current = locksIn(lockAddress(), owner, false)
  const legacy = config.legacyLocks.map((a) => locksIn(a, owner, true))
  const [now, ...old] = await Promise.all([current, ...legacy])
  return [...old.flat(), ...now].reverse()
}

/** Locks of an owner in the current deployment only (the lock flow compares before and after). */
export function currentLocksOf(owner: Address): Promise<LockRecord[]> {
  return locksIn(lockAddress(), owner, false)
}

export async function waitForSuccess(hash: Hash): Promise<'success' | 'reverted' | 'unknown'> {
  try {
    const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
    return r.status
  } catch {
    return 'unknown'
  }
}

export function withdrawCalldata(lockId: bigint): Hex {
  return encodeFunctionData({ abi: lockAbi, functionName: 'withdraw', args: [lockId] })
}

/**
 * Asks the contract itself, read-only, whether this withdrawal would go through right now.
 * Returns null when it would succeed, otherwise the contract's own error name.
 */
export async function simulateWithdraw(from: Address, contract: Address, lockId: bigint): Promise<string | null> {
  try {
    await publicClient.simulateContract({ address: contract, abi: lockAbi, functionName: 'withdraw', args: [lockId], account: from })
    return null
  } catch (err) {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
      if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? 'reverted'
    }
    throw err
  }
}

export async function receiptTime(hash: Hash): Promise<bigint | null> {
  try {
    const r = await publicClient.getTransactionReceipt({ hash })
    return (await publicClient.getBlock({ blockNumber: r.blockNumber })).timestamp
  } catch {
    return null
  }
}

export function nativeBalance(owner: Address) {
  return publicClient.getBalance({ address: owner })
}
