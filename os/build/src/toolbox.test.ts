// The toolbox seam, on BOTH of its routes, driven from the failing side.
//
// A SEAM WITH ONE REACHABLE ROUTE IS A SEAM NOBODY IS CHECKING, so both are
// exercised here on the same host and in the same run: COREUTILS finds dd and
// truncate on this machine and takes the host route, CX3576_ASSEMBLY finds
// neither sgdisk nor mcopy nor mkimage and takes the container. Which one a
// toolset gets is MEASURED, not configured, and the measurement is asserted
// rather than assumed -- on a host that grew a full toolset these tests would
// still hold, because what they assert is the rule and not this machine.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { makeWorkDir, REPO_ROOT } from './paths.ts'
import { Toolbox, ToolError, type Toolset } from './toolbox.ts'
import { OPEN_TIMEOUT_MS, TOOL_TIMEOUT_MS } from './testing.ts'
import { COREUTILS, CX3576_ASSEMBLY, mke2fsCanWriteTheseLayouts } from './toolsets.ts'

const docker = process.env.MOS_BUILD_DOCKER || 'docker'

let work = ''
let host: Toolbox
let container: Toolbox
const announced: string[] = []

beforeAll(async () => {
  work = makeWorkDir('toolbox')
  host = await Toolbox.open(COREUTILS, { mounts: [REPO_ROOT], cwd: work, announce: l => announced.push(l) })
  container = await Toolbox.open(CX3576_ASSEMBLY, { mounts: [REPO_ROOT], cwd: work, announce: l => announced.push(l) })
}, OPEN_TIMEOUT_MS)

afterAll(async () => {
  await host?.close()
  await container?.close()
  if (work !== '') rmSync(work, { recursive: true, force: true })
}, OPEN_TIMEOUT_MS)

describe('the route is measured, and both of them happen here', () => {
  test('coreutils is on this host, so that toolset runs on the host', () => {
    expect(host.route).toBe('host')
    expect(host.announceLine).toContain('the whole toolset is on this host')
  })

  test('the assembly toolset is not, so it runs in the image images.env pins', () => {
    expect(container.route).toBe('container')
    // The reason is IN the announce line, naming the tools that decided it --
    // "no bun on this host" is os/verify/run.sh's version of the same sentence.
    expect(container.announceLine).toMatch(/not on this host: .*sgdisk|cannot write these layouts/)
    expect(container.image).toMatch(/^alpine:3\.21@sha256:[0-9a-f]{64}$/)
  })

  test('a route is announced exactly once per toolbox, so a run is never ambiguous', () => {
    expect(announced.length).toBe(2)
    expect(announced.every(l => l.startsWith('os/build: '))).toBe(true)
  })

  test('the host probe is a capability question, not a presence one', async () => {
    // mke2fs IS on this host's PATH and still cannot write these layouts: 1.46.5
    // has no `-O ^orphan_file`. os/mkimage-v2.sh's host_can_assemble() probes
    // for the same reason -- "older host tools silently cannot, so probe
    // instead of guessing".
    const onPath = (await $`sh -c ${'command -v mke2fs'}`.nothrow().quiet()).exitCode === 0
    const probe = await mke2fsCanWriteTheseLayouts()
    expect(`on PATH: ${onPath}`).toBe('on PATH: true')
    expect(typeof probe.why).toBe('string')
    expect(probe.why.length).toBeGreaterThan(10)
    if (!probe.ok) expect(probe.why).toMatch(/e2fsprogs >= 1\.47/)
  })
})

