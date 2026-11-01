import { describe, it, expect, beforeEach } from 'vitest'
import { parseSignature, type Address, type Hash } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { createApp } from '../src/app.js'
import { RelayerService, defaultConfig } from '../src/service.js'
import { SimulationError, type ChainPort, type LockView } from '../src/chain.js'
import { lockIntentDomain, lockIntentTypes, permitTypes, usdt0Domain } from '../src/typedData.js'

const LOCK = '0x1111111111111111111111111111111111111111' as Address
const TOKEN = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as Address
const NOW = 1_800_000_000n

class FakeChain implements ChainPort {
  lockAddress = LOCK
  tokenAddress = TOKEN
  time = NOW
  lockNonces = new Map<string, bigint>()
  tokenNonces = new Map<string, bigint>()
  balances = new Map<string, bigint>()
  locks: LockView[] = []
  simulateError: string | null = null
  sent: string[] = []
  async now() { return this.time }
  async lockNonce(o: Address) { return this.lockNonces.get(o) ?? 0n }
  async tokenNonce(o: Address) { return this.tokenNonces.get(o) ?? 0n }
  async tokenBalance(o: Address) { return this.balances.get(o) ?? 0n }
  async getLock(id: bigint) { return this.locks[Number(id)] ?? null }
  async simulateDeposit() { if (this.simulateError) throw new SimulationError(this.simulateError) }
  async simulateWithdraw() { if (this.simulateError) throw new SimulationError(this.simulateError) }
  async sendDeposit() { this.sent.push('deposit'); return { hash: `0x${'a'.repeat(64)}` as Hash, maxCostWei: 10n ** 16n } }
  async sendWithdraw() { this.sent.push('withdraw'); return { hash: `0x${'b'.repeat(64)}` as Hash, maxCostWei: 10n ** 16n } }
  waitForReceipt() { return new Promise<void>(() => {}) }
  async relayerBalance() { return 2n * 10n ** 18n }
  async blockNumber() { return 42n }
}

const owner = privateKeyToAccount(generatePrivateKey())

async function signedBody(o: { amount?: bigint; unlockAt?: bigint; nonce?: bigint; deadline?: bigint; signer?: typeof owner; permitValue?: bigint } = {}) {
  const signer = o.signer ?? owner
  const amount = o.amount ?? 5_000_000n
  const intent = {
    owner: owner.address,
    amount,
    unlockAt: o.unlockAt ?? NOW + 30n * 86400n,
    nonce: o.nonce ?? 0n,
    deadline: o.deadline ?? NOW + 3600n,
  }
  const intentSig = await signer.signTypedData({ domain: lockIntentDomain(LOCK), types: lockIntentTypes, primaryType: 'LockIntent', message: intent })
  const permitValue = o.permitValue ?? amount
  const permitSig = await signer.signTypedData({
    domain: usdt0Domain(TOKEN), types: permitTypes, primaryType: 'Permit',
    message: { owner: owner.address, spender: LOCK, value: permitValue, nonce: 0n, deadline: NOW + 3600n },
  })
  const { v, r, s } = parseSignature(permitSig)
  const str = (x: bigint) => x.toString()
  return {
    intent: { owner: intent.owner, amount: str(amount), unlockAt: str(intent.unlockAt), nonce: str(intent.nonce), deadline: str(intent.deadline) },
    intentSig,
    permit: { value: str(permitValue), deadline: str(NOW + 3600n), v: Number(v), r, s },
  }
}

let chain: FakeChain
let app: ReturnType<typeof createApp>

function post(path: string, body: unknown) {
  return app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code
}

beforeEach(() => {
  chain = new FakeChain()
  chain.balances.set(owner.address, 100_000_000n)
  const service = new RelayerService(chain, { ...defaultConfig, maxLockAmount: 10_000_000n, dailyGasBudgetWei: 10n ** 18n, lowBalanceWei: 10n ** 18n })
  app = createApp(service, { allowedOrigins: ['https://app.example'] })
})

