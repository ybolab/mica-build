# 20260910-1050-c-public-meta-source-validation Validate public metadata before root staging

- **status**: in_progress
- **priority**: P1
- **owner**: worker-c/84wnkesf
- **createdAt**: 2026-09-10 10:50

## Description

Implement PLAN-070 F3/F5 current-contract refusals at the root build boundary. Validate the public metadata source before staging: accept only `updates/manifest.json` and optional `GENERATED`, require regular non-symlink files, reject private material in both permitted files, and validate the exact current baked-manifest schema without compatibility readers.

Acceptance requires focused RED/GREEN coverage through the validator invoked by `rootfs/build.sh`, shell syntax checks, documentation verification, and a scoped diff review. Hardware, kernel, QEMU, root composition, and full-image qualification remain out of scope.

## ActiveForm

Validating public metadata before root staging.

## Dependencies

- **blocked by**: 20260910-1012-c-config-update-obligations (BKD `kpuc7zcb`, completed and merged through `fa51970ca32c2a7d16f809134e78d249c0a1f897`)
- **blocks**: C.D3 packed-root public metadata validation

## Notes

- Campaign: `mos-open-plans-20260910-100408`, node C.D2, BKD issue `84wnkesf`.
- Evidence baseline remains `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.
- Current source commit after required local L2 sync: `fa51970ca32c2a7d16f809134e78d249c0a1f897`.
- First bounded repair resumes the same claimed task at `2481e45129ba78d2d4ee82f39bf66158492446c6`; local L2 remains `fa51970ca32c2a7d16f809134e78d249c0a1f897` and is already an ancestor. Repair approval covers duplicate JSON members, invalid UTF-8, and supplied-path ancestor symlinks only.
- Original RED/GREEN logs remain `/tmp/84wnkesf-public-meta-red.log` and `/tmp/84wnkesf-public-meta-final-focused.log`. The original full gate is terminal, not green: `/tmp/84wnkesf-os-build-test.json` records exit 2, with 438 passing and one failing release CLI test. Tracking remains in progress pending repairs, diagnosis, and final gates.
- Repair RED collected without rerunning: `/tmp/84wnkesf-repair-red.json` records source `2481e45129ba78d2d4ee82f39bf66158492446c6`, test diff SHA256 `db2cd72790f9ba98eaf013dbd2a92ba820b166407247d27245fcb450aced3b10`, start `2026-09-10T11:38:22Z`, PID `1235315`, exit 1. The log records 6 pass / 10 fail / 45 filtered: four duplicate-member cases, one invalid UTF-8 case, and five hidden/ancestor symlink cases incorrectly returned 0. Valid controls passed; no timeout caused RED.
- Repair GREEN: `timeout 240s bash build/run.sh src/public-meta.test.ts` passed typecheck, the nonzero-test guard, and all 61 tests (133 assertions). `/tmp/84wnkesf-repair-green.json` records source `2481e45129ba78d2d4ee82f39bf66158492446c6`, code/test diff SHA256 `4880acb36e59c44c4d8c6bc683cbd4bab03b002f5cf2db818c05a94d8ad2dada`, start `2026-09-10T11:46:48Z`, PID `1240830`, exit 0; its companion log preserves the complete output.
- The original release failure is now explained, not waived: `/tmp/84wnkesf-repair-release-stderr.log` captures `git` exit 128, `fatal: not a git repository: /srv/mos/.git/worktrees/84wnkesf`. The CLI mounts only the worktree, omitting its external Git metadata. `/tmp/84wnkesf-repair-release-baseline.log` proves the unchanged `sourceIdentity` function at approved upstream `fa51970ca32c2a7d16f809134e78d249c0a1f897` and current source both reproduce the same failure. No release source or test assertion was changed. The exact `build/src/release-cli.ts:18-24` path requirement was reported to L2 for a scoped L1 handoff; full-suite acceptance remains pending that resolution.
- Scoped PMA-CR core/TypeScript-backend review found no remaining high-confidence issue in the repaired validator/test diff. Raw structural member tracking precedes object decoding, UTF-8 decoding is fatal and retains a BOM for JSON validation, path checks precede normalization, and diagnostics do not print fixture values. The review does not label the unresolved full suite green or imply physical hardware qualification.
- Repair checkpoint `47ec7e8c42504d999087a70fbc4ba67fbae8b3e9` was committed before upstream synchronization. Merge `34ff796e5b78cf2e03965b7dac3975961e42f762` incorporates the exact reviewed local L2 `578bc651a4d2b3faaea21310105ec5aa931f784e` (including C.D5 `8bdc375cc34116d1293f2ee4074bd486e184a434`). Only two append-only index conflicts needed mechanical resolution; all upstream rows and states were retained, with only this task's rows added relative to L2.
- Post-merge existing fixtures: `timeout 120s bash build/run.sh src/images.test.ts src/paths.test.ts` passed typecheck and 24 tests / 61 assertions at source `34ff796e5b78cf2e03965b7dac3975961e42f762` (start `2026-09-10T11:49:17Z`, PID `1242533`, exit 0, `/tmp/84wnkesf-repair-existing.log` and `.json`). Shell syntax and committed scoped whitespace checks also passed; exact metadata is retained in `/tmp/84wnkesf-repair-shell.json` and `/tmp/84wnkesf-repair-scoped-diff.json`.
- The helper/test patch after the merge is byte-identical to the 61-test GREEN patch. `rootfs/build.sh` has no new repair edit: its only slice hunk remains upstream lines 233-247 to current lines 233-242, with validation at line 236 before staging at 237, and 0644 installs at 240/242. Complete-suite replay is deferred until the separately reported Git-metadata limitation has an authorized acceptance resolution; no expensive build was started.
- Documentation verification passed all five checks (195 index, 509 links, 724 status, 249 translation-coverage, 131 board-document assertions); evidence is `/tmp/84wnkesf-repair-docs.log` and `.json`. These are documentation and source-fixture results only, not root composition, release publication, or physical hardware evidence. The original serialized owner remains `worker-c/84wnkesf`; completion is intentionally not requested while full-suite acceptance needs a separate authorized resolution.
