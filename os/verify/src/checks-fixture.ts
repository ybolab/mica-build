// A synthetic image, for driving a ported check RED.
//
// A check lands with the fixture that fails it, because nothing can tell a check
// that passes from a check that cannot fail: both report green against a healthy
// image, and only a mutation separates them.
//
// A fake image as well as a mutated real one. `os/verify/HARNESS.md` records an
// end-to-end run against a real image edited on disk, which proves the whole
// pipeline reports the failing direction; what it cannot be is one mutation per
// check, being a 1.3 GB copy and a three-minute run each time, and half the
// mutations (a partition that is not the last one, a table with a partition
// missing) cannot be made with sgdisk without turning three other checks red at
// once. So each check is also driven here against a table built in memory: one
// mutation, one check, one named failure, no image and no container, with the
// baseline asserted green first in every case.

import {
  chmodSync,
  existsSync,
  chownSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Board } from './board.ts'
import type { ImageContext } from './checks.ts'
import type { FatSlot, GptPartition, GptTable } from './image.ts'
import { walkLayout } from './layout.ts'
import { CONTRACT, mountUnitFor } from './checks-connd.ts'
import { cryptPrefixes, readProfileContract } from './checks-system.ts'
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
    outDir: dir,
    // No check that reads the table reads the trust root; the path is inside
    // the fixture so that one reaching for it finds an empty directory rather
    // than the host's real ca/.
    caDir: join(dir, 'ca'),
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
    // Named, empty, and not a refusal. The layout-addressed families hand this
    // name to a TOOL and never read the bytes themselves -- the stub runtime
    // keys its transcript on the file name, which is the tier. So the fixture
    // supplies the name and nothing behind it: a check that did read the bytes
    // gets `readBytes`'s own refusal naming a zero-length file, which is a
    // sentence about the fixture rather than about the image.
    extractAt: async (name: string) => {
      const at = join(dir, name)
      if (!existsSync(at)) writeFileSync(at, '')
      return at
    },
    unpackRoot: async () => refuse('unpacked root'),
  }

  return { ctx, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

// M4c: a synthetic packed root, for the batch-2 checks

/**
 * A directory tree standing in for the unpacked read-only root, and a context
 * whose `unpackRoot` hands it back.
 *
 * Why a built tree rather than a real one. The real root is 4,354 paths on
 * cx3576 and 9,238 on x64, behind a 256 MiB extract and an unsquashfs in a
 * container; one mutation per check against that is a three-minute run each
 * time. `os/verify/HARNESS.md` records the end-to-end runs that prove the whole
 * pipeline reports the failing direction, and this is what makes ONE mutation
 * name ONE check.
 *
 * What is not invented here. /etc/fstab is rendered from the SHIPPED template,
 * os/rootfs/overlay/etc/fstab.in, with the board's own GUIDs -- the same
 * discipline the image fixture contract follows and for the same
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

const FSTAB_IN = join(OS_DIR, 'rootfs', 'overlay', 'etc', 'fstab.in')

/**
 * The escape page's markup, TRANSCRIBED -- and deliberately a second copy.
 *
 * The fixture's idea of the constant and the CHECK's idea of it come from two
 * places, so they cannot drift apart silently: this is an INDEPENDENT literal
 * from `checks-root.ts`'s, and `checks-root.test.ts` asserts the two equal.
 *
 * Deliberately NOT `import { BUILTIN_MARKUP }`. Seeding the fixture from the
 * very constant the check greps for would make the positive case true by
 * construction -- the check would find what the fixture was built from, and an
 * edit to that one constant would move both sides at once and stay green.
 */
const ORACLE_BUILTIN_MARKUP = '<script type="module" crossorigin src="/ui/assets/app.js"></script>'

/** For the drift assertion in checks-root.test.ts; see above. */
export const FIXTURE_BUILTIN_MARKUP = ORACLE_BUILTIN_MARKUP

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

  // --- apid, carrying the built-in UI's embedded index markup ---
  file('/usr/bin/apid', `ELF ...${ORACLE_BUILTIN_MARKUP}... trailer\n`)

  // --- the shipped bill of materials, one git stamp across its mos rows ---
  //
  // Two Debian rows and two mos rows: the check counts both and asserts the
  // stamp over the mos rows only, so a fixture of only mos packages would
  // leave the "Debian rows are not stamped" half of that rule untested.
  file('/usr/share/mos/manifest.tsv', [
    '#package\tversion\tarchitecture',
    'libc6\t2.41-12\tamd64',
    'mos-podman\t5.8.6+git0123456789ab-1\tamd64',
    'mos-system\t0.1.0+git0123456789ab-1\tall',
    'zstd\t1.5.7+dfsg-2\tamd64',
    '',
  ].join('\n'))

  // --- the RAUC keyring, byte-equal to the trust root the fixture's ca/ holds ---
  // Present, and that is the shipped state now: os/rootfs/build.sh stages
  // ca/ca.cert.pem here in every image, so an absent keyring is the mutation.
  file('/etc/rauc/keyring.pem', FIXTURE_CA_CERT)

  seedDbus(root, file)
  seedEngine(root, board, file)
  seedHomes(root, board, file)
  seedConnd(root, board, file)
  seedShadow(root, file)
  seedMqtt(root, file)
  seedBoardShape(root, board, file)
  // LAST: it prepends an ELF header to the two daemons seeded above and writes
  // the ssh.service the shadow family also touches, so it has to see their
  // final contents rather than be overwritten by them.
  seedSystem(root, board, file)

  // Nothing at /builtin and nothing under /srv/ui: absence is the shipped state
  // for both, and seeding either would make the fixture red before a test had
  // mutated anything. /etc/rauc/keyring.pem is the opposite case and is seeded
  // above -- every image stages one from ca/, so its ABSENCE is the mutation.
}

