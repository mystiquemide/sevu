<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import HeroPhone from './HeroPhone.vue'
import Postmark from './Postmark.vue'
import Wordmark from './Wordmark.vue'
import { formatUsdt } from '../lib/format'
import { readProof, type ProofStats } from '../lib/proof'
import { config } from '../config'

const props = defineProps<{ now: number }>()
defineEmits<{ proof: [] }>()

// Official links from nimiq.com. The open link is a universal link: with Nimiq Pay installed, the phone opens Sevu inside it.
const APP_STORE = 'https://apps.apple.com/app/id6471844738'
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.nimiq.pay'
const OPEN_IN_PAY = `https://nimpay.app/miniapps/open/${typeof location !== 'undefined' ? location.host : 'sevu.midelabs.xyz'}`

const CONTRACT = `https://polygonscan.com/address/${config.lockAddress}`
const SOURCE = `https://repo.sourcify.dev/137/${config.lockAddress}`

// Desktop visitors can't open a phone app, so they get a QR code to scan instead.
const qr = ref<string | null>(null)
async function makeQr() {
  if (typeof window === 'undefined' || !window.matchMedia('(min-width: 861px) and (pointer: fine)').matches) return
  const { toDataURL } = await import('qrcode')
  qr.value = await toDataURL(OPEN_IN_PAY, { margin: 1, width: 224, color: { dark: '#171717', light: '#ffffff' } })
}

const stats = ref<ProofStats | null>(null)
const failed = ref(false)
onMounted(async () => {
  void makeQr()
  try {
    stats.value = await readProof()
  } catch {
    failed.value = true
  }
})
const ledger = computed(() => [
  { k: 'Locks', v: stats.value ? String(stats.value.locks) : null },
  { k: 'Savers', v: stats.value ? String(stats.value.owners) : null },
  { k: 'Locked now', v: stats.value ? `${formatUsdt(stats.value.locked)} USDT` : null },
  { k: 'Withdrawn', v: stats.value ? `${formatUsdt(stats.value.withdrawn)} USDT` : null },
  { k: 'Admin keys', v: '0', wax: true },
])
const day = 86_400
</script>

