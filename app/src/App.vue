<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Address } from 'viem'
import CreateLock from './components/CreateLock.vue'
import LockCard from './components/LockCard.vue'
import { chainTime, locksOf, usdtBalance, type LockRecord } from './lib/chain'
import { friendlyError, type FriendlyError } from './lib/errors'
import { formatUsdt, shortAddress } from './lib/format'
import { connect, evmProvider } from './lib/wallet'

type View = 'loading' | 'outside' | 'error' | 'home' | 'create'

const view = ref<View>('loading')
const owner = ref<Address | null>(null)
const balance = ref(0n)
const locks = ref<LockRecord[]>([])
const error = ref<FriendlyError | null>(null)
const refreshing = ref(false)
// Chain time is the source of truth; we keep an offset so the countdown ticks locally.
const offset = ref(0)
const now = ref(Math.floor(Date.now() / 1000))
let timer: ReturnType<typeof setInterval> | undefined

const totalSealed = computed(() =>
  locks.value.filter((l) => !l.withdrawn).reduce((sum, l) => sum + l.amount, 0n),
)

async function refresh() {
  if (!owner.value) return
  refreshing.value = true
  try {
    const [b, l, t] = await Promise.all([usdtBalance(owner.value), locksOf(owner.value), chainTime()])
    balance.value = b
    locks.value = l
    offset.value = Number(t) - Math.floor(Date.now() / 1000)
    error.value = null
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    refreshing.value = false
  }
}

async function start() {
  if (!evmProvider()) {
    view.value = 'outside'
    return
  }
  view.value = 'loading'
  try {
    owner.value = await connect()
    await refresh()
    view.value = 'home'
  } catch (e) {
    error.value = friendlyError(e)
    view.value = 'error'
  }
}

async function onDone() {
  view.value = 'home'
  await refresh()
}

onMounted(() => {
  // Nimiq Pay injects the provider before the page script runs, but give it a moment on slow devices.
  setTimeout(start, evmProvider() ? 0 : 600)
  timer = setInterval(() => (now.value = Math.floor(Date.now() / 1000) + offset.value), 1000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <header class="top">
    <h1>Sevu</h1>
    <p class="muted">Savings nobody can touch. Not even us.</p>
  </header>

  <main>
    <p v-if="view === 'loading'" class="muted" role="status">Connecting to your wallet...</p>

    <section v-else-if="view === 'outside'" class="card stack">
      <h2>Open Sevu in Nimiq Pay</h2>
      <p class="muted">Sevu runs inside the Nimiq Pay app so your keys never leave your phone. Open Nimiq Pay, go to Mini Apps and choose Sevu.</p>
    </section>

    <section v-else-if="view === 'error'" class="stack">
      <p class="notice error" role="alert"><strong>{{ error?.title }}</strong> {{ error?.action }}</p>
      <button class="btn" @click="start">Try again</button>
    </section>

    <CreateLock
      v-else-if="view === 'create' && owner"
      :owner="owner"
      :balance="balance"
      :now="now"
      @done="onDone"
      @cancel="view = 'home'"
    />

    <section v-else-if="view === 'home'" class="stack">
      <div class="card summary">
        <p class="muted">Sealed savings</p>
        <p class="total num">{{ formatUsdt(totalSealed) }} <span class="muted">USDT</span></p>
        <p class="muted small num">Wallet {{ owner ? shortAddress(owner) : '' }} · {{ formatUsdt(balance) }} USDT available</p>
      </div>

      <button class="btn" @click="view = 'create'">Lock USDT</button>

      <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong> {{ error.action }}</p>

      <div class="row">
        <h2>My locks</h2>
        <button class="refresh" :disabled="refreshing" @click="refresh">{{ refreshing ? 'Refreshing...' : 'Refresh' }}</button>
      </div>
      <p v-if="!locks.length" class="muted">No locks yet. Your first one takes two signatures and no gas.</p>
      <LockCard v-for="l in locks" :key="l.id.toString()" :lock="l" :now="now" />
    </section>
  </main>
</template>

<style scoped>
.top { margin-bottom: 20px; }
.top h1 { font-size: 28px; letter-spacing: -0.02em; }
.summary { gap: 4px; display: flex; flex-direction: column; }
.total { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; }
.small { font-size: 14px; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.row h2 { font-size: 18px; }
.refresh { min-height: var(--tap); background: none; border: 0; font: inherit; color: var(--ink); text-decoration: underline; cursor: pointer; }
</style>
