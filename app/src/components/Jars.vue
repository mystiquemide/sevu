<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ChevronLeft, Plus } from 'lucide-vue-next'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { jarShares, loadJars, saveJars, type Jar } from '../lib/jars'
import { cleanLabel, MAX_LABEL } from '../lib/labels'
import {
  activeValidators, addStake, formatNim, LUNA, MIN_NEW_STAKE_LUNA, nimAccount, nimBalance, parseNim, shortNq, stakerOf, waitForStake,
  type Staker, type Validator,
} from '../lib/nimiq'

type Stage = 'loading' | 'error' | 'list' | 'new' | 'add' | 'done'

const stage = ref<Stage>('loading')
const address = ref('')
const balance = ref(0)
const staker = ref<Staker | null>(null)
const jars = ref<Jar[]>([])
const error = ref<FriendlyError | null>(null)
const active = ref<Jar | null>(null)

const newName = ref('')
const newTarget = ref('')
const addText = ref('')
const validators = ref<Validator[]>([])
const delegation = ref('')
const working = ref(false)
const confirmed = ref<boolean | null>(null)

const staked = computed(() => staker.value?.balance ?? 0)
const shares = computed(() => jarShares(jars.value, staked.value))
const firstTime = computed(() => staker.value === null)
const addValue = computed(() => parseNim(addText.value))
const minAdd = computed(() => (firstTime.value ? MIN_NEW_STAKE_LUNA : LUNA))
const addProblem = computed(() => {
  if (!addText.value) return ''
  if (addValue.value === null) return 'Enter an amount like 150 or 12.5.'
  if (addValue.value < minAdd.value) return firstTime.value ? 'Your first stake must be at least 100 NIM (Nimiq rule).' : 'Add at least 1 NIM.'
  if (addValue.value > balance.value) return 'That is more than your NIM balance.'
  return ''
})
const canAdd = computed(() => addValue.value !== null && !addProblem.value && (!firstTime.value || !!delegation.value) && !working.value)
const targetValue = computed(() => parseNim(newTarget.value))
const canCreate = computed(() => cleanLabel(newName.value).length > 0 && targetValue.value !== null && targetValue.value >= LUNA)

async function load() {
  stage.value = 'loading'
  error.value = null
  // Each step is named so a failure on a real device says where it broke (no secrets in these messages).
  let step = 'account'
  try {
    address.value = await nimAccount()
    step = 'balance'
    balance.value = await nimBalance(address.value)
    step = 'stake'
    staker.value = await stakerOf(address.value)
    jars.value = loadJars(address.value)
    stage.value = 'list'
  } catch (e) {
    const raw = e as { message?: string; type?: string; code?: number | string }
    const msg = raw?.message ?? String(e)
    if (msg === 'NO_PROVIDER') error.value = { title: 'Jars need Nimiq Pay', action: 'Open Sevu inside Nimiq Pay to stake NIM toward a goal.' }
    else if (msg === 'NO_ACCOUNT') error.value = { title: 'No Nimiq account', action: 'Create or select a NIM account in Nimiq Pay.' }
    else {
      const where = { account: 'reading your Nimiq account', balance: 'reading your NIM balance', stake: 'reading your stake from the Nimiq network' }[step]
      const detail = [raw?.type, raw?.code, msg].filter((x) => x !== undefined && x !== '').join(' · ').slice(0, 160)
      error.value = { title: 'Could not load jars', action: `Failed while ${where}. Try again. Details: ${detail}` }
    }
    stage.value = 'error'
  }
}

function createJar() {
  if (!canCreate.value || targetValue.value === null) return
  jars.value = [...jars.value, { id: `${Date.now()}`, name: cleanLabel(newName.value), target: targetValue.value, added: 0 }]
  saveJars(address.value, jars.value)
  newName.value = ''
  newTarget.value = ''
  stage.value = 'list'
}

async function openAdd(j: Jar) {
  active.value = j
  addText.value = ''
  confirmed.value = null
  error.value = null
  stage.value = 'add'
  if (firstTime.value && !validators.value.length) {
    validators.value = (await activeValidators().catch(() => [])).slice(0, 6)
  }
}

