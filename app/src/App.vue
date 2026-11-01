<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Address } from 'viem'
import CreateLock from './components/CreateLock.vue'
import Envelope from './components/Envelope.vue'
import LockDetail from './components/LockDetail.vue'
import LockRow from './components/LockRow.vue'
import Rescue from './components/Rescue.vue'
import Wordmark from './components/Wordmark.vue'
import { chainTime, locksOf, usdtBalance, type LockRecord } from './lib/chain'
import { friendlyError, type FriendlyError } from './lib/errors'
import { formatUsdt, shortAddress } from './lib/format'
import { lockProgress, lockStatus, lockTitle, statusLabel } from './lib/lockView'
import { connect, evmProvider } from './lib/wallet'

type View = 'loading' | 'outside' | 'error' | 'home' | 'create' | 'detail' | 'rescue'

const view = ref<View>('loading')
const owner = ref<Address | null>(null)
const balance = ref(0n)
const locks = ref<LockRecord[]>([])
const loaded = ref(false)
const error = ref<FriendlyError | null>(null)
const refreshing = ref(false)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const selectedId = ref<bigint | null>(null)
const metaVersion = ref(0)
// Chain time is the source of truth; keep an offset so countdowns tick locally between reads.
const offset = ref(0)
const now = ref(Math.floor(Date.now() / 1000))
let timer: ReturnType<typeof setInterval> | undefined

// Ready locks first, then by unlock date.
const active = computed(() =>
  locks.value
    .filter((l) => !l.withdrawn)
    .sort((a, b) => {
      const ra = lockStatus(a, now.value) === 'ripe' ? 0 : 1
      const rb = lockStatus(b, now.value) === 'ripe' ? 0 : 1
      return ra - rb || Number(a.unlockAt - b.unlockAt)
    }),
)
const featured = computed(() => active.value[0] ?? null)
const others = computed(() => active.value.slice(1))
const history = computed(() => locks.value.filter((l) => l.withdrawn))
const totalLocked = computed(() => active.value.reduce((sum, l) => sum + l.amount, 0n))
const readyCount = computed(() => active.value.filter((l) => lockStatus(l, now.value) === 'ripe').length)
const selected = computed(() => locks.value.find((l) => l.id === selectedId.value) ?? null)

function featuredLabel(l: LockRecord) {
  return `${lockTitle(l)}: ${formatUsdt(l.amount)} USDT, ${statusLabel[lockStatus(l, now.value)]}`
}

async function refresh() {
  if (!owner.value) return
  refreshing.value = true
  try {
    const [b, l, t] = await Promise.all([usdtBalance(owner.value), locksOf(owner.value), chainTime()])
    balance.value = b
    locks.value = l
    offset.value = Number(t) - Math.floor(Date.now() / 1000)
    now.value = Number(t)
    loaded.value = true
    error.value = null
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    refreshing.value = false
  }
}

function route() {
  if (!owner.value) return
  if (location.hash === '#/rescue') {
    view.value = 'rescue'
    void refresh()
  } else if (view.value === 'rescue') view.value = 'home'
}

function go(v: View) {
  if (v === 'rescue') {
    // Rescue decisions depend on chain time, so always re-read before showing it.
    if (location.hash !== '#/rescue') location.hash = '#/rescue'
    void refresh()
  } else if (location.hash) window.history.replaceState(null, '', location.pathname)
  view.value = v
  window.scrollTo({ top: 0 })
}

function open(l: LockRecord) {
  selectedId.value = l.id
  go('detail')
}

async function start() {
  if (!evmProvider()) {
    view.value = 'outside'
    return
  }
  view.value = 'loading'
  try {
    owner.value = await connect()
    view.value = location.hash === '#/rescue' ? 'rescue' : 'home'
    await refresh()
  } catch (e) {
    error.value = friendlyError(e)
    view.value = 'error'
  }
}

async function afterCreate() {
  go('home')
  metaVersion.value++
  await refresh()
}

async function changed() {
  metaVersion.value++
  await refresh()
}

const setOnline = () => (online.value = navigator.onLine)

onMounted(() => {
  // Nimiq Pay injects the provider before page scripts run; allow a moment on slow devices.
  setTimeout(start, evmProvider() ? 0 : 600)
  timer = setInterval(() => (now.value = Math.floor(Date.now() / 1000) + offset.value), 1000)
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  window.addEventListener('hashchange', route)
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  window.removeEventListener('hashchange', route)
})
</script>

