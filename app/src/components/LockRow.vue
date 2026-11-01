<script setup lang="ts">
import { computed } from 'vue'
import type { LockRecord } from '../lib/chain'
import { formatDate, formatRemaining, formatUsdt } from '../lib/format'
import { lockStatus, lockTitle, statusLabel } from '../lib/lockView'
import Postmark from './Postmark.vue'

const props = defineProps<{ lock: LockRecord; now: number; version: number }>()
defineEmits<{ open: [] }>()

const status = computed(() => lockStatus(props.lock, props.now))
const title = computed(() => (props.version, lockTitle(props.lock)))
const subtitle = computed(() => {
  if (status.value === 'sealed') return `Opens in ${formatRemaining(Number(props.lock.unlockAt) - props.now)}`
  if (status.value === 'ripe') return 'Ready to open'
  return `Opened ${formatDate(props.lock.unlockAt)}`
})
const tone = computed(() => ({ sealed: 'wax', ripe: 'ready', withdrawn: 'muted' } as const)[status.value])
</script>

<template>
  <button class="lock-row" type="button" @click="$emit('open')"
    :aria-label="`${title}: ${formatUsdt(lock.amount)} USDT, ${statusLabel[status]}. ${subtitle}`">
    <Postmark :date="lock.unlockAt" :tone="tone" :size="44" :ring="false" />
    <span class="body">
      <span class="title">{{ title }}</span>
      <span class="small" :class="status === 'ripe' ? 'ready-text' : 'secondary'">{{ subtitle }}</span>
    </span>
    <span class="amount num">{{ formatUsdt(lock.amount) }}</span>
  </button>
</template>

<style scoped>
.lock-row {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 72px; padding: 12px 16px 12px 12px;
  border: 0; border-radius: var(--r-control); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
  transition: background-color 150ms var(--ease);
}
.lock-row:hover { background: var(--raised); }
.body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amount { font-family: var(--mono); font-size: 15px; }
.ready-text { color: var(--ready); }
</style>
