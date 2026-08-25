// Every toolset this package declares, OPENED -- because a package list is a
// claim about what an image provides, and the only way to check a claim about
// an image is to run it.
//
// The two assembly toolsets are the ones that matter here. Their package lists
// are transcribed from os/mkimage-v2.sh and os/mkimage-x64.sh and they use
// DIFFERENT base images on purpose, so nothing about one of them being right
// says anything about the other -- which is the same reason every geometry
// assertion in this package runs over both boards. x64's toolset is otherwise
// exercised nowhere: M6c is the milestone that will use it, and a package list
// that is wrong should be wrong now rather than then.

import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { REPO_ROOT } from './paths.ts'
import { OPEN_TIMEOUT_MS } from './testing.ts'
import { Toolbox, type Toolset } from './toolbox.ts'
import {
  bundleToolset,
  COREUTILS,
  CX3576_ASSEMBLY,
  distroRaucToolset,
  shippedRaucPath,
  VERITY,
  X64_ASSEMBLY,
} from './toolsets.ts'

/** Every toolset that can be opened without an artifact a build has to produce first. */
const OPENABLE: Toolset[] = [COREUTILS, CX3576_ASSEMBLY, X64_ASSEMBLY, VERITY, distroRaucToolset()]

const opened: Toolbox[] = []
afterAll(async () => {
  for (const tb of opened) await tb.close()
}, OPEN_TIMEOUT_MS)

describe('the declarations themselves', () => {
  test('the list this file iterates is not empty, and covers both assemblers', () => {
    expect(OPENABLE.map(t => t.key)).toEqual(['coreutils', 'cx3576-assembly', 'x64-assembly', 'verity', 'rauc-distro'])
  })

  test('every image is an images.env KEY, never a literal reference', () => {
    // R6 removed the last floating tag from the shipping path. A `docker run`
    // in this package takes its image from from.sh or it does not run.
    for (const t of [...OPENABLE, ...(existsSync(shippedRaucPath('amd64')) ? [bundleToolset()] : [])]) {
      expect(`${t.key}: ${t.imageKey}`).toMatch(/^[a-z0-9-]+: (IMAGE|LOCAL)_[A-Z0-9_]+$/)
      expect(`${t.key} names no digest`).toBe(`${t.key} names no digest`)
      expect(t.imageKey).not.toContain('@sha256:')
      expect(t.imageKey).not.toContain(':')
    }
  })

  test('every toolset declares at least one tool, or its route check asserts nothing', () => {
    for (const t of OPENABLE) expect(`${t.key}: ${t.tools.length > 0}`).toBe(`${t.key}: true`)
  })

  test('the two assembly toolsets are on DIFFERENT base images, as their scripts are', () => {
    // os/mkimage-x64.sh's header: BOOTX64.EFI is only as reproducible as the
    // grub-efi-amd64-bin in its container, and that is a Debian package.
    expect(CX3576_ASSEMBLY.imageKey).toBe('IMAGE_ALPINE_3_21')
    expect(X64_ASSEMBLY.imageKey).toBe('IMAGE_DEBIAN_TRIXIE')
    expect(CX3576_ASSEMBLY.manager).toBe('apk')
    expect(X64_ASSEMBLY.manager).toBe('apt')
  })

  test('the package lists are the shell\'s, not a merged one', () => {
    // A tidied-up union would be a change to the shipped bytes, made inside the
    // milestone whose gate is that nothing changed.
    expect(CX3576_ASSEMBLY.packages.join(' '))
      .toBe('bash coreutils sgdisk dosfstools mtools e2fsprogs e2fsprogs-extra u-boot-tools')
    expect(X64_ASSEMBLY.packages.join(' '))
      .toBe('gdisk dosfstools mtools e2fsprogs grub-efi-amd64-bin grub-common')
  })
})

describe('every toolset opens and provides what it claims', () => {
  for (const toolset of OPENABLE) {
    test(`${toolset.key}: opens in its pinned image with every declared tool present`, async () => {
      // Toolbox.open asserts the tools itself and refuses by name otherwise --
      // so reaching this line is most of the assertion. What is added is that
      // each tool ANSWERS, not merely that a `command -v` found something.
      const tb = await Toolbox.open(toolset, { route: 'container', mounts: [REPO_ROOT] })
      opened.push(tb)
      expect(tb.route).toBe('container')
      expect(tb.image).toMatch(/@sha256:[0-9a-f]{64}$/)
      for (const tool of toolset.tools) {
        const r = await tb.run(['sh', '-c', 'command -v -- "$1"', 'sh', tool])
        expect(`${toolset.key}/${tool}: ${r.exitCode}`).toBe(`${toolset.key}/${tool}: 0`)
        expect(`${toolset.key}/${tool}: ${r.stdout.trim() !== ''}`).toBe(`${toolset.key}/${tool}: true`)
      }
    }, OPEN_TIMEOUT_MS)
  }

  test('x64-assembly really carries grub-mkstandalone, which is why it is a Debian image', async () => {
    const tb = opened.find(t => t.toolset.key === 'x64-assembly')
    expect(tb).toBeDefined()
    const r = await tb!.must(['grub-mkstandalone', '--version'])
    expect(r.stdout).toContain('grub-mkstandalone')
  }, OPEN_TIMEOUT_MS)

  test('cx3576-assembly carries the mke2fs these layouts need, which this host does not', async () => {
    const tb = opened.find(t => t.toolset.key === 'cx3576-assembly')
    const r = await tb!.must(['mke2fs', '-V'])
    expect(`${r.stdout}${r.stderr}`).toMatch(/^mke2fs 1\.(4[7-9]|[5-9][0-9])/)
  }, OPEN_TIMEOUT_MS)
})
