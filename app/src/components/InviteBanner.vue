<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import { formatDate, formatUsdt } from '../lib/format'
import { readInvite, rememberInvite, type Invite } from '../lib/invite'
import Postmark from './Postmark.vue'

// Shown when someone arrives from a friend's shared lock. Every figure comes from the chain, not the link.
const invite = ref<Invite | null>(null)
onMounted(async () => {
  const ref_ = rememberInvite(typeof location !== 'undefined' ? location.search : '')
  if (ref_) invite.value = await readInvite(ref_)
})
</script>

<template>
  <aside v-if="invite" class="invite" aria-label="Shared lock">
    <Postmark :date="invite.unlockAt" :size="64" :tone="invite.withdrawn ? 'ready' : 'wax'" decorative />
    <div class="txt">
      <p v-if="!invite.withdrawn"><strong>A friend sealed {{ formatUsdt(invite.amount) }} USDT until {{ formatDate(invite.unlockAt) }}.</strong> Nobody can open it early, not even Sevu.</p>
      <p v-else><strong>A friend saved {{ formatUsdt(invite.amount) }} USDT with Sevu</strong> and got it back on the date.</p>
      <a class="check" :href="`https://polygonscan.com/address/${invite.contract}#readContract`" target="_blank" rel="noopener">Lock #{{ invite.id }} on Polygon <ExternalLink :size="14" aria-hidden="true" /></a>
    </div>
  </aside>
</template>

<style scoped>
.invite { display: flex; gap: 16px; align-items: center; padding: 16px 20px; border-radius: var(--r-card); background: var(--paper); box-shadow: inset 0 0 0 1px var(--paper-line); }
.txt { display: flex; flex-direction: column; gap: 2px; font-size: 15px; line-height: 22px; color: var(--text-2); }
.txt strong { color: var(--text); font-weight: 500; }
.check { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; font-family: var(--mono); font-size: 12px; color: var(--text-3); text-decoration: none; }
</style>
