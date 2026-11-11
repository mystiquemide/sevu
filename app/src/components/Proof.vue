<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft, ExternalLink } from 'lucide-vue-next'
import { config } from '../config'
import { formatUsdt } from '../lib/format'
import { readProof, type ProofStats } from '../lib/proof'
import { ADMIN_PROBES, pickTarget, probeMissing, strangerWithdraw, type Target, type WithdrawResult } from '../lib/challenge'
import { formatDate, shortAddress } from '../lib/format'

defineEmits<{ back: [] }>()

const stats = ref<(ProofStats & { contractTotal: bigint }) | null>(null)
const failed = ref(false)
// The free-locking service is the one part Sevu runs; show whether it is up. The contract works without it.
const service = ref<{ ok: boolean; low?: boolean; block?: string } | null>(null)
async function checkService() {
  try {
    const r = await fetch(`${config.relayerUrl}/v1/health`, { signal: AbortSignal.timeout(8000) })
    const j = (await r.json()) as { status?: string; blockNumber?: string }
    // 'low' means the gas wallet needs a top-up soon; the service still answers and relays.
    service.value = { ok: r.ok && (j.status === 'ok' || j.status === 'low'), low: j.status === 'low', block: j.blockNumber }
  } catch {
    service.value = { ok: false }
  }
}

async function load() {
  failed.value = false
  try {
    stats.value = await readProof()
  } catch {
    failed.value = true
  }
}
// "Try to break it": anyone, with no wallet, asks the live contract to break its own rules. Nothing is sent.
const running = ref(false)
const ran = ref(false)
const challengeFailed = ref(false)
const target = ref<Target | null>(null)
const attempt = ref<WithdrawResult | null>(null)
const probes = ref<{ name: string; missing: boolean }[]>([])
async function runChallenge() {
  running.value = true
  challengeFailed.value = false
  try {
    target.value = await pickTarget()
    attempt.value = target.value ? await strangerWithdraw(target.value) : null
    const at = config.lockAddress!
    probes.value = await Promise.all(ADMIN_PROBES.map(async (p) => ({ name: p.name, missing: await probeMissing(at, p.data) })))
    ran.value = true
  } catch {
    challengeFailed.value = true
  } finally {
    running.value = false
  }
}

onMounted(() => { void load(); void checkService() })

const scan = (a: string) => `https://polygonscan.com/address/${a}`
const tx = (h: string) => `https://polygonscan.com/tx/${h}`

const evidence = [
  { title: 'Contract source matches', body: 'SevuLock source is published and matched on Sourcify. No owner, admin, pause or upgrade function exists.',
    href: `https://repo.sourcify.dev/137/${config.lockAddress}` },
  { title: 'Contract deployed', body: 'The final SevuLock deployment on Polygon.',
    href: tx('0xb8a6255c2ee9a452587e5b059d1a0212988bb762be65126c734f41340ce282c8') },
  { title: 'First gasless lock', body: '1 USDT locked from Nimiq Pay with no gas paid by the saver. The relayer submitted it.',
    href: tx('0xc0e32301ec752ef22dbd47f74041c5da02b68b348aeabc0cbfecf00a32d2aa10') },
  { title: 'NIM stake from Nimiq Pay', body: '100 NIM staked on Nimiq mainnet from inside the mini app, tracked by a jar.',
    href: 'https://nimiq.watch/#NQ202U0VY927PC3M33GME96Y1J2RRL3P8CVD' },
]
</script>

