// The MQTT bridge and broker: in the image, startable, and INERT.
//
// Board-unconditional -- 16 conclusions on each shipped board, measured
// 2026-08-26 -- so not batch 3 as scoped; and `mqttd: <path> is a regular file`
// looks like `sq_regular` but is check_mqttd's own prose with a `mqttd: `
// prefix, so not batch 2a either.
//
// Each half of the family is a defect the wiring actually had: the crate, the
// unit and the protocol tests were all green while the bridge was absent from
// the image entirely, and when it was added the unit's `DynamicUser=yes` could
// not be named by any `<policy user=>` and its ExecStart hardcoded a broker host
// into a read-only squashfs. None of that is visible from the code side.
// Inertness is the load-bearing half: `mqtt.enabled` is a master switch that
// seeds false for every profile and mosd starts both units from it, so an
// enablement symlink baked into the image is the one thing that switch cannot
// override, and the root is a read-only verity squashfs so nothing on the device
// can remove it.
//
// The policy is tag-normalised before it is read. The shipped rules wrap their
// attributes across three lines, so a line-oriented search for `send_member=` on
// a rule whose `send_destination=` is on the line above finds nothing and reports
// a blanket grant that is not there; the oracle hit that on its first run against
// the real file (:838-846) and answers it by stripping comments and then putting
// one XML tag per line. This does the same, in that order, because the comment
// strip has to come first: a commented-out
// `<allow send_destination="com.mos.mosd"/>` must not read as a grant.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { entry, packedRoot } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { verdict } from './verdict.ts'

const MQTTD_BIN = '/usr/bin/mos-mqttd'
const MQTTD_UNIT = '/usr/lib/systemd/system/mos-mqttd.service'
const MQTTD_POLICY = '/usr/share/dbus-1/system.d/mos-mqttd.conf'
const MQTTD_WANTS = '/etc/systemd/system/multi-user.target.wants/mos-mqttd.service'
const BROKER_BIN = '/usr/bin/mos-mqtt-broker'
const BROKER_UNIT = '/usr/lib/systemd/system/mos-mqtt-broker.service'
const BROKER_WANTS = '/etc/systemd/system/multi-user.target.wants/mos-mqtt-broker.service'

/**
 * Members of com.mos.mosd the bridge must never be granted.
 *
 * Reboot and PowerOff are the appliance; SetSettings rewrites the persisted
 * tree; SetTransientRootPassword writes a root credential into /etc/shadow.
 */
const FORBIDDEN_MEMBERS = ['Reboot', 'PowerOff', 'SetSettings', 'SetTransientRootPassword'] as const

/** `${prefix}: ${path} is a regular file`, as check_mqttd and check_mqtt_broker say it. */
function prefixedRegularFile(id: string, prefix: string, path: string, why: string): CheckCase {
  return {
    id,
    shell: {
      pass: `${prefix}: ${path} is a regular file`,
      fail: `${prefix}: ${path} is missing or not a regular file`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const st = entry(await packedRoot(ctx), path)
      const ok = st !== undefined && st.isFile()
      return [verdict(
        id,
        ok,
        ok
          ? `${prefix}: ${path} is a regular file`
          : `${prefix}: ${path} is missing or not a regular file, ${why}`,
      )]
    },
  }
}

/** The last `Key=` value in a unit, which is what `sed -n 's/^Key=//p' | tail -n1` takes. */
function unitValue(root: string, unit: string, key: string): string {
  const st = entry(root, unit)
  if (st === undefined) return ''
  const hits = readFileSync(join(root, unit), 'utf8')
    .split('\n')
    .filter(l => l.startsWith(`${key}=`))
    .map(l => l.slice(key.length + 1))
  return hits[hits.length - 1] ?? ''
}

/**
 * The whole `ExecStart=` value, continuation lines folded in.
 *
 * `sed -n '/^ExecStart=/,/[^\\]$/p' | tr -d '\\\n'`: from the ExecStart line to
 * the first line not ending in a backslash, with the backslashes and newlines
 * removed. A unit that wraps its command line would otherwise be read as its
 * first fragment, and the `${MOS_MQTT_BROKER_HOST}` reference is usually in the
 * middle of it.
 */
function execStart(root: string, unit: string): string {
  const st = entry(root, unit)
  if (st === undefined) return ''
  const lines = readFileSync(join(root, unit), 'utf8').split('\n')
  const out: string[] = []
  let inExec = false
  for (const line of lines) {
    if (!inExec && !line.startsWith('ExecStart=')) continue
    inExec = true
    out.push(line)
    if (!line.endsWith('\\')) break
  }
  return out.join('').replace(/\\/g, '')
}