describe('POST /v1/deposits', () => {
  it('relays a valid deposit', async () => {
    const res = await post('/v1/deposits', await signedBody())
    expect(res.status).toBe(200)
    expect(((await res.json()) as { txHash: string }).txHash).toMatch(/^0x[a]{64}$/)
    expect(chain.sent).toEqual(['deposit'])
  })

  it('rejects amounts above the 10 USDT cap', async () => {
    const res = await post('/v1/deposits', await signedBody({ amount: 10_000_001n }))
    expect(await errorCode(res)).toBe('AMOUNT_OUT_OF_RANGE')
    expect(chain.sent).toEqual([])
  })

  it('rejects amounts below 1 USDT', async () => {
    expect(await errorCode(await post('/v1/deposits', await signedBody({ amount: 999_999n })))).toBe('AMOUNT_OUT_OF_RANGE')
  })

  it('rejects a tampered unlockAt (T1)', async () => {
    const body = await signedBody()
    body.intent.unlockAt = (NOW + 700n * 86400n).toString()
    const res = await post('/v1/deposits', body)
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('BAD_INTENT_SIGNATURE')
    expect(chain.sent).toEqual([])
  })

  it('rejects an intent signed by someone else', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    expect(await errorCode(await post('/v1/deposits', await signedBody({ signer: other })))).toBe('BAD_INTENT_SIGNATURE')
  })

  it('returns a structured error for a malformed intent signature, not INTERNAL', async () => {
    const body = await signedBody()
    body.intentSig = `0x${'a'.repeat(130)}` as `0x${string}`
    const res = await post('/v1/deposits', body)
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('BAD_INTENT_SIGNATURE')
  })

  it('returns a structured error for a malformed permit signature, not INTERNAL', async () => {
    const body = await signedBody()
    body.permit.r = `0x${'0'.repeat(64)}` as `0x${string}`
    body.permit.s = `0x${'f'.repeat(64)}` as `0x${string}`
    const res = await post('/v1/deposits', body)
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('BAD_PERMIT_SIGNATURE')
  })

  it('rejects a permit value that differs from the amount', async () => {
    expect(await errorCode(await post('/v1/deposits', await signedBody({ permitValue: 6_000_000n })))).toBe('BAD_REQUEST')
  })

  it('rejects a stale nonce', async () => {
    chain.lockNonces.set(owner.address, 1n)
    expect(await errorCode(await post('/v1/deposits', await signedBody()))).toBe('NONCE_MISMATCH')
  })

  it('rejects expired intents and too-short or too-long unlocks', async () => {
    expect(await errorCode(await post('/v1/deposits', await signedBody({ deadline: NOW + 30n })))).toBe('INTENT_EXPIRED')
    expect(await errorCode(await post('/v1/deposits', await signedBody({ unlockAt: NOW + 300n })))).toBe('UNLOCK_OUT_OF_RANGE')
    expect(await errorCode(await post('/v1/deposits', await signedBody({ unlockAt: NOW + 731n * 86400n })))).toBe('UNLOCK_OUT_OF_RANGE')
  })

  it('rejects insufficient balance', async () => {
    chain.balances.set(owner.address, 1_000_000n)
    expect(await errorCode(await post('/v1/deposits', await signedBody()))).toBe('INSUFFICIENT_BALANCE')
  })

  it('surfaces contract simulation failures without sending', async () => {
    chain.simulateError = 'UnlockTooSoon'
    const res = await post('/v1/deposits', await signedBody())
    expect(await errorCode(res)).toBe('SIMULATION_FAILED')
    expect(chain.sent).toEqual([])
  })

  it('rejects a duplicate while the first is pending (T14)', async () => {
    const body = await signedBody()
    expect((await post('/v1/deposits', body)).status).toBe(200)
    expect(await errorCode(await post('/v1/deposits', body))).toBe('DUPLICATE_PENDING')
    expect(chain.sent).toEqual(['deposit'])
  })

  it('rate limits at 5 deposits per owner per day (T11)', async () => {
    for (let n = 0n; n < 5n; n++) {
      chain.lockNonces.set(owner.address, n)
      expect((await post('/v1/deposits', await signedBody({ nonce: n }))).status).toBe(200)
    }
    chain.lockNonces.set(owner.address, 5n)
    expect(await errorCode(await post('/v1/deposits', await signedBody({ nonce: 5n })))).toBe('RATE_LIMITED')
  })

  it('rejects malformed bodies', async () => {
    expect(await errorCode(await post('/v1/deposits', { intent: {} }))).toBe('BAD_REQUEST')
    const res = await app.request('/v1/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'nope' })
    expect(await errorCode(res)).toBe('BAD_REQUEST')
    const big = await app.request('/v1/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(9000) })
    expect(big.status).toBe(413)
  })
})

describe('POST /v1/withdrawals', () => {
  beforeEach(() => {
    chain.locks = [{ owner: owner.address, amount: 5_000_000n, unlockAt: NOW + 100n, withdrawn: false }]
  })

  it('refuses early withdrawal with the unlock time (T4)', async () => {
    const res = await post('/v1/withdrawals', { lockId: '0' })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string; data: { unlockAt: string } } }
    expect(body.error.code).toBe('STILL_LOCKED')
    expect(body.error.data.unlockAt).toBe((NOW + 100n).toString())
    expect(chain.sent).toEqual([])
  })

  it('relays a ripe withdrawal', async () => {
    chain.time = NOW + 100n
    expect((await post('/v1/withdrawals', { lockId: '0' })).status).toBe(200)
    expect(chain.sent).toEqual(['withdraw'])
  })

  it('rejects unknown and already withdrawn locks', async () => {
    expect(await errorCode(await post('/v1/withdrawals', { lockId: '7' }))).toBe('LOCK_NOT_FOUND')
    chain.locks[0]!.withdrawn = true
    expect(await errorCode(await post('/v1/withdrawals', { lockId: '0' }))).toBe('ALREADY_WITHDRAWN')
  })
})

