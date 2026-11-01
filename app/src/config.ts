import { getAddress, isAddress, type Address } from 'viem'

export const USDT0 = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as Address
export const POLYGON_CHAIN_ID = 137
export const MIN_AMOUNT = 1_000_000n
export const MAX_AMOUNT = 10_000_000n
export const MIN_DURATION_SEC = 5 * 60
export const MAX_DURATION_SEC = 730 * 86_400
/** Short on purpose: a signed intent stays valid until its deadline (audit L-1). */
export const SIGNATURE_TTL_SEC = 10 * 60

function lockAddress(): Address | null {
  const v = import.meta.env.VITE_SEVU_LOCK_ADDRESS as string | undefined
  return v && isAddress(v) ? getAddress(v) : null
}

/** Earlier SevuLock deployments (comma-separated). Their locks stay visible and withdrawable. */
function legacyLocks(): Address[] {
  const v = (import.meta.env.VITE_SEVU_LEGACY_LOCKS as string | undefined) ?? ''
  return v.split(',').map((s) => s.trim()).filter((s) => isAddress(s)).map((s) => getAddress(s))
}

export const config = {
  lockAddress: lockAddress(),
  legacyLocks: legacyLocks(),
  relayerUrl: ((import.meta.env.VITE_RELAYER_URL as string | undefined) ?? '').replace(/\/$/, ''),
  rpcUrl: (import.meta.env.VITE_POLYGON_RPC as string | undefined) ?? 'https://polygon-bor-rpc.publicnode.com',
}
