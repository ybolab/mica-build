# PLAN-041 Per-package upstream versions, an installed manifest, and independent wifi/bluetooth producers

- **status**: completed
- **completedAt**: 2026-09-01 22:20
- **approvedAt**: 2026-09-01 17:05
- **createdAt**: 2026-09-01 16:55
- **relatedTask**: [RFCT-277](../task/RFCT-277.md)

## Context

Every archive in the pool carries the one version `0.1.0+git<commit>-1`,
stamped by `os/build-env/deb/version.sh` from the mosd workspace crates and
asserted pool-wide by `os/tests/deb-package-gate.sh` (rule b). For the two
packages that repack upstream software this hides the number that matters:
`mos-podman` is podman v5.8.6 (with crun 1.29.1, conmon v2.2.1, netavark
v2.1.0, aardvark v2.1.0, catatonit v0.2.1 inside) and `mos-rauc` is RAUC
v1.13, both pinned in their producers' `versions.env` and invisible in the
pool. Every other package is first-party (mos-mqtt-broker included: it is a
workspace crate, not a mosquitto repack), so the workspace version is the
right number for those.

The composed image keeps no record of what was installed: the finalizer
purges the package manager, dpkg database included. The pool-side
`_out/debs/<arch>/manifest.txt` (package, version, arch, size, sha256) and
the out-of-image `rootfs-report.txt` exist, but nothing on the device says
what it is made of.

The radio userland is already three disjoint packages (`mos-wifi`,
`mos-wifi-ap`, `mos-bluetooth`) selected per board through
`BOARD_RADIOS="wifi bluetooth"` and per-radio `radio-<name>.pkgs` manifests.
What is still mixed is the level above the packages: one `radios` producer
directory builds all three, and the only subtractive switch is the umbrella
feature token `radios` in `MOS_ROOTFS_WITHOUT`, which drops Wi-Fi and
Bluetooth together — a build cannot decline one and keep the other.
`resolve.sh` also still carries a `--radios` argument plus a synthetic
`radios` entry in its feature list, and two comments reference files the
stage-chain removal deleted (`radios-packages.sh`, `stages/30-feature-radios`).

## Proposal

### 1. Per-package upstream versions

- `producer.env` gains one optional field, `VERSION_FROM="<path>:<KEY>"`
  (repo-relative env file and the key holding the upstream tag). Declared by
  the podman producer (`os/pkgs/podman/versions.env:PODMAN_VERSION`) and the
  rauc producer (`os/pkgs/rauc/versions.env:RAUC_VERSION`); absent everywhere
  else. Producer-scoped: no current producer mixes upstream and first-party
  packages.
- `os/build-env/deb/build.sh` resolves the producer's version as
  `<upstream, leading v stripped>+git<commit><dirty>-1` when `VERSION_FROM`
  is declared, else the workspace version as today. The git stamp comes from
  `version.sh` unchanged, so `mos-podman_5.8.6+git<commit>-1_amd64.deb`.
- `deb-package-gate.sh` rule (b) weakens from "one version spans the pool"
  to "one `+git<commit><dirty>-<rev>` stamp spans the pool"; the upstream
  prefix may differ per package. The `Depends: mos-system (= @VERSION@)`
  exact pins are unaffected — every package that writes or satisfies them is
  first-party and keeps the workspace version.
- `deb-preflight-test.sh` learns the field's shape (path exists, key
  present, value non-empty) with a perturbation case each way.

### 2. Installed-packages manifest

- The composer records `dpkg-query -W -f '${Package}\t${Version}\t${Architecture}\n'`
  into `/usr/share/mos/manifest.tsv` immediately before the package-manager
  purge, so the image carries its own bill of materials. Sorted, tab-separated,
  one header comment line.
- os/verify gains a check: the file exists in the packed root, parses, has
  more than zero rows (vacuity guard), and every row's version carries the
  pool's git stamp. Mutation tests for absence and for a stamp mismatch.
- The pool-side `manifest.txt` needs no change; with real versions it becomes
  the release-side listing the request asks for.

### 3. Independent wifi and bluetooth producers

