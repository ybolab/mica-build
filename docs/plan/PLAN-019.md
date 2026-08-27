# PLAN-019 os/pkgs consolidation, and a directory-structure pass over the tree

- **status**: approved
- **createdAt**: 2026-08-27 09:15
- **approvedAt**: 2026-08-27 09:15
- **relatedTask**: RFCT-165..179 reserved
- **milestones**: M1 target-layout design, user-gated; M2 podman + rauc into os/pkgs/; M3 update/sign becomes os/pkgs/rauc-sign, standalone; M4 mosd into os/pkgs/; M5 tree-wide reference sweep and closeout

## Context

User decisions (2026-08-27): every self-built component consolidates under
`os/pkgs/` — `os/podman`, `os/update/rauc`, `update/sign` (mos-sign), and the
whole `mosd/` Rust workspace — and the campaign MAY additionally propose a
broader directory restructure where the tree's layout still fights its
function.

The three package trees are structural twins already: `os/update/rauc/build.sh`
states "same driver shape as os/podman/build.sh, and for the same reason";
both export from a FROM-scratch stage into gitignored `out-*/`. `update/sign`
is a Rust crate and a member of the mosd workspace
(`mosd/Cargo.toml:3` lists `../update/sign`), so moving both puts the two
Rust trees side by side and shortens the member path to a sibling.

Measured consumer surface:
- Makefile: podman/rauc build targets (:46, :134, :227, :287) and every mosd
  target; .gitignore: 6+ lines naming the old paths.
- os/build/src: comments and error strings naming os/update/rauc and its
  versions.env; bundle-cli's signing-material defaults.
- os/rootfs: build-v2.sh renders RAUC config from os/update/rauc templates;
  stages COPY mosd binaries and mosd/dist units.
- CI (.github/workflows/check.yml): the rust job builds the mosd workspace.
- docs/design: hundreds of `mosd/...` path:line citations, all
  content-checked by the gating docs/verify-citations.sh — prefix rewrites
  with line numbers unchanged, executed under the gate.
- Untracked artifacts to relocate at integration, by hand, like the 585M BSP
  out/ tree at PLAN-018 close: os/podman/out-*/, os/update/rauc/out-*/ and
  .devkeys and versions.lock, update/lockbox if present, mosd/target/.

## Decisions

1. Layout is DESIGNED before it is executed. M1 produces the full target tree
   (every top-level directory and every os/ child named, with the migration
   table old -> new), reviewed by L1 and ratified by the user before any
   git mv. The board/ campaign proved moves are cheap; choosing the wrong
   destination twice is not.
2. The restructure licence covers proposing; it does not cover silently
   executing beyond the ratified layout. Anything the design pass wants that
   is not in the four package moves is presented in M1's proposal.
3. `*.zh.md` files: path-token updates ONLY (the PLAN-018 Amendment 1
   exclusion is lifted for pure path strings if the ratified design says so;
   prose stays untouched).
4. docs/task and docs/plan remain history; dated records keep their old
   paths. The live-vs-dated citation split recorded in RFCT-159 finding (a)
   governs which docs/task references may move.
5. *(User-set, 2026-08-27.)* `update/sign` lands as `os/pkgs/rauc-sign`, not
   mos-sign: the crate signs and verifies RAUC bundles — it is RAUC's trust
   tooling, not a mos-branded tool and not part of mosd. It is EXTRACTED from
   the mosd workspace: own `[workspace]` Cargo.toml and lock, own gate run in
   CI, and `mosd/Cargo.toml`'s member list drops it. The binary names FOLLOW the
   rename (user ruling, 2026-08-27): naming stays unified with the crate —
   `mos-sign` and `mos-update-verify` become the rauc-sign family (exact
   spellings settled in M1's proposal, default `rauc-sign` /
   `rauc-sign-verify`, chosen so neither collides with rauc's own binary
   names). M1 still inventories every consumer of the old names
   (docs/design/release-signing.md, the key-ceremony runbook, scripts, CI)
   so the rename lands in one movement.

## Proposal

- **M1 (RFCT-165)** the layout design: target tree, migration table,
  consumer inventory re-measured at HEAD, and the list of any additional
  restructure proposals with rationale each. Output is a proposal section in
  this plan file (amendment), not moved files. USER GATE.
- **M2 (RFCT-166)** podman + rauc -> os/pkgs/{podman,rauc}: git mv, code
  consumers, gitignore, Makefile; bun suites + both docs gates green.
- **M3 (RFCT-167)** update/sign -> os/pkgs/rauc-sign per Decisions item 5:
  git mv, workspace EXTRACTION (own Cargo.toml/lock, mosd member list
  shrinks, CI gains the second cargo gate), update/README folded in,
  top-level update/ removed; both cargo workspaces green independently.
- **M4 (RFCT-168)** mosd -> os/pkgs/mosd: git mv, workspace root move, CI
  rust job, rootfs stage COPY paths, test/apid-api references,
  mosd/hack/build-target.sh self-references; full gate set green (cargo
  fmt/clippy/test in the pinned image, both bun suites, both docs gates).
- **M5 (RFCT-169)** tree-wide reference sweep: docs/design citation prefix
  rewrites under the gating checker, docs/README, architecture.md, any
  ratified extras from M1; old-path grep zero outside history and the
  ratified exclusions; closeout.

## Risks

- The mosd move relocates the tree most cited by gated documents; the
  checker converts every missed citation into a red CI, which is the safety
  net working. Prefix rewrites must not touch line numbers.
- The pinned-image gate recipes (mount at /src, -w /src/mosd) change with
  M4; RFCT-168 must update mosd/hack scripts and record the new invocation.
- Anything running from an old worktree after M4 will look for mosd/ at the
  old path; L2s and L3s must re-derive paths from their own merged tree, not
  from memory or from the plans' older text.

## Scope

- **In**: the four package trees and every consumer path named above;
  os/pkgs/ creation; ratified M1 extras; docs citation prefixes; .zh.md path
  tokens per Decisions 3.
- **Out**: behavioural changes of any kind, Cargo dependency changes,
  board.env values, docs/task and docs/plan history rewrites, prose edits
  beyond path tokens.
