import { verifyTypedData, type Hash } from 'viem'
import { RelayError } from './errors.js'
import type { ChainPort } from './chain.js'
import { SimulationError } from './chain.js'
import { GasBudget, RateLimiter } from './limits.js'
import { lockIntentDomain, lockIntentTypes, permitTypes, usdt0Domain } from './typedData.js'
import type { DepositRequest } from './validate.js'

export interface RelayerConfig {
  chainId: number
  minLockAmount: bigint
  maxLockAmount: bigint
  minDurationSec: bigint
  maxDurationSec: bigint
  /** Extra seconds required beyond the contract minimum so the tx can still land in time. */
  inclusionMarginSec: bigint
  maxDepositsPerDay: number
  maxWithdrawalsPerDay: number
  dailyGasBudgetWei: bigint
  lowBalanceWei: bigint
  pendingTtlMs: number
}

export const defaultConfig: Omit<RelayerConfig, 'maxLockAmount' | 'dailyGasBudgetWei' | 'lowBalanceWei'> = {
  chainId: 137,
  minLockAmount: 1_000_000n,
  minDurationSec: 300n,
  maxDurationSec: 730n * 86_400n,
  inclusionMarginSec: 60n,
  maxDepositsPerDay: 5,
  maxWithdrawalsPerDay: 10,
  pendingTtlMs: 10 * 60 * 1000,
}

/** A signature that cannot even be parsed or recovered is a mismatch, not a server error. */
async function verifies(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check()
  } catch {
    return false
  }
}

export type Logger = (event: Record<string, unknown>) => void

export class RelayerService {
  private readonly deposits: RateLimiter
  private readonly withdrawals: RateLimiter
  private readonly budget: GasBudget
  private readonly pending = new Map<string, number>()

  constructor(
    private readonly chain: ChainPort,
    private readonly cfg: RelayerConfig,
    private readonly log: Logger = () => {},
    private readonly clock: () => number = Date.now,
  ) {
    this.deposits = new RateLimiter(cfg.maxDepositsPerDay, undefined, clock)
    this.withdrawals = new RateLimiter(cfg.maxWithdrawalsPerDay, undefined, clock)
    this.budget = new GasBudget(cfg.dailyGasBudgetWei, clock)
  }

  async deposit(req: DepositRequest): Promise<{ txHash: Hash }> {
    const { intent, permit } = req
    const owner = intent.owner

    if (intent.amount < this.cfg.minLockAmount || intent.amount > this.cfg.maxLockAmount) {
      throw new RelayError('AMOUNT_OUT_OF_RANGE', 'Amount is outside the allowed range', {
        min: this.cfg.minLockAmount.toString(),
        max: this.cfg.maxLockAmount.toString(),
      })
    }
    if (permit.value !== intent.amount) {
      throw new RelayError('BAD_REQUEST', 'Permit value must equal the lock amount')
    }

    const now = await this.chain.now()
    const margin = this.cfg.inclusionMarginSec
    if (intent.deadline <= now + margin) throw new RelayError('INTENT_EXPIRED', 'Lock request expired, sign again')
    if (permit.deadline <= now + margin) throw new RelayError('PERMIT_EXPIRED', 'Permit expired, sign again')
    if (intent.unlockAt < now + this.cfg.minDurationSec + margin || intent.unlockAt > now + this.cfg.maxDurationSec) {
      throw new RelayError('UNLOCK_OUT_OF_RANGE', 'Unlock date is outside the allowed range')
    }

    const key = `deposit:${owner}:${intent.nonce}`
    this.claimPending(key)
    let sent = false
    try {
      if (!this.deposits.allowed(owner)) throw new RelayError('RATE_LIMITED', 'Too many locks today, try again tomorrow')
      this.requireBudget()

      const intentOk = await verifies(() => verifyTypedData({
        address: owner,
        domain: lockIntentDomain(this.chain.lockAddress, this.cfg.chainId),
        types: lockIntentTypes,
        primaryType: 'LockIntent',
        message: intent,
        signature: req.intentSig,
      }))
      if (!intentOk) throw new RelayError('BAD_INTENT_SIGNATURE', 'Lock signature does not match the owner')

      const [lockNonce, tokenNonce, balance] = await Promise.all([
        this.chain.lockNonce(owner),
        this.chain.tokenNonce(owner),
        this.chain.tokenBalance(owner),
      ])
      if (lockNonce !== intent.nonce) {
        throw new RelayError('NONCE_MISMATCH', 'Lock request is stale, refresh and sign again', {
          expected: lockNonce.toString(),
        })
      }

      const permitOk = await verifies(() => verifyTypedData({
        address: owner,
        domain: usdt0Domain(this.chain.tokenAddress),
        types: permitTypes,
        primaryType: 'Permit',
        message: { owner, spender: this.chain.lockAddress, value: permit.value, nonce: tokenNonce, deadline: permit.deadline },
        signature: { v: BigInt(permit.v), r: permit.r, s: permit.s },
      }))
      if (!permitOk) throw new RelayError('BAD_PERMIT_SIGNATURE', 'Permit signature does not match the owner')
      if (balance < intent.amount) throw new RelayError('INSUFFICIENT_BALANCE', 'Not enough USDT for this lock')

      const call = { intent, intentSig: req.intentSig, permit: { deadline: permit.deadline, v: permit.v, r: permit.r, s: permit.s } }
      await this.simulate(() => this.chain.simulateDeposit(call))
      const tx = await this.chain.sendDeposit(call)
      sent = true
      this.deposits.record(owner)
      this.budget.record(tx.maxCostWei)
      this.releaseOnReceipt(key, tx.hash)
      this.log({ event: 'deposit_sent', owner, amount: intent.amount.toString(), txHash: tx.hash })
      return { txHash: tx.hash }
    } finally {
      if (!sent) this.pending.delete(key)
    }
  }

