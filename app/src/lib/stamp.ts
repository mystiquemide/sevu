const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Postmark parts for a unix time, in the user's local time zone. Postmarks are always set in English caps. */
export function stampParts(unixSec: bigint | number) {
  const d = new Date(Number(unixSec) * 1000)
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: MONTHS[d.getMonth()]!,
    year: String(d.getFullYear()),
  }
}
