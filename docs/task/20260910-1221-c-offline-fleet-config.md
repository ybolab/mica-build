# 20260910-1221-c-offline-fleet-config Project offline fleet desired configuration

- **status**: in_progress
- **priority**: P1
- **owner**: worker-c/r3suq4rc
- **createdAt**: 2026-09-10 12:21

## Description

Read the current-only `/mos/config/fleet.json` document through the existing
`mosd-settings` configuration resolver and project its raw operator overrides
and effective desired fleet values through authenticated
`GET /api/v1/provisioning/status`. Keep the production path fixed, isolate all
route fixtures, reject invalid input without fallback, and add no fleet client,
writer, credentials, networking, or activity state.

## ActiveForm

Projecting offline fleet desired configuration through provisioning status.

## Dependencies

- **blocked by**: 20260910-1012-c-fleet-app-trust-obligations (completed), 20260910-1046-c-provisioning-resolution-tests (completed)
- **blocks**: (none)

## Notes

- Campaign: `mos-open-plans-20260910-100408`, slice `FLEET-CONFIG`.
- Owner identity after claim: `worker-c/r3suq4rc`.
- Approved source baseline: `5d0dca577a782aa707d9530779c4b23f2a7eda31`.
- Reviewed local L2 upstream: `31d7c109f983a3b41664104d21568e92783c81c0`.
- Hardware, protocol, fleet client/plane, UI, rootfs, build, signing, and
  publication work remain outside this task.
- TDD RED ran once through the authenticated route in tmux
  `r3suq4rc-f4dfce`: exit 101, 0 passed, 1 failed, 336 filtered. The assertion
  observed `operator` as `{}` instead of the poured fleet overlay.
- RED log: `/tmp/r3suq4rc-fleet-red.log`; source commit `628b5eedee3e86e337740784d5d66ef374dedf4d`,
  started `2026-09-10T19:29:25Z`, PID `1375008`.
- RED test-diff identity `e91e87b81dd06d452b9b0a0615f2a57a37d93949`
  is the SHA-1 Git blob object ID produced by piping the three-source-file RED
  diff bytes to `git hash-object --stdin`; it is not a commit or tree ID.
- Focused GREEN: the settings fleet-resolution unit passed 1/1, and the APID
  provisioning module passed 15/15 with 326 filtered and no unused-path
  warning. The latter exercised the real authenticated route with isolated
  baked, updates, and fleet files.
- `make os-apid-api-spec-pins`, `make docs-verify`, and scoped
  `git diff --check` passed before the implementation checkpoint.
- PMA-CR scoped Rust review: PASS, with no high-, medium-, or low-severity
  findings.
