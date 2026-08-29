// Batch 4a: the D-Bus policies -- the system bus, mosd's root-only grant, the
// extension namespace, and bluez's.
//
// Eleven conclusions on each board, one of them a SKIP on x64. Everything here
// reads the unpacked root and nothing else.
//
// A policy parser and not a grep. A D-Bus rule routinely spans several source
// lines, so a line-oriented reader sees the bus name and the member on different
// lines and concludes the grant names no member -- the dangerous direction,
// because it turns a correctly scoped grant into a reported hazard whose obvious
// repair is to stop scoping it. And com.mos.ext.conf documents its own widening
// hazard in prose that names com.mos.mosd, so a reader that could not tell an
// XML comment from a rule would report the warning as an instance of the thing
// it warns about. So both of the oracle's readers are ported as readers:
// `stripComments` is `dbus_policy_rules_only` (:661), an awk state machine over
// `<!--`/`-->` that spans lines and preserves line structure; `policyTags` is
// `dbus_policy_tags` (:729), the same text reflowed to one XML tag per line,
// which is what makes a per-line scoped/member judgement sound; `policyFacts` is
// the awk at :2989, rules collected per <policy> block, because a rule's block
// decides who it applies to.
//
// The bus name is read, never written down. `com.mos.mosd` appears nowhere here
// as the name being checked: the oracle reads it out of mosd.service's
// `BusName=` (:2975) so that a policy for a name nothing owns fails rather than
// sails through. Restating it would put the constant back in two places.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import { hasRadio } from './board-scope.ts'
import { packedRoot } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { skipped, verdict } from './verdict.ts'

const MOSD_POLICY_PATH = '/usr/share/dbus-1/system.d/com.mos.mosd.conf'
const EXT_POLICY_PATH = '/usr/share/dbus-1/system.d/com.mos.ext.conf'
const MOSD_UNIT = '/usr/lib/systemd/system/mosd.service'
const POLICY_DIRS = ['/etc/dbus-1/system.d', '/usr/share/dbus-1/system.d'] as const

// reading a file the way the oracle's shell reads one

/** `cat "${ROOT}${path}" 2>/dev/null || true` -- the empty string when absent. */
function readOrEmpty(root: string, path: string): string {
  try {
    return readFileSync(join(root, path), 'utf8')
  }
  catch {
    return ''
  }
}

/** `[ -f "${ROOT}${path}" ]`: a regular file AFTER following links, as `-f` does. */
export function regularFileFollowingLinks(root: string, path: string): boolean {
  try {
    return statSync(join(root, path)).isFile()
  }
  catch {
    return false
  }
}

/**
 * `dbus_policy_rules_only`: XML comments removed.
 *
 * The state machine is the oracle's, transcribed: `incomment` persists ACROSS
 * lines, an unterminated `<!--` swallows the rest of the file, and every input
 * line still produces exactly one output line. That last property is not
 * incidental -- `check_ext_policy` runs `grep -Eo` over the result and the
 * mosd parse splits it on `<policy`, and both would read differently if the
 * stripper joined lines.
 */
export function stripXmlComments(text: string): string {
  let inComment = false
  const out: string[] = []
  for (const raw of text.split('\n')) {
    let line = raw
    let kept = ''
    while (line.length > 0) {
      if (inComment) {
        const close = line.indexOf('-->')
        if (close === -1) {
          line = ''
          break
        }
        line = line.slice(close + 3)
        inComment = false
      }
      else {
        const open = line.indexOf('<!--')
        if (open === -1) {
          kept += line
          line = ''
          break
        }
        kept += line.slice(0, open)
        line = line.slice(open + 4)
        inComment = true
      }
    }
    out.push(kept)
  }
  return out.join('\n')
}

