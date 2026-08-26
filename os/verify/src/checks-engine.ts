// Batch 4a: the container engine, the package-manager purge, and the trust store.
//
// PLAN-014 M4f (RFCT-110). Fifteen conclusions on each board -- ten from
// `check_container_engine` (:1191), four from `check_no_package_manager`
// (:1112) and one from `check_ca_bundle` (:3498). Three families in one module
// because all three are the same act read from three sides: what the pack stage
// PUT IN the root, what it TOOK OUT, and what it GENERATED on the way through.
//
// ═══ THE ONE SHAPE THIS REGISTER CANNOT EXPRESS, MEASURED AND RECORDED ═══
//
// `check_container_engine` opens with an early return:
//
//     if [ ! -e podman ] && [ ! -e storage.conf ]; then
//         pass "this image carries no container engine at all ..."
//         return
//     fi
//
// -- so a WITH_CONTAINERS=0 image prints ONE conclusion where a normal image
// prints ten, and the oracle's own words for the other nine are "skipped BY
// IDENTITY rather than passing vacuously". The register has no way to say "this
// check does not exist on this image": a dedicated entry owning that one line
// would report `unfired` on both shipped boards, which is exit 1, and the nine
// suppressed checks have no shell line to be compared against whatever they
// answer.
//
// So: `container-engine-installed` owns BOTH sentences (a `pass` matcher list),
// and the other nine answer `skipped()` when there is no engine. On a
// WITH_CONTAINERS=0 image that would produce nine `orphan` rows. NEITHER SHIPPED
// BOARD PRODUCES THAT SHAPE -- both carry podman -- and it is written down here
// rather than papered over, because a limitation nobody recorded is one the next
// batch rediscovers as a bug.
//
// ═══ WHY THE UNIT SEARCH EXCLUDES *.wants/* ═══
//
// On purpose, not by oversight, and the oracle says so: an enablement symlink is
// the NEXT check's subject and a dangling one can exist with no unit file behind
// it. Two checks that both fire on one mutation say less than two that each name
// a distinct way the engine could start.

import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync, statSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { entry, packedRoot } from './checks-root.ts'
import { regularFileFollowingLinks } from './checks-dbus.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { skipped, verdict } from './verdict.ts'

// The oracle's own constants (:1173-1189), in its own order -- the message
// prints them and a reordering here would diverge on message alone.
const CONTAINER_STORAGE_CONF = '/etc/containers/storage.conf'
const CONTAINER_BINARIES = [
  '/usr/bin/podman', '/usr/bin/crun', '/usr/libexec/podman/conmon',
  '/usr/libexec/podman/netavark', '/usr/libexec/podman/aardvark-dns',
  '/usr/libexec/podman/catatonit', '/usr/libexec/podman/quadlet',
] as const
const CONTAINER_POLICY = '/etc/containers/policy.json'
const CONTAINER_CONF = '/etc/containers/containers.conf'
const CONTAINER_REGISTRIES = '/etc/containers/registries.conf'
const CONTAINER_NFT = '/usr/sbin/nft'
const QUADLET_GENERATOR = '/usr/lib/systemd/system-generators/podman-system-generator'
const QUADLET_DIR = '/etc/containers/systemd'
const QUADLET_MOUNT_UNIT = 'etc-containers-systemd.mount'

const UNIT_TREES = ['/etc/systemd', '/usr/lib/systemd', '/usr/local/lib/systemd'] as const
const ENABLEMENT_TREES = ['/etc/systemd/system', '/usr/lib/systemd/system'] as const

// ---------------------------------------------------------------------------
// the walks `find` performs, spelled once
// ---------------------------------------------------------------------------

/** `[ -e "${ROOT}${path}" ]`: exists, FOLLOWING a link -- a dangling one is absent. */
function existsFollowingLinks(root: string, path: string): boolean {
  try {
    statSync(join(root, path))
    return true
  }
  catch {
    return false
  }
}

