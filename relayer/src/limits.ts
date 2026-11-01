const DAY_MS = 24 * 60 * 60 * 1000

/** Sliding 24h counter per key. In memory: resets on restart, which only loosens limits briefly. */
export class RateLimiter {
  private hits = new Map<string, number[]>()
  constructor(private readonly max: number, private readonly windowMs = DAY_MS, private readonly clock = Date.now) {}

  private recent(key: string): number[] {
    const cutoff = this.clock() - this.windowMs
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff)
    if (list.length) this.hits.set(key, list)
    else this.hits.delete(key)
    return list
  }

  allowed(key: string): boolean {
    return this.recent(key).length < this.max
  }

  record(key: string): void {
    this.hits.set(key, [...this.recent(key), this.clock()])
  }
}

/** Daily POL budget. Reserves the worst-case cost of each tx. */
export class GasBudget {
  private spent: { at: number; wei: bigint }[] = []
  constructor(private readonly dailyWei: bigint, private readonly clock = Date.now) {}

  remaining(): bigint {
    const cutoff = this.clock() - DAY_MS
    this.spent = this.spent.filter((s) => s.at > cutoff)
    const used = this.spent.reduce((a, s) => a + s.wei, 0n)
    return used >= this.dailyWei ? 0n : this.dailyWei - used
  }

  record(wei: bigint): void {
    this.spent.push({ at: this.clock(), wei })
  }
}
