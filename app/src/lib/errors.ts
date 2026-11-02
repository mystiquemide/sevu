import { RelayerError } from './relayer'

export interface FriendlyError {
  title: string
  action: string
  /** True when the user simply cancelled; shown quietly. */
  cancelled?: boolean
}

export const RELAYER_MESSAGES: Record<string, FriendlyError> = {
  AMOUNT_OUT_OF_RANGE: { title: 'That amount is outside the limit', action: 'Choose between 1 and 10 USDT for now.' },
  UNLOCK_OUT_OF_RANGE: { title: 'That unlock date is not allowed', action: 'Pick a date at least 10 minutes and at most 2 years away.' },
  INTENT_EXPIRED: { title: 'Your signatures expired', action: 'Start the lock again and sign both requests.' },
  PERMIT_EXPIRED: { title: 'Your signatures expired', action: 'Start the lock again and sign both requests.' },
  BAD_INTENT_SIGNATURE: { title: 'The lock signature could not be verified', action: 'Start the lock again and sign both requests. Nothing was moved.' },
  BAD_PERMIT_SIGNATURE: { title: 'The USDT signature could not be verified', action: 'Start the lock again and sign both requests. Nothing was moved.' },
  NONCE_MISMATCH: { title: 'This lock request is out of date', action: 'Refresh your locks, then try again.' },
  INSUFFICIENT_BALANCE: { title: 'Not enough USDT', action: 'Lower the amount or top up in Nimiq Pay.' },
  DUPLICATE_PENDING: { title: 'This lock is already on its way', action: 'Wait a moment and refresh your locks.' },
  RATE_LIMITED: { title: 'You have reached today’s lock limit', action: 'You can create more locks tomorrow. Your existing locks are not affected.' },
  BUDGET_EXHAUSTED: { title: 'Free locking is paused for today', action: 'Try again tomorrow. Existing locks are safe.' },
  SIMULATION_FAILED: { title: 'The contract would refuse this request', action: 'Check the amount and date, then try again.' },
  CHAIN_UNAVAILABLE: { title: 'Polygon is not reachable right now', action: 'Try again in a minute.' },
  STILL_LOCKED: { title: 'Not open yet', action: 'This lock opens at its unlock time. Refresh in a moment.' },
  ALREADY_WITHDRAWN: { title: 'Already withdrawn', action: 'This lock was paid back to your wallet. Refresh to see it in History.' },
  LOCK_NOT_FOUND: { title: 'Lock not found', action: 'Refresh your locks. If it persists, use Withdraw directly.' },
  BAD_REQUEST: { title: 'Sevu could not send that request', action: 'Reload Sevu and try again. Nothing was moved.' },
  INTERNAL: { title: 'Sevu’s free service had a problem', action: 'Try again in a minute. To withdraw now, use Withdraw directly. Nothing was moved.' },
  RELAYER_UNREACHABLE: { title: 'Sevu’s free service is not responding', action: 'Check your connection and try again. To withdraw now, use Withdraw directly. Nothing was moved.' },
}

export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof RelayerError) {
    return RELAYER_MESSAGES[err.code] ?? { title: 'The request was refused', action: 'Try again. Nothing was moved.' }
  }
  const e = err as { code?: number | string; type?: string; name?: string; message?: string; shortMessage?: string } | undefined
  const msg = `${e?.name ?? ''} ${e?.type ?? ''} ${e?.shortMessage ?? ''} ${e?.message ?? ''}`
  // Network failures first: iOS reports a dropped request as "cancelled", which must not read as the user saying no.
  if (/HttpRequestError|TimeoutError|Failed to fetch|Load failed|NetworkError|network connection was lost|took too long|ECONNRESET|fetch failed/i.test(msg)) {
    return { title: 'Polygon is not reachable right now', action: 'Check your connection and try again. Your locks are safe in the contract.' }
  }
  if (e?.code === 4001 || e?.code === 'ACTION_REJECTED' || /UserRejected|user (rejected|denied|cancell?ed)|rejected by (the )?user|request (was )?rejected/i.test(msg)) {
    return { title: 'Signing cancelled', action: 'Nothing was moved. Start again whenever you like.', cancelled: true }
  }
  if (msg.includes('NO_PROVIDER')) return { title: 'No wallet found', action: 'Open Sevu inside Nimiq Pay.' }
  if (msg.includes('WRONG_CHAIN')) return { title: 'Your wallet is not on Polygon', action: 'Switch to Polygon in Nimiq Pay and try again.' }
  if (msg.includes('NOT_CONFIGURED')) return { title: 'Sevu could not start', action: 'Reload Sevu. If it keeps happening, try again later. Your locks are safe in the contract.' }
  return { title: 'Something went wrong on our side', action: 'Try again. If it keeps happening, reload Sevu. Your locks are safe in the contract.' }
}
