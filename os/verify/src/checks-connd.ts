// Batch 4a: the connd contract, the Wi-Fi userland, and mosd's networkd namespace.
//
// PLAN-014 M4f (RFCT-110). Twenty-two conclusions on cx3576 and four on x64 --
// the contract read (:1030), the nineteen assertions it feeds (:4310-4432, all
// of them behind `board_has_radio wifi`), and the two namespace conclusions
// that run on every board (:1066, :4441).
//
// ═══ THIS FILE READS mosd/ SOURCES, AND THAT IS THE POINT ═══
//
// Every path, prefix and unit name the Wi-Fi assertions compare against is READ
// out of `mosd/mosd/src/reconciler/` rather than restated here, exactly as the
// oracle reads it. Reading those sources is in scope under PLAN-014:220-223;
// changing them is not, and nothing here writes.
//
// A constant restated in two places drifts, and THIS drift is invisible from the
// code side: a reconciler that renders into a directory the image does not
// provide, or drives a unit the image does not install, fails on the device and
// nowhere else.
//
// ═══ AND THE EXTRACTOR ITSELF ROTTED ONCE, WHICH IS WHY THERE IS NO FALLBACK ═══
//
// The oracle records it (:994): the sweep marker was read with a regex over
// `file_name.contains("...")`, network.rs was refactored to an anchored
// `is_mos_managed()` using starts_with/ends_with, the regex stopped matching,
// and the marker became "". TWO things followed and both looked like results.
// The collision test was `case "${n}" in *"${MOS_SWEEP}"*)`, which with an empty
// marker is `**` and matched every filename -- eight image .network files
// reported as colliding with a sweep that would never have touched them. And
// the nineteen assertions below fell back to hardcoded defaults through
// `${STA_UNIT:-wpa_supplicant@.service}` and PASSED, comparing the image against
// the verifier's own restatement of a contract it had just failed to read.
//
// So: no `?? 'wpa_supplicant@.service'` anywhere in this file. An unread
// contract makes the group fail rather than substitute, the sweep is a PREFIX
// matched with an anchor, and the `.network` suffix is ASSERTED rather than
// assumed -- a marker read out of a `starts_with` that had lost its `ends_with`
// would describe a wider sweep than the code performs.
//
// ═══ WHY THE MATCHERS ARE GENERATED AT MODULE LOAD ═══
//
// `wpa_supplicant@.service` is not written down here either, so the register
// entry that claims `/usr/lib/systemd/system/wpa_supplicant@.service is a
// regular file` has to be BUILT from the contract -- at module load, the way
// M4d builds the boot-slot entries from each board's own declaration. The
// oracle reads the contract once per run and so does this; if the read fails,
// the generated matcher is the same degenerate string the oracle then prints,
// which is the behaviour that keeps the two sides comparable even when the
// contract is unreadable.

import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import { boardsWhere, hasRadio } from './board-scope.ts'
import { regularFileFollowingLinks } from './checks-dbus.ts'
import { unitValue } from './checks-engine.ts'
import { entry, ETC_UNITS, packedRoot, wantsLink } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { REPO_ROOT } from './paths.ts'
import { skipped, verdict } from './verdict.ts'

/**
 * Where the reconcilers are read from.
 *
 * `MOS_VERIFY_RECONCILER_DIR` exists so a test can point this at a MUTATED copy
 * and watch the read fail -- without it the rot recorded above could not be
 * driven, only waited for. The oracle honours the same variable (:1015) and
 * `os/tests/ui-location-test.sh` is its one caller.
 */
export const RECONCILER_DIR: string = process.env['MOS_VERIFY_RECONCILER_DIR']
  ?? join(REPO_ROOT, 'mosd', 'mosd', 'src', 'reconciler')

export interface ConndContract {
  readonly staDir: string
  readonly apDir: string
  readonly staUnit: string
  readonly apUnit: string
  readonly staConf: string
  readonly apConf: string
  readonly staPrefix: string
  readonly apPrefix: string
  readonly sweep: string
  readonly sweepSuffix: string
  /** Every field non-empty AND the suffix exactly `.network`, as the oracle tests. */
  readonly read: boolean
}

