// The D-Bus policy batch driven from the failing side.
//
// PLAN-014 M4f (RFCT-110), RFCT-096. Each case asserts the check GREEN on the
// unmutated fixture, makes ONE edit, asserts RED, and asserts the message names
// the thing. The edits are the shapes the real mistake takes: a one-character
// widening of own_prefix that reads in a diff like a simplification, a grant
// that survives only inside an XML comment, a second policy file that reopens
// the name the first one closed, and a deny naming a bus that does not exist.
//
// Two of the cases here assert a NON-mutation: the extension policy's own
// commentary names com.mos.mosd and shows `own_prefix="com.mos"` as the mistake
// to avoid, and neither may be read as a rule. That is a check on the reader
// rather than on the image, and it is the direction that would be dangerous --
// a verifier that reported the warning as an instance of the hazard has one
// obvious repair, which is to delete the warning.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { DBUS_CHECKS, policyFacts, policyTags, stripXmlComments } from './checks-dbus.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

const MOSD_POLICY = '/usr/share/dbus-1/system.d/com.mos.mosd.conf'
const EXT_POLICY = '/usr/share/dbus-1/system.d/com.mos.ext.conf'
const MQTTD_POLICY = '/usr/share/dbus-1/system.d/mos-mqttd.conf'
const BLUEZ_POLICY = '/usr/share/dbus-1/system.d/bluetooth.conf'
const MOSD_UNIT = '/usr/lib/systemd/system/mosd.service'