/**
 * Every path at or under `trees` for which `keep` holds, root-relative and sorted.
 *
 * LSTAT, never stat: `find` without `-L` does not follow a symlink, reports the
 * LINK rather than its target, and does not descend through one. A `.wants`
 * entry is a symlink into another tree and a DANGLING one is a real shape --
 * `-e` alone would call it absent and pass on exactly the image that failed --
 * so a walk that followed links would both miss it and report the wrong path.
 */
function findUnder(
  root: string,
  trees: readonly string[],
  keep: (relative: string, name: string, stats: Stats) => boolean,
): string[] {
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
      let st: Stats
      try {
        st = lstatSync(full)
      }
      catch {
        continue
      }
      const relative = full.slice(root.length)
      if (keep(relative, name, st)) found.push(relative)
      if (st.isDirectory()) walk(full)
    }
  }
  for (const tree of trees) walk(join(root, tree))
  return found.sort()
}

// ---------------------------------------------------------------------------
// the container engine
// ---------------------------------------------------------------------------

/** The oracle's early-return guard (:1196): NEITHER podman nor storage.conf. */
function noEngineAtAll(root: string): boolean {
  return !existsFollowingLinks(root, '/usr/bin/podman')
    && !existsFollowingLinks(root, CONTAINER_STORAGE_CONF)
}

const NO_ENGINE_MESSAGE = 'this image carries no container engine at all (no podman, no storage.conf): '
  + 'a WITH_CONTAINERS=0 board, and the assertions that follow are skipped BY IDENTITY rather than '
  + 'passing vacuously'

/**
 * A check that exists only when the image carries an engine.
 *
 * The `skipped()` is the register's nearest available answer to "the oracle did
 * not run this at all", and it is reached only on an image neither shipped board
 * produces. See the header.
 */
function engineCheck(input: {
  id: string
  shell: CheckCase['shell']
  decide: (root: string, ctx: ImageContext) => Promise<CheckResult> | CheckResult
}): CheckCase {
  return {
    id: input.id,
    shell: input.shell,
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      if (noEngineAtAll(root)) {
        return [skipped(input.id,
          `${input.id}: this image carries no container engine, so os/verify-image-v2.sh returns `
          + `before reaching this assertion and prints nothing for it`)]
      }
      return [await input.decide(root, ctx)]
    },
  }
}

