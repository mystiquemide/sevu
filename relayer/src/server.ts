import { serve } from '@hono/node-server'
import { getAddress, isAddress, isHex, type Hex } from 'viem'
import { createApp } from './app.js'
import { RelayerService, defaultConfig } from './service.js'
import { createViemChain } from './viemChain.js'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable ${name}`)
  return v
}

function address(name: string): `0x${string}` {
  const v = required(name)
  if (!isAddress(v)) throw new Error(`${name} is not a valid address`)
  return getAddress(v)
}

const key = required('RELAYER_PRIVATE_KEY')
if (!isHex(key) || key.length !== 66) throw new Error('RELAYER_PRIVATE_KEY must be a 32-byte hex string')
const rpcUrls = required('POLYGON_RPC_URLS').split(',').map((s) => s.trim()).filter(Boolean)
const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...event }))

const chain = createViemChain({
  rpcUrls,
  privateKey: key as Hex,
  lockAddress: address('SEVU_LOCK_ADDRESS'),
  tokenAddress: address('USDT0_ADDRESS'),
})

const service = new RelayerService(
  chain,
  {
    ...defaultConfig,
    maxLockAmount: BigInt(process.env.MAX_LOCK_AMOUNT ?? '10000000'),
    dailyGasBudgetWei: BigInt(process.env.DAILY_GAS_BUDGET_WEI ?? '5000000000000000000'),
    lowBalanceWei: BigInt(process.env.LOW_BALANCE_WEI ?? '1000000000000000000'),
  },
  log,
)

const app = createApp(service, {
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  log,
})

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, () => log({ event: 'listening', port, rpcCount: rpcUrls.length }))
