/**
 * Runs the real HTTP app and viem adapter against SevuLock deployed on an anvil fork of Polygon.
 * Requires anvil on PATH, a built contract (forge build in ../contracts) and POLYGON_RPC. Skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient, createTestClient, createWalletClient, http, encodeAbiParameters, keccak256,
  pad, toHex, parseSignature, type Address, type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'
import { createApp } from '../src/app.js'
import { RelayerService, defaultConfig } from '../src/service.js'
import { createViemChain } from '../src/viemChain.js'
import { sevuLockAbi, usdt0Abi } from '../src/abi.js'
import { lockIntentDomain, lockIntentTypes, permitTypes, usdt0Domain } from '../src/typedData.js'

const RPC = process.env.POLYGON_RPC
const PORT = 8555
const ANVIL = `http://127.0.0.1:${PORT}`
const USDT0 = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as Address
// anvil default account 0, a well-known test key with no value on mainnet.
const RELAYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const artifact = fileURLToPath(new URL('../../contracts/out/SevuLock.sol/SevuLock.json', import.meta.url))
const artifactV0 = fileURLToPath(new URL('../../contracts/out/SevuLockV0.sol/SevuLockV0.json', import.meta.url))
const ready = Boolean(RPC) && existsSync(artifact)

const chain = { ...polygon, rpcUrls: { default: { http: [ANVIL] } } }
const pub = createPublicClient({ chain, transport: http(ANVIL) })
const test = createTestClient({ chain, mode: 'anvil', transport: http(ANVIL) })
const deployer = createWalletClient({ chain, transport: http(ANVIL), account: privateKeyToAccount(RELAYER_KEY) })
const owner = privateKeyToAccount(generatePrivateKey())

let anvil: ChildProcess | undefined
let lock: Address
let legacyLock: Address
let app: ReturnType<typeof createApp>

async function waitForAnvil() {
  for (let i = 0; i < 100; i++) {
    try { await pub.getBlockNumber(); return } catch { await new Promise((r) => setTimeout(r, 200)) }
  }
  throw new Error('anvil did not start')
}

/** Writes a USDT0 balance by locating the balances mapping slot. */
async function dealUsdt0(to: Address, amount: bigint) {
  for (let slot = 0n; slot < 20n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [to, slot]))
    await test.setStorageAt({ address: USDT0, index: key, value: pad(toHex(amount)) })
    const bal = await pub.readContract({ address: USDT0, abi: usdt0Abi, functionName: 'balanceOf', args: [to] })
    if (bal === amount) return
    await test.setStorageAt({ address: USDT0, index: key, value: pad('0x0') })
  }
  throw new Error('USDT0 balance slot not found')
}

