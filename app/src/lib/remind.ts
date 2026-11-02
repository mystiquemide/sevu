import { formatUsdt } from './format'

const APP_URL = 'https://sevu.midelabs.xyz'

function icsTime(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** A one-event calendar file so the saver comes back on the day the envelope opens. */
export function unlockIcs(opts: { id: string; title: string; amount: bigint; unlockAt: number; now: number }): string {
  const summary = `Sevu: ${opts.title} opens (${formatUsdt(opts.amount)} USDT)`
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sevu//Unlock reminder//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${opts.id}@sevu.midelabs.xyz`,
    `DTSTAMP:${icsTime(opts.now)}`,
    `DTSTART:${icsTime(opts.unlockAt)}`,
    `DTEND:${icsTime(opts.unlockAt + 30 * 60)}`,
    `SUMMARY:${summary.replace(/[,;]/g, ' ')}`,
    `DESCRIPTION:Your Sevu envelope is ready. Open Sevu in Nimiq Pay and tap Withdraw to my wallet.`,
    `URL:${APP_URL}`,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Your Sevu envelope is ready', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')
}

export function googleCalendarUrl(opts: { title: string; amount: bigint; unlockAt: number }): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Sevu: ${opts.title} opens (${formatUsdt(opts.amount)} USDT)`,
    dates: `${icsTime(opts.unlockAt)}/${icsTime(opts.unlockAt + 30 * 60)}`,
    details: 'Your Sevu envelope is ready. Open Sevu in Nimiq Pay and tap Withdraw to my wallet.',
  })
  return `https://calendar.google.com/calendar/render?${p}`
}

/** Text for sharing a lock. Says only what the chain already shows publicly. */
export function shareText(opts: { amount: bigint; unlockAt: string; link?: string }): string {
  return `I sealed ${formatUsdt(opts.amount)} USDT in Sevu until ${opts.unlockAt}. Nobody can move it early, not even Sevu. Try it with 1 USDT for 15 minutes: ${opts.link ?? APP_URL}`
}