<template>
  <div class="landing">
    <a class="skip" href="#main">Skip to content</a>
    <nav class="wrap nav" aria-label="Main">
      <Wordmark />
      <div class="navlinks">
        <a href="#how">How it works</a>
        <a href="#proof">Proof</a>
        <a class="navbtn" href="#start">Get started</a>
      </div>
    </nav>

    <main id="main">
    <section class="wrap hero" aria-labelledby="hero-title">
      <div class="copy">
        <p class="kicker">A savings mini app for Nimiq Pay</p>
        <h1 id="hero-title">Savings nobody can touch <span class="serif">Not even us</span></h1>
        <p class="lede">Seal USDT in an envelope with a date on it. It sits in a public contract with no owner and no admin, so it opens on that date and not a minute before. Locking is free.</p>
        <div class="ctas">
          <a class="btn cta" href="#start">Start saving <ArrowRight :size="18" aria-hidden="true" /></a>
          <a class="btn secondary cta" href="#proof">See the proof</a>
        </div>
      </div>
      <HeroPhone class="art" :now="props.now" />
    </section>

    <section class="dark" aria-label="Why Sevu">
      <div class="wrap split">
        <div class="col">
          <p class="quote">“I’ll just borrow it from savings”</p>
          <p class="body">Money in your wallet is always one tap from being spent. Savings apps fix that by holding your money for you, which means trusting whoever holds it not to freeze it, lose it or move it.</p>
        </div>
        <dl class="compare">
          <div><dt>Wallet</dt><dd>Always spendable</dd></div>
          <div><dt>Savings app</dt><dd>Holds your money in its own wallet</dd></div>
          <div class="us"><dt>Sevu</dt><dd>A public contract with no owner. Opens on your date</dd></div>
        </dl>
      </div>
    </section>

    <section id="how" class="wrap block">
      <div class="head">
        <p class="kicker">How it works</p>
        <h2>Seal it, wait, open it</h2>
      </div>
      <ol class="timeline">
        <li><span class="dot">1</span><h3>Seal</h3><p>Pick an amount and an unlock date. Sign once in Nimiq Pay. We pay the gas.</p></li>
        <li><span class="dot">2</span><h3>Wait</h3><p>Your envelope counts down. Nobody can open it early, not you on a bad day and not us.</p></li>
        <li><span class="dot">3</span><h3>Open</h3><p>On the date, one tap sends it back to your wallet. Only ever to you.</p></li>
      </ol>
    </section>

    <section id="proof" class="paper">
      <div class="wrap split">
        <div class="col">
          <p class="kicker">Don’t trust us, check</p>
          <h2>Every claim is on chain</h2>
          <ul class="facts">
            <li>Contract source matched on Sourcify, with no owner, pause or upgrade function</li>
            <li>First gasless lock sent from Nimiq Pay on Polygon mainnet</li>
            <li>An early withdrawal refused by the contract itself</li>
          </ul>
          <button class="btn secondary fit" @click="$emit('proof')">Open the live proof page</button>
        </div>
        <figure class="slip">
          <figcaption class="sliphead">
            <span>Sevu ledger</span>
            <span>Polygon · live</span>
          </figcaption>
          <dl>
            <div v-for="r in ledger" :key="r.k" class="line">
              <dt>{{ r.k }}</dt>
              <span class="leader" aria-hidden="true" />
              <dd :class="{ wax: r.wax }">
                <template v-if="r.v">{{ r.v }}</template>
                <span v-else class="pending">{{ failed ? 'unavailable' : 'reading' }}</span>
              </dd>
            </div>
          </dl>
          <p class="slipfoot">Read from the contracts each time this page loads</p>
          <div class="slipstamp"><Postmark :date="props.now" :size="88" tone="ready" decorative /></div>
        </figure>
      </div>
    </section>

    <section id="start" class="wrap block split start">
      <div class="col">
        <p class="kicker">Get started</p>
        <h2>Three steps, about two minutes</h2>
        <p class="lede small">Sevu runs inside Nimiq Pay, a free wallet for iPhone and Android. Your keys stay on your phone.</p>
      </div>
      <ol class="steps">
        <li>
          <span class="dot">1</span>
          <div class="stepbody">
            <h3>Get Nimiq Pay</h3>
            <p>Download it from your app store.</p>
            <div class="stores">
              <a class="badge" :href="APP_STORE" target="_blank" rel="noopener"><img src="/badges/app-store.svg" alt="Download on the App Store" width="135" height="45" /></a>
              <a class="badge gp" :href="PLAY_STORE" target="_blank" rel="noopener"><img src="/badges/google-play.png" alt="Get it on Google Play" width="152" height="59" /></a>
            </div>
          </div>
        </li>
        <li>
          <span class="dot">2</span>
          <div class="stepbody">
            <h3>Create your account</h3>
            <p>Nimiq Pay sets up your wallet on your phone. Nothing to fill in for Sevu.</p>
          </div>
        </li>
        <li>
          <span class="dot">3</span>
          <div class="stepbody">
            <h3>Open Sevu</h3>
            <p>Tap below on your phone, or find Sevu in the Mini Apps section of Nimiq Pay.</p>
            <a class="btn fit" :href="OPEN_IN_PAY">Open Sevu in Nimiq Pay</a>
            <div v-if="qr" class="qr">
              <img :src="qr" alt="QR code that opens Sevu in Nimiq Pay" width="112" height="112" />
              <p class="meta">On a computer? Scan this with your phone camera to open Sevu in Nimiq Pay.</p>
            </div>
          </div>
        </li>
      </ol>
    </section>

    <section class="close" aria-label="Start saving">
      <div class="wrap closing">
        <Postmark :date="props.now + 365 * day" :size="120" decorative />
        <p class="big">Future you says thanks</p>
        <p class="sub">Present you can’t touch it. That’s the point.</p>
        <a class="btn fit" href="#start">Start saving</a>
      </div>
    </section>

    </main>

    <footer class="wrap foot">
      <span class="meta">No owner. No admin. No upgrades.</span>
      <span class="footlinks">
        <a class="meta" href="#/proof" @click.prevent="$emit('proof')">Proof page</a>
        <a class="meta" :href="CONTRACT" target="_blank" rel="noopener">Contract on Polygonscan</a>
        <a class="meta" :href="SOURCE" target="_blank" rel="noopener">Verified source</a>
      </span>
    </footer>
  </div>