async function post(path: string, body: unknown) {
  const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

async function signedDeposit(amount: bigint, unlockAt: bigint) {
  const now = (await pub.getBlock()).timestamp
  const nonce = await pub.readContract({ address: lock, abi: sevuLockAbi, functionName: 'nonces', args: [owner.address] })
  const tokenNonce = await pub.readContract({ address: USDT0, abi: usdt0Abi, functionName: 'nonces', args: [owner.address] })
  const intent = { owner: owner.address, amount, unlockAt, nonce, deadline: now + 3600n }
  const intentSig = await owner.signTypedData({ domain: lockIntentDomain(lock), types: lockIntentTypes, primaryType: 'LockIntent', message: intent })
  const permitDeadline = now + 3600n
  const { v, r, s } = parseSignature(await owner.signTypedData({
    domain: usdt0Domain(USDT0), types: permitTypes, primaryType: 'Permit',
    message: { owner: owner.address, spender: lock, value: amount, nonce: tokenNonce, deadline: permitDeadline },
  }))
  const str = (x: bigint) => x.toString()
  return {
    intent: { owner: owner.address, amount: str(amount), unlockAt: str(unlockAt), nonce: str(nonce), deadline: str(intent.deadline) },
    intentSig,
    permit: { value: str(amount), deadline: str(permitDeadline), v: Number(v), r, s },
  }
}

describe.skipIf(!ready)('relayer against SevuLock on a Polygon fork', () => {
  beforeAll(async () => {
    anvil = spawn('anvil', ['--fork-url', RPC!, '--port', String(PORT), '--silent'], { stdio: 'ignore' })
    await waitForAnvil()
    const { bytecode } = JSON.parse(readFileSync(artifact, 'utf8')) as { bytecode: { object: Hex } }
    const hash = await deployer.deployContract({
      abi: [{ type: 'constructor', inputs: [{ name: 'token_', type: 'address' }], stateMutability: 'nonpayable' }],
      bytecode: bytecode.object,
      args: [USDT0],
    })
    lock = (await pub.waitForTransactionReceipt({ hash })).contractAddress!
    const v0 = JSON.parse(readFileSync(artifactV0, 'utf8')) as { bytecode: { object: Hex } }
    const h0 = await deployer.deployContract({
      abi: [{ type: 'constructor', inputs: [{ name: 'token_', type: 'address' }], stateMutability: 'nonpayable' }],
      bytecode: v0.bytecode.object,
      args: [USDT0],
    })
    legacyLock = (await pub.waitForTransactionReceipt({ hash: h0 })).contractAddress!
    await dealUsdt0(owner.address, 50_000_000n)

    const service = new RelayerService(
      createViemChain({ rpcUrls: [ANVIL], privateKey: RELAYER_KEY, lockAddress: lock, tokenAddress: USDT0, chain }),
      { ...defaultConfig, maxLockAmount: 10_000_000n, dailyGasBudgetWei: 10n ** 20n, lowBalanceWei: 10n ** 18n },
      () => {},
      Date.now,
      [createViemChain({ rpcUrls: [ANVIL], privateKey: RELAYER_KEY, lockAddress: legacyLock, tokenAddress: USDT0, chain, format: 'v0' })],
    )
    app = createApp(service, { allowedOrigins: [] })
  }, 60_000)

  afterAll(() => { anvil?.kill() })

  it('owner holds USDT0 and no POL', async () => {
    expect(await pub.getBalance({ address: owner.address })).toBe(0n)
  })

  it('relays a gasless deposit, refuses early withdrawal, then withdraws to the owner', async () => {
    const now = (await pub.getBlock()).timestamp
    const unlockAt = now + 86_400n
    const dep = await post('/v1/deposits', await signedDeposit(5_000_000n, unlockAt))
    expect(dep.status, JSON.stringify(dep.json)).toBe(200)
    const receipt = await pub.waitForTransactionReceipt({ hash: dep.json.txHash })
    expect(receipt.status).toBe('success')

    const l = await pub.readContract({ address: lock, abi: sevuLockAbi, functionName: 'getLock', args: [0n] })
    expect(l.owner).toBe(owner.address)
    expect(l.amount).toBe(5_000_000n)
    expect(l.unlockAt).toBe(unlockAt)
    expect(await pub.getBalance({ address: owner.address })).toBe(0n)

    const early = await post('/v1/withdrawals', { lockId: '0' })
    expect(early.status).toBe(409)
    expect(early.json.error.code).toBe('STILL_LOCKED')

    await test.increaseTime({ seconds: 86_401 })
    await test.mine({ blocks: 1 })
    const w = await post('/v1/withdrawals', { lockId: '0' })
    expect(w.status, JSON.stringify(w.json)).toBe(200)
    expect((await pub.waitForTransactionReceipt({ hash: w.json.txHash })).status).toBe('success')
    expect(await pub.readContract({ address: USDT0, abi: usdt0Abi, functionName: 'balanceOf', args: [owner.address] })).toBe(50_000_000n)

    const again = await post('/v1/withdrawals', { lockId: '0' })
    expect(again.json.error.code).toBe('ALREADY_WITHDRAWN')
  }, 60_000)

  it('rejects a tampered unlock date before touching the chain', async () => {
    const now = (await pub.getBlock()).timestamp
    const body = await signedDeposit(2_000_000n, now + 86_400n)
    body.intent.unlockAt = (now + 600n * 86_400n).toString()
    const res = await post('/v1/deposits', body)
    expect(res.json.error.code).toBe('BAD_INTENT_SIGNATURE')
  })

  it('rejects a corrupted permit signature off-chain', async () => {
    const now = (await pub.getBlock()).timestamp
    const body = await signedDeposit(2_000_000n, now + 86_400n)
    body.permit.s = `0x${'1'.repeat(64)}`
    const res = await post('/v1/deposits', body)
    expect(res.json.error.code).toBe('BAD_PERMIT_SIGNATURE')
  })

  it('decodes contract revert reasons in the adapter simulation', async () => {
    const adapter = createViemChain({ rpcUrls: [ANVIL], privateKey: RELAYER_KEY, lockAddress: lock, tokenAddress: USDT0, chain })
    const now = (await pub.getBlock()).timestamp
    const dep = await post('/v1/deposits', await signedDeposit(3_000_000n, now + 7n * 86_400n))
    expect(dep.status, JSON.stringify(dep.json)).toBe(200)
    await pub.waitForTransactionReceipt({ hash: dep.json.txHash })
    const id = (await pub.readContract({ address: lock, abi: sevuLockAbi, functionName: 'lockCount' })) - 1n
    await expect(adapter.simulateWithdraw(id)).rejects.toMatchObject({ reason: 'StillLocked' })
    await expect(adapter.simulateWithdraw(999n)).rejects.toMatchObject({ reason: 'NoLock' })
  }, 60_000)

  it('reads lockedAt from the final contract', async () => {
    const now = (await pub.getBlock()).timestamp
    const dep = await post('/v1/deposits', await signedDeposit(2_000_000n, now + 86_400n))
    expect(dep.status, JSON.stringify(dep.json)).toBe(200)
    const r = await pub.waitForTransactionReceipt({ hash: dep.json.txHash })
    const block = await pub.getBlock({ blockNumber: r.blockNumber })
    const id = (await pub.readContract({ address: lock, abi: sevuLockAbi, functionName: 'lockCount' })) - 1n
    const l = await pub.readContract({ address: lock, abi: sevuLockAbi, functionName: 'getLock', args: [id] })
    expect(l.lockedAt).toBe(Number(block.timestamp))
  }, 60_000)

  it('withdraws a lock from the earlier contract through the relayer', async () => {
    const ownerWallet = createWalletClient({ chain, transport: http(ANVIL), account: owner })
    await test.setBalance({ address: owner.address, value: 10n ** 18n })
    const approveAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const
    const depositAbi = [{ type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint64' }], outputs: [{ type: 'uint256' }] }] as const
    const now = (await pub.getBlock()).timestamp
    await pub.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: USDT0, abi: approveAbi, functionName: 'approve', args: [legacyLock, 1_000_000n] }) })
    await pub.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: legacyLock, abi: depositAbi, functionName: 'deposit', args: [1_000_000n, now + 600n] }) })
    const before = await pub.readContract({ address: USDT0, abi: usdt0Abi, functionName: 'balanceOf', args: [owner.address] })
    const early = await post('/v1/withdrawals', { lockId: '0', contract: legacyLock })
    expect(early.json.error.code).toBe('STILL_LOCKED')
    await test.increaseTime({ seconds: 700 })
    await test.mine({ blocks: 1 })
    const w = await post('/v1/withdrawals', { lockId: '0', contract: legacyLock })
    expect(w.status, JSON.stringify(w.json)).toBe(200)
    expect((await pub.waitForTransactionReceipt({ hash: w.json.txHash })).status).toBe('success')
    expect(await pub.readContract({ address: USDT0, abi: usdt0Abi, functionName: 'balanceOf', args: [owner.address] })).toBe(before + 1_000_000n)
  }, 60_000)

  it('reports health from the real chain', async () => {
    const res = await app.request('/v1/health')
    const body = (await res.json()) as Record<string, string>
    expect(body.status).toBe('ok')
    expect(BigInt(body.blockNumber ?? '0')).toBeGreaterThan(0n)
  })
})
