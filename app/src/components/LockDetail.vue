<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Address, Hash } from 'viem'
import { config } from '../config'
import { simulateWithdraw, waitForSuccess, type LockRecord } from '../lib/chain'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { formatDate, formatRemaining, formatUsdt } from '../lib/format'
import { cleanLabel, lockMeta, MAX_LABEL, saveLockMeta } from '../lib/labels'
import { lockProgress, lockStatus, statusLabel } from '../lib/lockView'
import { RelayerError, relayWithdrawal } from '../lib/relayer'
import Ring from './Ring.vue'

const props = defineProps<{ lock: LockRecord; owner: Address; now: number }>()
const emit = defineEmits<{ back: []; changed: []; rescue: [] }>()

const status = computed(() => lockStatus(props.lock, props.now))
const progress = computed(() => lockProgress(props.lock, props.now))
const label = ref(lockMeta(props.lock.id).label ?? '')
const editing = ref(false)
const working = ref(false)
const refusal = ref<string | null>(null)
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
  <section class="stack-lg fade-in" aria-labelledby="detail-title">
    <button class="btn ghost back" @click="emit('back')">Back</button>

    <div class="card hero">
      <Ring :progress="progress" :status="status" :size="96" />
      <p class="amount num">{{ formatUsdt(lock.amount) }} <span class="muted">USDT</span></p>
      <span class="pill" :class="status">{{ statusLabel[status] }}</span>

      <div v-if="!editing" class="row title-row">
        <h2 id="detail-title">{{ label || `Lock #${lock.id}` }}</h2>
        <button class="btn ghost" @click="editing = true">{{ label ? 'Rename' : 'Add a name' }}</button>
      </div>
      <form v-else class="row title-row" @submit.prevent="saveLabel">
        <label class="visually-hidden" for="label-input">Lock name</label>
        <input id="label-input" v-model="label" :maxlength="MAX_LABEL" placeholder="e.g. Rent, Laptop" autofocus />
        <button class="btn ghost" type="submit">Save</button>
      </form>
    </div>

    <dl class="card facts">
      <div class="row"><dt class="muted">Opens</dt><dd class="num">{{ formatDate(lock.unlockAt) }}</dd></div>
      <div v-if="status === 'sealed'" class="row"><dt class="muted">Time left</dt><dd class="num">{{ formatRemaining(Number(lock.unlockAt) - now) }}</dd></div>
      <div class="row"><dt class="muted">Lock ID</dt><dd class="num">#{{ lock.id }}</dd></div>
      <div class="row">
        <dt class="muted">Held by</dt>
        <dd><a :href="`https://polygonscan.com/address/${config.lockAddress}`" target="_blank" rel="noopener">SevuLock contract</a></dd>
      </div>
    </dl>

    <template v-if="done">
      <p class="notice info" role="status">Withdrawn. {{ formatUsdt(lock.amount) }} USDT is back in your wallet.</p>
      <a v-if="txHash" class="small muted" :href="`https://polygonscan.com/tx/${txHash}`" target="_blank" rel="noopener">View transaction</a>
    </template>

    <template v-else-if="status === 'sealed'">
      <p v-if="refusal" class="notice warn" role="alert">{{ refusal }}</p>
      <button class="btn secondary" :disabled="working" @click="tryEarly">{{ working ? 'Asking the contract...' : 'Try to withdraw early' }}</button>
    </template>

    <template v-else-if="status === 'ripe'">
      <button class="btn ripe" :disabled="working" @click="withdraw">{{ working ? 'Withdrawing...' : 'Withdraw to my wallet' }}</button>
      <p class="faint small">Free. Sevu pays the network fee, and the contract can only send this money to you.</p>
    </template>

    <p v-else class="muted">This lock was paid back to your wallet.</p>

    <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong> {{ error.action }}</p>
    <button v-if="offerRescue" class="btn secondary" @click="emit('rescue')">Withdraw directly instead</button>
  </section>
</template>

<style scoped>
.back { align-self: flex-start; }
.hero { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 24px 18px; }
.amount { font-size: 36px; font-weight: 750; letter-spacing: -0.03em; }
.title-row { width: 100%; justify-content: center; }
.facts { margin: 0; display: flex; flex-direction: column; gap: 10px; }
dd { margin: 0; font-weight: 600; text-align: right; }
</style>