<template>
  <section class="section enter">
    <button class="link plain back" @click="$emit('back')"><ArrowLeft :size="16" aria-hidden="true" />Back</button>
    <div class="group">
      <h1 class="page-title">Proof</h1>
      <p class="secondary">Every number here is read live from the Sevu contracts on Polygon. Nothing is cached or typed in by hand.</p>
    </div>

    <p v-if="failed" class="notice error" role="alert"><strong>Could not reach Polygon</strong>Check your connection and try again.</p>
    <button v-if="failed" class="btn secondary" @click="load">Try again</button>

    <div v-else class="stats" aria-live="polite">
      <div v-for="s in [
        { label: 'Locks', value: stats?.locks.toLocaleString('en-US') },
        { label: 'Savers', value: stats?.owners.toLocaleString('en-US') },
        { label: 'Locked now', value: stats && `${formatUsdt(stats.locked)} USDT` },
        { label: 'Withdrawn', value: stats && `${formatUsdt(stats.withdrawn)} USDT` },
      ]" :key="s.label" class="card stat">
        <p class="label">{{ s.label }}</p>
        <p v-if="stats" class="num value">{{ s.value }}</p>
        <div v-else class="skeleton" style="height: 28px; width: 70%" />
      </div>
    </div>
    <p v-if="stats" class="meta">
      Contract totalLocked: {{ formatUsdt(stats.contractTotal) }} USDT{{ stats.contractTotal === stats.locked ? ', matches' : ', differs from the sum of locks' }}
    </p>

    <div v-if="service" class="card status" role="status">
      <span class="dot" :class="{ ok: service.ok }" aria-hidden="true" />
      <p class="small">
        <strong>{{ !service.ok ? 'Free locking service is not responding' : service.low ? 'Free locking service is online, gas running low' : 'Free locking service is online' }}</strong>
        <span class="secondary">{{ service.ok ? `Polygon block ${Number(service.block).toLocaleString('en-US')}` : 'Existing locks are safe. You can still withdraw directly from the contract.' }}</span>
      </p>
    </div>

    <div class="card group challenge">
      <div class="stack">
        <h2 class="section-title">Try to break it</h2>
        <p class="secondary small">Ask the live contract to release a sealed lock early to a stranger, and to run the admin functions a custodial app would have. Nothing is sent and no wallet is needed.</p>
      </div>
      <button class="btn" :disabled="running" @click="runChallenge">{{ running ? 'Asking the contract' : ran ? 'Run again' : 'Run the checks' }}</button>
      <p v-if="challengeFailed" class="notice error" role="alert"><strong>Could not reach Polygon</strong>Check your connection and run the checks again.</p>
      <ul v-if="ran" class="results" aria-live="polite">
        <li v-if="target && attempt">
          <span class="mark ok" aria-hidden="true" />
          <span>
            <strong>A stranger withdraws lock #{{ target.id }} ({{ formatUsdt(target.amount) }} USDT)</strong>
            <span v-if="attempt.kind === 'refused'" class="secondary">Refused by the contract: {{ attempt.reason }}. It opens {{ formatDate(target.unlockAt) }}.</span>
            <span v-else class="secondary">Allowed after the unlock date, and the contract can only pay the owner {{ shortAddress(target.owner) }}. The stranger gets nothing.</span>
          </span>
        </li>
        <li v-else><span class="mark ok" aria-hidden="true" /><span class="secondary">No sealed locks right now, so there is nothing to withdraw.</span></li>
        <li v-for="p in probes" :key="p.name">
          <span class="mark" :class="p.missing ? 'ok' : 'warn'" aria-hidden="true" />
          <span><strong class="mono">{{ p.name }}</strong><span class="secondary">{{ p.missing ? 'Does not exist on SevuLock' : 'Answered. Check this function on Sourcify' }}</span></span>
        </li>
      </ul>
    </div>

    <div class="group">
      <h2 class="section-title">On-chain evidence</h2>
      <a v-for="e in evidence" :key="e.title" class="card evidence" :href="e.href" target="_blank" rel="noopener">
        <span class="stack">
          <strong class="etitle">{{ e.title }}</strong>
          <span class="secondary small">{{ e.body }}</span>
        </span>
        <ExternalLink :size="16" aria-hidden="true" class="muted" />
      </a>
    </div>

    <div class="group">
      <h2 class="section-title">Contracts</h2>
      <a class="meta addr" :href="scan(config.lockAddress ?? '')" target="_blank" rel="noopener">SevuLock {{ config.lockAddress }}</a>
      <a v-for="a in config.legacyLocks" :key="a" class="meta addr" :href="scan(a)" target="_blank" rel="noopener">Earlier SevuLock {{ a }}</a>
    </div>
  </section>
</template>

<style scoped>
.challenge { padding: 20px; }
.results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.results li { display: flex; gap: 12px; align-items: flex-start; }
.results li > span:last-child { display: flex; flex-direction: column; font-size: 14px; line-height: 20px; }
.results strong { font-weight: 500; }
.mono { font-family: var(--mono); font-size: 13px; }
.mark { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: none; background: var(--danger); }
.mark.ok { background: var(--ready); }
.status { display: flex; gap: 12px; align-items: flex-start; padding: 16px; }
.status p { display: flex; flex-direction: column; }
.status strong { font-weight: 500; }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: var(--danger); flex: none; }
.dot.ok { background: var(--ready); }
.back { align-self: flex-start; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stat { padding: 16px; display: flex; flex-direction: column; gap: 4px; }
.value { font-size: 22px; line-height: 28px; letter-spacing: -0.01em; }
.evidence { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; text-decoration: none; min-height: 44px; }
.etitle { font-weight: 500; }
.addr { word-break: break-all; min-height: 44px; display: flex; align-items: center; }
</style>
