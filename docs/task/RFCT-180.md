# RFCT-180 PLAN-021 M1: the quick-fix batch

- **status**: in progress
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **plan**: PLAN-021 (M1)

The six small fixes PLAN-021 M1 enumerates, batched into one record (task
numbers RFCT-180..184 are reserved for this batch; one file covers it).

## Scope

1. `os/build/src/pin-seeded-times.test.ts:41` — the `afterAll` gains
   `beforeAll`'s `OPEN_TIMEOUT_MS` (known flake: closing the toolbox times
   out under the default hook timeout).
2. `os/pkgs/mosd/apid/src/tests.rs`
   (`the_audit_trail_records_the_login_lifecycle_and_never_the_password`) —
   the 401/429 acceptance widened against the login guard's time-based
   backoff window, with the limiter interaction documented in the test.
3. `test/apid-api/run.sh` — the refusal message's dead build instruction
   (`os/mkimage-x64.sh`, deleted) replaced with the live command, and the
   silent exit-1 when `_out/x64` is missing made loud.
4. `os/verify/src/checks.test.ts:26` — the vacuous
   `toBeGreaterThanOrEqual(0)` made real (`toBeGreaterThan(0)`).
5. Dead code, deadness verified per site before deleting:
   (a) `os/verify/src/parity.ts` `ParityInputError`'s unused export;
   (b) `os/pkgs/rauc/render-config.sh` `SYSTEM_CONF_IN` override knob with
   no caller;
   (c) `os/pkgs/mosd/mosd/src/identity.rs` cfg(test) `verify_password` —
   verify the plan's deadness claim against its test callers first.
6. Nothing else; no drive-by cleanups.
