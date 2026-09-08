// Every toolset this package declares, OPENED -- because a package list is a
// claim about what an image provides, and the only way to check a claim about
// an image is to run it.
//
// The two assembly toolsets are the ones that matter here. Their package lists
// are transcribed from the cx3576 and x64 assembly contracts, and they use
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
  uefiAssembly,
  UEFI_ARCHES,
} from './toolsets.ts'

/** Every toolset that can be opened without an artifact a build has to produce first. */
const OPENABLE: Toolset[] = [COREUTILS, CX3576_ASSEMBLY, uefiAssembly('amd64'), uefiAssembly('arm64'), VERITY, distroRaucToolset()]

const opened: Toolbox[] = []
afterAll(async () => {
  for (const tb of opened) await tb.close()
}, OPEN_TIMEOUT_MS)

describe('the declarations themselves', () => {
  test('the list this file iterates is not empty, and covers every assembler', () => {
    // Both UEFI architectures, not only the one this host assembles today. A
    // list naming amd64 alone would leave the arm64 row unopened, and the
    // arm64 row is the one with a step the other does not have: its grub
    // package is foreign to this image and arrives through
    // dpkg --add-architecture.
    expect(OPENABLE.map(t => t.key)).toEqual(
      ['coreutils', 'cx3576-assembly', 'uefi-assembly-amd64', 'uefi-assembly-arm64', 'verity', 'rauc-distro'],
    )
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
    // the x64 assembly contract's header: BOOTX64.EFI is only as reproducible as the
    // grub-efi-amd64-bin in its container, and that is a Debian package.
    expect(CX3576_ASSEMBLY.imageKey).toBe('IMAGE_ALPINE_3_21')
    expect(uefiAssembly('amd64').imageKey).toBe('IMAGE_DEBIAN_TRIXIE')
    expect(CX3576_ASSEMBLY.manager).toBe('apk')
    expect(uefiAssembly('amd64').manager).toBe('apt')
  })

  test('the package lists are the shell\'s, not a merged one', () => {
    // A tidied-up union would be a change to the shipped bytes, made inside the
    // milestone whose gate is that nothing changed.
    expect(CX3576_ASSEMBLY.packages.join(' '))
      .toBe('bash coreutils sgdisk dosfstools mtools e2fsprogs e2fsprogs-extra u-boot-tools')
    expect(uefiAssembly('amd64').packages.join(' '))
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

  test('each UEFI assembly carries grub-mkstandalone AND its own target tree', async () => {
    // Two claims per architecture, because they come from different packages
    // and either can be absent on its own: grub-mkstandalone from grub-common,
    // and the module tree it compiles against from grub-efi-<arch>-bin.
    //
    // One target is foreign to the builder and reaches it only through
    // dpkg --add-architecture, so
    // a container where that step silently did nothing would still answer
    // `grub-mkstandalone --version` and would fail at the first
    // --format for the foreign target, during an image assembly rather than here.
    for (const arch of ['amd64', 'arm64']) {
      const tb = opened.find(t => t.toolset.key === `uefi-assembly-${arch}`)
      expect(tb).toBeDefined()
      const r = await tb!.must(['grub-mkstandalone', '--version'])
      expect(r.stdout).toContain('grub-mkstandalone')
      const target = UEFI_ARCHES[arch]!.grubFormat
      const mods = await tb!.must(['ls', `/usr/lib/grub/${target}`])
      expect(mods.stdout).toContain('.mod')
    }
  }, OPEN_TIMEOUT_MS)

  test('cx3576-assembly carries the mke2fs these layouts need, which this host does not', async () => {
    const tb = opened.find(t => t.toolset.key === 'cx3576-assembly')
    const r = await tb!.must(['mke2fs', '-V'])
    expect(`${r.stdout}${r.stderr}`).toMatch(/^mke2fs 1\.(4[7-9]|[5-9][0-9])/)
  }, OPEN_TIMEOUT_MS)
})
