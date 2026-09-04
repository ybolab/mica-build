# RFCT-303 Three apid tests assert on wall-clock speed

- **status**: completed
- **priority**: P2
- **owner**: apid-wall-clock-test-races/bkd-n0utp24l
- **createdAt**: 2026-09-04 15:00

## Description

RFCT-300 recorded a flake it did not fix: three `-p apid` runs each failed
exactly one test and passed the other 316, a different test each time, each
passing on its own, and only while other builds loaded the machine. All three
are test defects. The product behaved correctly in every one of the failures,
which is what makes them test defects rather than product ones.

- `auth::a_refused_attempt_does_not_rewrite_the_file` arms a `BACKOFF_BASE` =
  1 second window with one failure and then asserts that 50 consecutive
  `GuardStore::begin_attempt()` calls are all refused. All 50 have to land
  inside that one second. On a loaded machine they do not, the window lapses,
  the attempt is admitted, and the assertion reads "still throttled" about a
  guard that expired on schedule.
- `reset::a_successful_rotation_clears_the_login_guard_and_a_refused_one_does_not`
  arms the same one-second window through the HTTP surface and then requires
  three more requests -- a probe, a rotation, and a login -- to complete
  inside it. The reported failure is the last one: 201 where 429 was
  expected, because the window had lapsed and the correct password was
  correctly accepted.
- `settings_signal::the_settings_changed_subscription_feeds_the_access_cache`
  polls for the lapse a dropped bus produces, giving the daemon's death and
  the runtime's rescheduling a fixed number of polls to happen in. It also
  waits a flat 100 ms for a signal that must NOT invalidate the cache, which
  fails the other way: a signal slower than the wait makes the assertion
  vacuous rather than red.

## ActiveForm

Taking three apid tests off the wall clock.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- Each of the three stops depending on how fast the machine is: the clock is
  controlled, the guard's state is asserted instead of its window being
  raced, or the loop is bounded by the event that matters.