async function stake() {
  if (!canAdd.value || addValue.value === null || !active.value) return
  working.value = true
  error.value = null
  const value = addValue.value
  const target = staked.value + value
  try {
    await addStake(value, firstTime.value ? { delegation: delegation.value } : null)
    // Record the jar's share once Nimiq Pay has sent it; the chain decides what is actually staked.
    jars.value = jars.value.map((j) => (j.id === active.value!.id ? { ...j, added: j.added + value } : j))
    saveJars(address.value, jars.value)
    confirmed.value = await waitForStake(address.value, target)
    staker.value = await stakerOf(address.value).catch(() => staker.value)
    balance.value = await nimBalance(address.value).catch(() => balance.value)
    stage.value = 'done'
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    working.value = false
  }
}

function pct(i: number, j: Jar) {
  return Math.min(100, Math.round(((shares.value.claimed[i] ?? 0) / j.target) * 100))
}

onMounted(load)
</script>

<template>
  <section class="section enter" aria-labelledby="jars-title">
    <div v-if="stage === 'loading'" class="group" role="status" aria-label="Reading your NIM stake">
      <div class="skeleton" style="height: 72px; width: 60%" />
      <div class="skeleton" style="height: 120px" />
    </div>

    <div v-else-if="stage === 'error'" class="group">
      <p class="notice error" role="alert"><strong>{{ error?.title }}</strong>{{ error?.action }}</p>
      <button class="btn secondary" @click="load">Try again</button>
    </div>

    <!-- List -->
    <template v-else-if="stage === 'list'">
      <div class="group">
        <div class="stack">
          <p class="label" id="jars-title">Staked NIM</p>
          <p class="figure">{{ formatNim(staked) }}<span class="unit">NIM</span></p>
          <p class="meta">{{ formatNim(balance) }} NIM available · {{ shortNq(address) }}</p>
        </div>
        <p class="notice plain">Jars are goals over your own Nimiq stake. They lock nothing: you can unstake any time in Nimiq Pay.</p>
      </div>

      <p v-if="shares.shortfall" class="notice plain" role="status">
        <strong>Less is staked than your jars add up to</strong>
        Some stake was moved outside Sevu. Jars show their share of what is really staked.
      </p>

      <div class="group">
        <div class="row">
          <h2 class="section-title">Your jars</h2>
          <button class="link" @click="stage = 'new'"><Plus :size="16" :stroke-width="1.5" />New jar</button>
        </div>
        <p v-if="!jars.length" class="secondary small">No jars yet. Name a goal, then stake NIM toward it.</p>
        <button v-for="(j, i) in jars" :key="j.id" class="card jar" type="button" @click="openAdd(j)">
          <span class="row">
            <span class="jar-name">{{ j.name }}</span>
            <span class="meta">{{ pct(i, j) }}%</span>
          </span>
          <span class="track" aria-hidden="true"><i :style="{ transform: `scaleX(${pct(i, j) / 100})` }" /></span>
          <span class="row small secondary">
            <span class="num">{{ formatNim(shares.claimed[i] ?? 0) }} of {{ formatNim(j.target) }} NIM</span>
            <span>Add NIM</span>
          </span>
        </button>
      </div>
    </template>

    <!-- New jar -->
    <form v-else-if="stage === 'new'" class="section" @submit.prevent="createJar">
      <button type="button" class="link plain back" @click="stage = 'list'"><ChevronLeft :size="18" :stroke-width="1.5" />Back</button>
      <h2 class="page-title">New jar</h2>
      <div class="group">
        <label for="jar-name">What is it for?</label>
        <input id="jar-name" v-model="newName" :maxlength="MAX_LABEL" placeholder="New laptop, a trip" autocomplete="off" />
      </div>
      <div class="group">
        <label for="jar-target">Goal (NIM)</label>
        <input id="jar-target" v-model="newTarget" inputmode="decimal" placeholder="5000" autocomplete="off" />
      </div>
      <button class="btn" type="submit" :disabled="!canCreate">Create jar</button>
    </form>

    <!-- Add NIM -->
    <form v-else-if="stage === 'add' && active" class="section" @submit.prevent="stake">
      <button type="button" class="link plain back" :disabled="working" @click="stage = 'list'"><ChevronLeft :size="18" :stroke-width="1.5" />Back</button>
      <h2 class="page-title">{{ active.name }}</h2>
      <div class="group">
        <label for="add-nim">Stake toward it (NIM)</label>
        <input id="add-nim" v-model="addText" inputmode="decimal" :placeholder="firstTime ? '100' : '50'" autocomplete="off" :disabled="working" />
        <p class="meta">{{ formatNim(balance) }} NIM available{{ firstTime ? ' · first stake at least 100 NIM' : '' }}</p>
        <p v-if="addProblem" class="problem" role="alert">{{ addProblem }}</p>
      </div>

      <div v-if="firstTime" class="group">
        <span class="label" id="validator-label">Choose a validator</span>
        <p class="secondary small">Your stake is delegated to a validator who earns rewards for you. This is your choice. Sevu earns nothing from it.</p>
        <div class="stack" role="radiogroup" aria-labelledby="validator-label">
          <label v-for="v in validators" :key="v.address" class="validator" :data-on="delegation === v.address || undefined">
            <input v-model="delegation" type="radio" name="validator" :value="v.address" :aria-label="`Validator ${shortNq(v.address)}`" />
            <span class="dot" aria-hidden="true" />
            <span class="mono">{{ shortNq(v.address) }}</span>
            <span class="meta">{{ formatNim(v.balance) }} NIM staked</span>
          </label>
          <p v-if="!validators.length" class="secondary small">Loading validators</p>
        </div>
      </div>

      <p class="secondary small">Nimiq Pay asks you to confirm. The NIM stays yours and staked in your own account.</p>
      <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong>{{ error.action }}</p>
      <button class="btn" type="submit" :disabled="!canAdd">{{ working ? 'Waiting for Nimiq' : 'Stake' }}</button>
    </form>

    <!-- Done -->
    <div v-else-if="stage === 'done' && active" class="section">
      <h2 class="page-title">{{ confirmed ? 'Staked' : 'Sent to Nimiq' }}</h2>
      <p class="notice" :class="confirmed ? 'info' : 'plain'" role="status">
        {{ confirmed
          ? `Your stake is now ${formatNim(staked)} NIM on Nimiq. ${active.name} moved closer to its goal.`
          : 'Nimiq Pay sent it, but the chain has not shown it yet. Refresh jars in a minute.' }}
      </p>
      <button class="btn ink" @click="load">Back to jars</button>
    </div>
  </section>
</template>

<style scoped>
.back { align-self: flex-start; }
.jar { display: flex; flex-direction: column; gap: 12px; width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; transition: background-color 150ms var(--ease); }
.jar:hover { background: var(--raised); }
.jar-name { font-size: 16px; font-weight: 500; }
.track { height: 6px; border-radius: 3px; background: var(--raised); overflow: hidden; }
.track i { display: block; height: 100%; background: var(--text); transform-origin: left; transition: transform 500ms var(--ease); }
.problem { color: var(--danger); font-size: 13px; line-height: 20px; }
.validator {
  position: relative; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 12px; align-items: center;
  min-height: 56px; padding: 8px 12px; border-radius: var(--r-control); box-shadow: inset 0 0 0 1px var(--line-strong); cursor: pointer;
}
.validator[data-on] { box-shadow: inset 0 0 0 2px var(--text); }
.validator input { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; margin: 0; opacity: 0; cursor: pointer; }
.validator .dot { grid-row: span 2; width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--line-strong); }
.validator[data-on] .dot { box-shadow: inset 0 0 0 6px var(--text); }
.validator:has(input:focus-visible) { outline: 2px solid var(--text); outline-offset: 2px; }
.mono { font-family: var(--mono); font-size: 14px; }
</style>
