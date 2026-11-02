<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Address, Hash } from 'viem'
import { MAX_AMOUNT, MAX_DURATION_SEC, MIN_AMOUNT } from '../config'
import { formatDate, formatUsdt, parseUsdt } from '../lib/format'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { cleanLabel, MAX_LABEL, saveLockMeta } from '../lib/labels'
import { createLock, type FlowStep } from '../lib/lockFlow'
import { activeAttempt, type PendingAttempt } from '../lib/attempts'
import { lockNonce } from '../lib/chain'
import { Check, LoaderCircle } from 'lucide-vue-next'
import Envelope from './Envelope.vue'

const props = defineProps<{ owner: Address; balance: bigint; now: number; trial?: boolean }>()
const emit = defineEmits<{ done: []; cancel: [] }>()

// Relayer requires 5 minutes plus an inclusion margin; 10 minutes keeps a safe buffer.
const MIN_LEAD_SEC = 10 * 60
const DAY = 86_400
const durations = [
  // Short enough to see the whole loop (lock, refused early, withdraw) in one sitting.
  { label: '15 min', sec: 15 * 60 },
  { label: '1 week', sec: 7 * DAY },
  { label: '1 month', sec: 30 * DAY },
  { label: '3 months', sec: 91 * DAY },
  { label: '6 months', sec: 182 * DAY },
  { label: '1 year', sec: 365 * DAY },
]
const amountChips = [1_000_000n, 5_000_000n, 10_000_000n]

type Stage = 'form' | 'review' | 'signing' | 'result'
const stage = ref<Stage>('form')
const amountText = ref(props.trial ? '1' : '')
const duration = ref<number | 'custom'>(props.trial ? 15 * 60 : 30 * DAY)
const customDate = ref('')
const label = ref(props.trial ? 'First try' : '')
const step = ref<FlowStep | null>(null)
const error = ref<FriendlyError | null>(null)
const txHash = ref<Hash | null>(null)
const outcome = ref<'SEALED' | 'FAILED' | 'UNKNOWN' | null>(null)
// Freeze the unlock time when the user reviews, so it matches what they confirm.
const frozenUnlock = ref<number | null>(null)
// Audit L-1: an earlier signed lock that may still land. Until it expires, only its exact terms can be retried.
const pending = ref<PendingAttempt | null>(null)

onMounted(async () => {
  try {
    const a = activeAttempt(props.owner, await lockNonce(props.owner), props.now)
    if (!a) return
    pending.value = a
    amountText.value = formatUsdt(BigInt(a.amount)).replace(/,/g, '')
    label.value = a.label
    frozenUnlock.value = Number(a.unlockAt)
  } catch {
    // Without the nonce we cannot tell; the contract still rejects a second lock on the same nonce.
  }
})

const pendingUntil = computed(() =>
  pending.value ? new Date(pending.value.deadline * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '',
)

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
  if (!pending.value) frozenUnlock.value = null
  stage.value = 'form'
}

