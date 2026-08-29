# RFCT-180 PLAN-021 M1: the quick-fix batch

- **status**: completed
- **priority**: P2
- **owner**: bkd/xw8o4454
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-021 (M1)

The six small fixes PLAN-021 M1 enumerates, batched into one record (task
numbers RFCT-180..184 are reserved for this batch; one file covers it).

## Scope

1. `afterAll(async () => {`
   (`os/build/src/pin-seeded-times.test.ts:41`) — the `afterAll` gains
   `beforeAll`'s `OPEN_TIMEOUT_MS` (known flake: closing the toolbox times
   out under the default hook timeout).
2. `os/pkgs/mosd/apid/src/tests.rs`
   (`the_audit_trail_records_the_login_lifecycle_and_never_the_password`) —
   the 401/429 acceptance widened against the login guard's time-based
   backoff window, with the limiter interaction documented in the test.
3. `test/apid-api/run.sh` — the refusal message's dead build instruction
   (`os/mkimage-x64.sh`, deleted) replaced with the live command, and the
   silent exit-1 when `_out/x64` is missing made loud.
4. `expect(CHECKS.length).toBeGreaterThan(0)`
   (`os/verify/src/checks.test.ts:26`) — the vacuous
   `toBeGreaterThanOrEqual(0)` made real.
5. Dead code, deadness verified per site before deleting:
   (a) `os/verify/src/parity.ts` `ParityInputError`'s unused export;
   (b) `os/pkgs/rauc/render-config.sh` `SYSTEM_CONF_IN` override knob with
   no caller;
   (c) `os/pkgs/mosd/mosd/src/identity.rs` cfg(test) `verify_password` —
   verify the plan's deadness claim against its test callers first.
6. Nothing else; no drive-by cleanups.

## Resolution

Fixes 1-4 landed as specified:

1. `pin-seeded-times.test.ts` — the `afterAll` now passes `OPEN_TIMEOUT_MS`,
   the same timeout the `beforeAll` at `:36` already used.
2. `tests.rs` `the_audit_trail_records_the_login_lifecycle_and_never_the_password`
   — the two wrong-login attempts now accept 401 or 429 and the expected
   audit outcome (`wrong-password` / `throttled`) is derived from the status
   each attempt actually answered. The interaction is documented in the test
   doc comment: `LoginGuard::begin_attempt` charges at admission and
   `confirm_failure` re-arms a real-time one-second window, so a run
   descheduled across that window sees the second attempt admitted (401)
   where an unloaded run sees it refused (429). The curve keeps its own
   tests in `auth.rs`; this test is about the audit trail.
3. `test/apid-api/run.sh` — the refusal message's dead
   `bash os/mkimage-x64.sh` (deleted script) now names the live
   `bash os/build/run.sh --mkimage-x64`, and the previously silent death is
   loud: with no `_out/x64`, `readlink -f "${RUN_DIR}"` fails under
   `set -e` at the assignment near the top of the script, before any
   message — that assignment now refuses with a FAIL sentence on stderr
   naming the build commands, then exits 1.
4. `toBeGreaterThanOrEqual(0)` is now `toBeGreaterThan(0)`
   (`checks.test.ts:26`).

### Deviations from the plan's dead-code claims

- **5a — only the export qualifier was dead.** `ParityInputError` is thrown
  six times inside `parity.ts` itself (`parseShellRun`, `diffParity`), so
  the class is live; nothing imports it (`parity.test.ts` included). The
  `export` keyword was removed, demoting it to module-private; the class
  stays.
- **5b — WITHDRAWN, knob left in place.** The `SYSTEM_CONF_IN` knob is dead
  as claimed (no caller sets it anywhere in the tree), but deleting its six
  lines shifts `render-config.sh`'s interior up by five, and `rootfs.0`
  (`docs/design/api.md:3817`, since renumbered from `:3406`) is quoted there
  against `render-config.sh:239` — measured: `docs/verify-citations.sh` goes
  1 FAILED / 901 passed under the deletion. `api.md` is outside this task's
  file scope, so the deletion cannot ride with the repoint it requires
  (RFCT-169's withdrawn `tough`-pin deletion is the precedent for exactly
  this shape). The knob deletion needs its own change that repoints the
  citation in the same commit; the only other line-numbered citation into
  the file, `:10-11`, sits above the knob and is unaffected.
- **5c — plan claim false: test-used.** `verify_password` in `identity.rs`
  is called by tests at `:396`, `:452`, `:653`, `:659`, `:660`, exactly as
  its own doc comment records. Not dead; left unchanged.

### Check evidence

| gate | result |
| --- | --- |
| `MOS_VERIFY_CONTAINER=1 bash os/verify/run.sh` | PASS 1066/1066, rc=0 |
| `MOS_BUILD_CONTAINER=1 bash os/build/run.sh` | PASS 689/689, rc=0, no re-run needed |
| mosd workspace `hack/check.sh` (mos-build-rust container, dbus-daemon installed, cargo-nextest 0.9.133) | ALL CHECKS PASSED, rc=0 |
| `bash -n test/apid-api/run.sh` | clean |
| `bash docs/verify-citations.sh` | 902/902 PASS |
| `bash docs/verify-index.sh` | 528/528 PASS (RFCT-180 row added to `docs/task/index.md`) |
