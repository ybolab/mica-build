// Read just the active boot Image out of one explicitly named local disk image.
//
// Runtime mode intentionally does not reuse verify's optional container
// tool route.  It must run SSH and mtools on the caller's host, where their key
// policy and private-board route are real; a verifier container is not an
// equivalent execution environment.

import { existsSync } from 'node:fs'
import type { Board } from './board.ts'
import type { RuntimeImage } from './runtime.ts'

function whole(value: string | undefined, name: string): number {
  if (value === undefined || !/^[0-9]+$/.test(value)) throw new Error(`${name} is absent or not a whole byte offset`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name}=${value} is not a safe byte offset`)
  return parsed
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Extract `Linux version <release>` from a raw arm64 Image without `strings`. */
export function kernelReleaseFromImage(bytes: Uint8Array): string | undefined {
  const marker = new TextEncoder().encode('Linux version ')
  outer: for (let start = 0; start + marker.length < bytes.length; start += 1) {
    for (let at = 0; at < marker.length; at += 1) {
      if (bytes[start + at] !== marker[at]) continue outer
    }
    const end = (() => {
      for (let at = start + marker.length; at < bytes.length; at += 1) {
        const byte = bytes[at] as number
        if (byte <= 0x20 || byte === 0x7f) return at
      }
      return bytes.length
    })()
    const release = new TextDecoder().decode(bytes.slice(start + marker.length, end))
    if (/^[A-Za-z0-9._+:-]+$/.test(release)) return release
  }
  return undefined
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  // Copy into an ordinary ArrayBuffer-backed view.  A caller may hand us a
  // SharedArrayBuffer view, while WebCrypto deliberately accepts only the
  // detached-safe BufferSource subset.
  const copy = Uint8Array.from(bytes)
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
}

async function copyImage(image: string, offset: number): Promise<Uint8Array> {
  if (Bun.which('mcopy') === null) {
    throw new Error('runtime mode requires host mcopy to read the named image; it refuses a container fallback')
  }
  const target = `${image}@@${offset}`
  const proc = Bun.spawn(['env', 'MTOOLS_SKIP_CHECK=1', 'mcopy', '-n', '-i', target, '::/Image', '-'], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (status !== 0) {
    throw new Error(
      `host mcopy exited ${status} reading ::/Image at offset ${offset} of ${image}; ${stderr.trim().slice(0, 500) || '(no stderr)'}`,
    )
  }
  const bytes = new Uint8Array(stdout)
  if (bytes.length === 0) throw new Error(`host mcopy exited 0 reading ::/Image from ${image} but emitted zero bytes`)
  return bytes
}

/** Inspect the boot partition selected by the running RAUC slot. */
export async function inspectRuntimeImage(board: Board, image: string, slot: 'A' | 'B'): Promise<RuntimeImage> {
  if (!existsSync(image)) throw new Error(`named deployed image ${image} does not exist`)
  const offset = whole(board.get(`BOOT_${slot}_OFFSET_BYTES`), `BOOT_${slot}_OFFSET_BYTES`)
  const bytes = await copyImage(image, offset)
  return { bootImageSha256: await sha256(bytes), kernelRelease: kernelReleaseFromImage(bytes) }
}
