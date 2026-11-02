import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { recoverTypedDataAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { formatRemaining, formatUsdt, parseUsdt } from '../src/lib/format'
import { friendlyError, RELAYER_MESSAGES } from '../src/lib/errors'
import { RelayerError } from '../src/lib/relayer'
import { buildIntent, buildPermit } from '../src/lib/lockFlow'

describe('amount parsing', () => {
  it('parses whole and decimal amounts', () => {
    expect(parseUsdt('5')).toBe(5_000_000n)
    expect(parseUsdt('2.5')).toBe(2_500_000n)
    expect(parseUsdt('0,75')).toBe(750_000n)
    expect(parseUsdt('1.000001')).toBe(1_000_001n)
  })
  it('rejects junk and too many decimals', () => {
    for (const bad of ['', 'abc', '-1', '1.2345678', '1e6', '1.2.3']) expect(parseUsdt(bad)).toBeNull()
  })
  it('formats with two decimals minimum', () => {
    expect(formatUsdt(5_000_000n)).toBe('5.00')
    expect(formatUsdt(1_234_500_000n)).toBe('1,234.50')
    expect(formatUsdt(1_000_001n)).toBe('1.000001')
  })
  it('formats remaining time', () => {
    expect(formatRemaining(0)).toBe('')
    expect(formatRemaining(90 * 60)).toBe('1 h 30 min')
    expect(formatRemaining(3 * 86_400 + 3600)).toBe('3 days 1 h')
    expect(formatRemaining(86_400 + 7200)).toBe('1 day 2 h')
  })
})

describe('error messages', () => {
  it('maps relayer codes to plain language', () => {
    expect(friendlyError(new RelayerError('STILL_LOCKED', 'x')).title).toBeTruthy()
    expect(friendlyError(new RelayerError('RATE_LIMITED', 'x')).title).toBe('You have reached today’s lock limit')
    // Users never see internal names like the relayer or the build config.
    for (const m of Object.values(RELAYER_MESSAGES)) expect(`${m.title} ${m.action}`).not.toMatch(/relayer|configured/i)
  })
  it('treats wallet rejection as a quiet cancel', () => {
    expect(friendlyError({ code: 4001, message: 'User rejected' }).cancelled).toBe(true)
  })
  it('every relayer error code has its own message (error matrix, FR-017)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../relayer/src/errors.ts', import.meta.url)), 'utf8')
    const codes = [...src.matchAll(/^  \| '([A-Z_]+)'/gm)].map((m) => m[1]!)
    expect(codes.length).toBeGreaterThan(10)
    const missing = codes.filter((c) => !RELAYER_MESSAGES[c])
    expect(missing).toEqual([])
    for (const c of codes) expect(RELAYER_MESSAGES[c]!.action.length).toBeGreaterThan(10)
  })

  it('short titles have no trailing period', () => {
    for (const code of ['AMOUNT_OUT_OF_RANGE', 'NONCE_MISMATCH', 'RELAYER_UNREACHABLE', 'NOPE']) {
      expect(friendlyError(new RelayerError(code, 'x')).title.endsWith('.')).toBe(false)
    }
    expect(friendlyError({ code: 4001 }).title.endsWith('.')).toBe(false)
  })
  it('never contains em dashes', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/lib/errors.ts', import.meta.url)), 'utf8')
    expect(src).not.toContain('—')
  })
})

describe('typed data', () => {
  it('matches the relayer definitions exactly', () => {
    const app = readFileSync(fileURLToPath(new URL('../src/lib/typedData.ts', import.meta.url)), 'utf8')
    const relayer = readFileSync(fileURLToPath(new URL('../../relayer/src/typedData.ts', import.meta.url)), 'utf8')
    expect(app).toBe(relayer)
  })

  it('produces payloads whose signatures recover to the owner', async () => {
    const acct = privateKeyToAccount(generatePrivateKey())
    const lock = '0x1111111111111111111111111111111111111111'
    for (const td of [
      buildPermit(acct.address, lock, 5_000_000n, 0n, 2_000_000_000n),
      buildIntent(lock, acct.address, 5_000_000n, 2_000_000_000n, 0n, 2_000_000_000n),
    ]) {
      const { EIP712Domain, ...types } = td.types
      const sig = await acct.signTypedData({ ...td, types } as never)
      expect(await recoverTypedDataAddress({ ...td, types, signature: sig } as never)).toBe(acct.address)
    }
  })
})