/**
 * `dbus_policy_tags` (:729): the rules, reflowed to one XML tag per line.
 *
 * `tr '\n' ' ' | sed 's|>|>\n|g'` then a trim and a whitespace collapse, then
 * `grep .` to drop what is left empty. The trailing newline `tr` produces
 * becomes a final space, and the split leaves a tail after the last `>`; both
 * end up empty and are dropped, exactly as `grep .` drops them.
 */
export function policyTags(text: string): string[] {
  const joined = stripXmlComments(text).replaceAll('\n', ' ')
  return joined
    .split(/(?<=>)/)
    .map(s => s.replace(/^\s*/, '').replace(/\s+/g, ' '))
    .filter(s => s !== '')
}

// the mosd policy, parsed per <policy> BLOCK

export interface PolicyFacts {
  /** `<allow>` rules in a default-context block naming the bus in either direction. */
  readonly defaultAllows: number
  /** `allow own="<bus>"` under `<policy user="root">`. */
  readonly ownRoot: number
  /** ...and anywhere else. */
  readonly ownOther: number
  /** Every `com.mos.*` name any rule mentions, sorted and deduplicated. */
  readonly names: readonly string[]
}

/** `attrval` (:2990): the value of `key="..."`, or the empty string. */
function attrValue(tag: string, key: string): string {
  const at = tag.indexOf(`${key}="`)
  if (at === -1) return ''
  const rest = tag.slice(at + key.length + 2)
  const close = rest.indexOf('"')
  return close === -1 ? '' : rest.slice(0, close)
}

/**
 * The awk at :2989, transcribed.
 *
 * `doc` is built as `doc " " out` per line -- so lines are joined by a SPACE
 * and not by a newline, which is what lets a rule wrapped across three source
 * lines be read as one tag. Then the whole document is split on `<policy`, each
 * segment's attributes are what precede its first `>`, and its body is
 * truncated at `</policy>`.
 *
 * A token counts as a rule only when it begins `allow` or `deny` followed by
 * WHITESPACE, which is the oracle's `/^allow[ \t]/`: `<allowance ...>` is not a
 * rule and neither is a bare `<allow>` with no attributes.
 */
export function policyFacts(text: string, bus: string): PolicyFacts {
  const doc = stripXmlComments(text).split('\n').map(l => ` ${l}`).join('')
  const names = new Set<string>()
  let defaultAllows = 0
  let ownRoot = 0
  let ownOther = 0

  const segments = doc.split('<policy')
  for (const segment of segments.slice(1)) {
    const gt = segment.indexOf('>')
    const attrs = gt >= 0 ? segment.slice(0, gt) : segment
    let body = gt >= 0 ? segment.slice(gt + 1) : ''
    const end = body.indexOf('</policy>')
    if (end >= 0) body = body.slice(0, end)
    const isDefault = attrs.includes('context="default"')
    const isRoot = attrs.includes('user="root"')

    for (const token of body.split('<')) {
      let kind: 'allow' | 'deny'
      if (/^allow[ \t]/.test(token)) kind = 'allow'
      else if (/^deny[ \t]/.test(token)) kind = 'deny'
      else continue
      const close = token.indexOf('>')
      const tag = close >= 0 ? token.slice(0, close) : token
      const own = attrValue(tag, 'own')
      const send = attrValue(tag, 'send_destination')
      const receive = attrValue(tag, 'receive_sender')
      for (const v of [own, send, receive]) {
        if (/^com\.mos\./.test(v)) names.add(v)
      }
      if (kind === 'allow' && isDefault && (send === bus || receive === bus)) defaultAllows += 1
      if (kind === 'allow' && own === bus && own !== '') {
        if (isRoot) ownRoot += 1
        else ownOther += 1
      }
    }
  }
  // `tr ' ' '\n' | grep -v '^$' | sort -u`: the awk's own iteration order is
  // unspecified, and the shell sorts it before comparing. Sorted here for the
  // same reason -- a set compared as a string has to have one spelling.
  return { defaultAllows, ownRoot, ownOther, names: [...names].sort() }
}

