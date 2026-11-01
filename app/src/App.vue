<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Address } from 'viem'
import CreateLock from './components/CreateLock.vue'
import LockCard from './components/LockCard.vue'
import LockDetail from './components/LockDetail.vue'
import Rescue from './components/Rescue.vue'
import Wordmark from './components/Wordmark.vue'
import { chainTime, locksOf, usdtBalance, type LockRecord } from './lib/chain'
import { friendlyError, type FriendlyError } from './lib/errors'
import { formatDate, formatRemaining, formatUsdt, shortAddress } from './lib/format'
import { lockStatus } from './lib/lockView'
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

const active = computed(() =>
  locks.value
    .filter((l) => !l.withdrawn)
    .sort((a, b) => Number(a.unlockAt - b.unlockAt)),
)
const history = computed(() => locks.value.filter((l) => l.withdrawn))
const totalSealed = computed(() => active.value.reduce((sum, l) => sum + l.amount, 0n))
const readyCount = computed(() => active.value.filter((l) => lockStatus(l, now.value) === 'ripe').length)
const nextUnlock = computed(() => active.value.find((l) => lockStatus(l, now.value) === 'sealed') ?? null)
const selected = computed(() => locks.value.find((l) => l.id === selectedId.value) ?? null)

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
    <span v-if="owner" class="faint small num">{{ shortAddress(owner) }}</span>
  </header>

  <p v-if="!online" class="notice warn offline" role="status">You are offline. Balances may be out of date.</p>

  <main>
    <div v-if="view === 'loading'" class="stack" role="status" aria-label="Connecting to your wallet">
      <div class="skeleton" style="height: 150px" />
      <div class="skeleton" style="height: 52px" />
      <div class="skeleton" style="height: 76px" />
    </div>

    <section v-else-if="view === 'outside'" class="stack-lg fade-in">
      <div class="stack">
        <h1 class="hero-title">Savings nobody can touch.<br />Not even us.</h1>
        <p class="muted">Lock USDT until a date you choose. It sits in a public contract with no owner and no admin, so nobody can move it early. Locking is free.</p>
      </div>
      <div class="card stack">
        <h2>Open Sevu in Nimiq Pay</h2>
        <p class="muted">Sevu runs inside Nimiq Pay so your keys never leave your phone. Open Nimiq Pay, go to Mini Apps and choose Sevu.</p>
      </div>
    </section>

    <section v-else-if="view === 'error'" class="stack fade-in">
      <p class="notice error" role="alert"><strong>{{ error?.title }}</strong> {{ error?.action }}</p>
      <button class="btn" @click="start">Try again</button>
    </section>

    <CreateLock v-else-if="view === 'create' && owner" :owner="owner" :balance="balance" :now="now" @done="afterCreate" @cancel="go('home')" />

    <LockDetail v-else-if="view === 'detail' && owner && selected" :key="selected.id.toString()" :lock="selected" :owner="owner" :now="now"
      @back="go('home')" @changed="changed" @rescue="go('rescue')" />

    <Rescue v-else-if="view === 'rescue' && owner" :owner="owner" :locks="locks" :now="now" @back="go('home')" @changed="changed" />

    <section v-else-if="view === 'home'" class="stack-lg">
      <div class="card summary fade-in">
        <p class="muted small">Saved in Sevu</p>
        <p v-if="loaded" class="total num">{{ formatUsdt(totalSealed) }} <span class="unit">USDT</span></p>
        <div v-else class="skeleton" style="height: 44px; width: 60%" />
        <p v-if="readyCount" class="ready small">{{ readyCount }} {{ readyCount === 1 ? 'lock is' : 'locks are' }} ready to withdraw</p>
        <p v-else-if="nextUnlock" class="faint small num">Next unlock in {{ formatRemaining(Number(nextUnlock.unlockAt) - now) }} · {{ formatDate(nextUnlock.unlockAt) }}</p>
        <p class="faint small num">{{ formatUsdt(balance) }} USDT available to lock</p>
      </div>

      <button class="btn" @click="go('create')">Lock USDT</button>

      <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong> {{ error.action }}</p>

      <div class="stack">
        <div class="row">
          <h2>Your locks</h2>
          <button class="btn ghost" :disabled="refreshing" @click="refresh">{{ refreshing ? 'Refreshing...' : 'Refresh' }}</button>
        </div>
        <template v-if="loaded">
          <div v-if="!active.length" class="card empty">
            <p class="title">Nothing sealed yet</p>
            <p class="muted small">Pick an amount and a date. Two signatures, no gas, and it stays put until then.</p>
          </div>
          <LockCard v-for="l in active" :key="l.id.toString()" :lock="l" :now="now" :version="metaVersion" @open="open(l)" />
        </template>
        <div v-else class="skeleton" style="height: 76px" />
      </div>

      <details v-if="history.length" class="history">
        <summary class="label">History ({{ history.length }})</summary>
        <div class="stack">
          <LockCard v-for="l in history" :key="l.id.toString()" :lock="l" :now="now" :version="metaVersion" @open="open(l)" />
        </div>
      </details>

      <footer class="foot faint small">
        <span>No owner. No admin. No upgrades.</span>
        <a href="#/rescue" @click.prevent="go('rescue')">Withdraw directly</a>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.top { margin-bottom: 20px; }
.offline { margin-bottom: 12px; }
.hero-title { font-size: 30px; line-height: 1.15; letter-spacing: -0.03em; }
.summary { display: flex; flex-direction: column; gap: 6px; padding: 22px 20px; }
.total { font-size: 40px; font-weight: 750; letter-spacing: -0.035em; }
.unit { font-size: 20px; color: var(--ink-soft); font-weight: 650; }
.ready { color: var(--ripe); font-weight: 650; }
.empty { display: flex; flex-direction: column; gap: 4px; }
.title { font-weight: 650; }
.history summary { cursor: pointer; min-height: var(--tap); display: flex; align-items: center; }
.history .stack { margin-top: 8px; }
.foot { display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 8px; }
.foot a { min-height: var(--tap); display: inline-flex; align-items: center; }
</style>
