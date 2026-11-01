<script setup lang="ts">
import { computed } from 'vue'

// progress: 0..1 of time elapsed, or null when the start time is unknown. The arc shows time remaining,
// so a fresh lock is a full ring that drains toward the unlock date. Unknown start: full ring.
const props = withDefaults(defineProps<{ progress: number | null; status: 'sealed' | 'ripe' | 'withdrawn'; size?: number }>(), { size: 56 })
const R = 24
const C = 2 * Math.PI * R
const dash = computed(() => {
  if (props.status !== 'sealed') return 0
  if (props.progress === null) return 0
  return C * Math.min(1, Math.max(0, props.progress))
})
const color = computed(() => ({ sealed: 'var(--sealed)', ripe: 'var(--ripe)', withdrawn: 'var(--line)' })[props.status])
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 56 56" aria-hidden="true" class="ring">
    <circle cx="28" cy="28" :r="R" fill="none" stroke="var(--surface-2)" stroke-width="5" />
    <circle
      cx="28" cy="28" :r="R" fill="none" :stroke="color" stroke-width="5" stroke-linecap="round"
      :stroke-dasharray="C" :stroke-dashoffset="dash" transform="rotate(-90 28 28)" class="arc"
    />
    <g v-if="status === 'sealed'" :fill="color">
      <rect x="20" y="27" width="16" height="11" rx="3" />
      <path d="M23.5 27v-3a4.5 4.5 0 0 1 9 0v3" fill="none" :stroke="color" stroke-width="2.4" stroke-linecap="round" />
    </g>
    <g v-else-if="status === 'ripe'" :fill="color">
      <rect x="20" y="27" width="16" height="11" rx="3" />
      <path d="M23.5 27v-3a4.5 4.5 0 0 1 8.6-1.8" fill="none" :stroke="color" stroke-width="2.4" stroke-linecap="round" />
    </g>
    <path v-else d="M21 28.5l4.5 4.5L35 23.5" fill="none" stroke="var(--ink-faint)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.arc { transition: stroke-dashoffset 0.6s var(--ease); }
.ring { flex: none; }
</style>
