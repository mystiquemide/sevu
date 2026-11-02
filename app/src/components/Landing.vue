<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowRight, Download, UserRound, LayoutGrid } from 'lucide-vue-next'
import Envelope from './Envelope.vue'
import Wordmark from './Wordmark.vue'
import { formatUsdt } from '../lib/format'
import { readProof, type ProofStats } from '../lib/proof'

const props = defineProps<{ now: number }>()
defineEmits<{ proof: [] }>()

// Official links from nimiq.com. The open link is a universal link: with Nimiq Pay installed, the phone opens Sevu inside it.
const APP_STORE = 'https://apps.apple.com/app/id6471844738'
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.nimiq.pay'
const OPEN_IN_PAY = `https://nimpay.app/miniapps/open/${typeof location !== 'undefined' ? location.host : 'sevu.midelabs.xyz'}`

const stats = ref<ProofStats | null>(null)
onMounted(async () => {
  try {
    stats.value = await readProof()
  } catch {
    // The proof section still links to the live page; the numbers just stay hidden.
  }
})

const day = 86_400
const steps = [
  { icon: Download, title: 'Get Nimiq Pay', body: 'Free on iPhone and Android. It is the wallet Sevu runs inside.' },
  { icon: UserRound, title: 'Create your account', body: 'Nimiq Pay sets up your wallet on your phone. Your keys never leave it.' },
  { icon: LayoutGrid, title: 'Open Sevu', body: 'Tap the button below on your phone, or find Sevu in the Mini Apps section of Nimiq Pay.' },
]
</script>

