import { getAddress, type Address, type Hex } from 'viem'
import { POLYGON_CHAIN_ID } from '../config'

const POLYGON_HEX = `0x${POLYGON_CHAIN_ID.toString(16)}`

export function evmProvider(): Eip1193 | null {
  return typeof window !== 'undefined' && window.ethereum ? window.ethereum : null
}

export function insideNimiqPay(): boolean {
  return typeof window !== 'undefined' && 'nimiq' in window && Boolean((window as { nimiq?: unknown }).nimiq)
}

/** Requests the account and makes sure the wallet is on Polygon. Nimiq Pay starts on Ethereum (0x1). */
export async function connect(): Promise<Address> {
  const p = evmProvider()
  if (!p) throw new Error('NO_PROVIDER')
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[]
  const first = accounts[0]
  if (!first) throw new Error('NO_ACCOUNT')
  await ensurePolygon(p)
  return getAddress(first)
}

async function ensurePolygon(p: Eip1193) {
  const current = String(await p.request({ method: 'eth_chainId' })).toLowerCase()
  if (current === POLYGON_HEX) return
  await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_HEX }] })
  const after = String(await p.request({ method: 'eth_chainId' })).toLowerCase()
  if (after !== POLYGON_HEX) throw new Error('WRONG_CHAIN')
}

export async function signTypedData(account: Address, typedData: unknown): Promise<Hex> {
  const p = evmProvider()
  if (!p) throw new Error('NO_PROVIDER')
  const json = JSON.stringify(typedData, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  return (await p.request({ method: 'eth_signTypedData_v4', params: [account, json] })) as Hex
}

/** Sends a transaction from the user's own wallet. Used only by the rescue path; the user pays gas in POL. */
export async function sendTransaction(from: Address, to: Address, data: Hex): Promise<Hex> {
  const p = evmProvider()
  if (!p) throw new Error('NO_PROVIDER')
  await ensurePolygon(p)
  return (await p.request({ method: 'eth_sendTransaction', params: [{ from, to, data }] })) as Hex
}
