import { RelayerError } from './relayer'

export interface FriendlyError {
  title: string
  action: string
  /** True when the user simply cancelled; shown quietly. */
  cancelled?: boolean
}

const RELAYER: Record<string, FriendlyError> = {
  AMOUNT_OUT_OF_RANGE: { title: 'That amount is outside the limit', action: 'Choose between 1 and 10 USDT for now.' },
  UNLOCK_OUT_OF_RANGE: { title: 'That unlock date is not allowed', action: 'Pick a date at least 10 minutes and at most 2 years away.' },
  INTENT_EXPIRED: { title: 'Your signatures expired', action: 'Start the lock again and sign both requests.' },
  PERMIT_EXPIRED: { title: 'Your signatures expired', action: 'Start the lock again and sign both requests.' },
  BAD_INTENT_SIGNATURE: { title: 'The lock signature did not check out', action: 'Start again. Nothing was moved.' },
  BAD_PERMIT_SIGNATURE: { title: 'The USDT signature did not check out', action: 'Start again. Nothing was moved.' },
  NONCE_MISMATCH: { title: 'This lock request is out of date', action: 'Refresh your locks, then try again.' },
  INSUFFICIENT_BALANCE: { title: 'Not enough USDT', action: 'Lower the amount or top up in Nimiq Pay.' },
  DUPLICATE_PENDING: { title: 'This lock is already on its way', action: 'Wait a moment and refresh your locks.' },
  RATE_LIMITED: { title: 'Daily limit reached', action: 'You can create more locks tomorrow.' },
  BUDGET_EXHAUSTED: { title: 'Free locking is paused for today', action: 'Try again tomorrow. Existing locks are safe.' },
  SIMULATION_FAILED: { title: 'The contract would refuse this request', action: 'Check the amount and date, then try again.' },
  CHAIN_UNAVAILABLE: { title: 'Polygon is not reachable right now', action: 'Try again in a minute.' },
  RELAYER_UNREACHABLE: { title: 'Sevu could not reach its relayer', action: 'Check your connection and try again. Nothing was moved.' },
}

export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof RelayerError) {
    return RELAYER[err.code] ?? { title: 'The request was refused', action: 'Try again. Nothing was moved.' }
  }
  const e = err as { code?: number | string; type?: string; message?: string } | undefined
  const msg = `${e?.type ?? ''} ${e?.message ?? ''}`
  if (e?.code === 4001 || /reject|denied|cancel/i.test(msg)) {
    return { title: 'Signing cancelled', action: 'Nothing was moved. Start again whenever you like.', cancelled: true }
  }
  if (msg.includes('NO_PROVIDER')) return { title: 'No wallet found', action: 'Open Sevu inside Nimiq Pay.' }
  if (msg.includes('WRONG_CHAIN')) return { title: 'Your wallet is not on Polygon', action: 'Switch to Polygon in Nimiq Pay and try again.' }
  if (msg.includes('NOT_CONFIGURED')) return { title: 'This build is not configured', action: 'The contract or relayer address is missing.' }
  return { title: 'Something went wrong', action: 'Try again. If it keeps happening, reload Sevu.' }
}
