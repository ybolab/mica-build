// The tool seam, and the register that keeps a port honest.
//
// Everything here runs on a host with no docker and no image, because
// `make os-verify-test` does -- and in CI inside the pinned bun container,
// which has neither. The route DECISION is a pure function for that reason: a
// test that could only reach it by having sgdisk installed would run on one
// machine and skip on another, and a skip reports the same green as a pass.

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  chooseRoute,
  missingHostTools,
  mountDirs,
  mountFault,
  REQUIRED_TOOLS,
  runChecked,
  TOOL_IMAGE_KEY,
  TOOL_PACKAGES,
  toolImageRef,
  ToolError,
  ToolOutputError,
  type ToolResult,
} from './tools.ts'
import { OS_DIR, REPO_ROOT } from './paths.ts'

describe('the route is chosen once, and a value that is neither is refused', () => {
  test('no host tools missing means the host route', () => {
    expect(chooseRoute(undefined, [])).toBe('host')
  })

  test('one missing tool is enough for the container route', () => {
    expect(chooseRoute(undefined, ['sgdisk'])).toBe('container')
  })

  test('MOS_VERIFY_TOOLS=container is honoured even with every tool present', () => {
    expect(chooseRoute('container', [])).toBe('container')
  })

  test('MOS_VERIFY_TOOLS=host with tools missing is refused, naming them', () => {
    expect(() => chooseRoute('host', ['sgdisk', 'mdir'])).toThrow(/no sgdisk, mdir/)
    expect(() => chooseRoute('host', ['sgdisk'])).toThrow(ToolOutputError)
  })

  test('a value that is neither is refused rather than read as unset', () => {
    // The failure this prevents: a typo silently taking the other route, and
    // the run then being about a bun -- or a tool set -- nobody asked for.
    expect(() => chooseRoute('contaner', [])).toThrow(/takes 'host' or 'container'/)
    expect(() => chooseRoute('1', ['sgdisk'])).toThrow(/is '1'/)
  })
})

describe('the tool set and the image it comes from', () => {
  test('every tool the shell verifier requires and this port drives is named', () => {
    const named: readonly string[] = REQUIRED_TOOLS
    for (const tool of ['sgdisk', 'mdir', 'mcopy', 'mlabel', 'debugfs', 'tune2fs', 'unsquashfs', 'veritysetup']) {
      expect(named).toContain(tool)
    }
  })

  test('the alpine package list is the one os/verify-image-v2.sh installs', () => {
    // Read out of the oracle rather than restated: the two must read an image
    // with the same tools, or a parity divergence could be a package
    // difference. The oracle is deleted at M4e and this assertion goes with it.
    const verifier = join(OS_DIR, 'verify-image-v2.sh')
    expect(existsSync(verifier)).toBe(true)
    const line = /apk add --no-cache -q ([^&]+?) &&/.exec(readFileSync(verifier, 'utf8'))?.[1]
    expect(line).toBeDefined()
    expect((line as string).trim().split(/\s+/).sort()).toEqual([...TOOL_PACKAGES].sort())
  })

  test('the image comes from the one resolver, by key, as a digest', async () => {
    const ref = await toolImageRef()
    expect(ref).toMatch(/^alpine:3\.21@sha256:[0-9a-f]{64}$/)
    expect(TOOL_IMAGE_KEY).toBe('IMAGE_ALPINE_3_21')
  })

  test('missingHostTools only ever names tools this package drives', async () => {
    const named: readonly string[] = REQUIRED_TOOLS
    for (const t of await missingHostTools()) expect(named).toContain(t)
  })
})

describe('mounts are identity mounts, and there is one per directory', () => {
  test('a directory is mounted itself; a file gives up its directory', () => {
    expect(mountDirs([REPO_ROOT])).toEqual([REPO_ROOT])
    expect(mountDirs([join(REPO_ROOT, 'Makefile')])).toEqual([REPO_ROOT])
  })

  test('two files in one directory are one mount', () => {
    expect(mountDirs([join(OS_DIR, 'verify-image-v2.sh'), join(OS_DIR, 'mkimage-v2.sh')])).toEqual([OS_DIR])
  })

  test('a path that is not there yields its PARENT, so the tool reports the file', () => {
    // A runtime that refused here would send the reader to look at a mount
    // when what is missing is the file they named.
    const ghost = join(REPO_ROOT, '_out', 'nothing-here.img')
    expect(mountDirs([ghost])).toEqual([dirname(ghost)])
  })
})

describe('the mount preflight probes CONTENT, because a path proves nothing', () => {
  const base = { unseen: [] as string[], echoed: 'S', sentinel: 'S', workDir: '/w' }

  test('a mount that carries what the host has is no fault', () => {
    expect(mountFault(base)).toBeUndefined()
  })

  test('a path the container cannot see names it and names the mount', () => {
    // The shape this host produces: a bind mount under /tmp succeeds and
    // delivers an empty directory, so the sentinel FILE is not in it.
    const fault = mountFault({ ...base, unseen: ['/tmp/w/.probe'] })
    expect(fault).toContain('/tmp/w/.probe')
    expect(fault).toContain('the mount that is empty')
  })

  test('a mount that carries something ELSE is a fault too', () => {
    // Cannot be produced on this host -- so it is driven here rather than left
    // as a branch nobody has ever seen take. The first version of this guard
    // asked `[ -e "$dir" ]` of the work directory, which an empty mount
    // SATISFIES: run with --work under /tmp it reported no problem at all.
    const fault = mountFault({ ...base, echoed: 'something else' })
    expect(fault).toContain("reads back as 'something else'")
    expect(fault).toContain('a content probe and not an existence one')
  })

  test('a sentinel that reads back empty is reported as (nothing)', () => {
    expect(mountFault({ ...base, echoed: '' })).toContain('reads back as (nothing)')
    expect(mountFault({ ...base, echoed: undefined })).toContain('reads back as (nothing)')
  })
})

describe('runChecked is where a non-zero exit becomes a throw', () => {
  const exec = (code: number) => async (argv: readonly string[]): Promise<ToolResult> =>
    ({ argv, code, stdout: 'out', stderr: 'boom' })

  test('exit 0 comes back', async () => {
    expect((await runChecked(exec(0), ['sgdisk', '-p'], undefined)).stdout).toBe('out')
  })

  test('a non-zero exit throws, naming the argv, the status and the stderr', async () => {
    const p = runChecked(exec(2), ['sgdisk', '-p', '/x.img'], { context: 'reading the GPT' })
    await expect(p).rejects.toThrow(ToolError)
    await expect(p).rejects.toThrow(/reading the GPT: `sgdisk -p \/x\.img` exited 2/)
    await expect(p).rejects.toThrow(/stderr: boom/)
  })

  test('an ALLOWED status comes back instead -- veritysetup answers with one', async () => {
    expect((await runChecked(exec(1), ['veritysetup'], { allow: [1] })).code).toBe(1)
  })

  test('and a status that was not allowed still throws', async () => {
    await expect(runChecked(exec(2), ['veritysetup'], { allow: [1] })).rejects.toThrow(ToolError)
  })
})
