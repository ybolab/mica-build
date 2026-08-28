# RFCT-190 PLAN-021 M3a: the os tree ghost-reference sweep — provenance and board tokens

- **status**: completed — three scopes swept (57->49, 82->70, 24->10, every residual justified), SYSTEM_CONF_IN knob deleted with the api.md citations re-anchored, both container suites green
- **priority**: P2
- **owner**: bkd/ah44np0x
- **createdAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-021 (M3)

PLAN-021 M3's os/** half: comments and docs-in-code across os/** still name
files that no longer exist under those names. This sweep rewrites each ghost
reference to name what replaced it, or marks it dated inline where the
successor is not derivable from the repo. Zero behaviour change.

## Scopes

1. **verify-image-v2.sh ghosts** (~60 hits): references to the deleted
   os/verify-image-v2.sh are rewritten to name the os/verify/ v2 suite that
   replaced it, or marked dated.
2. **Provenance ghosts** (~31 hits): references to os/update/bundle.sh and
   os/mkimage-v2.sh (since moved/renamed) get the same treatment — successor
   path or dated marker.
3. **board/ tokens** (~17 hits): comments still spelling the pre-rename
   `board/` tree are repointed to os/boards/... or marked dated.
4. **Coordinated deletion** (one commit, approved via PLAN-021 + L1 ruling):
   the dead SYSTEM_CONF_IN override knob in os/pkgs/rauc/render-config.sh is
   deleted (SYSTEM_CONF_OUT stays), and the docs/design/api.md citation that
   quotes "rootfs.0" at a render-config.sh line is re-anchored by content in
   the same commit.

Acceptance is the measured count delta per scope (before/after grep counts),
not a return code; every residual hit is justified individually.

## Resolution

All greps run from the repo root over `os/**`, excluding `target/` and
`_out`. "Marked" means the line carries an inline `(deleted: PLAN-014)`
stamp (or equivalent wording containing "delet"), so a reader cannot take
the named file as existing.

| scope | grep pattern | before | after | repointed | marked | unmarked residual |
|---|---|---|---|---|---|---|
| 1 verify-image-v2.sh | `verify-image-v2\.sh` | 57 | 49 | 8 | 43 | 6 |
| 2 bundle.sh + mkimage-v2.sh | `os/update/bundle\.sh\|os/mkimage-v2\.sh` | 82 | 70 | 12 | 59 | 11 |
| 3 board/ tokens | `-P '(?<!s)board/'` | 24 | 10 | 14 | 0 | 10 |

Repoint targets, all derived from the tree: the os/verify suite (RFCT-110's
port, deletion commit 6eadc65), `os/build/src/mkimage-v2.ts` and
`os/build/src/bundle.ts` (RFCT-112, deletion commit c55c7b0), and
`os/boards/<b>/bsp/{init,containers.env,rootfs/firmware,out}` (the boards
tree move, d40a90a).

Unmarked residuals, each left deliberately:

- Scope 1 (6): `os/rootfs/build-v2.sh:320` and the template-literal
  messages at `os/verify/src/layout.ts:123`, `parity.ts:110`,
  `checks-engine.ts:136`, `checks-shape.ts:253` are runtime output strings
  -- the zero-behaviour-change rule wins; `os/verify/run.sh:57` is usage
  text that already states the script "printed before this package replaced
  it".
- Scope 2 (11): the echo string `os/rootfs/scripts/rauc-install.sh:18`;
  the usage strings `os/build/src/mkimage-v2-cli.ts:25` and
  `bundle-cli.ts:41`, both already dated "(PLAN-014 M6b/M6d, RFCT-112)";
  the template literals `boot-cx3576.ts:73` and `tools/rauc.ts:132`; six
  test titles (`bundle-cli.test.ts:300`, `bundle.test.ts:334`, `:342`,
  `tools/rauc.test.ts:94`, `tools/sgdisk.test.ts:220`,
  `tools/mkimage.test.ts:35`) -- titles are strings a test filter could
  reference, so they stay under the same rule.
- Scope 3 (10): `os/tests/handshake-test/Dockerfile:84`, `:90`, `:91`
  operate on U-Boot's own `board/sandbox/` source tree, not this repo's
  renamed directory; `os/verify/src/checks-bootchain.ts:19-20` and
  `:346-347` quote PLAN-014's Scope text verbatim (still present at
  `docs/plan/PLAN-014.md:243`); `board.test.ts:337` and `checks.test.ts:50`
  are regex-literal false positives (a closing `/` after "board");
  `os/build/src/bundle-cli.ts:42` is a usage string (see remaining issues).

Item 4: the `SYSTEM_CONF_IN` override knob (assignment plus its five-line
no-caller comment block) is deleted from `os/pkgs/rauc/render-config.sh`;
the variable remains as a plain internal assignment and `SYSTEM_CONF_OUT`
keeps its override. Re-verified before deleting: no caller sets
`SYSTEM_CONF_IN` anywhere in the tree. In the same commit the
`docs/design/api.md` slot citations were re-anchored by content:
`render-config.sh:239/:245/:265/:270` became `:234/:240/:260/:265`
(`[slot.rootfs.0]`, `[slot.rootfs.1]`, `[slot.boot.0]`, `[slot.boot.1]`).

Checks: `bash os/pkgs/rauc/render-config.sh` and `--check` both rc=0.
`docs/verify-citations.sh` after the sweep: 9 FAILED (2 content + 7
ratchet), 1167 passed -- the same fail list as the merged-tree baseline
before this task's edits (a sibling subtask's work list); this record's own
10 unquoted residual citations got a ceiling row in
`docs/verify-citations-unquoted-baseline.txt` in the same commit, per that
file's update procedure. `docs/verify-index.sh`: 15 FAILED, 689 passed,
also the baseline list. The container suites over the touched .ts comments:
os/verify 1066/1066 pass, os/build 689/689 pass. No .rs files were touched,
so the mosd workspace gate did not need to run.

Remaining issues, out of this task's assigned patterns:
`os/mkimage-x64.sh` and `os/tests/mkimage-v2-selftest.sh` ghosts remain
across os/** (same PLAN-014 deletions, not in the three assigned scopes);
`os/build/src/bundle-cli.ts:42` usage text still prints the pre-rename
`board/<board>/out/` path to users.
