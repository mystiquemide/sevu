import { config } from '../config'

/** Lock labels and seal times live only on this device. The contract stays the source of truth for money. */
interface LocalLockMeta {
  label?: string
  /** Chain timestamp of the block that sealed the lock, when it was created on this device. */
  sealedAt?: number
}

const KEY = () => `sevu:locks:${config.lockAddress ?? 'none'}`

function readAll(): Record<string, LocalLockMeta> {
  try {
    return JSON.parse(localStorage.getItem(KEY()) ?? '{}') as Record<string, LocalLockMeta>
  } catch {
    return {}
  }
}

export function lockMeta(id: bigint): LocalLockMeta {
  return readAll()[id.toString()] ?? {}
}

export function saveLockMeta(id: bigint, patch: LocalLockMeta) {
  const all = readAll()
  all[id.toString()] = { ...all[id.toString()], ...patch }
  try {
    localStorage.setItem(KEY(), JSON.stringify(all))
  } catch {
    // Storage full or blocked: labels are optional, so ignore.
  }
}

export const MAX_LABEL = 32
export function cleanLabel(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
}