<template>
  <header class="top row">
    <Wordmark />
    <span v-if="owner" class="meta">{{ shortAddress(owner) }}</span>
  </header>

  <p v-if="!online" class="notice plain offline" role="status">You are offline. Amounts may be out of date.</p>

  <main>
    <div v-if="view === 'loading'" class="section" role="status" aria-label="Connecting to your wallet">
      <div class="skeleton" style="height: 72px; width: 60%" />
      <div class="skeleton" style="height: 232px" />
    </div>

    <section v-else-if="view === 'outside'" class="section enter">
      <div class="group">
        <h1 class="page-title">Savings nobody can touch, not even us</h1>
        <p class="secondary">Lock USDT until a date you choose. It sits in a public contract with no owner and no admin, so nobody can move it early. Locking is free.</p>
      </div>
      <Envelope :amount="50_000_000n" :unlock-at="now + 30 * 86_400" title="Rent" :now="now" :progress="0.35" />
      <div class="card stack">
        <h2 class="section-title">Open Sevu in Nimiq Pay</h2>
        <p class="secondary small">Sevu runs inside Nimiq Pay, so your keys never leave your phone. Open Nimiq Pay, go to Mini Apps and choose Sevu.</p>
      </div>
    </section>

    <section v-else-if="view === 'error'" class="group enter">
      <p class="notice error" role="alert"><strong>{{ error?.title }}</strong>{{ error?.action }}</p>
      <button class="btn" @click="start">Try again</button>
    </section>

    <CreateLock v-else-if="view === 'create' && owner" :owner="owner" :balance="balance" :now="now" @done="afterCreate" @cancel="go('home')" />

    <LockDetail v-else-if="view === 'detail' && owner && selected" :key="selected.id.toString()" :lock="selected" :owner="owner" :now="now"
      @back="go('home')" @changed="changed" @rescue="go('rescue')" />

    <Rescue v-else-if="view === 'rescue' && owner" :owner="owner" :locks="locks" :now="now" @back="go('home')" @changed="changed" />

    <section v-else-if="view === 'home'" class="section">
      <div class="group">
        <div class="stack">
          <p class="label">Locked in Sevu</p>
          <p v-if="loaded" class="figure total">{{ formatUsdt(totalLocked) }}<span class="unit">USDT</span></p>
          <div v-else class="skeleton" style="height: 44px; width: 55%" />
          <p class="meta">{{ formatUsdt(balance) }} USDT available</p>
        </div>
        <button class="btn" @click="go('create')">Lock USDT</button>
      </div>

      <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong>{{ error.action }}</p>

      <div class="group">
        <div class="row">
          <h2 class="section-title">{{ readyCount ? `${readyCount} ${readyCount === 1 ? 'lock is' : 'locks are'} ready to withdraw` : 'Your locks' }}</h2>
          <button class="link" :disabled="refreshing" @click="refresh">{{ refreshing ? 'Refreshing' : 'Refresh' }}</button>
        </div>

        <template v-if="loaded">
          <div v-if="!featured" class="empty">
            <Envelope :amount="0n" :unlock-at="now + 30 * 86_400" title="Your first lock" :now="now" :stamped="false" />
            <p class="secondary small center">Nothing sealed yet. Pick an amount and a date. Two signatures, no network fee.</p>
          </div>
          <button v-else class="featured" type="button" :aria-label="featuredLabel(featured)" @click="open(featured)">
            <Envelope :key="`${featured.id}-${metaVersion}`" :amount="featured.amount" :unlock-at="featured.unlockAt" :title="lockTitle(featured)"
              :status="lockStatus(featured, now)" :now="now" :progress="lockProgress(featured, now)" />
          </button>
          <div v-if="others.length" class="list card">
            <LockRow v-for="l in others" :key="l.id.toString()" :lock="l" :now="now" :version="metaVersion" @open="open(l)" />
          </div>
        </template>
        <div v-else class="skeleton" style="height: 232px" />
      </div>

      <details v-if="history.length" class="history">
        <summary>History ({{ history.length }})</summary>
        <div class="list card">
          <LockRow v-for="l in history" :key="l.id.toString()" :lock="l" :now="now" :version="metaVersion" @open="open(l)" />
        </div>
      </details>

      <footer class="foot">
        <p class="meta">No owner. No admin. No upgrades.</p>
        <a class="link" href="#/rescue" @click.prevent="go('rescue')">Withdraw directly</a>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.top { min-height: 44px; margin-bottom: 24px; }
.offline { margin-bottom: 16px; }
.featured { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; border-radius: var(--r-card); transition: transform 150ms var(--ease); }
.featured:active { transform: scale(0.98); }
.empty { display: flex; flex-direction: column; gap: 12px; }
.empty :deep(.envelope) { opacity: 0.6; box-shadow: none; }
.center { text-align: center; }
.list { padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.history summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; color: var(--text-2); }
.history .list { margin-top: 8px; }
.foot { display: flex; flex-direction: column; align-items: center; gap: 4px; }
</style>
