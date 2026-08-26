# PLAN-014 os/ restructure: board isolation, per-stage rootfs Dockerfiles, pinned build environments, and the TypeScript build/verify toolchain

- **status**: implementing
- **createdAt**: 2026-08-25 10:43
- **approvedAt**: 2026-08-25 10:50
- **completedAt**: -
- **relatedTask**: RFCT-107 (M1), RFCT-108 (M2), RFCT-109 (M3), RFCT-110 (M4), RFCT-111 (M5), RFCT-112 (M6), RFCT-113 (M7)
- **milestones**: M1 delete v1 and restructure the tree; M2 pinned build-environment image family; M3 the bun+TS foundation; M4 the verifier ported to TS under a parity gate; M5 the rootfs build split into per-stage Dockerfiles; M6 the assemblers ported to TS under the byte-identity gate; M7 built artifacts smoke-run on the base rootfs

## Context

`os/` holds 151 files. Its top level flattens together two generations (v1
single-slot, v2 A/B), two boards (cx3576, x64), release-gating verification,
pure tests and dev tooling: 15 shell scripts, ~11,500 lines, plus the
1,798-line `os/rootfs/Dockerfile.v2`. The specific defects, measured:

- **Names lie about scope.** `os/mkimage-v2.sh` is cx3576-only (612 lines of
  U-Boot geometry; `os/mkimage-x64.sh`'s header documents why it refused to
  merge). `os/layout/<board>-v2.env` is not a layout file: it is the full
  board definition — partition geometry, `RAUC_BOOTLOADER`, `BOARD_RADIOS`,
  `BOARD_HWINIT_CONFS` — and every consumer treats it as the single source of
  truth, which is the one property to preserve.
- **The verifier mixes both boards.** `os/verify-image-v2.sh` is 4,620 lines
  with runtime branches (`is_uboot_board`, `board_has_radio`, …) — exactly
  the shape `mkimage-x64.sh` was split to avoid.
- **Test and product scripts are indistinguishable by location.**
  `ui-location-test.sh` (1,561 lines, pure negative tests) sits beside
  `bundle.sh` (release artifact producer) at the same level.
- **Real duplication.** `os/health/mos-health` and `mos-machine-id` are
  byte-identical second copies of the files in
  `os/rootfs/overlay-v2/usr/lib/mos/`, kept in sync by hand.
- **`os/hwinit/` is cx3576-only content at top level** (x64 declares
  `BOARD_HWINIT_CONFS=""`); it is rootfs source material, not a subsystem.
- **Build environments drift.** 11 Dockerfiles pin base images by mutable tag
  (`ubuntu:24.04`, `debian:bookworm-slim`, `debian:trixie-slim`,
  `golang:1.25-trixie`, `rust:1.90-trixie`), never by digest. The mosd/apid
  Rust cross-build (`mosd/hack/build-target.sh`) runs on the host's cargo —
  the one wholly unpinned build in the chain.
- **Built artifacts are verified down to linking, never execution.**
  `os/podman/Dockerfile`'s verify stage emits `NEEDED.txt`; `Dockerfile.v2`
  resolves it with `ldd` against the assembled root; nothing ever *runs* a
  built binary against the base rootfs, so glibc symbol-version gaps, dlopen
  dependencies (the repo itself records podman dlopening `libsystemd.so.0`,
  invisible to ldd) and missing runtime files surface only at boot.
- **Shell is a maintained liability for host-side logic.**
  `shell-pipefail-lint.sh` exists solely to police one shell footgun;
  RFCT-077/096 record whole campaigns against quoting/SIGPIPE/skip-miscount
  classes that a typed language does not have. `test/apid-api` (RFCT-105) is
  already bun+TS, so the stack has an in-repo precedent.

What is already right and must be preserved: the board definition env as
single source of truth (with its schema lint), the shared/board overlay split
(`overlay-v2` / `overlay-cx3576` / `overlay-x64`), the byte-identical
reproducibility contract, the negative-test discipline, and the container
fallback for tool-less hosts.

