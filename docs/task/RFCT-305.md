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
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.