/**
 * The oracle's `sed -n` for `BusName=`, with `tr -d '\r'` and `tail -n1` after it.
 *
 * The LAST such line, not the first: systemd itself takes the last assignment
 * of a key in a unit file, and a unit carrying two would otherwise be judged
 * against a value it does not use.
 */
export function mosdBusName(root: string): string {
  const lines = readOrEmpty(root, MOSD_UNIT).split('\n')
    .filter(l => l.startsWith('BusName='))
    .map(l => l.slice('BusName='.length).replace(/^[ \t]*/, '').replaceAll('\r', ''))
  return lines.at(-1) ?? ''
}

// the second-policy-file search

export interface SecondFile {
  readonly path: string
  /** The rule lines that name the bus WITHOUT being both scoped and per-member. */
  readonly unscoped: string[]
}

/**
 * Every OTHER policy file that mentions the bus name, and how it mentions it.
 *
 * The oracle walks /etc/dbus-1/system.d before /usr/share/dbus-1/system.d and
 * takes each directory's entries in shell-glob order, which is lexical; the
 * blessed file is excluded by name rather than by directory, because a second
 * file in /usr/share is exactly as dangerous as one in /etc.
 *
 * A second file is not automatically a defect and the oracle is explicit about
 * why: mos-mqttd.conf grants the bridge three named members on com.mos.mosd on
 * purpose. What must hold is that every rule naming the bus sits inside a
 * `<policy user=|group=>` block AND names a member -- judged per reflowed tag
 * line, which is what `policyTags` exists for.
 */
export function secondPolicyFiles(root: string, bus: string): SecondFile[] {
  const found: SecondFile[] = []
  if (bus === '') return found
  for (const dir of POLICY_DIRS) {
    let entries: string[]
    try {
      entries = readdirSync(join(root, dir)).sort()
    }
    catch {
      continue
    }
    for (const name of entries) {
      const path = `${dir}/${name}`
      if (path === MOSD_POLICY_PATH) continue
      // `[ -f "${f}" ]` -- the glob's own entries, so a directory is skipped.
      if (!regularFileFollowingLinks(root, path)) continue
      const tags = policyTags(readOrEmpty(root, path))
      if (!tags.some(t => t.includes(bus))) continue
      let scoped = false
      const unscoped: string[] = []
      for (const tag of tags) {
        if (tag.startsWith('<policy')) {
          scoped = tag.includes('user=') || tag.includes('group=')
          continue
        }
        if (tag.startsWith('</policy')) {
          scoped = false
          continue
        }
        if (!tag.includes(bus)) continue
        const member = tag.includes('send_member=') || tag.includes('receive_member=')
        if (!scoped || !member) unscoped.push(tag)
      }
      found.push({ path, unscoped })
    }
  }
  return found
}

// the checks

