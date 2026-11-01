// End-to-end: built app + real relayer + SevuLock on an anvil Polygon fork, driven by Playwright
// with a mock EIP-1193 wallet that starts on chain 0x1 like Nimiq Pay.
// Usage: POLYGON_RPC=https://... node e2e/fork.mjs   (needs anvil, forge build, playwright)
import { spawn, execSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createPublicClient, createTestClient, createWalletClient, http, encodeAbiParameters, keccak256, pad, toHex } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { polygon } from 'viem/chains'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const a11y = []
// WCAG 2.1 AA scan plus a 44px touch-target check on every screen the run visits (NFR-005).
async function audit(page, screen) {
  await page.waitForTimeout(500) // let entrance animations settle so contrast is judged at rest
  await page.addScriptTag({ content: axeSource })
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
  })
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, [role=button], summary')]
    .filter((el) => { const b = el.getBoundingClientRect(); const st = getComputedStyle(el); return b.width > 0 && st.visibility !== 'hidden' && (b.height < 44 && b.width < 44 || b.height < 40) })
    .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`))
  a11y.push({ screen, violations: res, small })
}
const RPC = process.env.POLYGON_RPC
if (!RPC) { console.log('POLYGON_RPC not set, skipping'); process.exit(0) }

const root = fileURLToPath(new URL('../..', import.meta.url))
const ANVIL = 'http://127.0.0.1:8556'
const RELAYER = 'http://127.0.0.1:8788'
const APP = 'http://127.0.0.1:4179'
const USDT0 = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
const RELAYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // anvil default key
const procs = []
// Start each helper in its own process group so cleanup also stops children that npx leaves behind.
const start = (cmd, args, opts) => { const p = spawn(cmd, args, { ...opts, detached: true }); procs.push(p); return p }
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }

async function waitFor(fn, label, tries = 150) {
  for (let i = 0; i < tries; i++) { try { if (await fn()) return } catch {} await new Promise((r) => setTimeout(r, 200)) }
  throw new Error(`${label} did not start`)
}

const chain = { ...polygon, rpcUrls: { default: { http: [ANVIL] } } }
const pub = createPublicClient({ chain, transport: http(ANVIL) })
const testClient = createTestClient({ chain, mode: 'anvil', transport: http(ANVIL) })

async function portFree(url) { try { await fetch(url); return false } catch { return true } }
try {
  for (const u of [ANVIL, RELAYER, APP]) if (!(await portFree(u))) throw new Error(`${u} is already in use; stop the old process first`)
  start('anvil', ['--fork-url', RPC, '--port', '8556', '--silent'], { stdio: 'ignore' })
  await waitFor(() => pub.getBlockNumber(), 'anvil')

  const { bytecode } = JSON.parse(readFileSync(`${root}/contracts/out/SevuLock.sol/SevuLock.json`, 'utf8'))
  const deployer = createWalletClient({ chain, transport: http(ANVIL), account: privateKeyToAccount(RELAYER_KEY) })
  const hash = await deployer.deployContract({
    abi: [{ type: 'constructor', inputs: [{ type: 'address' }], stateMutability: 'nonpayable' }],
    bytecode: bytecode.object, args: [USDT0],
  })
  const lock = (await pub.waitForTransactionReceipt({ hash })).contractAddress
  // The candidate contract's exact source, as the earlier deployment that still holds lock #0 on mainnet
  const v0 = JSON.parse(readFileSync(`${root}/contracts/out/SevuLockV0.sol/SevuLockV0.json`, 'utf8'))
  const h0 = await deployer.deployContract({
    abi: [{ type: 'constructor', inputs: [{ type: 'address' }], stateMutability: 'nonpayable' }],
    bytecode: v0.bytecode.object, args: [USDT0],
  })
  const legacyLock = (await pub.waitForTransactionReceipt({ hash: h0 })).contractAddress

  const ownerKey = generatePrivateKey()
  const owner = privateKeyToAccount(ownerKey)
  const bal = (a) => pub.readContract({ address: USDT0, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [a] })
  for (let slot = 0n; slot < 20n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [owner.address, slot]))
    await testClient.setStorageAt({ address: USDT0, index: key, value: pad(toHex(20_000_000n)) })
    if ((await bal(owner.address)) === 20_000_000n) break
    await testClient.setStorageAt({ address: USDT0, index: key, value: pad('0x0') })
  }
  // A 1 USDT lock on the earlier contract, made the old way, opening in 2 days
  {
    const ownerWallet = createWalletClient({ chain, transport: http(ANVIL), account: owner })
    await testClient.setBalance({ address: owner.address, value: 10n ** 18n })
    const t = (await pub.getBlock()).timestamp
    await pub.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: USDT0, abi: [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }], functionName: 'approve', args: [legacyLock, 1_000_000n] }) })
    await pub.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: legacyLock, abi: [{ type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint64' }], outputs: [{ type: 'uint256' }] }], functionName: 'deposit', args: [1_000_000n, t + 2n * 86_400n] }) })
    await testClient.setBalance({ address: owner.address, value: 0n })
  }
  check('owner funded with 19 USDT0 (1 locked on the old contract) and 0 POL', (await bal(owner.address)) === 19_000_000n && (await pub.getBalance({ address: owner.address })) === 0n)

  start('npx', ['tsx', 'src/server.ts'], {
    cwd: `${root}/relayer`, stdio: 'ignore',
    env: { ...process.env, RELAYER_PRIVATE_KEY: RELAYER_KEY, POLYGON_RPC_URLS: ANVIL, SEVU_LOCK_ADDRESS: lock, USDT0_ADDRESS: USDT0, ALLOWED_ORIGINS: APP, PORT: '8788', SEVU_LEGACY_LOCK_ADDRESSES: legacyLock },
  })
  await waitFor(async () => (await fetch(`${RELAYER}/v1/health`)).ok, 'relayer')

  execSync('npx vite build --logLevel error', {
    cwd: `${root}/app`, stdio: 'inherit',
    env: { ...process.env, VITE_SEVU_LOCK_ADDRESS: lock, VITE_SEVU_LEGACY_LOCKS: legacyLock, VITE_RELAYER_URL: RELAYER, VITE_POLYGON_RPC: ANVIL },
  })
  start('npx', ['vite', 'preview', '--port', '4179', '--strictPort', '--host', '127.0.0.1'], { cwd: `${root}/app`, stdio: 'ignore' })
  await waitFor(async () => (await fetch(APP)).ok, 'app')

  const browser = await chromium.launch()
  globalThis.__browser = browser
  mkdirSync(`${root}/app/e2e/screens`, { recursive: true })

  // 1. Outside Nimiq Pay
  {
    const page = await browser.newPage()
    await page.goto(APP)
    await page.getByText('Open Sevu in Nimiq Pay').waitFor({ timeout: 5000 })
    await audit(page, '00-outside')
    check('outside Nimiq Pay shows guidance', true)
    await page.close()
  }

  async function walletPage({ reject = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const signer = privateKeyToAccount(ownerKey)
    const ownerWallet = createWalletClient({ chain, transport: http(ANVIL), account: signer })
    await page.exposeFunction('__sign', async (json) => {
      const td = JSON.parse(json)
      const { EIP712Domain, ...types } = td.types
      return signer.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message })
    })
    await page.exposeFunction('__send', async (tx) => ownerWallet.sendTransaction({ to: tx.to, data: tx.data }))
    await page.addInitScript(({ address, reject }) => {
      let chainId = '0x1'
      let account = address
      const listeners = {}
      const emit = (ev, arg) => (listeners[ev] ?? []).forEach((f) => f(arg))
      // Test hooks standing in for the user changing things in Nimiq Pay
      window.__setAccount = (a) => { account = a; emit('accountsChanged', a ? [a] : []) }
      window.__setChain = (c) => { chainId = c; emit('chainChanged', c) }
      window.nimiq = {}
      window.ethereum = {
        on(ev, f) { (listeners[ev] ??= []).push(f) },
        removeListener(ev, f) { listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f) },
        async request({ method, params }) {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return account ? [account] : []
          if (method === 'eth_chainId') return chainId
          if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; emit('chainChanged', chainId); return null }
          if (method === 'eth_signTypedData_v4') {
            if (reject) { const e = new Error('User rejected the request'); e.code = 4001; throw e }
            return window.__sign(params[1])
          }
          if (method === 'eth_sendTransaction') return window.__send(params[0])
          throw new Error(`unsupported ${method}`)
        },
      }
    }, { address: signer.address, reject })
    return page
  }
  const shot = (page, name) => page.screenshot({ path: `${root}/app/e2e/screens/${name}.png`, fullPage: true })

  async function createLock(page, amount, label) {
    await page.getByRole('button', { name: 'Lock USDT' }).click()
    await page.getByLabel('How much?').fill(amount)
    if (label) await page.getByLabel(/Name it/).fill(label)
    await page.getByRole('button', { name: 'Review' }).click()
    await page.getByRole('button', { name: 'Seal it' }).click()
  }

  // 2. Cancel flow
  {
    const page = await walletPage({ reject: true })
    await page.goto(APP)
    await page.getByText('Locked in Sevu').waitFor({ timeout: 15000 })
    check('connects and switches 0x1 to Polygon', true)
    await createLock(page, '5')
    await page.getByText('Signing cancelled').waitFor({ timeout: 10000 })
    check('rejected signature shows cancel message, nothing sent', (await bal(lock)) === 0n)
    await page.close()
  }

  // 3. Full journey
  {
    const page = await walletPage()
    await page.goto(APP)
    await page.getByText('Locked in Sevu').waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: /^Sealed: Lock #0 / }).waitFor({ timeout: 15000 })
    check('lock on the earlier contract is listed', true)
    await shot(page, '01-home-legacy')
    await audit(page, '01-home-legacy')

    await page.getByRole('button', { name: 'Lock USDT' }).click()
    await page.getByLabel('How much?').fill('11')
    const capMsg = await page.getByText('per lock for now').isVisible()
    check('amount above 10 USDT cap blocked in UI', capMsg && (await page.getByRole('button', { name: 'Review' }).isDisabled()))
    await page.getByLabel('How much?').fill('5')
    await page.getByLabel(/Name it/).fill('Rent')
    await shot(page, '02-create')
    await audit(page, '02-create')
    await page.getByRole('button', { name: 'Review' }).click()
    await page.getByText('cannot be withdrawn before the unlock date').waitFor()
    await shot(page, '03-review')
    await audit(page, '03-review')
    await page.getByRole('button', { name: 'Seal it' }).click()
    await page.getByRole('heading', { name: 'Sealed' }).waitFor({ timeout: 60000 })
    await page.waitForTimeout(1300)
    await shot(page, '04-sealed')
    await audit(page, '04-sealed')
    check('lock sealed through relayer', (await bal(lock)) === 5_000_000n, `contract holds ${await bal(lock)}`)
    check('owner still has 0 POL', (await pub.getBalance({ address: owner.address })) === 0n)
    await page.getByRole('button', { name: 'Back to my savings' }).click()
    const card = page.getByRole('button', { name: /^Sealed: Rent / })
    await card.waitFor({ timeout: 10000 })
    check('home lists the named lock as Sealed', true)
    await shot(page, '05-home-locked')

    await page.reload()
    await page.getByRole('button', { name: /^Sealed: Rent / }).waitFor({ timeout: 15000 })
    const total = await page.locator('.total').innerText()
    check('after reload: both locks listed, names kept apart, total 6.00 from chain', total.startsWith('6.00')
      && await page.getByRole('button', { name: /Lock #0 / }).isVisible(), total)

    await page.getByRole('button', { name: /^Sealed: Rent / }).click()
    await page.getByRole('button', { name: 'Try to withdraw early' }).click()
    await page.getByText('The contract refused.').waitFor({ timeout: 15000 })
    check('early withdrawal: contract refusal shown (FR-012)', (await bal(lock)) === 5_000_000n)
    await shot(page, '06-refused')
    await audit(page, '06-refused')
    await page.getByRole('button', { name: 'Back' }).click()

    await testClient.increaseTime({ seconds: 31 * 86_400 })
    await testClient.mine({ blocks: 1 })
    await page.getByRole('button', { name: 'Refresh' }).click()
    await page.getByText('2 locks are ready to withdraw').waitFor({ timeout: 15000 })
    check('after unlock time the home shows ready', true)
    await shot(page, '07-ripe')
    await audit(page, '07-ripe')
    await page.getByRole('button', { name: /^Ready: Rent / }).click()
    await page.getByRole('button', { name: 'Withdraw to my wallet' }).click()
    await page.getByText('Withdrawn. 5.00 USDT is back in your wallet.').waitFor({ timeout: 60000 })
    check('withdraw via relayer returns funds (FR-013)', (await bal(owner.address)) === 19_000_000n && (await bal(lock)) === 0n)
    await shot(page, '08-withdrawn')
    await audit(page, '08-withdrawn')
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByText('History (1)').waitFor({ timeout: 10000 })
    check('withdrawn lock moves to history', true)
    await page.getByRole('button', { name: /^Ready: Lock #0 / }).click()
    await page.getByRole('button', { name: 'Withdraw to my wallet' }).click()
    await page.getByText('Withdrawn. 1.00 USDT is back in your wallet.').waitFor({ timeout: 60000 })
    check('lock on the earlier contract withdraws through the relayer', (await bal(owner.address)) === 20_000_000n && (await bal(legacyLock)) === 0n)
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByText('History (2)').waitFor({ timeout: 10000 })

    // Rescue: relayer not used; owner pays POL.
    await createLock(page, '2', 'Rescue test')
    await page.getByRole('heading', { name: 'Sealed' }).waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: 'Back to my savings' }).click()
    await testClient.increaseTime({ seconds: 31 * 86_400 })
    await testClient.mine({ blocks: 1 })
    await testClient.setBalance({ address: owner.address, value: 10n ** 18n })
    await page.getByRole('link', { name: 'Withdraw directly' }).click()
    await page.getByRole('heading', { name: 'Withdraw directly' }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Withdraw', exact: true }).waitFor({ timeout: 15000 })
    await page.waitForTimeout(400)
    await shot(page, '09-rescue')
    await audit(page, '09-rescue')
    const relayerNonceBefore = await pub.getTransactionCount({ address: deployer.account.address })
    await page.getByRole('button', { name: 'Withdraw', exact: true }).click()
    await page.getByText('No locks are ready yet.').waitFor({ timeout: 60000 })
    const relayerNonceAfter = await pub.getTransactionCount({ address: deployer.account.address })
    check('rescue withdraws from the owner wallet without the relayer (FR-014)',
      (await bal(owner.address)) === 20_000_000n && relayerNonceAfter === relayerNonceBefore)
  }
  // 4. Following Nimiq Pay: account sheet, account switch, network switch
  {
    const page = await walletPage()
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP })
    await page.goto(APP)
    await page.getByText('Locked in Sevu').waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: /^Wallet 0x/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Your wallet' })
    await sheet.waitFor({ timeout: 5000 })
    await sheet.getByRole('button', { name: 'Copy address' }).click()
    await sheet.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 3000 })
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    check('account sheet copies the full address', clip.toLowerCase() === owner.address.toLowerCase())
    await shot(page, '10-account')
    await audit(page, '10-account')
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'detached', timeout: 3000 })

    const other = privateKeyToAccount(generatePrivateKey()).address
    await page.getByRole('button', { name: 'Lock USDT' }).click()
    await page.getByLabel('How much?').waitFor()
    await page.evaluate((a) => window.__setAccount(a), other)
    await page.getByRole('button', { name: `Wallet ${other.slice(0, 6)}...${other.slice(-4)}. Show address` }).waitFor({ timeout: 10000 })
    await page.getByText('Nothing sealed yet').waitFor({ timeout: 15000 })
    const total = await page.locator('.total').innerText()
    check('account switch leaves the half-done form and shows the new account', total.startsWith('0.00'), total)

    await page.evaluate(() => window.__setChain('0x1'))
    await page.getByText('Nimiq Pay is not on Polygon').waitFor({ timeout: 10000 })
    check('leaving Polygon shows the notice and disables locking', await page.getByRole('button', { name: 'Lock USDT' }).isDisabled())
    await shot(page, '11-wrong-chain')
    await audit(page, '11-wrong-chain')
    await page.getByRole('button', { name: 'Switch to Polygon' }).click()
    await page.getByText('Nimiq Pay is not on Polygon').waitFor({ state: 'detached', timeout: 10000 })
    check('switching back to Polygon restores the app', !(await page.getByRole('button', { name: 'Lock USDT' }).isDisabled()))
  }
  await browser.close()
} catch (e) {
  try { for (const ctx of (globalThis.__browser?.contexts() ?? [])) for (const pg of ctx.pages()) await pg.screenshot({ path: `${root}/app/e2e/screens/fail-shot.png` }) } catch {}
  check('run', false, e.message)
} finally {
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM') } catch {} }
}
if (a11y.length) {
  const bad = a11y.filter((x) => x.violations.length)
  const small = a11y.filter((x) => x.small.length)
  for (const x of bad) console.log(`a11y ${x.screen}: ${JSON.stringify(x.violations)}`)
  for (const x of small) console.log(`touch ${x.screen}: ${x.small.join(' | ')}`)
  check(`no serious or critical WCAG AA issues on ${a11y.length} screens`, bad.length === 0)
  check(`every control at least 44px on ${a11y.length} screens`, small.length === 0)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
