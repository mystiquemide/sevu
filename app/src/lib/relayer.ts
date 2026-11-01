import type { Hash } from 'viem'
import { config } from '../config'

export class RelayerError extends Error {
  constructor(readonly code: string, message: string, readonly data?: Record<string, string>) {
    super(message)
  }
}

async function post(path: string, body: unknown): Promise<Hash> {
  if (!config.relayerUrl) throw new Error('NOT_CONFIGURED')
  let res: Response
  try {
    res = await fetch(`${config.relayerUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
      signal: AbortSignal.timeout(45_000),
    })
  } catch {
    throw new RelayerError('RELAYER_UNREACHABLE', 'Relayer is not reachable')
  }
  const json = (await res.json().catch(() => null)) as
    | { txHash?: Hash; error?: { code: string; message: string; data?: Record<string, string> } }
    | null
  if (!res.ok || !json?.txHash) {
    const e = json?.error
    throw new RelayerError(e?.code ?? 'RELAYER_ERROR', e?.message ?? `Relayer answered ${res.status}`, e?.data)
  }
  return json.txHash
}

export const relayDeposit = (body: unknown) => post('/v1/deposits', body)
export const relayWithdrawal = (lockId: bigint) => post('/v1/withdrawals', { lockId })