// M4f: the D-Bus policies

/**
 * The system bus and mosd's sole local-management policy.
 *
 * com.mos.mosd.conf is seeded by `seedHealthyRoot` above, beside the sq_grep
 * that reads it; the parse-level facts this batch asserts are mutations OF that
 * file, so it stays in one place.
 */
function seedDbus(root: string, file: WriteFile): void {
  file('/usr/lib/systemd/system/dbus.service', '[Unit]\n')
  file('/usr/lib/systemd/system/dbus.socket', '[Unit]\n')
}

// M4f: the container engine, the purge, and the trust store

/**
 * How many `copyright` files and CA certificates the fixture seeds.
 *
 * EXACTLY the oracle's threshold, on purpose. The real images carry 162 and 150,
 * and a fixture that carried those numbers would need twenty-odd deletions
 * before a check noticed -- so the mutation that drives it red would be a bulk
 * edit rather than one edit, and it would not say where the boundary is. At the
 * threshold, removing ONE file is the whole test.
 */
const PURGE_THRESHOLD = 100

/**
 * The engine installed and INERT, its configuration, and what the purge left.
 *
 * Nothing here is a stand-in: the units, the mount and the config keys are the
 * ones the checks read, in the shapes the shipped image has. The two things
 * Deliberately absent are the ones absence is the correct state for -- there is
 * no /usr/share/containers/containers.conf (a second config layer podman would
 * merge before /etc, so an operator reading /etc would see half the settings)
 * and no local-fs.target.wants symlink for the Quadlet mount (a static
 * enablement is what makes the container switch gate nothing).
 */
function seedEngine(root: string, board: Board, file: WriteFile): void {
  for (const b of [
    '/usr/bin/podman', '/usr/bin/crun', '/usr/libexec/podman/conmon',
    '/usr/libexec/podman/netavark', '/usr/libexec/podman/aardvark-dns',
    '/usr/libexec/podman/catatonit', '/usr/libexec/podman/quadlet',
    '/usr/lib/systemd/system-generators/podman-system-generator',
    '/usr/sbin/nft',
  ]) file(b)

  // DLOPENed by name, so it is in no NEEDED list -- and the directory follows
  // the board's architecture, which is why the check searches /usr/lib whole
  // rather than naming a multiarch triplet.
  file(`/usr/lib/${board.arch === 'amd64' ? 'x86_64' : 'aarch64'}-linux-gnu/libsystemd.so.0`)

  file('/etc/containers/policy.json', '{"default":[{"type":"insecureAcceptAnything"}]}\n')
  file('/etc/containers/registries.conf', 'unqualified-search-registries = ["docker.io"]\n')
  file('/etc/containers/containers.conf',
    '[engine]\nhelper_binaries_dir = ["/usr/libexec/podman"]\nlog_driver = "journald"\n')
  // DATA, not /var: /var is the EPHEMERAL partition, 512 MiB and wiped by
  // design, so images there are capped and then silently destroyed.
  file('/etc/containers/storage.conf', '[storage]\ndriver = "overlay"\ngraphroot = "/srv/containers/storage"\n')

  file('/etc/systemd/system/etc-containers-systemd.mount',
    '[Mount]\nWhat=/mnt/state/quadlet\nWhere=/etc/containers/systemd\nType=none\nOptions=bind\n')

  // The purge's positive half: the licences Debian ships to satisfy the
  // redistribution terms of the GPL and everything else in the image.
  for (let i = 0; i < PURGE_THRESHOLD; i += 1) {
    file(`/usr/share/doc/pkg${String(i).padStart(3, '0')}/copyright`, 'Format: https://…\n')
  }

  // The trust store, GENERATED rather than shipped -- which is what fails when
  // ca-certificates installs without its postinst having run.
  file('/etc/ssl/certs/ca-certificates.crt',
    `${Array.from({ length: PURGE_THRESHOLD }, (_v, i) =>
      `-----BEGIN CERTIFICATE-----\ncert${i}\n-----END CERTIFICATE-----`).join('\n')}\n`)
}

// M4f: /home, /root, the mos account, and the STATE binds

/**
 * The two persistent homes, their seeds, and the binds that keep precious state
 * off the discardable /var.
 *
 * The seed SCRIPTS are seeded in the shape the checks read them, which is a
 * static read of a handful of anchored lines -- `mkdir /srv/root`,
 * `chmod 0700 /srv/root`, `chown 0:0 /srv/root` at the start of a line and
 * nothing else. That is deliberately the oracle's own reading rather than a
 * plausible script: the check greps for those exact lines, so a fixture written
 * to be realistic instead of to be READ would pass for the wrong reason.
 *
 * `/root` is chmod-ed and chown-ed because the mountpoint's own mode is asserted
 * -- Debian ships it 0700 root:root and nothing guaranteed it stayed that way
 * through the pack stage, and DATA is not verity-protected, so the mode is not
 * implied by anything.
 */
