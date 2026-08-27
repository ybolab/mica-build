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
   `mos-sign` and `mos-update-verify` become the rauc-sign family (user-settled,
   2026-08-27: `rauc-sign` / `rauc-verify` — upstream RAUC ships a single
   `rauc` binary, so no collision exists). M1 still inventories every consumer of the old names
   (docs/design/release-signing.md, the key-ceremony runbook, scripts, CI)
   so the rename lands in one movement. Merging the
   two binaries into one program was considered and declined (user,
   2026-08-27): sign handles production keys on a release host, verify ships
   in the device image — one binary would put signing code on every device.
   One crate, two thin binaries stays the shape.

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

- The mosd move relocates the tree most cited by gated documents.
  *(Corrected at M3, 2026-08-27: the checker is NOT a safety net for a
  whole-tree move whose top-level first segment vanishes. Its scope rule
  keeps a citation in scope only while the first path segment exists at the
  repo root, so a missed `mosd/...` citation after the move is silently
  SKIPPED — rc=0 with a lower in-scope count, not red. M2 was protected only
  because `os/` survives its move. The binding acceptance for M4 and M5 is
  therefore the exact in-scope COUNT held constant, with a per-first-segment
  census before and after; rc alone proves nothing for this class. Second
  correction, measured at M5: the count criterion is necessary and NOT
  sufficient — it proves no citation left the corpus, not that the survivors
  still name what they claim. An UNQUOTED citation into a file whose interior
  shifted is caught by neither the count nor the content check (measured:
  deleting three Cargo.toml lines left the count at 902 and turned 4 of 15
  affected citations red while 11 passed naming the wrong lines). Targets
  must be re-derived by content, not trusted to the gate.)*
  Prefix rewrites must not touch line numbers.
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

## Amendment 2 — the ratified layout (user, 2026-08-27)

M1's design (docs/task/RFCT-165.md on the workstream branch) is ratified as
written, with all seven gate questions answered:

1. Target tree and migration rows 1-12: ratified, including os/pkgs/'s
   organising rule — "a child of os/pkgs/ holds source this repository
   compiles into a shipped artefact" — with rauc-sign named as the member
   that stretches it (half build-host tool, half shipped component).
2. P1 adopted into M5 (repair the two live tree blocks that still draw the
   deleted board/); P2 adopted into M2 (os/pkgs/README.md stating the rule,
   migration row 13).
3. P3 (test/apid-api relocation) deferred to its own plan; P4 (checker
   self-test fixture paths) deferred past campaign close; P5 rejected.
4. docs/research/ is dated history; Decisions item 3's .zh.md licence goes
   unexercised in this campaign (the only two candidate lines are research).
5. release-signing.md:308's example datastore path renames with the binary
   (/var/lib/rauc-sign/trusted); M5 records the choice as deliberate.
6. api.md:3466 (the 86cd669 provenance grep) is excluded from the sweep:
   leave it, or re-run the grep at HEAD and restate — never rewrite the
   quoted command's strings.
7. M5 holds a NARROW prose licence limited to statements these moves
   themselves falsify, enumerated in its spec: api.md:3461-3462 (workspace
   membership) and any sibling the spec names explicitly. Nothing else.

Execution order per section H: M2 and M3 may run concurrently (serialise on
the root .gitignore if the coordinator prefers zero conflicts); M3 strictly
before M4; M4 and M2 strictly before M5. mosd/target/ (4.2G) moves by hand
at M4 integration.

*Execution refinement (coordinator, ratified 2026-08-27):* M2 was serialised
before M3 on a measured conflict (their .gitignore hunks sit within one
merge-context window), and each move carries its own gated-citation rewrites
— M2 the 18 `os/update/rauc` citations, M4 the 708 `mosd/` ones — so every
milestone lands with docs/verify-citations.sh green and no deliberate red
interval exists between M4 and M5. M5's remit is P1, the enumerated prose
licence, the deliberate datastore rename, the :3466 exclusion, the
tree-wide old-path proof, and the closeout.