/** `/etc/passwd` as the oracle's awk reads it: name, uid, gid, shell. */
interface Account {
  readonly name: string
  readonly uid: string
  readonly gid: string
  readonly shell: string
}

function accounts(root: string): Account[] {
  const st = entry(root, '/etc/passwd')
  if (st === undefined) return []
  return readFileSync(join(root, '/etc/passwd'), 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '')
    .map((l) => {
      const f = l.split(':')
      return { name: f[0] ?? '', uid: f[2] ?? '', gid: f[3] ?? '', shell: f[6] ?? '' }
    })
}

/**
 * The policy file with comments removed and one XML tag per line.
 *
 * `dbus_policy_rules_only | tr '\n' ' ' | sed 's/</\n</g'` -- comments first,
 * because a commented-out rule must not become a rule when the tags are split.
 * `<!-- ... -->` may span lines, which is why this tracks the open state across
 * the whole file rather than stripping per line.
 */
export function policyRuleLines(text: string): string[] {
  let out = ''
  let inComment = false
  for (const line of text.split('\n')) {
    let rest = line
    for (;;) {
      if (inComment) {
        const close = rest.indexOf('-->')
        if (close === -1) { rest = ''; break }
        rest = rest.slice(close + 3)
        inComment = false
      }
      else {
        const open = rest.indexOf('<!--')
        if (open === -1) { out += rest; rest = ''; break }
        out += rest.slice(0, open)
        rest = rest.slice(open + 4)
        inComment = true
      }
    }
    out += ' '
  }
  return out.replace(/</g, '\n<').split('\n').map(l => l.trim()).filter(l => l !== '')
}

function policyRules(root: string, path: string): string[] {
  const st = entry(root, path)
  if (st === undefined) return []
  return policyRuleLines(readFileSync(join(root, path), 'utf8'))
}

// check_mqttd

