<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Address, Hash } from 'viem'
import { MAX_AMOUNT, MAX_DURATION_SEC, MIN_AMOUNT } from '../config'
import { formatDate, formatUsdt, parseUsdt } from '../lib/format'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { cleanLabel, MAX_LABEL, saveLockMeta } from '../lib/labels'
import { createLock, type FlowStep } from '../lib/lockFlow'
import SealAnimation from './SealAnimation.vue'

const props = defineProps<{ owner: Address; balance: bigint; now: number }>()
const emit = defineEmits<{ done: []; cancel: [] }>()

// Relayer requires 5 minutes plus an inclusion margin; 10 minutes keeps a safe buffer.
const MIN_LEAD_SEC = 10 * 60
const DAY = 86_400
const durations = [
  { label: '1 week', sec: 7 * DAY },
  { label: '1 month', sec: 30 * DAY },
  { label: '3 months', sec: 91 * DAY },
  { label: '6 months', sec: 182 * DAY },
  { label: '1 year', sec: 365 * DAY },
]
const amountChips = [1_000_000n, 5_000_000n, 10_000_000n]

type Stage = 'form' | 'review' | 'signing' | 'result'
const stage = ref<Stage>('form')
const amountText = ref('')
const duration = ref<number | 'custom'>(30 * DAY)
const customDate = ref('')
const label = ref('')
const step = ref<FlowStep | null>(null)
const error = ref<FriendlyError | null>(null)
const txHash = ref<Hash | null>(null)
const outcome = ref<'SEALED' | 'FAILED' | 'UNKNOWN' | null>(null)
// Freeze the unlock time when the user reviews, so it matches what they confirm.
const frozenUnlock = ref<number | null>(null)

const maxAmount = computed(() => (props.balance < MAX_AMOUNT ? props.balance : MAX_AMOUNT))
const amount = computed(() => parseUsdt(amountText.value))
const unlockAt = computed<number | null>(() => {
  if (frozenUnlock.value !== null) return frozenUnlock.value
  if (duration.value !== 'custom') return props.now + duration.value
  const t = Date.parse(customDate.value)
  return Number.isNaN(t) ? null : Math.floor(t / 1000)
})

const amountProblem = computed(() => {
  if (!amountText.value) return ''
  if (amount.value === null) return 'Enter an amount like 5 or 2.50.'
  if (amount.value < MIN_AMOUNT) return 'The minimum is 1 USDT.'
  if (amount.value > MAX_AMOUNT) return `The limit is ${formatUsdt(MAX_AMOUNT)} USDT per lock for now.`
  if (amount.value > props.balance) return 'That is more than your USDT balance.'
  return ''
})
const dateProblem = computed(() => {
  if (unlockAt.value === null) return 'Pick an unlock date.'
  if (unlockAt.value < props.now + MIN_LEAD_SEC) return 'Pick a time at least 10 minutes from now.'
  if (unlockAt.value > props.now + MAX_DURATION_SEC) return 'The longest lock is 2 years.'
  return ''
})
const noFunds = computed(() => props.balance < MIN_AMOUNT)
const canReview = computed(() => amount.value !== null && !amountProblem.value && !dateProblem.value)

const signSteps = computed(() => [
  { key: 'SIGNING_PERMIT', text: 'Approve exactly this amount', done: ['SIGNING_INTENT', 'SUBMITTED'].includes(step.value ?? '') },
  { key: 'SIGNING_INTENT', text: 'Confirm the unlock date', done: step.value === 'SUBMITTED' },
  { key: 'SUBMITTED', text: 'Seal on Polygon', done: false },
])

function review() {
  if (!canReview.value) return
  frozenUnlock.value = unlockAt.value
  error.value = null
  stage.value = 'review'
}

function editAgain() {
  frozenUnlock.value = null
  stage.value = 'form'
}

