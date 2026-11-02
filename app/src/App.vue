<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Address } from 'viem'
import AccountSheet from './components/AccountSheet.vue'
import CreateLock from './components/CreateLock.vue'
import Intro from './components/Intro.vue'
import Jars from './components/Jars.vue'
import Landing from './components/Landing.vue'
import Envelope from './components/Envelope.vue'
import LockDetail from './components/LockDetail.vue'
import LockRow from './components/LockRow.vue'
import Proof from './components/Proof.vue'
import Rescue from './components/Rescue.vue'
import Wordmark from './components/Wordmark.vue'
import { chainTime, locksOf, usdtBalance, type LockRecord } from './lib/chain'
import { friendlyError, type FriendlyError } from './lib/errors'
import { formatUsdt, shortAddress } from './lib/format'
import { shortNq } from './lib/nimiq'
import { lockProgress, lockStatus, lockTitle, statusLabel } from './lib/lockView'
import { connect, evmProvider, insideNimiqPay, switchToPolygon, watchWallet, type WalletSnapshot } from './lib/wallet'

type View = 'loading' | 'outside' | 'error' | 'home' | 'intro' | 'create' | 'detail' | 'rescue'

const view = ref<View>('loading')
const owner = ref<Address | null>(null)
const balance = ref(0n)
const locks = ref<LockRecord[]>([])
const loaded = ref(false)
const error = ref<FriendlyError | null>(null)
const refreshing = ref(false)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const selectedKey = ref<string | null>(null)
const metaVersion = ref(0)
const wrongChain = ref(false)
const mode = ref<'locks' | 'jars'>('locks')
const showAccount = ref(false)
const trial = ref(false)
const INTRO_KEY = 'sevu:intro-seen'
function introSeen(): boolean {
  try { return localStorage.getItem(INTRO_KEY) === '1' } catch { return true }
}
function finishIntro(next: 'trial' | 'proof' | 'skip') {
  try { localStorage.setItem(INTRO_KEY, '1') } catch { /* private mode: show the intro again next time */ }
  if (next === 'proof') { go('home'); openProof() }
  else if (next === 'trial') { trial.value = true; go('create') }
  else go('home')
}
// The proof page needs no wallet, so it opens on top of whatever state the app is in.
const showProof = ref(typeof location !== 'undefined' && location.hash === '#/proof')
function openProof() {
  location.hash = '#/proof'
  showProof.value = true
  window.scrollTo({ top: 0 })
}
function closeProof() {
  showProof.value = false
  window.history.replaceState(null, '', location.pathname)
}
// The address the header shows follows the tab: Polygon for USDT locks, Nimiq for NIM jars.
const nimAddress = ref<string | null>(null)
const headerAddress = computed(() => (mode.value === 'jars' && view.value === 'home' ? nimAddress.value : owner.value))
const headerNetwork = computed<'polygon' | 'nimiq'>(() => (mode.value === 'jars' && view.value === 'home' ? 'nimiq' : 'polygon'))
const switching = ref(false)
let stopWatching: (() => void) | undefined
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
const selected = computed(() => locks.value.find((l) => l.key === selectedKey.value) ?? null)


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
  showProof.value = location.hash === '#/proof'
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
  selectedKey.value = l.key
  go('detail')
}

/** Nimiq Pay injects its own marker. A browser wallet like MetaMask also injects window.ethereum, so that alone is not enough. */
async function hostIsNimiqPay(): Promise<boolean> {
  if (insideNimiqPay()) return true
  // Give a slow host a moment to inject before showing the landing page.
  await new Promise((r) => setTimeout(r, 400))
  return insideNimiqPay()
}

async function start() {
  if (!evmProvider() || !(await hostIsNimiqPay())) {
    view.value = 'outside'
    return
  }
  view.value = 'loading'
  try {
    owner.value = await connect()
    view.value = location.hash === '#/rescue' ? 'rescue' : introSeen() ? 'home' : 'intro'
    stopWatching?.()
    stopWatching = watchWallet(onWallet)
    await refresh()
  } catch (e) {
    error.value = friendlyError(e)
    view.value = 'error'
  }
}

/** Nimiq Pay changed account or network while Sevu was open. */
async function onWallet(w: WalletSnapshot) {
  if (!w.account) {
    error.value = { title: 'No account selected', action: 'Choose a Polygon account in Nimiq Pay.' }
    view.value = 'error'
    return
  }
  if (w.account !== owner.value) {
    // Another person's locks: drop everything shown for the old account, including half-finished screens.
    owner.value = w.account
    locks.value = []
    balance.value = 0n
    loaded.value = false
    selectedKey.value = null
    showAccount.value = false
    if (view.value !== 'rescue') go('home')
  }
  wrongChain.value = !w.onPolygon
  if (!wrongChain.value) await refresh()
}

async function backToPolygon() {
  switching.value = true
  try {
    await switchToPolygon()
    wrongChain.value = false
    await refresh()
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    switching.value = false
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
  stopWatching?.()
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  window.removeEventListener('hashchange', route)
})
</script>