async function seal() {
  if (amount.value === null || unlockAt.value === null) return
  // The review may have sat open; re-check the minimum lead time against now.
  if (unlockAt.value < props.now + MIN_LEAD_SEC) {
    error.value = { title: 'That unlock time is now too close', action: 'Go back and pick a later time.' }
    return
  }
  stage.value = 'signing'
  error.value = null
  step.value = null
  try {
    const result = await createLock(props.owner, amount.value, BigInt(unlockAt.value), (s) => (step.value = s), cleanLabel(label.value))
    txHash.value = result.txHash
    outcome.value = result.step
    if (result.step === 'SEALED' && result.lock !== undefined) {
      saveLockMeta(result.lock, { label: cleanLabel(label.value) || undefined, sealedAt: result.sealedAt })
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
  <section class="section enter" aria-labelledby="create-title">
    <!-- Result -->
    <template v-if="stage === 'result'">
      <template v-if="outcome === 'SEALED' && amount !== null && unlockAt !== null">
        <div class="group">
          <h2 id="create-title" class="page-title">Sealed</h2>
          <p class="secondary">Nobody can move this before the date on the stamp. Not you, not Sevu.</p>
        </div>
        <Envelope :amount="amount" :unlock-at="unlockAt" :title="cleanLabel(label) || 'New lock'" :now="now" :progress="0" press />
      </template>
      <template v-else>
        <h2 id="create-title" class="page-title">{{ outcome === 'FAILED' ? 'Nothing was locked' : 'Still confirming' }}</h2>
        <p class="notice" :class="outcome === 'FAILED' ? 'error' : 'plain'" role="status">
          {{ outcome === 'FAILED'
            ? 'The transaction failed and your USDT did not move. You can try again.'
            : 'We could not confirm the lock yet. Check your locks before trying again so you do not lock twice.' }}
        </p>
      </template>
      <div class="group">
        <button class="btn ink" @click="emit('done')">Back to my savings</button>
        <a v-if="txHash" class="link center" :href="`https://polygonscan.com/tx/${txHash}`" target="_blank" rel="noopener">View transaction</a>
      </div>
    </template>

    <!-- Signing -->
    <template v-else-if="stage === 'signing'">
      <h2 id="create-title" class="page-title">Sealing</h2>
      <Envelope v-if="amount !== null && unlockAt !== null" :amount="amount" :unlock-at="unlockAt" :title="cleanLabel(label) || 'New lock'" :now="now" :stamped="false" />
      <ol class="steps" aria-live="polite">
        <li v-for="(s, i) in signSteps" :key="s.key" :class="{ active: step === s.key, done: s.done }">
          <span class="marker" aria-hidden="true">
            <Check v-if="s.done" :size="16" :stroke-width="1.5" />
            <LoaderCircle v-else-if="step === s.key" class="spin" :size="16" :stroke-width="1.5" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span>{{ s.text }}</span>
          <span class="visually-hidden">{{ s.done ? 'done' : step === s.key ? 'in progress' : 'waiting' }}</span>
        </li>
      </ol>
      <p class="secondary small">Confirm each request in Nimiq Pay. There is no network fee.</p>
    </template>

    <!-- Review -->
    <template v-else-if="stage === 'review'">
      <h2 id="create-title" class="page-title">Review</h2>
      <Envelope v-if="amount !== null && unlockAt !== null" :amount="amount" :unlock-at="unlockAt" :title="cleanLabel(label) || 'New lock'" :now="now" :stamped="false" />
      <p class="notice plain">Once sealed, this money cannot be withdrawn before the unlock date. Not by you, not by Sevu, not by anyone.</p>
      <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong>{{ error.action }}</p>
      <div class="group">
        <button class="btn" @click="seal">Seal it</button>
        <button v-if="!pending" class="btn secondary" @click="editAgain">Edit lock</button>
      </div>
    </template>

    <!-- Form -->
    <form v-else class="section" @submit.prevent="review">
      <div class="row">
        <h2 id="create-title" class="page-title">New lock</h2>
        <button type="button" class="link" @click="emit('cancel')">Cancel</button>
      </div>

      <p v-if="noFunds" class="notice plain">You need at least 1 USDT on Polygon to create a lock. Add USDT in Nimiq Pay, then come back.</p>
      <p v-if="pending" class="notice plain" role="status">
        <strong>Your last lock may still go through</strong>
        It may still go through, so you can only retry the same amount and date until {{ pendingUntil }}. After that you can change them.
      </p>

      <div class="group">
        <label for="amount">How much?</label>
        <div class="amount-row">
          <input id="amount" v-model="amountText" :disabled="!!pending" class="amount-input num" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-describedby="amount-help" />
          <span class="secondary">USDT</span>
        </div>
        <div class="choices four">
          <button v-for="c in amountChips" :key="c.toString()" type="button" class="choice" :disabled="c > balance || !!pending"
            :aria-pressed="amount === c" @click="pickAmount(c)">{{ formatUsdt(c).replace('.00', '') }}</button>
          <button type="button" class="choice" :disabled="maxAmount < MIN_AMOUNT || !!pending" @click="pickAmount(maxAmount)">Max</button>
        </div>
        <p id="amount-help" class="meta">{{ formatUsdt(balance) }} USDT available · up to {{ formatUsdt(MAX_AMOUNT).replace('.00', '') }} per lock</p>
        <p v-if="amountProblem" class="problem" role="alert">{{ amountProblem }}</p>
      </div>

      <div class="group">
        <span class="label" id="duration-label">Lock it for</span>
        <div class="choices" role="group" aria-labelledby="duration-label">
          <button v-for="d in durations" :key="d.sec" type="button" class="choice" :aria-pressed="!pending && duration === d.sec" :disabled="!!pending" @click="duration = d.sec">{{ d.label }}</button>
          <button type="button" class="choice" :aria-pressed="!pending && duration === 'custom'" :disabled="!!pending" @click="duration = 'custom'">Pick a date</button>
        </div>
        <input v-if="duration === 'custom'" v-model="customDate" type="datetime-local" aria-label="Unlock date and time" />
        <p v-if="unlockAt !== null && !dateProblem" class="meta">Opens {{ formatDate(unlockAt) }}</p>
        <p v-else-if="dateProblem" class="problem" role="alert">{{ dateProblem }}</p>
      </div>

      <div class="group">
        <label for="label">Name it (optional)</label>
        <input id="label" v-model="label" :disabled="!!pending" :maxlength="MAX_LABEL" placeholder="Rent, new phone, a trip" autocomplete="off" />
        <p class="meta">Only saved on this phone</p>
      </div>

      <button class="btn" type="submit" :disabled="!canReview">Review</button>
    </form>
  </section>
</template>

<style scoped>
.center { align-self: center; }
.amount-row { display: flex; align-items: baseline; gap: 8px; border-bottom: 1px solid var(--line-strong); transition: border-color 150ms var(--ease); }
.amount-row:focus-within { border-color: var(--text); }
.amount-input { font-size: 40px; line-height: 48px; min-height: 56px; letter-spacing: -0.02em; border: 0; padding: 0; background: transparent; }
.problem { color: var(--danger); font-size: 13px; line-height: 20px; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.steps li { display: flex; align-items: center; gap: 12px; color: var(--text-3); min-height: 32px; }
.steps li.active { color: var(--text); }
.steps li.done { color: var(--text-2); }
.marker { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-family: var(--mono); font-size: 12px; box-shadow: inset 0 0 0 1px var(--line-strong); flex: none; }
.done .marker { color: var(--ready); box-shadow: inset 0 0 0 1px var(--ready); }
.spin { animation: spin 900ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
