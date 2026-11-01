<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Address, Hash } from 'viem'
import { config } from '../config'
import { simulateWithdraw, waitForSuccess, type LockRecord } from '../lib/chain'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { formatDate, formatRemaining, formatUsdt } from '../lib/format'
import { cleanLabel, lockMeta, MAX_LABEL, saveLockMeta } from '../lib/labels'
import { lockProgress, lockStatus } from '../lib/lockView'
import { RelayerError, relayWithdrawal } from '../lib/relayer'
import { ChevronLeft, ExternalLink } from 'lucide-vue-next'
import Envelope from './Envelope.vue'

const props = defineProps<{ lock: LockRecord; owner: Address; now: number }>()
const emit = defineEmits<{ back: []; changed: []; rescue: [] }>()

const status = computed(() => lockStatus(props.lock, props.now))
const progress = computed(() => lockProgress(props.lock, props.now))
const label = ref(lockMeta(props.lock.id).label ?? '')
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
  saveLockMeta(props.lock.id, { label: label.value })
  editing.value = false
  emit('changed')
}

/** FR-012: ask the contract itself. It refuses early withdrawal; nothing is sent. */
async function tryEarly() {
  working.value = true
  refusal.value = null
  error.value = null
  try {
    const reason = await simulateWithdraw(props.owner, props.lock.id)
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
    txHash.value = await relayWithdrawal(props.lock.id)
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
        <dd><a class="link" :href="`https://polygonscan.com/address/${config.lockAddress}`" target="_blank" rel="noopener">SevuLock contract<ExternalLink :size="14" :stroke-width="1.5" /></a></dd>
      </div>
    </dl>

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
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facts { margin: 0; display: flex; flex-direction: column; }
.facts .row { min-height: 44px; border-bottom: 1px solid var(--line); }
.facts .row:last-child { border-bottom: 0; }
dd { margin: 0; font-family: var(--mono); font-size: 13px; text-align: right; }
dd .link { font-family: var(--sans); font-size: 15px; min-height: 0; }
.center { align-self: center; text-align: center; }
</style>