function sourceLines(dir: string, file: string): string[] {
  try {
    return readFileSync(join(dir, file), 'utf8').split('\n')
  }
  catch {
    return []
  }
}

/** `awk 'NR == 1'` over a `sed -n ... p` -- the FIRST match, or the empty string. */
function firstCapture(lines: readonly string[], pattern: RegExp): string {
  for (const line of lines) {
    const m = pattern.exec(line)
    if (m?.[1] !== undefined) return m[1]
  }
  return ''
}

/** `const NAME: &str = "...";` at the start of a line. */
function mosdConst(dir: string, file: string, name: string): string {
  return firstCapture(sourceLines(dir, file), new RegExp(`^const ${name}: &str = "(.*)";$`))
}

/** The unit TEMPLATE behind `format!("x@{interface}.service")`. */
function mosdUnitTemplate(dir: string, file: string): string {
  const stem = firstCapture(sourceLines(dir, file), /^ *format!\("(.*)@\{interface\}\.service"\)$/)
  return stem === '' ? '' : `${stem}@.service`
}

/** The rendered configuration file name, still carrying `{interface}`. */
function mosdConfigName(dir: string, file: string): string {
  return firstCapture(sourceLines(dir, file), /^ *format!\("([^"]*\{interface\}[^"]*\.conf)"\)$/)
}

/**
 * The contract, or a record of having failed to read it.
 *
 * `read` is the oracle's own ten-way conjunction (:1053): every field non-empty
 * AND the sweep suffix exactly `.network`. The suffix is compared rather than
 * merely required to be present, because a marker read out of a `starts_with`
 * whose `ends_with` had changed would describe a wider sweep than the code
 * performs -- and the collision test below would then delete files network.rs
 * would never touch.
 */
export function readConndContract(dir: string): ConndContract {
  const staDir = mosdConst(dir, 'wifi_client.rs', 'DEFAULT_CONFIG_DIR')
  const apDir = mosdConst(dir, 'wifi_ap.rs', 'DEFAULT_CONFIG_DIR')
  const staUnit = mosdUnitTemplate(dir, 'wifi_client.rs')
  const apUnit = mosdUnitTemplate(dir, 'wifi_ap.rs')
  const staConf = mosdConfigName(dir, 'wifi_client.rs')
  const apConf = mosdConfigName(dir, 'wifi_ap.rs')
  const staPrefix = mosdConst(dir, 'wifi_client.rs', 'NETWORKD_PREFIX')
  const apPrefix = mosdConst(dir, 'wifi_ap.rs', 'NETWORKD_PREFIX')
  const network = sourceLines(dir, 'network.rs')
  const sweep = firstCapture(network, /.*file_name\.starts_with\("([^"]*)"\).*/)
  const sweepSuffix = firstCapture(network, /.*file_name\.ends_with\("([^"]*)"\).*/)
  const read = [staDir, apDir, staUnit, apUnit, staConf, apConf, staPrefix, apPrefix, sweep]
    .every(v => v !== '') && sweepSuffix === '.network'
  return { staDir, apDir, staUnit, apUnit, staConf, apConf, staPrefix, apPrefix, sweep, sweepSuffix, read }
}

/**
 * The contract, read ONCE for this process, exactly as the oracle reads it once
 * per run. The matchers below are generated from it.
 */
export const CONTRACT: ConndContract = readConndContract(RECONCILER_DIR)

const hasWifi = (board: Board): boolean => hasRadio(board, 'wifi')
const WIFI_BOARDS = boardsWhere(hasWifi)
const NO_WIFI_BOARDS = boardsWhere(b => !hasWifi(b))

// ---------------------------------------------------------------------------
// the contract read itself
// ---------------------------------------------------------------------------