function seedHomes(root: string, board: Board, file: WriteFile): void {
  file('/bin/bash')

  // /root's own mode, which is a separate fact from its existence.
  chmodSync(join(root, '/root'), 0o700)
  ownAsRoot(root, '/root', 0)

  const mount = (unit: string, what: string, where: string): void => {
    file(`/etc/systemd/system/${unit}`,
      `[Mount]\nWhat=${what}\nWhere=${where}\nType=none\nOptions=bind\n[Install]\nWantedBy=local-fs.target\n`)
    enableEtcUnit(root, unit, 'local-fs.target.wants')
  }
  mount('home.mount', '/srv/home', '/home')
  mount('root.mount', '/srv/root', '/root')
  mount('usr-local-lib-systemd-system.mount', '/mnt/state/systemd-units', '/usr/local/lib/systemd/system')
  // var-lib-mos.mount is written by seedMqtt (the bridge's EnvironmentFile lives
  // on it); enabling it is this family's business, and a unit installed and not
  // enabled is precisely the failure both families exist to catch.
  enableEtcUnit(root, 'var-lib-mos.mount', 'local-fs.target.wants')
  if ((board.radios ?? []).includes('bluetooth')) {
    mount('var-lib-bluetooth.mount', '/mnt/state/bluetooth', '/var/lib/bluetooth')
  }

  for (const [unit, before] of [
    ['mos-seed-home.service', 'home.mount'],
    ['mos-seed-root.service', 'root.mount'],
  ] as const) {
    file(`/etc/systemd/system/${unit}`,
      `[Unit]\nBefore=${before}\n[Service]\nType=oneshot\nExecStart=/usr/lib/mos/${unit.replace('.service', '')}\n`)
    enableEtcUnit(root, unit, 'local-fs.target.wants')
  }

  file('/usr/lib/mos/mos-seed-home',
    '#!/bin/sh\n'
    + '# The pair is PINNED, not resolved: the home on DATA outlives this rootfs.\n'
    + 'MOS_UID=1000\n'
    + 'MOS_GID=1000\n'
    + '[ -d /srv/home/mos ] && exit 0\n'
    + 'mkdir /srv/home/mos\n'
    + 'chmod 0700 /srv/home/mos\n'
    + 'chown "${MOS_UID}:${MOS_GID}" /srv/home/mos\n')

  file('/usr/lib/mos/mos-seed-root',
    '#!/bin/sh\n'
    + '# Everything here is under /srv: /root before the bind is the verity root.\n'
    + '[ -d /srv/root ] && exit 0\n'
    + 'mkdir /srv/root\n'
    + 'chmod 0700 /srv/root\n'
    + 'chown 0:0 /srv/root\n')
  chmodSync(join(root, '/usr/lib/mos/mos-seed-root'), 0o755)
}

/** The profile KEY mosd reads, out of mosd's own source. */
function profileKeyFromMosd(): string {
  const key = readProfileContract().key
  if (key === '') {
    throw new ToolOutputError(
      'os/pkgs/mosd/mosd/src/provisioning.rs no longer declares PROFILE_KEY. A fixture that wrote the key '
      + 'down would keep passing while the image and mosd disagreed about it.',
    )
  }
  return key
}

/** The one crypt(3) prefix transient.rs pins, for the fixture's libcrypt to carry. */
function cryptPrefixFromMosd(): string {
  const prefixes = cryptPrefixes()
  if (prefixes.length !== 1) {
    throw new ToolOutputError(
      `os/pkgs/mosd/mosd/src/transient.rs pins ${prefixes.length} crypt(3) prefixes; the fixture cannot make `
      + `the libcrypt check green against an ambiguous source, and pinning one here would test this `
      + `file's idea of the format rather than mosd's.`,
    )
  }
  return prefixes[0] as string
}

/** A `*.wants` symlink for a unit that lives in /etc/systemd/system, not /usr/lib. */
function enableEtcUnit(root: string, unit: string, target: string): void {
  const dir = join(root, '/etc/systemd/system', target)
  mkdirSync(dir, { recursive: true })
  symlinkSync(`/etc/systemd/system/${unit}`, join(dir, unit))
}

// M4f: the Wi-Fi userland, on the boards that declare a radio

/**
 * hostapd, wpa_supplicant, their unit templates and the STATE binds behind them.
 *
 * Every name here comes from the CONND contract, read out of `os/pkgs/mosd/` by the same
 * function the checks read it with. That is the same trade `healthyGpt` makes
 * one layer up and for the same reason: the fixture's job is to be green until
 * it is MUTATED, so a baseline built from the contract is the baseline, and
 * every assertion below comes from an edit to it. Writing `wpa_supplicant` down
 * here instead would make the fixture stop tracking a rename in mosd while the
 * checks followed it -- and the tests would then fail for a reason that is not
 * about the image.
 *
 * The two ExecStart lines use DIFFERENT instance specifiers on purpose: the
 * station's `%I` and the access point's `%i`, which is what both shipped images
 * actually carry. A port that accepted only one of them would fail one of the
 * two on a correct image, and only a fixture carrying both can show it does not.
 */
