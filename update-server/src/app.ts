import type { Config } from './config'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { desc } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import pino from 'pino'
import { z, ZodError } from 'zod'
import { createDb } from './db'
import { audit, catalogs } from './db/schema'
import { Auth } from './modules/auth'
import { download } from './modules/download'
import { releaseInput, ReleaseService } from './modules/releases'
import { loadSigner } from './modules/signing'
import { AppError } from './shared/errors'

export interface Assets { html: string, js: string, css: string }

export async function createService(config: Config, assets?: Assets) {
  await mkdir(join(config.dataDir, 'artifacts'), { recursive: true, mode: 0o700 })
  const signer = await loadSigner(config)
  const store = createDb(config.dataDir)
  const logger = pino({ level: config.logLevel })
  const service = new ReleaseService(store, config, signer)
  try {
    const existing = store.db.select().from(catalogs).get()
    if (existing && JSON.parse(existing.envelope).keyId !== signer.keyId)
      throw new Error('Signing key differs from the persisted catalog; restore the original key')
    if (!existing)
      service.refresh()
  }
  catch (error) {
    store.close()
    throw error
  }
  const auth = new Auth(store, config)
  const app = new Hono()
  app.use(requestId())
  app.use(secureHeaders({
    contentSecurityPolicy: { defaultSrc: ['\'none\''], scriptSrc: ['\'self\''], styleSrc: ['\'self\''], connectSrc: ['\'self\''], imgSrc: ['\'self\'', 'data:'], frameAncestors: ['\'none\''], formAction: ['\'self\''], baseUri: ['\'none\''] },
    strictTransportSecurity: config.publicUrl.startsWith('https:') ? 'max-age=31536000' : false,
  }))
  app.use(async (c, next) => {
    const start = performance.now()
    await next()
    logger.info({ requestId: c.get('requestId'), method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Math.round(performance.now() - start) }, 'request')
  })
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.path === '/api/session' && (c.req.method === 'GET' || c.req.method === 'POST'))
      return next()
    if (!auth.authenticated(c))
      throw new AppError(401, 'unauthorized', 'Administrator authentication required')
    if (!['GET', 'HEAD'].includes(c.req.method) && !auth.bearer(c))
      auth.requireOrigin(c)
    await next()
  })
  // Artifact bodies bypass the JSON middleware and are bounded while streaming.
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'PUT' && /^\/api\/releases\/[^/]+\/artifact$/.test(c.req.path))
      return next()
    return bodyLimit({ maxSize: 32768, onError: () => {
      throw new AppError(413, 'body_too_large', 'Request exceeds 32 KiB')
    } })(c, next)
  })
  app.get('/healthz', (c) => {
    service.catalog()
    return c.json({ status: 'ok' })
  })
  app.get('/api/session', c => c.json({ authenticated: auth.authenticated(c) }))
  app.post('/api/session', async (c) => {
    const input = z.strictObject({ token: z.string().min(1).max(1024) }).parse(await c.req.json())
    auth.login(c, input.token)
    return c.json({ authenticated: true })
  })
  app.delete('/api/session', (c) => {
    auth.logout(c)
    return c.json({ authenticated: false })
  })
  app.get('/api/releases', c => c.json({ releases: service.list().map(({ artifact: _artifact, ...release }) => release) }))
  app.post('/api/releases', async c => c.json(service.create(releaseInput.parse(await c.req.json())), 201))
  app.put('/api/releases/:id/artifact', async c => c.json(await service.upload(c.req.param('id'), c.req.raw)))
  app.post('/api/releases/:id/publish', c => c.json(service.transition(c.req.param('id'), 'publish')))
  app.post('/api/releases/:id/withdraw', c => c.json(service.transition(c.req.param('id'), 'withdraw')))
  app.post('/api/metadata/refresh', (c) => {
    const { envelope: _envelope, ...catalog } = service.refresh()
    return c.json(catalog)
  })
  app.get('/api/status', (c) => {
    const { envelope: _envelope, id: _id, ...catalog } = service.catalog()
    return c.json({
      ...catalog,
      expired: Date.now() >= Date.parse(catalog.expiresAt),
      manifestUrl: `${config.publicUrl}/v1/manifest.json`,
      maxUploadBytes: config.maxUploadBytes,
      metadataTtlHours: config.metadataTtlHours,
      signing: { publicKey: signer.publicKey, keyId: signer.keyId, generated: signer.generated },
      protocol: 'mos/update-envelope/v1',
    })
  })
  app.get('/api/audit', c => c.json({ events: store.db.select().from(audit).orderBy(desc(audit.id)).limit(100).all() }))
  app.get('/v1/manifest.json', (c) => {
    c.header('Cache-Control', 'no-store')
    c.header('Content-Type', 'application/json')
    return c.body(service.catalog().envelope)
  })
  app.on(['GET', 'HEAD'], '/v1/artifacts/:id', c => download(c, service))
  if (assets) {
    app.get('/', c => c.html(assets.html))
    app.get('/app.js', (c) => {
      c.header('Content-Type', 'text/javascript')
      return c.body(assets.js)
    })
    app.get('/style.css', (c) => {
      c.header('Content-Type', 'text/css')
      return c.body(assets.css)
    })
  }
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404))
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json({ error: { code: error.code, message: error.message } }, error.status)
    if (error instanceof ZodError)
      return c.json({ error: { code: 'validation_error', message: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') } }, 400)
    if (error instanceof SyntaxError || error instanceof HTTPException)
      return c.json({ error: { code: 'invalid_request', message: 'Invalid request body' } }, 400)
    logger.error({ err: error, requestId: c.get('requestId') }, 'request failed')
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500)
  })
  return { app, store, service, logger, close: () => store.close() }
}
