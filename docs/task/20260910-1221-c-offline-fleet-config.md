# 20260910-1221-c-offline-fleet-config Project offline fleet desired configuration

- **status**: completed
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
- At partial checkpoint `e67bc8d17aa7f5553a56b99a4e2f60922b81d727`,
  finding F2 remained intentionally RED. No existing source caller exposed a
  complete URL validator to `mosd-settings`; the workspace already declared
  `url = "2"` and locked `url` 2.5.8, but the direct dependency edge was not
  yet in scope.
- L1 handoff `01M26EYZK24Q3XK4ZC02XEB46Y` granted exactly
  `mosd-settings/Cargo.toml` and the workspace lockfile member edge. The final
  lock diff adds only `url` to `mosd-settings`; it changes no package version,
  source, checksum, or other dependency edge.
- Repair 1 focused GREEN is preserved at
  `/tmp/r3suq4rc-repair1-green.log`: source commit
  `e67bc8d17aa7f5553a56b99a4e2f60922b81d727`, tree
  `cd02250eecdf8b8a52ad97a86c689b6828b3278f`, repair-diff identity
  `32b74b3ede6622d5ea4b78ef6e2e65f171a68929`, PID `1436896`, from
  `2026-09-10T20:16:33Z` to `2026-09-10T20:17:18Z`, exit 0. Locked metadata
  and tree resolution selected `url` 2.5.8; settings fleet tests passed 3/3
  and the authenticated provisioning module passed 21/21 with 326 filtered.
- Scoped format and clippy are preserved at
  `/tmp/r3suq4rc-repair1-clippy.log` against the same source and diff identity:
  PID `1437422`, `2026-09-10T20:17:59Z` through
  `2026-09-10T20:18:22Z`, exit 0. API spec pins passed 42/42; documentation
  verification and scoped diff checks also passed.
- Final PMA-CR Rust review covered the complete delivery diff from reviewed
  local L2 commit `f30e2492a4f4a0d29f91f13d02abbcc2f92c093a` through
  repair 1. Verdict: PASS, with no high-confidence findings.
- Final repair 1 acceptance is preserved at
  `/tmp/r3suq4rc-repair1-rust-gate-e8473277.log`: the command
  `timeout 1800 make os-rust-gate` ran from clean source commit
  `e8473277af2088ba67da85e3d1da9b167ac4c7ea`, tree
  `615be66f57ffac92e6becd91b7c98bec7a90e164`, PID `1445269`, from
  `2026-09-10T20:21:14Z` to `2026-09-10T20:24:38Z`. Both `mosd` and
  `mos-deploy` passed and the wrapper recorded exit 0. Delivery-diff identity
  `20f88260108135094ab8c8938b0a7f8c67ca409b` is the Git SHA-1 blob object
  ID of the ten authorized paths' binary diff bytes from reviewed local L2
  `f30e2492a4f4a0d29f91f13d02abbcc2f92c093a`, produced by
  `git hash-object --stdin`; it is not SHA-256.
- Final reviewed local L2 sync
  `9f773a9cb1ad1bd882e2f11784288aea4a9e262f` was merged as
  `f616db2047001eee4335ed429de6951e482b3923` after acceptance. It contains
  protocol design only. All six tested settings/APID/manifest/lock path modes
  and blobs remain byte-identical to `e8473277`.
- Final tracking-only PMA-CR review: PASS, with no high-confidence findings.

- complete: Repair 1 passed the authenticated route, focused settings and APID suites, API pins, scoped clippy, and the final full Rust gate on e8473277; delivery remains offline desired configuration only, with fleet client, credentials, activity, networking, and protocol implementation outside scope.
