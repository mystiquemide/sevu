<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Address, Hash } from 'viem'
import { nativeBalance, waitForSuccess, withdrawCalldata, type LockRecord } from '../lib/chain'
import { friendlyError, type FriendlyError } from '../lib/errors'
import { formatUsdt } from '../lib/format'
import { ChevronLeft } from 'lucide-vue-next'
import { lockStatus, lockTitle } from '../lib/lockView'
import Postmark from './Postmark.vue'
import { sendTransaction } from '../lib/wallet'

const props = defineProps<{ owner: Address; locks: LockRecord[]; now: number }>()
const emit = defineEmits<{ back: []; changed: [] }>()

const pol = ref<bigint | null>(null)
const busyId = ref<string | null>(null)
const error = ref<FriendlyError | null>(null)
const sent = ref<Record<string, Hash>>({})

const ripe = computed(() => props.locks.filter((l) => lockStatus(l, props.now) === 'ripe'))
const sealedCount = computed(() => props.locks.filter((l) => lockStatus(l, props.now) === 'sealed').length)

onMounted(async () => {
  pol.value = await nativeBalance(props.owner).catch(() => null)
})

/** FR-014: the owner calls withdraw directly. No relayer involved; the user pays the POL network fee. */
async function rescue(l: LockRecord) {
  busyId.value = l.key
  error.value = null
  try {
    const hash = await sendTransaction(props.owner, l.contract, withdrawCalldata(l.id))
    sent.value = { ...sent.value, [`#${l.id}`]: hash }
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
  <section class="section enter" aria-labelledby="rescue-title">
    <button class="link plain back" @click="emit('back')"><ChevronLeft :size="18" :stroke-width="1.5" />Back</button>
    <div class="group">
      <h2 id="rescue-title" class="page-title">Withdraw directly</h2>
      <p class="secondary">Use this if Sevu's relayer is ever down. Your wallet talks to the contract itself, so it works even if Sevu disappears. You pay a small Polygon network fee in POL.</p>
    </div>

    <p v-if="pol === 0n" class="notice plain">Your wallet has no POL for the network fee. Add a little POL on Polygon first.</p>

    <p v-if="!ripe.length" class="notice plain">
      No locks are ready yet.<template v-if="sealedCount">&#32;{{ sealedCount === 1 ? '1 lock is' : `${sealedCount} locks are` }} still sealed and can only be withdrawn after the unlock date.</template>
    </p>

    <div v-if="ripe.length" class="list card">
      <div v-for="l in ripe" :key="l.key" class="rescue-row">
        <Postmark :date="l.unlockAt" tone="ready" :size="44" :ring="false" />
        <div class="body">
          <span class="title">{{ lockTitle(l) }}</span>
          <span class="meta">{{ formatUsdt(l.amount) }} USDT</span>
        </div>
        <button class="btn narrow" :disabled="busyId !== null || pol === 0n" @click="rescue(l)">
          {{ busyId === l.key ? 'Withdrawing' : 'Withdraw' }}
        </button>
      </div>
    </div>

    <div v-if="Object.keys(sent).length" class="stack">
      <a v-for="(hash, id) in sent" :key="id" class="link" :href="`https://polygonscan.com/tx/${hash}`" target="_blank" rel="noopener">Lock {{ id }} transaction</a>
    </div>
    <p v-if="error" class="notice error" role="alert"><strong>{{ error.title }}</strong>{{ error.action }}</p>
  </section>
</template>

<style scoped>
.back { align-self: flex-start; }
.list { padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.rescue-row { display: flex; align-items: center; gap: 12px; padding: 12px; }
.body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.narrow { width: auto; min-height: 40px; padding: 0 16px; }
</style>