function seedConnd(root: string, board: Board, file: WriteFile): void {
  if (!(board.radios ?? []).includes('wifi')) return
  const c = CONTRACT

  file('/usr/sbin/hostapd')
  file('/usr/sbin/wpa_supplicant')
  file(`/usr/lib/systemd/system/${c.staUnit}`,
    `[Service]\nExecStart=/usr/sbin/wpa_supplicant -c ${c.staDir}/${c.staConf.replaceAll('{interface}', '%I')} -i %I\n`)
  file(`/usr/lib/systemd/system/${c.apUnit}`,
    `[Service]\nExecStart=/usr/sbin/hostapd ${c.apDir}/${c.apConf.replaceAll('{interface}', '%i')}\n`)

  // The packages' own units, MASKED -- the only form that also blocks the D-Bus
  // activation path wpasupplicant ships. Not merely disabled, and with no
  // *.wants entry left behind by the postinst.
  for (const u of ['hostapd.service', 'wpa_supplicant.service', 'dbus-fi.w1.wpa_supplicant1.service']) {
    mkdirSync(join(root, '/etc/systemd/system'), { recursive: true })
    symlinkSync('/dev/null', join(root, '/etc/systemd/system', u))
  }

  for (const where of [c.staDir, c.apDir]) {
    const unit = mountUnitFor(where)
    file(`/etc/systemd/system/${unit}`,
      `[Mount]\nWhat=/mnt/state/${where.split('/').at(-1)}\nWhere=${where}\nType=none\nOptions=bind\n`)
    enableEtcUnit(root, unit, 'local-fs.target.wants')
  }

  // Nothing at /usr/sbin/dnsmasq: the AP's DHCP server is systemd-networkd's own
  // DHCPServer=yes, and a second one on the same link is a conflict.
}

// M4f: the small root-side families -- networkd, the ELF headers, the
// bootloader environment, repart, sshd, the profile and libcrypt

/** ELF magic, then padding, then `e_machine` as the 16-bit LE field at offset 18. */
function elfHeader(arch: string | undefined): Buffer {
  const head = Buffer.alloc(64)
  head.write('\x7fELF', 0, 'latin1')
  // Not a written-down pair of magic numbers on each side of the comparison:
  // the CHECK reads MOS_ARCH out of the board and so does this, so a third
  // architecture is a change in one place.
  head.writeUInt16LE(arch === 'amd64' ? 0x3E : 0xB7, 18)
  return head
}

/**
 * What the ten small families read.
 *
 * Board-shaped throughout, from the board's own declarations: the ELF machine
 * follows MOS_ARCH, the bootloader helpers follow RAUC_BOOTLOADER, fw_env.config
 * addresses the two UENV partitions by the GUIDs and the size the board
 * declares, and the multiarch directory libcrypt lands in follows MOS_ARCH too.
 * Pinning any of them would make `packedRootFixture(x64)` an arm64 tree with
 * the wrong names.
 */
function seedSystem(root: string, board: Board, file: WriteFile): void {
  enable(root, 'systemd-networkd.service')

  for (const p of ['/usr/bin/mosd', '/usr/bin/apid']) {
    const existing = readFileSync(join(root, p))
    writeFileSync(join(root, p), Buffer.concat([elfHeader(board.arch), existing]))
  }

  if (board.bootloader === 'uboot') {
    file('/usr/bin/fw_printenv')
    // A SYMLINK, which is what trixie's libubootenv ships: one multi-call
    // binary. The check accepts either spelling, and this is the one that would
    // fail a naive "is a regular file" assertion.
    symlinkSync('fw_printenv', join(root, '/usr/bin/fw_setenv'))
    const size = Number(board.get('UENV_SIZE_BYTES') ?? 0)
    const hex = `0x${size.toString(16)}`
    file('/etc/fw_env.config',
      ['UENV_A', 'UENV_B']
        .map(k => `/dev/disk/by-partuuid/${(board.partition(k)?.guid ?? '').toLowerCase()}\t0x0\t${hex}`)
        .join('\n') + '\n')
  }
  else {
    file('/usr/bin/grub-editenv')
  }

  file('/usr/bin/curl')
  seedBootScripts(root, file)

  // One repart definition per linux-generic partition in the board's own walk,
  // and exactly ONE of them growing. The count the check compares against comes
  // from the GPT, so a fixture that wrote its own number would hand the check
  // the same value on both sides of its own comparison.
  for (const [i, name] of linuxGenericDefinitions(board).entries()) {
    file(`/etc/repart.d/${name}`,
      `[Partition]\nType=linux-generic\n${name === '80-data.conf' ? 'Weight=1000\n' : `Priority=${i}\n`}`)
  }

  file('/etc/ssh/sshd_config', 'Port 22\nPermitRootLogin prohibit-password\n')
  file('/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf',
    'AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u\n')
  file('/etc/systemd/system/etc-ssh.mount',
    '[Mount]\nWhat=/mnt/state/ssh\nWhere=/etc/ssh\nType=none\nOptions=bind\n')
  enableEtcUnit(root, 'etc-ssh.mount', 'local-fs.target.wants')

  // The profile: mode 0444, one lowercase value, and ssh.service NOT enabled.
  file('/usr/lib/mos/profile.conf', `${profileKeyFromMosd()}=dev\n`)
  chmodSync(join(root, '/usr/lib/mos/profile.conf'), 0o444)
  file('/usr/lib/systemd/system/ssh.service',
    '[Service]\nKillMode=process\nExecReload=/bin/kill -HUP $MAINPID\n')

  // libcrypt, at the multiarch directory this board's MOS_ARCH selects, reached
  // through the SONAME symlink the login stack loads -- and carrying the crypt(3)
  // prefix transient.rs pins, read from transient.rs rather than typed here.
  const triplet = board.arch === 'amd64' ? 'x86_64-linux-gnu' : 'aarch64-linux-gnu'
  file(`/usr/lib/${triplet}/libcrypt.so.1.1.0`, `\x7fELF...${cryptPrefixFromMosd()}...\n`)
  symlinkSync('libcrypt.so.1.1.0', join(root, `/usr/lib/${triplet}/libcrypt.so.1`))
}

