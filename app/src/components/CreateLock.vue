<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Address, Hash } from 'viem'
import { MAX_AMOUNT, MAX_DURATION_SEC, MIN_AMOUNT } from '../config'
import { formatDate, formatUsdt, parseUsdt } from '../lib/format'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { createLock, type FlowStep } from '../lib/lockFlow'

const props = defineProps<{ owner: Address; balance: bigint; now: number }>()
const emit = defineEmits<{ done: [txHash: Hash | null]; cancel: [] }>()

// Relayer requires 5 minutes plus an inclusion margin; 10 minutes keeps a safe buffer.
const MIN_LEAD_SEC = 10 * 60
const presets = [
  { label: '1 week', sec: 7 * 86_400 },
  { label: '1 month', sec: 30 * 86_400 },
  { label: '3 months', sec: 91 * 86_400 },
  { label: '6 months', sec: 182 * 86_400 },
  { label: '1 year', sec: 365 * 86_400 },
]

const amountText = ref('')
const preset = ref<number | 'custom'>(30 * 86_400)
const customDate = ref('')
const step = ref<FlowStep | null>(null)
const error = ref<FriendlyError | null>(null)
const txHash = ref<Hash | null>(null)

const maxAmount = computed(() => (props.balance < MAX_AMOUNT ? props.balance : MAX_AMOUNT))
const amount = computed(() => parseUsdt(amountText.value))
const unlockAt = computed<number | null>(() => {
  if (preset.value !== 'custom') return props.now + preset.value
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
const canSubmit = computed(
  () => amount.value !== null && !amountProblem.value && !dateProblem.value && step.value === null,
)
const busy = computed(() => step.value !== null && !['SEALED', 'FAILED', 'UNKNOWN'].includes(step.value))

const stepText: Record<FlowStep, string> = {
  SIGNING_PERMIT: 'Step 1 of 2: approve the exact amount in Nimiq Pay.',
  SIGNING_INTENT: 'Step 2 of 2: confirm the unlock date in Nimiq Pay.',
  SUBMITTED: 'Sealing on Polygon. This usually takes a few seconds.',
  SEALED: 'Sealed. Nobody can move this until the unlock date.',
  FAILED: 'The transaction failed and nothing was locked. You can try again.',
  UNKNOWN: 'We could not confirm the lock yet. Check your locks before trying again.',
}

async function submit() {
  if (!canSubmit.value || amount.value === null || unlockAt.value === null) return
  error.value = null
  txHash.value = null
  try {
    const result = await createLock(props.owner, amount.value, BigInt(unlockAt.value), (s) => (step.value = s))
    step.value = result.step
    txHash.value = result.txHash
  } catch (e) {
    step.value = null
    error.value = friendlyError(e)
  }
}

function useMax() {
  amountText.value = formatUsdt(maxAmount.value).replace(/,/g, '')
}
</script>

<template>
  <section class="stack" aria-labelledby="create-title">
    <h2 id="create-title">New lock</h2>

    <template v-if="step === 'SEALED' || step === 'FAILED' || step === 'UNKNOWN'">
      <p class="notice" :class="step === 'SEALED' ? 'info' : 'error'" role="status">{{ stepText[step] }}</p>
      <a v-if="txHash" class="muted" :href="`https://polygonscan.com/tx/${txHash}`" target="_blank" rel="noopener">View transaction</a>
      <button class="btn" @click="emit('done', txHash)">Back to my locks</button>
    </template>

    <form v-else class="stack" @submit.prevent="submit">
      <div class="stack card">
        <label for="amount">Amount (USDT)</label>
        <input id="amount" v-model="amountText" inputmode="decimal" autocomplete="off" placeholder="0.00" :disabled="busy" />
        <p class="muted small num">
          Balance {{ formatUsdt(balance) }} USDT ·
          <button type="button" class="link" :disabled="busy || maxAmount < MIN_AMOUNT" @click="useMax">Use max</button>
        </p>
        <p v-if="amountProblem" class="problem" role="alert">{{ amountProblem }}</p>
      </div>

      <div class="stack card">
        <label for="duration">Unlocks after</label>
        <select id="duration" v-model="preset" :disabled="busy">
          <option v-for="p in presets" :key="p.sec" :value="p.sec">{{ p.label }}</option>
          <option value="custom">Pick a date</option>
        </select>
        <input v-if="preset === 'custom'" v-model="customDate" type="datetime-local" aria-label="Unlock date" :disabled="busy" />
        <p v-if="unlockAt !== null && !dateProblem" class="muted small">Opens {{ formatDate(unlockAt) }}</p>
        <p v-else-if="dateProblem" class="problem" role="alert">{{ dateProblem }}</p>
      </div>

      <p class="muted small">
        Nimiq Pay will ask you to sign twice. Nothing leaves your wallet until both are signed, and you pay no gas.
        After sealing, nobody can move this money before the unlock date, including Sevu.
      </p>

      <p v-if="busy && step" class="notice info" role="status" aria-live="polite">{{ stepText[step] }}</p>
      <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong> {{ error.action }}</p>

      <button class="btn" type="submit" :disabled="!canSubmit">{{ busy ? 'Working...' : 'Seal it' }}</button>
      <button class="btn secondary" type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
    </form>
  </section>
</template>

<style scoped>
.small { font-size: 14px; }
.problem { color: var(--danger); font-size: 14px; }
.link { background: none; border: 0; padding: 0; font: inherit; color: var(--ink); text-decoration: underline; cursor: pointer; min-height: auto; }
</style>