describe('a tool that runs, runs the same way on both routes', () => {
  test('the same argv, the same stdout, on host and in container', async () => {
    const a = await host.run(['truncate', '-s', '1M', join(work, 'a.img')])
    const b = await container.run(['truncate', '-s', '1M', join(work, 'b.img')])
    expect(`${a.ok} ${a.exitCode}`).toBe(`${b.ok} ${b.exitCode}`)
    expect(Bun.file(join(work, 'a.img')).size).toBe(1048576)
    expect(Bun.file(join(work, 'b.img')).size).toBe(1048576)
    // Byte-identical, which is the property every later milestone is gated on.
    expect(await Bun.file(join(work, 'a.img')).bytes()).toEqual(await Bun.file(join(work, 'b.img')).bytes())
  }, TOOL_TIMEOUT_MS)

  test('the identity mount makes a host path name the same file inside', async () => {
    // Not /w and not /work. The container is handed a path built OUTSIDE it,
    // so a translated one would name something else -- or nothing, and a bind
    // mount of a path the daemon cannot see does not fail: it succeeds and
    // delivers an empty directory.
    const marker = join(work, 'identity.txt')
    writeFileSync(marker, 'written on the host\n')
    const r = await container.run(['cat', marker])
    expect(r.stdout).toBe('written on the host\n')
    expect(r.ok).toBe(true)
  })

  test('an argument with a space or a semicolon is an argument, not a command', async () => {
    // Nothing is passed through a shell on either route: Bun.$ interpolates an
    // array as separate arguments and `docker exec` takes an argv. A partition
    // LABEL is a value out of a board definition, and the parser that read it
    // refuses shell metacharacters for the same reason this layer must.
    const nasty = 'a b; touch /tmp/PWNED'
    for (const [name, tb] of [['host', host], ['container', container]] as const) {
      const r = await tb.run(['sh', '-c', 'printf "%s" "$1"', 'sh', nasty])
      expect(`${name}: ${r.stdout}`).toBe(`${name}: ${nasty}`)
    }
    expect(existsSync('/tmp/PWNED')).toBe(false)
  })

  test('the environment a toolset declares reaches the tool, on both routes', async () => {
    for (const [name, tb] of [['host', host], ['container', container]] as const) {
      const r = await tb.run(['sh', '-c', 'printf "%s" "${SOME_PIN}"'], { env: { SOME_PIN: '1577836800' } })
      expect(`${name}: ${r.stdout}`).toBe(`${name}: 1577836800`)
    }
  })
})

describe('a failing tool is reported, never swallowed', () => {
  test('run() hands back the status and both streams and decides nothing', async () => {
    for (const [name, tb] of [['host', host], ['container', container]] as const) {
      const r = await tb.run(['sh', '-c', 'echo out; echo err >&2; exit 3'])
      expect(`${name}: ${r.exitCode} ${r.ok}`).toBe(`${name}: 3 false`)
      expect(`${name}: ${r.stdout.trim()}`).toBe(`${name}: out`)
      expect(`${name}: ${r.stderr.trim()}`).toBe(`${name}: err`)
    }
  })

  test('must() throws a ToolError carrying the argv, the route, the status and both streams', async () => {
    let caught: ToolError | undefined
    try {
      await container.must(['sh', '-c', 'echo the-stdout; echo the-stderr >&2; exit 7'])
    } catch (e) {
      caught = e as ToolError
    }
    expect(caught).toBeInstanceOf(ToolError)
    expect(caught!.exitCode).toBe(7)
    expect(caught!.route).toBe('container')
    expect(caught!.stderr).toContain('the-stderr')
    expect(caught!.stdout).toContain('the-stdout')
    // ...and all of it is in the MESSAGE, because that is what a build log shows.
    expect(caught!.message).toContain('exit 7')
    expect(caught!.message).toContain('the-stderr')
    expect(caught!.message).toContain('the-stdout')
    expect(caught!.message).toContain('route:  container')
  })

  test('a real tool failing is the same shape as a contrived one', async () => {
    // The contrived `exit 7` above proves the plumbing; this proves it against
    // sgdisk refusing a file that is not there.
    let msg = ''
    try {
      await container.must(['sgdisk', '--verify', join(work, 'not-here.img')])
    } catch (e) {
      msg = (e as ToolError).message
    }
    expect(msg).toContain('sgdisk')
    expect(msg).toContain('not-here.img')
    expect(msg).toMatch(/does not exist|Error is 2/)
  })

  test('a tool that is not in the toolset at all fails as a tool, not as a crash', async () => {
    const r = await container.run(['definitely-not-a-tool-xyz'])
    expect(r.ok).toBe(false)
    // Worth pinning: bun's own shell reports a missing binary as exit 1 with
    // "command not found", NOT 127. A wrapper that mapped 127 to "tool missing"
    // would never fire on the host route.
    const h = await host.run(['definitely-not-a-tool-xyz'])
    expect(h.ok).toBe(false)
    expect(`${h.exitCode}`).toBe('1')
    expect(h.stderr).toContain('command not found')
  })

  test('an empty argv is refused, because on one route it would succeed', async () => {
    // `$``` on the host runs nothing and reports success.
    await expect(host.run([])).rejects.toThrow(/empty argv, which is not a tool call/)
    await expect(container.run([])).rejects.toThrow(/empty argv, which is not a tool call/)
  })
})

