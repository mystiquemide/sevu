import { getAddress, isAddress, type Address } from 'viem'

export const USDT0 = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as Address
export const POLYGON_CHAIN_ID = 137
export const MIN_AMOUNT = 1_000_000n
export const MAX_AMOUNT = 10_000_000n
export const MIN_DURATION_SEC = 5 * 60
export const MAX_DURATION_SEC = 730 * 86_400
export const SIGNATURE_TTL_SEC = 30 * 60

function lockAddress(): Address | null {
  const v = import.meta.env.VITE_SEVU_LOCK_ADDRESS as string | undefined
  return v && isAddress(v) ? getAddress(v) : null
}

export const config = {
  lockAddress: lockAddress(),
  relayerUrl: ((import.meta.env.VITE_RELAYER_URL as string | undefined) ?? '').replace(/\/$/, ''),
  rpcUrl: (import.meta.env.VITE_POLYGON_RPC as string | undefined) ?? 'https://polygon-bor-rpc.publicnode.com',
}