- NOT fixed by lengthening the window: a bigger number is the same race.
- NOT fixed by retrying or by marking them flaky.
- Whether the same shape exists elsewhere in the suite is stated.
- The fix is shown under load, not on an idle machine, over repeated runs.
- `cargo test --locked -p mosd -p apid`, `(cd verify && bun test)`,
  `(cd build && bun test)`, `make docs-verify` green.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`
  untouched.

- complete: all three now assert on state or on an event, and none of them on
  how fast the machine is.

  **`auth::a_refused_attempt_does_not_rewrite_the_file`.** The loop stops at
  the first ADMITTED attempt instead of requiring fifty refusals, and asserts
  the file's bytes and mtime once per refusal. An admission is the window
  expiring on schedule, which is the product working and legitimately writes,
  so it is no longer something the test can fail on. The count is evidence
  (`refused > 0`, or nothing above it was asserted) rather than a deadline.
  The run is separately seeded so the armed window is the curve's cap rather
  than `BACKOFF_BASE`'s one second, which stops the loop's first iteration
  from being the same one-second bet in miniature; that is the precondition,
  and the loop is what removes the race.

  **`reset::a_successful_rotation_clears_the_login_guard_and_a_refused_one_does_not`.**
  It no longer probes the guard with a second login request. `arm_the_guard`
  reads the state `GuardStore` persisted and requires `failures: 1` with a
  non-zero deadline; the refused rotation must leave that document byte for
  byte, and the successful one must leave `{failures: 0, locked_until_unix:
  0}`. That is `docs/design/access.md` §5.4's rule stated directly instead of
  inferred from a 429 that is only true inside a one-second window. The
  end-to-end 201 after the rotation is kept, now asserting what it actually
  shows — that the rotated credential works.

  **`settings_signal::the_settings_changed_subscription_feeds_the_access_cache`.**
  Two changes. The lapse is no longer polled for: the watcher tasks are
  joined first, and their exit is what performs the lapse, so a completed
  join IS the event. (Both joins were already at the end of the test; they
  moved above the assertions they make true.) And the flat 100 ms wait for a
  signal that must NOT invalidate the cache is gone — that one failed in the
  vacuous direction, passing whenever the signal was slower than the wait.
  In its place an access write follows the hostname write and
  `AccessCache::generation` is compared AFTER the join, when every signal the
  watcher was ever going to see has been seen: two bumps are owed, the access
  write's and the lapse's, and a third is the hostname write costing the
  cache.

  **Not fixed by a bigger number.** `BACKOFF_BASE` is untouched, no window was
  lengthened for a test's benefit, and `settles`' budget is unchanged. Nothing
  is retried and nothing is marked flaky.

  **The same shape does exist elsewhere; the pattern was copied.** Reported,
  not changed here:

  - `apid/src/tests/diagnostics.rs`'s
    `a_concurrent_collection_is_refused_not_queued` sleeps 30 ms and requires
    the second POST to land while the first collection is still running. Same
    shape; the slack is about a second rather than zero, so it is the least
    urgent.
  - `mosd/src/bus.rs`'s
    `concurrent_transient_password_writes_stay_serialized_by_the_apply_lock`
    sleeps 50 ms and then requires the second write to NOT have landed yet.
    That is the riskiest of the family, because a stall makes it pass while
    asserting nothing, the way the 100 ms wait above did.
  - `mosd`'s `wait_for_install_status` and `settled`, and apid's `settles`,
    are bounded polls for "eventually". Their budget is iterations of
    `sleep`, which stretches with load rather than expiring under it, so they
    are the correct shape for an asynchronous wait and are left alone.
  - `mosd/src/network_state.rs:1594` and apid's
    `slow_sources_are_abandoned_within_the_deadline` assert a product bound
    with seconds of slack. Those are the bound's own tests, not races.

  **Shown red before green, deterministically.** A scheduling stall was
  injected at the exact point each test's timing assumption lives -- 2 s
  before the auth loop, 1.5 s after the guard is armed in reset, 5 s before
  the watcher's `lapsed()` in settings_signal. Against the pre-fix sources all
  three fail, with the reported symptoms: `still throttled`; `left: 201, right:
  429` on "a refused rotation cleared the guard"; and the lapse assertion.
  Against the post-fix sources, with the identical injections, all three pass.

  **Shown under load, not on an idle machine.** The host runs 8 cores and was
  already carrying other agents' builds; a labelled container spinning eight
  busy loops was added on top, taking the 1-minute load average to 28-75 for
  the duration. Runs at that load:

  | what | runs | result |
  | --- | --- | --- |
  | pre-fix `-p apid`, whole suite | 20 | 20 pass -- the flake did not reproduce at this load |
  | pre-fix suite, `--test-threads 64` inside `--cpus=2` | 3 | 3 pass |
  | pre-fix `a_refused_attempt_does_not_rewrite_the_file`, `--cpus=0.25` with 400 spinners in-container | 3 | **2 failed** at `still throttled` |
  | post-fix `a_refused_attempt_does_not_rewrite_the_file`, same starvation | 6 | 6 pass |
  | post-fix `-p apid`, whole suite | 20 | 20 pass |

  The starved-container row is the one that matters: 20 whole-suite runs at
  load 28 did not reproduce it, which is why the report called it rare, and
  starving the cgroup did on the second attempt. The same condition is green
  eight times over after the fix.

  **The fixed tests still fail when the product is broken** -- checked by
  mutating the implementation, one mutation per test, each caught by its own
  message: dropping `GuardStore::with`'s changed-check (the mtime assertion
  fires), calling `record_success()` on the refused recovery path (the
  persisted-state comparison fires), and making `touches_access` match
  `hostname` (the generation count fires, `left: 5, right: 4`). All three
  mutations were reverted; `git status` carries none of them.

  Not changed, and why:

  - The product. Every one of these failures was the product behaving
    correctly -- a window expiring on time, a correct password being accepted
    once it had -- which is what makes them test defects.
  - `settles` itself. Its budget is 500 iterations of a 4 ms sleep, so under
    load it waits longer rather than expiring sooner; the two calls that
    remain are "eventually" waits in the safe direction.
  - The two copies of the shape named above, in `tests/diagnostics.rs` and
    `mosd/src/bus.rs`. They are real and they are not these three; changing
    them here would put untested edits in a fix that is about proving
    behaviour under load.

  Verified: `cargo test --locked -p mosd -p apid` green (318 apid + 1 e2e +
  492 mosd + 1 bus + 7 scan) in a container derived from
  `localhost/mos-build-rust:amd64` with `dbus` added; `(cd verify && bun
  test)` 1253 pass; `(cd build && bun test)` 869 pass; `make docs-verify`
  1636 PASS. `cargo fmt` and `cargo clippy` were NOT run: the image ships
  only cargo, rustc and std, and `/srv/mos-rust-tools` is empty on this host.
