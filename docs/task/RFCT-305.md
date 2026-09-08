# RFCT-305 Gate A mechanism: the baked trust grade, the device statement, and the publication refusal

- **status**: in_progress
- **priority**: P0
- **owner**: gate-a/bkd-hw1jo2un
- **createdAt**: 2026-09-04 19:10
- **relatedPlan**: [PLAN-077](../plan/PLAN-077.md)

## Description

[PLAN-037](../plan/PLAN-037.md)'s Gate A — *trust is real* — is the one 1.0
gate with no acceptable partial form. [PLAN-077](../plan/PLAN-077.md) splits it
into a human ceremony (a runbook, delivered as PLAN-077 §7) and mechanism. This
task is the mechanism half, slices **G1–G6** of that plan's backlog:

- **G1** — `rootfs/build.sh`: `META_PUBLIC` gains a **conditional** third
  entry, `GENERATED` → `usr/share/mos/meta/GENERATED`, staged iff present.
  B1's count becomes "entries whose source was present", with the required
  entries still mandatory. This answers PLAN-070 open question 4 in the
  affirmative (PLAN-077 §2).
- **G2** — verify's `packed-meta-is-the-public-set` gains a **biconditional**:
  the image carries the marker iff `meta/` does, byte-equal when both do.
- **G3** — mosd's `system_info.rs` gains a `trust` member reporting the grade
  and the domains the marker names, `available: false` with a reason when the
  baked `meta/` tree is absent; and apid's diagnostics redaction allowlist
  gains the member, so a support snapshot does not silently drop it.
- **G4** — `build/src/release-manifest.ts`: `readBakedTrust` with its
  throw-on-missing-manifest guard, a `trust` block on the release manifest, the
  assembly measurement, the gate's agreement check, and two refusals — a
  `candidate`/`stable` release whose image carries the marker, and an image
  whose baked manifest names a source while trusting no key.
- **G5** — `--baked-meta` / `MOS_BAKED_META` on `release-cli.ts`.
- **G6** — the documentation those make true, mirrored into `docs/zh/`.

**Not in this task**: PLAN-077 §6's rotation channel (G8), which is blocked on
a product decision the plan names in §6.5; G7, the runbook's migration into
`docs/design/release-signing.md`, which waits on PLAN-077's approval; PLAN-070
F5–F11, and F7 in particular; and `pkgs/rauc-sign`, whose fate belongs to
`docs/design/release-artifacts.md`.

**No production key is generated, held, read or transported by any part of
this task.**

## ActiveForm

Implementing Gate A's mechanism half: the baked trust grade, the device
statement, and the publication refusal.

## Dependencies

- **blocked by**: RFCT-301 (PLAN-070 F1–F4, F12). Every slice here edits the
  `meta/` seam that task creates — `META_PUBLIC`, `packed-meta-is-the-public-set`,
  the `DOMAINS=` marker. Implementing against the pre-`meta/` tree would build a
  second seam beside the approved one.
- **blocks**: PLAN-037 Gate B (the ordering clause is A before B)

## Acceptance

- **G1**: a development tree bakes `/usr/share/mos/meta/GENERATED`; a tree
  whose marker has been deleted bakes none and stays green; a required member
  of the public set that is missing is still the existing refusal. B1's count
  assertion still fires when the staged set and the resolved allowlist
  disagree.
- **G2**: `packed-meta-is-the-public-set` is **RED in both directions** — an
  image carrying a marker its tree does not have, and an image missing one its
  tree does have — and byte-inequality when both are present is still a
  failure. A tree with no `meta/` still **throws** rather than passing.