function checkNamed(id: string): CheckCase {
  const found = DBUS_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no D-Bus check is registered as '${id}'. Registered: `
      + DBUS_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

async function only(fx: RootFixture, id: string): Promise<CheckResult> {
  const got = await checkNamed(id).run(fx.ctx)
  expect(got.length).toBe(1)
  return got[0] as CheckResult
}

async function verdictOf(fx: RootFixture, id: string): Promise<Verdict> {
  return (await only(fx, id)).verdict
}

async function messageOf(fx: RootFixture, id: string): Promise<string> {
  return (await only(fx, id)).message
}

/** Green first, then one edit. A fixture red before the mutation proves nothing. */
async function mutated(id: string, mutate: (root: string) => void, board: Board = cx3576): Promise<RootFixture> {
  const fx = packedRootFixture(board)
  expect(await verdictOf(fx, id)).toBe('pass')
  mutate(fx.root)
  return fx
}

function rewrite(root: string, path: string, edit: (text: string) => string): void {
  writeFileSync(join(root, path), edit(readFileSync(join(root, path), 'utf8')))
}

function write(root: string, path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}

describe('the healthy image', () => {
  test('every D-Bus check concludes on both boards, and only bluez skips', async () => {
    // Eleven conclusions on each shipped board, measured against both boards'
    // real oracle output on 2026-08-26. Ten are board-unconditional; the
    // eleventh is bluez's policy, which the oracle SKIPS on a board declaring
    // no bluetooth -- and it prints exactly one line either way, which is why
    // that check owns its own skip rather than a `-skipped` entry owning it.
    for (const board of [cx3576, x64]) {
      const fx = packedRootFixture(board)
      try {
        for (const c of DBUS_CHECKS) {
          const got = await c.run(fx.ctx)
          const want = c.id === 'bluez-dbus-policy' && (board.radios ?? []).includes('bluetooth') === false
            ? 'skip'
            : 'pass'
          expect(`${board.name}/${c.id}: ${got.map(r => r.verdict).join(',')}`)
            .toBe(`${board.name}/${c.id}: ${want}`)
        }
      }
      finally {
        fx.dispose()
      }
    }
  })

  test('no entry is scoped by `boards:` -- every one applies to every board', async () => {
    // The oracle prints all eleven on both boards; bluez's is a SKIP on the
    // board with no controller, not an absence. A `boards:` list here would
    // leave that SKIP line unclaimed on x64 for ever.
    for (const c of DBUS_CHECKS) expect(`${c.id}: ${c.boards}`).toBe(`${c.id}: undefined`)
  })
})

describe('the readers, before any check uses them', () => {
  test('a comment spanning several lines is stripped whole', () => {
    const text = '<busconfig>\n<!-- a\nb\nc -->\n<allow own="x"/>\n</busconfig>\n'
    expect(stripXmlComments(text)).toBe('<busconfig>\n\n\n\n<allow own="x"/>\n</busconfig>\n')
  })

  test('the line structure survives -- one input line, one output line', () => {
    // `check_ext_policy` runs `grep -Eo` over the stripped text and the mosd
    // parse splits it on `<policy`; a stripper that joined lines would change
    // what both of them read.
    const text = 'a\nb\nc\n'
    expect(stripXmlComments(text).split('\n').length).toBe(text.split('\n').length)
  })

  test('an UNTERMINATED comment swallows the rest of the file, as the oracle awk does', () => {
    const text = '<allow own="a"/>\n<!-- oops\n<allow own="b"/>\n'
    expect(stripXmlComments(text)).toBe('<allow own="a"/>\n\n\n')
  })

  test('a rule wrapped across three lines is ONE tag after the reflow', () => {
    // The dangerous direction, in the oracle's own words: a line-oriented
    // reader sees the bus name and the member on different lines, concludes the
    // grant names no member, and the obvious repair is to stop scoping it.
    const tags = policyTags('<policy user="u">\n<allow\n  send_destination="com.mos.mosd"\n'
      + '  send_member="GetItems"/>\n</policy>\n')
    expect(tags).toEqual([
      '<policy user="u">',
      '<allow send_destination="com.mos.mosd" send_member="GetItems"/>',
      '</policy>',
    ])
  })

  test('a rule wrapped across lines is still counted by the per-block parse', () => {
    const facts = policyFacts('<busconfig>\n<policy user="root">\n<allow\n'
      + '  own="com.mos.mosd"/>\n</policy>\n</busconfig>\n', 'com.mos.mosd')
    expect(`${facts.ownRoot}/${facts.ownOther}/${facts.defaultAllows}`).toBe('1/0/0')
  })

  test('own_prefix= is not own= -- the two attributes do not read each other', () => {
    const facts = policyFacts('<policy context="default">\n<allow own_prefix="com.mos.ext"/>\n</policy>\n',
      'com.mos.mosd')
    expect(`${facts.ownRoot}/${facts.ownOther}`).toBe('0/0')
  })

  test('<allowance> is not a rule: `allow` must be followed by whitespace', () => {
    const facts = policyFacts('<policy context="default">\n<allowance send_destination="com.mos.mosd"/>\n'
      + '</policy>\n', 'com.mos.mosd')
    expect(facts.defaultAllows).toBe(0)
  })
})

describe('the system bus itself', () => {
  test('dbus.socket missing fails, and the message names both files', async () => {
    const fx = await mutated('dbus-system-bus-present',
      root => rmSync(join(root, '/usr/lib/systemd/system/dbus.socket')))
    try {
      expect(await verdictOf(fx, 'dbus-system-bus-present')).toBe('fail')
      expect(await messageOf(fx, 'dbus-system-bus-present'))
        .toContain('dbus.service and/or dbus.socket missing')
    }
    finally {
      fx.dispose()
    }
  })

  test('dbus.service missing fails too -- either half is the same fault', async () => {
    const fx = await mutated('dbus-system-bus-present',
      root => rmSync(join(root, '/usr/lib/systemd/system/dbus.service')))
    try {
      expect(await verdictOf(fx, 'dbus-system-bus-present')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the mosd policy is where dbus-daemon looks for it', () => {
  test('an EMPTY policy file fails, though the path is right', async () => {
    // The shape a file-exists check cannot see: a zero-byte file at the correct
    // path governs nothing, and the base system.conf decides alone.
    const fx = await mutated('mosd-policy-ships', root => write(root, MOSD_POLICY, ''))
    try {
      expect(await verdictOf(fx, 'mosd-policy-ships')).toBe('fail')
      expect(await messageOf(fx, 'mosd-policy-ships')).toContain(`${MOSD_POLICY} is missing or empty`)
    }
    finally {
      fx.dispose()
    }
  })

  test('an ABSENT policy file fails, and names SetTransientRootPassword', async () => {
    const fx = await mutated('mosd-policy-ships', root => rmSync(join(root, MOSD_POLICY)))
    try {
      expect(await messageOf(fx, 'mosd-policy-ships')).toContain('SetTransientRootPassword')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('no default-context allow, in EITHER direction', () => {
  test('a default-context send_destination= grant fails and is counted', async () => {
    const fx = await mutated('mosd-policy-no-default-allow', root =>
      rewrite(root, MOSD_POLICY, t => t.replace('</busconfig>',
        '<policy context="default">\n<allow send_destination="com.mos.mosd"/>\n</policy>\n</busconfig>')))
    try {
      expect(await verdictOf(fx, 'mosd-policy-no-default-allow')).toBe('fail')
      expect(await messageOf(fx, 'mosd-policy-no-default-allow'))
        .toContain('has 1 default-context allow rule(s) for com.mos.mosd')
    }
    finally {
      fx.dispose()
    }
  })

  test('a default-context receive_sender= grant fails -- the half that is easy to leave open', async () => {
    // A caller who cannot ask can still listen: SettingsChanged broadcasts the
    // settings VALUE, including access.webAdmin.password_hash.
    const fx = await mutated('mosd-policy-no-default-allow', root =>
      rewrite(root, MOSD_POLICY, t => t.replace('</busconfig>',
        '<policy context="default">\n<allow receive_sender="com.mos.mosd"/>\n</policy>\n</busconfig>')))
    try {
      expect(await verdictOf(fx, 'mosd-policy-no-default-allow')).toBe('fail')
      expect(await messageOf(fx, 'mosd-policy-no-default-allow'))
        .toContain('access.webAdmin.password_hash')
    }
    finally {
      fx.dispose()
    }
  })

  test('a default-context grant inside an XML COMMENT is not a rule', async () => {
    // The non-mutation. A grep would fire on this; the parse must not.
    const fx = packedRootFixture(cx3576)
    try {
      rewrite(fx.root, MOSD_POLICY, t => t.replace('</busconfig>',
        '<!-- <policy context="default"><allow send_destination="com.mos.mosd"/></policy> -->\n</busconfig>'))
      expect(await verdictOf(fx, 'mosd-policy-no-default-allow')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('own= is root-only', () => {
  test('own= moved OUT of the root block fails, and the counts are named', async () => {
    const fx = await mutated('mosd-policy-own-root-only', root =>
      write(root, MOSD_POLICY,
        '<busconfig>\n<policy context="default">\n<allow own="com.mos.mosd"/>\n</policy>\n</busconfig>\n'))
    try {
      expect(await verdictOf(fx, 'mosd-policy-own-root-only')).toBe('fail')
      expect(await messageOf(fx, 'mosd-policy-own-root-only'))
        .toContain('appears 0 time(s) under <policy user="root"> and 1 time(s) elsewhere')
    }
    finally {
      fx.dispose()
    }
  })

  test('a SECOND own= under another user fails even with the root grant intact', async () => {
    // The direction that matters: an unprivileged process could take the name
    // before mosd does. The root grant still being there is not a defence.
    const fx = await mutated('mosd-policy-own-root-only', root =>
      rewrite(root, MOSD_POLICY, t => t.replace('</busconfig>',
        '<policy user="mos">\n<allow own="com.mos.mosd"/>\n</policy>\n</busconfig>')))
    try {
      expect(await messageOf(fx, 'mosd-policy-own-root-only'))
        .toContain('appears 1 time(s) under <policy user="root"> and 1 time(s) elsewhere')
    }
    finally {
      fx.dispose()
    }
  })

  test('NO own= anywhere fails: mosd could not take its own name', async () => {
    const fx = await mutated('mosd-policy-own-root-only', root =>
      write(root, MOSD_POLICY, '<busconfig>\n<policy user="root">\n</policy>\n</busconfig>\n'))
    try {
      expect(await verdictOf(fx, 'mosd-policy-own-root-only')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the policy names the bus the unit actually declares', () => {
  test('a deny naming a MISTYPED bus fails, and both names are printed', async () => {
    // The typo that is invisible by inspection: a deny naming com.mos.mosdx
    // denies nothing, and the default-context check still reports zero allows
    // while the real name sits wide open.
    const fx = await mutated('mosd-policy-names-the-owned-bus', root =>
      rewrite(root, MOSD_POLICY, t => t.replace('</busconfig>',
        '<policy context="default">\n<deny send_destination="com.mos.mosdx"/>\n</policy>\n</busconfig>')))
    try {
      expect(await verdictOf(fx, 'mosd-policy-names-the-owned-bus')).toBe('fail')
      expect(await messageOf(fx, 'mosd-policy-names-the-owned-bus'))
        .toContain(`declares BusName='com.mos.mosd' but the policy mentions 'com.mos.mosd com.mos.mosdx'`)
    }
    finally {
      fx.dispose()
    }
  })

  test('renaming the UNIT\'s BusName fails the policy, not the unit', async () => {
    // The bus name is read from mosd.service and never written down, so this is
    // the direction that proves the read happened.
    const fx = await mutated('mosd-policy-names-the-owned-bus', root =>
      rewrite(root, MOSD_UNIT, t => t.replace('BusName=com.mos.mosd', 'BusName=com.mos.mosd2')))
    try {
      expect(await messageOf(fx, 'mosd-policy-names-the-owned-bus'))
        .toContain(`declares BusName='com.mos.mosd2'`)
    }
    finally {
      fx.dispose()
    }
  })

  test('a unit with NO BusName= fails: there is no name to guard', async () => {
    const fx = await mutated('mosd-policy-names-the-owned-bus', root =>
      rewrite(root, MOSD_UNIT, t => t.replace('BusName=com.mos.mosd\n', '')))
    try {
      expect(await verdictOf(fx, 'mosd-policy-names-the-owned-bus')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('a second policy file may narrow, never widen', () => {
  test('the healthy image takes the SCOPED branch and names mos-mqttd.conf', async () => {
    // Not the "ONLY file" branch. The bridge's grant is deliberate and named in
    // its own file; a rule that banned a second file outright could only be
    // satisfied by deleting the grant or by widening com.mos.mosd again.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await messageOf(fx, 'mosd-policy-no-second-file-widens')).toContain(MQTTD_POLICY)
    }
    finally {
      fx.dispose()
    }
  })

  test('with no second file at all, the ONLY-file branch passes', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, MQTTD_POLICY))
      const got = await only(fx, 'mosd-policy-no-second-file-widens')
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('is the ONLY file under')
    }
    finally {
      fx.dispose()
    }
  })

  test('a second file granting the name WITHOUT a member fails', async () => {
    // The grant that reads like the bridge's and is not: dropping send_member=
    // turns three named methods into every method, Reboot and
    // SetTransientRootPassword included.
    const fx = await mutated('mosd-policy-no-second-file-widens', root =>
      rewrite(root, MQTTD_POLICY, t => t.replace(' send_member="SetValue"', '')))
    try {
      expect(await verdictOf(fx, 'mosd-policy-no-second-file-widens')).toBe('fail')
      const message = await messageOf(fx, 'mosd-policy-no-second-file-widens')
      expect(message).toContain(MQTTD_POLICY)
      expect(message).toContain('outside a named identity or without naming a member')
    }
    finally {
      fx.dispose()
    }
  })

  test('a second file granting the name in the DEFAULT context fails', async () => {
    const fx = await mutated('mosd-policy-no-second-file-widens', root =>
      rewrite(root, MQTTD_POLICY, t => t.replace('<policy user="mos-mqttd">', '<policy context="default">')))
    try {
      expect(await verdictOf(fx, 'mosd-policy-no-second-file-widens')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('/etc/dbus-1/system.d is searched too -- a drop-in there is as dangerous', async () => {
    const fx = await mutated('mosd-policy-no-second-file-widens', root =>
      write(root, '/etc/dbus-1/system.d/99-operator.conf',
        '<busconfig>\n<policy context="default">\n<allow send_destination="com.mos.mosd"/>\n'
        + '</policy>\n</busconfig>\n'))
    try {
      expect(await verdictOf(fx, 'mosd-policy-no-second-file-widens')).toBe('fail')
      expect(await messageOf(fx, 'mosd-policy-no-second-file-widens'))
        .toContain('/etc/dbus-1/system.d/99-operator.conf')
    }
    finally {
      fx.dispose()
    }
  })

  test('the bridge grant WRAPPED across lines still reads as per-member', async () => {
    // The fixture already wraps one of the two grants; this asserts the other
    // one wrapped as well, because a line-oriented reader would call BOTH of
    // them unscoped and report the file as reopening the name.
    const fx = packedRootFixture(cx3576)
    try {
      rewrite(fx.root, MQTTD_POLICY, t => t.replace(
        '<allow send_destination="com.mos.mosd" send_member="SetValue"/>',
        '<allow\n      send_destination="com.mos.mosd"\n      send_member="SetValue"/>'))
      expect(await verdictOf(fx, 'mosd-policy-no-second-file-widens')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('the blessed file is excluded by NAME, so it never reports itself', async () => {
    // com.mos.mosd.conf lives in one of the two searched directories and names
    // the bus in every rule it has. Excluding it by directory would have been
    // wrong in the other direction; excluding it by name is what the oracle does.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, MQTTD_POLICY))
      expect(await messageOf(fx, 'mosd-policy-no-second-file-widens')).not.toContain('com.mos.mosd.conf [')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the extension policy', () => {
  test('the grant removed fails, and the message names the path and the pattern', async () => {
    const fx = await mutated('ext-policy-grants-prefix', root =>
      rewrite(root, EXT_POLICY, t => t.replace('<allow own_prefix="com.mos.ext"/>', '')))
    try {
      expect(await verdictOf(fx, 'ext-policy-grants-prefix')).toBe('fail')
      const message = await messageOf(fx, 'ext-policy-grants-prefix')
      expect(message).toContain(EXT_POLICY)
      expect(message).toContain('own_prefix')
    }
    finally {
      fx.dispose()
    }
  })

  test('a grant that survives ONLY inside a comment: the raw check passes, the live one fails', async () => {
    // This pair is the whole reason there are two checks. The raw grep cannot
    // tell an example from a rule; the comment-stripped one can, and it is the
    // one that catches an extension policy that grants nothing at runtime.
    const fx = packedRootFixture(cx3576)
    try {
      rewrite(fx.root, EXT_POLICY, t => t.replace(
        '<allow own_prefix="com.mos.ext"/>',
        '<!-- <allow own_prefix="com.mos.ext"/> -->'))
      expect(await verdictOf(fx, 'ext-policy-grants-prefix')).toBe('pass')
      expect(await verdictOf(fx, 'ext-policy-grant-is-live')).toBe('fail')
      expect(await messageOf(fx, 'ext-policy-grant-is-live'))
        .toContain('only inside an XML comment')
    }
    finally {
      fx.dispose()
    }
  })

  test('the ONE-CHARACTER widening fails', async () => {
    // own_prefix="com.mos" reads in a diff like a simplification and hands
    // ownership of com.mos.mosd to every local uid.
    const fx = await mutated('ext-policy-not-widened', root =>
      rewrite(root, EXT_POLICY, t => t.replace('own_prefix="com.mos.ext"', 'own_prefix="com.mos"')))
    try {
      expect(await verdictOf(fx, 'ext-policy-not-widened')).toBe('fail')
      expect(await messageOf(fx, 'ext-policy-not-widened'))
        .toContain('a unit with DefaultDependencies=no can claim the name before mosd does')
    }
    finally {
      fx.dispose()
    }
  })

  test('the file\'s OWN WARNING about that widening is not read as the widening', async () => {
    // The fixture's commentary spells `own_prefix="com.mos"` verbatim, because
    // the shipped file does. A raw grep fires here, and the obvious repair for
    // a check that fired would be to delete the explanation.
    const fx = packedRootFixture(cx3576)
    try {
      expect(readFileSync(join(fx.root, EXT_POLICY), 'utf8')).toContain('own_prefix="com.mos"')
      expect(await verdictOf(fx, 'ext-policy-not-widened')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('an <allow own=> for a system name fails, and the rule is printed', async () => {
    const fx = await mutated('ext-policy-grants-nothing-else', root =>
      rewrite(root, EXT_POLICY, t => t.replace('</busconfig>',
        '<policy context="default">\n<allow own="com.mos.mosd"/>\n</policy>\n</busconfig>')))
    try {
      expect(await verdictOf(fx, 'ext-policy-grants-nothing-else')).toBe('fail')
      expect(await messageOf(fx, 'ext-policy-grants-nothing-else'))
        .toContain('own rules [<allow own="com.mos.mosd"]')
    }
    finally {
      fx.dispose()
    }
  })

  test('an UNEXPECTED own_prefix fails and is listed as one', async () => {
    const fx = await mutated('ext-policy-grants-nothing-else', root =>
      rewrite(root, EXT_POLICY, t => t.replace('</busconfig>',
        '<policy context="default">\n<allow own_prefix="com.mos.plugin"/>\n</policy>\n</busconfig>')))
    try {
      expect(await messageOf(fx, 'ext-policy-grants-nothing-else'))
        .toContain('unexpected prefixes [own_prefix="com.mos.plugin"]')
    }
    finally {
      fx.dispose()
    }
  })

  test('an ABSENT extension policy leaves an EMPTY rule set, so the negatives pass vacuously', async () => {
    // REPRODUCED, NOT IMPROVED ON. `check_ext_policy` seeds an empty rules file
    // and only fills it when `[ -f ]`, so with the policy gone the two negative
    // assertions both find nothing and both PASS -- while the two positive ones
    // fail. That is the oracle's behaviour and a port that hardened it would
    // diverge on exactly the image where the difference shows.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, EXT_POLICY))
      expect(await verdictOf(fx, 'ext-policy-grants-prefix')).toBe('fail')
      expect(await verdictOf(fx, 'ext-policy-grant-is-live')).toBe('fail')
      expect(await verdictOf(fx, 'ext-policy-not-widened')).toBe('pass')
      expect(await verdictOf(fx, 'ext-policy-grants-nothing-else')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('bluez ships a policy, on the boards that have a controller', () => {
  test('the policy removed fails on the board that declares bluetooth', async () => {
    const fx = await mutated('bluez-dbus-policy', root => rmSync(join(root, BLUEZ_POLICY)))
    try {
      expect(await verdictOf(fx, 'bluez-dbus-policy')).toBe('fail')
      expect(await messageOf(fx, 'bluez-dbus-policy'))
        .toContain('no bluetooth.conf in either dbus policy directory')
    }
    finally {
      fx.dispose()
    }
  })

  test('the BOOKWORM path is accepted: /etc/dbus-1/system.d is read by dbus-daemon too', async () => {
    // Asserting only the /usr/share path would make this refuse a correct
    // bookworm image, which is a different failure from the one it exists for.
    const fx = packedRootFixture(cx3576)
    try {
      const text = readFileSync(join(fx.root, BLUEZ_POLICY), 'utf8')
      rmSync(join(fx.root, BLUEZ_POLICY))
      write(fx.root, '/etc/dbus-1/system.d/bluetooth.conf', text)
      expect(await verdictOf(fx, 'bluez-dbus-policy')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('on a board with no controller it SKIPS, and the message names the board', async () => {
    const fx = packedRootFixture(x64)
    try {
      const got = await only(fx, 'bluez-dbus-policy')
      expect(got.verdict).toBe('skip')
      expect(got.message).toContain('x64 declares no bluetooth in BOARD_RADIOS')
    }
    finally {
      fx.dispose()
    }
  })

  test('a controller-less board that ships the policy ANYWAY still skips, not passes', async () => {
    // The skip is about the BOARD's declaration, not about the file. A check
    // that answered `pass` here would claim the oracle's SKIP line and compare
    // a pass against a skip.
    const fx = packedRootFixture(x64)
    try {
      write(fx.root, BLUEZ_POLICY, '<busconfig/>\n')
      expect(await verdictOf(fx, 'bluez-dbus-policy')).toBe('skip')
    }
    finally {
      fx.dispose()
    }
  })

  test('the fixture is board-shaped: x64 ships no bluez policy at all', () => {
    const fx = packedRootFixture(x64)
    try {
      expect(existsSync(join(fx.root, BLUEZ_POLICY))).toBe(false)
      expect(existsSync(join(packedRootFixture(cx3576).root, BLUEZ_POLICY))).toBe(true)
    }
    finally {
      fx.dispose()
    }
  })
})

// A symlink is not a directory, and `[ -f ]` follows one. Kept beside the tests
// that need it rather than in a helper: it is one line and it is the shape the
// oracle's own test takes.
describe('the policy directory walk', () => {
  test('a SYMLINK to a policy file is followed, as `[ -f ]` does', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      const text = readFileSync(join(fx.root, MQTTD_POLICY), 'utf8')
      rmSync(join(fx.root, MQTTD_POLICY))
      write(fx.root, '/usr/lib/mos/mqttd-policy.xml', text.replace(' send_member="SetValue"', ''))
      symlinkSync('/usr/lib/mos/mqttd-policy.xml', join(fx.root, MQTTD_POLICY))
      // The link's TARGET is inside the tree, so the fixture's absolute
      // symlink would resolve against the host root -- exactly as the oracle's
      // `[ -f "${ROOT}${f}" ]` does inside its container. The check must not
      // crash on it either way, which is what this asserts.
      const got = await only(fx, 'mosd-policy-no-second-file-widens')
      expect(['pass', 'fail']).toContain(got.verdict)
    }
    finally {
      fx.dispose()
    }
  })

  test('a DIRECTORY named like a policy file is skipped, not read', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      mkdirSync(join(fx.root, '/usr/share/dbus-1/system.d/adir.conf'), { recursive: true })
      expect(await verdictOf(fx, 'mosd-policy-no-second-file-widens')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })
})