<template>
  <div class="landing">
    <nav class="wrap nav">
      <Wordmark />
      <div class="navlinks">
        <a href="#how">How it works</a>
        <a href="#proof" @click.prevent="$emit('proof')">Proof</a>
        <a class="pill" href="#start">Get started</a>
      </div>
    </nav>

    <header class="wrap hero">
      <div class="copy">
        <p class="eyebrow">A savings mini app for Nimiq Pay</p>
        <h1>Savings nobody can touch. <em>Not even us.</em></h1>
        <p class="lede">Seal USDT in an envelope with a date on it. It sits in a public contract with no owner and no admin, so it opens on that date and not a minute before. Locking is free.</p>
        <div class="ctas">
          <a class="btn cta" href="#start">Start saving <ArrowRight :size="18" aria-hidden="true" /></a>
          <button class="btn secondary cta" @click="$emit('proof')">See the proof on chain</button>
        </div>
        <p class="meta">No gas · No sign-up form · Keys stay on your phone</p>
      </div>
      <div class="art" aria-hidden="true">
        <div class="env back"><Envelope :amount="350_000_000n" :unlock-at="props.now + 92 * day" title="School fees" :now="props.now" :progress="0.12" /></div>
        <div class="env front"><Envelope :amount="120_000_000n" :unlock-at="props.now + 21 * day" title="Rent" :now="props.now" :progress="0.32" /></div>
      </div>
    </header>

    <section class="dark">
      <div class="wrap stackl">
        <p class="quote">“I’ll just borrow it from savings.”</p>
        <p class="body light">Money in your wallet is always one tap from being spent. Savings apps fix that by holding your money for you, which means trusting whoever holds it not to freeze it, lose it or move it.</p>
        <div class="compare">
          <div class="cmp"><p class="k">Wallet</p><p class="v">Always spendable</p></div>
          <div class="cmp"><p class="k">Savings app</p><p class="v">Holds your money in its own wallet</p></div>
          <div class="cmp us"><p class="k">Sevu</p><p class="v">Public contract. No owner. Opens on your date.</p></div>
        </div>
      </div>
    </section>

    <section id="how" class="wrap stackl">
      <p class="kicker">How it works</p>
      <h2>Seal it, wait, open it.</h2>
      <ol class="cards three">
        <li class="card"><span class="n">01</span><h3>Seal</h3><p>Pick an amount and an unlock date. Sign once in Nimiq Pay. We pay the gas.</p></li>
        <li class="card"><span class="n">02</span><h3>Wait</h3><p>Your envelope counts down. Nobody can open it early, not you on a bad day and not us.</p></li>
        <li class="card"><span class="n">03</span><h3>Open</h3><p>On the date, one tap sends it back to your wallet. Only ever to you.</p></li>
      </ol>
    </section>

    <section id="proof" class="paper">
      <div class="wrap stackl">
        <p class="kicker">Don’t trust us. Check.</p>
        <h2>Every claim is on chain.</h2>
        <div class="stats">
          <div class="card stat"><p>Locks</p><strong>{{ stats ? stats.locks : '…' }}</strong></div>
          <div class="card stat"><p>Savers</p><strong>{{ stats ? stats.owners : '…' }}</strong></div>
          <div class="card stat"><p>Locked now</p><strong>{{ stats ? `${formatUsdt(stats.locked)} USDT` : '…' }}</strong></div>
          <div class="card stat"><p>Admin keys</p><strong class="wax">0</strong></div>
        </div>
        <p class="meta">Read live from Polygon each time this page loads.</p>
        <button class="btn secondary fit" @click="$emit('proof')">Open the live proof page</button>
      </div>
    </section>

    <section id="start" class="wrap stackl">
      <p class="kicker">Get started</p>
      <h2>Three steps. About two minutes.</h2>
      <ol class="cards three">
        <li v-for="(s, i) in steps" :key="s.title" class="card step">
          <span class="ico"><component :is="s.icon" :size="20" aria-hidden="true" /></span>
          <span class="n">Step {{ i + 1 }}</span>
          <h3>{{ s.title }}</h3>
          <p>{{ s.body }}</p>
          <div v-if="i === 0" class="stores">
            <a class="store" :href="APP_STORE" target="_blank" rel="noopener">App Store</a>
            <a class="store" :href="PLAY_STORE" target="_blank" rel="noopener">Google Play</a>
          </div>
          <a v-if="i === 2" class="btn" :href="OPEN_IN_PAY">Open Sevu in Nimiq Pay</a>
        </li>
      </ol>
    </section>

    <section class="close">
      <div class="wrap center">
        <p class="big">Future you says thanks.</p>
        <p class="sub">Present you can’t touch it. That’s the point.</p>
        <a class="btn white" href="#start">Start saving</a>
      </div>
    </section>

    <footer class="wrap foot">
      <span class="meta">No owner. No admin. No upgrades.</span>
      <span class="meta">Built for the Nimiq Mini Apps Competition</span>
    </footer>
  </div>
</template>

