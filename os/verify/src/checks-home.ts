// Batch 4a: the two persistent home directories, the `mos` account, and the
// STATE binds that make "/var is discardable" true rather than aspirational.
//
// Fourteen conclusions on each board -- ten from /home and
// /root (:3903-4154), four from the wipe-safety pairs and
// `check_ext_unit_dir` (:3450, :613). One of the four is a SKIP on a board
// with no Bluetooth controller.
//
// ═══ WHY EVERY ONE OF THESE READS THE TIER AND NOT A STRING ═══
//
// `/srv` is nowhere in this file as the DATA path. The oracle reads the DATA
// mountpoint out of the fstab row for DATA_GUID (:3934) precisely so a bind
// pointed at /mnt/state fails ON THE TIER rather than on a spelling -- STATE is
// 64 MiB of small precious identity and a home directory is user data of
// unbounded size, so the two failures have different repairs and only the tier
// distinguishes them. A check comparing against the literal would pass an image
// whose fstab had moved DATA somewhere else.
//
// ═══ AND WHY ENABLEMENT IS ASSERTED SEPARATELY EVERY TIME ═══
//
// A mount unit that is present and not enabled leaves its target inside the
// read-only squashfs for ever, and every check that only looked for the file
// would still pass. M4 shipped units that were installed and never enabled;
// that is the failure this shape exists for, and it is why each of these checks
// has an "exists but is not enabled" branch of its own rather than folding
// presence and enablement into one test.
//
// ═══ THE SEED SCRIPTS ARE READ, NOT RUN ═══
//
// `mos-seed-home` and `mos-seed-root` are asserted by a STATIC read of eleven
// lines of shell. There is no offline harness for either, so idempotence and
// non-clobbering are read rather
// than exercised -- and the port reproduces the read, including its exact
// anchored patterns, rather than substituting a smarter one. A port that
// understood the script better than the oracle does would diverge on the first
// script the oracle misreads, and the divergence would be the port's.

import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import { boardsWhere, hasRadio } from './board-scope.ts'
import { regularFileFollowingLinks } from './checks-dbus.ts'
import { unitValue } from './checks-engine.ts'
import { entry, ETC_UNITS, packedRoot, wantsLink } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { skipped, verdict } from './verdict.ts'

const MOS_USER = 'mos'
const MOS_ID = 1000
const EXT_UNIT_DIR = '/usr/local/lib/systemd/system'
const EXT_MOUNT_UNIT = 'usr-local-lib-systemd-system.mount'
const SEED_WRITE_CMDS = 'mkdir|touch|cp|mv|ln|rm|chmod|chown|install|tee|dd'

// ---------------------------------------------------------------------------
// the readers
// ---------------------------------------------------------------------------

function text(root: string, path: string): string {
  try {
    return readFileSync(join(root, path), 'utf8')
  }
  catch {
    return ''
  }
}

/**
 * `awk -v d="PARTUUID=<guid>" '$1 == d {print $2; exit}' /etc/fstab`.
 *
 * The oracle's awk and not `readFstab`'s parse: awk splits on whitespace with
 * no notion of a comment and takes the FIRST matching row whatever its field
 * count. Reproduced rather than improved on -- a stricter reader would answer
 * differently about a malformed fstab, which is exactly the image where the two
 * verifiers must still agree.
 */
export function dataMountpoint(root: string, board: Board): string {
  const guid = board.partition('DATA')?.guid
  if (guid === undefined || guid.trim() === '') {
    throw new ToolOutputError(
      `${board.path} declares no DATA_GUID, so there is no PARTUUID to look for in /etc/fstab. A `
      + `fail here would be a statement about the board definition rather than about the image.`,
    )
  }
  const device = `PARTUUID=${guid.toLowerCase()}`
  for (const line of text(root, '/etc/fstab').split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields[0] === device) return fields[1] ?? ''
  }
  return ''
}

/** `${value#${prefix}/}` differing from `${value}` -- i.e. strictly underneath. */
function isUnder(value: string, prefix: string): boolean {
  return prefix !== '' && value.startsWith(`${prefix}/`)
}

/** `sed -n 's/^Before=//p' | tr ' ' '\n' | grep -Fx unit` -- EVERY Before= line. */
function ordersBefore(root: string, unitPath: string, unit: string): boolean {
  return text(root, unitPath).split('\n')
    .filter(l => l.startsWith('Before='))
    .flatMap(l => l.slice('Before='.length).split(' '))
    .includes(unit)
}

/** `stat -c %a`, or the oracle's literal `none`. Follows links, as stat does. */
function modeOf(root: string, path: string): string {
  try {
    return (statSync(join(root, path)).mode & 0o7777).toString(8)
  }
  catch {
    return 'none'
  }
}

/** `stat -c '%u:%g'`, or `none`. */
function ownerOf(root: string, path: string): string {
  try {
    const st = statSync(join(root, path))
    return `${st.uid}:${st.gid}`
  }
  catch {
    return 'none'
  }
}

