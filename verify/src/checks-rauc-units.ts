// The one lever that would invert the rollback guard's premise, asserted OVER
// THE SHIPPED UNITS.
//
// `rauc --override-boot-slot BOOTNAME` tells RAUC that a different slot is the
// booted one. RAUC's `determine_slot_states` labels `ST_BOOTED` the slot
// matching `r_context()->bootslot` and `ST_INACTIVE` everything else, and
// `select_inactive_slot_class_member` then picks the install target out of the
// inactive set -- so pointing that option at the other slot makes the RUNNING
// slot the target. The whole precondition of the guarded rollback derives from
// the opposite: `older_install` / `rollback_eligibility` in
// pkgs/mosd/mosd/src/rauc.rs read "the booted slot was installed after the
// target" as "the device successfully booted the target", which is only sound
// while an install never writes the running slot. docs/design/recovery.md
// §3 node 2 records the reading and the recipe to re-run it at a pin bump.
//
// WHY THIS CHECK AND NOT A GREP FOR THE STRING IN THE IMAGE. The string
// `override-boot-slot` IS present in the shipped `/usr/bin/rauc`, once, with
// its help text: `entries_install` compiles the option in only under
// `#if ENABLE_SERVICE == 0` (`src/main.c`) and pkgs/rauc/Dockerfile builds
// `-Dservice=true`, so it is compiled out of the INSTALL SUBCOMMAND, not out of
// the binary. It survives on `entries_service`, the daemon's own argv. An
// assertion that the string is absent from the image would therefore be false
// about a correct image. What can be asserted, and what actually matters, is
// that nothing on the device ever PASSES it.
//
// WHY NOT A `-Dservice=true` GREP OVER pkgs/rauc/Dockerfile. Two reasons, and
// both are about what a check is for. It would be a source-text grep for a
// meson argument, so it goes red on a reformat that changes nothing. And the
// failure it would catch is LOUD: with `service=false` there is no D-Bus daemon
// at all, so mosd's `InstallBundle` fails on the first install and every route
// above it reports it. A unit that passed `--override-boot-slot` is the SILENT
// one -- every other gate in this tree stays green while the guard's derivation
// is inverted underneath it -- and that is the failure a check earns its place
// by catching.
//
// WHY THE EMPTY CASE IS A FAILURE. This is an "is X absent?" assertion, and
// those pass for free over a tree that was never read: a packed root with no
// unit directories, or a walk that stopped matching, reports the same green as
// an image whose units are all clean. So the search space is COUNTED, and a run
// that found no rauc command line at all is red with its own sentence. The
// shipped root always carries one -- upstream's `rauc.service`, whose
// `ExecStart=/usr/bin/rauc --mount=/run/rauc/mnt service` passes no such flag.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { entry, packedRoot } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import { verdict } from './verdict.ts'

/** The option, without its dashes: `--override-boot-slot` and `--override-boot-slot=A` both carry it. */
const OPTION = 'override-boot-slot'

/**
 * The unit trees a packed root may carry.
 *
 * The admin tree is walked although the image ships it EMPTY -- it is the
 * mountpoint for /mnt/state/systemd-units, so at pack time there is nothing in
 * it and at run time it is operator content this image cannot speak for. A unit
 * baked into it by a build would be shipped state, and this is where that would
 * be seen.
 */
const UNIT_TREES = [
  '/etc/systemd/system',
  '/usr/lib/systemd/system',
  '/usr/local/lib/systemd/system',
] as const

/** `ExecStart=`, `ExecStartPre=`, `ExecStop=`, `ExecCondition=` -- every one of them. */
const EXEC_KEY = /^Exec[A-Za-z]*=/

/** The characters systemd allows in front of an Exec command: `@`, `-`, `:`, `+`, `!`. */
const EXEC_PREFIX = /^[@\-:+!]+/

/**
 * Every regular file under the unit trees, drop-ins included, as `/`-rooted paths.
 *
 * Symlinks are SKIPPED rather than followed, and that is not an optimisation:
 * `multi-user.target.wants/rauc.service` is a link to the unit file this walk
 * already reads where it lives, so following it would report one offending unit
 * twice under two names, and a dangling one would be an unreadable path in the
 * middle of an image assertion. A drop-in that is a symlink is not a shape this
 * image ships; if one appeared, the file it points at is either inside a tree
 * walked here or is not part of the units this image claims to carry.
 */
function unitFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let names: readonly string[]
    try {
      names = readdirSync(join(root, dir)).sort()
    }
    catch {
      // A tree that is not in this image. Absence of a directory is not a
      // finding here; absence of EVERY rauc command line is, and that is
      // counted by the caller.
      return
    }
    for (const name of names) {
      const path = `${dir}/${name}`
      const st = entry(root, path)
      if (st === undefined || st.isSymbolicLink()) continue
      if (st.isDirectory()) walk(path)
      else if (st.isFile()) out.push(path)
    }
  }
  for (const tree of UNIT_TREES) walk(tree)
  return out
}

/**
 * The `Exec*=` values in one unit's text, continuation lines folded in.
 *
 * A unit may wrap its command line with a trailing backslash, and a reader that
 * took only the first fragment would miss an option on the second -- which is
 * exactly where a long `ExecStart` puts its flags. The fold joins with a space
 * so two tokens cannot be run together into one.
 */
function execCommands(text: string): string[] {
  const out: string[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const first = lines[i] ?? ''
    if (!EXEC_KEY.test(first)) continue
    let folded = first
    while (folded.endsWith('\\') && i + 1 < lines.length) {
      i += 1
      folded = `${folded.slice(0, -1)}${(lines[i] ?? '').trim()}`
    }
    out.push(folded.slice(folded.indexOf('=') + 1).trim())
  }
  return out
}

/**
 * Whether a command line starts rauc.
 *
 * Every token is considered and not just the executable, because
 * `ExecStart=/bin/sh -c 'rauc ...'` starts rauc as surely as
 * `ExecStart=/usr/bin/rauc` does, and a reader that looked only at argv[0]
 * would answer "no rauc here" about it. `rauc-` covers the wrappers on the
 * activation path -- `/usr/libexec/rauc-service.sh` is what the D-Bus service
 * file execs -- so a flag added to one of those is seen too.
 */
function namesRauc(command: string): boolean {
  return command
    .split(/\s+/)
    .filter(token => token !== '')
    .some((token, index) => {
      const bare = (index === 0 ? token.replace(EXEC_PREFIX, '') : token).replace(/^['"]|['"]$/g, '')
      const base = basename(bare)
      return base === 'rauc' || base.startsWith('rauc-')
    })
}

export const RAUC_UNIT_CHECKS: readonly CheckCase[] = [
  {
    id: 'rauc-units-never-override-boot-slot',
    shell: {
      pass: 'no shipped unit passes --override-boot-slot',
      fail: [
        'a shipped unit passes --override-boot-slot',
        'no shipped unit starts rauc at all',
      ],
    },
    run: async (ctx) => {
      const root = await packedRoot(ctx)
      const offenders: string[] = []
      let raucCommands = 0
      for (const path of unitFiles(root)) {
        for (const command of execCommands(readFileSync(join(root, path), 'latin1'))) {
          if (!namesRauc(command)) continue
          raucCommands += 1
          if (command.includes(OPTION)) offenders.push(`${path}: ${command}`)
        }
      }
      if (offenders.length > 0) {
        return [verdict(
          'rauc-units-never-override-boot-slot',
          false,
          `a shipped unit passes --override-boot-slot: ${offenders.join(' ; ')}. That option `
          + `relabels which slot RAUC believes is booted, so the install target can become the `
          + `RUNNING slot -- and the rollback guard in pkgs/mosd/mosd/src/rauc.rs derives its whole `
          + `precondition from an install never writing it. Every other gate stays green while the `
          + `derivation is inverted.`,
        )]
      }
      if (raucCommands === 0) {
        return [verdict(
          'rauc-units-never-override-boot-slot',
          false,
          `no shipped unit starts rauc at all, across ${UNIT_TREES.join(', ')}. This assertion is `
          + `"the option is passed nowhere", which an empty search space satisfies for free, so an `
          + `unread unit tree is reported here rather than as a pass. The shipped root carries `
          + `upstream's rauc.service.`,
        )]
      }
      return [verdict(
        'rauc-units-never-override-boot-slot',
        true,
        `no shipped unit passes --override-boot-slot: ${raucCommands} unit command line(s) start `
        + `rauc and none names the option, so nothing on this device tells RAUC that the wrong slot `
        + `is booted. The string is in /usr/bin/rauc -- it is compiled out of the install subcommand `
        + `under -Dservice=true, not out of the binary -- so the units are what can be asserted.`,
      )]
    },
  },
]
