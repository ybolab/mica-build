# PLAN-014 os/ restructure: board isolation, per-stage rootfs Dockerfiles, pinned build environments, and the TypeScript build/verify toolchain

- **status**: completed
- **createdAt**: 2026-08-25 10:43
- **approvedAt**: 2026-08-25 10:50
- **completedAt**: 2026-08-26 11:20
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

**Amendment, 2026-08-26 — one line of `test/apid-api`, by the user.** The
`test/apid-api` exclusion is lifted for exactly one change: `run.sh:122`'s
`BUN_IMAGE="${MOS_APID_BUN_IMAGE:-oven/bun:1}"` now defaults to `IMAGE_BUN_1`.
That was the last floating image reference in the repository and the only one of
the twenty R6 found that R6 could not close — it wired it, then reverted the
wiring, because a finding does not widen a boundary the plan drew, and escalated
instead. `oven/bun:1` is a MAJOR-version tag that upstream repoints onto every
1.x release, and the harness it runs decides whether apid's API is judged
conformant.

**The amendment is this line and nothing else.** `mosd/` Rust sources, `board/`
BSP content, device-side runtime behaviour and the rest of `test/apid-api` all
remain excluded. Recorded here rather than left implicit so that the boundary
reads as deliberately moved by the user, once, rather than silently crossed —
the discipline every other clause change in this campaign follows.

**Amendment, 2026-08-26 — a `--version` handler in two `mosd/` binaries, by the
user.** The `mosd/` Rust-sources exclusion is lifted for exactly this: a
`--version` (and `-V`) handler in `mosd/mosd/src/main.rs` and
`mosd/apid/src/main.rs` that reports the crate version and exits 0 **before any
daemon initialisation, provisioning, bus connection or key generation**, plus its
build-time plumbing. Landed by RFCT-113 M7d at `2e8d237`.

**Why it was lifted.** M7's whole purpose is that every self-built binary is
executed before an image ships it, and these two could not be asked. Measured
before the change: `/usr/bin/mosd --version` → rc=1, having ignored the flag, run
first-boot provisioning and left `settings.toml` and `secrets/` behind;
`/usr/bin/apid --version` → rc=124 against a 20s budget, having generated a
certificate and a session key, bound `0.0.0.0:443` and `0.0.0.0:80`, and never
returned. Both **ignored argv and started the daemon, and the invocation mutated
the machine** — which is why the *position* of the handler was the requirement
and not a matter of taste. RFCT-113 M7b found the gap, DECLINED to close it
citing this exclusion — its register entry read *"FINDING IS IN SCOPE, ACTING IS
NOT"* — and escalated instead of widening the boundary itself.

**The amendment is those two handlers and their plumbing, and nothing else.**
Every other argv is unchanged and still ignored; refusing an unknown flag would
be a new way for these units to fail on a device, which is device-side runtime
behaviour and was not opened. `board/` BSP content, device-side runtime
behaviour, and the rest of `mosd/` all remain excluded. Recorded here because
M7d put the provenance in both `main.rs` files and in its commit message, and
PLAN-014 is docs — the lane that commit did not have.

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

## The close, 2026-08-26

All seven milestone records (RFCT-107..RFCT-113) read `completed`. What follows
is the part of the campaign that is **not** recoverable from the diff: the one
clause that closed the gap the campaign opened on, the two it did **not**
discharge and what reopens them, the ledger of how every clause outcome was
reached and by whom, what was never verified, what was deleted and against which
measurement, and one finding left open on purpose. It is deliberately not a
summary of what was built — the milestone records and the `HARNESS.md` /
`README.md` files under `os/build/`, `os/verify/` and `os/rootfs/stages/` carry
that.

### The gap that closed: RFCT-113 clause 1, on its LITERAL reading

RFCT-113 opened on the distance between *"it linked"* and *"it runs"*. **That gap
is closed**, and the way it closed is the part worth recording at plan level: on
the **literal** reading of clause 1 — a wrong-arch, a missing-soname and a
version-skewed binary each fail **the build** — and not on the looser reading
where they fail a check somebody has to remember to run.

**`os/rootfs/build-v2.sh` runs the smoke step as its LAST LINE, under
`set -euo pipefail`.** A self-built binary that does not run therefore fails the
image build. The root is not handed to an assembler, to a bundle, or to a person
without its binaries having been executed.

