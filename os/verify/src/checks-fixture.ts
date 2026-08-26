// A synthetic image, for driving a ported check RED.
//
// PLAN-014 M4b (RFCT-110). RFCT-096's rule is that a ported check lands with
// the fixture that fails it, because the parity harness cannot tell a check
// that PASSES from a check that CANNOT FAIL -- both report "agrees with the
// oracle" against a healthy image, and only a mutation separates them.
//
// ═══ WHY A FAKE IMAGE AND NOT A MUTATED REAL ONE ═══
//
// Both, actually: `os/verify/HARNESS.md` records an end-to-end run against a
// real image edited on disk, which is what proves the whole pipeline reports
// the failing direction. What that run CANNOT be is one mutation per check --
// it is a 1.3 GB copy and a three-minute run each time, and half the mutations
// (a partition that is not the last one, a table with a partition missing)
// cannot be made with sgdisk without making three other checks red at the same
// time, so the failure would not name one check.
//
// So each check is also driven here, against a table built in memory: one
// mutation, one check, one named failure, no image and no container. The
// baseline is asserted GREEN first in every case, because a fixture that fails
// a check it did not mutate proves nothing about the mutation.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Board } from './board.ts'
import type { ImageContext } from './checks.ts'
import type { FatSlot, GptPartition, GptTable } from './image.ts'
import { walkLayout } from './layout.ts'
import { OS_DIR } from './paths.ts'
import type { ToolResult, ToolRuntime } from './tools.ts'
import { ToolOutputError } from './tools.ts'

/** A tool run that never happened, for the checks that drive no tool. */
const NO_TOOLS: ToolRuntime = {
  route: 'host',
  announce: 'os/verify: no tools (fixture)',
  run: async (argv): Promise<ToolResult> => {
    throw new ToolOutputError(
      `the fixture runtime was asked to run \`${argv.join(' ')}\`. A check reaching a real tool from `
      + `a synthetic context is reading something the fixture did not set up, so the verdict would `
      + `be about the host rather than about the mutation.`,
    )
  },
  dispose: async () => {},
}

/** A runtime that answers exactly one command and refuses every other. */
export function toolsAnswering(match: RegExp, result: Partial<ToolResult>): ToolRuntime {
  return {
    ...NO_TOOLS,
    run: async (argv): Promise<ToolResult> => {
      const line = argv.join(' ')
      if (!match.test(line)) return NO_TOOLS.run(argv)
      return { argv, code: 0, stdout: '', stderr: '', ...result }
    },
  }
}

export { NO_TOOLS }

/**
 * The GPT a board's own definition describes -- i.e. the table of an image that
 * is exactly right.
 *
 * Built by the SAME walk the checks compare against, which is the one place
 * that is legitimate: the fixture's job is to be green until it is mutated, so
 * a baseline the checks agree with is the baseline. Every assertion below then
 * comes from a MUTATION of it, and it is the mutation that is the test.
 */
export function healthyGpt(board: Board, slotSectors: number): GptTable {
  const walk = walkLayout(board, slotSectors)
  const partitions: GptPartition[] = walk.rows.map(row => ({
    number: row.number,
    firstSector: row.startSector,
    lastSector: row.startSector + row.sizeSectors - 1,
    sizeSectors: row.sizeSectors,
    typeGuid: row.typecode,
    uniqueGuid: row.guid,
    name: row.label,
    attributeFlags: '0000000000000000',
  }))
  return {
    image: '(fixture)',
    sectorSize: board.sectorSize ?? 512,
    diskGuid: board.get('DISK_GUID') ?? '',
    totalSectors: walk.totalSizeMib * walk.sectorsPerMib,
    partitions,
    partition: (n: number) => partitions.find(p => p.number === n),
  }
}

/** `healthyGpt` with one partition's fields replaced. */
export function gptWith(
  table: GptTable,
  number: number,
  over: Partial<GptPartition>,
): GptTable {
  const partitions = table.partitions.map(p => (p.number === number ? { ...p, ...over } : p))
  return { ...table, partitions, partition: (n: number) => partitions.find(p => p.number === n) }
}

