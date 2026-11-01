import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  encodeFunctionData,
  fallback,
  http,
  type Address,
  type Chain,
  type Hash,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'
import { getLockV0Abi, sevuLockAbi, usdt0Abi } from './abi.js'
import { ChainUnavailableError, SimulationError, type ChainPort, type DepositCall, type SentTx } from './chain.js'

export interface ViemChainOptions {
  rpcUrls: string[]
  privateKey: Hex
  lockAddress: Address
  tokenAddress: Address
  timeoutMs?: number
  /** Override for local forks. */
  chain?: Chain
  /** 'v0' reads the candidate contract's Lock layout, which has no lockedAt. */
  format?: 'v1' | 'v0'
}

const GAS_HEADROOM_PCT = 120n

function isRpcFailure(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false
  return Boolean(err.walk((e) => ['HttpRequestError', 'TimeoutError', 'WebSocketRequestError'].includes((e as Error).name)))
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isRpcFailure(err)) throw new ChainUnavailableError((err as Error).message.split('\n')[0])
    throw err
  }
}

function revertReason(err: unknown): string | null {
  if (!(err instanceof BaseError)) return null
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
  if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.reason ?? 'reverted'
  return null
}

export function createViemChain(opts: ViemChainOptions): ChainPort {
  const chain = opts.chain ?? polygon
  const transport = fallback(opts.rpcUrls.map((u) => http(u, { timeout: opts.timeoutMs ?? 20_000, retryCount: 1 })))
  const account = privateKeyToAccount(opts.privateKey)
  const pub = createPublicClient({ chain, transport })
  const wallet = createWalletClient({ chain, transport, account })
  const lock = { address: opts.lockAddress, abi: sevuLockAbi } as const
  const token = { address: opts.tokenAddress, abi: usdt0Abi } as const

  // One send at a time so the relayer's own tx nonces never collide.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  async function simulate(data: Hex) {
    try {
      await pub.call({ account, to: opts.lockAddress, data })
    } catch (err) {
      const reason = revertReason(err) ?? decodeRevert(err)
      if (reason) throw new SimulationError(reason)
      throw err
    }
  }

  function decodeRevert(err: unknown): string | null {
    if (!(err instanceof BaseError)) return null
    const withData = err.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: Hex } | null
    if (!withData?.data) return err.shortMessage.includes('revert') ? 'reverted' : null
    try {
      return decodeErrorResult({ abi: sevuLockAbi, data: withData.data }).errorName
    } catch {
      return 'reverted'
    }
  }

  async function send(data: Hex): Promise<SentTx> {
    return serial(async () => {
      const [gas, fees] = await Promise.all([
        pub.estimateGas({ account, to: opts.lockAddress, data }),
        pub.estimateFeesPerGas(),
      ])
      const gasLimit = (gas * GAS_HEADROOM_PCT) / 100n
      const hash = await wallet.sendTransaction({
        to: opts.lockAddress,
        data,
        gas: gasLimit,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      })
      return { hash, maxCostWei: gasLimit * fees.maxFeePerGas }
    })
  }

  const depositData = (c: DepositCall) =>
    encodeFunctionData({ abi: sevuLockAbi, functionName: 'depositWithPermit', args: [c.intent, c.intentSig, c.permit] })
  const withdrawData = (id: bigint) => encodeFunctionData({ abi: sevuLockAbi, functionName: 'withdraw', args: [id] })

  return {
    lockAddress: opts.lockAddress,
    tokenAddress: opts.tokenAddress,
    now: () => guard(async () => (await pub.getBlock({ blockTag: 'latest' })).timestamp),
    lockNonce: (owner) => guard(() => pub.readContract({ ...lock, functionName: 'nonces', args: [owner] })),
    tokenNonce: (owner) => guard(() => pub.readContract({ ...token, functionName: 'nonces', args: [owner] })),
    tokenBalance: (owner) => guard(() => pub.readContract({ ...token, functionName: 'balanceOf', args: [owner] })),
    getLock: (id) =>
      guard(async () => {
        const count = await pub.readContract({ ...lock, functionName: 'lockCount' })
        if (id >= count) return null
        const l =
          opts.format === 'v0'
            ? await pub.readContract({ address: opts.lockAddress, abi: getLockV0Abi, functionName: 'getLock', args: [id] })
            : await pub.readContract({ ...lock, functionName: 'getLock', args: [id] })
        return { owner: l.owner, amount: l.amount, unlockAt: l.unlockAt, withdrawn: l.withdrawn }
      }),
    simulateDeposit: (c) => guard(() => simulate(depositData(c))),
    sendDeposit: (c) => guard(() => send(depositData(c))),
    simulateWithdraw: (id) => guard(() => simulate(withdrawData(id))),
    sendWithdraw: (id) => guard(() => send(withdrawData(id))),
    waitForReceipt: async (hash: Hash) => {
      await pub.waitForTransactionReceipt({ hash, timeout: 5 * 60_000 })
    },
    relayerBalance: () => guard(() => pub.getBalance({ address: account.address })),
    blockNumber: () => guard(() => pub.getBlockNumber()),
  }
}