const MOSD_CHECKS: readonly CheckCase[] = [
  {
    // The system bus itself. Two files, one conclusion: rauc, mosd and bluez
    // all address each other over it, so either one missing is the same fault.
    id: 'dbus-system-bus-present',
    shell: {
      pass: 'the D-Bus system bus (dbus.service + dbus.socket) is present',
      fail: 'dbus.service and/or dbus.socket missing',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const ok = regularFileFollowingLinks(root, '/usr/lib/systemd/system/dbus.service')
        && regularFileFollowingLinks(root, '/usr/lib/systemd/system/dbus.socket')
      return [verdict(
        'dbus-system-bus-present',
        ok,
        ok
          ? 'the D-Bus system bus (dbus.service + dbus.socket) is present, so bus-activated services can run'
          : 'dbus.service and/or dbus.socket missing; rauc, mosd and bluez all address each other '
            + 'over the system bus',
      )]
    },
  },

  {
    // WHERE the policy is, not merely that a policy exists. dbus-daemon reads
    // system-bus policy from this directory and /etc/dbus-1/system.d; a policy
    // dropped anywhere else is not a stricter policy, it is NO policy.
    //
    // The test is on the file's CONTENT being non-empty, because that is what
    // `[ -n "$(cat ...)" ]` asks: a zero-byte file at the right path passes
    // every "is it there" check and governs nothing.
    id: 'mosd-policy-ships',
    shell: {
      pass: `${MOSD_POLICY_PATH} ships and is readable`,
      fail: `${MOSD_POLICY_PATH} is missing or empty`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const text = readOrEmpty(await packedRoot(ctx), MOSD_POLICY_PATH)
      const ok = text !== ''
      return [verdict(
        'mosd-policy-ships',
        ok,
        ok
          ? `${MOSD_POLICY_PATH} ships and is readable, i.e. the mosd bus policy is where dbus-daemon `
            + `actually looks for it`
          : `${MOSD_POLICY_PATH} is missing or empty. dbus-daemon reads system-bus policy from this `
            + `directory; with nothing here the base system.conf decides alone, and every local uid `
            + `can call Reboot, SetSettings and SetTransientRootPassword`,
      )]
    },
  },

  {
    // BOTH directions. send_destination is the obvious half; receive_sender is
    // the half that is easy to leave open, because SettingsChanged broadcasts
    // the settings VALUE -- a uid that may not call anything can still
    // subscribe and read access.webAdmin.password_hash.
    id: 'mosd-policy-no-default-allow',
    shell: {
      pass: 'no <policy context="default"> allows send_destination= or receive_sender= for ',
      fail: 'default-context allow rule(s) for ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const bus = mosdBusName(root)
      const facts = policyFacts(readOrEmpty(root, MOSD_POLICY_PATH), bus)
      const ok = facts.defaultAllows === 0
      return [verdict(
        'mosd-policy-no-default-allow',
        ok,
        ok
          ? `no <policy context="default"> allows send_destination= or receive_sender= for `
            + `${bus === '' ? 'the mosd bus name' : bus}, so neither calling it nor listening to its `
            + `signals is open to every local uid`
          : `the mosd D-Bus policy has ${facts.defaultAllows} default-context allow rule(s) for `
            + `${bus === '' ? 'the mosd bus name' : bus}: any local uid can call `
            + `Reboot/SetSettings/SetTransientRootPassword and/or subscribe to SettingsChanged, which `
            + `carries settings values including access.webAdmin.password_hash`,
      )]
    },
  },

  {
    // own= is what lets mosd take the name at all. At least once under root and
    // nowhere else: zero under root would mean mosd cannot own its own name,
    // and one anywhere else would let an unprivileged process take it FIRST.
    id: 'mosd-policy-own-root-only',
    shell: {
      pass: 'appears only under <policy user="root">',
      fail: 'time(s) under <policy user="root"> and ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const bus = mosdBusName(root)
      const facts = policyFacts(readOrEmpty(root, MOSD_POLICY_PATH), bus)
      const ok = facts.ownRoot !== 0 && facts.ownOther === 0
      return [verdict(
        'mosd-policy-own-root-only',
        ok,
        ok
          ? `allow own="${bus}" appears only under <policy user="root">`
          : `allow own= for '${bus}' appears ${facts.ownRoot} time(s) under <policy user="root"> and `
            + `${facts.ownOther} time(s) elsewhere; it must appear at least once under root and nowhere `
            + `else, or an unprivileged process could take the name before mosd does`,
      )]
    },
  },

  {
    // The typo that is invisible by inspection: a deny naming com.mos.mosdx
    // denies nothing, and the default-context check above would still report
    // zero allows while the real name sat wide open.
    id: 'mosd-policy-names-the-owned-bus',
    shell: {
      pass: 'the policy names exactly the bus mosd.service declares (BusName=',
      fail: 'policy/unit bus-name mismatch: ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const bus = mosdBusName(root)
      const facts = policyFacts(readOrEmpty(root, MOSD_POLICY_PATH), bus)
      const mentioned = facts.names.join(' ')
      const ok = bus !== '' && mentioned === bus
      return [verdict(
        'mosd-policy-names-the-owned-bus',
        ok,
        ok
          ? `the policy names exactly the bus mosd.service declares (BusName=${bus}); it is not a `
            + `policy for a name nothing owns`
          : `policy/unit bus-name mismatch: mosd.service declares BusName='${bus}' but the policy `
            + `mentions '${mentioned}'. A policy naming anything else guards a name nothing owns while `
            + `the real one is governed by system.conf alone`,
      )]
    },
  },

  {
    // ONE policy file, or a second one that only narrows. THREE branches and
    // two of them PASS, which is why this entry's `pass` matcher is a LIST:
    // "the only other file(s) naming X ... grant it strictly per-member" and
    // "X is the ONLY file under ..." are both green and share no substring
    // that is not also in the other's neighbours.
    id: 'mosd-policy-no-second-file-widens',
    shell: {
      pass: [
        ' -- grant it strictly per-member inside a <policy user=|group=> block',
        ' that mentions ',
      ],
      fail: 'a second D-Bus policy file grants ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const bus = mosdBusName(root)
      const others = secondPolicyFiles(root, bus)
      const dups = others.filter(f => f.unscoped.length > 0)
      const scoped = others.filter(f => f.unscoped.length === 0)
      const id = 'mosd-policy-no-second-file-widens'
      if (dups.length > 0) {
        const detail = dups.map(f => ` ${f.path} [${f.unscoped.join(' ')} ]`).join('')
        return [verdict(id, false,
          `a second D-Bus policy file grants ${bus === '' ? 'the mosd bus name' : bus} outside a named `
          + `identity or without naming a member:${detail}. dbus-daemon reads both system.d directories `
          + `and applies later rules over earlier ones, so this reinstates what ${MOSD_POLICY_PATH} `
          + `removes -- and every other policy check here would still pass`)]
      }
      if (scoped.length > 0) {
        return [verdict(id, true,
          `the only other file(s) naming ${bus} --${scoped.map(f => ` ${f.path}`).join('')} -- grant it `
          + `strictly per-member inside a <policy user=|group=> block, so nothing outside `
          + `${MOSD_POLICY_PATH} widens the name to the default context`)]
      }
      return [verdict(id, true,
        `${MOSD_POLICY_PATH} is the ONLY file under /etc/dbus-1/system.d or /usr/share/dbus-1/system.d `
        + `that mentions ${bus === '' ? 'the mosd bus name' : bus}; no second policy can override the `
        + `root-only restriction`)]
    },
  },
]

