# RFCT-300 An unreadable time signal must not report as a read one

- **status**: completed
- **priority**: P2
- **owner**: time-status-unread-signal/bkd-il534sna
- **createdAt**: 2026-09-04 14:00

## Description

`time_status::classify` treats `ntp_synchronized: None` -- timedate1's
`NTPSynchronized` read did not answer -- identically to `Some(false)`. A device
whose time daemon could not be queried at all is reported as a device that was
queried and found not synchronized. Those are different facts.

RFCT-299 found this on the same path and stopped at recording it, because
choosing what to report when the signal is unreadable is a design decision.
The decision (2026-09-04): do not invent a state. `unknown` already exists and
already means "a signal this rests on could not be read"; its doc comment
narrowed it to "timesyncd is not on the bus", which is the thing that is wrong,
not the state set. The raw signal stays faithfully absent -- `synchronized`
goes missing from the payload when the read did not answer -- and nothing is
inferred to fill the gap.

## ActiveForm

Reporting an unread time signal as unread.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- A reproducing test, red before the fix and green after, driving `None`
  through the classifier and through the bus method that serves it.
- `unknown` is what an unread signal reports as; no sixth state.
- The payload's `synchronized` member stays absent, and `detail` names the
  read that went missing.
- Every consumer whose meaning changes moves with it: the route
  documentation, `openapi.json`, `docs/design/time.md` section 5, and the UI
  label for `unknown` in both locales.
- `cargo test --locked -p mosd -p apid`, `(cd verify && bun test)`,
  `(cd build && bun test)`, `make docs-verify` green.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`
  untouched.

- complete: `unknown` is now what an unread signal reports as, and no state
  that asserts something about the clock can be reached without the bit it
  rests on.

  Red first, three ways: `classify` with `ntp_synchronized: None` returned
  `Polling` where `Unknown` was required, `status_json` served
  `"status": "polling"`, and `MosdService::get_time_status` -- the bus method
  a client actually reads -- served the same document from a fake observer.
  All three are green after.

  The fix is one gate in `classify`, placed where the bit first becomes
  load-bearing:

  - `synchronized`, `polling` and `offline-degraded` all rest on timedate1's
    bit. The first asserts it; the other two are only reached once it has been
    ruled out, so both assert its absence. An unread bit produces none of
    them.
  - `invalid-source` is deliberately left above the gate and still reachable
    with the bit unread. It rests on the sample alone, already outranked the
    bit before this change, and claims nothing about the clock -- only that
    the source's replies are unusable, which *was* read. This is the one place
    the implementation could have been read either way, and it is called out
    here because the decision's rule ("no state that asserts something about
    the clock") does not forbid it.
  - No sixth state, and nothing inferred to fill the gap: no sample, stratum
    or earlier reading is promoted into a state.

  The raw signal stays faithfully absent -- `status_json` still emits
  `synchronized` only from `Some(_)` -- so an absent member beside `unknown`
  is what distinguishes "not read" from "read and false". `detail` now names
  WHICH read went missing (`unknown_detail`), because the two signals live in
  different services and the old single sentence would have sent an operator
  to timesyncd when timesyncd had answered.

  Consumers checked, and what moved:

  - `routes.rs` and the regenerated `openapi.json` (one description; no shape
    change, and the byte-equality test is green).
  - `docs/design/time.md` section 5: the `unknown` table row, and a new
    paragraph pair stating what the state covers, why `invalid-source`
    survives an unread bit, and that the absent `synchronized` member is half
    of the signal.
  - `docs/design/diagnostics.md` section 10.4's "Wrong time" tree: `unknown`
    now says nothing about the clock, and the remediation names the service
    `time.detail` points at rather than "the time service". `detail` survives
    redaction -- the allowlist admits it at any depth (`"detail" => Some(&S)`
    in `schema()`), so the instruction to preserve it is honest.
  - The UI label for `unknown` in both locales: it said "the time service is
    not observable", which is false in the new case, and now says a signal
    the status rests on could not be read. The panel already renders `detail`
    beneath it, which is what names the service.
  - `overview-page.tsx` was already correct: `clockAdrift` tests
    `synchronized === false`, so an absent member raises no warning. It is the
    one other place the tri-state reaches, and it had not flattened it.

  One existing test changed rather than the implementation:
  `an_unusable_reply_is_invalid_source`'s positive control left
  `ntp_synchronized` at its `None` default while asserting `Polling`. It was
  asserting the conflation this task removes; it now states `Some(false)`, so
  the control is about the sample, which is what it is for.

  Not changed, and why:

  - **`docs/design/diagnostics.md` section 5's version mismatch.** The heading
    says "version 1" and the table row says `2`; the code says
    `SCHEMA_VERSION = 1` and ships that. The instruction was to fix it only if
    the code settles which side is right, and the code does not: commit
    4690a87e ("the snapshot schema version follows the schema") is a
    deliberate bump whose message is entirely about the SNAPSHOT schema, whose
    doc half is exactly this row 1 -> 2, and whose code half edited
    `REDACTION_SCHEMA_VERSION` instead (1 -> 2; later 2 -> 3 in 5dfa80f9 for
    an unrelated allowlist change). So the row records the intent, the code
    records a mis-edit, and the real defect is that `SCHEMA_VERSION` never
    followed the shape change it was bumped for -- while the redaction version
    was bumped twice, once for nothing. Editing the row to `1` would erase the
    evidence and leave a schema version that "cannot be false" being exactly
    that. Reported for its own task; it is not a heading typo.
  - Section 6's heading ("The redaction schema, version 1") disagrees with
    `REDACTION_SCHEMA_VERSION = 3` for the same reason. Same finding, out of
    the named scope.
  - `docs/plan/PLAN-044.md`, and `docs/zh/design/built-in-ui-design.md`:
    RFCT-299's reasons still hold -- a completed plan record, and a stale
    pre-implementation UI document that already disagrees in three other ways.
  - `docs/user/configuration.md` (and its zh mirror): section 5.1 names only
    `synchronized` and `polling`; nothing it says became false, so the gated
    tree needed no mirror.

  Verified: `cargo test --locked -p mosd -p apid` green in
  `localhost/mos-build-rust:amd64` with `dbus` installed;
  `(cd verify && bun test)` 1253 pass; `(cd build && bun test)` 869 pass;
  `make docs-verify` green; `bash pkgs/mosd/apid/ui/build.sh --check` green
  (134 UI tests). `cargo fmt` and `cargo clippy` were NOT run: the image
  ships only cargo, rustc and std.

  A pre-existing flake in `-p apid`, found on the way and not fixed here:
  three runs each failed exactly one test and passed the other 316, a
  different test each time and each passing on its own.
  `auth::a_refused_attempt_does_not_rewrite_the_file` is the clearest -- one
  failure arms a `BACKOFF_BASE` = 1 second lockout, and the test then requires
  50 consecutive `GuardStore::begin_attempt()` calls, each of which reads and
  compares the persisted guard file, to all land inside that one second. On a
  loaded machine they do not, the window lapses, and the assert reads "still
  throttled". `reset::a_successful_rotation_clears_the_login_guard...` (429
  expected, 201 seen) and
  `settings_signal::the_settings_changed_subscription_feeds_the_access_cache`
  (a `settles()` poll on a dropped bus stream) have the same shape. None of
  the three is near this change, which touches neither auth nor the settings
  signal; the clean runs were taken at load average ~1.6.
