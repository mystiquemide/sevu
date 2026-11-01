import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { RelayError } from './errors.js'
import { ChainUnavailableError } from './chain.js'
import { parseDeposit, parseWithdrawal } from './validate.js'
import type { Logger, RelayerService } from './service.js'

export function createApp(service: RelayerService, opts: { allowedOrigins: string[]; log?: Logger }) {
  const log = opts.log ?? (() => {})
  const app = new Hono()

  app.use('*', cors({ origin: opts.allowedOrigins, allowMethods: ['GET', 'POST'], allowHeaders: ['content-type'] }))
  app.use(
    '/v1/*',
    bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: { code: 'BAD_REQUEST', message: 'Body too large' } }, 413) }),
  )

  const readJson = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await c.req.json()
    } catch {
      throw new RelayError('BAD_REQUEST', 'Body must be JSON')
    }
  }

  app.post('/v1/deposits', async (c) => c.json(await service.deposit(parseDeposit(await readJson(c)))))
  app.post('/v1/withdrawals', async (c) => {
    const w = parseWithdrawal(await readJson(c))
    return c.json(await service.withdraw(w.lockId, w.contract))
  })
  app.get('/v1/health', async (c) => c.json(await service.health()))

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404))
  app.onError((err, c) => {
    if (err instanceof RelayError) {
      log({ event: 'rejected', code: err.code, path: c.req.path })
      return c.json({ error: { code: err.code, message: err.message, ...(err.data ? { data: err.data } : {}) } }, err.status as 400)
    }
    if (err instanceof ChainUnavailableError) {
      log({ event: 'chain_unavailable', path: c.req.path, error: err.message })
      return c.json({ error: { code: 'CHAIN_UNAVAILABLE', message: 'Polygon is not reachable right now, try again shortly' } }, 503)
    }
    log({ event: 'internal_error', path: c.req.path, error: err instanceof Error ? err.message : String(err) })
    return c.json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } }, 500)
  })
  return app
}