const ENGINE_CHECKS: readonly CheckCase[] = [
  {
    // The one entry that owns BOTH of the oracle's opening sentences. See the
    // header for why a dedicated entry for the absent-engine line cannot work.
    id: 'container-engine-installed',
    shell: {
      pass: [
        'the container engine is in the image: podman, crun, conmon',
        'this image carries no container engine at all',
      ],
      fail: 'the container engine is incomplete:',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      if (noEngineAtAll(root)) {
        return [verdict('container-engine-installed', true, NO_ENGINE_MESSAGE)]
      }
      const missing = [...CONTAINER_BINARIES, QUADLET_GENERATOR]
        .filter(b => !regularFileFollowingLinks(root, b))
      return [verdict(
        'container-engine-installed',
        missing.length === 0,
        missing.length === 0
          ? 'the container engine is in the image: podman, crun, conmon, netavark, aardvark-dns, '
            + 'quadlet and its systemd generator'
          : `the container engine is incomplete:${missing.map(m => ` ${m}`).join('')} missing. `
            + `PLAN-012 ships the engine installed and inert; a partial install is a switch that `
            + `turns on nothing`,
      )]
    },
  },

  engineCheck({
    // NO podman units, at all. The engine is inert because nothing can start
    // it, not because seven symlinks point at /dev/null -- podman is built from
    // source here, so upstream's contrib/ units are never installed and
    // podman.socket is not masked, it does not exist.
    id: 'container-engine-no-units',
    shell: {
      pass: 'the image contains no podman systemd unit of any name',
      fail: 'the image contains podman systemd units:',
    },
    decide: (root) => {
      const units = findUnder(root, UNIT_TREES, (relative, name) =>
        name.startsWith('podman')
        && name !== 'podman-system-generator'
        && !/\.wants\//.test(relative))
      return verdict(
        'container-engine-no-units',
        units.length === 0,
        units.length === 0
          ? 'the image contains no podman systemd unit of any name; the engine is inert by '
            + 'construction rather than by masking, so there is no mask list to keep in step with '
            + 'upstream'
          : `the image contains podman systemd units:${units.join(' ')} . os/podman `
            + `does not run 'make install.systemd', so anything named podman* under a unit directory `
            + `arrived by a path nobody intended -- and podman.socket in particular is `
            + `SOCKET-ACTIVATED, so being disabled is not enough`,
      )
    },
  }),

  engineCheck({
    // Reached by EXEC, so no NEEDED-soname check can see it. It was missing from
    // the image RFCT-101/102 shipped, which passed every assertion this file
    // then had.
    id: 'container-engine-nft',
    shell: {
      pass: 'nft is in the image; netavark 2.x has no iptables driver',
      fail: 'nft is not in the image.',
    },
    decide: (root) => {
      const ok = regularFileFollowingLinks(root, CONTAINER_NFT)
        || regularFileFollowingLinks(root, '/usr/bin/nft')
      return verdict(
        'container-engine-nft',
        ok,
        ok
          ? 'nft is in the image; netavark 2.x has no iptables driver (its FirewallImpl enum is '
            + 'Firewalld/Nftables/Fwnone) and execs nft by name off PATH, so without this binary '
            + 'every container network setup fails'
          : 'nft is not in the image. netavark execs it by name (nftables crate, NFT_EXECUTABLE = '
            + '"nft") to build every container network, and there is no fallback: the iptables driver '
            + 'was REMOVED in netavark 2.x. The device boots, the engine reports healthy, and the '
            + `first 'podman run' fails with 'unable to execute nft'`,
      )
    },
  }),

  engineCheck({
    // A third invisible category, after the exec'd nft: podman DLOPENS
    // libsystemd.so.0 by name for journald logging, so it appears in no NEEDED
    // list and ldd cannot see it. Losing it does not fail -- it loses logs.
    id: 'container-engine-libsystemd',
    shell: {
      pass: 'libsystemd.so.0 is in the image; podman dlopens it by name',
      fail: 'libsystemd.so.0 is not in the image.',
    },
    decide: (root) => {
      // `find "${ROOT}/usr/lib" -name libsystemd.so.0 -print -quit`: anywhere
      // under /usr/lib, at any depth, because the multiarch triplet follows the
      // board and naming the directory would make this an arm64 assertion.
      const found = findUnder(root, ['/usr/lib'], (_relative, name) => name === 'libsystemd.so.0')
      const ok = found.length > 0
      return verdict(
        'container-engine-libsystemd',
        ok,
        ok
          ? 'libsystemd.so.0 is in the image; podman dlopens it by name for journald logging, which '
            + 'is a dependency neither a NEEDED list nor ldd can report'
          : 'libsystemd.so.0 is not in the image. podman DLOPENS it for journald logging, so nothing '
            + 'in the link-time or loader checks above can see this missing -- and with '
            + 'log_driver=journald the symptom is container logs quietly going nowhere, not an error',
      )
    },
  }),

  engineCheck({
    // storage.conf is NOT in this list though it is equally mos's own: it has
    // its own assertion below, which reports where the graphroot POINTS rather
    // than merely that a file exists. Checking it in both places would mean one
    // missing file produced two failures.
    id: 'container-engine-config-files',
    shell: {
      pass: 'mos ships its own policy.json, containers.conf, registries.conf and storage.conf',
      fail: 'container configuration is incomplete:',
    },
    decide: (root) => {
      const missing = [CONTAINER_POLICY, CONTAINER_CONF, CONTAINER_REGISTRIES]
        .filter(f => !regularFileFollowingLinks(root, f))
      return verdict(
        'container-engine-config-files',
        missing.length === 0,
        missing.length === 0
          ? 'mos ships its own policy.json, containers.conf, registries.conf and storage.conf; the '
            + `distribution's containers-common is not installed, so these four files are the whole `
            + 'of the engine\'s configuration'
          : `container configuration is incomplete:${missing.map(m => ` ${m}`).join('')} missing. `
            + `containers-common is not installed to supply a fallback, and podman does not fail on `
            + `an absent config file -- it uses a built-in default nobody chose`,
      )
    },
  }),

  engineCheck({
    // A second config layer under /usr/share supplies settings that reading
    // /etc does not reveal: podman reads it BEFORE /etc and merges.
    id: 'container-engine-single-config-layer',
    shell: {
      pass: 'there is no /usr/share/containers/containers.conf',
      fail: '/usr/share/containers/containers.conf exists.',
    },
    decide: (root) => {
      const present = existsFollowingLinks(root, '/usr/share/containers/containers.conf')
      return verdict(
        'container-engine-single-config-layer',
        !present,
        present
          ? '/usr/share/containers/containers.conf exists. podman reads it BEFORE '
            + '/etc/containers/containers.conf and merges, so an operator reading /etc sees only half '
            + 'the configuration'
          : 'there is no /usr/share/containers/containers.conf; /etc is the only layer, so what mos '
            + 'configured is what reading one file shows',
      )
    },
  }),

  engineCheck({
    // The default helper_binaries_dir begins with two directories under
    // /usr/local, a prefix this image makes PARTIALLY WRITABLE (PLAN-011 D5).
    // Pinned, not searched.
    id: 'container-engine-helper-dir-pinned',
    shell: {
      pass: 'containers.conf pins helper_binaries_dir to /usr/libexec/podman',
      fail: 'containers.conf does not pin helper_binaries_dir.',
    },
    decide: (root) => {
      const ok = grepLines(root, CONTAINER_CONF)
        .some(l => /^helper_binaries_dir *= *\["\/usr\/libexec\/podman"\]/.test(l))
      return verdict(
        'container-engine-helper-dir-pinned',
        ok,
        ok
          ? "containers.conf pins helper_binaries_dir to /usr/libexec/podman; podman's built-in "
            + 'default searches /usr/local/libexec/podman and /usr/local/lib/podman FIRST, and '
            + '/usr/local on this image is a prefix with a STATE-backed writable subtree'
          : 'containers.conf does not pin helper_binaries_dir. The default (config_linux.go:24) '
            + 'searches /usr/local/libexec/podman and /usr/local/lib/podman before the image\'s own '
            + '/usr/libexec/podman, and mos deliberately makes part of /usr/local writable from STATE',
      )
    },
  }),

  engineCheck({
    // The OTHER way a unit starts. A unit file that does not exist cannot be
    // enabled -- but a dangling *.wants symlink can, and it is a real shape:
    // `-e` alone would call it absent and pass on exactly the image that failed.
    id: 'container-engine-not-enabled',
    shell: {
      pass: 'no podman unit carries an enablement symlink',
      fail: 'podman units carry an enablement symlink in the image:',
    },
    decide: (root) => {
      // `-path '*.wants/podman*'`: anything after `podman`, slashes included.
      const enabled = findUnder(root, ENABLEMENT_TREES, relative => relative.includes('.wants/podman'))
      return verdict(
        'container-engine-not-enabled',
        enabled.length === 0,
        enabled.length === 0
          ? 'no podman unit carries an enablement symlink; the engine is inert in the shipped image'
          : `podman units carry an enablement symlink in the image:${enabled.join(' ')} . `
            + `The device would run containers before anyone asked, which is the opposite of `
            + `PLAN-012's default-off switch`,
      )
    },
  }),

  engineCheck({
    // The failure is not an error message: containers work, and then one day
    // the partition resets and every pulled image is gone.
    //
    // FOUR fail branches and one pass, and the fail matcher is a LIST because
    // they fork: "no storage.conf at all", "sets no graphroot", "on the
    // EPHEMERAL partition" and "neither DATA nor a path this check knows".
    id: 'container-engine-graphroot-on-data',
    shell: {
      pass: ', on DATA -- the only growable partition',
      fail: [
        'container image storage is unconfigured:',
        ', on the EPHEMERAL partition.',
        ', which is neither DATA (/srv) nor a path this check knows.',
      ],
    },
    decide: (root) => {
      const id = 'container-engine-graphroot-on-data'
      const present = regularFileFollowingLinks(root, CONTAINER_STORAGE_CONF)
      // `sed -n 's/^ *graphroot *= *"\(.*\)"/\1/p' | tail -n1`: the LAST such
      // line, because that is the one a later assignment in the same file wins
      // with -- and the greedy `\(.*\)` takes everything up to the final quote.
      const graph = present
        ? grepLines(root, CONTAINER_STORAGE_CONF)
          .map(l => /^ *graphroot *= *"(.*)"/.exec(l)?.[1])
          .filter((v): v is string => v !== undefined)
          .at(-1) ?? ''
        : ''
      if (!present) {
        return verdict(id, false,
          `container image storage is unconfigured: no ${CONTAINER_STORAGE_CONF} in the image, so `
          + `podman falls back to its built-in default of /var/lib/containers/storage. /var is the `
          + `EPHEMERAL partition: 512 MiB and wiped by design, so every pulled image is both `
          + `size-capped and destined to vanish without any error being reported`)
      }
      if (graph === '') {
        return verdict(id, false,
          `container image storage is unconfigured: ${CONTAINER_STORAGE_CONF} sets no graphroot, so `
          + `podman uses its built-in /var/lib/containers/storage on the wipeable EPHEMERAL partition`)
      }
      if (graph.startsWith('/srv/')) {
        return verdict(id, true,
          `container image storage is at ${graph}, on DATA -- the only growable partition, and the `
          + `one that survives an A/B update`)
      }
      if (graph.startsWith('/var/')) {
        return verdict(id, false,
          `container image storage is at ${graph}, on the EPHEMERAL partition. /var is 512 MiB and `
          + `wiped by design; images would be capped and then silently destroyed`)
      }
      return verdict(id, false,
        `container image storage is at ${graph}, which is neither DATA (/srv) nor a path this check `
        + `knows. Image storage grows without bound and belongs on the partition systemd-repart extends`)
    },
  }),

  engineCheck({
    // The Quadlet directory has to be writable and persistent, or the operator
    // cannot install a container at all: `quadlet --dryrun` reads /run, /etc and
    // /usr/share under containers/systemd, of which /run is tmpfs and the other
    // two are inside the read-only squashfs.
    //
    // AND IT MUST NOT BE STATICALLY ENABLED. That branch is the one with teeth:
    // the bind would come up at every boot whatever container.enabled says,
    // Quadlet would generate units from STATE and they would start, so anything
    // able to write /mnt/state/quadlet gets a root-capable container at the next
    // reboot with no operator decision anywhere in the path.
    id: 'container-engine-quadlet-bind',
    shell: {
      pass: ' is a STATE-backed bind via etc-containers-systemd.mount (What=',
      fail: [
        `${QUADLET_MOUNT_UNIT} is not in the image,`,
        `${QUADLET_MOUNT_UNIT} mounts '`,
        `${QUADLET_MOUNT_UNIT} is backed by '`,
        `${QUADLET_MOUNT_UNIT} is STATICALLY ENABLED.`,
      ],
    },
    decide: (root) => {
      const id = 'container-engine-quadlet-bind'
      const unit = `/etc/systemd/system/${QUADLET_MOUNT_UNIT}`
      const present = regularFileFollowingLinks(root, unit)
      const where = unitValue(root, unit, 'Where=')
      const what = unitValue(root, unit, 'What=')
      if (!present) {
        return verdict(id, false,
          `${QUADLET_MOUNT_UNIT} is not in the image, so ${QUADLET_DIR} stays on the read-only `
          + `squashfs. Quadlet reads /run, /etc and /usr/share under containers/systemd and nothing `
          + `else: /run is tmpfs and the other two are in the verity root, so an operator has NOWHERE `
          + `to install a container that survives a reboot`)
      }
      if (where !== QUADLET_DIR) {
        return verdict(id, false,
          `${QUADLET_MOUNT_UNIT} mounts '${where}', not ${QUADLET_DIR} — which is the only one of `
          + `Quadlet's three search directories an operator can be given`)
      }
      if (!what.startsWith('/mnt/state/')) {
        return verdict(id, false,
          `${QUADLET_MOUNT_UNIT} is backed by '${what}', not STATE. Installed containers would not `
          + `survive an A/B update`)
      }
      // `[ -L ... ]`: a SYMLINK, whether or not it dangles. A static enablement
      // whose target had been deleted would still bring the bind up.
      if (entry(root, `/etc/systemd/system/local-fs.target.wants/${QUADLET_MOUNT_UNIT}`)
        ?.isSymbolicLink() === true) {
        return verdict(id, false,
          `${QUADLET_MOUNT_UNIT} is STATICALLY ENABLED. The bind then comes up at every boot whatever `
          + `container.enabled says, Quadlet generates units from STATE, and they start — so anything `
          + `able to write /mnt/state/quadlet gets a root-capable container at the next reboot with no `
          + `operator decision anywhere in the path, and PLAN-012's switch gates nothing. mosd's `
          + `ContainerReconciler enables it at runtime when the setting is true`)
      }
      return verdict(id, true,
        `${QUADLET_DIR} is a STATE-backed bind via ${QUADLET_MOUNT_UNIT} (What=${what}), installed `
        + `and NOT statically enabled — mosd brings it up only when container.enabled is true, which `
        + `is what makes the switch mean anything at boot`)
    },
  }),
]

// ---------------------------------------------------------------------------
// check_no_package_manager -- os/verify-image-v2.sh:1112
// ---------------------------------------------------------------------------

const PKGMGR_BINARIES = [
  '/usr/bin/dpkg', '/usr/bin/dpkg-query', '/usr/bin/dpkg-deb', '/usr/bin/apt',
  '/usr/bin/apt-get', '/usr/bin/apt-cache', '/usr/bin/apt-key', '/usr/bin/perl',
] as const
// /var is relocated to /usr/share/factory/var by the pack stage, so the dpkg
// database is looked for in BOTH places: an image that kept it under the factory
// tree would restore it onto /var on the first boot, and a check that only
// looked at /var would report a clean root that repopulates itself.
const PKGMGR_TREES = [
  '/var/lib/dpkg', '/var/lib/apt', '/etc/apt', '/usr/lib/apt',
  '/usr/share/factory/var/lib/dpkg', '/usr/share/factory/var/lib/apt',
] as const

const PURGE_CHECKS: readonly CheckCase[] = [
  {
    // THE TIMERS, not just the binaries. apt-daily.timer,
    // apt-daily-upgrade.timer and dpkg-db-backup.timer are enabled by their
    // packages and survive a purge that only removes /usr/bin/apt -- they then
    // fire daily on a device with no package manager and fail daily. Found by
    // booting the x64 image, in an arm64 image that had already shipped.
    id: 'purge-no-package-timers',
    shell: {
      pass: 'no apt or dpkg systemd timer is in the image',
      fail: 'package-management timers are in the image:',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const timers = findUnder(root, ['/etc/systemd', '/usr/lib/systemd'], (_r, name) =>
        name.startsWith('apt-daily') || name.startsWith('dpkg-db-backup'))
      return [verdict(
        'purge-no-package-timers',
        timers.length === 0,
        timers.length === 0
          ? 'no apt or dpkg systemd timer is in the image; removing the package manager\'s binaries '
            + 'does not remove its timers, and those fire daily whether or not anything is left for '
            + 'them to run'
          : `package-management timers are in the image:${timers.join(' ')} . Each is `
            + `enabled by its package, fires daily, and fails daily on a root with no apt and no dpkg `
            + `— journal noise shaped exactly like a real fault`,
      )]
    },
  },

  {
    // `[ -e ]` for a binary and `[ -d ]` for a tree, in the oracle's own order:
    // the binaries first, then the state directories, each appended with a
    // trailing slash so the message says which kind it found.
    id: 'purge-no-package-manager',
    shell: {
      pass: 'the packed root carries no package manager: none of ',
      fail: 'the packed root still carries package management:',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const found = [
        ...PKGMGR_BINARIES.filter(b => existsFollowingLinks(root, b)).map(b => ` ${b}`),
        ...PKGMGR_TREES.filter(d => isDirectoryFollowingLinks(root, d)).map(d => ` ${d}/`),
      ]
      return [verdict(
        'purge-no-package-manager',
        found.length === 0,
        found.length === 0
          ? `the packed root carries no package manager: none of ${PKGMGR_BINARIES.join(' ')} and no `
            + `dpkg/apt state, in /var or under the factory tree`
          : `the packed root still carries package management:${found.join('')}. The root is a `
            + `read-only dm-verity squashfs and updates arrive as whole RAUC slots, so nothing here `
            + `can install a package — but anyone who reaches a shell now has the tool to try, and it `
            + `is ~21 MB of weight that cannot be used`,
      )]
    },
  },

  {
    // ...and the purge stopped where the licences begin. This is the half a
    // size-driven cleanup gets wrong, and it fails silently: nobody notices a
    // missing copyright file until a redistribution question is asked.
    id: 'purge-licences-survived',
    shell: {
      pass: 'the licence texts survived the purge: ',
      fail: 'copyright files are left under /usr/share/doc',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      // `find ... -name copyright -type f`: -type f FOLLOWS nothing and matches
      // a regular file only, so a symlinked copyright does not count.
      const n = findUnder(root, ['/usr/share/doc'], (_r, name, st) =>
        name === 'copyright' && st.isFile() && !st.isSymbolicLink()).length
      return [verdict(
        'purge-licences-survived',
        n >= 100,
        n >= 100
          ? `the licence texts survived the purge: ${n} copyright files under /usr/share/doc`
          : `only ${n} copyright files are left under /usr/share/doc (expected the full package set, `
            + `~159). Debian ships these to satisfy the redistribution terms of the GPL and the other `
            + `licences in the image; removing them saves under a megabyte and breaches those terms`,
      )]
    },
  },

  {
    // A script whose interpreter was removed is a trap: it fails at the moment
    // it is needed, with an error about the shebang rather than about the purge.
    id: 'purge-no-dangling-perl-shebang',
    shell: {
      pass: 'no script in the packed root names perl as its interpreter',
      fail: 'perl was removed but these scripts still name it as their interpreter:',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      // `grep -rlI '^#!.*perl'`: recursive, names only, and -I SKIPS BINARY
      // FILES -- which matters, because /usr/bin holds thousands of them and a
      // reader without -I would match a stray byte sequence in an ELF.
      const dangling = findUnder(
        root,
        ['/usr/bin', '/usr/sbin', '/usr/lib/systemd', '/etc'],
        (_r, _name, st) => st.isFile() && !st.isSymbolicLink(),
      ).filter(p => namesPerlInterpreter(join(root, p)))
      return [verdict(
        'purge-no-dangling-perl-shebang',
        dangling.length === 0,
        dangling.length === 0
          ? 'no script in the packed root names perl as its interpreter, so removing perl left '
            + 'nothing broken behind'
          : `perl was removed but these scripts still name it as their interpreter: `
            + `${dangling.join(' ')} . Each one fails at the moment it is invoked, reporting a `
            + `missing shebang rather than the purge that caused it`,
      )]
    },
  },
]

// ---------------------------------------------------------------------------
// check_ca_bundle -- os/verify-image-v2.sh:3498
// ---------------------------------------------------------------------------

const CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt'

const CA_CHECKS: readonly CheckCase[] = [
  {
    // A COUNT, not a pinned set. The assertion is that the store was
    // GENERATED, which is what fails when ca-certificates ships without its
    // postinst having run -- TLS code with nobody to believe, failing only on
    // the first outbound connection and reporting it as the remote's fault.
    id: 'ca-bundle-generated',
    shell: {
      pass: ' CA certificates (a count, not a pinned set',
      fail: [
        `${CA_BUNDLE} is missing or empty;`,
        ' certificates; the package is installed but its trust store was not generated',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      // `[ ! -s ]`: exists AND is non-empty, following links.
      const size = ((): number => {
        try {
          return statSync(join(root, CA_BUNDLE)).size
        }
        catch {
          return 0
        }
      })()
      if (size === 0) {
        return [verdict('ca-bundle-generated', false,
          `${CA_BUNDLE} is missing or empty; the image can speak TLS and cannot verify anyone. `
          + `Container pulls, curl and any HTTPS update fetch fail closed with 'certificate signed `
          + `by unknown authority'`)]
      }
      const n = grepLines(root, CA_BUNDLE).filter(l => l.includes('BEGIN CERTIFICATE')).length
      return [verdict(
        'ca-bundle-generated',
        n >= 100,
        n >= 100
          ? `${CA_BUNDLE} holds ${n} CA certificates (a count, not a pinned set: the assertion is `
            + `that the store was GENERATED, which is what fails when ca-certificates ships without `
            + `its postinst having run)`
          : `${CA_BUNDLE} holds only ${n} certificates; the package is installed but its trust store `
            + `was not generated`,
      )]
    },
  },
]

// ---------------------------------------------------------------------------
// small readers the checks above share
// ---------------------------------------------------------------------------

/** The file's lines, or none. `grep` over a missing file matches nothing. */
function grepLines(root: string, path: string): string[] {
  try {
    return readFileSync(join(root, path), 'utf8').split('\n')
  }
  catch {
    return []
  }
}

/** `[ -d "${ROOT}${path}" ]`, following links. */
function isDirectoryFollowingLinks(root: string, path: string): boolean {
  try {
    return statSync(join(root, path)).isDirectory()
  }
  catch {
    return false
  }
}

/**
 * `sed -n 's/^KEY//p' ... | tail -n1` -- the LAST assignment, empty when absent.
 *
 * The last and not the first, because systemd takes the last assignment of a
 * key in a unit file and a check reading the first would judge a unit against a
 * value it does not use.
 */
export function unitValue(root: string, path: string, key: string): string {
  const values = grepLines(root, path).filter(l => l.startsWith(key)).map(l => l.slice(key.length))
  return values.at(-1) ?? ''
}

/**
 * `grep -lI` for a perl shebang: does this file's TEXT name perl as its interpreter?
 *
 * `-I` is the half that matters and it is why the first block is read on its
 * own. /usr/bin holds thousands of ELF binaries; a reader without it would match
 * a stray byte run inside one, and reading every one of them whole to find out
 * would be a couple of hundred megabytes per run. GNU grep calls a file binary
 * when its first buffer contains a NUL, so that is the test, and only a file
 * that survives it is read through.
 *
 * The pattern is matched against ANY line, not just the first -- which is what
 * `^#!.*perl` means. A shebang is on line 1 in practice; asserting that here
 * would be a different check from the oracle's.
 */
function namesPerlInterpreter(full: string): boolean {
  const head = new Uint8Array(32768)
  let got = 0
  let fd: number
  try {
    fd = openSync(full, 'r')
  }
  catch {
    return false
  }
  try {
    got = readSync(fd, head, 0, head.length, 0)
  }
  catch {
    return false
  }
  finally {
    closeSync(fd)
  }
  if (head.subarray(0, got).includes(0)) return false
  try {
    return readFileSync(full, 'latin1').split('\n').some(l => /^#!.*perl/.test(l))
  }
  catch {
    return false
  }
}

export const ENGINE_CHECKS_ALL: readonly CheckCase[] = [
  ...ENGINE_CHECKS,
  ...PURGE_CHECKS,
  ...CA_CHECKS,
]