- **G3**: fixture trees cover development (with the marker's domains parsed),
  production (tree present, no marker), and **absent** (no baked `meta/` tree
  at all). The absent case reports `available: false` with a reason, and the
  test that plants it is RED against a reader that answers `production` — the
  vacuity the whole member exists to avoid. A diagnostics snapshot carries the
  `trust` member rather than dropping it.
- **G4**: development-grade + `stable` is refused, naming the file it found and
  the domains the marker names; development-grade + `development` is green with
  the grade recorded in `manifest.json`; production-grade + `stable` is green;
  a baked manifest with `update.source` set and `trust.signingKeys` empty is
  refused; an empty key list with a null source passes. An absent, empty or
  manifest-less `--baked-meta` directory **throws**.
- **G5**: the gate cannot be run without the input, and an unrecognised flag is
  still refused rather than forwarded.
- **G6**: `docs/user/security.md` §2 states what is true after this work and
  **does not mark shipped what is not** — the image provisions the anchor, the
  shipped client does not yet read it (PLAN-070 F7), and the rotation gap
  stands. Mirrored into `docs/zh/` in the same commit, with the coverage row
  updated.
- A composed x64 image and `bash verify/run.sh --verify --board x64` green,
  including the new assertions.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify` green.
- `cargo test --locked -p mosd -p apid` green in
  `localhost/mos-build-rust:amd64` with `dbus-daemon` installed.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/changelog.md` untouched.

## Gate results — 2026-09-04, against the merged head

Run in the worktree `/srv/bkd/worktrees/33z9aa5q/hw1jo2un`, on this branch after
`main` was merged at `a41b0915` — so these numbers describe this work against a
base that already carries PLAN-070 F1–F4/F12 (`2383f91f`) as reviewed history,
rather than against an unreviewed copy of it. Each gate ran with its own exit
status rather than through a pipe that would mask one.

| Gate | Result |
|---|---|
| `(cd verify && bun test)` | **green**, 1268 tests across 39 files |
| `(cd build && bun test)` | **green**, 889 tests across 28 files (285 s; it drives real docker bundle end-to-end runs) |
| `bash tests/trust-domain-hygiene-test.sh` | **green**, 8 passed — its tightened exclusion re-proven in both directions below |
| `bash tests/rauc-trust-negative-test.sh` | **green** |
| `make docs-verify` | **green**, 183 + 448 + 733 + 231 + 43 |
| `bash tests/release-verify-test.sh` | **green**, 27/27, **11 refusals proven red** through the shipped CLI, each with a message fragment no other refusal carries |
| `cargo test --locked -p mosd -p apid` | **green**, 823 tests (apid 318 + 1, mosd 496 + 1 + 7), in `localhost/mos-build-rust:amd64` with `dbus-daemon` added |
| `rootfs/build.sh`'s meta staging, both dispositions | **green**: with `meta/GENERATED` present it stages `3 of 3` public-set entries and names the baked marker; with it removed, `2 of 3` and no marker |
| **A composed x64 image and `bash verify/run.sh --verify --board x64`** | **NOT RUN — reported, not worked around** |

**Why the image gate did not run, and what it would take.** The worktree has no
`_out`, and `make os-deb-preflight` names what is absent before anything is
built: the four x64 kernel artefacts under `boards/x64/bsp/out/kernel/`
(gitignored; `make -C boards/x64/bsp kernel`), and the podman binaries for both
architectures, which the run would otherwise compile inside a packaging hook at
roughly three quarters of an hour per architecture, arm64 under emulation. Then
`make os-debs`, the composition, the image and the verify run. That chain is
buildable here and is not improvised — but it is hours of shared-daemon work
while other agents are active, and the pool stamp it produces is invalidated by
any later commit, so it has to be the last thing done. **It is reported for a
decision rather than started.**

What that leaves unproven is the pair G1+G2 *over an assembled image*: the
staging is exercised directly above and the biconditional is exercised over the
fixture root by `verify`'s own suite, but the two have not been run against each
other on a real packed root.

## The hygiene suite's exclusion, re-proven across the merge

`tests/trust-domain-hygiene-test.sh` changed on both sides of the `main` merge.
This branch never touched the file, so main's tightened form (`5f93fe80`) was
taken **whole** and the merged file is byte-identical to main's — there was no
assertion of this task's to re-apply on top of it.

The tightening is the part that matters, and it is re-proven here rather than
assumed to have survived:

| Tree | Result |
|---|---|
| as committed | **green**, `RESULT: PASS (8 passed, 0 failed)` |
| `cp "${somewhere}"/*.pk8 "${dest}"` planted in `rootfs/build.sh` | **red**, naming the planted line — the genuine glob copy the earlier substring exclusion would have swallowed |
| the detector's key-container case arm narrowed to `*.key)` | **red** on the stale-map guard, before the grep runs, saying the exclusion now excludes nothing |

The middle row is the property: a glob copy is the *more* natural way to
bulk-move key files, not the less, so an exclusion that swallowed it would have
let through exactly the shape somebody would actually write.
