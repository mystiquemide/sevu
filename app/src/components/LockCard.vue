<script setup lang="ts">
import { computed } from 'vue'
import type { LockRecord } from '../lib/chain'
import { formatDate, formatRemaining, formatUsdt } from '../lib/format'

const props = defineProps<{ lock: LockRecord; now: number }>()

const status = computed(() => {
  if (props.lock.withdrawn) return 'withdrawn'
  return props.now >= Number(props.lock.unlockAt) ? 'ripe' : 'sealed'
})
const label = computed(() => ({ sealed: 'Sealed', ripe: 'Ready to withdraw', withdrawn: 'Withdrawn' })[status.value])
const remaining = computed(() => formatRemaining(Number(props.lock.unlockAt) - props.now))
</script>

<template>
  <article class="card lock" :aria-label="`Lock ${lock.id}: ${formatUsdt(lock.amount)} USDT, ${label}`">
    <div class="row">
      <p class="amount num">{{ formatUsdt(lock.amount) }} <span class="muted">USDT</span></p>
      <span class="pill" :class="status">{{ label }}</span>
    </div>
    <p class="muted when">
      <template v-if="status === 'sealed'">Opens in <span class="num">{{ remaining }}</span> · {{ formatDate(lock.unlockAt) }}</template>
      <template v-else-if="status === 'ripe'">Opened {{ formatDate(lock.unlockAt) }}</template>
      <template v-else>Returned to your wallet</template>
    </p>
  </article>
</template>

<style scoped>
.lock { display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.amount { font-size: 22px; font-weight: 700; }
.when { font-size: 14px; }
</style>
