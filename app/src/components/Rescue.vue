<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Address, Hash } from 'viem'
import { config } from '../config'
import { nativeBalance, waitForSuccess, withdrawCalldata, type LockRecord } from '../lib/chain'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { formatUsdt } from '../lib/format'
import { lockStatus, lockTitle } from '../lib/lockView'
import { sendTransaction } from '../lib/wallet'

const props = defineProps<{ owner: Address; locks: LockRecord[]; now: number }>()
const emit = defineEmits<{ back: []; changed: [] }>()

const pol = ref<bigint | null>(null)
const busyId = ref<bigint | null>(null)
const error = ref<FriendlyError | null>(null)
const sent = ref<Record<string, Hash>>({})

const ripe = computed(() => props.locks.filter((l) => lockStatus(l, props.now) === 'ripe'))
const sealedCount = computed(() => props.locks.filter((l) => lockStatus(l, props.now) === 'sealed').length)

onMounted(async () => {
  pol.value = await nativeBalance(props.owner).catch(() => null)
})

/** FR-014: the owner calls withdraw directly. No relayer involved; the user pays the POL network fee. */
async function rescue(l: LockRecord) {
  if (!config.lockAddress) return
  busyId.value = l.id
  error.value = null
  try {
    const hash = await sendTransaction(props.owner, config.lockAddress, withdrawCalldata(l.id))
    sent.value = { ...sent.value, [l.id.toString()]: hash }
    const result = await waitForSuccess(hash)
    if (result === 'reverted') throw new Error('Withdrawal transaction failed')
    emit('changed')
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <section class="stack-lg fade-in" aria-labelledby="rescue-title">
    <button class="btn ghost back" @click="emit('back')">Back</button>
    <div class="stack">
      <h2 id="rescue-title">Withdraw directly</h2>
      <p class="muted">
        Use this if Sevu's relayer is ever down. Your wallet talks to the contract itself, so it works even if Sevu disappears.
        You pay a small Polygon network fee in POL.
      </p>
    </div>

    <p v-if="pol === 0n" class="notice warn">Your wallet has no POL for the network fee. Add a little POL on Polygon first.</p>

    <p v-if="!ripe.length" class="card muted">
      No locks are ready yet.<template v-if="sealedCount">&#32;{{ sealedCount === 1 ? '1 lock is' : `${sealedCount} locks are` }} still sealed and can only be withdrawn after the unlock date.</template>
    </p>

    <div v-for="l in ripe" :key="l.id.toString()" class="card row">
      <div class="stack tight">
        <span class="title">{{ lockTitle(l) }}</span>
        <span class="num muted small">{{ formatUsdt(l.amount) }} USDT</span>
      </div>
      <button class="btn ripe narrow" :disabled="busyId !== null || pol === 0n" @click="rescue(l)">
        {{ busyId === l.id ? 'Withdrawing...' : 'Withdraw' }}
      </button>
    </div>

    <p v-for="(hash, id) in sent" :key="id" class="small">
      <a :href="`https://polygonscan.com/tx/${hash}`" target="_blank" rel="noopener">Lock #{{ id }} transaction</a>
    </p>
    <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong> {{ error.action }}</p>
  </section>
</template>

<style scoped>
.back { align-self: flex-start; }
.tight { gap: 2px; }
.title { font-weight: 650; }
.narrow { width: auto; min-width: 120px; }
</style>
