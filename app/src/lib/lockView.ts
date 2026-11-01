import type { LockRecord } from './chain'
import { lockMeta } from './labels'

export type LockStatus = 'sealed' | 'ripe' | 'withdrawn'

export function lockStatus(l: LockRecord, now: number): LockStatus {
  if (l.withdrawn) return 'withdrawn'
  return now >= Number(l.unlockAt) ? 'ripe' : 'sealed'
}

/** Share of the lock period already elapsed, or null when the seal time is unknown on this device. */
export function lockProgress(l: LockRecord, now: number): number | null {
  // The contract's own record first; the device's note only for the candidate contract.
  const sealedAt = l.lockedAt ?? lockMeta(l).sealedAt
  if (!sealedAt) return null
  const total = Number(l.unlockAt) - sealedAt
  if (total <= 0) return 1
  return (now - sealedAt) / total
}

export function lockTitle(l: LockRecord): string {
  return lockMeta(l).label || `Lock #${l.id}`
}

export const statusLabel: Record<LockStatus, string> = {
  sealed: 'Sealed',
  ripe: 'Ready',
  withdrawn: 'Withdrawn',
}