function contractMessage(c: ConndContract): string {
  return c.read
    ? `read the connd contract out of mosd: ${c.staUnit} <- ${c.staDir}/${c.staConf}, ${c.apUnit} <- `
      + `${c.apDir}/${c.apConf}, networkd prefixes '${c.staPrefix}'/'${c.apPrefix}', sweep `
      + `'${c.sweep}'*'${c.sweepSuffix}'`
    : `could not read the connd contract out of ${RECONCILER_DIR}: dirs '${c.staDir}'/'${c.apDir}', `
      + `units '${c.staUnit}'/'${c.apUnit}', configs '${c.staConf}'/'${c.apConf}', prefixes `
      + `'${c.staPrefix}'/'${c.apPrefix}', sweep '${c.sweep}'+'${c.sweepSuffix}'. Every connd assertion `
      + `below compares against these. They no longer fall back to hardcoded defaults, so they FAIL `
      + `from here on rather than passing against the verifier's own restatement of a contract it `
      + `could not read — see the empty-marker rot recorded above the extractor`
}

const CONTRACT_CHECK: CheckCase = {
  id: 'connd-contract-read',
  shell: {
    pass: 'read the connd contract out of mosd: ',
    fail: 'could not read the connd contract out of ',
  },
  run: async (): Promise<readonly CheckResult[]> => {
    // Re-read rather than reuse CONTRACT: the value the matchers were built
    // from is what the oracle would print, and this is the check that says
    // whether that read succeeded. Reading it again costs three small files and
    // makes the check about the sources rather than about module-load order.
    const contract = readConndContract(RECONCILER_DIR)
    return [verdict('connd-contract-read', contract.read, contractMessage(contract))]
  },
}

// ---------------------------------------------------------------------------
// the Wi-Fi userland, on the boards that declare a radio
// ---------------------------------------------------------------------------

/** `sq_regular`, scoped to the Wi-Fi boards. */
function wifiRegularFile(id: string, path: string): CheckCase {
  return {
    id,
    boards: WIFI_BOARDS,
    shell: { pass: `${path} is a regular file`, fail: `${path} missing or not a regular file` },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const st = entry(await packedRoot(ctx), path)
      const ok = st !== undefined && st.isFile()
      return [verdict(id, ok, ok ? `${path} is a regular file` : `${path} missing or not a regular file`)]
    },
  }
}

/**
 * `check_execstart` (:4325): the unit's command line and the reconciler's render
 * path are ONE contract.
 *
 * BOTH systemd instance specifiers are accepted -- `%i` escaped and `%I`
 * unescaped. For a plain interface name they are the same string, and which one
 * the packager chose is not this repo's business. Measured on the real images:
 * hostapd@.service uses `%i` and wpa_supplicant@.service uses `%I`, so a port
 * that accepted only one would fail one of the two on a correct image.
 */