async function seal() {
  if (amount.value === null || unlockAt.value === null) return
  // The review may have sat open; re-check the minimum lead time against now.
  if (unlockAt.value < props.now + MIN_LEAD_SEC) {
    error.value = { title: 'That unlock time is now too close.', action: 'Go back and pick a later time.' }
    return
  }
  stage.value = 'signing'
  error.value = null
  step.value = null
  try {
    const result = await createLock(props.owner, amount.value, BigInt(unlockAt.value), (s) => (step.value = s))
    txHash.value = result.txHash
    outcome.value = result.step
    if (result.step === 'SEALED' && result.lockId !== undefined) {
      saveLockMeta(result.lockId, { label: cleanLabel(label.value) || undefined, sealedAt: result.sealedAt })
    }
    stage.value = 'result'
  } catch (e) {
    error.value = friendlyError(e)
    stage.value = 'review'
  }
}

function pickAmount(units: bigint) {
  amountText.value = formatUsdt(units).replace(/,/g, '')
}
</script>

<template>
  <section class="stack-lg fade-in" aria-labelledby="create-title">
    <!-- Result -->
    <template v-if="stage === 'result'">
      <template v-if="outcome === 'SEALED'">
        <SealAnimation />
        <div class="center stack">
          <h2 id="create-title">Sealed</h2>
          <p class="big num">{{ amount !== null ? formatUsdt(amount) : '' }} USDT</p>
          <p class="muted">Locked until {{ unlockAt !== null ? formatDate(unlockAt) : '' }}.<br />Nobody can move it before then. Not even Sevu.</p>
        </div>
      </template>
      <template v-else>
        <h2 id="create-title">{{ outcome === 'FAILED' ? 'Nothing was locked' : 'Still confirming' }}</h2>
        <p class="notice" :class="outcome === 'FAILED' ? 'error' : 'warn'" role="status">
          {{ outcome === 'FAILED'
            ? 'The transaction failed and your USDT did not move. You can try again.'
            : 'We could not confirm the lock yet. Check your locks before trying again so you do not lock twice.' }}
        </p>
      </template>
      <a v-if="txHash" class="small muted center" :href="`https://polygonscan.com/tx/${txHash}`" target="_blank" rel="noopener">View transaction</a>
      <button class="btn" @click="emit('done')">Back to my savings</button>
    </template>

    <!-- Signing -->
    <template v-else-if="stage === 'signing'">
      <h2 id="create-title">Sealing your savings</h2>
      <ol class="card steps" aria-live="polite">
        <li v-for="(s, i) in signSteps" :key="s.key" :class="{ active: step === s.key, done: s.done }">
          <span class="dot" aria-hidden="true">{{ s.done ? '' : i + 1 }}</span>
          <span>{{ s.text }}</span>
          <span class="visually-hidden">{{ s.done ? 'done' : step === s.key ? 'in progress' : 'waiting' }}</span>
        </li>
      </ol>
      <p class="muted small">Confirm each request in Nimiq Pay. You pay no gas.</p>
    </template>

    <!-- Review -->
    <template v-else-if="stage === 'review'">
      <h2 id="create-title">Review</h2>
      <dl class="card facts">
        <div class="row"><dt class="muted">Amount</dt><dd class="num">{{ amount !== null ? formatUsdt(amount) : '' }} USDT</dd></div>
        <div class="row"><dt class="muted">Opens</dt><dd class="num">{{ unlockAt !== null ? formatDate(unlockAt) : '' }}</dd></div>
        <div v-if="cleanLabel(label)" class="row"><dt class="muted">Name</dt><dd>{{ cleanLabel(label) }}</dd></div>
        <div class="row"><dt class="muted">Network fee</dt><dd>Free</dd></div>
      </dl>
      <p class="notice warn">Once sealed, this money cannot be withdrawn before the unlock date. Not by you, not by Sevu, not by anyone.</p>
      <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong> {{ error.action }}</p>
      <button class="btn" @click="seal">Seal it</button>
      <button class="btn secondary" @click="editAgain">Change something</button>
    </template>

    <!-- Form -->
    <form v-else class="stack-lg" @submit.prevent="review">
      <div class="row">
        <h2 id="create-title">New lock</h2>
        <button type="button" class="btn ghost" @click="emit('cancel')">Cancel</button>
      </div>

      <p v-if="noFunds" class="notice warn">You need at least 1 USDT on Polygon in Nimiq Pay to create a lock.</p>

      <div class="card stack">
        <label for="amount">How much?</label>
        <div class="amount-row">
          <input id="amount" v-model="amountText" class="amount-input num" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-describedby="amount-help" />
          <span class="unit muted">USDT</span>
        </div>
        <div class="chips">
          <button v-for="c in amountChips" :key="c.toString()" type="button" class="chip" :disabled="c > balance"
            :aria-pressed="amount === c" @click="pickAmount(c)">{{ formatUsdt(c).replace('.00', '') }}</button>
          <button type="button" class="chip" :disabled="maxAmount < MIN_AMOUNT" @click="pickAmount(maxAmount)">Max</button>
        </div>
        <p id="amount-help" class="faint small num">Available {{ formatUsdt(balance) }} USDT · up to {{ formatUsdt(MAX_AMOUNT).replace('.00', '') }} per lock</p>
        <p v-if="amountProblem" class="problem" role="alert">{{ amountProblem }}</p>
      </div>

      <div class="card stack">
        <span class="label" id="duration-label">Lock it for</span>
        <div class="chips" role="group" aria-labelledby="duration-label">
          <button v-for="d in durations" :key="d.sec" type="button" class="chip" :aria-pressed="duration === d.sec" @click="duration = d.sec">{{ d.label }}</button>
          <button type="button" class="chip" :aria-pressed="duration === 'custom'" @click="duration = 'custom'">Pick a date</button>
        </div>
        <input v-if="duration === 'custom'" v-model="customDate" type="datetime-local" aria-label="Unlock date and time" />
        <p v-if="unlockAt !== null && !dateProblem" class="faint small">Opens {{ formatDate(unlockAt) }}</p>
        <p v-else-if="dateProblem" class="problem" role="alert">{{ dateProblem }}</p>
      </div>

      <div class="card stack">
        <label for="label">Name it <span class="faint">(optional)</span></label>
        <input id="label" v-model="label" :maxlength="MAX_LABEL" placeholder="e.g. Rent, New phone" autocomplete="off" />
        <p class="faint small">Only saved on this phone.</p>
      </div>

      <button class="btn" type="submit" :disabled="!canReview">Review</button>
    </form>
  </section>
