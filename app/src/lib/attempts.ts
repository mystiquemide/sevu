import type { Address } from 'viem'
import { config } from '../config'

/**
 * Audit L-1: an intent signed for nonce N stays valid until its deadline, and the first one submitted wins.
 * After an attempt that did not seal, the app only offers to retry the same terms until that deadline,
 * so two different intents for one nonce never exist at the same time.
 */
export interface PendingAttempt {
  nonce: string
  amount: string
  unlockAt: string
  label: string
  deadline: number
}

const KEY = (owner: Address) => `sevu:attempt:${config.lockAddress ?? 'none'}:${owner}`

export function savePendingAttempt(owner: Address, a: PendingAttempt) {
  try {
    localStorage.setItem(KEY(owner), JSON.stringify(a))
  } catch {
    // Storage blocked: the contract's nonce check still protects funds.
  }
}

export function clearPendingAttempt(owner: Address) {
  try {
    localStorage.removeItem(KEY(owner))
  } catch {
    // ignore
  }
}

/** The pending attempt, only while its signature can still land and its nonce is still unused. */
export function activeAttempt(owner: Address, currentNonce: bigint, now: number): PendingAttempt | null {
  try {
    const raw = localStorage.getItem(KEY(owner))
    if (!raw) return null
    const a = JSON.parse(raw) as PendingAttempt
    if (BigInt(a.nonce) !== currentNonce || a.deadline <= now) {
      clearPendingAttempt(owner)
      return null
    }
    return a
  } catch {
    return null
  }
}
