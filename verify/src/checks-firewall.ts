// The base image's firewall TOOLS (RFCT-296/PLAN-075) -- both of them -- and
// the unit that must not run.
//
// mica-system depends on `nftables` AND `iptables`, so every image carries both
// whatever it declines. NO RULE, NO POLICY AND NOTHING THAT PERSISTS ONE is
// shipped with them, so nothing here reads a ruleset: the facts an image can be
// asked about are that each binary is reachable, that the iptables name is the
// front-end this project says it is, and that nftables.service is disabled by a
// decision rather than by an absence.
//
// WHY `packed-nft-present` IS NOT A DUPLICATE OF `container-engine-nft`, which
// also asserts nft is in the image. They are two independent statements that
// happen to share a binary, exactly as mica-podman and mica-system both declaring
// `nftables` are two statements rather than one. checks-engine.ts asks whether
// the CONTAINER ENGINE can run -- netavark execs nft by name and the first
// `podman run` fails without it -- and that check is the engine family's, board
// and profile scoped with it. This one asks whether the BASE IMAGE has its
// firewall vocabulary, which is now true of an image that declines containers
// and where the engine family has nothing to say. Deleting either because the
// other exists would leave a real hole; their matchers are disjoint on purpose
// and checks-firewall.test.ts asserts that.
//
// TWO OF THESE ARE ABOUT iptables, and the second is not decoration. On trixie
// `iptables` is an ALTERNATIVES LINK three hops from a binary --
// /usr/sbin/iptables -> /etc/alternatives/iptables -> /usr/sbin/iptables-nft ->
// xtables-nft-multi -- and the same Debian package also ships
// xtables-legacy-multi behind iptables-legacy. The two multi-call binaries
// program DIFFERENT kernel rule stores: the nft one writes nf_tables, which is
// the subsystem netavark also writes to, and the legacy one writes the old
// xtables store, which nothing else in this image touches and `nft list
// ruleset` cannot show. An image whose alternatives group had flipped would
// still hold an executable called iptables, so `packed-iptables-present` would
// be green over it, and every operator statement this project makes about the
// tool would be false. That is the failure the second check exists for.
//
// THE CHAIN IS FOLLOWED INSIDE THE ROOT, hop by hop, and that is not a nicety:
// an alternatives link's target is image-absolute, so handing it to statSync
// would ask about the VERIFIER HOST's /usr/sbin/iptables-nft. On a developer
// machine that has iptables installed, a packed root with a DANGLING
// alternatives link would then resolve, and the verdict would be about this
// machine. `script-commands.ts` re-roots the same walk for the same reason and
// says so; this module cannot reuse it because `resolvesInRoot` answers a
// boolean and both checks here have to name the chain they walked.
//
// THE FOURTH CHECK IS ABOUT A UNIT NOBODY ENABLED, and its whole point is that
// "nobody enabled it" is not the same fact as "it is disabled". The nftables
// package ships nftables.service, whose ExecStart is `nft -f
// /etc/nftables.conf`, and the config it ships begins with `flush ruleset` --
// so an enabled unit clears netavark's container-network rules at every boot.
// Before mica-system shipped 50-mos-nftables.preset, NO preset in the image
// matched that unit, and the unmatched fallback is ENABLE: measured in a clean
// trixie root, `systemctl preset nftables.service` with the stock set creates
// sysinit.target.wants/nftables.service. So the check asserts the preset
// RESOLUTION and not only the absence of a link -- a root with no link and no
// rule is one `systemctl preset-all` away from the failure, and a check that
// only counted links would call it correct.

import { existsSync, lstatSync, readlinkSync, statSync, type Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CheckCase } from './checks.ts'
import { packedRoot } from './checks-root.ts'
import type { CheckResult } from './parity.ts'
import { PRESET_DIRS, UNIT_DIRS, presetFor, wantsLinksNaming } from './unit-state.ts'
import { verdict } from './verdict.ts'

/**
 * The directories a bare command name is looked up in, in PATH order.
 *
 * An independent transcription; `checks-busybox.ts` and `script-commands.ts`
 * each keep their own. The list is the image's PATH and not this module's
 * opinion, so a copy here is a copy of a fact rather than a second definition
 * of one -- and importing another family's private constant would couple two
 * checks that have no reason to move together.
 */
const PATH_DIRS: readonly string[] = [
  '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin',
]

/**
 * The multi-call binary every name in the alternatives group must end at.
 *
 * A basename rather than a path: the Debian package puts it in /usr/sbin today,
 * and where it sits is not the fact under test -- which of the two backends the
 * front-end speaks is.
 */