/** `[ -x ]` for the OWNER bit, which is what ExecStart= needs from a root unit. */
function isExecutable(root: string, path: string): boolean {
  try {
    return (statSync(join(root, path)).mode & 0o111) !== 0
  }
  catch {
    return false
  }
}

/** `grep -Eq PATTERN` over the file, line-wise. */
function matches(root: string, path: string, pattern: RegExp): boolean {
  return text(root, path).split('\n').some(l => pattern.test(l))
}

interface Account {
  readonly raw: string
  readonly uid: string
  readonly gid: string
  readonly home: string
  readonly shell: string
}

/** `awk -F: '$1 == u { print; exit }' /etc/passwd`, then `cut -d:` on the row. */
function accountOf(root: string, user: string): Account | undefined {
  for (const line of text(root, '/etc/passwd').split('\n')) {
    const f = line.split(':')
    if (f[0] !== user) continue
    return {
      raw: line,
      uid: f[2] ?? '',
      gid: f[3] ?? '',
      home: f[5] ?? '',
      shell: f[6] ?? '',
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// the two binds, which have exactly the same shape
// ---------------------------------------------------------------------------

interface BindCase {
  readonly id: string
  readonly unit: string
  readonly where: string
  /** The consequence clause the oracle spells out for THIS directory. */
  readonly what: string
  readonly tierRationale: string
  /**
   * The oracle's own wording of the not-enabled consequence.
   *
   * `/home` says "every file written there would live" and `/root` says
   * "everything written there would live" -- one word apart, in two blocks that
   * are otherwise the same logic. Carried as data rather than reconstructed,
   * because a paraphrase here reads as a divergence on the one board where the
   * branch fires.
   */
  readonly unenabledClause: string
}

/**
 * `home.mount` and `root.mount`: one shape, two directories, five ways to fail.
 *
 * The two are generated from one description because the oracle's two blocks are
 * character-for-character the same logic with different nouns -- and a second
 * transcription of five branches beside the first is where the two come to
 * disagree about, say, whether an empty `What=` is "not under DATA" or "no
 * What=".
 *
 * THE `no /etc/fstab entry mounts DATA` SENTENCES ARE NOT INTERCHANGEABLE, and
 * that matters to the register rather than to the reader: both blocks print that
 * sentence and they differ only in the trailing `so home.mount's` / `so
 * root.mount's`. A fail matcher taken from the front of it would claim both
 * lines on an image with no DATA row, and the run would report `ambiguous`
 * instead of two failures.
 */
function bindCheck(c: BindCase): CheckCase {
  const unitPath = `/etc/systemd/system/${c.unit}`
  return {
    id: c.id,
    shell: {
      pass: `${c.unit} binds ${c.where} from `,
      fail: [
        `${c.unit} is not in the image,`,
        `${c.unit} mounts '`,
        `so ${c.unit}'s backing tier cannot be established`,
        `${c.unit} binds ${c.where} from '`,
        `${c.unit} exists but is not enabled`,
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const dataMount = dataMountpoint(root, ctx.board)
      const what = unitValue(root, unitPath, 'What=')
      const where = unitValue(root, unitPath, 'Where=')
      const guid = (ctx.board.partition('DATA')?.guid ?? '').toLowerCase()
      if (!regularFileFollowingLinks(root, unitPath)) {
        return [verdict(c.id, false,
          `${c.unit} is not in the image, so ${c.where} stays inside the read-only verity squashfs `
          + `and ${c.what}`)]
      }
      if (where !== c.where) {
        return [verdict(c.id, false,
          `${c.unit} mounts '${where === '' ? '<no Where=>' : where}', not ${c.where}`)]
      }
      if (dataMount === '') {
        return [verdict(c.id, false,
          `no /etc/fstab entry mounts DATA (PARTUUID=${guid}), so ${c.unit}'s backing tier cannot `
          + `be established`)]
      }
      if (what === '' || !isUnder(what, dataMount)) {
        return [verdict(c.id, false,
          `${c.unit} binds ${c.where} from '${what === '' ? '<no What=>' : what}', which is not under `
          + `${dataMount} (the DATA partition). ${c.tierRationale}`)]
      }
      if (wantsLink(root, ETC_UNITS, c.unit) === undefined) {
        return [verdict(c.id, false,
          `${c.unit} exists but is not enabled (no symlink in a .wants directory); ${c.where} would `
          + `never be bound and ${c.unenabledClause}`)]
      }
      return [verdict(c.id, true,
        `${c.unit} binds ${c.where} from ${what} on DATA (fstab mounts DATA at ${dataMount}) and is enabled`)]
    },
  }
}

const HOME_TIER_RATIONALE = 'A home directory is user data of unbounded size — an update bundle '
  + 'alone is ~72 MiB — and STATE is 64 MiB of precious identity: filling it would take the settings '
  + 'tree and the sshd host keys with it. DATA is also the only partition repart grows'
const ROOT_TIER_RATIONALE = 'A root home is user data of unbounded size — shell history, scratch '
  + 'scripts, a staged update bundle at ~72 MiB — and STATE is 64 MiB of precious identity: filling '
  + 'it would take the settings tree and the sshd host keys with it. DATA is also the only partition '
  + 'repart grows'

// ---------------------------------------------------------------------------
// the seed units, which also have one shape
// ---------------------------------------------------------------------------

/**
 * `mos-seed-home.service` -- present, ordering the mount, and ENABLED.
 *
 * The Before= is the half systemd needs to sequence the mount job, and a seed
 * ordered AFTER the bind could not have made that bind succeed in the first
 * place, so it would never run at all. tmpfiles.d cannot substitute either:
 * systemd-tmpfiles-setup is After=local-fs.target while the mount is
 * WantedBy=local-fs.target.
 */
const SEED_HOME_CHECK: CheckCase = {
  id: 'mos-seed-home-service',
  shell: {
    pass: 'mos-seed-home.service is enabled and ordered Before=home.mount',
    fail: [
      'mos-seed-home.service is not in the image;',
      'mos-seed-home.service has no Before= naming home.mount',
      'mos-seed-home.service exists but is not enabled',
    ],
  },
  run: async (ctx): Promise<readonly CheckResult[]> => {
    const root = await packedRoot(ctx)
    const unitPath = '/etc/systemd/system/mos-seed-home.service'
    const what = unitValue(root, '/etc/systemd/system/home.mount', 'What=')
    if (!regularFileFollowingLinks(root, unitPath)) {
      return [verdict('mos-seed-home-service', false,
        `mos-seed-home.service is not in the image; nothing creates `
        + `${what === '' ? 'the home.mount source' : what} on DATA and the bind fails, because `
        + `mount(8) never creates the SOURCE of a bind`)]
    }
    if (!ordersBefore(root, unitPath, 'home.mount')) {
      return [verdict('mos-seed-home-service', false,
        `mos-seed-home.service has no Before= naming home.mount; the bind source would not be `
        + `guaranteed to exist when the mount is attempted, and the mount fails`)]
    }
    if (wantsLink(root, ETC_UNITS, 'mos-seed-home.service') === undefined) {
      return [verdict('mos-seed-home-service', false,
        `mos-seed-home.service exists but is not enabled, so the home.mount source is never created `
        + `and the bind fails on every boot`)]
    }
    return [verdict('mos-seed-home-service', true,
      `mos-seed-home.service is enabled and ordered Before=home.mount, so the bind source exists on `
      + `DATA before the mount is attempted`)]
  },
}

/**
 * `mos-seed-root.service` -- and, unlike its /home twin, the SCRIPT'S MODE.
 *
 * A non-executable ExecStart= fails with 203/EXEC, the bind source is never
 * created and root.mount fails on every boot -- and nothing else in the image
 * asserts the bit, because /usr/lib/mos/mos-seed-root is not in the
 * regular-file list the way mos-seed-home is.
 */
const SEED_ROOT_CHECK: CheckCase = {
  id: 'mos-seed-root-service',
  shell: {
    pass: 'mos-seed-root.service is enabled and ordered Before=root.mount, and ',
    fail: [
      'mos-seed-root.service is not in the image;',
      'mos-seed-root.service has no Before= naming root.mount',
      'mos-seed-root.service exists but is not enabled',
      '/usr/lib/mos/mos-seed-root is missing or not a regular file',
      ', not executable; ExecStart= would fail with 203/EXEC',
    ],
  },
  run: async (ctx): Promise<readonly CheckResult[]> => {
    const root = await packedRoot(ctx)
    const unitPath = '/etc/systemd/system/mos-seed-root.service'
    const script = '/usr/lib/mos/mos-seed-root'
    const what = unitValue(root, '/etc/systemd/system/root.mount', 'What=')
    const mode = modeOf(root, script)
    if (!regularFileFollowingLinks(root, unitPath)) {
      return [verdict('mos-seed-root-service', false,
        `mos-seed-root.service is not in the image; nothing creates `
        + `${what === '' ? 'the root.mount source' : what} on DATA and the bind fails, because `
        + `mount(8) never creates the SOURCE of a bind`)]
    }
    if (!ordersBefore(root, unitPath, 'root.mount')) {
      return [verdict('mos-seed-root-service', false,
        `mos-seed-root.service has no Before= naming root.mount; the bind source would not be `
        + `guaranteed to exist when the mount is attempted, and the mount fails`)]
    }
    if (wantsLink(root, ETC_UNITS, 'mos-seed-root.service') === undefined) {
      return [verdict('mos-seed-root-service', false,
        `mos-seed-root.service exists but is not enabled, so the root.mount source is never created `
        + `and the bind fails on every boot`)]
    }
    // `[ ! -f ] || [ -L ]`: a symlink to a regular file passes `-f` and is
    // refused here anyway. A seed reachable only through a link is a seed whose
    // target the next pack stage can move without anything noticing.
    const st = entry(root, script)
    if (st === undefined || !st.isFile()) {
      return [verdict('mos-seed-root-service', false,
        `/usr/lib/mos/mos-seed-root is missing or not a regular file, so mos-seed-root.service `
        + `cannot start and the bind source is never created`)]
    }
    if (!isExecutable(root, script)) {
      return [verdict('mos-seed-root-service', false,
        `/usr/lib/mos/mos-seed-root is mode ${mode}, not executable; ExecStart= would fail with `
        + `203/EXEC, the bind source would never be created and root.mount would fail on every boot`)]
    }
    return [verdict('mos-seed-root-service', true,
      `mos-seed-root.service is enabled and ordered Before=root.mount, and /usr/lib/mos/mos-seed-root `
      + `is executable (mode 0${mode}), so the bind source exists on DATA before the mount is attempted`)]
  },
}

// ---------------------------------------------------------------------------
// what the seed scripts write, read statically
// ---------------------------------------------------------------------------

const SEED_HOME_SCRIPT_CHECK: CheckCase = {
  id: 'mos-seed-home-writes-data',
  shell: {
    pass: 'mos-seed-home creates /srv/home/mos on DATA, mode 0700, owned by the pinned pair ',
    fail: [
      '/usr/lib/mos/mos-seed-home is not in the image,',
      'mos-seed-home pins uid ',
      'mos-seed-home does not create /srv/home/mos.',
      'mos-seed-home does not chmod 0700 /srv/home/mos',
      'mos-seed-home does not chown /srv/home/mos to its pinned MOS_UID:MOS_GID pair',
    ],
  },
  run: async (ctx): Promise<readonly CheckResult[]> => {
    const root = await packedRoot(ctx)
    const script = '/usr/lib/mos/mos-seed-home'
    const id = 'mos-seed-home-writes-data'
    const uid = unitValue(root, script, 'MOS_UID=')
    const gid = unitValue(root, script, 'MOS_GID=')
    if (!regularFileFollowingLinks(root, script)) {
      return [verdict(id, false,
        `/usr/lib/mos/mos-seed-home is not in the image, so what it creates cannot be checked`)]
    }
    if (uid !== String(MOS_ID) || gid !== String(MOS_ID)) {
      return [verdict(id, false,
        `mos-seed-home pins uid '${uid === '' ? '<none>' : uid}' gid '${gid === '' ? '<none>' : gid}', `
        + `not ${MOS_ID}:${MOS_ID}. The seed and /etc/passwd must agree by NUMBER: the home on DATA `
        + `outlives this rootfs, so a mismatch leaves the directory owned by an id the image does not define`)]
    }
    if (!matches(root, script, /^[ \t]*mkdir \/srv\/home\/mos$/)) {
      return [verdict(id, false,
        `mos-seed-home does not create /srv/home/mos. It must create the home under the DATA path, `
        + `never under /home: /home in the unbound view is inside the read-only verity squashfs, and `
        + `a seed writing there fails`)]
    }
    if (!matches(root, script, /^[ \t]*chmod 0700 \/srv\/home\/mos$/)) {
      return [verdict(id, false,
        `mos-seed-home does not chmod 0700 /srv/home/mos; a home directory readable by every local `
        + `uid is not a private home`)]
    }
    if (!matches(root, script, /^[ \t]*chown "\$\{MOS_UID\}:\$\{MOS_GID\}" \/srv\/home\/mos$/)) {
      return [verdict(id, false,
        `mos-seed-home does not chown /srv/home/mos to its pinned MOS_UID:MOS_GID pair; resolving the `
        + `name at runtime would make the owner whatever the running image says today`)]
    }
    return [verdict(id, true,
      `mos-seed-home creates /srv/home/mos on DATA, mode 0700, owned by the pinned pair ${uid}:${gid} `
      + `— the same numbers /etc/passwd gives ${MOS_USER}`)]
  },
}

const SEED_ROOT_SCRIPT_CHECK: CheckCase = {
  id: 'mos-seed-root-writes-data',
  shell: {
    pass: 'mos-seed-root creates /srv/root on DATA (never under /root',
    fail: [
      '/usr/lib/mos/mos-seed-root is not in the image,',
      'mos-seed-root does not create /srv/root.',
      'mos-seed-root does not chmod 0700 /srv/root',
      'mos-seed-root does not chown 0:0 /srv/root numerically',
      'mos-seed-root writes under /root:',
    ],
  },
  run: async (ctx): Promise<readonly CheckResult[]> => {
    const root = await packedRoot(ctx)
    const script = '/usr/lib/mos/mos-seed-root'
    const id = 'mos-seed-root-writes-data'
    if (!regularFileFollowingLinks(root, script)) {
      return [verdict(id, false,
        `/usr/lib/mos/mos-seed-root is not in the image, so what it creates cannot be checked`)]
    }
    if (!matches(root, script, /^[ \t]*mkdir \/srv\/root$/)) {
      return [verdict(id, false,
        `mos-seed-root does not create /srv/root. It must create the bind source under the DATA path, `
        + `never under /root: /root in the unbound view is inside the read-only verity squashfs, and a `
        + `seed writing there before the bind fails`)]
    }
    if (!matches(root, script, /^[ \t]*chmod 0700 \/srv\/root$/)) {
      return [verdict(id, false,
        `mos-seed-root does not chmod 0700 /srv/root; DATA is not verity-protected, so a root home `
        + `group- or world-readable on disk is not caught by anything else`)]
    }
    if (!matches(root, script, /^[ \t]*chown 0:0 \/srv\/root$/)) {
      return [verdict(id, false,
        `mos-seed-root does not chown 0:0 /srv/root numerically; the directory outlives every rootfs `
        + `flashed onto this device, so its owner is part of the on-disk contract and must not be `
        + `resolved out of the running image's /etc/passwd`)]
    }
    // `grep -nE ... | first_line`: the FIRST offending line, printed as
    // `<lineno>:<line>` the way grep -n prints it.
    const offending = writesUnderRoot(text(root, script))
    if (offending !== undefined) {
      const dataMount = dataMountpoint(root, ctx.board)
      return [verdict(id, false,
        `mos-seed-root writes under /root: ${offending}. It runs BEFORE root.mount, so /root there is `
        + `still the read-only verity squashfs and the write fails; everything it creates belongs `
        + `under ${dataMount === '' ? '/srv' : dataMount}`)]
    }
    return [verdict(id, true,
      `mos-seed-root creates /srv/root on DATA (never under /root, which is read-only before the `
      + `bind), mode 0700 owned 0:0 — a static read of the script, not a run of it`)]
  },
}

/**
 * The oracle's write-under-/root pattern, transcribed with its line number.
 *
 * `^[[:space:]]*(CMDS)[[:space:]]+([^#]*[[:space:]]+)?"?/root(/|"|[[:space:]]|$)`
 * -- a write command at the start of a line, optionally with arguments before
 * the path, naming /root itself or something inside it. It is deliberately a
 * pattern and not an understanding of the script: the oracle reads eleven lines
 * of shell and so does this.
 */
export function writesUnderRoot(script: string): string | undefined {
  const re = new RegExp(`^[ \\t]*(${SEED_WRITE_CMDS})[ \\t]+([^#]*[ \\t]+)?"?/root(/|"|[ \\t]|$)`)
  for (const [index, line] of script.split('\n').entries()) {
    if (re.test(line)) return `${index + 1}:${line}`
  }
  return undefined
}

// ---------------------------------------------------------------------------
// the account, asserted by NUMBER
// ---------------------------------------------------------------------------

const ACCOUNT_CHECKS: readonly CheckCase[] = [
  {
    // `mos` resolving to some other uid is the failure that costs a device its
    // whole home directory, and it is invisible: the account is there, the
    // shell is right, and every file already on DATA belongs to nobody.
    id: 'mos-account-by-number',
    shell: {
      pass: `'${MOS_USER}' is uid ${MOS_ID}, gid ${MOS_ID} (group `,
      fail: [
        `no '${MOS_USER}' account in the packed /etc/passwd`,
        `' is uid `,
        `' group is gid '`,
        `' has shell '`,
        `' has home '`,
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'mos-account-by-number'
      const account = accountOf(root, MOS_USER)
      if (account === undefined) {
        return [verdict(id, false,
          `no '${MOS_USER}' account in the packed /etc/passwd; the persistent home would have no owner`)]
      }
      const groupGid = groupGidOf(root, MOS_USER)
      const bashPresent = regularFileFollowingLinks(root, '/bin/bash')
      if (account.uid !== String(MOS_ID) || account.gid !== String(MOS_ID)) {
        return [verdict(id, false,
          `'${MOS_USER}' is uid ${account.uid}, gid ${account.gid} in the packed /etc/passwd, expected `
          + `${MOS_ID}:${MOS_ID}. The home directory sits on DATA and outlives this rootfs, so its owner `
          + `is part of the ON-DISK CONTRACT: an image that resolves ${MOS_USER} to a different id `
          + `leaves every file already in ${account.home === '' ? 'the home' : account.home} owned by a `
          + `uid that no longer exists, and nothing reports an error`)]
      }
      if (groupGid !== String(MOS_ID)) {
        return [verdict(id, false,
          `the '${MOS_USER}' group is gid '${groupGid === '' ? 'absent' : groupGid}' in the packed `
          + `/etc/group, expected ${MOS_ID}; the primary group of the home's owner is part of the same `
          + `on-disk contract as the uid`)]
      }
      if (account.shell !== '/bin/bash' || !bashPresent) {
        return [verdict(id, false,
          `'${MOS_USER}' has shell '${account.shell}' and /bin/bash is ${bashPresent ? 'present' : 'ABSENT'} `
          + `in the packed root; the login shell must be /bin/bash and that binary must actually ship, `
          + `or every login dies at exec`)]
      }
      if (account.home !== `/home/${MOS_USER}`) {
        return [verdict(id, false,
          `'${MOS_USER}' has home '${account.home}', expected /home/${MOS_USER}`)]
      }
      return [verdict(id, true,
        `'${MOS_USER}' is uid ${MOS_ID}, gid ${MOS_ID} (group ${MOS_USER} = gid ${groupGid}), shell `
        + `${account.shell} (present in the image), home ${account.home}`)]
    },
  },

  {
    // NO SUDO AND NO SUPPLEMENTARY GROUPS is a deliberate phase-1 deferral, not
    // an oversight -- and a deferral nothing asserts is one `usermod -aG` away
    // from being undone silently. sudo not being installed is checked too: a
    // group grant needs a binary to mean anything, and vice versa.
    id: 'mos-account-no-privilege-path',
    shell: {
      pass: `' has no supplementary groups and no sudo ships in the image`,
      fail: [
        `' is a member of supplementary group(s):`,
        'sudo ships in the image;',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'mos-account-no-privilege-path'
      const extra = supplementaryGroups(root, MOS_USER)
      if (extra.length > 0) {
        return [verdict(id, false,
          `'${MOS_USER}' is a member of supplementary group(s): ${extra.join(' ')}. Phase 1 grants `
          + `none — not adm, not shadow, nothing reaching the settings tree — and this is a recorded `
          + `deferral (docs/task/RFCT-039.md), so a grant appearing here is an undocumented privilege `
          + `decision`)]
      }
      if (regularFileFollowingLinks(root, '/usr/bin/sudo') || regularFileFollowingLinks(root, '/bin/sudo')) {
        return [verdict(id, false,
          `sudo ships in the image; phase 1 deliberately gives '${MOS_USER}' no privilege-escalation `
          + `path and the package is not in the allowlist`)]
      }
      return [verdict(id, true,
        `'${MOS_USER}' has no supplementary groups and no sudo ships in the image (a deliberate `
        + `phase-1 deferral, recorded in docs/task/RFCT-039.md)`)]
    },
  },

  {
    // An account pointed at a directory the bind does not cover would look
    // completely healthy and would lose everything on the next update -- which
    // is the entire problem the /home bind exists to solve.
    id: 'mos-home-inside-the-bind',
    shell: {
      pass: `' home /home/${MOS_USER} is inside `,
      fail: [
        `cannot compare '${MOS_USER}' home '`,
        `' home is '`,
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'mos-home-inside-the-bind'
      const home = accountOf(root, MOS_USER)?.home ?? ''
      const where = unitValue(root, '/etc/systemd/system/home.mount', 'Where=')
      const what = unitValue(root, '/etc/systemd/system/home.mount', 'What=')
      if (home === '' || where === '') {
        return [verdict(id, false,
          `cannot compare '${MOS_USER}' home '${home === '' ? '<none>' : home}' against home.mount `
          + `Where='${where === '' ? '<none>' : where}'; one of them is missing`)]
      }
      if (home === where || isUnder(home, where)) {
        return [verdict(id, true,
          `'${MOS_USER}' home ${home} is inside ${where}, the directory home.mount binds from ${what} `
          + `on DATA, so it persists across reboots and A/B updates`)]
      }
      return [verdict(id, false,
        `'${MOS_USER}' home is '${home}', which is NOT inside '${where}' — the only path home.mount `
        + `makes persistent. Everything written there would sit in the read-only squashfs view and be `
        + `gone on the next A/B update`)]
    },
  },

  {
    // The MOUNTPOINT's own mode. /root's existence is asserted with the rest of
    // the mountpoint set; this asserts what that cannot -- that it is 0700
    // root:root. Debian ships it that way and nothing guaranteed it stayed that
    // way through the pack stage, and DATA is not verity-protected, so the mode
    // is not implied by anything.
    id: 'root-mountpoint-mode',
    shell: {
      pass: '/root in the packed root is mode 0700 owned 0:0 (root:root)',
      fail: '/root in the packed root is mode ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const mode = modeOf(root, '/root')
      const owner = ownerOf(root, '/root')
      const ok = mode === '700' && owner === '0:0'
      return [verdict(
        'root-mountpoint-mode',
        ok,
        ok
          ? `/root in the packed root is mode 0${mode} owned ${owner} (root:root), the mode a root `
            + `home must have`
          : `/root in the packed root is mode ${mode} owned ${owner}, expected 700 and 0:0. A root `
            + `home readable by any other uid is a different defect from the one root.mount fixes, `
            + `and nothing else in the image asserts it`,
      )]
    },
  },
]

/** `awk -F: '$1 == g { print $3; exit }' /etc/group`. */
function groupGidOf(root: string, group: string): string {
  for (const line of text(root, '/etc/group').split('\n')) {
    const f = line.split(':')
    if (f[0] === group) return f[2] ?? ''
  }
  return ''
}

/**
 * `awk -F: '$1 != u && $4 ~ "(^|,)" u "(,|$)" { print $1 }' /etc/group`.
 *
 * The member LIST, field 4 -- not the primary group, which is field 3 of the
 * passwd row and is asserted by number above. A membership matched loosely
 * would report `mosquitto` as a group `mos` belongs to.
 */
function supplementaryGroups(root: string, user: string): string[] {
  const found: string[] = []
  for (const line of text(root, '/etc/group').split('\n')) {
    const f = line.split(':')
    if (f[0] === user || f[0] === undefined) continue
    const members = (f[3] ?? '').split(',')
    if (members.includes(user)) found.push(f[0])
  }
  return found
}

// ---------------------------------------------------------------------------
// the STATE binds: nothing precious is reachable only from /var
// ---------------------------------------------------------------------------

const hasBluetooth = (board: Board): boolean => hasRadio(board, 'bluetooth')

/**
 * `/var/lib/mos` and `/var/lib/bluetooth`, one check per pair.
 *
 * The pairing is APPENDED in the oracle rather than listed, so a board without
 * the radio asserts the identity bind and nothing it does not have -- and the
 * one it does not have prints a SKIP. That skip has a register entry of its own,
 * scoped to the complement of the same derived predicate the pair check is
 * scoped by, so the two cannot drift apart or overlap.
 */
function preciousBind(input: { id: string, unit: string, where: string, boards?: readonly string[] }): CheckCase {
  const { id, unit, where } = input
  const unitPath = `/etc/systemd/system/${unit}`
  return {
    id,
    ...(input.boards === undefined ? {} : { boards: input.boards }),
    shell: {
      pass: `${where} is a STATE-backed bind via ${unit} (survives a /var wipe)`,
      fail: [
        `${where} holds precious state but ${unit} does not exist`,
        `${unit} does not mount ${where}`,
        `${unit} is not backed by STATE (What= must be under /mnt/state)`,
        `${unit} exists but is not enabled; ${where} would stay on the discardable /var`,
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      if (!regularFileFollowingLinks(root, unitPath)) {
        return [verdict(id, false,
          `${where} holds precious state but ${unit} does not exist; it would stay on the discardable /var`)]
      }
      // `grep -qx "Where=${where}"`: the WHOLE line, not a prefix. `Where=/var/lib/mos2`
      // does not satisfy it and neither does trailing whitespace.
      if (!text(root, unitPath).split('\n').includes(`Where=${where}`)) {
        return [verdict(id, false, `${unit} does not mount ${where}`)]
      }
      if (!matches(root, unitPath, /^What=\/mnt\/state\//)) {
        return [verdict(id, false, `${unit} is not backed by STATE (What= must be under /mnt/state)`)]
      }
      if (wantsLink(root, ETC_UNITS, unit) === undefined) {
        return [verdict(id, false,
          `${unit} exists but is not enabled; ${where} would stay on the discardable /var`)]
      }
      return [verdict(id, true, `${where} is a STATE-backed bind via ${unit} (survives a /var wipe)`)]
    },
  }
}

const EXT_UNIT_DIR_CHECKS: readonly CheckCase[] = [
  {
    // Every unit directory the image ships is inside the dm-verity squashfs, so
    // "an integrator can install a systemd unit and it is still there after a
    // reboot and after an A/B update" exists only if this bind exists, is
    // enabled, and is backed by STATE.
    id: 'ext-unit-dir-state-bind',
    shell: {
      pass: `${EXT_UNIT_DIR} is a STATE-backed bind via ${EXT_MOUNT_UNIT} (What=`,
      fail: [
        `${EXT_MOUNT_UNIT} is not in the image,`,
        `${EXT_MOUNT_UNIT} mounts '`,
        `${EXT_MOUNT_UNIT} binds ${EXT_UNIT_DIR} from '`,
        `${EXT_MOUNT_UNIT} exists but is not enabled`,
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'ext-unit-dir-state-bind'
      const unitPath = `/etc/systemd/system/${EXT_MOUNT_UNIT}`
      const where = unitValue(root, unitPath, 'Where=')
      const what = unitValue(root, unitPath, 'What=')
      if (!regularFileFollowingLinks(root, unitPath)) {
        return [verdict(id, false,
          `${EXT_MOUNT_UNIT} is not in the image, so ${EXT_UNIT_DIR} stays on the read-only squashfs; `
          + `a third-party unit written there is silently discarded at the next reboot and PLAN-011 `
          + `D5's whole extension model does not work on the device`)]
      }
      if (where !== EXT_UNIT_DIR) {
        return [verdict(id, false,
          `${EXT_MOUNT_UNIT} mounts '${where === '' ? '<no Where=>' : where}', not ${EXT_UNIT_DIR}; `
          + `${EXT_UNIT_DIR} is the directory in systemd's unit load path that the pack stage creates, `
          + `so a bind anywhere else leaves it read-only and puts a writable directory somewhere `
          + `systemd does not read`)]
      }
      if (!what.startsWith('/mnt/state/')) {
        return [verdict(id, false,
          `${EXT_MOUNT_UNIT} binds ${where} from '${what === '' ? '<no What=>' : what}', which is not `
          + `under /mnt/state; installed units would not be on the STATE partition and would be lost `
          + `by the next A/B update or factory reset`)]
      }
      if (wantsLink(root, ETC_UNITS, EXT_MOUNT_UNIT) === undefined) {
        return [verdict(id, false,
          `${EXT_MOUNT_UNIT} exists but is not enabled (no *.wants symlink under /etc/systemd/system); `
          + `the bind never runs, so installing a unit appears to work and stops working at the next boot`)]
      }
      return [verdict(id, true,
        `${EXT_UNIT_DIR} is a STATE-backed bind via ${EXT_MOUNT_UNIT} (What=${what}), enabled, so a `
        + `third-party unit installed there survives a reboot and an A/B update`)]
    },
  },

  {
    // The negative half, and NOT symmetry for its own sake. /etc/systemd/system
    // is a plausible-looking target for this bind and a wrong one. Anyone
    // reaching for it would
    // repair the "deviation" by pointing the bind back, and that diff reads
    // like restoring the plan while reintroducing the hazard: the image ships
    // this boot chain's own mount units AND their local-fs.target.wants
    // symlinks in that directory, so the bind would be performed by a unit
    // living in the directory it hides and would take the enablement of every
    // other STATE mount down with it.
    id: 'no-bind-over-etc-systemd-system',
    shell: {
      pass: 'no unit in the image mounts anything over /etc/systemd/system;',
      fail: 'a unit in the image mounts over /etc/systemd/system (',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'no-bind-over-etc-systemd-system'
      const binds = grepRecursive(
        root,
        ['/etc/systemd/system', '/usr/lib/systemd/system', EXT_UNIT_DIR],
        /^Where=\/etc\/systemd\/system(\/|$)/,
      )
      return [verdict(
        id,
        binds.length === 0,
        binds.length === 0
          ? `no unit in the image mounts anything over /etc/systemd/system; the boot chain's own units `
            + `and their local-fs.target.wants enablement stay inside the verity root`
          : `a unit in the image mounts over /etc/systemd/system (${binds.join(' ')}). That directory `
            + `holds this boot chain's own mount units AND the local-fs.target.wants symlinks enabling `
            + `them, so the bind is performed by a unit living in the directory it hides and shadows the `
            + `enablement of every other STATE mount. PLAN-011 D5 named this target originally and it `
            + `was rejected on 2026-08-22; the writable unit directory is ${EXT_UNIT_DIR}, and `
            + `re-pointing it here looks like restoring the plan while reintroducing the defect`,
      )]
    },
  },
]

/**
 * `grep -rlE PATTERN` over several trees, root-relative and sorted.
 *
 * `-r` follows a symlink named on the command line and NOT one found during the
 * walk, so this lstats and never descends through a link -- and a `.wants` entry
 * pointing at a unit in another tree is therefore read once, at the unit's own
 * path, rather than twice.
 */
function grepRecursive(root: string, trees: readonly string[], pattern: RegExp): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    let names: string[]
    try {
      names = readdirSync(dir)
    }
    catch {
      return
    }
    for (const name of names) {
      const full = join(dir, name)
      let st
      try {
        st = lstatSync(full)
      }
      catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (!st.isFile()) continue
      let content: string
      try {
        content = readFileSync(full, 'utf8')
      }
      catch {
        continue
      }
      if (content.split('\n').some(l => pattern.test(l))) found.push(full.slice(root.length))
    }
  }
  for (const tree of trees) walk(join(root, tree))
  return found.sort()
}

export const HOME_CHECKS: readonly CheckCase[] = [
  bindCheck({
    id: 'home-mount-on-data',
    unit: 'home.mount',
    where: '/home',
    what: 'nothing an operator puts there survives a reboot',
    tierRationale: HOME_TIER_RATIONALE,
    unenabledClause: 'every file written there would live in the read-only squashfs view',
  }),
  SEED_HOME_CHECK,
  SEED_HOME_SCRIPT_CHECK,
  ...ACCOUNT_CHECKS,
  bindCheck({
    id: 'root-mount-on-data',
    unit: 'root.mount',
    where: '/root',
    what: 'nothing an operator leaves there — shell history, a scratch script, a staged bundle — '
      + 'survives a reboot',
    tierRationale: ROOT_TIER_RATIONALE,
    unenabledClause: 'everything written there would live in the read-only squashfs view',
  }),
  SEED_ROOT_CHECK,
  SEED_ROOT_SCRIPT_CHECK,
  preciousBind({ id: 'precious-bind-var-lib-mos', unit: 'var-lib-mos.mount', where: '/var/lib/mos' }),
  preciousBind({
    id: 'precious-bind-var-lib-bluetooth',
    unit: 'var-lib-bluetooth.mount',
    where: '/var/lib/bluetooth',
    boards: boardsWhere(hasBluetooth),
  }),
  {
    // The group SKIP, owned by an entry of its own because the oracle prints
    // ONE skip line on the board with no controller and TWO pass lines on the
    // board with one. Scoped to the complement of `hasBluetooth`, computed from
    // the shipped definitions -- so the two scopes cannot overlap or drift.
    id: 'precious-bind-bluetooth-skipped',
    boards: boardsWhere(b => !hasBluetooth(b)),
    shell: { skip: 'the STATE bind for /var/lib/bluetooth (' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped(
      'precious-bind-bluetooth-skipped',
      `the STATE bind for /var/lib/bluetooth (${ctx.board.name} declares no bluetooth in `
      + `BOARD_RADIOS): with no controller there are no pairings to keep across an A/B update`,
    )],
  },
  ...EXT_UNIT_DIR_CHECKS,
]
