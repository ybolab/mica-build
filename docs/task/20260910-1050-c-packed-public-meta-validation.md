# 20260910-1050-c-packed-public-meta-validation Validate packed public metadata independently

- **status**: completed
- **priority**: P1
- **owner**: worker-c/heobtbj3
- **createdAt**: 2026-09-10 10:50

## Description

Implement PLAN-070 F4 at the unpacked-image boundary. Independently validate `/usr/share/mos/meta` as an exact public-only tree: require the current manifest schema, accept only `updates/manifest.json` and optional `GENERATED`, reject malformed files, unsafe traversal, extra entries, and private material, and return non-vacuous scan evidence without trusting the source-staging validator.

Acceptance requires focused RED/GREEN coverage, the existing verifier suite, documentation verification, and scoped diff review. Kernel, root, QEMU, full-image, hardware, publication, and compatibility work remain out of scope.

## ActiveForm

Validating packed public metadata independently.

## Dependencies

- **blocked by**: 20260910-1050-c-public-meta-source-validation (BKD `84wnkesf`, final commit `e30aebf2086c41f4b3c255de95f74ffb52fa2c62`, merged through local L2 `2ac2e661eb1ed1d728aeaa91bd1086599eeadc0a`)
- **blocks**: C.D4

## Notes

- Campaign: `mos-open-plans-20260910-100408`, node C.D3, BKD issue `heobtbj3`.
- Owner: `worker-c/heobtbj3`.
- Required local L2 source sync: `2ac2e661eb1ed1d728aeaa91bd1086599eeadc0a` (tree `79eb772bec2c1072e07cbd980a61d4cd5fc10b4e`).
- Evidence baseline remains `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.
- Development artifacts are content-equivalent evidence only; no hardware qualification is claimed.
- RED: `timeout 240s bash verify/run.sh src/checks-file-root.test.ts` at source `2ac2e661eb1ed1d728aeaa91bd1086599eeadc0a` with test diff SHA256 `6c54279dcc5d036b3af2e9bcc17713e54b57711b8bf4b80fb49fe2db34419700` exited 1 as required: 12 passed and 44 failed across 56 tests. Failures demonstrate absent strict schema/evidence, marker-byte scanning, exact entry/type enforcement, symlink refusal, duplicate-member/UTF-8 validation, and u64 bounds. Metadata and complete output are `/tmp/heobtbj3-public-meta-red.json` and `/tmp/heobtbj3-public-meta-red.log` (start `2026-09-10T19:40:01Z`, PID `1386806`).
- The first implementation check exposed TypeScript's older `JSON.parse` declaration (`/tmp/heobtbj3-public-meta-green.{json,log}`, exit 2); the implementation now narrows the runtime's source-aware parser signature locally. The next check passed 55 tests and identified one test-only trailing-slash mismatch (`/tmp/heobtbj3-public-meta-green2.{json,log}`, exit 1), which was corrected without weakening the path assertion.
- Focused GREEN before commit: `timeout 240s bash verify/run.sh src/checks-file-root.test.ts` passed 63 tests / 0 failures / 170 assertions with implementation diff SHA256 `ab229322d68540bb33dbfe24d32ed06e8c86c492d3d3946839b27c7bcf6a718e`; metadata and output are `/tmp/heobtbj3-public-meta-final-focused.{json,log}`.
- Independent verifier implementation commit: `5389d6517d6519416590c0af9cdef506ce6a20c0`, containing only `verify/src/checks-file-root.ts` and `verify/src/checks-file-root.test.ts`.
- Committed-source focused evidence: `timeout 240s bash verify/run.sh src/checks-file-root.test.ts` at `5389d6517d6519416590c0af9cdef506ce6a20c0` with clean source diff SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` passed 63 tests / 170 assertions (start `2026-09-10T19:46:12Z`, PID `1397628`, exit 0, `/tmp/heobtbj3-committed-focused.{json,log}`).
- Committed-source relevant suite: `timeout 300s make os-verify-test` at the same commit and clean source diff passed typecheck and 703 tests / 0 failures / 6714 assertions (start `2026-09-10T19:46:22Z`, PID `1399951`, exit 0, `/tmp/heobtbj3-committed-os-verify-test.{json,log}`).
- Pre-completion documentation verification passed all five groups (195 index, 509 links, 724 status, 249 translation coverage, 131 board assertions): `/tmp/heobtbj3-docs-verify.{json,log}`. Scoped whitespace verification also exited 0: `/tmp/heobtbj3-scoped-diff-check.{json,log}`.
- PMA-CR core and TypeScript-backend review of the actual scoped diff is PASS with no high-confidence findings. The check remains image-root isolated through the existing resolver, rejects symlink/special/extra entries before reads, scans all permitted bytes, keeps diagnostics content-free, and validates duplicate decoded members and integer source tokens before lossy interpretation.
- Evidence is development-only. No kernel, root, QEMU, full-image, physical hardware, publication, or compatibility gate was run or claimed.
- Completed-tracking verification: `timeout 180s make docs-verify` passed all five groups (195/195, 509/509, 724/724, 249/249, 131/131) at source `5389d6517d6519416590c0af9cdef506ce6a20c0` with tracking diff SHA256 `d0d204f9caa8a775acc61772690b406b98e83f8090e4dd7cf8f90dcced9a4344` (start `2026-09-10T19:47:52Z`, PID `1402874`, exit 0, `/tmp/heobtbj3-final-docs-verify.{json,log}`). The matching scoped `git diff --check` also exited 0 (start `2026-09-10T19:48:05Z`, PID `1405205`, `/tmp/heobtbj3-final-scoped-diff-check.{json,log}`).

- complete: Committed verifier checks passed the focused and full existing suites; PMA-CR review passed.