const NFT_MULTI = 'xtables-nft-multi'

/** The other one, shipped by the same package and selected by nothing here. */
const LEGACY_MULTI = 'xtables-legacy-multi'

/**
 * Debian's `iptables` alternatives group: the master and its two slaves.
 *
 * All three, because `update-alternatives` can be pointed at a whole group and
 * a group can also be half-set by hand. A root where `iptables` spoke nf_tables
 * and `iptables-save` dumped the legacy store would be a device whose operator
 * cannot see the rules they just wrote, and asserting the master alone would
 * report that image green. ip6tables is a SEPARATE group and is not asserted
 * here; this change put the v4 tool in the base image and did not speak about
 * the v6 one.
 */
const GROUP: readonly string[] = ['iptables', 'iptables-save', 'iptables-restore']

/** The native front-end, and the name netavark also execs. */
const NFT_COMMAND = 'nft'

/** The unit the nftables package ships, which must never run in this image. */
const NFTABLES_UNIT = 'nftables.service'

/** Where a symlink at an image-absolute `path` points, as an image path. */
function linkTarget(root: string, path: string): string {
  const raw = readlinkSync(join(root, path))
  return raw.startsWith('/') ? raw : join(dirname(path), raw)
}

interface Resolution {
  /** The chain walked, image-absolute, first entry the PATH hit. Empty: not on PATH. */
  readonly chain: readonly string[]
  /** The last hop's stat, when the chain ended at something that exists. */
  readonly endpoint?: Stats
}

/**
 * What a bare command name resolves to in this root, following symlinks.
 *
 * Bounded at eight hops, `script-commands.ts`'s own bound: a link cycle in the
 * image is not this check's subject, and an unbounded follow would hang the run
 * rather than report one. A chain that is still a link at the eighth hop is
 * returned with no endpoint, which reads as unresolved -- correct, because a
 * name nothing can follow to a file is a name the shell cannot execute either.
 *
 * A DANGLING link is a hit, not a miss: the candidate is chosen with lstat, so
 * a broken /usr/sbin/iptables is found and then fails to resolve, which is a
 * different sentence from "iptables is not on PATH" and a different defect.
 */
function resolve(root: string, name: string): Resolution {
  const chain: string[] = []
  let at = ''
  for (const dir of PATH_DIRS) {
    const candidate = `${dir}/${name}`
    try {
      lstatSync(join(root, candidate))
      at = candidate
      break
    }
    catch {
      continue
    }
  }
  if (at === '') return { chain }
  for (let hop = 0; hop < 8; hop += 1) {
    chain.push(at)
    let st: Stats
    try {
      st = lstatSync(join(root, at))
    }
    catch {
      return { chain }
    }
    if (!st.isSymbolicLink()) return { chain, endpoint: st }
    at = linkTarget(root, at)
  }
  return { chain }
}

/** The chain as one line, `a -> b -> c`. Never empty when it is printed. */
const spell = (chain: readonly string[]): string => chain.join(' -> ')

/** The basename of the last hop, or '' for a chain that resolved nowhere. */
function endpointName(chain: readonly string[]): string {
  const last = chain[chain.length - 1]
  return last === undefined ? '' : (last.split('/').pop() ?? '')
}

