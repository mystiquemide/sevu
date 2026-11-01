import { parseSignature, type Address, type Hash } from 'viem'
import { config, SIGNATURE_TTL_SEC, USDT0 } from '../config'
import { chainTime, lockNonce, locksOf, tokenNonce, waitForSuccess } from './chain'
import { relayDeposit } from './relayer'
import { lockIntentDomain, lockIntentTypes, permitTypes, usdt0Domain } from './typedData'
import { signTypedData } from './wallet'

export type FlowStep = 'SIGNING_PERMIT' | 'SIGNING_INTENT' | 'SUBMITTED' | 'SEALED' | 'FAILED' | 'UNKNOWN'

export interface FlowResult {
  step: 'SEALED' | 'FAILED' | 'UNKNOWN'
  txHash: Hash
}

const domainType = {
  usdt0: [
    { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
    { name: 'verifyingContract', type: 'address' }, { name: 'salt', type: 'bytes32' },
  ],
  sevu: [
    { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
  ],
} as const

export function buildPermit(owner: Address, spender: Address, value: bigint, nonce: bigint, deadline: bigint) {
  return {
    domain: usdt0Domain(USDT0),
    types: { EIP712Domain: domainType.usdt0, ...permitTypes },
    primaryType: 'Permit' as const,
    message: { owner, spender, value, nonce, deadline },
  }
}

export function buildIntent(lock: Address, owner: Address, amount: bigint, unlockAt: bigint, nonce: bigint, deadline: bigint) {
  return {
    domain: lockIntentDomain(lock),
    types: { EIP712Domain: domainType.sevu, ...lockIntentTypes },
    primaryType: 'LockIntent' as const,
    message: { owner, amount, unlockAt, nonce, deadline },
  }
}

/**
 * Two signatures, one relayed transaction. Lock state is only reported as SEALED after
 * the receipt succeeds and the lock is read back from the contract (NFR-004).
 */
export async function createLock(
  owner: Address,
  amount: bigint,
  unlockAt: bigint,
  onStep: (s: FlowStep) => void,
): Promise<FlowResult> {
  const lock = config.lockAddress
  if (!lock) throw new Error('NOT_CONFIGURED')
  const [now, intentNonce, permitNonce, before] = await Promise.all([
    chainTime(), lockNonce(owner), tokenNonce(owner), locksOf(owner),
  ])
  const deadline = now + BigInt(SIGNATURE_TTL_SEC)

  onStep('SIGNING_PERMIT')
  const permitSig = await signTypedData(owner, buildPermit(owner, lock, amount, permitNonce, deadline))
  onStep('SIGNING_INTENT')
  const intentSig = await signTypedData(owner, buildIntent(lock, owner, amount, unlockAt, intentNonce, deadline))

  const { v, r, s, yParity } = parseSignature(permitSig)
  const txHash = await relayDeposit({
    intent: { owner, amount, unlockAt, nonce: intentNonce, deadline },
    intentSig,
    permit: { value: amount, deadline, v: Number(v ?? BigInt(yParity + 27)), r, s },
  })
  onStep('SUBMITTED')

  const status = await waitForSuccess(txHash)
  if (status === 'reverted') return { step: 'FAILED', txHash }
  const after = await locksOf(owner).catch(() => null)
  const sealed = after !== null && after.length > before.length && after.some((l) => l.unlockAt === unlockAt && l.amount === amount)
  if (sealed) return { step: 'SEALED', txHash }
  return { step: 'UNKNOWN', txHash }
}