/** `healthyGpt` with one partition removed entirely. */
export function gptWithout(table: GptTable, number: number): GptTable {
  const partitions = table.partitions.filter(p => p.number !== number)
  return { ...table, partitions, partition: (n: number) => partitions.find(p => p.number === n) }
}

export interface FixtureRequest {
  readonly board: Board
  readonly gpt: GptTable
  readonly tools?: ToolRuntime
  /** The size the file at `ctx.image` should report. Defaults to the walk's. */
  readonly imageBytes?: number
}

export interface Fixture {
  readonly ctx: ImageContext
  readonly dispose: () => void
}

/**
 * A context over a synthetic table and a real, EMPTY file of a chosen size.
 *
 * The file has to exist because `gpt-image-size` stats it, and it is sparse
 * because the size is the only thing about it any check reads. Everything that
 * would touch the image's CONTENT throws, by name: a check that reached for
 * bytes here would be answered by the fixture rather than by the mutation.
 */
export function imageFixture(request: FixtureRequest): Fixture {
  const { board, gpt, tools = NO_TOOLS } = request
  const dir = mkdtempSync(join(tmpdir(), 'mos-image-fixture-'))
  const image = join(dir, 'fixture.img')
  writeFileSync(image, '')
  const walk = walkLayout(board, gpt.partition(Number(board.get('ROOTFS_A_PARTNUM')))?.sizeSectors ?? 0)
  truncateSync(image, request.imageBytes ?? walk.totalSizeMib * (board.mibBytes ?? 1048576))

  const refuse = (what: string): never => {
    throw new ToolOutputError(`the fixture has no ${what}; this check reads more than the table.`)
  }

  const ctx: ImageContext = {
    board,
    image,
    tools,
    workDir: dir,
    gpt: async () => gpt,
    partition: async (nameOrNumber: string | number) => {
      const found = typeof nameOrNumber === 'number'
        ? gpt.partition(nameOrNumber)
        : gpt.partitions.find(p => p.name.toLowerCase() === String(nameOrNumber).toLowerCase())
      if (found === undefined) throw new ToolOutputError(`the fixture table has no partition '${nameOrNumber}'`)
      return found
    },
    fatSlot: async (nameOrNumber: string | number): Promise<FatSlot> => {
      const found = typeof nameOrNumber === 'number'
        ? gpt.partition(nameOrNumber)
        : gpt.partitions.find(p => p.name.toLowerCase() === String(nameOrNumber).toLowerCase())
      if (found === undefined) throw new ToolOutputError(`the fixture table has no partition '${nameOrNumber}'`)
      return { image, offsetBytes: found.firstSector * gpt.sectorSize }
    },
    extract: async () => refuse('extracted partition payloads'),
    unpackRoot: async () => refuse('unpacked root'),
  }

  return { ctx, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------------------
// M4c: a synthetic PACKED ROOT, for the batch-2 checks
// ---------------------------------------------------------------------------

/**
 * A directory tree standing in for the unpacked read-only root, and a context
 * whose `unpackRoot` hands it back.
 *
 * WHY A BUILT TREE RATHER THAN A REAL ONE. The real root is 4,354 paths on
 * cx3576 and 9,238 on x64, behind a 256 MiB extract and an unsquashfs in a
 * container; one mutation per check against that is a three-minute run each
 * time. `os/verify/HARNESS.md` records the end-to-end runs that prove the whole
 * pipeline reports the failing direction, and this is what makes ONE mutation
 * name ONE check.
 *
 * WHAT IS NOT INVENTED HERE. /etc/fstab is rendered from the SHIPPED template,
 * os/rootfs/overlay-v2/etc/fstab.in, with the board's own GUIDs -- the same
 * discipline os/tests/ui-location-test.sh:223-236 follows and for the same
 * reason: a fixture built from this file's idea of the table would test that
 * idea rather than the shipped one, and an fstab.in that grew a new placeholder
 * would go on passing here. The renderer refuses a leftover placeholder, which
 * is how that stays true.
 */
export interface RootFixture {
  readonly ctx: ImageContext
  /** The tree on disk, for a test to mutate before driving a check. */
  readonly root: string
  readonly dispose: () => void
}

const FSTAB_IN = join(OS_DIR, 'rootfs', 'overlay-v2', 'etc', 'fstab.in')

/** A constant read out of the ORACLE rather than retyped beside it. */
function verifierConst(name: string): string {
  const src = readFileSync(join(OS_DIR, 'verify-image-v2.sh'), 'utf8')
  const m = new RegExp(`^${name}='(.*)'$`, 'm').exec(src)
    ?? new RegExp(`^${name}="(.*)"$`, 'm').exec(src)
  if (m?.[1] === undefined) {
    throw new ToolOutputError(
      `os/verify-image-v2.sh no longer defines ${name}; a fixture built without it would assert `
      + `this file's idea of the constant rather than the oracle's.`,
    )
  }
  return m[1]
}

function guidOfPartition(board: Board, layout: string): string {
  const g = board.partition(layout)?.guid
  if (g === undefined || g === '') throw new ToolOutputError(`${board.path} declares no ${layout}_GUID`)
  return g.toLowerCase()
}

const TAB = '\t'

/** Every path the batch-2 checks read, in a state that makes all of them PASS. */
function seedHealthyRoot(root: string, board: Board): void {
  const file = (path: string, content = 'x\n'): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  // --- /etc/fstab, rendered from the shipped template ---
  const srvLine = [
    `PARTUUID=${guidOfPartition(board, 'DATA')}`, '/srv', 'ext4', 'noatime,x-systemd.growfs', '0', '2',
  ].join(TAB)
  const fstab = readFileSync(FSTAB_IN, 'utf8')
    .replaceAll('@SRV_LINE@', srvLine)
    .replaceAll('@STATE_GUID@', guidOfPartition(board, 'STATE'))
    .replaceAll('@META_GUID@', guidOfPartition(board, 'META'))
    .replaceAll('@EPHEMERAL_GUID@', guidOfPartition(board, 'EPHEMERAL'))
    .replaceAll('@VAR_OPTS@', 'noatime')
  if (/@[A-Z_]+@/.test(fstab)) {
    throw new ToolOutputError(
      `an unrendered placeholder is left in the fixture fstab: ${FSTAB_IN} has grown a placeholder `
      + `this fixture does not render, so the table under test is not the shipped one.`,
    )
  }
  file('/etc/fstab', fstab)

  // --- the mountpoints the packed root must ship ---
  for (const d of [
    '/mnt/state', '/mnt/meta', '/srv', '/var', '/home', '/root',
    '/usr/local/lib/systemd/system', '/etc/containers/systemd',
  ]) mkdirSync(join(root, d), { recursive: true })

  // --- the regular files ---
  for (const p of [
    '/usr/lib/systemd/systemd', '/usr/bin/mosd',
    '/usr/share/dbus-1/system.d/com.mos.ext.conf',
    '/usr/bin/rauc', '/etc/rauc/system.conf',
    '/usr/share/dbus-1/system.d/de.pengutronix.rauc.conf',
    '/usr/share/dbus-1/system-services/de.pengutronix.rauc.service',
    '/usr/lib/systemd/system/rauc.service', '/usr/lib/systemd/systemd-growfs',
    '/usr/lib/systemd/system/fstrim.service',
    '/usr/lib/systemd/system/serial-getty@.service',
    '/usr/lib/mos/mos-health', '/usr/lib/mos/mos-machine-id',
    '/usr/lib/systemd/system/mos-health.service',
    '/usr/lib/systemd/system/mos-machine-id.service',
    '/etc/passwd', '/etc/group', '/usr/share/factory/etc/shadow',
    '/usr/lib/mos/mos-shadow-reconcile',
    '/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf',
    '/usr/lib/mos/mos-seed-home', '/usr/lib/mos/profile.conf',
    '/etc/mos/health.conf',
  ]) file(p)

  // --- the files a grep check reads, with content that satisfies it ---
  file('/etc/systemd/network/80-dhcp.network', '[Network]\nDHCP=yes\n')
  file('/etc/systemd/journald.conf.d/00-volatile.conf', '[Journal]\nStorage=volatile\n')
  file('/usr/lib/systemd/system/mosd.service', '[Service]\nBusName=com.mos.mosd\n')
  file('/usr/lib/systemd/system/apid.service',
    '[Unit]\nAfter=mosd.service\n[Service]\nStateDirectory=mos/apid\n')
  file('/usr/share/dbus-1/system.d/com.mos.mosd.conf',
    '<busconfig>\n<policy user="root">\n<allow own="com.mos.mosd"/>\n</policy>\n</busconfig>\n')
  file('/etc/systemd/system/mos-shadow-reconcile.service',
    '[Service]\nExecStart=/usr/lib/mos/mos-shadow-reconcile\n')
  file('/etc/tmpfiles.d/mos-var.conf', 'q /var/tmp 1777 root root 10d\ne /var/cache - - - 30d\n')

  // --- the enablement symlinks ---
  for (const [target, unit] of [
    ['multi-user.target.wants', 'mosd.service'],
    ['multi-user.target.wants', 'apid.service'],
    ['sysinit.target.wants', 'systemd-resolved.service'],
    ['multi-user.target.wants', 'mos-health.service'],
    ['multi-user.target.wants', 'mos-machine-id.service'],
    ['timers.target.wants', 'fstrim.timer'],
    ['multi-user.target.wants', 'mos-shadow-reconcile.service'],
  ] as const) {
    const dir = join(root, '/etc/systemd/system', target)
    mkdirSync(dir, { recursive: true })
    symlinkSync(`/usr/lib/systemd/system/${unit}`, join(dir, unit))
  }
  // The two the VENDOR tree enables -- sq_enabled_any's whole reason to exist.
  for (const [target, unit] of [
    ['initrd-root-fs.target.wants', 'systemd-repart.service'],
    ['timers.target.wants', 'systemd-tmpfiles-clean.timer'],
  ] as const) {
    const dir = join(root, '/usr/lib/systemd/system', target)
    mkdirSync(dir, { recursive: true })
    symlinkSync(`/usr/lib/systemd/system/${unit}`, join(dir, unit))
  }

  // --- one kernel's modules, and its modules.dep ---
  file('/usr/lib/modules/6.1.115/modules.dep', '')

  // --- resolv.conf, as systemd-resolved wants it ---
  mkdirSync(join(root, '/etc'), { recursive: true })
  symlinkSync('../run/systemd/resolve/stub-resolv.conf', join(root, '/etc/resolv.conf'))

  // --- apid, carrying the escape page's markup ---
  file('/usr/bin/apid', `ELF ...${verifierConst('BUILTIN_MARKUP')}... trailer\n`)

  // Nothing at /builtin, nothing at /etc/rauc/keyring.pem, nothing under
  // /srv/ui: absence is the shipped state for all three, and seeding any of
  // them would make the fixture red before a test had mutated anything.
}

/** A context over a synthetic packed root. Everything that reads the IMAGE throws. */
export function packedRootFixture(board: Board): RootFixture {
  const dir = mkdtempSync(join(tmpdir(), 'mos-root-fixture-'))
  const root = join(dir, 'root')
  mkdirSync(root, { recursive: true })
  seedHealthyRoot(root, board)

  const refuse = (what: string): never => {
    throw new ToolOutputError(`the packed-root fixture has no ${what}; this check reads more than the tree.`)
  }

  const ctx: ImageContext = {
    board,
    image: join(dir, '(no image)'),
    tools: NO_TOOLS,
    workDir: dir,
    gpt: async () => refuse('partition table'),
    partition: async () => refuse('partition table'),
    fatSlot: async () => refuse('FAT slots'),
    extract: async () => refuse('extracted partition payloads'),
    unpackRoot: async () => root,
  }

  return { ctx, root, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