describe('withdrawals from an earlier contract', () => {
  const LEGACY = '0x2222222222222222222222222222222222222222' as Address
  let legacy: FakeChain
  beforeEach(() => {
    legacy = new FakeChain()
    legacy.lockAddress = LEGACY
    legacy.locks = [{ owner: owner.address, amount: 1_000_000n, unlockAt: NOW - 1n, withdrawn: false }]
    const service = new RelayerService(chain, { ...defaultConfig, maxLockAmount: 10_000_000n, dailyGasBudgetWei: 10n ** 18n, lowBalanceWei: 10n ** 18n }, () => {}, Date.now, [legacy])
    app = createApp(service, { allowedOrigins: [] })
  })

  it('routes a withdrawal to the named legacy contract', async () => {
    const res = await post('/v1/withdrawals', { lockId: '0', contract: LEGACY })
    expect(res.status).toBe(200)
    expect(legacy.sent).toEqual(['withdraw'])
    expect(chain.sent).toEqual([])
  })

  it('refuses a contract it does not know', async () => {
    const res = await post('/v1/withdrawals', { lockId: '0', contract: '0x3333333333333333333333333333333333333333' })
    expect(await errorCode(res)).toBe('BAD_REQUEST')
    expect(legacy.sent).toEqual([])
  })

  it('keeps the current contract as the default', async () => {
    chain.locks = [{ owner: owner.address, amount: 1_000_000n, unlockAt: NOW - 1n, withdrawn: false }]
    expect((await post('/v1/withdrawals', { lockId: '0' })).status).toBe(200)
    expect(chain.sent).toEqual(['withdraw'])
  })
})

describe('GET /v1/health', () => {
  it('reports status without secrets', async () => {
    const res = await app.request('/v1/health')
    const body = (await res.json()) as Record<string, string>
    expect(body.status).toBe('ok')
    expect(body.blockNumber).toBe('42')
    expect(JSON.stringify(body)).not.toMatch(/key/i)
  })
})
