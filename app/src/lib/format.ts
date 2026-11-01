const DECIMALS = 6n
const UNIT = 10n ** DECIMALS

/** Parses a user-typed USDT amount like "12" or "12.5" into base units. Returns null when invalid. */
export function parseUsdt(input: string): bigint | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d{1,9}(\.\d{0,6})?$/.test(s)) return null
  const [whole = '0', frac = ''] = s.split('.')
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(6, '0') || '0')
}

export function formatUsdt(units: bigint): string {
  const whole = units / UNIT
  const frac = (units % UNIT).toString().padStart(6, '0').replace(/0+$/, '')
  const cents = frac.length <= 2 ? frac.padEnd(2, '0') : frac
  return `${whole.toLocaleString('en-US')}.${cents}`
}

export function formatDate(unixSec: bigint | number, locale?: string): string {
  return new Date(Number(unixSec) * 1000).toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** "3 days 4 h", "2 h 10 min", "45 s". Empty when the time has passed. */
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return ''
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return h > 0 ? `${d} days ${h} h` : `${d} days`
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min`
  return `${seconds} s`
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}
