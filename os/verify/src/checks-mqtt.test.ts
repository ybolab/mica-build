// The MQTT pair driven from the failing side.
//
// Each case is ONE edit to a fixture
// asserted green first, and each edit is a shape the real defect took: the
// bridge absent from the image while its crate and protocol tests were green, a
// `DynamicUser=yes` no `<policy user=>` could name, an ExecStart with a broker
// host baked into a read-only squashfs, and an enablement symlink that defeats
// the switch mosd is supposed to own.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { MQTT_CHECKS, policyRuleLines } from './checks-mqtt.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

const MQTTD_UNIT = '/usr/lib/systemd/system/mos-mqttd.service'
const MQTTD_POLICY = '/usr/share/dbus-1/system.d/mos-mqttd.conf'
const BROKER_UNIT = '/usr/lib/systemd/system/mos-mqtt-broker.service'

function checkNamed(id: string): CheckCase {
  const found = MQTT_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no MQTT check is registered as '${id}'. Registered: `
      + MQTT_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

async function verdictOf(fx: RootFixture, id: string): Promise<Verdict> {
  const got = await checkNamed(id).run(fx.ctx)
  expect(got.length).toBe(1)
  return (got[0] as CheckResult).verdict
}

async function messageOf(fx: RootFixture, id: string): Promise<string> {
  const got = await checkNamed(id).run(fx.ctx)
  return (got[0] as CheckResult).message
}

async function mutated(id: string, mutate: (root: string) => void, board: Board = cx3576): Promise<RootFixture> {
  const fx = packedRootFixture(board)
  expect(await verdictOf(fx, id)).toBe('pass')
  mutate(fx.root)
  return fx
}

function rewrite(root: string, path: string, edit: (text: string) => string): void {
  writeFileSync(join(root, path), edit(readFileSync(join(root, path), 'utf8')))
}

describe('the healthy image', () => {
  test('every MQTT check PASSES on both boards -- this family is board-unconditional', async () => {
    // 16 conclusions on EACH shipped board, measured against both boards' real
    // oracle output. Nothing here is gated on a board declaration, which is why
    // it was not batch 3 as scoped and why no batch had picked it up.
    for (const board of [cx3576, x64]) {
      const fx = packedRootFixture(board)
      try {
        for (const c of MQTT_CHECKS) {
          const got = await c.run(fx.ctx)
          expect(`${board.name}/${c.id}: ${got.map(r => r.verdict).join(',')}`)
            .toBe(`${board.name}/${c.id}: pass`)
        }
      }
      finally {
        fx.dispose()
      }
    }
    for (const c of MQTT_CHECKS) expect(`${c.id}: ${c.boards}`).toBe(`${c.id}: undefined`)
  })
})

describe('the bridge is in the image at all', () => {
  test('a missing binary fails, and the message says the crate would still be green', async () => {
    const fx = await mutated('mqttd-bin', root => rmSync(join(root, '/usr/bin/mos-mqttd')))
    try {
      expect(await verdictOf(fx, 'mqttd-bin')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-bin')).toContain('the crate builds and its protocol tests pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('a policy file that became a SYMLINK fails -- lstat, not -f', async () => {
    const fx = await mutated('mqttd-policy', (root) => {
      rmSync(join(root, MQTTD_POLICY))
      symlinkSync('/usr/share/dbus-1/system.d/elsewhere.conf', join(root, MQTTD_POLICY))
    })
    try {
      expect(await verdictOf(fx, 'mqttd-policy')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('...and INERT, which is the load-bearing half', () => {
  test('an enablement symlink defeats mqtt.enabled and fails', async () => {
    const fx = await mutated('mqttd-not-enabled', (root) => {
      const dir = join(root, '/etc/systemd/system/multi-user.target.wants')
      mkdirSync(dir, { recursive: true })
      symlinkSync(MQTTD_UNIT, join(dir, 'mos-mqttd.service'))
    })
    try {
      expect(await verdictOf(fx, 'mqttd-not-enabled')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-not-enabled'))
        .toContain('the bridge starts at boot regardless of mqtt.enabled')
    }
    finally {
      fx.dispose()
    }
  })

  test('a DANGLING wants symlink still counts as enabled', async () => {
    // The trap: a wants symlink points at an ABSOLUTE
    // path under /usr/lib, which resolves to nothing whenever ROOT is an
    // unpacked tree rather than /. A check using `-e` alone follows the link,
    // calls it absent, and PASSES on exactly the image that failed it.
    const fx = await mutated('mqtt-broker-not-enabled', (root) => {
      const dir = join(root, '/etc/systemd/system/multi-user.target.wants')
      mkdirSync(dir, { recursive: true })
      symlinkSync('/usr/lib/systemd/system/mos-mqtt-broker.service.nowhere',
        join(dir, 'mos-mqtt-broker.service'))
    })
    try {
      expect(await verdictOf(fx, 'mqtt-broker-not-enabled')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the identity the unit runs as', () => {
  test('DynamicUser=yes fails, because <policy user=> is resolved at dbus startup', async () => {
    // The one that silently breaks the grant: dbus-daemon reads the policy file
    // before any dynamic user exists, so the rule loads and matches nothing --
    // and the bridge connects to the broker and publishes nothing, with no
    // error at the point of cause.
    const fx = await mutated('mqttd-static-user', root =>
      rewrite(root, MQTTD_UNIT, t => t.replace('User=mos-mqttd\n', 'DynamicUser=yes\n')))
    try {
      expect(await verdictOf(fx, 'mqttd-static-user')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-static-user')).toContain('dbus-daemon resolves')
    }
    finally {
      fx.dispose()
    }
  })

  test('a policy naming a DIFFERENT user fails, and both names are printed', async () => {
    // A grant naming the wrong identity is a rule that loads, matches nothing,
    // and reads in review exactly like a working one -- so the message has to
    // carry both sides or a reader cannot see which is wrong.
    const fx = await mutated('mqttd-policy-names-unit-user', root =>
      rewrite(root, MQTTD_POLICY, t => t.replace('<policy user="mos-mqttd">', '<policy user="mqtt">')))
    try {
      expect(await verdictOf(fx, 'mqttd-policy-names-unit-user')).toBe('fail')
      const message = await messageOf(fx, 'mqttd-policy-names-unit-user')
      expect(message).toContain("runs as 'mos-mqttd'")
      expect(message).toContain("grants 'mqtt'")
    }
    finally {
      fx.dispose()
    }
  })

  test('an identity absent from /etc/passwd fails: systemd refuses the unit at boot', async () => {
    const fx = await mutated('mqttd-user-in-passwd', root =>
      rewrite(root, '/etc/passwd', t => t.split('\n').filter(l => !l.startsWith('mos-mqttd:')).join('\n')))
    try {
      expect(await verdictOf(fx, 'mqttd-user-in-passwd')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
    const broker = await mutated('mqtt-broker-user-in-passwd', root =>
      rewrite(root, '/etc/passwd', t => t.split('\n').filter(l => !l.startsWith('mos-mqtt-broker:')).join('\n')))
    try {
      expect(await verdictOf(broker, 'mqtt-broker-user-in-passwd')).toBe('fail')
    }
    finally {
      broker.dispose()
    }
  })

  test('the passing message carries the uid, gid and shell, not just the name', async () => {
    // What a reader needs when the account exists and the unit still will not
    // start: a nologin shell and a system uid are the shape it should have.
    const fx = packedRootFixture(cx3576)
    try {
      const message = await messageOf(fx, 'mqttd-user-in-passwd')
      expect(message).toContain('uid 970, gid 970, shell /usr/sbin/nologin')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the D-Bus grant', () => {
  test('a BLANKET send_destination fails -- that is the whole interface', async () => {
    // Reboot, PowerOff, SetSettings and SetTransientRootPassword included,
    // handed to the only daemon in the image with a network socket.
    const fx = await mutated('mqttd-grant-per-member', root =>
      rewrite(root, MQTTD_POLICY, t => t.replace(
        '<allow send_destination="com.mos.mosd" send_member="SetValue"/>',
        '<allow send_destination="com.mos.mosd"/>')))
    try {
      expect(await verdictOf(fx, 'mqttd-grant-per-member')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-grant-per-member')).toContain('names no member:')
    }
    finally {
      fx.dispose()
    }
  })

  test('NO grant at all fails differently: the bridge publishes an empty tree forever', async () => {
    // A different defect with a different repair, so a different sentence.
    const fx = await mutated('mqttd-grant-per-member', root =>
      rewrite(root, MQTTD_POLICY, t => t.replace(/send_destination="com\.mos\.mosd"/g,
        'send_destination="com.mos.other"')))
    try {
      expect(await verdictOf(fx, 'mqttd-grant-per-member')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-grant-per-member')).toContain('there is no grant on com.mos.mosd at all')
    }
    finally {
      fx.dispose()
    }
  })

  test('a grant on a FORBIDDEN member fails, and names it', async () => {
    const fx = await mutated('mqttd-no-forbidden-members', root =>
      rewrite(root, MQTTD_POLICY, t => t.replace('send_member="SetValue"', 'send_member="Reboot"')))
    try {
      expect(await verdictOf(fx, 'mqttd-no-forbidden-members')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-no-forbidden-members')).toContain('grants the bridge Reboot')
    }
    finally {
      fx.dispose()
    }
  })

  test('attributes WRAPPED across lines are read as one rule', async () => {
    // Measured on the oracle's first run against the real file: the
    // shipped rules wrap, so a line-oriented search for send_member= on a rule
    // whose send_destination= is on the line above finds nothing and reports a
    // BLANKET grant that is not there. The fixture's first rule wraps on
    // purpose; this asserts it is not misread.
    const fx = packedRootFixture(cx3576)
    try {
      expect(readFileSync(join(fx.root, MQTTD_POLICY), 'utf8')).toContain('<allow\n')
      expect(await verdictOf(fx, 'mqttd-grant-per-member')).toBe('pass')
      expect(await messageOf(fx, 'mqttd-no-forbidden-members')).toContain('GetItems SetValue')
    }
    finally {
      fx.dispose()
    }
  })

  test('a COMMENTED-OUT rule is commentary and is not read as a grant', async () => {
    // The comment strip has to come BEFORE the tag split, or a commented-out
    // `<allow send_destination="com.mos.mosd"/>` becomes a rule the moment the
    // tags are put on their own lines. The fixture ships exactly that comment.
    const lines = policyRuleLines(
      '<busconfig>\n'
      + '  <!-- <allow send_destination="com.mos.mosd"/> -->\n'
      + '  <policy user="mos-mqttd"><allow send_destination="com.mos.mosd" send_member="GetItems"/></policy>\n'
      + '</busconfig>\n')
    expect(lines.filter(l => l.includes('send_destination="com.mos.mosd"')).length).toBe(1)
    expect(lines.some(l => l.includes('send_member="GetItems"'))).toBe(true)
  })

  test('a comment spanning several LINES is stripped whole', async () => {
    const lines = policyRuleLines(
      '<busconfig>\n'
      + '  <!-- a rule we removed:\n'
      + '       <allow send_destination="com.mos.mosd"/>\n'
      + '       and why -->\n'
      + '  <policy user="x"/>\n'
      + '</busconfig>\n')
    expect(lines.some(l => l.includes('send_destination'))).toBe(false)
    expect(lines.some(l => l.startsWith('<policy user="x"'))).toBe(true)
  })
})

describe('the broker address, and where it is configured', () => {
  test('a hardcoded broker host fails: the root is immutable and has no systemctl edit', async () => {
    const fx = await mutated('mqttd-broker-from-environment', root =>
      rewrite(root, MQTTD_UNIT, t => t.replace('${MOS_MQTT_BROKER_HOST}', 'mqtt.example.invalid')))
    try {
      expect(await verdictOf(fx, 'mqttd-broker-from-environment')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-broker-from-environment')).toContain('mqtt.example.invalid')
    }
    finally {
      fx.dispose()
    }
  })

  test('an ExecStart WRAPPED over continuation lines is still read whole', async () => {
    // `sed -n '/^ExecStart=/,/[^\\]$/p' | tr -d '\\\n'`. A reader that took the
    // first line only would report a hardcoded host for a unit that has none,
    // because the reference is usually in the middle of the command line.
    const fx = packedRootFixture(cx3576)
    try {
      rewrite(fx.root, MQTTD_UNIT, t => t.replace(
        'ExecStart=/usr/bin/mos-mqttd --broker ${MOS_MQTT_BROKER_HOST}\n',
        'ExecStart=/usr/bin/mos-mqttd \\\n  --broker ${MOS_MQTT_BROKER_HOST} \\\n  --verbose\n'))
      expect(await verdictOf(fx, 'mqttd-broker-from-environment')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('a NON-optional EnvironmentFile fails: an unconfigured device would not start', async () => {
    // A worse default than running unconfigured, and it is one character.
    const fx = await mutated('mqttd-envfile-on-state', root =>
      rewrite(root, MQTTD_UNIT, t => t.replace('EnvironmentFile=-/var', 'EnvironmentFile=/var')))
    try {
      expect(await verdictOf(fx, 'mqttd-envfile-on-state')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-envfile-on-state')).toContain("not optional (no leading '-')")
    }
    finally {
      fx.dispose()
    }
  })

  test('no EnvironmentFile at all fails', async () => {
    const fx = await mutated('mqttd-envfile-on-state', root =>
      rewrite(root, MQTTD_UNIT, t => t.replace(/^EnvironmentFile=.*\n/m, '')))
    try {
      expect(await verdictOf(fx, 'mqttd-envfile-on-state')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-envfile-on-state')).toContain('no EnvironmentFile= line at all')
    }
    finally {
      fx.dispose()
    }
  })

  test('an EnvironmentFile under a path no .mount unit mounts fails', async () => {
    // That path is inside the read-only verity squashfs, so the operator cannot
    // write it and the broker stays whatever the image was built with. The
    // check looks for a unit whose Where= is the file's DIRECTORY, which is
    // what makes moving the file one directory up a caught mistake.
    const fx = await mutated('mqttd-envfile-on-state', root =>
      rewrite(root, MQTTD_UNIT, t => t.replace('EnvironmentFile=-/var/lib/mos/mqttd.env',
        'EnvironmentFile=-/etc/mos/mqttd.env')))
    try {
      expect(await verdictOf(fx, 'mqttd-envfile-on-state')).toBe('fail')
      expect(await messageOf(fx, 'mqttd-envfile-on-state')).toContain('no .mount unit in the image mounts')
    }
    finally {
      fx.dispose()
    }
  })

  test('the passing message names the mount unit and its What=', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await messageOf(fx, 'mqttd-envfile-on-state'))
        .toContain('a bind mounted by var-lib-mos.mount (What=/mnt/state/mos)')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the broker half', () => {
  test('a DynamicUser broker fails for its own reason -- the credentials file', async () => {
    // Not the bridge's reason. A dynamic uid is allocated at start and gone at
    // stop, so /var/lib/mos/mqtt-broker-users.toml would be left owned by a
    // number that names nobody on the next boot.
    const fx = await mutated('mqtt-broker-static-user', root =>
      rewrite(root, BROKER_UNIT, t => t.replace('User=mos-mqtt-broker\n', 'DynamicUser=yes\n')))
    try {
      expect(await verdictOf(fx, 'mqtt-broker-static-user')).toBe('fail')
      expect(await messageOf(fx, 'mqtt-broker-static-user')).toContain('mqtt-broker-users.toml')
    }
    finally {
      fx.dispose()
    }
  })

  test('the broker set has NO policy check, and that is not an omission', () => {
    // The broker speaks no D-Bus at all: it reads one file mosd renders into
    // /run and listens on a TCP socket, so it has nothing to be granted and
    // nothing to be denied. Asserted so the absence is a decision on the
    // record rather than a gap someone later "fixes".
    expect(MQTT_CHECKS.filter(c => c.id.startsWith('mqtt-broker-')).map(c => c.id)).toEqual([
      'mqtt-broker-bin', 'mqtt-broker-unit', 'mqtt-broker-not-enabled',
      'mqtt-broker-static-user', 'mqtt-broker-user-in-passwd',
    ])
  })
})
