import { resolve } from 'node:path'
import { z } from 'zod'

const environmentSchema = z.object({
  ADMIN_TOKEN: z.string().min(32),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url().default('http://localhost:3000').refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
  }, 'PUBLIC_URL must be an HTTP(S) origin without a path or credentials'),
  DATA_DIR: z.string().min(1).default('.data'),
  SIGNING_KEY_FILE: z.string().min(1).optional(),
  METADATA_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).max(8 * 1024 ** 3).default(1024 ** 3),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
})

export function parseConfig(env: Record<string, string | undefined>) {
  const result = environmentSchema.safeParse({ ...env, PUBLIC_URL: env.PUBLIC_URL ?? env.NSL_URL })
  if (!result.success)
    throw new Error(`Invalid configuration: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
  const value = result.data
  return {
    adminToken: value.ADMIN_TOKEN,
    host: value.HOST,
    port: value.PORT,
    publicUrl: new URL(value.PUBLIC_URL).origin,
    dataDir: resolve(value.DATA_DIR),
    signingKeyFile: value.SIGNING_KEY_FILE ? resolve(value.SIGNING_KEY_FILE) : undefined,
    metadataTtlHours: value.METADATA_TTL_HOURS,
    maxUploadBytes: value.MAX_UPLOAD_BYTES,
    logLevel: value.LOG_LEVEL,
  }
}

export type Config = ReturnType<typeof parseConfig>
