import { type Address, type Hex } from 'viem'
import { config } from '../config'
import { publicClient, simulateWithdraw } from './chain'

/** A stranger: an address with no keys anyone holds, standing in for "someone who is not the owner". */
export const STRANGER = '0x000000000000000000000000000000000000dEaD' as Address

const countAbi = [{ type: 'function', name: 'lockCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const
const lockAbi = (legacy: boolean) => [{
  type: 'function', name: 'getLock', stateMutability: 'view', inputs: [{ type: 'uint256' }],
  outputs: [{ type: 'tuple', components: [
    { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint128' }, { name: 'unlockAt', type: 'uint64' },
    ...(legacy ? [] : [{ name: 'lockedAt', type: 'uint40' }]), { name: 'withdrawn', type: 'bool' },
  ] }],
}] as const

export interface Target { contract: Address; id: bigint; owner: Address; amount: bigint; unlockAt: bigint }

/** The sealed lock that opens last: the hardest one to get money out of right now. */
export async function pickTarget(): Promise<Target | null> {
  const contracts = [config.lockAddress, ...config.legacyLocks].filter(Boolean) as Address[]
  const all: Target[] = []
  for (const [i, contract] of contracts.entries()) {
    const legacy = i > 0
    const n = await publicClient.readContract({ address: contract, abi: countAbi, functionName: 'lockCount' })
    for (let id = 0n; id < n; id++) {
      const l = (await publicClient.readContract({ address: contract, abi: lockAbi(legacy), functionName: 'getLock', args: [id] })) as { owner: Address; amount: bigint; unlockAt: bigint; withdrawn: boolean }
      if (!l.withdrawn) all.push({ contract, id, owner: l.owner, amount: l.amount, unlockAt: l.unlockAt })
    }
  }
  return all.sort((a, b) => Number(b.unlockAt - a.unlockAt))[0] ?? null
}

export type WithdrawResult = { kind: 'refused'; reason: string } | { kind: 'pays-owner' }

/** Asks the live contract what would happen if a stranger called withdraw. Nothing is sent. */
export async function strangerWithdraw(t: Target): Promise<WithdrawResult> {
  const reason = await simulateWithdraw(STRANGER, t.contract, t.id)
  return reason ? { kind: 'refused', reason } : { kind: 'pays-owner' }
}

/** Admin functions a custodial contract would have. Each call should fail because the function does not exist. */
export const ADMIN_PROBES: { name: string; data: Hex }[] = [
  { name: 'owner()', data: '0x8da5cb5b' },
  { name: 'pause()', data: '0x8456cb59' },
  { name: 'upgradeTo(address)', data: '0x3659cfe60000000000000000000000000000000000000000000000000000000000000000' },
  { name: 'transferOwnership(address)', data: '0xf2fde38b000000000000000000000000000000000000000000000000000000000000dead' },
  { name: 'emergencyWithdraw()', data: '0xdb2e21bc' },
]

/** True when the call fails, meaning the contract has no such function. */
export async function probeMissing(contract: Address, data: Hex): Promise<boolean> {
  try {
    await publicClient.call({ to: contract, data, account: STRANGER })
    return false
  } catch {
    return true
  }
}