Four properties, each measured rather than asserted:

- **In the script, not in the `Makefile`.** Two make targets run this script, so
  does the CI deep lane, and anyone can run it directly. A step wired into the
  callers would be three copies to keep in step and bypassed by the fourth.
- **Ordered after the archive refusals, not before them.** Pack → export →
  `build-v2.sh`'s own checks that `factory-root.oci` exists, is non-empty and
  carries an `index.json` → smoke → the caller assembles. So a missing or non-OCI
  archive is still diagnosed as itself, rather than arriving at the smoke runner
  as a `docker load` failure. The smoke step is last and unguarded, with
  **nothing after it whose success could mask it**.
- **No skip path, and its absence was driven both ways a real build host could
  lack the means.** bun present and no docker → `error: Executable not found in
  $PATH: "docker"`, exit 1; neither bun nor docker → `error: --smoke on a host
  with no bun needs docker, and there is none`, exit 1. Both were then run
  through the actual seam — the same command under `set -euo pipefail` with a
  line after it — and **in neither case did that line execute**. A flag that
  turned this step off would make "the build passed" mean two things, and the one
  it would mean on the day somebody set the flag is the one this milestone exists
  to end.
- **It adds no dependency the script did not already have.** `run.sh --smoke`
  needs docker, which `build-v2.sh` has needed since its first `buildx` line; and
  it needs to *execute* the target platform, which for cx3576 is the same host
  binfmt the refusal at the top of the script already demands in order to build
  at all. **A host that can build this root can run what is in it** — which is
  precisely why the literal reading turned out to be satisfiable.

**This was a gate deciding which sense of its own clause applies, and it is a
fourth thing — none of the three in the ledger below.** It is not an amendment:
clause 1's text is unchanged and says what it always said. It is not a
satisfaction and not a disposition. And it deliberately did **not** go to the
user, because the stricter reading proved *satisfiable*, and a clause question
only exists when it is not. Measured before deciding, because the two readings
diverge only if the looser one is already satisfied and the stricter one is not —
and they did diverge: 672 tracked files, 38 mentioning `smoke`, and the only
executable invocation of the runner anywhere in the tree was `os/verify/run.sh`
calling its own CLI. No `make` target, neither `.gitea` workflow, and every
`smoke` in `build-v2.sh` was a **comment** — including the one that states the
risk exactly: *"an image that ships them unexecuted looks exactly like one whose
smoke run passed."*

**Clause 1 carries no board qualifier and is discharged.** But the wiring it
rests on has still only ever fired on x64 — the same build path exists for
cx3576 and has never run there, which is the second disposition below. The two
belong read together: the gate is real, and it has been observed working on one
of the two boards it guards.

### The two dispositions, and what reopens them

A **disposition** is this campaign's way of closing a milestone over a clause
that is still live: the clause text is unchanged, the clause is **not true**, and
it was closed over on a stated *physical* constraint — revertible, with a named
trigger. Both were **decided by the user on L2's recommendation**, and both
actors are named because both acted: L2 measured the walls and recommended, the
user took the decision. Neither is a judgement that cx3576 is fine. **cx3576 is
unobserved, which is not the same thing.**

**RFCT-111 clause 3 — "both boards build and verify green through the chain."**
Discharged for x64, repeatedly and at the tree that ships. **cx3576 was never
built through the chain on any host this campaign had.** `binfmt_misc` is not
mounted here, no builder advertises `linux/arm64`, and since M5b the chain can no
longer fall back to the QEMU-bundled `docker-container` builder that used to
close that gap — the cost the user accepted, recorded under Risks above. Closed
over on the physical-runner constraint. Driven at close, so the state is a
measurement and not an assumption: `make os-verify-cx3576-v2` exits 1 before
running a single check, because there is no image for it to read.

> **Trigger: the first arm64-capable host to build and verify cx3576 through the
> chain settles clause 3 one way or the other. A FAILURE THERE REOPENS
> RFCT-111.** Without a named trigger, "revertible" is only a softer way of
> saying closed.

The set to drive on that host is the one RFCT-111 carries forward rather than
drops: `40-board`'s five firmware files and six hwinit units — the `COPY`, the
install and the assertions are unexercised on the only board where they do
anything; `kernel-and-initramfs.sh`'s `modules.tar` arm; and `30-feature-radios`
whole, which is also clause 2's missing `radios` case.