## Decisions (user-set, 2026-08-25)

1. **v1 is deleted**, not frozen: `os/mkimage.sh`, `os/verify-image.sh`,
   `os/rootfs/build.sh`, `os/rootfs/Dockerfile`, their Makefile targets and
   doc references.
2. **The rootfs build becomes one Dockerfile per stage**, chained via local
   image tags, fully decoupled. The deliverable is a flashed `.img`, not a
   container image, so layer duplication across the chain is acceptable;
   free composition of feature layers is worth more.
3. **The assemblers migrate fully to TypeScript** (mkimage, bundle, build
   orchestration). The old shell versions serve as the comparison oracle —
   byte-identical output on identical inputs — and are deleted once parity
   holds. No permanent dual maintenance.
4. **Go/Rust build images are self-built**: `mos-build-base` plus pinned
   toolchain tarballs (sha256-recorded), not the official `golang:`/`rust:`
   images, for complete environment control.

Boundary that stands regardless: everything that executes **on the device**
(`overlay/usr/lib/mos/*`, hwinit scripts, initramfs scripts) stays POSIX
shell. The image ships no bun.

## Proposal

### Target tree

```
os/
├── boards/                    # board-specific: one directory per board, mutually invisible
│   ├── cx3576/
│   │   ├── board.env          # from layout/cx3576-v2.env (still the single source of truth)
│   │   ├── boot.cmd           # from boot/cx3576-boot.cmd
│   │   ├── overlay/           # from rootfs/overlay-cx3576
│   │   └── hwinit/            # from os/hwinit
│   └── x64/
│       ├── board.env / grub.cfg / overlay/
├── rootfs/
│   ├── stages/                # one Dockerfile per stage (decision 2)
│   │   ├── 10-base/           # system-essential: debootstrap floor, mounts, machine-id,
│   │   │                      #   health, shadow-reconcile
│   │   ├── 20-install/        # first-boot/install: mos-seed-*, repart.d
│   │   ├── 30-feature-*/      # one per switchable feature: containers, mqtt, radios
│   │   ├── 40-board/          # board overlay + firmware (parameterised by boards/<b>)
│   │   └── 90-pack/           # squashfs+verity export, determinism normalisation
│   ├── scripts/               # shell blobs extracted from the old Dockerfile.v2
│   └── initramfs/
├── build/                     # TS build driver + assemblers (decision 3)
├── build-env/                 # pinned builder images (decision 4)
│   ├── images.env             # every base image name@sha256 digest + toolchain versions
│   ├── base/ c/ go/ rust/     # mos-build-{base,c,go,rust} Dockerfiles
├── update/                    # from rauc/ + bundle
├── verify/                    # bun+TS image-contract verifier (structure mirrors test/apid-api)
├── tests/                     # offline tests, negative fixtures
└── tools/                     # qemu-run/journal/seed-state
```

Functional mapping: system-essential = `rootfs/stages/10-base` (+ base
overlay), system-install = `20-install`, image production =
`build/` + `90-pack` + `update/`, per-feature enablement = `30-feature-*`
(replacing `WITH_*` build args with "which stages run"), board-specific =
`boards/<b>` + `40-board`.

### Milestones

Prerequisite: RFCT-106 (P0, in progress, uncommitted in the working tree)
lands first. The restructure does not cross it.

**M1 — delete v1, restructure the tree.** Pure `git mv` plus the v1
deletion; path references updated (Makefile, inter-script, `shellcheck
source=`, doc citations, the consumer lists in the board env headers); zero
logic changes. Gates: `os-verify-*-v2` green for both boards; a rebuilt image
is byte-identical to the pre-move build; `docs-verify` passes (RFCT-092
recorded five citations rotting in two merges).