// check_ext_policy

const EXT_GRANT_RE = /allow own_prefix="com\.mos\.ext"/
const EXT_WIDE_RE = /own_prefix="com\.mos"/
const EXT_GRANT_WHAT = 'the extension D-Bus policy grants own_prefix=com.mos.ext, so extension '
  + 'services can take their bus names at all'

/** The rules half of com.mos.ext.conf: comments stripped, absence an empty file. */
function extRules(root: string): string {
  return regularFileFollowingLinks(root, EXT_POLICY_PATH)
    ? stripXmlComments(readOrEmpty(root, EXT_POLICY_PATH))
    : ''
}

const EXT_CHECKS: readonly CheckCase[] = [
  {
    // sq_grep, over the RAW file -- comments and all. The pair below is what
    // separates the rule from the commentary; this one only asks whether the
    // string is in the file at all, and the oracle asks it that way.
    id: 'ext-policy-grants-prefix',
    shell: { pass: EXT_GRANT_WHAT },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const ok = regularFileFollowingLinks(root, EXT_POLICY_PATH)
        && readOrEmpty(root, EXT_POLICY_PATH).split('\n').some(l => EXT_GRANT_RE.test(l))
      return [verdict(
        'ext-policy-grants-prefix',
        ok,
        ok
          ? EXT_GRANT_WHAT
          : `${EXT_GRANT_WHAT} — ${EXT_POLICY_PATH} missing or does not match `
            + `/${EXT_GRANT_RE.source}/`,
      )]
    },
  },

  {
    // ...and it survives comment-stripping, i.e. it is a RULE and not the
    // example markup in the file's own commentary. Without this the check
    // above passes on a policy whose only grant is inside <!-- -->, and every
    // extension unit dies at RequestName with AccessDenied.
    id: 'ext-policy-grant-is-live',
    shell: {
      pass: 'the own_prefix=com.mos.ext grant is a live rule, not text inside an XML comment',
      fail: 'mentions own_prefix=com.mos.ext only inside an XML comment',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const ok = extRules(await packedRoot(ctx)).split('\n').some(l => EXT_GRANT_RE.test(l))
      return [verdict(
        'ext-policy-grant-is-live',
        ok,
        ok
          ? 'the own_prefix=com.mos.ext grant is a live rule, not text inside an XML comment'
          : `${EXT_POLICY_PATH} mentions own_prefix=com.mos.ext only inside an XML comment. `
            + `dbus-daemon ignores comments, so no extension can own a com.mos.ext.* name and every `
            + `extension unit dies at RequestName with AccessDenied`,
      )]
    },
  },

  {
    // The one-character edit. own_prefix="com.mos" reads in a diff like a
    // simplification and actually grants ownership of com.mos.mosd to every
    // local uid -- with the root-only rules in com.mos.mosd.conf fully intact
    // and every mosd policy check above still passing, because none of them can
    // see a grant that lives in another file.
    id: 'ext-policy-not-widened',
    shell: {
      pass: 'does not grant the widened own_prefix="com.mos"',
      fail: 'grants own_prefix="com.mos", not "com.mos.ext"',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const wide = extRules(await packedRoot(ctx)).split('\n').some(l => EXT_WIDE_RE.test(l))
      return [verdict(
        'ext-policy-not-widened',
        !wide,
        wide
          ? `${EXT_POLICY_PATH} grants own_prefix="com.mos", not "com.mos.ext". That hands ownership `
            + `of com.mos.mosd to every local uid: a unit with DefaultDependencies=no can claim the `
            + `name before mosd does and apid then talks to an impostor for the rest of the boot. The `
            + `root-only rules in ${MOSD_POLICY_PATH} do not stop this -- own= is granted here`
          : `${EXT_POLICY_PATH} does not grant the widened own_prefix="com.mos"; com.mos.mosd and `
            + `every future system name stay outside the extension grant`,
      )]
    },
  },

  {
    // own_prefix="com.mos.ext" is the ONLY ownership this file may hand out. An
    // own= rule here would name a specific bus name, and the only names worth
    // naming are the system ones.
    id: 'ext-policy-grants-nothing-else',
    shell: {
      pass: 'grants exactly one thing -- own_prefix=com.mos.ext -- and no <allow own=>',
      fail: 'grants ownership beyond the extension namespace:',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const rules = extRules(await packedRoot(ctx))
      // `grep -Eo '<allow[^>]*own="[^"]*"'` and `grep -Eo 'own_prefix="[^"]*"'`,
      // each printing every match on its own line, then the second filtered by
      // `grep -Fxv` against the one blessed prefix.
      const ownGrants = [...rules.matchAll(/<allow[^>]*own="[^"]*"/g)].map(m => m[0])
      const badPrefix = [...rules.matchAll(/own_prefix="[^"]*"/g)].map(m => m[0])
        .filter(s => s !== 'own_prefix="com.mos.ext"')
      const ok = ownGrants.length === 0 && badPrefix.length === 0
      const detail = (ownGrants.length === 0 ? '' : ` own rules [${ownGrants.join('\n')}]`)
        + (badPrefix.length === 0 ? '' : ` unexpected prefixes [${badPrefix.join('\n')}]`)
      return [verdict(
        'ext-policy-grants-nothing-else',
        ok,
        ok
          ? `${EXT_POLICY_PATH} grants exactly one thing -- own_prefix=com.mos.ext -- and no `
            + `<allow own=> for any system name such as com.mos.mosd`
          : `${EXT_POLICY_PATH} grants ownership beyond the extension namespace:${detail}. Every name `
            + `outside com.mos.ext.* is a system name; granting one here opens it to every local uid on `
            + `the device while com.mos.mosd.conf's root-only rules keep passing, because they cannot `
            + `see a grant made in another file`,
      )]
    },
  },
]

// bluez's policy -- os/verify-image-v2.sh:3183 (deleted). Board-conditional.

const hasBluetooth = (board: Board): boolean => hasRadio(board, 'bluetooth')

const BLUEZ_POLICY_PATHS = [
  '/usr/share/dbus-1/system.d/bluetooth.conf',
  '/etc/dbus-1/system.d/bluetooth.conf',
] as const

const BLUEZ_CHECKS: readonly CheckCase[] = [
  {
    // BOTH directories are accepted, and that is not laxity. bluez's policy
    // moved from /etc/dbus-1/system.d to /usr/share/dbus-1/system.d between
    // bookworm and trixie -- the general relocation of VENDOR policy out of
    // /etc, which is reserved for the admin's overrides. dbus-daemon reads
    // both, so asserting only the new path would make this refuse a correct
    // bookworm image.
    //
    // ONE entry owns both directions AND the skip: the oracle's `if !
    // board_has_radio` / `elif` / `else` is one three-way branch printing
    // exactly one line per board, so a separate `-skipped` entry would have
    // nothing left to claim on the board that skips.
    id: 'bluez-dbus-policy',
    shell: {
      pass: 'bluez ships a D-Bus policy (in /usr/share/dbus-1/system.d or /etc/dbus-1/system.d)',
      fail: 'no bluetooth.conf in either dbus policy directory',
      skip: "bluez's D-Bus policy (",
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { board } = ctx
      if (!hasBluetooth(board)) {
        return [skipped('bluez-dbus-policy',
          `bluez's D-Bus policy (${board.name} declares no bluetooth in BOARD_RADIOS): there is no `
          + `bluetoothd in the image to own org.bluez, so a policy granting the name would guard nothing`)]
      }
      const root = await packedRoot(ctx)
      const ok = BLUEZ_POLICY_PATHS.some(p => regularFileFollowingLinks(root, p))
      return [verdict(
        'bluez-dbus-policy',
        ok,
        ok
          ? 'bluez ships a D-Bus policy (in /usr/share/dbus-1/system.d or /etc/dbus-1/system.d); '
            + 'without it bluetoothd cannot own org.bluez'
          : 'no bluetooth.conf in either dbus policy directory; bluetoothd cannot take org.bluez and '
            + 'every Bluetooth feature fails at runtime',
      )]
    },
  },
]

/**
 * The register's D-Bus batch.
 *
 * Only `bluez-dbus-policy` is board-conditional, and it is deliberately NOT
 * scoped by `boards:`: it applies everywhere and answers `skipped()` where the
 * board declares no controller, because the oracle's three-way branch prints
 * exactly ONE line for it on every board. `boards:` scoping is for the families
 * that print N lines on the board with the hardware and one group SKIP on the
 * board without; this is not one of them, and scoping it to the Bluetooth
 * boards would leave x64's SKIP line unclaimed forever.
 */
export const DBUS_CHECKS: readonly CheckCase[] = [
  ...MOSD_CHECKS,
  ...EXT_CHECKS,
  ...BLUEZ_CHECKS,
]