</template>

<style scoped>
/* Landing surfaces lean warmer than the app: the post office counter. Chrome stays graphite, the envelopes carry the color. */
.landing { --counter: #f4f0e8; --ink: #1d1b18; width: 100vw; margin-left: calc(50% - 50vw); margin-top: calc(-1 * (env(safe-area-inset-top) + 16px)); background: var(--counter); }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
.nav { display: flex; align-items: center; justify-content: space-between; min-height: 80px; }
.navlinks { display: flex; align-items: center; gap: 28px; }
.navlinks a { text-decoration: none; color: var(--text-2); min-height: 44px; display: inline-flex; align-items: center; transition: color 150ms var(--ease); }
.navlinks a:hover { color: var(--text); }
.navlinks .navbtn { padding: 0 16px; border-radius: var(--r-control); background: var(--text); color: #fff; }
.navlinks .navbtn:hover { color: #fff; background: #000; }

.kicker { font-family: var(--mono); font-size: 13px; line-height: 20px; color: var(--wax-press); }
.serif { display: block; font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; color: var(--wax); letter-spacing: -0.01em; font-size: 1.1em; line-height: 1; margin-top: 4px; }

.hero { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; padding-top: 24px; }
.copy { display: flex; flex-direction: column; gap: 24px; align-items: flex-start; }
h1 { font-size: clamp(44px, 6vw, 80px); line-height: 1.02; letter-spacing: -0.035em; font-weight: 500; }
.lede { font-size: 19px; line-height: 30px; color: var(--text-2); max-width: 500px; }
.lede.small { font-size: 17px; line-height: 28px; }
.ctas { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
.cta { width: auto; text-decoration: none; }

.dark { background: var(--ink); color: #f4f0e8; padding: 112px 0; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
.col { display: flex; flex-direction: column; gap: 20px; align-items: flex-start; }
.quote { font-family: 'Instrument Serif', Georgia, serif; font-size: clamp(40px, 4.6vw, 60px); line-height: 1.08; }
.dark .body { color: #b8b1a5; font-size: 18px; line-height: 29px; }
.compare { margin: 0; border-top: 1px solid rgba(244, 240, 232, 0.12); }
.compare div { display: grid; grid-template-columns: 128px 1fr; gap: 16px; padding: 20px 0; border-bottom: 1px solid rgba(244, 240, 232, 0.12); }
.compare dt { font-family: var(--mono); font-size: 13px; color: #8f887c; padding-top: 2px; }
.compare dd { margin: 0; font-size: 19px; line-height: 28px; color: #d8d2c7; }
.compare .us dt { color: #ff9c90; }
.compare .us dd { color: #fff; font-weight: 500; }

.block { padding-top: 112px; padding-bottom: 112px; }
.head { display: flex; flex-direction: column; gap: 12px; margin-bottom: 48px; }
h2 { font-size: clamp(32px, 4vw, 52px); line-height: 1.08; letter-spacing: -0.03em; font-weight: 500; }
h3 { font-size: 22px; line-height: 28px; font-weight: 500; letter-spacing: -0.01em; }
.timeline { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; position: relative; }
.timeline::before { content: ''; position: absolute; top: 20px; left: 20px; right: 20px; height: 1px; background: var(--line-strong); }
.timeline li { position: relative; display: flex; flex-direction: column; gap: 12px; }
.timeline p, .steps p { color: var(--text-2); font-size: 16px; line-height: 25px; max-width: 320px; }
.dot { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--counter); box-shadow: inset 0 0 0 1.5px var(--wax); color: var(--wax); font-family: var(--mono); font-size: 14px; flex: none; }

.paper { background: var(--paper); padding: 112px 0; border-top: 1px solid var(--paper-line); border-bottom: 1px solid var(--paper-line); }
.facts { list-style: none; margin: 4px 0 8px; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.facts li { position: relative; padding-left: 20px; color: var(--text-2); font-size: 16px; line-height: 24px; }
.facts li::before { content: ''; position: absolute; left: 0; top: 9px; width: 6px; height: 6px; border-radius: 50%; background: var(--ready); }
.fit { width: auto; align-self: flex-start; text-decoration: none; }

.slip { position: relative; margin: 0; background: #fffdf8; border-radius: 4px; padding: 28px 32px 32px; box-shadow: 0 1px 2px rgba(40, 28, 12, 0.06), 0 20px 40px rgba(40, 28, 12, 0.08); transform: rotate(1deg);
  -webkit-mask: radial-gradient(circle 6px at 50% 0, #0000 98%, #000) 0 0 / 20px 100% repeat-x; mask: radial-gradient(circle 6px at 50% 0, #0000 98%, #000) 0 0 / 20px 100% repeat-x; }
.sliphead { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 12px; color: var(--text-3); padding-bottom: 16px; border-bottom: 1px dashed var(--line-strong); }
.slip dl { margin: 8px 0 0; }
.line { display: flex; align-items: baseline; gap: 12px; padding: 12px 0; }
.line dt { font-size: 16px; color: var(--text-2); }
.leader { flex: 1; border-bottom: 1px dotted var(--line-strong); transform: translateY(-4px); }
.line dd { margin: 0; font-family: var(--mono); font-size: 20px; font-variant-numeric: tabular-nums; color: var(--text); }
.line dd.wax { color: var(--wax); }
.pending { font-size: 14px; color: var(--text-3); }
.slipfoot { margin-top: 12px; padding-top: 16px; border-top: 1px dashed var(--line-strong); font-family: var(--mono); font-size: 12px; color: var(--text-3); max-width: 70%; }
.slipstamp { position: absolute; right: 20px; bottom: 12px; }

.start { align-items: start; }
.steps { list-style: none; margin: 0; padding: 0; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-card); box-shadow: var(--shadow-sm); }
.steps li { display: flex; gap: 20px; padding: 24px; }
.steps li + li { border-top: 1px solid var(--line); }
.stepbody { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.stepbody .btn { margin-top: 8px; }
.stores { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 4px; }
.badge { display: inline-flex; min-height: 44px; align-items: center; }
.badge img { display: block; height: 44px; width: auto; }
/* Google's badge PNG includes its required clear space, so it renders taller to match. */
.badge.gp img { height: 64px; margin: -10px -9px; }

.close { padding: 112px 0; border-top: 1px solid var(--line); }
.closing { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; }
.big { font-family: 'Instrument Serif', Georgia, serif; font-size: clamp(48px, 6vw, 80px); line-height: 1.02; margin-top: 8px; }
.sub { color: var(--text-2); font-size: 18px; margin-bottom: 8px; }
.closing .fit { align-self: center; }
.skip { position: absolute; left: 16px; top: -60px; z-index: 10; padding: 10px 16px; border-radius: var(--r-control); background: var(--text); color: #fff; text-decoration: none; }
.skip:focus { top: 12px; }
.footlinks { display: flex; gap: 20px; flex-wrap: wrap; }
.footlinks a { min-height: 44px; display: inline-flex; align-items: center; text-decoration: none; }
.footlinks a:hover { color: var(--text); }
.qr { display: flex; gap: 16px; align-items: center; margin-top: 12px; padding-top: 16px; border-top: 1px solid var(--line); }
.qr img { border-radius: 8px; box-shadow: 0 0 0 1px var(--line); flex: none; }
.foot { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 32px; padding-bottom: 40px; border-top: 1px solid var(--line); }

@media (max-width: 860px) {
  .nav { min-height: 64px; }
  .navlinks a:not(.navbtn) { display: none; }
  .hero, .split { grid-template-columns: 1fr; }
  .hero { min-height: 0; max-height: none; gap: 40px; padding-top: 24px; }
  .ctas, .ctas .cta { width: 100%; }
  .dark, .paper, .close { padding: 72px 0; }
  .block { padding-top: 72px; padding-bottom: 72px; }
  .split { gap: 40px; }
  .timeline { grid-template-columns: 1fr; gap: 28px; }
  .timeline::before { top: 20px; bottom: 20px; left: 20px; right: auto; width: 1px; height: auto; }
  .timeline li { padding-left: 60px; }
  .timeline .dot { position: absolute; left: 0; top: -4px; }
  .compare div { grid-template-columns: 1fr; gap: 4px; }
  .slip { padding: 24px 20px 28px; transform: none; }
  .slipfoot { max-width: 60%; }
  .steps li { padding: 20px; gap: 16px; }
}
</style>