/**
 * A /usr/lib/mos script with enough shape to exercise the command extractor, and
 * the binaries it names.
 *
 * Sixteen commands, because the check refuses fewer than ten: an extractor that
 * stopped seeing commands would make the presence test pass while proving
 * nothing, and the oracle guards that with a vacuity floor. A fixture sitting
 * below the floor could not tell a working extractor from a broken one.
 *
 * The body is deliberately awkward in the ways the pipeline is about: a `case`
 * block whose PATTERNS are not commands, a command substitution inside a
 * double-quoted string, an escaped `#` in a message, a line continuation, a
 * locally defined function, and a wrapper call. Each of those is a stage of the
 * extractor and each has a case beside it.
 */
function seedBootScripts(root: string, file: WriteFile): void {
  for (const c of [
    'awk', 'cat', 'chmod', 'chown', 'cp', 'grep', 'head', 'mkdir',
    'mktemp', 'mv', 'od', 'rm', 'sed', 'sleep', 'sync', 'tr',
  ]) file(`/usr/bin/${c}`)

  file('/usr/lib/mos/mos-health',
    '#!/bin/sh\n'
    + 'set -eu\n'
    + '\n'
    + 'have() { command -v "$1" >/dev/null 2>&1; }\n'
    + 'probe() {\n'
    + '    # a wrapper call: curl is OPTIONAL and must not be extracted\n'
    + '    have curl || return 0\n'
    + '}\n'
    + '\n'
    + 'tmp="$(mktemp -d)"\n'
    + 'mkdir -p "${tmp}/work"\n'
    + 'chmod 0700 "${tmp}"\n'
    + 'chown 0:0 "${tmp}"\n'
    + 'cat /proc/uptime | awk \'{ print $1 }\' >"${tmp}/uptime"\n'
    + 'grep -q booted "${tmp}/uptime" || true\n'
    + 'head -n1 "${tmp}/uptime" | tr -d \'\\n\' >"${tmp}/short"\n'
    + 'sed -e \'s/x/y/\' "${tmp}/short" >"${tmp}/edited"\n'
    + 'od -An -c "${tmp}/edited" >"${tmp}/dump"\n'
    + 'cp "${tmp}/dump" "${tmp}/dump.bak"\n'
    + 'mv "${tmp}/dump.bak" "${tmp}/dump.old"\n'
    + 'printf \'%s\\n\' "state \\# ok" >"${tmp}/note"\n'
    + 'case "${1:-status}" in\n'
    + 'status)\n'
    + '    probe\n'
    + '    ;;\n'
    + 'reset)\n'
    + '    rm -rf "${tmp}/work"\n'
    + '    ;;\n'
    + 'esac\n'
    + 'sleep 0 \\\n'
    + '    && sync\n')
}

/** `80-data.conf` plus one definition per other linux-generic partition. */
function linuxGenericDefinitions(board: Board): string[] {
  const walk = walkLayout(board, Number(board.partition('ROOTFS_A')?.sizeSectors ?? 0))
  const generic = walk.rows.filter(r => r.typecode.toLowerCase() === '0fc63daf-8483-4772-8e79-3d69d8477de4')
  return generic.map((r, i) => (r.label.toLowerCase() === 'data' ? '80-data.conf' : `${10 + i}-${r.label}.conf`))
}

/** What `seedHealthyRoot` hands its helpers: write a file, making its parents. */
type WriteFile = (path: string, content?: string) => void

// M4d: the accounts, the credential template, and the reconciler

/**
 * The gid the image gives the `shadow` group. 42 on Debian, and the value both
 * shipped images carry -- read back out of the fixture's own /etc/group by the
 * check, never restated there.
 */
const SHADOW_GID = 42

/**
 * The accounts, as `/etc/passwd` and the factory `/etc/shadow` template.
 *
 * Small on purpose -- the real images carry 25 -- because what the checks read
 * is the RELATION between the two files: every name in passwd has an entry in
 * the template, and every entry in the template is locked. A hundred accounts
 * would test the same relation more slowly.
 *
 * `mos-mqttd` and `mos-mqtt-broker` are here because the MQTT checks assert
 * their units run as identities the image actually defines; that is one fact
 * about one file and it belongs in one place.
 */
const ACCOUNTS: readonly { name: string, uid: number, gid: number, shell: string }[] = [
  { name: 'root', uid: 0, gid: 0, shell: '/bin/bash' },
  { name: 'mos', uid: 1000, gid: 1000, shell: '/bin/bash' },
  { name: 'mos-mqttd', uid: 970, gid: 970, shell: '/usr/sbin/nologin' },
  { name: 'mos-mqtt-broker', uid: 969, gid: 969, shell: '/usr/sbin/nologin' },
]

