import { parseSignature, type Address, type Hash } from 'viem'
import { config, SIGNATURE_TTL_SEC, USDT0 } from '../config'
import { chainTime, currentLocksOf, lockNonce, receiptTime, tokenNonce, waitForSuccess, type LockRecord } from './chain'
import { clearPendingAttempt, savePendingAttempt } from './attempts'
import { RelayerError, relayDeposit } from './relayer'
import { lockIntentDomain, lockIntentTypes, permitTypes, usdt0Domain } from './typedData'
import { signTypedData } from './wallet'

export type FlowStep = 'SIGNING_PERMIT' | 'SIGNING_INTENT' | 'SUBMITTED' | 'SEALED' | 'FAILED' | 'UNKNOWN'

export interface FlowResult {
  step: 'SEALED' | 'FAILED' | 'UNKNOWN'
  txHash: Hash
  lock?: LockRecord
  sealedAt?: number
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
  label = '',
): Promise<FlowResult> {
  const lock = config.lockAddress
  if (!lock) throw new Error('NOT_CONFIGURED')
  const [now, intentNonce, permitNonce, before] = await Promise.all([
    chainTime(), lockNonce(owner), tokenNonce(owner), currentLocksOf(owner),
  ])
  const deadline = now + BigInt(SIGNATURE_TTL_SEC)

  onStep('SIGNING_PERMIT')
  const permitSig = await signTypedData(owner, buildPermit(owner, lock, amount, permitNonce, deadline))
  onStep('SIGNING_INTENT')
  const intentSig = await signTypedData(owner, buildIntent(lock, owner, amount, unlockAt, intentNonce, deadline))

  // From here the signed intent can land on chain; remember its terms until it can no longer (audit L-1).
  savePendingAttempt(owner, {
    nonce: intentNonce.toString(), amount: amount.toString(), unlockAt: unlockAt.toString(), label, deadline: Number(deadline),
  })
  const { v, r, s, yParity } = parseSignature(permitSig)
  let txHash: Hash
  try {
    txHash = await relayDeposit({
    intent: { owner, amount, unlockAt, nonce: intentNonce, deadline },
    intentSig,
    permit: { value: amount, deadline, v: Number(v ?? BigInt(yParity + 27)), r, s },
  })
  } catch (e) {
    // A clear refusal means the relayer never sent it, so nothing signed can land on chain.
    if (e instanceof RelayerError && !['RELAYER_UNREACHABLE', 'CHAIN_UNAVAILABLE'].includes(e.code)) clearPendingAttempt(owner)
    throw e
  }
  onStep('SUBMITTED')

  const status = await waitForSuccess(txHash)
  if (status === 'reverted') return { step: 'FAILED', txHash }
  const after = await currentLocksOf(owner).catch(() => null)
  const known = new Set(before.map((l) => l.key))
  const created = after?.find((l) => !known.has(l.key) && l.unlockAt === unlockAt && l.amount === amount)
  if (!created) return { step: 'UNKNOWN', txHash }
  clearPendingAttempt(owner)
  const t = created.lockedAt ?? (await receiptTime(txHash).then((x) => (x === null ? null : Number(x))))
  return { step: 'SEALED', txHash, lock: created, sealedAt: t ?? undefined }
}
