import type { Address, Hash, Hex } from 'viem'

export interface LockView {
  owner: Address
  amount: bigint
  unlockAt: bigint
  withdrawn: boolean
}

export interface DepositCall {
  intent: { owner: Address; amount: bigint; unlockAt: bigint; nonce: bigint; deadline: bigint }
  intentSig: Hex
  permit: { deadline: bigint; v: number; r: Hex; s: Hex }
}

export interface SentTx {
  hash: Hash
  /** Upper bound on the POL this tx can cost (gas limit times max fee). */
  maxCostWei: bigint
}

/** Everything the relayer needs from Polygon. The production adapter lives in viemChain.ts. */
export interface ChainPort {
  lockAddress: Address
  tokenAddress: Address
  now(): Promise<bigint>
  lockNonce(owner: Address): Promise<bigint>
  tokenNonce(owner: Address): Promise<bigint>
  tokenBalance(owner: Address): Promise<bigint>
  getLock(lockId: bigint): Promise<LockView | null>
  /** Resolves when the call would succeed, rejects with a SimulationError otherwise. */
  simulateDeposit(call: DepositCall): Promise<void>
  sendDeposit(call: DepositCall): Promise<SentTx>
  simulateWithdraw(lockId: bigint): Promise<void>
  sendWithdraw(lockId: bigint): Promise<SentTx>
  waitForReceipt(hash: Hash): Promise<void>
  relayerBalance(): Promise<bigint>
  blockNumber(): Promise<bigint>
}

export class SimulationError extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

export class ChainUnavailableError extends Error {}