function seedShadow(root: string, file: WriteFile): void {
  file('/etc/passwd', `${ACCOUNTS.map(a =>
    `${a.name}:x:${a.uid}:${a.gid}::/home/${a.name}:${a.shell}`).join('\n')}\n`)
  file('/etc/group', `root:x:0:\nshadow:x:${SHADOW_GID}:\nmos:x:1000:\n`)

  // Every entry LOCKED: `!` in the password field. A signed rootfs is
  // byte-identical across the fleet, so a usable hash here is a usable hash on
  // every device -- which is the thing the check asserts and the reason the
  // fixture must not carry one even as filler.
  file('/usr/share/factory/etc/shadow',
    `${ACCOUNTS.map(a => `${a.name}:!:20000:0:99999:7:::`).join('\n')}\n`)
  // 0640 root:shadow, and it must survive packing: unix_chkpwd is setgid
  // shadow precisely so a non-root PAM stack can read it.
  chmodSync(join(root, '/usr/share/factory/etc/shadow'), 0o640)
  ownAsRoot(root, '/usr/share/factory/etc/shadow', SHADOW_GID)

  // The path pam_unix opens, pointing at the tmpfs -- and NOTHING at the
  // destination inside the tree, because a /run/mos/shadow in the image would
  // be a credential identical on every device in the fleet.
  mkdirSync(join(root, '/etc'), { recursive: true })
  symlinkSync('/run/mos/shadow', join(root, '/etc/shadow'))

  // The reconcile unit's ordering, and the four units it orders against. An
  // ordering naming a unit that is not in the image is dropped by systemd
  // SILENTLY, so the check asserts the pair and so does the fixture.
  file('/etc/systemd/system/mos-shadow-reconcile.service',
    '[Unit]\n'
    + 'Before=mosd.service ssh.service\n'
    + 'Before=systemd-logind.service systemd-user-sessions.service\n'
    + '[Service]\nExecStart=/usr/lib/mos/mos-shadow-reconcile\n')
  for (const u of ['ssh.service', 'systemd-logind.service', 'systemd-user-sessions.service']) {
    file(`/usr/lib/systemd/system/${u}`, '[Unit]\n')
  }

  // The script, in the shape the check reads it: source, destination, the
  // build loop's input redirection, and the locked password field.
  file('/usr/lib/mos/mos-shadow-reconcile',
    '#!/bin/sh\n'
    + 'FACTORY="${MOS_SHADOW_FACTORY:-/usr/share/factory/etc/shadow}"\n'
    + 'SHADOW="${MOS_SHADOW_PASSWD:-/run/mos/shadow}"\n'
    + 'while IFS= read -r line; do\n'
    + '  printf \'%s\\n\' "${line}" | awk -F: \'{ $2 = "!"; print }\'\n'
    + 'done <"$FACTORY"\n')

  // ...and mos-seed-state, which must put NO shadow file on STATE -- and which
  // M4f also reads for the two connd render targets. The `for d in ...` loop is
  // the shape the connd checks grep for, not decoration: the seed creates both
  // directories from ONE loop, so the assertion is in two halves and either
  // half alone would pass for a script that created the other twice.
  file('/usr/lib/mos/mos-seed-state',
    '#!/bin/sh\n'
    + 'mkdir -p /mnt/state/mos /mnt/state/ssh\n'
    + 'for d in wpa_supplicant hostapd; do\n'
    + '    mkdir -p "/mnt/state/$d"\n'
    + '    chmod 0700 "/mnt/state/$d"\n'
    + 'done\n')
}

/**
 * `chown 0:gid`, or a sentence saying why it could not.
 *
 * The suite runs as root -- on the host and in the pinned bun container -- and
 * the mode/ownership assertion this seeds for is one the real image satisfies
 * by being packed as root. A bare EPERM here would surface as four unrelated
 * check failures with no hint that the cause was the test user.
 */
function ownAsRoot(root: string, path: string, gid: number): void {
  try {
    chownSync(join(root, path), 0, gid)
  }
  catch (error) {
    throw new ToolOutputError(
      `the packed-root fixture cannot own ${path} as 0:${gid}: `
      + `${error instanceof Error ? error.message : String(error)}.\n`
      + `  The image packs that file 0640 root:shadow and a check asserts it, so the fixture has to `
      + `reproduce it -- which needs root. This suite runs as root on the host and in the pinned bun `
      + `container; a non-root run cannot seed this fixture.`,
    )
  }
}

// M4d: the MQTT bridge and broker, installed and INERT

function seedMqtt(root: string, file: WriteFile): void {
  file('/usr/bin/mos-mqttd')
  file('/usr/bin/mos-mqtt-broker')

  // A STATIC identity, a broker EnvironmentFile on a STATE-backed bind, and a
  // mandatory root-rendered topic identity under /run.
  file('/usr/lib/systemd/system/mos-mqttd.service',
    '[Unit]\n'
    + 'ConditionPathExists=/run/mos/mqttd-device.env\n'
    + '[Service]\n'
    + 'User=mos-mqttd\n'
    + 'EnvironmentFile=-/var/lib/mos/mqttd.env\n'
    + 'EnvironmentFile=/run/mos/mqttd-device.env\n'
    + 'ExecStart=/usr/bin/mos-mqttd --device-id ${MOS_MQTT_DEVICE_ID} '
    + '--broker-host ${MOS_MQTT_BROKER_HOST}\n')
  file('/usr/lib/systemd/system/mos-mqtt-broker.service',
    '[Service]\nUser=mos-mqtt-broker\n')

  // The bind that makes /var/lib/mos writable and persistent. The check looks
  // for a unit whose Where= is the EnvironmentFile's directory, so the fixture
  // ships the same unit the image does rather than a stand-in.
  file('/etc/systemd/system/var-lib-mos.mount',
    '[Mount]\nWhat=/mnt/state/mos\nWhere=/var/lib/mos\nType=none\nOptions=bind\n')

  // Empty is valid: no application is remotely published until its package
  // installs both an exact enrollment file and its exact Item1 policy.
  mkdirSync(join(root, '/usr/lib/mos/mqtt-applications.d'), { recursive: true })

  // NOT enabled: no *.wants symlink for either. mosd starts them from
  // mqtt.enabled, and an enablement baked into the image is the one thing that
  // switch cannot override.
}