**RFCT-113 clause 2 — "the full artifact list passes on both boards' base
roots."** Discharged for x64 — `RESULT: PASS (12 pass, 0 fail, 0 unclaimed, of
12)`. Not discharged for cx3576, on **two independent constraints**, both
measured:

1. **There is no cx3576 factory root to execute anything in.** The chain cannot
   be built here (the constraint above), *and* `board/cx3576/rootfs/` carries no
   `modules.tar` — so even a capable host needs the BSP drop first.
2. **Even given the image, this host cannot execute it.** Measured against a
   *pulled upstream* arm64 image rather than one of ours, so it is a statement
   about the host: `docker run --platform linux/arm64 arm64v8/busybox /bin/true`
   → rc=255, `exec format error`.

**That the two are independent is the operative fact**: an arm64-capable host
alone does not settle this clause the way it settles RFCT-111's. It needs the BSP
drop as well.

> **Trigger: the first arm64-capable host WITH THE BSP DROP to build a cx3576
> factory root and run the smoke list against it settles clause 2 one way or the
> other. A FAILURE THERE REOPENS RFCT-113.**

`.gitea/workflows/privileged.yml`'s deep lane is where that happens — its runner
label already promises the arm64 emulation, `make os-image-cx3576-v2` runs the
smoke list as part of the build, and M7c put `make os-factory-root-gate` and
`make os-smoke-negative-test` beside it. **None of the three has ever run on
cx3576.**

**Precedent, so neither disposition reads as a one-off.** The same physical
constraint — no `binfmt_misc`, no builder advertising `linux/arm64` — took an
*applied default* at RFCT-108 M2 close and a *disposition* at M5 and again at M7:
three uses of one rule, *"the reason is a host capability, not an implementation
shortfall."*

### The provenance ledger: six amendments, one satisfaction, two dispositions

**These are three different things, and collapsing them into "resolved" destroys
the only information they carry.**

| kind | the clause text | the clause itself |
|---|---|---|
| **AMENDMENT** | changed | replaced by one that could be satisfied, and was |
| **SATISFACTION** | untouched | made true by a change elsewhere |
| **DISPOSITION** | untouched | **not** made true; closed over on a stated constraint, with a trigger |

Every row below names its actor, because *who decided* is precisely the part a
diff cannot recover.

**Six amendments.**

| # | clause | when | actor | why the text had to change |
|---|---|---|---|---|
| 1 | RFCT-107 — a rebuilt image is byte-identical to the pre-move build | 2026-08-25, at M1 close | **the user** | The clause and RFCT-107's own Scope were **mutually unsatisfiable**: seven files carrying path references are files the image *ships*, so updating them changes image bytes, and not updating them leaves the shipped tree citing paths that no longer exist. The M1 gate built both sides, measured the delta, found it confined to comment lines, and **refused to close on the unamended text**. The decision the user took on that measurement was to accept and enumerate the delta, not to exempt those seven files from Scope. |
| 2 | RFCT-107 — the reference sweep | 2026-08-25, after M1 close | **the user**, on L2's and L1's recommendation | "a repo-wide grep finds no reference to a deleted or pre-move path" was **unsatisfiable in principle**: editing the citations in `docs/task/RFCT-*.md` and `docs/plan/PLAN-0*.md` to post-move paths would not correct a stale reference, it would falsify a dated record. The amended text carries the distinction the original lacked — a **live reference** (something in the tree resolves it; naming a dead path is a defect) versus a **historical citation** (points into git history, and is correct for the very reason a grep flags it). |
| 3 | RFCT-108 — every build green from pinned digests | 2026-08-25, at M2 close | **L1**, on the M2 gate's recommendation — **NOT a user decision** | Qualified to amd64 component and image builds plus the amd64→aarch64 `mosd` cross build; arm64 builds are to be verified on a binfmt-registered host, where no file change is expected. The reason is the same host capability the two dispositions rest on. **Explicitly revertible on the user's objection**, in which case the clause returns to its unqualified form and M2 cannot close until an arm64-capable host has verified it. |
| 4 | RFCT-108 — the `mosd` cross-build reproduces the pre-switchover host build | 2026-08-25, at M2 close | **the user** (direct decision) | The clause and **decision 4** were mutually unsatisfiable: decision 4 exists to replace the uncontrolled host toolchain, and the clause required the new controlled environment to reproduce the output of the very environment being replaced. Amended to permit the enumerated `libring` / C-toolchain difference, attributed by name. |
| 5 | RFCT-111 — the feature-stage list | 2026-08-26, at M5 close | **the user** | `ssh` removed from the list — *"ssh belongs in base, it is core."* Not a preference but a measurement: an ssh-less chain cannot be built at all, so a `30-feature-ssh` would have been a switch with nothing behind it. |
| 6 | RFCT-111 — the same list, again | 2026-08-26, at M7 close | **the user** | The list stops enumerating members and **points at the mechanism**. It was wrong in both directions at once: it named `ssh`, never a stage in this directory or in any commit that ever added one, and omitted `rauc` and `mosd`, which are. `os/build/src/stages.ts` derives the chain from the directory — *"THE STAGE LIST IS THE DIRECTORY"* — so a second list in a task record is exactly the copy that mechanism exists to prevent. |

Alongside amendment 5 the user also **CLARIFIED**, without changing any clause
text, that build-time inclusion (`--without`) and runtime enablement are **two
separate options** for containers and mqtt rather than one flat list. It is not
counted in the ledger because it amended nothing; it is noted here so a later
reader does not re-collapse the two axes.

**One satisfaction.**

**RFCT-110 clause 3 — the verifier runs on a host with neither bun nor the image
tools.** The clause text is **not amended**; it reads exactly as it always did,
and it is now true. Three actors in order, which is the whole point of recording
it as a satisfaction rather than as one more amendment: **M4e** measured the
clause unsatisfiable, reported it with three costed closures and **took no
action**; **the user** decided — add the pin, option (a), the configuration M4e
had measured sufficient; **M4e** carried out that decision and re-measured on a
genuinely bun-less host. What was unsatisfiable was one cause showing on both
sides of the seam — **no docker client in the bun image** — and it did not close
when the shell oracle was deleted, because the register drives docker just as
much.

**Two dispositions.** RFCT-111 clause 3 and RFCT-113 clause 2, above. Neither
changed a clause; neither made one true.

### What is NOT verified, stated as plainly as what is

The campaign's gates say all of this in their own records. It is said once more
at plan level because a plan marked `completed` is exactly the document that
invites a reader to assume otherwise.

- **cx3576 was never built through the chain, and no cx3576 image was ever
  booted.** One thing that *did* happen must not be misread as this one: M6's
  byte-identity gate **assembled** cx3576 images and bundles. That gate compares
  two *assembler implementations* on identical inputs; it says nothing whatever
  about the chain that produced those inputs, which on cx3576 no host available
  to this campaign could run.
- **No device-side runtime behaviour was exercised, on either board.** M5
  establishes that the image **ships containers and mqtt inert**, and that the
  register asserts that inertness and can fail if it stops being true. It does
  **not** establish that flipping the switch on a booted device turns the feature
  on — nothing here shows `containers.enabled` or `mqtt.enabled` actually
  starting anything on hardware. The weaker claim must not be read as the
  stronger one.
- **No QEMU boot was run.** M7 is explicitly a smoke test — execution and version
  identity, not behaviour — and its own scope assigns functional coverage to QEMU
  boot tests. That half was not taken, by this campaign or beside it.
- **`WITH_MOSD=0` has never produced an image, and on this tree cannot.** Stronger
  than a gap, and driven on both sides: `90-pack`'s
  `pack-assert-var-disposable.sh` demands `/var/lib/mos`, which is created by
  exactly one line — `mosd-install.sh`'s `mkdir -p /var/lib/mos` — that the old
  tree kept inside `if [ "$WITH_MOSD" = "1" ]`; the pre-M5c tree stops at the same
  assertion with the same sentence. It has been an **unbuildable configuration
  and nothing noticed, because nobody built it.** Deliberately not repaired:
  which of the two should give — the overlay's unconditional mount unit, or the
  directory's owner — is an image-content decision.
- **`make os-factory-root-gate` has never run green on this host.** It needs a
  **matched pair** — `factory-root.oci` and `rootfs-verity.img` from one build —
  and no such pair existed at close; its *refusal* was driven instead
  (`rootfs-verity.img is missing or empty`, exit 1, before comparing anything).
  This weighs more than its place in a list suggests: the invariant it checks —
  *the image the smoke run executes in is byte-for-byte the tree the device
  ships* — is the assumption **every other M7 result rests on**, and the two trees
  come from two exports of one stage, so nothing about their agreement is
  structural. M7a's own green run of the same script (9,240 entries compared four
  ways, every comparison driven from the failing side) is in
  `os/tests/factory-root-gate/README.md`.
- **M7's evidence stands on a hand-reconstructed record.** The smoke run and its
  three negative tests were driven against a real x64 factory root — still in the
  closing host's docker image store, carrying commit `60b9ccc76939` — with the
  `_out/x64/` record around it **reconstructed by hand**, which each of those
  files states on its own first line. The image is real; the record is not the one
  a build wrote.

### The two authorised scope amendments, both by the user, both narrow

Both are recorded in full under **Scope** above; they are listed here so that the
close does not read as though the campaign's boundary never moved.

1. **One line of `test/apid-api`** — `run.sh`'s `BUN_IMAGE` default, from the
   floating major-version tag `oven/bun:1` to `IMAGE_BUN_1`. It was the last
   unpinned image reference in the repository, and the harness it runs decides
   whether apid's API is judged conformant.
2. **A `--version`/`-V` handler in two `mosd/` binaries** and its build plumbing
   — `mosd/mosd/src/main.rs` and `mosd/apid/src/main.rs`, reporting the crate
   version and exiting 0 **before any daemon initialisation, provisioning, bus
   connection or key generation**. M7 could not otherwise ask two of the binaries
   it exists to ask, and the measured behaviour before the change was that both
   ignored argv, started the daemon, and **mutated the machine** in the process.

**Both were escalated rather than taken.** The gate that found each declined to
act and said so — R6 wired the `IMAGE_BUN_1` default, then **reverted its own
wiring**, because a finding does not widen a boundary the plan drew; M7b's
register entry read *"FINDING IS IN SCOPE, ACTING IS NOT"*. That property is
worth carrying forward more than either amendment's content is.

**The rest of the exclusion stands, unchanged**: `board/` BSP content (digest
pins only), device-side runtime behaviour, image content contracts outside
explicitly anchored baselines, everything else in `mosd/`, and the rest of
`test/apid-api`.

### What the campaign deleted, and the gate each file went at

Deletion was the object and not a side effect — decisions 1 and 3 both end in a
removal. **`os/` now has no top-level `*.sh` at all.** Every file below went at a
**measured gate**, never on inspection or on a reviewer's judgement that the port
looked equivalent.

| deleted | lines | the measurement it went at |
|---|---|---|
| `os/verify-image-v2.sh` | 4,637 | Full per-check parity with the TS port: **398 checks compared on cx3576, 312 on x64, 0 diverging and 0 unclaimed on both**, rc=0. Parity of *conclusions*, not of passes — on cx3576 both sides fail the same eight BSP byte-compares, whose source tree a checkout does not carry. |
| `os/tests/ui-location-test.sh` | 1,612 | The same gate. Its negative cases had to land in `os/verify/` first: a port without its negative test is not done. |
| `os/mkimage-v2.sh` | 658 | Byte-identity, cx3576: four images (shell ×2, TS ×2), one hash `f36bf809…`. Two shell runs precede the two TS runs because an oracle that does not reproduce *itself* gives nothing to compare against. |
| `os/mkimage-x64.sh` | 524 | Byte-identity, x64: four images, one hash `bdf340e9…`. |
| `os/mkimage-common.sh` | 130 | The same two gates. |
| `os/update/bundle.sh` | 571 | Byte-identity of the bundle **payload**: cx3576 `d7506b62…` (114,425,856 bytes), x64 `66bb6dc1…` (288,894,976). The payload and not the bundle *file*, measured rather than assumed — rauc salts the bundle's own verity hash tree and the CMS signature carries a `signingTime`, so **two runs of the same implementation differ**, and three runs here produced three different file hashes. |
| `os/tests/mkimage-v2-selftest.sh` | 825 | All **33** refusals re-driven in the TS suite from the failing side, each with a positive control beside it. |
| `os/tests/mkimage-x64-selftest.sh` | 1,171 | All **14** reachable refusals, likewise. |
| `os/verify/src/parity-cli.ts` | 312 | The parity harness itself: with the oracle gone there was nothing left to compare against, so it left in the same change. `src/verify-cli.ts` landed *with* the deletion, because nothing in the package could verify an image on its own — the register had only ever run beside the oracle. |

**10,440 lines**, and with them `make os-verify-parity` and
`make os-ui-location-test`, which were **removed rather than kept able to
refuse**. `os/verify/HARNESS.md` records every defect the deletion froze, marked
SHIPS or GONE — including two that were expected to leave with the file and did
not, because their reproductions live in the port.

### An open finding this campaign leaves in `docs/verify-index.sh`

**Left open deliberately, on the user's instruction, and written down instead.**
It is docs tooling rather than `os/`, and adding a check plus its negative tests
at a campaign close is how a scope grows a tail. What follows is what is
unchecked, why the suite stays green anyway, and what a fix would have to assert
— including the trap a naive fix falls into. **A future task should start here,
not from the assumption that `make docs-verify` covers the indexes.**

**1. `docs/plan/` is not a section of the check at all.** `docs/verify-index.sh`
declares three sections in its own header — `docs/design/*.md` and
`docs/research/*.md` against `docs/README.md`, and `docs/task/RFCT-*.md` against
`docs/task/index.md` — and `docs/plan/` is none of them. It is not in the script
and not in `docs/verify-index-test.sh` either; `grep -in plan` over both returns
nothing. So for plans, **all three properties the script establishes elsewhere
are simply absent**: a new `PLAN-NNN.md` that nobody indexes passes, an index row
pointing at a plan that no longer exists passes, and a duplicated plan row — the
two-row append conflict that `docs-verify-test` exists to make reachable for
tasks — passes. `docs/README.md` does carry a `plan/` directory bullet, but
`check_readme_dir` is only ever called for `design` and `research`, so that
bullet is never read.

**2. No index in this repository has its marker compared to the record's own
`status` field.** The plan index's markers (`[ ]` `[-]` `[x]` `[~]`) and each
plan's `- **status**:` line are two statements of the same fact, kept in step by
hand and by nothing else. **This plan was the proof.** For the interval between
the commit that set `status: completed` and the commit that set the marker,
`docs/plan/index.md` said PLAN-014 was still being implemented while PLAN-014
said it was finished — and `make docs-verify` reported `375/375 PASS`, `rc=0`,
across both commits. The disagreement was caught by a person reading the two
files, which is exactly the thing this campaign spent seven milestones replacing
with measurements.

**3. What a fix would have to assert — and the trap in it.** The three properties
plan/ is missing, in the shape the other sections already use: forward (every
`docs/plan/PLAN-*.md` has a row), reverse (every row resolves to a file), and
once-each (no name carries two rows). Then the marker/status agreement, for the
task index as well as the plan index.

> **The trap, measured rather than predicted.** A copy of the task section's
> logic **fails on a clean tree**. `docs/plan/index.md`'s own *Format* example is
> `- [ ] [**PLAN-001 Short plan title**](PLAN-001.md)` — it illustrates the row
> shape using a **real filename**, so `PLAN-001.md` matches twice and the
> once-each assertion reports a duplicate that does not exist. Fifteen matches,
> fourteen plans. The task section dodges this only by accident of wording: its
> example says `PREFIX-001.md`, which matches no file and, for the `RFCT-`
> pattern the script greps, no row either. **Any fix has to exclude the Format
> example — or change it — and its negative test has to prove the exclusion did
> not also blind the check to a real duplicate**, which is the same hole
> `docs-verify-test` was written for.

> **And marker/status is not a lookup table.** The statuses in use across the
> fourteen plans are not a closed set: `completed`, `implementing`, `in
> progress`, `draft`, `proposal`, `rejected (superseded by PLAN-006)`, and
> `partially implemented — executed on the systemd base as PLAN-010 M4`. Whether
> `in progress` and `implementing` are one state, whether `draft` and `proposal`
> are, and what a trailing parenthetical does to a comparison, are decisions
> someone has to take before a check can be written. Taking them inside a
> closing commit is what this note exists to avoid.

### The floor at close

Re-run in full at this commit — after merging M7c's `d11a9f9`, which landed a
docs-only addition to RFCT-113 and `os/verify/HARNESS.md` — against the
campaign's own floor as measured at `e0cb748`, all `rc=0`. This close is
docs-only, so `docs-verify` is the target that had to stay green and every other
one had to **not move**:

| target | at `e0cb748` | at this commit |
|---|---|---|
| `docs-verify` | 375/375 | 375/375 |
| `docs-verify-test` | 8/8 | 8/8 |
| `os-shell-pipefail-lint` | 29/29, 29 scanned | 29/29, 29 scanned |
| `os-layout-lint` | 26/26 | 26/26 |
| `os-layout-lint-test` | 42/42 | 42/42 |
| `os-verify-test` | 1066/1066, 31 files | 1066/1066, 31 files |
| `os-build-test` | 689/689, 25 files | 689/689, 25 files |
| `os-health-test` | 57/57 | 57/57 |
| `build-env` | 21 Dockerfile(s) agree | 21 Dockerfile(s) agree |

Not run here, and named rather than implied: everything needing an image, a board
or an arm64 host — `os-image-*`, `os-verify-cx3576-v2`, `os-factory-root-gate`,
`os-smoke-negative-test`. Their state is the "What is NOT verified" section
above, which this commit does not change.

## Annotations

- 2026-08-25: Plan drafted from the working-tree investigation; decisions
  1–4 recorded from user direction. Milestone task records (RFCT-NNN) will
  be cut per milestone at execution time, as prior plans did.
- 2026-08-25 10:50: Approved by the user ("开始创建详细的计划" after setting
  decisions 1–4). Task records RFCT-107..RFCT-113 cut up front instead, one
  per milestone, at the user's direction; execution dispatched through BKD
  three-tier coordination. M1 (RFCT-107) stays blocked until RFCT-106 lands
  on main.
- 2026-08-26 11:20: **Campaign closed.** All seven milestone records read
  `completed`; `status` moves `implementing` → `completed`. The close is **not**
  a statement that every acceptance clause was discharged — two were not, and
  "The close, 2026-08-26" above carries them at plan level with their reopen
  triggers, alongside the provenance ledger (six amendments, one satisfaction,
  two dispositions, each naming its actor), what was never verified, and the
  measured gate every deleted file went at. **`docs/plan/index.md` still marks
  this plan `[-]`**; per the index's own rules only the checkbox marker changes,
  and that edit was left to the user because this task's scope was this file.
- 2026-08-26 11:30: M7c's `d11a9f9` merged (docs-only: RFCT-113 and
  `os/verify/HARNESS.md`), and the close gains what that commit made
  measurable — **"The gap that closed: RFCT-113 clause 1, on its LITERAL
  reading"**. The smoke step is the last line of `os/rootfs/build-v2.sh` under
  `set -euo pipefail`, ordered after the archive refusals, with no skip path and
  both host-capability gaps driven to exit 1 through the real seam. It is added
  ahead of the dispositions deliberately: the honest close leads with the clause
  that was discharged on the strictest reading available before the two that
  were closed over. It is a **fourth** kind of clause outcome — a gate deciding
  which sense of its own clause applies — and is not counted in the ledger's six
  amendments, one satisfaction, two dispositions.
- 2026-08-26 11:35: **`docs/plan/index.md:47` set `[-]` → `[x]`**, on the user's
  instruction — one character, that line only, per the index's own rule that only
  the checkbox marker changes. The bullet above, which says the marker is still
  `[-]`, is **left standing rather than corrected**: it was true when written, and
  this campaign's own amendment 2 (RFCT-107, the live-reference / historical-citation
  distinction) is the reason a dated statement does not get edited into agreement
  with a later tree.
- 2026-08-26 11:35: **The `docs-verify` gap recorded and NOT closed**, on the
  user's instruction — see "An open finding this campaign leaves in
  `docs/verify-index.sh`" above. It grew on inspection: the marker/`status`
  disagreement was the half that was known, but `docs/plan/` turns out not to be
  a section of the check at all, so plans have none of the forward, reverse or
  once-each properties tasks have. The write-up carries the measurement that a
  naive fix **fails on a clean tree**, because the plan index's own Format example
  uses a real filename. Closing it here would have been a scope tail on a closing
  commit; it is a task of its own.
