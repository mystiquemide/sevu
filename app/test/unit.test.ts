import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { recoverTypedDataAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { formatRemaining, formatUsdt, parseUsdt } from '../src/lib/format'
import { friendlyError } from '../src/lib/errors'
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
  })
})

describe('error messages', () => {
  it('maps relayer codes to plain language', () => {
    expect(friendlyError(new RelayerError('STILL_LOCKED', 'x')).title).toBeTruthy()
    expect(friendlyError(new RelayerError('RATE_LIMITED', 'x')).title).toBe('Daily limit reached')
  })
  it('treats wallet rejection as a quiet cancel', () => {
    expect(friendlyError({ code: 4001, message: 'User rejected' }).cancelled).toBe(true)
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
