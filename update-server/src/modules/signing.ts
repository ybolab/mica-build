import type { KeyObject } from 'node:crypto'
import type { Config } from '../config'
import { Buffer } from 'node:buffer'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { link, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export function digest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

export interface Envelope {
  schema: 'mos/update-envelope/v1'
  keyId: string
  payload: string
  signature: string
}

export class Signer {
  readonly publicKey: string
  readonly keyId: string

  constructor(private readonly key: KeyObject, readonly generated: boolean) {
    if (key.asymmetricKeyType !== 'ed25519')
      throw new Error('Metadata signing key must be Ed25519')
    const jwk = createPublicKey(key).export({ format: 'jwk' })
    if (!jwk.x)
      throw new Error('Metadata signing key has no public component')
    const raw = Buffer.from(jwk.x, 'base64url')
    this.publicKey = raw.toString('base64')
    this.keyId = digest(raw)
  }

  sign(payload: unknown): Envelope {
    const bytes = Buffer.from(JSON.stringify(payload))
    return { schema: 'mos/update-envelope/v1', keyId: this.keyId, payload: bytes.toString('base64'), signature: sign(null, bytes, this.key).toString('base64') }
  }
}

export async function loadSigner(config: Config) {
  const path = config.signingKeyFile ?? join(config.dataDir, 'metadata-signing.pem')
  try {
    return new Signer(createPrivateKey(await readFile(path)), !config.signingKeyFile)
  }
  catch (error) {
    if (config.signingKeyFile || !(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    const { privateKey } = generateKeyPairSync('ed25519')
    await file.writeFile(privateKey.export({ type: 'pkcs8', format: 'pem' }))
    await file.sync()
    await file.close()
    // Publish complete bytes without replacing a concurrently created key.
    try {
      await link(temporary, path)
    }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
        throw error
    }
    const directory = await open(config.dataDir, 'r')
    try {
      await directory.sync()
    }
    finally {
      await directory.close()
    }
  }
  finally {
    await file.close()
    await unlink(temporary)
  }
  return new Signer(createPrivateKey(await readFile(path)), !config.signingKeyFile)
}
