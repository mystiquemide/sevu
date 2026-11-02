<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
import Envelope from './Envelope.vue'
import Wordmark from './Wordmark.vue'
import { formatDate } from '../lib/format'

// A still product shot: the real Sevu home screen inside Nimiq Pay, rendered from the app's own components.
const props = defineProps<{ now: number }>()
const day = 86_400
const rent = props.now + 21 * day
</script>

<template>
  <figure class="shot">
  <div class="stage" aria-hidden="true">
    <div class="phone">
      <div class="island" />
      <div class="screen">
        <div class="status"><span>9:41</span><span class="sig"><i /><i /><i /></span></div>
        <div class="app">
          <div class="top"><Wordmark /><span class="addr">0x8D3a...F74A</span></div>
          <div class="modes"><span class="on">USDT locks</span><span>NIM jars</span></div>
          <div class="total">
            <p class="label">Locked in Sevu</p>
            <p class="figure">470.00<span class="unit">USDT</span></p>
            <p class="meta">38.50 USDT available</p>
          </div>
          <div class="btnmock">Lock USDT</div>
          <p class="section-title">Your locks</p>
          <Envelope :amount="120_000_000n" :unlock-at="rent" title="Rent" :now="props.now" :progress="0.32" />
          <Envelope :amount="350_000_000n" :unlock-at="props.now + 92 * day" title="School fees" :now="props.now" :progress="0.12" />
        </div>
      </div>
    </div>
    <div class="satellite">
      <span class="ico"><Lock :size="16" /></span>
      <div>
        <p class="st">Early withdrawal refused</p>
        <p class="sb">Rent opens {{ formatDate(rent) }}</p>
      </div>
    </div>
  </div>
  <figcaption class="cap">Example screen with sample amounts. Live totals are on the proof page.</figcaption>
  </figure>
</template>

<style scoped>
.shot { margin: 0; }
.cap { text-align: center; font-family: var(--mono); font-size: 12px; color: var(--text-3); margin-top: 8px; }
/* The phone fills the stage and runs off its foot; the satellite straddles the phone's left edge. */
.stage { position: relative; height: 660px; overflow: hidden; -webkit-mask: linear-gradient(#000 90%, #0000); mask: linear-gradient(#000 90%, #0000); }
.phone { position: absolute; left: 50%; top: 8px; width: 340px; height: 700px; margin-left: -170px; border-radius: 52px; background: #121110; padding: 10px;
  box-shadow: 0 0 0 1px #3a3631 inset, 0 30px 60px rgba(40, 28, 12, 0.18), 0 4px 10px rgba(40, 28, 12, 0.1); }
.island { position: absolute; top: 22px; left: 50%; width: 96px; height: 28px; margin-left: -48px; border-radius: 14px; background: #000; z-index: 2; }
.screen { height: 100%; border-radius: 42px; background: var(--page); overflow: hidden; }
.status { display: flex; justify-content: space-between; align-items: center; padding: 18px 28px 0; height: 50px; font-size: 14px; font-weight: 500; }
.sig { display: flex; gap: 2px; align-items: flex-end; }
.sig i { display: block; width: 4px; border-radius: 1px; background: var(--text); }
.sig i:nth-child(1) { height: 6px; } .sig i:nth-child(2) { height: 9px; } .sig i:nth-child(3) { height: 12px; }
.app { padding: 12px 18px; display: flex; flex-direction: column; gap: 14px; }
.top { display: flex; justify-content: space-between; align-items: center; }
.addr { font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.modes { display: grid; grid-template-columns: 1fr 1fr; padding: 3px; border-radius: 10px; background: var(--raised); font-size: 13px; color: var(--text-2); text-align: center; }
.modes span { padding: 7px 0; border-radius: 8px; }
.modes .on { background: var(--card); color: var(--text); box-shadow: var(--shadow-sm); }
.total { display: flex; flex-direction: column; gap: 2px; }
.total .figure { font-size: 34px; line-height: 40px; }
.btnmock { height: 42px; border-radius: var(--r-control); background: var(--wax); color: #fff; display: grid; place-items: center; font-weight: 500; font-size: 14px; }
.app :deep(.envelope) { font-size: 13px; }
.satellite { position: absolute; left: calc(50% - 170px - 56px); top: 488px; display: flex; gap: 12px; align-items: center; padding: 14px 18px 14px 14px; border-radius: 14px;
  background: var(--card); box-shadow: 0 0 0 1px var(--line), 0 16px 32px rgba(40, 28, 12, 0.14); transform: rotate(-2deg); }
.ico { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; background: var(--wax-soft); color: var(--wax); }
.st { font-size: 14px; font-weight: 500; line-height: 20px; }
.sb { font-family: var(--mono); font-size: 11px; color: var(--text-3); line-height: 16px; }
@media (max-width: 860px) {
  .stage { height: 640px; }
  .phone { width: 320px; margin-left: -160px; }
  .satellite { left: 0; top: 500px; }
}
</style>
