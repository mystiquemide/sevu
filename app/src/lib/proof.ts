import type { Address } from 'viem'
import { config } from '../config'
import { publicClient } from './chain'

const proofAbi = [
  { type: 'function', name: 'lockCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalLocked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const
/** owner, amount and withdrawn sit in the same positions in both deployments' Lock struct. */
const ownerAmountAbi = (legacy: boolean) => [{
  type: 'function', name: 'getLock', stateMutability: 'view', inputs: [{ type: 'uint256' }],
  outputs: [{ type: 'tuple', components: [
    { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint128' }, { name: 'unlockAt', type: 'uint64' },
    ...(legacy ? [] : [{ name: 'lockedAt', type: 'uint40' }]), { name: 'withdrawn', type: 'bool' },
  ] }],
}] as const

export interface ProofLock { owner: Address; amount: bigint; withdrawn: boolean }
export interface ProofStats { locks: number; owners: number; locked: bigint; withdrawn: bigint }

/** Totals across every deployment. Pure, so the page and the check script agree by construction. */
export function summarize(locks: ProofLock[]): ProofStats {
  const owners = new Set(locks.map((l) => l.owner.toLowerCase()))
  let locked = 0n
  let withdrawn = 0n
  for (const l of locks) l.withdrawn ? (withdrawn += l.amount) : (locked += l.amount)
  return { locks: locks.length, owners: owners.size, locked, withdrawn }
}

async function locksIn(address: Address, legacy: boolean): Promise<ProofLock[]> {
  const count = await publicClient.readContract({ address, abi: proofAbi, functionName: 'lockCount' })
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i))
  return Promise.all(ids.map(async (id) => {
    const l = (await publicClient.readContract({ address, abi: ownerAmountAbi(legacy), functionName: 'getLock', args: [id] })) as ProofLock
    return { owner: l.owner, amount: l.amount, withdrawn: l.withdrawn }
  }))
}

/** Reads every lock from the chain. Also returns the contract's own totalLocked for the cross-check. */
export async function readProof(): Promise<ProofStats & { contractTotal: bigint }> {
  if (!config.lockAddress) throw new Error('NOT_CONFIGURED')
  const all = await Promise.all([
    locksIn(config.lockAddress, false),
    ...config.legacyLocks.map((a) => locksIn(a, true)),
  ])
  const totals = await Promise.all([config.lockAddress, ...config.legacyLocks].map((address) =>
    publicClient.readContract({ address, abi: proofAbi, functionName: 'totalLocked' })))
  return { ...summarize(all.flat()), contractTotal: totals.reduce((a, b) => a + b, 0n) }
}