- Split `os/rootfs/packages-src/radios/` into `wifi/` (mos-wifi,
  mos-wifi-ap) and `bluetooth/` (mos-bluetooth). Payload bytes unchanged;
  `BUILD_CONTEXTS` carries only what each side needs (`radio-units` and
  `radio-hwinit` split accordingly). Producer discovery then counts 11.
- `resolve.sh` drops the synthetic `radios` feature; `wifi` and `bluetooth`
  become individually declinable tokens: `MOS_ROOTFS_WITHOUT="bluetooth"`
  keeps Wi-Fi, and vice versa. The two stale comments are corrected in
  passing.
  - **As built, a deviation from the first draft**: `--radios` and the
    `radio-<name>.pkgs` family STAY. Making the radio manifests plain
    features would have made them default-on for every board — x64 declares
    `BOARD_RADIOS=""` and must not grow a Wi-Fi userland — so board-gated
    selection has to survive. What was removed is exactly the umbrella:
    each radio name is now its own `--without` token (validated against the
    `radio-*.pkgs` basenames, with a name collision against `feature-*`
    refused as ambiguous), and the `radios` token no longer exists.
- Callers updated: `os/rootfs/build.sh` (argument wiring and report JSON) and
  the resolver's own tests/usage text.

## Risks

- The one-version rule is load-bearing in the gate and in `repo.sh`'s
  duplicate-version refusal; both must be retargeted to the stamp, with the
  negative direction (two different stamps in one pool must still fail)
  proven by mutation.
- Renaming pkgs manifests and dropping `--radios` breaks any caller passing
  the old argument; the resolver fails loudly on unknown arguments, so a
  missed caller is a red run, not a silent drift.
- The manifest is written by the composer before purge; writing it after
  would read an empty database. The verify check's stamp assertion pins the
  ordering.

## Alternatives considered

- Component versions (crun, conmon, …) in the mos-podman version string:
  rejected, dpkg version strings are not a list; the components stay pinned
  and readable in `versions.env` and are named in the package description.
- Per-package (not per-producer) `VERSION_FROM`: no current producer needs
  it; the narrower field is less to parse and to gate.
- Making boards declare features instead of `BOARD_RADIOS`: a larger
  redesign of the board schema than the request asks for.

## Completion

Delivered as proposed, with the section-3 deviation recorded above, plus one
discovery the acceptance run forced: `mos-podman.control` pinned `mos-system
(= @VERSION@)`, which under an upstream version substitutes to an
unsatisfiable `mos-system (= 5.8.6+git…)`. `pack.sh` gained the
`@SYSTEM_VERSION@` token with `--system-version` (token-without-flag and
flag-without-token both refused), the driver passes
`MOS_DEB_SYSTEM_VERSION` unconditionally, and the gate's per-package pin
check caught the one real bad archive built before the fix — the negative
direction proven on live material.

Measured at acceptance (dirty tree, stamp `gitbebde92afbe5.dirty-1`):
`make os-debs` yields `mos-podman 5.8.6+git…` / `mos-rauc 1.13+git…` with
every first-party package at `0.1.0+git…`; `deb-package-gate` 230/230, and a
doctored pool carrying `git000000000000-1` beside the real stamp fails both
the per-pool and cross-pool stamp checks by name; `deb-preflight-test` 25/25
(new G section for VERSION_FROM, section E rewritten onto the pool-stamp
refusal it now guards — the old E asserted an engine-staging check the
composed world had already removed); `rootfs-manifest-test` 36/36 over 256
resolutions; composed x64 image verifies 293/293 with the shipped
`/usr/share/mos/manifest.tsv` listing 182 packages (10 mos, one stamp) and
smoke 12/12.

In the same session, on the user's direction, the container-network kernel
floor (`CONFIG_VETH`, `CONFIG_NFT_FIB{,_IPV4,_IPV6,_INET}`) moved from a
cx3576 board fix into `os/boards/common/mos-required.fragment`, and
`os/verify`'s x64 kernel checks grew from three symbols to seven
(config + modprobe resolution) — related work, recorded here rather than in
a plan of its own.