**M2 — pinned build environments.** `os/build-env/` with `images.env`
recording every base image by digest and every toolchain by version+sha256,
using the established PENDING flow (set hash to `PENDING`, build prints the
real one and fails, paste it in). Self-built `mos-build-base` (pinned trixie
digest + common floor: ca-certificates, git, file, binutils, xz),
`mos-build-c`, `mos-build-go`, `mos-build-rust` layered on it. All
Dockerfiles take their `FROM` via build arg injected from `images.env`;
per-stage apt lists stay separate (the merged-toolchain economy was measured
and rejected in `os/podman/Dockerfile`: one apt list made one package edit
recompile five components, ~42 min under emulation). The mosd cross-build
moves into `mos-build-rust`. BSP builders (u-boot/kernel on ubuntu) get
digest pins only. Gates: every build green from pinned digests; each image
asserts its toolchain version internally; host needs docker and nothing else.

**M3 — TS foundation.** `os/verify/` bootstrapped in the `test/apid-api`
shape (bun.lock, tsconfig, `run.sh` entry). First migration: the board
definition schema lint (`layout/lint.sh` + `lint-test.sh`) — small, typed
data model for `board.env`, proves the runner, the pinned-bun container
fallback (replacing the Alpine tool-container path) and CI wiring. Gates:
the negative test still rejects a broken board definition; a tool-less host
still verifies via the container path.

**M4 — the verifier, ported under parity.** `verify-image-v2.sh` moves to
TS check-by-check: board contracts become typed data, checks become
data-driven cases. The parity harness runs old and new against the same
image and diffs conclusions per check; every migrated check brings its
negative-fixture test (the `ui-location-test.sh` suite) in the same change —
a port without its negative test is not done (RFCT-096: "0 skipped" proved
nothing). Gates: identical pass/fail sets on both boards' current images and
on the mutated fixtures; the shell verifier is deleted only at full parity.

**M5 — the rootfs build, one Dockerfile per stage.** `Dockerfile.v2` splits
into the `stages/` chain above; the TS build driver (from M3
infrastructure) sequences them via local image tags; inline shell blobs land
in `rootfs/scripts/`; the `os/health/` duplicates collapse into the overlay
copy; feature selection becomes stage selection. **ssh is NOT one of those
features** — amended 2026-08-26 at M5 close, **by the user**: *"ssh belongs in
base, it is core."* It is installed by `10-base` and `20-install`, and
`rootfs/scripts/package-manager-purge.sh`'s keep-list names `sshd ssh scp`, so
an ssh-less chain does not merely ship without sshd, it fails to build. A
`30-feature-ssh` would have been a switch with nothing behind it, and would have
turned "every mos image carries sshd" from a contract into an accident.
RFCT-111, "ssh is a floor capability, not a feature", has the measurements.
Gates: the assembled image is byte-identical where achievable — if apt-layer
reordering makes that unattainable, the gate falls back to full verifier parity
plus an explicitly anchored new baseline commit; negative test: dropping a
feature stage must turn the corresponding verifier checks red.

**M6 — the assemblers, ported under byte-identity.** `mkimage-v2.sh`,
`mkimage-x64.sh`, `bundle.sh` and build orchestration move to TS in
`os/build/` (same sgdisk/mtools/dd toolset, driven through Bun.$ with typed
geometry from `board.env`). Gate: shell and TS assemblers produce
byte-identical images and bundles from identical inputs, both boards,
including the selftest's stale-input guards; the shell versions are then
deleted. `shell-pipefail-lint` scope shrinks to the remaining device-side
shell.

**M7 — built artifacts smoke-run on the base rootfs.** The base stage
exports an OCI image of the factory root; every self-built artifact (mosd,
apid, mos-mqttd, mos-mqtt-broker, rauc, podman, quadlet, crun, conmon,
netavark, aardvark-dns) is executed inside it (arm64 via the same
binfmt/qemu-user path the rootfs build already uses): minimal invocation,
exit 0, and the reported version must equal the pin in `versions.env` —
closing the loop from "the version we decided" to "the version that runs".
Explicitly a smoke test: execution + version identity, not behaviour; QEMU
boot tests keep functional coverage. Gates: a deliberately wrong-arch,
missing-soname and version-skewed binary each fail the build.

