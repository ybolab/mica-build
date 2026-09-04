import type { Config } from '../config'
import type { Store } from '../db'
import type { Release } from '../db/schema'
import type { Signer } from './signing'
import { createHash, randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { audit, catalogs, releases } from '../db/schema'
import { AppError } from '../shared/errors'

export const releaseInput = z.strictObject({
  board: z.enum(['cx3576', 'x64']),
  channel: z.enum(['stable', 'beta', 'dev']),
  version: z.string().min(1).max(80).regex(/^[\w.+-]+$/),
  epoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  notes: z.string().max(10000).default(''),
})

export class ReleaseService {
  constructor(readonly store: Store, readonly config: Config, readonly signer: Signer) {}

  list() {
    return this.store.db.select().from(releases).orderBy(desc(releases.epoch), desc(releases.createdAt)).all()
  }

  get(id: string): Release {
    const release = this.store.db.select().from(releases).where(eq(releases.id, id)).get()
    if (!release)
      throw new AppError(404, 'not_found', 'Release not found')
    return release
  }

  log(action: string, releaseId: string | null, detail: string) {
    this.store.db.insert(audit).values({ action, releaseId, detail, createdAt: new Date().toISOString() }).run()
  }

  create(input: z.infer<typeof releaseInput>) {
    return this.store.db.transaction(() => {
      const existing = this.store.db.select().from(releases).where(and(eq(releases.board, input.board), eq(releases.channel, input.channel), eq(releases.epoch, input.epoch))).get()
      if (existing)
        throw new AppError(409, 'duplicate_epoch', 'This board/channel epoch already exists')
      const id = randomUUID()
      this.store.db.insert(releases).values({ ...input, id, status: 'draft', createdAt: new Date().toISOString() }).run()
      this.log('create', id, `${input.board} / ${input.channel} / ${input.version}`)
      return this.get(id)
    }, { behavior: 'immediate' })
  }

  async upload(id: string, request: Request) {
    const release = this.get(id)
    if (release.status !== 'draft' || release.artifact)
      throw new AppError(409, 'immutable_artifact', 'Only an empty draft accepts an artifact')
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream')
      throw new AppError(415, 'content_type', 'Upload application/octet-stream bytes')
    const declared = request.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > this.config.maxUploadBytes))
      throw new AppError(413, 'upload_too_large', 'Artifact exceeds the upload limit')
    if (!request.body)
      throw new AppError(400, 'empty_artifact', 'Artifact must not be empty')
    const name = `${randomUUID()}.raucb`
    const destination = join(this.config.dataDir, 'artifacts', name)
    const temporary = `${destination}.part`
    const file = await open(temporary, 'wx', 0o600)
    const hasher = createHash('sha256')
    let size = 0
    let renamed = false
    let committed = false
    try {
      for await (const chunk of request.body) {
        size += chunk.byteLength
        if (size > this.config.maxUploadBytes)
          throw new AppError(413, 'upload_too_large', 'Artifact exceeds the upload limit')
        hasher.update(chunk)
        await file.writeFile(chunk)
      }
      if (!size)
        throw new AppError(400, 'empty_artifact', 'Artifact must not be empty')
      if (declared && size !== Number(declared))
        throw new AppError(400, 'length_mismatch', 'Artifact size differs from Content-Length')
      await file.sync()
      await file.close()
      await rename(temporary, destination)
      renamed = true
      const directory = await open(join(this.config.dataDir, 'artifacts'), 'r')
      try {
        await directory.sync()
      }
      finally {
        await directory.close()
      }
      const sha256 = hasher.digest('hex')
      const result = this.store.db.transaction(() => {
        const current = this.get(id)
        if (current.status !== 'draft' || current.artifact)
          throw new AppError(409, 'immutable_artifact', 'The draft already has an artifact')
        this.store.db.update(releases).set({ artifact: name, sha256, size }).where(eq(releases.id, id)).run()
        this.log('upload', id, `${size} bytes / ${sha256}`)
        return this.get(id)
      }, { behavior: 'immediate' })
      committed = true
      return result
    }
    finally {
      await file.close()
      if (!committed)
        await unlink(renamed ? destination : temporary)
    }
  }

  catalog() {
    const catalog = this.store.db.select().from(catalogs).where(eq(catalogs.id, 1)).get()
    if (!catalog)
      throw new Error('Catalog has not been initialized')
    return catalog
  }

  refreshCatalog() {
    const previous = this.store.db.select().from(catalogs).where(eq(catalogs.id, 1)).get()
    const revision = (previous?.revision ?? 0) + 1
    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + this.config.metadataTtlHours * 3600000).toISOString()
    const published = this.list().filter(release => release.status === 'published')
    const channels: { board: string, channel: string, releaseId: string, epoch: number }[] = []
    for (const release of published) {
      if (!channels.some(item => item.board === release.board && item.channel === release.channel))
        channels.push({ board: release.board, channel: release.channel, releaseId: release.id, epoch: release.epoch })
    }
    const payload = {
      schema: 'mos/updates/v1',
      revision,
      issuedAt,
      expiresAt,
      channels,
      releases: published.map(release => ({
        id: release.id,
        board: release.board,
        channel: release.channel,
        version: release.version,
        epoch: release.epoch,
        notes: release.notes,
        artifact: { url: `${this.config.publicUrl}/v1/artifacts/${release.id}`, size: release.size, sha256: release.sha256 },
      })),
    }
    const record = { id: 1, revision, issuedAt, expiresAt, envelope: JSON.stringify(this.signer.sign(payload)) }
    this.store.db.insert(catalogs).values(record).onConflictDoUpdate({ target: catalogs.id, set: record }).run()
    return record
  }

  refresh() {
    return this.store.db.transaction(() => {
      const result = this.refreshCatalog()
      this.log('refresh', null, `Catalog revision ${result.revision}`)
      return result
    }, { behavior: 'immediate' })
  }

  transition(id: string, action: 'publish' | 'withdraw') {
    return this.store.db.transaction(() => {
      const release = this.get(id)
      if (action === 'publish') {
        if (release.status !== 'draft' || !release.artifact)
          throw new AppError(409, 'not_publishable', 'Only a draft with an artifact can be published')
        const previous = this.store.db.select().from(releases).where(and(eq(releases.board, release.board), eq(releases.channel, release.channel), isNotNull(releases.publishedAt))).orderBy(desc(releases.epoch)).get()
        if (previous && release.epoch <= previous.epoch)
          throw new AppError(409, 'epoch_not_increasing', 'Epoch must exceed every previously published epoch in this board/channel')
        this.store.db.update(releases).set({ status: 'published', publishedAt: new Date().toISOString() }).where(eq(releases.id, id)).run()
      }
      else {
        if (release.status !== 'published')
          throw new AppError(409, 'not_published', 'Only a published release can be withdrawn')
        this.store.db.update(releases).set({ status: 'withdrawn' }).where(eq(releases.id, id)).run()
      }
      this.refreshCatalog()
      this.log(action, id, `${release.board} / ${release.channel} / ${release.version}`)
      return this.get(id)
    }, { behavior: 'immediate' })
  }
}