// What the BOARD's own declarations say this image carries

/**
 * The board-conditional payload.
 *
 * Everything below is driven by the board definition's own lists, which is what
 * makes `packedRootFixture(x64)` a genuinely x64-shaped tree rather than a
 * cx3576 one loaded with the wrong GUIDs: x64 declares no firmware, no hwinit
 * fact, no radio and BOARD_HAS_STATUS_LED=0, so it gets none of these files.
 * That is precisely what `status-led-absent` asserts, and its FAILING direction
 * -- a board declaring no indicator that ships the unit anyway -- had never been
 * driven anywhere in this tree before: the image fixture contract sources
 * cx3576's board.env, which declares 1, so the =0 branch had only ever been
 * observed passing.
 */
function seedBoardShape(root: string, board: Board, file: WriteFile): void {
  const hwinit = board.hwinitConfs ?? []
  const radios = board.radios ?? []
  const firmware = board.firmwareFiles ?? []

  for (const fw of firmware) file(fw)
  if (firmware.length > 0) {
    // The module list is about this board's radio: the driver it must load, the
    // BT core of the same combo chip, and the superseded driver it must not.
    // The comment line is deliberate -- the file may legitimately EXPLAIN the
    // drop, and a reader that did not strip comments would call that a defect.
    file('/etc/mos/modules.conf', '# bcmdhd was dropped with the AIC-only fleet decision\n'
      + 'aic8800_fdrv\naic8800_btlpm\n')
  }

  for (const c of hwinit) {
    if (c !== 'modules') file(`/etc/mos/${c}.conf`, `# ${c}\n`)
    file(`/usr/lib/mos/hwinit-${c}`)
    // One unit per fact, ENABLED. A unit installed and not enabled is the M4
    // failure this family exists to catch, and it is invisible: nothing logs it.
    file(`/usr/lib/systemd/system/mos-${c}.service`, '[Service]\n')
    enable(root, `mos-${c}.service`)
  }

  if (hwinit.includes('gadget')) {
    file('/usr/lib/udev/rules.d/60-mos-gadget-getty.rules',
      'ACTION=="add", SUBSYSTEM=="tty", KERNEL=="ttyGS0", TAG+="systemd", '
      + 'ENV{SYSTEMD_WANTS}="serial-getty@ttyGS0.service"\n')
  }

  if (radios.includes('bluetooth')) {
    file('/usr/bin/btattach')
    // No `Name =` line: pinning it blocks bluez's hostname plugin and every
    // device in the fleet then advertises the same name.
    file('/etc/bluetooth/main.conf', '[General]\nAlwaysPairable = false\n')
    file('/usr/lib/systemd/system/bluetooth.service', '[Unit]\n')
    // The VENDOR path, which is where trixie's bluez installs it. The oracle
    // accepts /etc/dbus-1/system.d too, because dbus-daemon reads both and a
    // correct bookworm image puts it there.
    file('/usr/share/dbus-1/system.d/bluetooth.conf',
      '<busconfig>\n  <policy user="root">\n    <allow own="org.bluez"/>\n  </policy>\n</busconfig>\n')
    enable(root, 'bluetooth.service', 'bluetooth.target.wants')
  }

  if (board.hasStatusLed === '1') {
    file('/usr/lib/systemd/system/mos-status-led.service',
      '[Unit]\n'
      + 'After=mos-health.service\n'
      + 'Requires=mos-health.service\n'
      + 'After=multi-user.target\n'
      + '[Service]\n'
      + 'Type=oneshot\n'
      + 'RemainAfterExit=yes\n'
      + 'ExecStart=/usr/lib/mos/mos-status-led start\n'
      + 'ExecStop=/usr/lib/mos/mos-status-led stop\n')
    enable(root, 'mos-status-led.service')
    // The branch labels sit at column 0 and each region is closed by a bare
    // `;;`, because that is what the oracle's awk scopes on -- and the
    // destination colour is switched ON before the source is switched off, so
    // neither transition passes through an instant with both LEDs dark.
    file('/usr/lib/mos/mos-status-led',
      '#!/bin/sh\n'
      + 'led_on() { echo 1 >"/sys/class/leds/status-$1/brightness"; }\n'
      + 'led_off() { echo 0 >"/sys/class/leds/status-$1/brightness"; }\n'
      + 'case "$1" in\n'
      + 'start)\n'
      + '\tled_on BLUE\n'
      + '\tled_off RED\n'
      + '\t;;\n'
      + 'stop)\n'
      + '\tled_on RED\n'
      + '\tled_off BLUE\n'
      + '\t;;\n'
      + 'esac\n')
    chmodSync(join(root, '/usr/lib/mos/mos-status-led'), 0o755)
  }

  // Nothing at /etc/modules-load.d/wifi.conf on ANY board: mos-modules
  // superseded it, and the check that says so is board-unconditional.

  // The kernel's own record of itself, for the networking checks.
  // Seeded on every board although only x64 registers those checks: the fixture
  // describes a healthy root, and a root with no /boot/config-* is not one.
  //
  // The symbol names, the module names and the index format are written out
  // HERE as independent literals rather than imported from checks-kernel.ts.
  // Seeding from the very constants the check reads would make the passing
  // direction true by construction: one edit would move the check and its own
  // fixture together and the case would stay green while the image contract
  // changed underneath it.
  //
  // One of the symbols is BUILT IN and the rest are modules, on purpose.
  // modprobe resolves those two ways and a fixture that exercised only one
  // would leave the other path driven by nothing.
  const release = '6.12.101+deb13-amd64'
  file(`/boot/config-${release}`,
    '# Automatically generated file; DO NOT EDIT.\n'
    + 'CONFIG_VLAN_8021Q=m\n'
    + 'CONFIG_BRIDGE=m\n'
    + 'CONFIG_BRIDGE_VLAN_FILTERING=y\n'
    + 'CONFIG_WIREGUARD=y\n'
    + 'CONFIG_VETH=m\n'
    + 'CONFIG_NFT_FIB=m\n'
    + 'CONFIG_NFT_FIB_INET=m\n'
    + 'CONFIG_NFT_FIB_IPV4=m\n'
    + 'CONFIG_NFT_FIB_IPV6=m\n')
  const mod = `/lib/modules/${release}`
  file(`${mod}/modules.builtin`, 'kernel/net/wireguard/wireguard.ko\n')
  file(`${mod}/modules.dep`,
    'kernel/net/8021q/8021q.ko: kernel/net/802/mrp.ko\n'
    + 'kernel/bridge/bridge.ko: kernel/net/802/stp.ko kernel/net/llc/llc.ko\n'
    + 'kernel/drivers/net/veth.ko:\n'
    + 'kernel/net/netfilter/nft_fib.ko:\n'
    + 'kernel/net/ipv4/netfilter/nft_fib_ipv4.ko: kernel/net/netfilter/nft_fib.ko\n'
    + 'kernel/net/ipv6/netfilter/nft_fib_ipv6.ko: kernel/net/netfilter/nft_fib.ko\n'
    + 'kernel/net/netfilter/nft_fib_inet.ko: kernel/net/ipv4/netfilter/nft_fib_ipv4.ko kernel/net/ipv6/netfilter/nft_fib_ipv6.ko kernel/net/netfilter/nft_fib.ko\n')
  for (const object of [
    'kernel/net/8021q/8021q.ko',
    'kernel/net/802/mrp.ko',
    'kernel/bridge/bridge.ko',
    'kernel/net/802/stp.ko',
    'kernel/net/llc/llc.ko',
    'kernel/drivers/net/veth.ko',
    'kernel/net/netfilter/nft_fib.ko',
    'kernel/net/ipv4/netfilter/nft_fib_ipv4.ko',
    'kernel/net/ipv6/netfilter/nft_fib_ipv6.ko',
    'kernel/net/netfilter/nft_fib_inet.ko',
  ]) {
    file(`${mod}/${object}`, '\x7fELF\n')
  }
}

