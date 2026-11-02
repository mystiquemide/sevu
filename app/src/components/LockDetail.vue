<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Address, Hash } from 'viem'
import { simulateWithdraw, waitForSuccess, type LockRecord } from '../lib/chain'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { formatDate, formatRemaining, formatUsdt } from '../lib/format'
import { cleanLabel, lockMeta, MAX_LABEL, saveLockMeta } from '../lib/labels'
import { lockProgress, lockStatus } from '../lib/lockView'
import { RelayerError, relayWithdrawal } from '../lib/relayer'
import { BellRing, ChevronLeft, ExternalLink, Share2 } from 'lucide-vue-next'
import { googleCalendarUrl, shareText, unlockIcs } from '../lib/remind'
import Envelope from './Envelope.vue'

const props = defineProps<{ lock: LockRecord; owner: Address; now: number }>()

// Reminders bring the saver back on the day; sharing says only what the chain already shows.
const shared = ref<'idle' | 'copied' | 'failed'>('idle')
function reminderTitle() { return cleanLabel(label.value) || `Lock #${props.lock.id}` }
function downloadReminder() {
  const ics = unlockIcs({ id: props.lock.key, title: reminderTitle(), amount: props.lock.amount, unlockAt: Number(props.lock.unlockAt), now: props.now })
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'sevu-unlock.ics'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const googleUrl = computed(() => googleCalendarUrl({ title: reminderTitle(), amount: props.lock.amount, unlockAt: Number(props.lock.unlockAt) }))
async function share() {
  const text = shareText({ amount: props.lock.amount, unlockAt: formatDate(props.lock.unlockAt) })
  try {
    if (navigator.share) await navigator.share({ text })
    else { await navigator.clipboard.writeText(text); shared.value = 'copied' }
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') shared.value = 'failed'
  }
}
const emit = defineEmits<{ back: []; changed: []; rescue: [] }>()

const status = computed(() => lockStatus(props.lock, props.now))
const progress = computed(() => lockProgress(props.lock, props.now))
const label = ref(lockMeta(props.lock).label ?? '')
const editing = ref(false)
const working = ref(false)
const refusal = ref<string | null>(null)
const refused = ref(false)
const error = ref<FriendlyError | null>(null)
const offerRescue = ref(false)
const txHash = ref<Hash | null>(null)
const done = ref(false)

function saveLabel() {
  label.value = cleanLabel(label.value)
  saveLockMeta(props.lock, { label: label.value })
  editing.value = false
  emit('changed')
}

/** FR-012: ask the contract itself. It refuses early withdrawal; nothing is sent. */
async function tryEarly() {
  working.value = true
  refusal.value = null
  error.value = null
  try {
    const reason = await simulateWithdraw(props.owner, props.lock.contract, props.lock.id)
    refused.value = reason === 'StillLocked'
    refusal.value =
      reason === 'StillLocked'
        ? `The contract refused. This lock opens ${formatDate(props.lock.unlockAt)}, and nobody can open it earlier. Not you, not Sevu.`
        : reason === null
          ? 'The contract says this lock can be withdrawn now. Refresh to update.'
          : `The contract refused (${reason}).`
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    working.value = false
  }
}

/** FR-013: withdraw through the relayer, then confirm from the contract. */
async function withdraw() {
  working.value = true
  error.value = null
  offerRescue.value = false
  try {
    txHash.value = await relayWithdrawal(props.lock.id, props.lock.contract)
    const result = await waitForSuccess(txHash.value)
    if (result === 'reverted') throw new Error('Withdrawal transaction failed')
    done.value = true
    emit('changed')
  } catch (e) {
    error.value = friendlyError(e)
    offerRescue.value = e instanceof RelayerError && ['RELAYER_UNREACHABLE', 'BUDGET_EXHAUSTED', 'RATE_LIMITED', 'CHAIN_UNAVAILABLE'].includes(e.code)
  } finally {
    working.value = false
  }
}
</script>

<template>
  <section class="section enter" aria-labelledby="detail-title">
    <div class="row">
      <button class="link plain" @click="emit('back')"><ChevronLeft :size="18" :stroke-width="1.5" />Back</button>
      <span class="meta">Lock #{{ lock.id }}</span>
    </div>

    <div class="group">
      <div v-if="!editing" class="row">
        <h2 id="detail-title" class="page-title title">{{ label || `Lock #${lock.id}` }}</h2>
        <button class="link" @click="editing = true">{{ label ? 'Rename' : 'Add a name' }}</button>
      </div>
      <form v-else class="row" @submit.prevent="saveLabel">
        <label class="visually-hidden" for="label-input">Lock name</label>
        <input id="label-input" v-model="label" :maxlength="MAX_LABEL" placeholder="Rent, new phone, a trip" autofocus />
        <button class="link" type="submit">Save</button>
      </form>
      <Envelope :amount="lock.amount" :unlock-at="lock.unlockAt" :title="status === 'withdrawn' ? 'Paid back to your wallet' : 'Sealed in SevuLock'"
        :status="done ? 'withdrawn' : status" :now="now" :progress="progress" :refused="refused" />
    </div>

    <dl class="facts">
      <div class="row"><dt class="secondary">Opens</dt><dd>{{ formatDate(lock.unlockAt) }}</dd></div>
      <div v-if="status === 'sealed'" class="row"><dt class="secondary">Time left</dt><dd>{{ formatRemaining(Number(lock.unlockAt) - now) }}</dd></div>
      <div class="row">
        <dt class="secondary">Held by</dt>
        <dd><a class="link" :href="`https://polygonscan.com/address/${lock.contract}`" target="_blank" rel="noopener">SevuLock contract<ExternalLink :size="14" :stroke-width="1.5" /></a></dd>
      </div>
    </dl>

    <div v-if="status === 'sealed'" class="extras">
      <button class="btn secondary" @click="downloadReminder"><BellRing :size="18" :stroke-width="1.5" aria-hidden="true" />Remind me when it opens</button>
      <a class="link" :href="googleUrl" target="_blank" rel="noopener">Add to Google Calendar instead</a>
      <button class="btn secondary" @click="share"><Share2 :size="18" :stroke-width="1.5" aria-hidden="true" />Share this lock</button>
      <p v-if="shared === 'copied'" class="small secondary" role="status">Copied. Paste it wherever you like.</p>
      <p v-if="shared === 'failed'" class="small secondary" role="status">Sharing is not available here. Try again from your browser.</p>
    </div>

    <div class="group">
      <template v-if="done">
        <p class="notice info" role="status">Withdrawn. {{ formatUsdt(lock.amount) }} USDT is back in your wallet.</p>
        <a v-if="txHash" class="link center" :href="`https://polygonscan.com/tx/${txHash}`" target="_blank" rel="noopener">View transaction</a>
      </template>

      <template v-else-if="status === 'sealed'">
        <p v-if="refusal" class="notice plain" role="alert">{{ refusal }}</p>
        <button class="btn secondary" :disabled="working" @click="tryEarly">{{ working ? 'Asking the contract' : 'Try to withdraw early' }}</button>
      </template>

      <template v-else-if="status === 'ripe'">
        <button class="btn" :disabled="working" @click="withdraw">{{ working ? 'Withdrawing' : 'Withdraw to my wallet' }}</button>
        <p class="meta center">No network fee. The contract can only pay this to you.</p>
      </template>

      <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong>{{ error.action }}</p>
      <button v-if="offerRescue" class="btn secondary" @click="emit('rescue')">Withdraw directly instead</button>
    </div>
  </section>
</template>

<style scoped>
.extras { display: flex; flex-direction: column; gap: 8px; }
.extras .link { align-self: center; }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facts { margin: 0; display: flex; flex-direction: column; }
.facts .row { min-height: 44px; border-bottom: 1px solid var(--line); }
.facts .row:last-child { border-bottom: 0; }
dd { margin: 0; font-family: var(--mono); font-size: 13px; text-align: right; }
dd .link { font-family: var(--sans); font-size: 15px; }
.center { align-self: center; text-align: center; }
</style>