function execStartCheck(input: { id: string, what: string, unit: string, dir: string, name: string }): CheckCase {
  const { id, what, dir, name } = input
  const unit = `/usr/lib/systemd/system/${input.unit}`
  const base = input.unit
  return {
    id,
    boards: WIFI_BOARDS,
    shell: {
      pass: `${what}: ${base} reads `,
      fail: [
        `${what}: ${unit} is not in the image, so mosd would drive a unit that does not exist`,
        `${what}: ${base}'s ExecStart does not name `,
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      if (!regularFileFollowingLinks(root, unit)) {
        return [verdict(id, false,
          `${what}: ${unit} is not in the image, so mosd would drive a unit that does not exist`)]
      }
      const execLines = readFileSync(join(root, unit), 'utf8').split('\n').filter(l => l.includes('ExecStart='))
      for (const spec of ['%i', '%I']) {
        const want = `${dir}/${name.replaceAll('{interface}', spec)}`
        if (execLines.some(l => l.includes(want))) {
          return [verdict(id, true,
            `${what}: ${base} reads ${want}, which is exactly what the reconciler renders`)]
        }
      }
      return [verdict(id, false,
        `${what}: ${base}'s ExecStart does not name ${dir}/${name} (with %i or %I); it is `
        + `'${execLines.join(' ')} '. The unit and the reconciler disagree about the config path, so `
        + `the daemon starts against a file nothing writes`)]
    },
  }
}

/** mosd owns the template's lifecycle: a statically enabled instance would race it. */
function notStaticallyEnabled(id: string, unit: string): CheckCase {
  return {
    id,
    boards: WIFI_BOARDS,
    shell: {
      pass: `${unit} is installed but NOT statically enabled (mosd owns the lifecycle)`,
      fail: `${unit} is statically enabled in the image;`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const enabled = wantsLink(root, ['/etc/systemd/system', '/usr/lib/systemd/system'], unit) !== undefined
      return [verdict(
        id,
        !enabled,
        enabled
          ? `${unit} is statically enabled in the image; mosd owns that lifecycle and would race the `
            + `image's own instance`
          : `${unit} is installed but NOT statically enabled (mosd owns the lifecycle)`,
      )]
    },
  }
}

/**
 * The packages' own non-templated units: MASKED, not merely disabled.
 *
 * Masking is the only form that also blocks the D-Bus activation path
 * wpasupplicant ships
 * (/usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service). On v2 the
 * mask lives inside the signed read-only root, so it cannot be undone on device.
 */
function maskedCheck(unit: string): CheckCase {
  const id = `wifi-masked-${unit}`
  return {
    id,
    boards: WIFI_BOARDS,
    shell: {
      pass: `${unit} is masked (-> /dev/null);`,
      fail: `${unit} is not masked (it is '`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      // `readlink`, not `readlink -f`: the RAW target. A mask is the literal
      // string /dev/null, and resolving the link would answer about the device
      // node rather than about the unit.
      let dest = ''
      try {
        dest = readlinkSync(join(root, '/etc/systemd/system', unit))
      }
      catch { /* not a symlink, or not there at all */ }
      const ok = dest === '/dev/null'
      return [verdict(
        id,
        ok,
        ok
          ? `${unit} is masked (-> /dev/null); it cannot start and fight mosd for the radio`
          : `${unit} is not masked (it is '${dest === '' ? 'not a symlink to /dev/null' : dest}'). The `
            + `package enables it, and it starts a second daemon on the same radio against a config `
            + `mosd never writes while mosd's own instance still reports healthy`,
      )]
    },
  }
}

/** ...and the package postinst's enablement symlink is gone with it. */
function noPostinstWants(unit: string): CheckCase {
  const id = `wifi-no-postinst-wants-${unit}`
  return {
    id,
    boards: WIFI_BOARDS,
    shell: {
      pass: `${unit} carries no enablement symlink from the package postinst`,
      fail: `${unit} still carries the package's *.wants enablement symlink`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const enabled = wantsLink(root, ['/etc/systemd/system', '/usr/lib/systemd/system'], unit) !== undefined
      return [verdict(
        id,
        !enabled,
        enabled
          ? `${unit} still carries the package's *.wants enablement symlink`
          : `${unit} carries no enablement symlink from the package postinst`,
      )]
    },
  }
}

/** `${where#/}` with every `/` turned into `-`, plus `.mount` -- the oracle's own escape. */
export function mountUnitFor(where: string): string {
  return `${where.replace(/^\//, '').replaceAll('/', '-')}.mount`
}

/**
 * A reconciler render target: bound, from STATE, and ENABLED.
 *
 * The v2 root is a read-only dm-verity squashfs, so a reconciler rendering into
 * a read-only path fails on the device and nowhere else. The BACKING is
 * asserted, not just that the directory exists -- and the enablement separately,
 * because M4 shipped units that were installed and never enabled.
 */
function renderTargetBind(id: string, where: string): CheckCase {
  const unit = mountUnitFor(where)
  const unitPath = `/etc/systemd/system/${unit}`
  return {
    id,
    boards: WIFI_BOARDS,
    shell: {
      pass: `${where} is a STATE-backed bind via ${unit} (`,
      fail: [
        `${where} is a reconciler render target but ${unit} does not exist;`,
        `${unit} does not mount ${where} (its Where= is '`,
        `${unit} is not backed by STATE (What= must be under /mnt/state); a tmpfs or nothing at all`,
        `${unit} exists but is not enabled; ${where} would stay on the read-only squashfs`,
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      if (!regularFileFollowingLinks(root, unitPath)) {
        return [verdict(id, false,
          `${where} is a reconciler render target but ${unit} does not exist; on the read-only verity `
          + `root the render would fail on device and nowhere else`)]
      }
      const lines = readFileSync(join(root, unitPath), 'utf8').split('\n')
      // `grep -qx "Where=${where}"` -- the WHOLE line.
      if (!lines.includes(`Where=${where}`)) {
        return [verdict(id, false,
          `${unit} does not mount ${where} (its Where= is '${unitValue(root, unitPath, 'Where=')}')`)]
      }
      if (!lines.some(l => /^What=\/mnt\/state\//.test(l))) {
        return [verdict(id, false,
          `${unit} is not backed by STATE (What= must be under /mnt/state); a tmpfs or nothing at all `
          + `would lose every configured network on reboot`)]
      }
      if (wantsLink(root, ETC_UNITS, unit) === undefined) {
        return [verdict(id, false,
          `${unit} exists but is not enabled; ${where} would stay on the read-only squashfs`)]
      }
      return [verdict(id, true,
        `${where} is a STATE-backed bind via ${unit} (${unitValue(root, unitPath, 'What=')}), so the `
        + `reconciler can write there and the result survives an A/B update`)]
    },
  }
}

/**
 * The bind SOURCE, which mount(8) does not create -- and its MODE.
 *
 * mos-seed-state is the only thing that runs early enough, and the assertion is
 * in two halves because the seed creates both directories from ONE loop: the
 * loop does `mkdir -p` and `chmod 0700` under /mnt/state, and THIS directory's
 * name is one of the loop's items. Either half alone would pass for a script
 * that created the other directory twice.
 *
 * 0700 because both directories hold a pre-shared key in the clear once a device
 * is configured -- the supplicant config carries every network's PSK and the
 * hostapd config carries the AP key.
 */
function seedStateCreates(id: string, where: string): CheckCase {
  const unit = mountUnitFor(where)
  const unitPath = `/etc/systemd/system/${unit}`
  const seed = '/usr/lib/mos/mos-seed-state'
  return {
    id,
    boards: WIFI_BOARDS,
    shell: {
      pass: ` at 0700 before ${unit} is attempted`,
      fail: `; the bind would have no source on first boot and ${where} would stay read-only`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const src = unitValue(root, unitPath, 'What=')
      const base = src === '' ? 'none' : (src.split('/').at(-1) ?? '')
      const text = regularFileFollowingLinks(root, seed) ? readFileSync(join(root, seed), 'utf8') : undefined
      const loopItems = text === undefined
        ? []
        : text.split('\n')
          .flatMap(l => /^for d in (.*); do$/.exec(l)?.[1]?.split(' ') ?? [])
      const ok = src !== '' && text !== undefined
        && text.includes('mkdir -p "/mnt/state/$d"')
        && text.includes('chmod 0700 "/mnt/state/$d"')
        && loopItems.includes(base)
      return [verdict(
        id,
        ok,
        ok
          ? `mos-seed-state creates ${src} at 0700 before ${unit} is attempted`
          : `mos-seed-state does not create ${src} (0700); the bind would have no source on first boot `
            + `and ${where} would stay read-only`,
      )]
    },
  }
}

const DNSMASQ_CHECK: CheckCase = {
  // The AP's DHCP server is systemd-networkd's own DHCPServer=yes. dnsmasq would
  // be a second package and a second lifecycle for a job already done -- and a
  // second DHCP server on the same link is a conflict, not a fallback.
  id: 'wifi-no-dnsmasq',
  boards: WIFI_BOARDS,
  shell: {
    pass: 'no dnsmasq in the image (the AP\'s DHCP server is systemd-networkd\'s own DHCPServer=yes)',
    fail: 'dnsmasq ships in the image;',
  },
  run: async (ctx): Promise<readonly CheckResult[]> => {
    const root = await packedRoot(ctx)
    // `[ -e ]`, which FOLLOWS a link -- so a dangling /usr/sbin/dnsmasq reads as
    // absent here. Reproduced rather than tightened: the oracle's answer is the
    // one the two sides must agree on.
    const present = existsSync(join(root, '/usr/sbin/dnsmasq'))
    return [verdict(
      'wifi-no-dnsmasq',
      !present,
      present
        ? 'dnsmasq ships in the image; the provisioning AP hands out addresses through '
          + 'systemd-networkd\'s DHCPServer=yes and a second DHCP server on the same link is a '
          + 'conflict, not a fallback'
        : 'no dnsmasq in the image (the AP\'s DHCP server is systemd-networkd\'s own DHCPServer=yes)',
    )]
  },
}

/**
 * The group SKIP, on a board that declares no Wi-Fi.
 *
 * ONE shell line covers all nineteen assertions above, so it needs a register
 * entry of its own -- scoped to the complement of the same derived predicate the
 * nineteen are scoped by, computed from the shipped definitions at module load.
 */
const WIFI_SKIPPED: CheckCase = {
  id: 'wifi-userland-skipped',
  boards: NO_WIFI_BOARDS,
  shell: { skip: 'the Wi-Fi userland (hostapd, wpa_supplicant, their unit templates,' },
  run: async (ctx): Promise<readonly CheckResult[]> => [skipped(
    'wifi-userland-skipped',
    `the Wi-Fi userland (hostapd, wpa_supplicant, their unit templates, the ExecStart/render-path `
    + `contract, the masking of the packages' own units, the STATE-backed binds for the two config `
    + `directories, and the absence of dnsmasq): ${ctx.board.name} declares no wifi in BOARD_RADIOS, `
    + `so there is no radio for a station or an access point to run on and the image ships neither daemon`,
  )],
}

// ---------------------------------------------------------------------------
// the image's networkd namespace, on EVERY board
// ---------------------------------------------------------------------------

const NETWORK_DIRS = [
  '/etc/systemd/network', '/usr/lib/systemd/network', '/run/systemd/network',
] as const

/** The BASENAMES of every `*.network` under the three trees, deduplicated and sorted. */
function imageNetworkFiles(root: string): string[] {
  const names = new Set<string>()
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    }
    catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      }
      catch { /* dangling; find still reports the entry */ }
      if (isDir) {
        walk(full)
        continue
      }
      if (name.endsWith('.network')) names.add(name)
    }
  }
  for (const d of NETWORK_DIRS) walk(join(root, d))
  return [...names].sort()
}