describe('pending attempt (audit L-1)', () => {
  const owner = '0x1111111111111111111111111111111111111111' as const
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
  })

  it('is active while its nonce is unused and its deadline is ahead', async () => {
    const { savePendingAttempt, activeAttempt } = await import('../src/lib/attempts')
    savePendingAttempt(owner, { nonce: '3', amount: '5000000', unlockAt: '2000000000', label: 'Rent', deadline: 1000 })
    expect(activeAttempt(owner, 3n, 900)?.amount).toBe('5000000')
  })

  it('clears once the deadline passes or the nonce was used', async () => {
    const { savePendingAttempt, activeAttempt } = await import('../src/lib/attempts')
    savePendingAttempt(owner, { nonce: '3', amount: '5000000', unlockAt: '2000000000', label: '', deadline: 1000 })
    expect(activeAttempt(owner, 3n, 1000)).toBeNull()
    savePendingAttempt(owner, { nonce: '3', amount: '5000000', unlockAt: '2000000000', label: '', deadline: 1000 })
    expect(activeAttempt(owner, 4n, 900)).toBeNull()
    expect(store.size).toBe(0)
  })
})

describe('NIM jars (BR-006)', () => {
  it('parses and formats NIM in luna', async () => {
    const { parseNim, formatNim } = await import('../src/lib/nimiq')
    expect(parseNim('150')).toBe(15_000_000)
    expect(parseNim('12.5')).toBe(1_250_000)
    expect(parseNim('1.123456')).toBeNull()
    expect(formatNim(15_000_000)).toBe('150')
    expect(formatNim(1_250_000)).toBe('12.5')
  })

  it('never lets jars claim more than is really staked', async () => {
    const { jarShares } = await import('../src/lib/jars')
    const jars = [
      { id: 'a', name: 'Laptop', target: 500_00000, added: 300_00000 },
      { id: 'b', name: 'Trip', target: 200_00000, added: 100_00000 },
    ]
    expect(jarShares(jars, 400_00000)).toEqual({ claimed: [300_00000, 100_00000], shortfall: false })
    const cut = jarShares(jars, 200_00000)
    expect(cut.shortfall).toBe(true)
    expect(cut.claimed[0]! + cut.claimed[1]!).toBeLessThanOrEqual(200_00000)
  })
})

import { googleCalendarUrl, shareText, unlockIcs } from '../src/lib/remind'
describe('unlock reminders', () => {
  const unlockAt = Date.UTC(2026, 10, 23, 5, 42) / 1000
  it('builds a valid one-event calendar file at the unlock time', () => {
    const ics = unlockIcs({ id: '0xabc-1', title: 'Rent', amount: 120_000_000n, unlockAt, now: unlockAt - 86_400 })
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('DTSTART:20261123T054200Z')
    expect(ics).toContain('SUMMARY:Sevu: Rent opens (120.00 USDT)')
    expect(ics.split('\r\n').every((l) => l.length <= 200)).toBe(true)
  })
  it('links to Google Calendar with the same time', () => {
    expect(googleCalendarUrl({ title: 'Rent', amount: 1_000_000n, unlockAt })).toContain('dates=20261123T054200Z%2F20261123T061200Z')
  })
  it('share text carries only public facts', () => {
    expect(shareText({ amount: 5_000_000n, unlockAt: 'Nov 23' })).toBe('I sealed 5.00 USDT in Sevu until Nov 23. Nobody can move it early, not even Sevu. https://sevu.midelabs.xyz')
  })
})