describe('a toolbox that cannot provide its tools does not open', () => {
  test('a package that does not provide the tool it claims is caught at open, by name', async () => {
    // THE REAL SHAPE OF THIS: alpine splits debugfs and dumpe2fs out of
    // e2fsprogs into e2fsprogs-extra, so `apk add e2fsprogs` succeeds and
    // provides neither. Without this assertion the gap surfaces as "debugfs:
    // not found" from pin_seeded_times, forty steps into an assembly.
    const wrong: Toolset = {
      key: 'missing-extra',
      imageKey: 'IMAGE_ALPINE_3_21',
      manager: 'apk',
      packages: ['e2fsprogs'],
      tools: ['mke2fs', 'debugfs', 'dumpe2fs'],
    }
    let msg = ''
    try {
      const tb = await Toolbox.open(wrong, { route: 'container' })
      await tb.close()
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain('missing-extra')
    expect(msg).toContain('missing:')
    expect(msg).toMatch(/debugfs/)
    expect(msg).toContain('e2fsprogs')
  }, OPEN_TIMEOUT_MS)

  test('the positive control: the same image WITH the extra package opens', async () => {
    // Otherwise the assertion above would also pass if nothing could ever open.
    const right: Toolset = {
      key: 'with-extra',
      imageKey: 'IMAGE_ALPINE_3_21',
      manager: 'apk',
      packages: ['e2fsprogs', 'e2fsprogs-extra'],
      tools: ['mke2fs', 'debugfs', 'dumpe2fs'],
    }
    const tb = await Toolbox.open(right, { route: 'container' })
    try {
      expect((await tb.run(['debugfs', '-V'])).ok).toBe(true)
    } finally {
      await tb.close()
    }
  }, OPEN_TIMEOUT_MS)

  test('a package that does not exist is an install failure naming the packages', async () => {
    const bad: Toolset = {
      key: 'no-such-package',
      imageKey: 'IMAGE_ALPINE_3_21',
      manager: 'apk',
      packages: ['this-package-does-not-exist-xyz'],
      tools: ['sh'],
    }
    await expect(Toolbox.open(bad, { route: 'container' }))
      .rejects.toThrow(/could not be installed.*this-package-does-not-exist-xyz/s)
  }, OPEN_TIMEOUT_MS)

  test('an image key images.env does not define is refused BY THE KEY, before any container', async () => {
    const bad: Toolset = {
      key: 'no-such-image',
      imageKey: 'IMAGE_NOT_IN_THE_FILE',
      manager: 'apk',
      packages: [],
      tools: ['sh'],
    }
    await expect(Toolbox.open(bad, { route: 'container' })).rejects.toThrow(/defines no IMAGE_NOT_IN_THE_FILE/)
  })

  test('a forced HOST route on a host without the tools says so, rather than failing later', async () => {
    await expect(Toolbox.open(CX3576_ASSEMBLY, { route: 'host' }))
      .rejects.toThrow(/does not have: .*sgdisk/)
  })

  test('the refusal explains that a toolset is taken whole or not at all', async () => {
    // Mixing routes per tool would mean an image half written by the host's
    // sgdisk and half by the container's mcopy, and "which tool wrote these
    // bytes" would stop having an answer.
    let msg = ''
    try { await Toolbox.open(CX3576_ASSEMBLY, { route: 'host' }) } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('taken whole or not at all')
  })
})

describe('the session is torn down, and says so if used afterwards', () => {
  test('close removes the container, and a second close is harmless', async () => {
    const tb = await Toolbox.open(COREUTILS, { route: 'container' })
    const name = tb.containerName
    expect((await $`${docker} inspect ${name}`.nothrow().quiet()).exitCode).toBe(0)
    await tb.close()
    await tb.close()
    expect((await $`${docker} inspect ${name}`.nothrow().quiet()).exitCode).not.toBe(0)
  }, OPEN_TIMEOUT_MS)

  test('a call after close names the toolbox rather than a random container id', async () => {
    const tb = await Toolbox.open(COREUTILS, { route: 'host' })
    await tb.close()
    await expect(tb.run(['true'])).rejects.toThrow(/toolbox was closed/)
    await expect(tb.run(['true'])).rejects.toThrow(/coreutils/)
  })

  test('MOS_BUILD_TOOLBOX only accepts the two routes there are', async () => {
    const before = process.env.MOS_BUILD_TOOLBOX
    process.env.MOS_BUILD_TOOLBOX = 'sometimes'
    try {
      await expect(Toolbox.open(COREUTILS)).rejects.toThrow(/neither 'host' nor 'container'/)
    } finally {
      if (before === undefined) delete process.env.MOS_BUILD_TOOLBOX
      else process.env.MOS_BUILD_TOOLBOX = before
    }
  })
})
