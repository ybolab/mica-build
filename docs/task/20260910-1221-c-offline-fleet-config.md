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
- Initial PMA-CR scoped Rust review before repair 1: PASS, with no high-,
  medium-, or low-severity findings.
- The original full Rust acceptance is preserved at
  `/tmp/r3suq4rc-os-rust-gate-1c87a8be.log`: the command `timeout 1800 make os-rust-gate`
  ran from clean source commit
  `1c87a8bedf740b52d1f2c4d576427a52f6a62ffa`, tree
  `de0bf6e59ef321d8f9481f526841477b2e7f49c5`, PID `1402455`, from
  `2026-09-10T19:47:01Z` to `2026-09-10T19:50:50Z`; both `mosd` and
  `mos-deploy` passed and the wrapper recorded exit 0.
- Repair 1 synchronized reviewed local L2 commit
  `f30e2492a4f4a0d29f91f13d02abbcc2f92c093a` at clean merge checkpoint
  `ec1c7bcb4116782f7218464ae0220439a8a42d8c`. The only conflicts were
  mechanical task and plan index appends, and both owners' rows were retained.
- Repair 1 route RED is preserved at `/tmp/r3suq4rc-repair1-red.log`:
  source commit `ec1c7bcb4116782f7218464ae0220439a8a42d8c`, tree
  `7c2e3ee22446585ee2e5e3d2b3077c1e53685c0a`, started
  `2026-09-10T20:10:28Z`, PID `1430716`, finished
  `2026-09-10T20:10:43Z`, exit 101, 1 passed, 4 failed, and 342 filtered.
  Both explicit-null booleans and both malformed hosts returned HTTP 200;
  the userinfo control was already rejected. Test-diff identity
  `50187eeed70f3d6c9b2a8795bf59b5d7e5742d6c` is the SHA-1 Git blob object
  ID of the binary diff bytes for the route test file, produced by
  `git hash-object --stdin`.
- Finding F1 is repaired: present booleans deserialize strictly while omitted
  booleans remain absent. The focused settings test passed 1/1 and the two
  authenticated null-boolean route tests passed 2/2.
- Finding F2 remains intentionally RED. No existing source caller exposes a
  complete URL validator to `mosd-settings`; the workspace already declares
  `url = "2"` and locks `url` 2.5.8, but adding the `mosd-settings` dependency
  edge and its lockfile member edge awaits the explicit two-path handoff.
