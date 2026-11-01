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
const RPC = process.env.POLYGON_RPC
if (!RPC) { console.log('POLYGON_RPC not set, skipping'); process.exit(0) }

const root = fileURLToPath(new URL('../..', import.meta.url))
const ANVIL = 'http://127.0.0.1:8556'
const RELAYER = 'http://127.0.0.1:8788'
const APP = 'http://127.0.0.1:4179'
const USDT0 = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
const RELAYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // anvil default key
const procs = []
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }

async function waitFor(fn, label, tries = 150) {
  for (let i = 0; i < tries; i++) { try { if (await fn()) return } catch {} await new Promise((r) => setTimeout(r, 200)) }
  throw new Error(`${label} did not start`)
}

const chain = { ...polygon, rpcUrls: { default: { http: [ANVIL] } } }
const pub = createPublicClient({ chain, transport: http(ANVIL) })
const testClient = createTestClient({ chain, mode: 'anvil', transport: http(ANVIL) })

try {
  procs.push(spawn('anvil', ['--fork-url', RPC, '--port', '8556', '--silent'], { stdio: 'ignore' }))
  await waitFor(() => pub.getBlockNumber(), 'anvil')

  const { bytecode } = JSON.parse(readFileSync(`${root}/contracts/out/SevuLock.sol/SevuLock.json`, 'utf8'))
  const deployer = createWalletClient({ chain, transport: http(ANVIL), account: privateKeyToAccount(RELAYER_KEY) })
  const hash = await deployer.deployContract({
    abi: [{ type: 'constructor', inputs: [{ type: 'address' }], stateMutability: 'nonpayable' }],
    bytecode: bytecode.object, args: [USDT0],
  })
  const lock = (await pub.waitForTransactionReceipt({ hash })).contractAddress

  const ownerKey = generatePrivateKey()
  const owner = privateKeyToAccount(ownerKey)
  const bal = (a) => pub.readContract({ address: USDT0, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [a] })
  for (let slot = 0n; slot < 20n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [owner.address, slot]))
    await testClient.setStorageAt({ address: USDT0, index: key, value: pad(toHex(20_000_000n)) })
    if ((await bal(owner.address)) === 20_000_000n) break
    await testClient.setStorageAt({ address: USDT0, index: key, value: pad('0x0') })
  }
  check('owner funded with 20 USDT0 and 0 POL', (await bal(owner.address)) === 20_000_000n && (await pub.getBalance({ address: owner.address })) === 0n)

  procs.push(spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: `${root}/relayer`, stdio: 'ignore',
    env: { ...process.env, RELAYER_PRIVATE_KEY: RELAYER_KEY, POLYGON_RPC_URLS: ANVIL, SEVU_LOCK_ADDRESS: lock, USDT0_ADDRESS: USDT0, ALLOWED_ORIGINS: APP, PORT: '8788' },
  }))
  await waitFor(async () => (await fetch(`${RELAYER}/v1/health`)).ok, 'relayer')

  execSync('npx vite build --logLevel error', {
    cwd: `${root}/app`, stdio: 'inherit',
    env: { ...process.env, VITE_SEVU_LOCK_ADDRESS: lock, VITE_RELAYER_URL: RELAYER, VITE_POLYGON_RPC: ANVIL },
  })
  procs.push(spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort', '--host', '127.0.0.1'], { cwd: `${root}/app`, stdio: 'ignore' }))
  await waitFor(async () => (await fetch(APP)).ok, 'app')

  const browser = await chromium.launch()
  mkdirSync(`${root}/app/e2e/screens`, { recursive: true })

  // 1. Outside Nimiq Pay
  {
    const page = await browser.newPage()
    await page.goto(APP)
    await page.getByText('Open Sevu in Nimiq Pay').waitFor({ timeout: 5000 })
    check('outside Nimiq Pay shows guidance', true)
    await page.close()
  }

  async function walletPage({ reject = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const signer = privateKeyToAccount(ownerKey)
    await page.exposeFunction('__sign', async (json) => {
      if (reject) throw new Error('User rejected the request')
      const td = JSON.parse(json)
      const { EIP712Domain, ...types } = td.types
      return signer.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message })
    })
    await page.addInitScript(({ address, reject }) => {
      let chainId = '0x1'
      window.nimiq = {}
      window.ethereum = {
        async request({ method, params }) {
          if (method === 'eth_requestAccounts') return [address]
          if (method === 'eth_chainId') return chainId
          if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; return null }
          if (method === 'eth_signTypedData_v4') {
            if (reject) { const e = new Error('User rejected the request'); e.code = 4001; throw e }
            return window.__sign(params[1])
          }
          throw new Error(`unsupported ${method}`)
        },
      }
    }, { address: signer.address, reject })
    return page
  }

  // 2. Cancel flow
  {
    const page = await walletPage({ reject: true })
    await page.goto(APP)
    await page.getByText('Sealed savings').waitFor({ timeout: 15000 })
    check('connects and switches 0x1 to Polygon', true)
    await page.getByRole('button', { name: 'Lock USDT' }).click()
    await page.getByLabel('Amount (USDT)').fill('5')
    await page.getByRole('button', { name: 'Seal it' }).click()
    await page.getByText('Signing cancelled.').waitFor({ timeout: 10000 })
    check('rejected signature shows cancel message, nothing sent', (await bal(lock)) === 0n)
    await page.close()
  }

  // 3. Validation and the real lock
  {
    const page = await walletPage()
    await page.goto(APP)
    await page.getByText('Sealed savings').waitFor({ timeout: 15000 })
    await page.screenshot({ path: `${root}/app/e2e/screens/1-home-empty.png` })
    await page.getByRole('button', { name: 'Lock USDT' }).click()
    await page.getByLabel('Amount (USDT)').fill('11')
    const capMsg = await page.getByText('per lock for now').isVisible()
    check('amount above 10 USDT cap blocked in UI', capMsg && (await page.getByRole('button', { name: 'Seal it' }).isDisabled()))
    await page.getByLabel('Amount (USDT)').fill('5')
    await page.screenshot({ path: `${root}/app/e2e/screens/2-create.png` })
    await page.getByRole('button', { name: 'Seal it' }).click()
    await page.getByText('Sealed. Nobody can move this').waitFor({ timeout: 60000 })
    await page.screenshot({ path: `${root}/app/e2e/screens/3-sealed.png` })
    check('lock sealed through relayer', (await bal(lock)) === 5_000_000n, `contract holds ${await bal(lock)}`)
    check('owner still has 0 POL', (await pub.getBalance({ address: owner.address })) === 0n)
    await page.getByRole('button', { name: 'Back to my locks' }).click()
    await page.getByText('5.00 USDT, Sealed').first().waitFor({ timeout: 10000 }).catch(() => {})
    const card = await page.getByRole('article').first().getAttribute('aria-label')
    check('list shows the lock as Sealed', card?.includes('5.00 USDT, Sealed') ?? false, card ?? 'no card')
    await page.reload()
    await page.getByRole('article').first().waitFor({ timeout: 15000 })
    const after = await page.getByRole('article').first().getAttribute('aria-label')
    check('lock still listed after reload (read from chain)', after?.includes('5.00 USDT, Sealed') ?? false)
    const total = await page.locator('.total').innerText()
    check('summary total reads 5.00', total.startsWith('5.00'), total)
    await page.screenshot({ path: `${root}/app/e2e/screens/4-home-locked.png` })

    await testClient.increaseTime({ seconds: 31 * 86_400 })
    await testClient.mine({ blocks: 1 })
    await page.getByRole('button', { name: 'Refresh' }).click()
    await page.getByText('Ready to withdraw').waitFor({ timeout: 15000 })
    check('after unlock time the lock shows Ready to withdraw', true)
    await page.screenshot({ path: `${root}/app/e2e/screens/5-ripe.png` })
  }
  await browser.close()
} catch (e) {
  check('run', false, e.message)
} finally {
  for (const p of procs) p.kill()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
