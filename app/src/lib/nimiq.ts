import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'

/** 1 NIM = 100,000 luna. */
export const LUNA = 100_000
/** Nimiq policy minimumStake (10,000,000 luna), read from getPolicyConstants on mainnet 2026-11-01. */
export const MIN_NEW_STAKE_LUNA = 100 * LUNA

const RPC_URL = (import.meta.env.VITE_NIMIQ_RPC as string | undefined) ?? 'https://rpc.nimiqwatch.com'

export interface Staker {
  /** Active stake earning rewards. */
  balance: number
  inactiveBalance: number
  retiredBalance: number
  delegation: string
}

export interface Validator {
  address: string
  /** Total stake behind the validator, in luna. */
  balance: number
}

let provider: Promise<NimiqProvider> | null = null

/** Nimiq Pay's own Nimiq wallet. Null outside Nimiq Pay. */
export function nimiqWallet(): Promise<NimiqProvider> | null {
  if (typeof window === 'undefined' || !('nimiq' in window)) return null
  provider ??= init({ timeout: 4000 })
  return provider
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json()) as { result?: { data: T }; error?: { message: string; data?: string } }
  if (json.error) throw new Error(json.error.data || json.error.message)
  return json.result!.data
}

/** The address's staker, or null when it has never staked. Read from the Nimiq chain, not from Sevu. */
export async function stakerOf(address: string): Promise<Staker | null> {
  try {
    const s = await rpc<Staker>('getStakerByAddress', [address])
    return { balance: s.balance ?? 0, inactiveBalance: s.inactiveBalance ?? 0, retiredBalance: s.retiredBalance ?? 0, delegation: s.delegation }
  } catch (e) {
    if (/No staker with address/i.test(String((e as Error).message))) return null
    throw e
  }
}

/** Active validators, largest stake first. */
export async function activeValidators(): Promise<Validator[]> {
  const v = await rpc<Validator[]>('getActiveValidators', [])
  return v.map((x) => ({ address: x.address, balance: x.balance })).sort((a, b) => b.balance - a.balance)
}

/** Every NIM account Nimiq Pay shares with Sevu. Accepts plain addresses and { address } objects. */
export async function nimAccounts(): Promise<string[]> {
  const p = nimiqWallet()
  if (!p) throw new Error('NO_PROVIDER')
  const list = ((await (await p).listAccounts()) as unknown[]) ?? []
  const addresses = list
    .map((a) => (typeof a === 'string' ? a : (a as { address?: string })?.address))
    .filter((a): a is string => !!a)
  if (!addresses.length) throw new Error('NO_ACCOUNT')
  return addresses
}

/** NIM balance in luna, read from the Nimiq network; Nimiq Pay's own getBalance only if the node is unreachable. */
export async function nimBalance(address: string): Promise<number> {
  try {
    const acct = await rpc<{ balance: number }>('getAccountByAddress', [address])
    return acct.balance ?? 0
  } catch (e) {
    const p = nimiqWallet()
    if (!p) throw e
    const b = await (await p).getBalance(address)
    if (typeof b === 'number') return b
    throw e
  }
}

/** Adds stake; creates the staker first time, delegating to the chosen validator. Returns Nimiq Pay's result. */
export async function addStake(value: number, firstTime: { delegation: string } | null): Promise<string> {
  const p = nimiqWallet()
  if (!p) throw new Error('NO_PROVIDER')
  const w = await p
  return firstTime ? w.sendNewStakerTransaction({ delegation: firstTime.delegation, value }) : w.sendStakeTransaction({ value })
}

/** Polls the chain until active stake reaches at least `target`, up to about a minute. */
export async function waitForStake(address: string, target: number): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const s = await stakerOf(address).catch(() => null)
    if (s && s.balance >= target) return true
    await new Promise((r) => setTimeout(r, 3000))
  }
  return false
}

export function formatNim(luna: number): string {
  const nim = luna / LUNA
  return nim.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: nim < 100 ? 2 : 0 })
}

export function parseNim(input: string): number | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d{1,10}(\.\d{0,5})?$/.test(s)) return null
  const [w = '0', f = ''] = s.split('.')
  return Number(w) * LUNA + Number(f.padEnd(5, '0') || '0')
}

export function shortNq(a: string): string {
  const g = a.split(' ')
  return g.length > 3 ? `${g[0]} ${g[1]} ... ${g[g.length - 1]}` : a
}