const NAMESPACE_CHECK: CheckCase = {
  // network.rs DELETES every file matching its own prefix that it did not
  // render, and the two Wi-Fi reconcilers deliberately sit outside that pattern.
  // An image file in either namespace would be swept away, or would SHADOW a
  // reconciler's unit, on the device and nowhere else.
  id: 'networkd-namespace-clear',
  shell: {
    pass: "the image's networkd namespace is clear of mosd's:",
    fail: [
      "the image's networkd namespace check did not run:",
      "the image's networkd namespace is empty:",
      "the image's networkd namespace collides with a reconciler-owned one:",
    ],
  },
  run: async (ctx): Promise<readonly CheckResult[]> => {
    const id = 'networkd-namespace-clear'
    const contract = readConndContract(RECONCILER_DIR)
    if (!contract.read) {
      return [verdict(id, false,
        `the image's networkd namespace check did not run: the connd contract is unread, so there is `
        + `no namespace to compare against. It previously ran anyway with an empty marker, which made `
        + `its glob match every filename and reported eight collisions that could not happen`)]
    }
    const root = await packedRoot(ctx)
    const files = imageNetworkFiles(root)
    const collisions: string[] = []
    for (const n of files) {
      // ANCHORED, matching is_mos_managed(). The unanchored `*marker*` this
      // replaced is what turned an empty marker into eight false positives.
      if (n.startsWith(contract.sweep) && n.endsWith(contract.sweepSuffix)) {
        collisions.push(` ${n}(swept-by-network.rs)`)
      }
      else if (n.startsWith(contract.staPrefix)) collisions.push(` ${n}(station-namespace)`)
      else if (n.startsWith(contract.apPrefix)) collisions.push(` ${n}(ap-namespace)`)
    }
    if (files.length === 0) {
      return [verdict(id, false,
        `the image's networkd namespace is empty: it ships no .network file at all, so this check `
        + `would pass vacuously`)]
    }
    if (collisions.length === 0) {
      return [verdict(id, true,
        `the image's networkd namespace is clear of mosd's: none of (${files.join(' ')} ) falls in a `
        + `reconciler-owned namespace ('${contract.sweep}'*'${contract.sweepSuffix}', `
        + `'${contract.staPrefix}', '${contract.apPrefix}')`)]
    }
    return [verdict(id, false,
      `the image's networkd namespace collides with a reconciler-owned one:${collisions.join('')}. A `
      + `(swept-by-network.rs) file is DELETED on the reconciler's first pass — it renders `
      + `${contract.sweep}*${contract.sweepSuffix} and removes every other file matching that shape. A `
      + `(station-namespace) or (ap-namespace) file instead SHADOWS the unit a WiFi reconciler renders `
      + `for that interface, since networkd applies the first match in lexical order`)]
  },
}

