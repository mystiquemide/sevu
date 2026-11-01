import { isAddress, isHex, getAddress, type Address, type Hex } from 'viem'
import { RelayError } from './errors.js'

export interface DepositRequest {
  intent: { owner: Address; amount: bigint; unlockAt: bigint; nonce: bigint; deadline: bigint }
  intentSig: Hex
  permit: { value: bigint; deadline: bigint; v: number; r: Hex; s: Hex }
}

const UINT = /^(0|[1-9][0-9]{0,77})$/
const MAX_UINT256 = (1n << 256n) - 1n
const MAX_UINT64 = (1n << 64n) - 1n

function bad(field: string): never {
  throw new RelayError('BAD_REQUEST', `Invalid or missing field: ${field}`)
}

function uint(v: unknown, field: string, max = MAX_UINT256): bigint {
  const s = typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : v
  if (typeof s !== 'string' || !UINT.test(s)) bad(field)
  const n = BigInt(s)
  if (n > max) bad(field)
  return n
}

function obj(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(field)
  return v as Record<string, unknown>
}

function bytes32(v: unknown, field: string): Hex {
  if (typeof v !== 'string' || !isHex(v, { strict: true }) || v.length !== 66) bad(field)
  return v as Hex
}

export function parseDeposit(body: unknown): DepositRequest {
  const b = obj(body, 'body')
  const i = obj(b.intent, 'intent')
  const p = obj(b.permit, 'permit')
  if (typeof i.owner !== 'string' || !isAddress(i.owner, { strict: false })) bad('intent.owner')
  if (typeof b.intentSig !== 'string' || !isHex(b.intentSig, { strict: true }) || b.intentSig.length !== 132) bad('intentSig')
  const v = p.v
  if (typeof v !== 'number' || !(v === 27 || v === 28)) bad('permit.v')
  return {
    intent: {
      owner: getAddress(i.owner),
      amount: uint(i.amount, 'intent.amount'),
      unlockAt: uint(i.unlockAt, 'intent.unlockAt', MAX_UINT64),
      nonce: uint(i.nonce, 'intent.nonce'),
      deadline: uint(i.deadline, 'intent.deadline'),
    },
    intentSig: b.intentSig as Hex,
    permit: {
      value: uint(p.value, 'permit.value'),
      deadline: uint(p.deadline, 'permit.deadline'),
      v,
      r: bytes32(p.r, 'permit.r'),
      s: bytes32(p.s, 'permit.s'),
    },
  }
}

export function parseWithdrawal(body: unknown): { lockId: bigint; contract?: Address } {
  const b = obj(body, 'body')
  let contract: Address | undefined
  if (b.contract !== undefined) {
    if (typeof b.contract !== 'string' || !isAddress(b.contract, { strict: false })) bad('contract')
    contract = getAddress(b.contract)
  }
  return { lockId: uint(b.lockId, 'lockId'), contract }
}