const MQTTD_CHECKS: readonly CheckCase[] = [
  prefixedRegularFile('mqttd-bin', 'mqttd', MQTTD_BIN,
    'so the MQTT bridge is not in this image at all — the crate builds and its '
    + 'protocol tests pass either way'),
  prefixedRegularFile('mqttd-unit', 'mqttd', MQTTD_UNIT,
    'so the MQTT bridge is not in this image at all — the crate builds and its '
    + 'protocol tests pass either way'),
  prefixedRegularFile('mqttd-policy', 'mqttd', MQTTD_POLICY,
    'so the MQTT bridge is not in this image at all — the crate builds and its '
    + 'protocol tests pass either way'),

  {
    // NOT enabled. An enablement symlink baked into the image is the one thing
    // `mqtt.enabled` cannot override, and the root is read-only so nobody can
    // remove it on the device.
    id: 'mqttd-not-enabled',
    shell: {
      pass: 'mqttd: the bridge is NOT enabled in the image (',
      fail: 'so the bridge starts at boot regardless of mqtt.enabled',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      // `[ ! -e ] && [ ! -L ]`, and NOT either alone: a wants symlink points at
      // an ABSOLUTE path under /usr/lib, which resolves to nothing whenever
      // ROOT is an unpacked tree rather than /. -e follows the link and would
      // call a present-but-dangling symlink absent -- passing this check on
      // exactly the image that failed it. lstat answers what is AT the path.
      const present = entry(await packedRoot(ctx), MQTTD_WANTS) !== undefined
      return [verdict(
        'mqttd-not-enabled',
        !present,
        present
          ? `mqttd: ${MQTTD_WANTS} exists, so the bridge starts at boot regardless of mqtt.enabled `
            + `— publishing against a broker the same switch has not started, which is the 30s retry `
            + `loop this work exists to end. The root filesystem is a read-only verity squashfs, so `
            + `nobody can disable it on the device`
          : `mqttd: the bridge is NOT enabled in the image (${MQTTD_WANTS} absent); mosd starts it `
            + `when mqtt.enabled becomes true and not before`,
      )]
    },
  },

  {
    // A STATIC identity. This is the one that silently breaks the grant:
    // dbus-daemon resolves `<policy user=>` when it READS the file at startup,
    // before any dynamic user for the unit exists, so the grant would load and
    // match nothing -- and the bridge connects to the broker and publishes
    // nothing, with no error at the point of cause.
    id: 'mqttd-static-user',
    shell: {
      pass: "mqttd: the unit runs as the static user '",
      fail: "mqttd: the unit sets User='",
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const user = unitValue(root, MQTTD_UNIT, 'User')
      const dynamic = unitValue(root, MQTTD_UNIT, 'DynamicUser')
      const ok = user !== '' && (dynamic === '' ? 'no' : dynamic) !== 'yes'
      return [verdict(
        'mqttd-static-user',
        ok,
        ok
          ? `mqttd: the unit runs as the static user '${user}', an identity a <policy user=> can resolve`
          : `mqttd: the unit sets User='${user}' DynamicUser='${dynamic}'. dbus-daemon resolves `
            + `<policy user=> when it reads the file at startup, before any dynamic user for the unit `
            + `exists, so the grant in ${MQTTD_POLICY} would load and match nothing. The bridge then `
            + `connects to the broker and publishes nothing, with no error at the point of cause`,
      )]
    },
  },

  {
    // ...and the policy names THAT user. Two files, one identity; either alone
    // is consistent with a grant nobody holds, and a rule naming the wrong one
    // reads in review exactly like a working one.
    id: 'mqttd-policy-names-unit-user',
    shell: {
      pass: 'mqttd: the D-Bus grant names the same user the unit runs as (',
      fail: '(after comment stripping)',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const user = unitValue(root, MQTTD_UNIT, 'User')
      const named = [...new Set(policyRules(root, MQTTD_POLICY)
        .flatMap(l => [...l.matchAll(/<policy user="([^"]*)"/g)].map(m => m[1] as string)))]
        .sort()
      const policyUser = named[0] ?? ''
      const ok = user !== '' && policyUser === user
      return [verdict(
        'mqttd-policy-names-unit-user',
        ok,
        ok
          ? `mqttd: the D-Bus grant names the same user the unit runs as ('${user}'), as a live rule `
            + `and not commentary`
          : `mqttd: the unit runs as '${user}' but ${MQTTD_POLICY} grants '${policyUser}' (after `
            + `comment stripping). A grant naming the wrong identity is a rule that loads, matches `
            + `nothing, and reads in review exactly like a working one`,
      )]
    },
  },

  {
    // The identity has to EXIST in the image, or systemd cannot start the unit
    // and dbus-daemon cannot resolve the rule. Both failures are at boot, on
    // the device.
    id: 'mqttd-user-in-passwd',
    shell: {
      pass: "' exists in the image's /etc/passwd (",
      fail: 'and no such account is in ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const user = unitValue(root, MQTTD_UNIT, 'User')
      const found = accounts(root).find(a => a.name === user)
      const ok = user !== '' && found !== undefined
      return [verdict(
        'mqttd-user-in-passwd',
        ok,
        ok && found !== undefined
          ? `mqttd: '${user}' exists in the image's /etc/passwd (uid ${found.uid}, gid ${found.gid}, `
            + `shell ${found.shell})`
          : `mqttd: the unit runs as '${user}' and no such account is in ${root}/etc/passwd. systemd `
            + `refuses to start the unit and dbus-daemon drops the policy rule; both failures are at `
            + `boot, on the device`,
      )]
    },
  },

  {
    // The grant is PER-MEMBER. A blanket send_destination would hand the
    // network-facing daemon the whole of com.mos.mosd -- Reboot, PowerOff,
    // SetSettings and SetTransientRootPassword included.
    id: 'mqttd-grant-per-member',
    shell: {
      pass: 'mqttd: every grant on com.mos.mosd names a member',
      fail: ['mqttd: there is no grant on com.mos.mosd at all in ', 'names no member:'],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const sends = policyRules(root, MQTTD_POLICY)
        .filter(l => l.startsWith('<allow') && l.includes('send_destination="com.mos.mosd"'))
      const blanket = sends.filter(l => !l.includes('send_member='))
      if (sends.length === 0) {
        return [verdict('mqttd-grant-per-member', false,
          `mqttd: there is no grant on com.mos.mosd at all in ${MQTTD_POLICY}. com.mos.mosd is `
          + `root-only, so the bridge reaches nothing: it connects to the broker, subscribes, and `
          + `publishes an empty tree forever`)]
      }
      return [verdict(
        'mqttd-grant-per-member',
        blanket.length === 0,
        blanket.length === 0
          ? 'mqttd: every grant on com.mos.mosd names a member; the bridge cannot reach the interface '
            + 'at large'
          : `mqttd: a grant on com.mos.mosd in ${MQTTD_POLICY} names no member:`
            + `${blanket.map(r => ` [${r}]`).join('')}. That is the whole interface — `
            + `${FORBIDDEN_MEMBERS.join(', ')} included — handed to the only daemon in the image with `
            + `a network socket`,
      )]
    },
  },

  {
    // ...and none of the members it does name is one of the dangerous ones. A
    // compromise of the network-facing daemon would otherwise become device
    // control, and mosd's own root-only policy keeps passing because it cannot
    // see a grant made in another file.
    id: 'mqttd-no-forbidden-members',
    shell: {
      pass: 'mqttd: the granted members (',
      fail: 'grants the bridge',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const members = [...new Set(policyRules(root, MQTTD_POLICY)
        .flatMap(l => [...l.matchAll(/send_member="([^"]*)"/g)].map(m => m[1] as string)))]
        .sort()
      const danger = FORBIDDEN_MEMBERS.filter(m => members.includes(m))
      return [verdict(
        'mqttd-no-forbidden-members',
        danger.length === 0,
        danger.length === 0
          ? `mqttd: the granted members (${members.join(' ')}) include none of `
            + `${FORBIDDEN_MEMBERS.join(', ')}`
          : `mqttd: ${MQTTD_POLICY} grants the bridge${danger.map(m => ` ${m}`).join('')}. A `
            + `compromise of the network-facing daemon becomes device control, and mosd's own `
            + `root-only policy keeps passing because it cannot see a grant made in another file`,
      )]
    },
  },

  {
    // The broker must be configurable WITHOUT reflashing. The root is an
    // immutable squashfs and `systemctl edit` has nowhere to write, so a
    // literal address here is the same address on every device flashed with
    // this image, unchangeable.
    id: 'mqttd-broker-from-environment',
    shell: {
      pass: 'mqttd: ExecStart takes the broker from the environment',
      fail: 'mqttd: ExecStart does not reference',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const exec = execStart(await packedRoot(ctx), MQTTD_UNIT)
      const ok = exec.includes('${MOS_MQTT_BROKER_HOST}')
      return [verdict(
        'mqttd-broker-from-environment',
        ok,
        ok
          ? 'mqttd: ExecStart takes the broker from the environment, so the address is not baked into '
            + 'the verity root'
          : `mqttd: ExecStart does not reference \${MOS_MQTT_BROKER_HOST}: [${exec}]. The root `
            + `filesystem is read-only and systemctl edit has nowhere to write, so a literal broker `
            + `address here is the same address on every device flashed with this image, unchangeable`,
      )]
    },
  },

  {
    // ...and the file it reads that from has to be on writable, persistent
    // storage, which on this appliance means a STATE-backed bind. OPTIONAL
    // (leading '-'), or an unconfigured device fails to start the unit, which
    // is a worse default than running unconfigured.
    //
    // Three failure sentences, and they share nothing but `EnvironmentFile` --
    // which the shadow family's PASS line also carries. A fail matcher is only
    // ever tried against FAIL lines, so the list below is exact and the overlap
    // is not reachable.
    id: 'mqttd-envfile-on-state',
    shell: {
      pass: 'mqttd: EnvironmentFile=',
      fail: [
        'mqttd: the unit has no EnvironmentFile= line at all',
        "is not optional (no leading '-')",
        'which no .mount unit in the image mounts',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const envfile = unitValue(root, MQTTD_UNIT, 'EnvironmentFile')
      if (envfile === '') {
        return [verdict('mqttd-envfile-on-state', false,
          `mqttd: the unit has no EnvironmentFile= line at all, so ${MQTTD_UNIT}'s Environment= `
          + `defaults are the only configuration and the broker cannot be changed on the device at all`)]
      }
      const path = envfile.replace(/^-/, '')
      if (path === envfile) {
        return [verdict('mqttd-envfile-on-state', false,
          `mqttd: EnvironmentFile=${envfile} is not optional (no leading '-'). A device whose operator `
          + `has not written that file fails to start the unit, which is a worse default than running `
          + `unconfigured`)]
      }
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '/'
      const mount = mountUnitFor(root, dir)
      if (mount === undefined) {
        return [verdict('mqttd-envfile-on-state', false,
          `mqttd: EnvironmentFile=${envfile} sits under ${dir}, which no .mount unit in the image `
          + `mounts. That path is inside the read-only verity squashfs, so the operator cannot write `
          + `it and the broker stays whatever the image was built with`)]
      }
      return [verdict('mqttd-envfile-on-state', true,
        `mqttd: EnvironmentFile=${envfile} sits under ${dir}, a bind mounted by `
        + `${mount.name} (What=${mount.what}), so a broker configured on the device survives a reboot `
        + `and an A/B update`)]
    },
  },
]

/** `grep -rl "^Where=${dir}$" /etc/systemd/system`, taking the first hit. */
function mountUnitFor(root: string, dir: string): { name: string, what: string } | undefined {
  let names: string[]
  try {
    names = readdirSync(join(root, '/etc/systemd/system')).sort()
  }
  catch {
    return undefined
  }
  for (const name of names) {
    const path = `/etc/systemd/system/${name}`
    if (entry(root, path)?.isFile() !== true) continue
    const text = readFileSync(join(root, path), 'utf8')
    if (!text.split('\n').some(l => l === `Where=${dir}`)) continue
    const what = text.split('\n').filter(l => l.startsWith('What=')).map(l => l.slice(5))
    return { name, what: what[what.length - 1] ?? '' }
  }
  return undefined
}

// check_mqtt_broker

const BROKER_CHECKS: readonly CheckCase[] = [
  prefixedRegularFile('mqtt-broker-bin', 'mqtt-broker', BROKER_BIN,
    'so mqtt.enabled has nothing to start. The bridge then publishes at a broker that is not in the '
    + 'image and retries forever, which is the noise this work exists to end'),
  prefixedRegularFile('mqtt-broker-unit', 'mqtt-broker', BROKER_UNIT,
    'so mqtt.enabled has nothing to start. The bridge then publishes at a broker that is not in the '
    + 'image and retries forever, which is the noise this work exists to end'),

  {
    // The unit carries [Install] information deliberately, and the image
    // deliberately does not act on it: a broker enabled in the image would be
    // listening from early boot, before anything had consulted the switch.
    //
    // There is no policy file in this set and that is not an omission. The
    // broker speaks no D-Bus at all -- it reads one file mosd renders into /run
    // and listens on a TCP socket -- so it has nothing to be granted.
    id: 'mqtt-broker-not-enabled',
    shell: {
      pass: 'mqtt-broker: the broker is NOT enabled in the image (',
      fail: 'so the broker listens from early boot',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const present = entry(await packedRoot(ctx), BROKER_WANTS) !== undefined
      return [verdict(
        'mqtt-broker-not-enabled',
        !present,
        present
          ? `mqtt-broker: ${BROKER_WANTS} exists, so the broker listens from early boot on every `
            + `device flashed with this image, before anything consulted mqtt.enabled — and mosd owns `
            + `the lifecycle, so the switch it is meant to obey is the one thing that cannot turn it `
            + `off. The root filesystem is a read-only verity squashfs, so systemctl disable has `
            + `nowhere to write on the device`
          : `mqtt-broker: the broker is NOT enabled in the image (${BROKER_WANTS} absent); mosd owns `
            + `the lifecycle and starts it from mqtt.enabled`,
      )]
    },
  },

  {
    // A STATIC identity, for a DIFFERENT reason than the bridge's: a dynamic
    // uid is allocated at start and gone at stop, so
    // /var/lib/mos/mqtt-broker-users.toml would be left owned by a number that
    // names nobody on the next boot.
    id: 'mqtt-broker-static-user',
    shell: {
      pass: "mqtt-broker: the unit runs as the static user '",
      fail: "mqtt-broker: the unit sets User='",
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const user = unitValue(root, BROKER_UNIT, 'User')
      const dynamic = unitValue(root, BROKER_UNIT, 'DynamicUser')
      const ok = user !== '' && (dynamic === '' ? 'no' : dynamic) !== 'yes'
      return [verdict(
        'mqtt-broker-static-user',
        ok,
        ok
          ? `mqtt-broker: the unit runs as the static user '${user}', an identity a credentials file `
            + `on STATE can be owned by`
          : `mqtt-broker: the unit sets User='${user}' DynamicUser='${dynamic}'. A dynamic uid is `
            + `allocated at start and gone at stop, so /var/lib/mos/mqtt-broker-users.toml would be `
            + `left owned by a number that names nobody on the next boot, and the only way to keep `
            + `the credentials readable would be to make them readable by everyone`,
      )]
    },
  },

  {
    id: 'mqtt-broker-user-in-passwd',
    shell: {
      pass: "mqtt-broker: the account '",
      fail: 'and no account of that name is in ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const user = unitValue(root, BROKER_UNIT, 'User')
      const found = accounts(root).find(a => a.name === user)
      const ok = user !== '' && found !== undefined
      return [verdict(
        'mqtt-broker-user-in-passwd',
        ok,
        ok && found !== undefined
          ? `mqtt-broker: the account '${user}' is present in the image (uid ${found.uid}, gid `
            + `${found.gid}, shell ${found.shell})`
          : `mqtt-broker: the unit runs as '${user}' and no account of that name is in `
            + `${root}/etc/passwd. systemd refuses to start the unit, so turning mqtt.enabled on `
            + `brings up a bridge and no broker, and the failure is at boot on the device`,
      )]
    },
  },
]

export const MQTT_CHECKS: readonly CheckCase[] = [...MQTTD_CHECKS, ...BROKER_CHECKS]
