# RFCT-341 A clock seam for the automatic driver, and its tests

- **status**: completed
- **priority**: P1
- **owner**: bkd/garx2gfy
- **createdAt**: 2026-09-06 21:40

> The index line in `docs/task/index.md` is written by L1, not by this task.
> `scripts/task-state.sh claim` was deliberately not used: it edits the index
> under a lock, and this branch must not touch it.

## Description

`pkgs/mosd/mosd/src/update_auto.rs` (515 lines) and
`pkgs/mosd/mosd/src/update_suppress.rs` (244 lines) carry no tests. That is the
whole of PLAN-071's U2/U3/U4/U5 — check, fetch, re-check, install, reboot under
policy, suppression — and nothing exercises it. RFCT-317 and RFCT-321 both
declared the debt at the time rather than hiding it.

The reason is mechanical rather than neglect: `AutoDriver`'s cadence is keyed on
`std::time::Instant`, which has no seam and which `tokio::time::pause` does not
move, so the driver cannot be ticked in a test at all. Every other owed row in
`docs/design/updates.md` §6 sits under that one blocker.

So: the seam first, then the tests.

## ActiveForm

Added the cadence seam and the tests it unblocks

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- A cadence seam that lets a test advance the driver's notion of now without
  sleeping, with a comment at the site saying what it is for and why it cannot
  bypass the trusted-clock floor.
- U2: a test asserting the automatic and manual paths meet the same gate set.
- U3: the reboot gate with the never-arms-the-override invariant.
- U4: a full bad-bundle cycle; the second automatic pass selects nothing.
- U5: each deferral reason reachable in a test.
- PLAN-071 §7's clock predicate: an automatic install requires a clock the
  device believes; checks and fetches are unaffected.
- Mutation evidence for the U2 same-gate-set property and the
  never-arms-the-override invariant.
- `cargo test --locked -p mosd -p apid`, `cargo fmt --all -- --check` and
  `cargo clippy --workspace --all-targets --locked -- -D warnings` green in
  `localhost/mos-build-rust-check:amd64`.
- `docs/design/updates.md` §6's owed-test table updated; `make docs-verify`
  green from a `git archive` into an empty directory.

## Notes

- **The seam is `update_auto::Cadence`, and it answers an `Instant` and
  nothing else.** `AutoDriver::new` takes one; `run` passes `SystemCadence`;
  a test passes `TestCadence`, which offsets a base instant by however far a
  test says. The narrowness is the point and is argued at the site: an
  `Instant` names no date, so nothing downstream of the seam can compute a
  maintenance-window verdict from it or claim the device believes its clock.
  Both wall-clock readings stay where they were — `AutoRoutes::clock` over
  `docs/design/time.md`'s floor for PLAN-071 §7's predicate, and `Utc::now()`
  for the window — so the seam cannot bypass either.

- **A second seam was needed for U2, and it is one line per route.**
  `BusRoutes` held an `InterfaceRef<MosdService>`, which needs a live bus
  connection and therefore could not be built in a unit test; its `AutoRoutes`
  implementation — the production one — was consequently unreachable. Those
  four calls are now the `ServedDaemon` trait, implemented for
  `InterfaceRef<MosdService>` in production and for the served object directly
  in the test. The delegation itself stays one piece of code, so the U2 test
  drives the real `BusRoutes` over the real `UpdateLifecycle` and the real
  `MosdService`, and what it substitutes is the `self.get().await` hop.
  zbus's `p2p` feature would have removed even that, but it is not enabled in
  this workspace and turning it on to make a test possible is a production
  dependency change for a test's benefit.

- **U5 is a criterion rather than a list.**
  `every_deferral_reason_the_driver_can_mint_is_reachable` compares the set
  eighteen scripted passes produced against `update_codes::DEFERRALS` — the
  closed vocabulary itself. A sixteenth code fails the test until a pass
  produces it, which a hand-written list of fifteen would not.

- **RFCT-339 landed first, and its named gap is closed rather than
  duplicated.** Its `feat(update): enumerated failure codes` reached main at
  `baa16afb` while this branch was in flight, and `docs/design/updates.md` §6
  recorded the limit in terms: *"Which reason the driver chooses for a given
  failure is not [proven], and cannot be until the clock seam above lands."*
  After merging main, the U5 test asserts against RFCT-339's vocabulary rather
  than against strings of its own, so the two halves meet — its test proves
  what the recording site may carry, this one proves which code the driver
  picks. `update_codes::DEFERRALS` became `pub` for it, with the reason
  written at the array. The overlapping half of this branch's lifecycle test
  was cut back to the replacement path RFCT-339's test resumes past.

- **Eight mutations, each compiled and each red at the test level**, re-run
  against the merged tree: the automatic install route ceasing to call
  `InstallUpdate` (3 tests red); the driver dropping its own window check (2);
  the manual install route dropping the window gate (3); the automatic reboot
  route arming the override to get through (2); the driver reading a closed
  reboot gate as an open one (2); each of the two suppression consultations
  removed (2 each); and a sixteenth deferral code no pass produces (3). The
  pre-install consultation initially
  reddened only the deferral table — the earlier consultation refused before
  the pass reached it — so the bad-bundle cycle test was extended to exercise
  that site on its own rather than leave a guard nothing measured.

- **What remains untestable without hardware.** PLAN-071 U10 survives
  unchanged and is expected to: the bench cycle verifies a real bootloader
  spending real boot credits and a real slot falling back, and nothing on this
  host observes that half of the loop. It stays blocking for shipping `auto`.
  Also still owed, and now the only other open row: the apid clearing route's
  200/422/audit — `openapi.json` documents it and
  `apid/src/tests/update_api.rs` has no case for it. The store half beneath it
  is covered.

- **Verification.** In `localhost/mos-build-rust-check:amd64`, source mounted
  at `/src`: `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets --locked -- -D warnings`,
  `cargo test --locked -p mosd -p apid` (apid 324, mosd 558 unit + 1
  `bus_roundtrip` + 7 scan), `cargo test --doc --workspace --locked` and
  `cargo deny check licenses bans advisories` — all green after merging main.
  mosd's unit count rose from 537 (main, post-RFCT-339) to 558.
