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

import {
  chmodSync,
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

  seedShadow(root, file)
  seedMqtt(root, file)
  seedBoardShape(root, board, file)

  // Nothing at /builtin, nothing at /etc/rauc/keyring.pem, nothing under
  // /srv/ui: absence is the shipped state for all three, and seeding any of
  // them would make the fixture red before a test had mutated anything.
}

/** What `seedHealthyRoot` hands its helpers: write a file, making its parents. */
type WriteFile = (path: string, content?: string) => void

// ---------------------------------------------------------------------------
// M4d: the accounts, the credential template, and the reconciler
// ---------------------------------------------------------------------------

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

  // ...and mos-seed-state, which must put NO shadow file on STATE.
  file('/usr/lib/mos/mos-seed-state',
    '#!/bin/sh\nmkdir -p /mnt/state/mos /mnt/state/ssh /mnt/state/hostapd\n')
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

// ---------------------------------------------------------------------------
// M4d: the MQTT bridge and broker, installed and INERT
// ---------------------------------------------------------------------------

function seedMqtt(root: string, file: WriteFile): void {
  file('/usr/bin/mos-mqttd')
  file('/usr/bin/mos-mqtt-broker')

  // A STATIC identity, an EnvironmentFile on a STATE-backed bind, and a broker
  // host that comes from the environment rather than from the read-only root.
  file('/usr/lib/systemd/system/mos-mqttd.service',
    '[Service]\n'
    + 'User=mos-mqttd\n'
    + 'EnvironmentFile=-/var/lib/mos/mqttd.env\n'
    + 'ExecStart=/usr/bin/mos-mqttd --broker ${MOS_MQTT_BROKER_HOST}\n')
  file('/usr/lib/systemd/system/mos-mqtt-broker.service',
    '[Service]\nUser=mos-mqtt-broker\n')

  // The bind that makes /var/lib/mos writable and persistent. The check looks
  // for a unit whose Where= is the EnvironmentFile's directory, so the fixture
  // ships the same unit the image does rather than a stand-in.
  file('/etc/systemd/system/var-lib-mos.mount',
    '[Mount]\nWhat=/mnt/state/mos\nWhere=/var/lib/mos\nType=none\nOptions=bind\n')

  // The grant: the same user the unit runs as, per MEMBER, and none of the
  // four dangerous ones. Attributes wrapped across lines on purpose -- the
  // shipped file wraps them, and a line-oriented reader that did not normalise
  // tags would report a blanket grant that is not there.
  file('/usr/share/dbus-1/system.d/mos-mqttd.conf',
    '<busconfig>\n'
    + '  <!-- <allow send_destination="com.mos.mosd"/> commentary, not a rule -->\n'
    + '  <policy user="mos-mqttd">\n'
    + '    <allow\n'
    + '      send_destination="com.mos.mosd"\n'
    + '      send_member="GetItems"/>\n'
    + '    <allow send_destination="com.mos.mosd" send_member="SetValue"/>\n'
    + '  </policy>\n'
    + '</busconfig>\n')

  // NOT enabled: no *.wants symlink for either. mosd starts them from
  // mqtt.enabled, and an enablement baked into the image is the one thing that
  // switch cannot override.
}

// ---------------------------------------------------------------------------
// M4d: what the BOARD's own declarations say this image carries
// ---------------------------------------------------------------------------

/**
 * The board-conditional payload -- and the half of this fixture that was
 * cx3576-shaped until M4d.
 *
 * Everything below is driven by the board definition's own lists, which is what
 * makes `packedRootFixture(x64)` a genuinely x64-shaped tree rather than a
 * cx3576 one loaded with the wrong GUIDs: x64 declares no firmware, no hwinit
 * fact, no radio and BOARD_HAS_STATUS_LED=0, so it gets none of these files.
 * That is precisely what `status-led-absent` asserts, and its FAILING direction
 * -- a board declaring no indicator that ships the unit anyway -- had never been
 * driven anywhere in this tree before: os/tests/ui-location-test.sh:55 sources
 * cx3576's board.env, which declares 1, so the =0 branch had only ever been
 * observed passing.
 */
function seedBoardShape(root: string, board: Board, file: WriteFile): void {
  const hwinit = board.hwinitConfs ?? []
  const radios = board.radios ?? []
  const firmware = board.firmwareFiles ?? []

  for (const fw of firmware) file(fw)
  if (firmware.length > 0) {
    // The module list is about THIS BOARD'S radio: the driver it must load, the
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
}

/** A `*.wants` enablement symlink, in the tree /etc owns. */
function enable(root: string, unit: string, target = 'multi-user.target.wants'): void {
  const dir = join(root, '/etc/systemd/system', target)
  mkdirSync(dir, { recursive: true })
  symlinkSync(`/usr/lib/systemd/system/${unit}`, join(dir, unit))
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
