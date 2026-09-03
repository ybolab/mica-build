// The base image's firewall TOOL (RFCT-296/PLAN-075), and which of the two
// front-ends in the Debian package it actually is.
//
// mos-system depends on `iptables`, so every image carries it whatever it
// declines -- which is the whole change. NO RULE, NO POLICY AND NOTHING THAT
// PERSISTS ONE is shipped with it, so there is nothing here that reads a
// ruleset: the only facts an image can be asked about are that the binary is
// reachable and that it is the front-end this project says it is.
//
// TWO CHECKS, and the second is not decoration. On trixie `iptables` is an
// ALTERNATIVES LINK three hops from a binary --
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

import { lstatSync, readlinkSync, statSync, type Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CheckCase } from './checks.ts'
import { packedRoot } from './checks-root.ts'
import type { CheckResult } from './parity.ts'
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

export const IPTABLES_CHECKS: readonly CheckCase[] = [
  {
    // The dependency, from the image side. mos-system names iptables in
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
          + `${PATH_DIRS.join(' ')}. mos-system names it in Depends, so an image without it is one `
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
