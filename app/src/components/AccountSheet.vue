<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Check, Copy, X } from 'lucide-vue-next'

const props = defineProps<{ address: string; network: 'polygon' | 'nimiq' }>()
const emit = defineEmits<{ close: [] }>()
const copied = ref(false)
const panel = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

// Groups of four make a long address checkable by eye against Nimiq Pay. Nimiq addresses already come grouped.
const isEvm = props.network === 'polygon'
const prefix = isEvm ? '0x' : ''
const grouped = isEvm ? props.address.slice(2).match(/.{1,4}/g)!.join(' ') : props.address

async function copy() {
  try {
    await navigator.clipboard.writeText(props.address)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    // Clipboard blocked: the address is still selectable on screen.
  }
}

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }
onMounted(async () => {
  document.addEventListener('keydown', onKey)
  await nextTick()
  panel.value?.focus()
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  clearTimeout(timer)
})
</script>

<template>
  <div class="scrim" @click="emit('close')" />
  <div ref="panel" class="sheet" role="dialog" aria-modal="true" aria-labelledby="account-title" tabindex="-1">
    <div class="row">
      <h2 id="account-title" class="section-title">{{ isEvm ? 'Your Polygon wallet' : 'Your Nimiq account' }}</h2>
      <button class="icon-btn" aria-label="Close" @click="emit('close')"><X :size="18" :stroke-width="1.5" /></button>
    </div>
    <p class="address"><span v-if="prefix" class="muted">{{ prefix }}</span>{{ grouped }}</p>
    <button class="btn secondary" @click="copy">
      <component :is="copied ? Check : Copy" :size="16" :stroke-width="1.5" />
      {{ copied ? 'Copied' : 'Copy address' }}
    </button>
    <p class="secondary small">
      {{ isEvm
        ? 'USDT locks use the Polygon account selected in Nimiq Pay. To use another account, switch it in Nimiq Pay and Sevu follows.'
        : 'NIM jars use this Nimiq account from Nimiq Pay. If Nimiq Pay shares several, pick one on the jars screen.' }}
    </p>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.28); z-index: 10; animation: fade 200ms var(--ease) both; }
.sheet {
  position: fixed; left: 50%; bottom: 0; width: min(480px, 100%); transform: translateX(-50%); z-index: 11;
  display: flex; flex-direction: column; gap: 16px; padding: 20px 20px calc(env(safe-area-inset-bottom) + 24px);
  background: var(--card); border-radius: 20px 20px 0 0; box-shadow: var(--shadow-float);
  animation: rise 300ms var(--ease) both;
}
.sheet:focus-visible { outline: none; }
.address { font-family: var(--mono); font-size: 15px; line-height: 24px; word-spacing: 2px; overflow-wrap: anywhere; padding: 12px 16px; background: var(--raised); border-radius: var(--r-control); }
.icon-btn { width: 44px; height: 44px; margin: -12px -12px -12px 0; display: grid; place-items: center; border: 0; background: none; color: var(--text-2); cursor: pointer; border-radius: var(--r-control); }
.icon-btn:hover { background: var(--raised); }
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { transform: translate(-50%, 12px); opacity: 0; } }
</style>