const DHCP_DEFAULT = '80-dhcp.network'

const SORT_ORDER_CHECK: CheckCase = {
  // networkd applies the FIRST matching unit in lexical order across its
  // directories, so the image's fallback has to sort BEFORE the reconcilers'
  // units. Compared as STRINGS, not assumed from the numbers.
  //
  // Each prefix is compared with the image's file INDEPENDENTLY: the two
  // reconciler prefixes have no ordering requirement between themselves (they
  // never match the same interface), so requiring the three to be sorted as one
  // list would be a check about the wrong property.
  id: 'networkd-fallback-sorts-first',
  shell: {
    pass: ` sorts before both '`,
    fail: ` does not sort before:`,
  },
  run: async (): Promise<readonly CheckResult[]> => {
    const id = 'networkd-fallback-sorts-first'
    const contract = readConndContract(RECONCILER_DIR)
    const bad: string[] = []
    for (const prefix of [contract.staPrefix, contract.apPrefix]) {
      if (prefix === '') {
        bad.push(' <unreadable>')
        continue
      }
      // `printf '%s\n' A B | LC_ALL=C sort | head -1` -- a BYTE comparison, which
      // is what networkd's own ordering is and what `localeCompare` is not.
      if ([DHCP_DEFAULT, prefix].sort()[0] !== DHCP_DEFAULT) bad.push(` ${prefix}`)
    }
    return [verdict(
      id,
      bad.length === 0,
      bad.length === 0
        ? `${DHCP_DEFAULT} sorts before both '${contract.staPrefix}' and '${contract.apPrefix}', so a `
          + `reconciler-rendered unit is never shadowed by the image's fallback`
        : `${DHCP_DEFAULT} does not sort before:${bad.join('')}; networkd applies the first match in `
          + `lexical order, so the image's fallback would win over the unit mosd rendered for that interface`,
    )]
  },
}