<template>
  <Landing v-if="view === 'outside' && !showProof" :now="now" @proof="openProof" />
  <template v-else>
  <header class="top row">
    <Wordmark />
    <button v-if="headerAddress" class="account meta"
      :aria-label="`${headerNetwork === 'nimiq' ? 'Nimiq account' : 'Wallet'} ${headerNetwork === 'nimiq' ? shortNq(headerAddress) : shortAddress(headerAddress)}. Show address`"
      @click="showAccount = true">
      {{ headerNetwork === 'nimiq' ? shortNq(headerAddress) : shortAddress(headerAddress) }}
    </button>
  </header>

  <AccountSheet v-if="showAccount && headerAddress" :key="headerNetwork" :address="headerAddress" :network="headerNetwork" @close="showAccount = false" />

  <div v-if="wrongChain && owner" class="notice plain chain" role="alert">
    <strong>Nimiq Pay is not on Polygon</strong>
    Sevu's locks live on Polygon. Switch back to see them and lock USDT.
    <button class="btn secondary" :disabled="switching" @click="backToPolygon">{{ switching ? 'Switching' : 'Switch to Polygon' }}</button>
  </div>

  <p v-if="!online" class="notice plain offline" role="status">You are offline. Amounts may be out of date.</p>

  <main>
    <Proof v-if="showProof" @back="closeProof" />

    <div v-else-if="view === 'loading'" class="section" role="status" aria-label="Connecting to your wallet">
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
      <button class="link" @click="openProof">See the proof on chain</button>
    </section>

    <section v-else-if="view === 'error'" class="group enter">
      <p class="notice error" role="alert"><strong>{{ error?.title }}</strong>{{ error?.action }}</p>
      <button class="btn" @click="start">Try again</button>
    </section>

    <Intro v-else-if="view === 'intro'" :now="now" @trial="finishIntro('trial')" @proof="finishIntro('proof')" @skip="finishIntro('skip')" />

    <CreateLock v-else-if="view === 'create' && owner" :owner="owner" :balance="balance" :now="now" :trial="trial" @done="trial = false; afterCreate()" @cancel="trial = false; go('home')" />

    <LockDetail v-else-if="view === 'detail' && owner && selected" :key="selected.key" :lock="selected" :owner="owner" :now="now"
      @back="go('home')" @changed="changed" @rescue="go('rescue')" />

    <Rescue v-else-if="view === 'rescue' && owner" :owner="owner" :locks="locks" :now="now" @back="go('home')" @changed="changed" />

    <section v-else-if="view === 'home'" class="section">
      <div class="modes" role="tablist" aria-label="Savings type">
        <button role="tab" class="mode" :aria-selected="mode === 'locks'" @click="mode = 'locks'">USDT locks</button>
        <button role="tab" class="mode" :aria-selected="mode === 'jars'" @click="mode = 'jars'">NIM jars</button>
      </div>
      <Jars v-if="mode === 'jars'" @account="(a) => (nimAddress = a)" />
      <template v-else>
      <div class="group">
        <div class="stack">
          <p class="label">Locked in Sevu</p>
          <p v-if="loaded" class="figure total">{{ formatUsdt(totalLocked) }}<span class="unit">USDT</span></p>
          <div v-else class="skeleton" style="height: 44px; width: 55%" />
          <p class="meta">{{ formatUsdt(balance) }} USDT available</p>
        </div>
        <button class="btn" :disabled="wrongChain" @click="go('create')">Lock USDT</button>
        <div class="trust">
          <p class="small secondary">No owner. No admin. Nobody can move it early, not even us.</p>
          <a class="link" href="#/proof" @click.prevent="openProof">See the proof</a>
        </div>
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
          <button v-else class="featured" type="button" @click="open(featured)">
            <span class="visually-hidden">{{ statusLabel[lockStatus(featured, now)] }}: </span>
            <Envelope :key="`${featured.key}-${metaVersion}`" :amount="featured.amount" :unlock-at="featured.unlockAt" :title="lockTitle(featured)"
              :status="lockStatus(featured, now)" :now="now" :progress="lockProgress(featured, now)" />
          </button>
          <div v-if="others.length" class="list card">
            <LockRow v-for="l in others" :key="l.key" :lock="l" :now="now" :version="metaVersion" @open="open(l)" />
          </div>
        </template>
        <div v-else class="skeleton" style="height: 232px" />
      </div>

      <details v-if="history.length" class="history">
        <summary>History ({{ history.length }})</summary>
        <div class="list card">
          <LockRow v-for="l in history" :key="l.key" :lock="l" :now="now" :version="metaVersion" @open="open(l)" />
        </div>
      </details>

      </template>
      <footer class="foot">
        <p class="meta">No owner. No admin. No upgrades.</p>
        <a class="link" href="#/rescue" @click.prevent="go('rescue')">Withdraw directly</a>
        <a class="link" href="#/proof" @click.prevent="openProof">Proof</a>
      </footer>
    </section>
  </main>
  </template>
</template>

<style scoped>
.top { min-height: 44px; margin-bottom: 24px; }
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: var(--raised); }
.mode { min-height: 44px; border: 0; border-radius: 8px; background: transparent; font: inherit; color: var(--text-2); cursor: pointer; transition: background-color 150ms var(--ease), color 150ms var(--ease); }
.mode[aria-selected='true'] { background: var(--card); color: var(--text); box-shadow: var(--shadow-sm); }
.account { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px; margin-right: -12px; border: 0; border-radius: var(--r-control); background: none; cursor: pointer; transition: background-color 150ms var(--ease); }
.account:hover { background: var(--raised); }
.chain { display: flex; flex-direction: column; gap: 4px; margin-bottom: 24px; }
.chain .btn { margin-top: 8px; }
.offline { margin-bottom: 16px; }
.featured { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; border-radius: var(--r-card); transition: transform 150ms var(--ease); }
.featured:active { transform: scale(0.98); }
.empty { display: flex; flex-direction: column; gap: 12px; }
.empty :deep(.envelope) { box-shadow: none; }
.center { text-align: center; }
.list { padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.history summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; color: var(--text-2); }
.history .list { margin-top: 8px; }
.trust { display: flex; flex-direction: column; align-items: flex-start; }
.foot { display: flex; flex-direction: column; align-items: center; gap: 4px; }
</style>
