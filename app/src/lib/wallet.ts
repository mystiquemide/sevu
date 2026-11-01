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

export async function switchToPolygon() {
  const p = evmProvider()
  if (!p) throw new Error('NO_PROVIDER')
  await ensurePolygon(p)
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

export interface WalletSnapshot {
  account: Address | null
  onPolygon: boolean
}

/** Reads the wallet's current account and network without prompting. */
export async function readWallet(): Promise<WalletSnapshot> {
  const p = evmProvider()
  if (!p) return { account: null, onPolygon: false }
  const [accounts, chain] = await Promise.all([
    p.request({ method: 'eth_accounts' }) as Promise<string[]>,
    p.request({ method: 'eth_chainId' }) as Promise<string>,
  ])
  return { account: accounts[0] ? getAddress(accounts[0]) : null, onPolygon: String(chain).toLowerCase() === POLYGON_HEX }
}

/**
 * Follows account and network changes made in Nimiq Pay. Uses provider events when the host emits them,
 * and re-reads the wallet whenever the app returns to the foreground in case it does not.
 */
export function watchWallet(onChange: (w: WalletSnapshot) => void): () => void {
  const p = evmProvider()
  if (!p) return () => {}
  let last = ''
  const check = async () => {
    try {
      const w = await readWallet()
      const key = `${w.account}|${w.onPolygon}`
      if (key !== last) {
        last = key
        onChange(w)
      }
    } catch {
      // A failed read is not a change; the next event or focus will try again.
    }
  }
  void readWallet().then((w) => (last = `${w.account}|${w.onPolygon}`)).catch(() => {})
  const onEvent = () => void check()
  const onVisible = () => { if (document.visibilityState === 'visible') void check() }
  p.on?.('accountsChanged', onEvent)
  p.on?.('chainChanged', onEvent)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onEvent)
  return () => {
    p.removeListener?.('accountsChanged', onEvent)
    p.removeListener?.('chainChanged', onEvent)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onEvent)
  }
}