/** A `*.wants` enablement symlink, in the tree /etc owns. */
function enable(root: string, unit: string, target = 'multi-user.target.wants'): void {
  const dir = join(root, '/etc/systemd/system', target)
  mkdirSync(dir, { recursive: true })
  symlinkSync(`/usr/lib/systemd/system/${unit}`, join(dir, unit))
}

/**
 * The trust root's CA certificate, as the fixture spells it.
 *
 * Not a real certificate: `packed-keyring-from-ca` compares BYTES, which is
 * what ties an image's keyring to the one place a trust root may enter a build.
 * Nothing in that comparison parses PEM, so a real certificate here would
 * assert nothing extra and would date.
 */
export const FIXTURE_CA_CERT = '-----BEGIN CERTIFICATE-----\nfixture trust root\n-----END CERTIFICATE-----\n'

/** A context over a synthetic packed root. Everything that reads the IMAGE throws. */
export function packedRootFixture(board: Board): RootFixture {
  const dir = mkdtempSync(join(tmpdir(), 'mos-root-fixture-'))
  const root = join(dir, 'root')
  mkdirSync(root, { recursive: true })
  seedHealthyRoot(root, board)

  // The fixture's own ca/, so the suite never reads the real one: whether THIS
  // host has built an image, and whether its trust root happens to be a
  // generated one, must not decide a verdict. PRODUCTION-shaped by default --
  // material present, no GENERATED marker -- because that is the released state
  // the healthy fixture stands for; a test that wants the development branch
  // writes the marker itself.
  const caDir = join(dir, 'ca')
  mkdirSync(caDir, { recursive: true })
  writeFileSync(join(caDir, 'ca.cert.pem'), FIXTURE_CA_CERT)

  const refuse = (what: string): never => {
    throw new ToolOutputError(`the packed-root fixture has no ${what}; this check reads more than the tree.`)
  }

  const ctx: ImageContext = {
    board,
    image: join(dir, '(no image)'),
    tools: NO_TOOLS,
    workDir: dir,
    outDir: dir,
    caDir,
    gpt: async () => refuse('partition table'),
    partition: async () => refuse('partition table'),
    fatSlot: async () => refuse('FAT slots'),
    extractAt: async () => refuse('image byte ranges'),
    extract: async () => refuse('extracted partition payloads'),
    unpackRoot: async () => root,
  }

  return { ctx, root, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