// ---------------------------------------------------------------------------
// the register entries, generated from the contract
// ---------------------------------------------------------------------------

export const CONND_CHECKS: readonly CheckCase[] = [
  CONTRACT_CHECK,
  wifiRegularFile('wifi-hostapd-binary', '/usr/sbin/hostapd'),
  wifiRegularFile('wifi-supplicant-binary', '/usr/sbin/wpa_supplicant'),
  wifiRegularFile('wifi-station-unit', `/usr/lib/systemd/system/${CONTRACT.staUnit}`),
  wifiRegularFile('wifi-ap-unit', `/usr/lib/systemd/system/${CONTRACT.apUnit}`),
  execStartCheck({
    id: 'wifi-station-execstart',
    what: 'station',
    unit: CONTRACT.staUnit,
    dir: CONTRACT.staDir,
    name: CONTRACT.staConf,
  }),
  execStartCheck({
    id: 'wifi-ap-execstart',
    what: 'access point',
    unit: CONTRACT.apUnit,
    dir: CONTRACT.apDir,
    name: CONTRACT.apConf,
  }),
  notStaticallyEnabled('wifi-station-template-not-enabled', CONTRACT.staUnit),
  notStaticallyEnabled('wifi-ap-template-not-enabled', CONTRACT.apUnit),
  ...['hostapd.service', 'wpa_supplicant.service', 'dbus-fi.w1.wpa_supplicant1.service']
    .flatMap(u => [maskedCheck(u), noPostinstWants(u)]),
  renderTargetBind('wifi-station-config-bind', CONTRACT.staDir),
  seedStateCreates('wifi-station-config-seeded', CONTRACT.staDir),
  renderTargetBind('wifi-ap-config-bind', CONTRACT.apDir),
  seedStateCreates('wifi-ap-config-seeded', CONTRACT.apDir),
  DNSMASQ_CHECK,
  WIFI_SKIPPED,
  NAMESPACE_CHECK,
  SORT_ORDER_CHECK,
]