</template>

<style scoped>
.center { text-align: center; align-items: center; }
.big { font-size: 34px; font-weight: 750; letter-spacing: -0.03em; }
.amount-row { display: flex; align-items: baseline; gap: 8px; border-bottom: 2px solid var(--line); }
.amount-row:focus-within { border-color: var(--ink); }
.unit { font-weight: 650; }
.problem { color: var(--danger); font-size: 14px; }
.facts { margin: 0; display: flex; flex-direction: column; gap: 12px; }
dd { margin: 0; font-weight: 650; text-align: right; }
.steps { list-style: none; margin: 0; display: flex; flex-direction: column; gap: 16px; }
.steps li { display: flex; align-items: center; gap: 12px; color: var(--ink-faint); font-weight: 600; }
.steps li.active { color: var(--ink); }
.steps li.done { color: var(--sealed); }
.dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; border: 2px solid currentColor; flex: none; }
.active .dot { animation: breathe 1.2s ease-in-out infinite; }
.done .dot { background: var(--sealed); border-color: var(--sealed); }
.done .dot::after { content: ''; width: 10px; height: 6px; border: solid #fff; border-width: 0 0 2.5px 2.5px; transform: rotate(-45deg) translate(1px, -1px); }
@keyframes breathe { 50% { transform: scale(1.12); } }
</style>
