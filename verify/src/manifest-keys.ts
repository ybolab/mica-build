import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ToolOutputError } from './tools.ts'

/** Independently derive the manifest the staging step is required to emit. */
export function derivedManifest(bytes: Buffer, path: string): unknown {
  const document = JSON.parse(bytes.toString('utf8'))
  const trust = document?.trust
  if (document?.schema !== 'mos/meta/v1' || !trust || Array.isArray(trust)
    || Object.keys(trust).some(key => key !== 'signingKeys' && key !== 'signingKeyIds')
    || !Array.isArray(trust.signingKeys)) {
    throw new ToolOutputError(`${path}: invalid baked trust schema; expected inline signingKeys`)
  }
  const ids = trust.signingKeys.map((key: unknown) => {
    if (typeof key !== 'string') throw new ToolOutputError(`${path}: non-string signing key`)
    const raw = Buffer.from(key, 'base64')
    if (raw.length !== 32 || raw.toString('base64') !== key) {
      throw new ToolOutputError(`${path}: signing key is not canonical base64 over 32 Ed25519 bytes`)
    }
    return createHash('sha256').update(raw).digest('hex')
  })
  if ('signingKeyIds' in trust && !isDeepStrictEqual(trust.signingKeyIds, ids)) {
    throw new ToolOutputError(`${path}: signingKeyIds does not match signingKeys`)
  }
  trust.signingKeyIds = ids
  return document
}
