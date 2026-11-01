
/** Lock labels and seal times live only on this device. The contract stays the source of truth for money. */
interface LocalLockMeta {
  label?: string
  /** Chain timestamp of the block that sealed the lock, when it was created on this device. */
  sealedAt?: number
}

/** Keyed per deployment, so lock #0 on one contract never borrows the name of lock #0 on another. */
const KEY = (contract: string) => `sevu:locks:${contract}`

interface LockRef { contract: string; id: bigint }

function readAll(contract: string): Record<string, LocalLockMeta> {
  try {
    return JSON.parse(localStorage.getItem(KEY(contract)) ?? '{}') as Record<string, LocalLockMeta>
  } catch {
    return {}
  }
}

export function lockMeta(ref: LockRef): LocalLockMeta {
  return readAll(ref.contract)[ref.id.toString()] ?? {}
}

export function saveLockMeta(ref: LockRef, patch: LocalLockMeta) {
  const all = readAll(ref.contract)
  all[ref.id.toString()] = { ...all[ref.id.toString()], ...patch }
  try {
    localStorage.setItem(KEY(ref.contract), JSON.stringify(all))
  } catch {
    // Storage full or blocked: labels are optional, so ignore.
  }
}

export const MAX_LABEL = 32
export function cleanLabel(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
}
