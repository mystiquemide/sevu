/**
 * NIM jars are names and goals over the user's own Nimiq stake (BR-006). They lock nothing.
 * Stored on this device per Nimiq address; the stake itself is always read from the chain.
 */
export interface Jar {
  id: string
  name: string
  /** Goal in luna. */
  target: number
  /** Stake added through this jar on this device, in luna. */
  added: number
}

const KEY = (address: string) => `sevu:jars:${address.replace(/\s+/g, '')}`

export function loadJars(address: string): Jar[] {
  try {
    return JSON.parse(localStorage.getItem(KEY(address)) ?? '[]') as Jar[]
  } catch {
    return []
  }
}

export function saveJars(address: string, jars: Jar[]) {
  try {
    localStorage.setItem(KEY(address), JSON.stringify(jars))
  } catch {
    // Storage blocked: jars are labels; the stake is safe on chain either way.
  }
}

/** What each jar can honestly claim: its added amount, scaled down if the chain shows less stake than jars add up to. */
export function jarShares(jars: Jar[], staked: number): { claimed: number[]; shortfall: boolean } {
  const total = jars.reduce((a, j) => a + j.added, 0)
  if (total <= staked || total === 0) return { claimed: jars.map((j) => j.added), shortfall: false }
  const ratio = staked / total
  return { claimed: jars.map((j) => Math.floor(j.added * ratio)), shortfall: true }
}
