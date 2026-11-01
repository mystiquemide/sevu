<script setup lang="ts">
import { computed } from 'vue'
import type { LockRecord } from '../lib/chain'
import { formatDate, formatRemaining, formatUsdt } from '../lib/format'
import { lockProgress, lockStatus, lockTitle, statusLabel } from '../lib/lockView'
import Ring from './Ring.vue'

const props = defineProps<{ lock: LockRecord; now: number; version: number }>()
defineEmits<{ open: [] }>()

const status = computed(() => lockStatus(props.lock, props.now))
// version forces a re-read of local labels after they change.
const title = computed(() => (props.version, lockTitle(props.lock)))
const progress = computed(() => (props.version, lockProgress(props.lock, props.now)))
const subtitle = computed(() => {
  if (status.value === 'sealed') return `Opens in ${formatRemaining(Number(props.lock.unlockAt) - props.now)}`
  if (status.value === 'ripe') return 'Ready to withdraw'
  return `Opened ${formatDate(props.lock.unlockAt)}`
})
</script>

<template>
  <button class="card lock fade-in" type="button" @click="$emit('open')"
    :aria-label="`${title}: ${formatUsdt(lock.amount)} USDT, ${statusLabel[status]}. ${subtitle}`">
    <Ring :progress="progress" :status="status" :size="48" />
    <span class="body">
      <span class="title">{{ title }}</span>
      <span class="sub muted small num">{{ subtitle }}</span>
    </span>
    <span class="right">
      <span class="amount num">{{ formatUsdt(lock.amount) }}</span>
      <span class="pill" :class="status">{{ statusLabel[status] }}</span>
    </span>
  </button>
</template>

<style scoped>
.lock { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; padding: 14px 16px; }
.lock:active { transform: scale(0.99); }
.body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.title { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.amount { font-weight: 700; font-size: 17px; }
</style>
