<script setup lang="ts">
import { ref } from 'vue'
import Envelope from './Envelope.vue'
import InviteBanner from './InviteBanner.vue'

defineProps<{ now: number }>()
const emit = defineEmits<{ trial: []; proof: []; skip: [] }>()
const step = ref(0)
</script>

<template>
  <section class="section enter intro" aria-roledescription="introduction">
    <p class="meta count">{{ step + 1 }} of 3</p>
    <InviteBanner v-if="step === 0" />

    <div v-if="step === 0" class="group">
      <h1 class="page-title">Your rent money is one tap away from becoming new shoes</h1>
      <p class="secondary">Money in your wallet is always spendable. That's great for paying, and terrible for saving.</p>
      <Envelope :amount="120_000_000n" :unlock-at="now + 21 * 86_400" title="Rent" :now="now" :progress="0.3" />
    </div>

    <div v-else-if="step === 1" class="group">
      <h1 class="page-title">Every savings lock asks you to trust someone</h1>
      <p class="secondary">Banks and savings apps hold the money for you. Whoever holds it can freeze it, lose it or move it.</p>
      <ul class="points">
        <li>A savings app holds your money in its own wallet</li>
        <li>Sevu puts it in a public contract with no owner</li>
      </ul>
    </div>

    <div v-else class="group">
      <h1 class="page-title">So we built Sevu</h1>
      <p class="secondary">Lock USDT until a date you choose. Nobody can move it early, not even us. Locking is free, and anyone can check every claim on chain.</p>
      <ul class="points">
        <li>No owner, no admin, no upgrades</li>
        <li>No gas needed to lock</li>
        <li>Funds can only ever go back to you</li>
      </ul>
    </div>

    <div class="stack">
      <button v-if="step < 2" class="btn" @click="step++">Next</button>
      <template v-else>
        <button class="btn" @click="emit('trial')">Try a 15-minute lock with 1 USDT</button>
        <button class="btn secondary" @click="emit('proof')">See the proof</button>
      </template>
      <button class="link skip" @click="emit('skip')">{{ step < 2 ? 'Skip' : 'Go to my savings' }}</button>
    </div>
  </section>
</template>

<style scoped>
.count { letter-spacing: 0.04em; }
.points { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.points li { padding: 12px 16px; border-radius: var(--r-control); background: var(--paper); box-shadow: inset 0 0 0 1px var(--paper-line); }
.skip { align-self: center; }
</style>