export const FIREWALL_CHECKS: readonly CheckCase[] = [
  {
    // The native front-end, from the BASE image's side. mica-system names
    // nftables in Depends, and this is the assertion that the name became a
    // binary an operator can run -- on every image, including the profiles that
    // decline containers, where checks-engine.ts has nothing to say.
    //
    // The chain is followed for the same reason it is for iptables, even though
    // /usr/sbin/nft is a regular file today: a check that only stats the first
    // hit is one Debian packaging change away from resolving against the
    // verifier host, and the two front-ends deserve the same predicate.
    id: 'packed-nft-present',
    shell: {
      pass: 'nft is executable in the packed root',
      fail: 'nft is not executable in the packed root',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const { chain, endpoint } = resolve(root, NFT_COMMAND)
      if (chain.length === 0) {
        return [verdict('packed-nft-present', false,
          `nft is not executable in the packed root: no entry called ${NFT_COMMAND} is in any of `
          + `${PATH_DIRS.join(' ')}. mica-system names nftables in Depends, so an image without it `
          + 'is one where that dependency stopped being installed -- and nft is the complete view '
          + 'of the rule set, the one an operator is told to reach for first')]
      }
      if (endpoint === undefined || !endpoint.isFile()) {
        return [verdict('packed-nft-present', false,
          `nft is not executable in the packed root: ${spell(chain)} resolves to nothing inside `
          + 'the root')]
      }
      const mode = endpoint.mode & 0o777
      if ((mode & 0o111) === 0) {
        return [verdict('packed-nft-present', false,
          `nft is not executable in the packed root: ${spell(chain)} is mode `
          + `0${mode.toString(8)}. The package installed and the operator still cannot run it`)]
      }
      return [verdict('packed-nft-present', true,
        `nft is executable in the packed root: ${spell(chain)}, mode 0${mode.toString(8)}, `
        + `${endpoint.size} bytes`)]
    },
  },

  {
    // The unit that must not run, and the DECISION that keeps it from running.
    //
    // Three facts, one conclusion, because they are one decision: the unit is
    // in the root (so this says something), nothing enables it, and the shipped
    // presets RESOLVE it to disabled. The third is the one that is easy to
    // leave out and the one that matters -- an image with no link and no rule
    // is correct today and one `systemctl preset-all` away from a boot that
    // runs `nft -f /etc/nftables.conf`, whose first line is `flush ruleset`.
    id: 'packed-nftables-service-disabled',
    shell: {
      pass: 'nftables.service is disabled by a preset',
      fail: 'nftables.service is not disabled by a preset',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const unit = UNIT_DIRS
        .map(dir => `${dir}/${NFTABLES_UNIT}`)
        .find(p => existsSync(join(root, p)))
      if (unit === undefined) {
        return [verdict('packed-nftables-service-disabled', false,
          `nftables.service is not disabled by a preset: there is no ${NFTABLES_UNIT} in `
          + `${UNIT_DIRS.join(' or ')} at all, so "nothing enables it" is a statement about `
          + 'nothing -- true of an image with no nftables in it, of a root that failed to unpack, '
          + 'and of a directory that was never a root. mica-system depends on nftables, and the '
          + 'package ships this unit')]
      }
      const links = wantsLinksNaming(root, NFTABLES_UNIT)
      if (links.length > 0) {
        return [verdict('packed-nftables-service-disabled', false,
          `nftables.service is not disabled by a preset: ${links.join(' ')} enable(s) it. Its `
          + 'ExecStart is `nft -f /etc/nftables.conf` and that config opens with `flush ruleset`, '
          + 'so the unit clears netavark\'s container-network rules at every boot. mos ships the '
          + 'tools and no ruleset; nothing is meant to load one')]
      }
      const rule = presetFor(root, NFTABLES_UNIT)
      if (rule === undefined) {
        return [verdict('packed-nftables-service-disabled', false,
          `nftables.service is not disabled by a preset: no preset rule in ${PRESET_DIRS.join(' ')} `
          + `matches ${NFTABLES_UNIT}, and an unmatched unit presets to ENABLE -- measured in a `
          + 'clean trixie root, `systemctl preset nftables.service` with the stock set creates '
          + 'sysinit.target.wants/nftables.service. No link exists today, but that is an absence '
          + 'and not a decision, and one preset-all turns it into a boot that flushes the ruleset')]
      }
      if (rule.verb !== 'disable') {
        return [verdict('packed-nftables-service-disabled', false,
          `nftables.service is not disabled by a preset: the first rule that claims it is `
          + `'${rule.verb} ${rule.pattern}' in ${rule.file}. Preset rules are consulted in `
          + 'lexicographic order of basename and the first match wins, so a later `disable` line '
          + 'would never be read')]
      }
      return [verdict('packed-nftables-service-disabled', true,
        `nftables.service is disabled by a preset: ${unit} is in the root, no .wants or .requires `
        + `link names it, and the first preset rule that claims it is '${rule.verb} `
        + `${rule.pattern}' in ${rule.file}. The tool ships and no ruleset is loaded at boot`)]
    },
  },

  {
    // The dependency, from the image side. mica-system names iptables in
    // Depends; this is the assertion that the name became a binary an operator
    // can run, which is the only thing a Depends line can silently stop doing.
    //
    // Executable AND resolved, in that order of importance: a chain that ends
    // at a file with no execute bit is a package that installed and does
    // nothing, and it is the shape a hand-edited overlay produces.
    id: 'packed-iptables-present',
    shell: {
      pass: 'iptables is executable in the packed root',
      fail: 'iptables is not executable in the packed root',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const { chain, endpoint } = resolve(root, 'iptables')
      if (chain.length === 0) {
        return [verdict('packed-iptables-present', false,
          'iptables is not executable in the packed root: no entry called iptables is in any of '
          + `${PATH_DIRS.join(' ')}. mica-system names it in Depends, so an image without it is one `
          + 'where that dependency stopped being installed, and the profiles that decline '
          + 'containers have no other firewall tool at all')]
      }
      if (endpoint === undefined) {
        return [verdict('packed-iptables-present', false,
          `iptables is not executable in the packed root: ${spell(chain)} resolves to nothing `
          + 'inside the root. On trixie the name is an alternatives link, so a chain that dangles '
          + 'is a half-installed alternatives group -- and it would resolve against the verifier '
          + `host's own /usr/sbin if this walk were not re-rooted`)]
      }
      if (!endpoint.isFile()) {
        return [verdict('packed-iptables-present', false,
          `iptables is not executable in the packed root: ${spell(chain)} ends at something that `
          + 'is not a regular file')]
      }
      const mode = endpoint.mode & 0o777
      if ((mode & 0o111) === 0) {
        return [verdict('packed-iptables-present', false,
          `iptables is not executable in the packed root: ${spell(chain)} is mode `
          + `0${mode.toString(8)}. The package installed and the operator still cannot run it`)]
      }
      return [verdict('packed-iptables-present', true,
        `iptables is executable in the packed root: ${spell(chain)}, mode 0${mode.toString(8)}, `
        + `${endpoint.size} bytes`)]
    },
  },

  {
    // WHICH iptables. The alternatives group has to land on the nf_tables
    // front-end, all three names of it, because that is the claim the operator
    // documentation makes: rules written here go into the same kernel subsystem
    // netavark programs, so `nft list ruleset` shows them and `iptables -S`
    // shows the operator's own. A group pointed at the legacy multi-call breaks
    // both halves of that sentence while leaving an executable iptables in the
    // image, so nothing else in the register would notice.
    //
    // The legacy binary being PRESENT is not a fault and is not asserted away:
    // the Debian package ships it and this image removes nothing. What is
    // asserted is that nothing selects it.
    id: 'packed-iptables-nft-backend',
    shell: {
      pass: 'the iptables alternatives group is the nf_tables front-end',
      fail: 'the iptables alternatives group is not the nf_tables front-end',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const resolved = GROUP.map(name => ({ name, ...resolve(root, name) }))
      const faults = resolved
        .filter(r => r.endpoint === undefined || endpointName(r.chain) !== NFT_MULTI)
        .map(r => (r.chain.length === 0
          ? `${r.name} is not on PATH`
          : `${r.name} ends at ${endpointName(r.chain) === '' ? 'nothing' : endpointName(r.chain)} `
            + `(${spell(r.chain)})`))
      // DEDUPED BY INODE, because this root is usr-merged: /sbin is a symlink
      // to usr/sbin, so a plain sweep of PATH_DIRS reports
      // "/usr/sbin/xtables-legacy-multi /sbin/xtables-legacy-multi" and reads
      // as two legacy binaries in an image that has one.
      const seen = new Set<string>()
      const legacy: string[] = []
      for (const dir of PATH_DIRS) {
        const path = `${dir}/${LEGACY_MULTI}`
        try {
          const st = statSync(join(root, path))
          if (!st.isFile()) continue
          const identity = `${st.dev}:${st.ino}`
          if (seen.has(identity)) continue
          seen.add(identity)
          legacy.push(path)
        }
        catch {
          continue
        }
      }
      if (faults.length > 0) {
        return [verdict('packed-iptables-nft-backend', false,
          `the iptables alternatives group is not the nf_tables front-end: ${faults.join('; ')}. `
          + `Every one of ${GROUP.join(', ')} has to end at ${NFT_MULTI}: the legacy multi-call `
          + 'programs the old xtables rule store, which is a DIFFERENT set of kernel rules from '
          + `the nf_tables ones netavark writes and which 'nft list ruleset' cannot show. A group `
          + 'that flipped, or half-flipped, leaves an operator writing rules into a store nothing '
          + 'else in this image can see')]
      }
      return [verdict('packed-iptables-nft-backend', true,
        `the iptables alternatives group is the nf_tables front-end: all of ${GROUP.join(', ')} `
        + `end at ${NFT_MULTI}, so a rule written here goes into the same nf_tables subsystem `
        + `netavark programs. ${legacy.length === 0
          ? `${LEGACY_MULTI} is not in the image at all`
          : `${legacy.join(' ')} ships beside it, from the same Debian package, and nothing `
            + 'resolves to it'}`)]
    },
  },
]
