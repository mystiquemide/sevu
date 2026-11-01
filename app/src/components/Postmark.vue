<script setup lang="ts">
import { computed } from 'vue'
import { stampParts } from '../lib/stamp'

// The signature detail: a round postmark carrying the unlock date. Used on locks, at sealing and nowhere else.
const props = withDefaults(
  defineProps<{ date: bigint | number; tone?: 'wax' | 'ready' | 'muted'; size?: number; ring?: boolean; waves?: boolean; press?: boolean; decorative?: boolean }>(),
  { tone: 'wax', size: 96, ring: true, waves: false, press: false, decorative: false },
)
const parts = computed(() => stampParts(props.date))
const color = computed(() => ({ wax: 'var(--wax)', ready: 'var(--ready)', muted: 'var(--text-3)' })[props.tone])
const uid = `pm-${Math.random().toString(36).slice(2, 8)}`
const width = computed(() => (props.waves ? props.size * 1.7 : props.size))
</script>

<template>
  <svg
    class="postmark" :class="{ press }" :width="width" :height="size" :viewBox="waves ? '0 0 170 100' : '0 0 100 100'"
    :role="decorative ? undefined : 'img'" :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="decorative ? undefined : `Postmark ${parts.day} ${parts.month} ${parts.year}`" :style="{ color }"
  >
    <defs><path :id="uid" d="M 13 50 A 37 37 0 0 1 87 50" /></defs>
    <g class="ink" fill="none" stroke="currentColor">
      <circle cx="50" cy="50" r="46" stroke-width="2.5" />
      <circle v-if="ring" cx="50" cy="50" r="30" stroke-width="1.2" />
      <path v-if="waves" d="M 100 34 q 8 -6 16 0 t 16 0 t 16 0 t 16 0 M 100 50 q 8 -6 16 0 t 16 0 t 16 0 t 16 0 M 100 66 q 8 -6 16 0 t 16 0 t 16 0 t 16 0" stroke-width="2.2" stroke-linecap="round" />
    </g>
    <g class="ink" fill="currentColor" font-family="IBM Plex Mono, ui-monospace, monospace" text-anchor="middle">
      <text v-if="ring" font-size="8" letter-spacing="1.5"><textPath :href="`#${uid}`" startOffset="50%">SEVU · SEALED</textPath></text>
      <text x="50" :y="ring ? 54 : 52" :font-size="ring ? 20 : 30" font-weight="500">{{ parts.day }}</text>
      <text x="50" :y="ring ? 68 : 72" :font-size="ring ? 8.5 : 14" letter-spacing="1">{{ parts.month }}{{ ring ? ` ${parts.year}` : '' }}</text>
    </g>
  </svg>
</template>

<style scoped>
.postmark { display: block; flex: none; transform: rotate(-8deg); }
.ink { opacity: 0.9; }
.press { animation: press 420ms var(--ease) both; transform-origin: 50% 50%; }
@keyframes press {
  0% { opacity: 0; transform: rotate(-14deg) scale(1.3); }
  100% { opacity: 1; transform: rotate(-8deg) scale(1); }
}
</style>