  async withdraw(lockId: bigint): Promise<{ txHash: Hash }> {
    const lock = await this.chain.getLock(lockId)
    if (!lock) throw new RelayError('LOCK_NOT_FOUND', 'No lock with this id')
    if (lock.withdrawn) throw new RelayError('ALREADY_WITHDRAWN', 'This lock was already withdrawn')
    const now = await this.chain.now()
    if (now < lock.unlockAt) {
      throw new RelayError('STILL_LOCKED', 'This lock is still sealed', { unlockAt: lock.unlockAt.toString() })
    }

    const key = `withdraw:${lockId}`
    this.claimPending(key)
    let sent = false
    try {
      if (!this.withdrawals.allowed(lock.owner)) throw new RelayError('RATE_LIMITED', 'Too many withdrawals today, use the rescue page')
      this.requireBudget()
      await this.simulate(() => this.chain.simulateWithdraw(lockId))
      const tx = await this.chain.sendWithdraw(lockId)
      sent = true
      this.withdrawals.record(lock.owner)
      this.budget.record(tx.maxCostWei)
      this.releaseOnReceipt(key, tx.hash)
      this.log({ event: 'withdraw_sent', lockId: lockId.toString(), owner: lock.owner, txHash: tx.hash })
      return { txHash: tx.hash }
    } finally {
      if (!sent) this.pending.delete(key)
    }
  }

  async health() {
    const [balance, block] = await Promise.all([this.chain.relayerBalance(), this.chain.blockNumber()])
    return {
      status: balance < this.cfg.lowBalanceWei ? 'low' : 'ok',
      blockNumber: block.toString(),
      budgetRemainingWei: this.budget.remaining().toString(),
    }
  }

  private claimPending(key: string) {
    const until = this.pending.get(key)
    if (until !== undefined && until > this.clock()) {
      throw new RelayError('DUPLICATE_PENDING', 'This request is already being processed')
    }
    this.pending.set(key, this.clock() + this.cfg.pendingTtlMs)
  }

  private releaseOnReceipt(key: string, hash: Hash) {
    this.chain.waitForReceipt(hash).then(
      () => this.pending.delete(key),
      (err) => this.log({ event: 'receipt_unknown', txHash: hash, error: String(err) }),
    )
  }

  private requireBudget() {
    if (this.budget.remaining() === 0n) throw new RelayError('BUDGET_EXHAUSTED', 'Relayer is paused for today, use the rescue page')
  }

  private async simulate(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (err) {
      if (err instanceof SimulationError) {
        throw new RelayError('SIMULATION_FAILED', 'The contract would reject this request', { reason: err.reason })
      }
      throw err
    }
  }
}