Dependency order: M1 → M2 → M3 → {M4, M5, M6} in any interleaving
(M5/M6 want M2's pinned images and M3's driver; M4 only M3), M7 after M2
and M5.

## Risks

- **Reference rot** is the largest: doc citations, the consumer lists in
  board env headers, Makefile targets, CI. Mitigated by one move per commit,
  `docs-verify`, and a repo-wide grep sweep per milestone.
- **Semantic drift in the TS ports** — a check or an assembler subtly weaker
  than the shell it replaces. Mitigated by the parity/byte-identity gates and
  the mandatory negative-test lockstep; the reproducibility contract makes
  the assembler gate absolute.
- **Per-stage chaining loses single-file BuildKit cross-stage parallelism
  and shared cache mounts.** Accepted (decision 2): the rootfs chain is
  already linear; per-stage local images cache naturally.
- **Per-stage chaining also costs the QEMU-bundled `docker-container`
  builder, so cx3576 CI waits on runner binfmt.** Accepted 2026-08-26 **by
  the user**, as a known cost of decision 2. Each stage opens
  `FROM ${MOS_STAGE_PREV}` — a local image tag — and only the `docker` driver
  can resolve one; a `docker-container` builder answers "pull access denied"
  about a registry for an image that is present (measured, RFCT-111 M5b).
  That builder was how an amd64 host built arm64 without host `binfmt_misc`,
  so cx3576 now needs the runner to provide binfmt and **cannot be built
  without it** — `os/rootfs/build-v2.sh` refuses up front with the install
  command rather than failing inside BuildKit. **No registry is introduced
  into the build path** to work around it: a local registry would resolve the
  stage tags, and it would add a daemon, a lifetime and a network dependency
  to a build that has none. `os/rootfs/stages/README.md`, "The builder must
  resolve local tags", carries the measurement and the consequence to expect.
- **Byte-identity across the M5 split may be unattainable** if package
  install order changes layer content; the fallback gate (verifier parity +
  anchored baseline) is defined up front, not improvised.
- **Self-built toolchain images (decision 4) take on maintenance** the
  official images provided: toolchain security updates now arrive by editing
  `images.env`. The PENDING flow makes each bump a recorded act.
- **Pinned-bun container fallback** (musl/glibc, digest) is unproven until
  the M3 spike; it is the spike's first deliverable.

## Scope

`os/` wholesale (moves, deletions, new `boards/ build/ build-env/ verify/
tests/ tools/` trees), `Makefile` routing, `mosd/hack/build-target.sh`
containerisation, doc citation updates. No change to device-side runtime
behaviour, image content contracts (outside explicitly anchored baselines),
`board/` BSP builds (digest pins only), `mosd/` Rust sources, or
`test/apid-api`.

## Alternatives

- **Freeze v1 under `legacy/` instead of deleting** — rejected (decision 1);
  git history is the archive.
- **Single multi-stage Dockerfile, reordered** — rejected (decision 2) in
  favour of per-stage files: the deliverable is an img, composition wins.
- **Keep the assemblers in shell, relocated** — rejected (decision 3); the
  byte-identity oracle makes a full port safely checkable now.
- **Official `golang:`/`rust:` images pinned by digest** — rejected
  (decision 4) in favour of base+toolchain self-builds for total consistency.
- **Go or Rust for the verifier instead of TS** — rejected: `test/apid-api`
  sets the bun+TS precedent, and test iteration speed matters more than
  runtime performance here.

## Annotations

- 2026-08-25: Plan drafted from the working-tree investigation; decisions
  1–4 recorded from user direction. Milestone task records (RFCT-NNN) will
  be cut per milestone at execution time, as prior plans did.
- 2026-08-25 10:50: Approved by the user ("开始创建详细的计划" after setting
  decisions 1–4). Task records RFCT-107..RFCT-113 cut up front instead, one
  per milestone, at the user's direction; execution dispatched through BKD
  three-tier coordination. M1 (RFCT-107) stays blocked until RFCT-106 lands
  on main.