<style scoped>
.landing { width: 100vw; margin-left: calc(50% - 50vw); margin-top: calc(-1 * (env(safe-area-inset-top) + 16px)); background: #f6f2ea; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
.nav { display: flex; align-items: center; justify-content: space-between; min-height: 76px; }
.navlinks { display: flex; align-items: center; gap: 24px; }
.navlinks a { text-decoration: none; color: var(--text-2); min-height: 44px; display: inline-flex; align-items: center; }
.navlinks .pill { padding: 0 16px; border-radius: var(--r-control); background: var(--wax); color: #fff; }
.hero { display: grid; grid-template-columns: 1.05fr 1fr; gap: 48px; align-items: center; padding-top: 40px; padding-bottom: 96px; }
.eyebrow { display: inline-block; font-family: var(--mono); font-size: 13px; color: var(--wax); background: var(--wax-soft); padding: 4px 12px; border-radius: 99px; }
.copy { display: flex; flex-direction: column; gap: 24px; align-items: flex-start; }
h1 { font-size: clamp(44px, 6.4vw, 84px); line-height: 1.02; letter-spacing: -0.035em; }
h1 em { display: block; font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; color: var(--wax); letter-spacing: -0.01em; font-size: 1.08em; }
.lede { font-size: 19px; line-height: 30px; color: var(--text-2); max-width: 520px; }
.ctas { display: flex; gap: 12px; flex-wrap: wrap; }
.cta { width: auto; text-decoration: none; }
.art { position: relative; min-height: 440px; }
.env { position: absolute; width: min(440px, 92%); }
.env.back { top: 0; right: 0; transform: rotate(5deg); opacity: 0.85; }
.env.front { bottom: 0; left: 0; transform: rotate(-3deg); filter: drop-shadow(0 24px 40px rgba(60, 40, 20, 0.16)); }
.dark { background: #1c1a17; color: #f6f2ea; padding: 96px 0; }
.stackl { display: flex; flex-direction: column; gap: 24px; padding-top: 96px; padding-bottom: 96px; }
.dark .stackl, .paper .stackl, .close .wrap { padding-top: 0; padding-bottom: 0; }
.quote { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-size: clamp(36px, 5vw, 64px); line-height: 1.1; }
.body { font-size: 19px; line-height: 30px; max-width: 760px; }
.light { color: #bdb6aa; }
.compare { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
.cmp { background: #2a2724; border-radius: var(--r-card); padding: 24px; display: flex; flex-direction: column; gap: 8px; }
.cmp.us { background: var(--wax); }
.k { font-family: var(--mono); font-size: 12px; color: #9b948a; text-transform: uppercase; letter-spacing: 0.08em; }
.us .k { color: #ffd9d4; }
.v { font-size: 20px; line-height: 28px; font-weight: 500; }
.kicker { font-family: var(--mono); font-size: 13px; color: var(--wax); text-transform: uppercase; letter-spacing: 0.1em; }
h2 { font-size: clamp(32px, 4.4vw, 56px); line-height: 1.08; letter-spacing: -0.03em; }
.cards { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 16px; }
.three { grid-template-columns: repeat(3, 1fr); }
.cards .card { display: flex; flex-direction: column; gap: 10px; padding: 28px; }
.n { font-family: var(--mono); font-size: 13px; color: var(--wax); }
h3 { font-size: 26px; line-height: 32px; letter-spacing: -0.01em; }
.cards p { color: var(--text-2); font-size: 16px; line-height: 25px; }
.paper { background: var(--paper); padding: 96px 0; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 8px; }
.stat { display: flex; flex-direction: column; gap: 6px; }
.stat p { color: var(--text-2); font-size: 14px; }
.stat strong { font-size: 32px; line-height: 38px; font-weight: 500; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.wax { color: var(--wax); }
.fit { width: auto; align-self: flex-start; }
.step .btn { margin-top: auto; text-decoration: none; }
.ico { width: 40px; height: 40px; border-radius: 12px; background: var(--wax-soft); color: var(--wax); display: grid; place-items: center; }
.stores { display: flex; gap: 8px; margin-top: auto; flex-wrap: wrap; }
.store { min-height: 44px; display: inline-flex; align-items: center; padding: 0 16px; border-radius: var(--r-control); background: var(--text); color: #fff; text-decoration: none; font-weight: 500; }
.close { background: var(--wax); color: #fff; padding: 96px 0; }
.center { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; }
.big { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-size: clamp(44px, 6vw, 76px); line-height: 1.05; }
.sub { color: #ffd9d4; font-size: 19px; }
.btn.white { background: #fff; color: var(--wax); width: auto; text-decoration: none; margin-top: 8px; }
.btn.white:hover { background: #fff5f3; }
.foot { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 32px; padding-bottom: 40px; }
@media (max-width: 860px) {
  .hero { grid-template-columns: 1fr; padding-bottom: 64px; }
  .art { min-height: 330px; }
  .three, .compare { grid-template-columns: 1fr; }
  .stats { grid-template-columns: 1fr 1fr; }
  .navlinks a:not(.pill) { display: none; }
  .stackl { padding-top: 64px; padding-bottom: 64px; }
  .dark, .paper, .close { padding: 64px 0; }
  .ctas, .ctas .cta { width: 100%; }
}
</style>
