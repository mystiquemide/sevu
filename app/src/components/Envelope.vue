<script setup lang="ts">
import { computed } from 'vue'
import { formatDate, formatRemaining, formatUsdt } from '../lib/format'
import { stampParts } from '../lib/stamp'
import Postmark from './Postmark.vue'

/**
 * The moment: a lock drawn as a sealed paper envelope with a dated postmark.
 * stamped=false shows the dotted spot where the postmark will land (review step).
 */
const props = withDefaults(
  defineProps<{
    amount: bigint
    unlockAt: bigint | number
    title: string
    status?: 'sealed' | 'ripe' | 'withdrawn'
    now: number
    progress?: number | null
    stamped?: boolean
    press?: boolean
    refused?: boolean
  }>(),
  { status: 'sealed', progress: null, stamped: true, press: false, refused: false },
)

const stampDate = computed(() => { const p = stampParts(props.unlockAt); return `${p.day} ${p.month} ${p.year}` })
const left = computed(() => Number(props.unlockAt) - props.now)
const tone = computed(() => ({ sealed: 'wax', ripe: 'ready', withdrawn: 'muted' } as const)[props.status])
const fill = computed(() => {
  if (props.status !== 'sealed') return 1
  if (props.progress === null) return null
  return Math.min(1, Math.max(0.02, props.progress))
})
const caption = computed(() => {
  if (props.status === 'ripe') return 'Ready to open'
  if (props.status === 'withdrawn') return 'Opened'
  return left.value > 0 ? `Opens in ${formatRemaining(left.value)}` : 'Opening now'
})
</script>

<template>
  <div class="envelope" :class="status">
    <svg class="flap" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="0,0 50,24 100,0" fill="none" stroke="var(--paper-line)" stroke-width="1" vector-effect="non-scaling-stroke" />
    </svg>

    <div class="stamp-slot">
      <Postmark v-if="stamped" :date="unlockAt" :tone="tone" :size="96" :press="press" />
      <div v-else class="stamp-placeholder" aria-hidden="true" />
    </div>

    <div class="content">
      <p class="title">{{ title }}</p>
      <p class="figure">{{ formatUsdt(amount) }}<span class="unit">USDT</span></p>
    </div>

    <div class="foot">
      <div class="track" aria-hidden="true"><i v-if="fill !== null" :style="{ transform: `scaleX(${fill})` }" /></div>
      <div class="row">
        <span class="small" :class="status === 'ripe' ? 'ready-text' : 'secondary'">{{ caption }}</span>
        <span class="meta">{{ formatDate(unlockAt) }}</span>
      </div>
    </div>

    <div v-if="refused" class="refusal" role="img" :aria-label="`Not before ${formatDate(unlockAt)}`">
      <span>Not before</span>
      <b>{{ stampDate }}</b>
    </div>
  </div>
</template>

<style scoped>
.envelope {
  position: relative; overflow: hidden; background: var(--paper); border: 1px solid var(--paper-line);
  border-radius: var(--r-card); box-shadow: var(--shadow-float); padding: 64px 20px 20px; min-height: 232px;
  display: flex; flex-direction: column; justify-content: space-between; gap: 20px;
}
.envelope.withdrawn { background: var(--card); box-shadow: var(--shadow-sm); }
.flap { position: absolute; left: 0; top: 0; width: 100%; height: 48px; }
.stamp-slot { position: absolute; top: 12px; right: 12px; }
.stamp-placeholder { width: 96px; height: 96px; border-radius: 50%; border: 1.5px dashed var(--paper-line); }
.content { display: flex; flex-direction: column; gap: 4px; padding-right: 104px; }
.title { font-size: 15px; line-height: 20px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foot { display: flex; flex-direction: column; gap: 8px; }
.track { height: 4px; border-radius: 2px; background: var(--paper-line); overflow: hidden; }
.track i { display: block; height: 100%; background: var(--wax); transform-origin: left; transition: transform 500ms var(--ease); }
.ripe .track i { background: var(--ready); }
.withdrawn .track i { background: var(--text-3); opacity: 0.4; }
.ready-text { color: var(--ready); }
.refusal {
  position: absolute; right: 20px; top: 116px; display: flex; white-space: nowrap; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 16px; border: 2.5px solid var(--wax); border-radius: var(--r-sm); color: var(--wax);
  font-family: var(--mono); background: rgba(251, 248, 242, 0.92); transform: rotate(-6deg);
  animation: refuse 420ms var(--ease) both;
}
.refusal span { font-size: 12px; line-height: 16px; letter-spacing: 0.08em; text-transform: uppercase; }
.refusal b { font-size: 15px; line-height: 20px; font-weight: 500; }
@keyframes refuse {
  from { opacity: 0; transform: rotate(-12deg) scale(1.3); }
}
</style>
