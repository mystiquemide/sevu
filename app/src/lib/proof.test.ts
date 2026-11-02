import { describe, expect, it } from 'vitest'
import { summarize } from './proof'

const a = '0x00000000000000000000000000000000000000aA' as const
const b = '0x00000000000000000000000000000000000000bb' as const

describe('summarize', () => {
  it('counts owners case-insensitively and splits locked from withdrawn', () => {
    const s = summarize([
      { owner: a, amount: 1_000_000n, withdrawn: false },
      { owner: a.toLowerCase() as typeof a, amount: 2_000_000n, withdrawn: true },
      { owner: b, amount: 3_000_000n, withdrawn: false },
    ])
    expect(s).toEqual({ locks: 3, owners: 2, locked: 4_000_000n, withdrawn: 2_000_000n })
  })
  it('handles no locks', () => {
    expect(summarize([])).toEqual({ locks: 0, owners: 0, locked: 0n, withdrawn: 0n })
  })
})
