import { getAddress, isAddress, type Address } from 'viem'
import { config } from '../config'
import { publicClient } from './chain'

/**
 * Invite links carry only a lock reference (?invite=<contract>-<lockId>). Amount and date are read from the chain,
 * so an invite cannot claim a lock that does not exist or a bigger amount than was really sealed.
 */
export interface InviteRef { contract: Address; id: bigint }
export interface Invite extends InviteRef { amount: bigint; unlockAt: bigint; withdrawn: boolean }

const APP_URL = 'https://sevu.midelabs.xyz'

export function inviteUrl(ref: InviteRef): string {
  return `${APP_URL}/?invite=${ref.contract}-${ref.id}`
}

/** Only Sevu's own contracts count, so an invite cannot point at some other contract. */
export function parseInvite(search: string): InviteRef | null {
  const raw = new URLSearchParams(search).get('invite')
  const m = raw?.match(/^(0x[0-9a-fA-F]{40})-(\d{1,9})$/)
  if (!m || !isAddress(m[1]!)) return null
  const contract = getAddress(m[1]!)
  const known = [config.lockAddress, ...config.legacyLocks].filter(Boolean) as Address[]
  return known.includes(contract) ? { contract, id: BigInt(m[2]!) } : null
}

const abi = (legacy: boolean) => [{
  type: 'function', name: 'getLock', stateMutability: 'view', inputs: [{ type: 'uint256' }],
  outputs: [{ type: 'tuple', components: [
    { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint128' }, { name: 'unlockAt', type: 'uint64' },
    ...(legacy ? [] : [{ name: 'lockedAt', type: 'uint40' }]), { name: 'withdrawn', type: 'bool' },
  ] }],
}] as const

export async function readInvite(ref: InviteRef): Promise<Invite | null> {
  try {
    const legacy = ref.contract !== config.lockAddress
    const l = (await publicClient.readContract({ address: ref.contract, abi: abi(legacy), functionName: 'getLock', args: [ref.id] })) as { amount: bigint; unlockAt: bigint; withdrawn: boolean }
    return { ...ref, amount: l.amount, unlockAt: l.unlockAt, withdrawn: l.withdrawn }
  } catch {
    return null
  }
}

/** Keeps the invite across the intro and a reload in the same tab. */
const KEY = 'sevu:invite'
export function rememberInvite(search: string): InviteRef | null {
  const ref = parseInvite(search)
  try {
    if (ref) sessionStorage.setItem(KEY, `${ref.contract}-${ref.id}`)
    else {
      const saved = sessionStorage.getItem(KEY)
      return saved ? parseInvite(`?invite=${saved}`) : null
    }
  } catch { /* private mode: the invite still shows on this load */ }
  return ref
}
