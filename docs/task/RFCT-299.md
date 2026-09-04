# RFCT-299 Say what `/api/v1/time/status` means by a synchronized clock

- **status**: completed
- **priority**: P2
- **owner**: time-status-vocabulary/bkd-txd1prdv
- **createdAt**: 2026-09-04 10:00

## Description

`GET /api/v1/time/status` reported `synchronizing` on a bench cx3576 while
timesyncd held a usable sample. The classification is doing exactly what it was
written to do; the word it publishes is what misleads.

`time_status::classify` decides `synchronized` from timedate1's
`NTPSynchronized` and nothing else. That property is not "an NTP reply
arrived": timedated computes it as `adjtimex().maxerror < 16 s`, the kernel's
own bound on how wrong the clock may be. The two are legitimately different
claims, and they can disagree for a long time -- a sample timesyncd rejects as
a spike never reaches `clock_adjtime`, and `maxerror` then grows at the
kernel's tolerance until it crosses the bar, so a device holding good samples
can sit below it.

So the defect is vocabulary, not logic. `synchronizing` reads as "in progress,
nearly there"; what it actually asserts is "a server is selected and this
device does not report a bounded clock error", a state a device can hold
indefinitely.

## ActiveForm

Fixing the reported time-synchronization state's definition.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- A test that pins the bench state -- reachable timesyncd, selected server,
  usable sample, kernel bit clear -- and the state it must report, red before
  the change.
- The reported state no longer claims convergence it cannot observe.
- `docs/design/time.md` says what `synchronized` rests on, in terms of what
  `NTPSynchronized` actually measures, and what the other state does and does
  not assert.
- Every consumer of the wire string moves with it: openapi.json, the route
  documentation, the UI type and both locales.
- `cargo test` green for the crates touched; `(cd verify && bun test)`,
  `(cd build && bun test)` and `make docs-verify` green.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

- complete: the defect is the vocabulary, with evidence, and the reported
  state's definition is what changed. `synchronizing` is now `polling`.

  Reproduced from the tree, no device needed: `time_status::classify` is a
  pure function and the bench combination -- timesyncd reachable, a server
  selected, a usable sample (leap 0, stratum 2), timedate1's bit clear -- is
  the third branch of it. The new test drives exactly that evidence through
  `status_json` and was red with `left: String("synchronizing")`.

  Why it is vocabulary and not logic. `classify` decides `synchronized` from
  `ntp_synchronized` alone, and that value is timedate1's `NTPSynchronized`,
  which systemd v257's `src/timedate/timedated.c` computes as
  `adjtimex().maxerror < 16 s` -- the kernel's bound on how wrong the clock
  may be, not "an NTP reply arrived". The two are legitimately different
  claims and can disagree for a long time in one direction: timesyncd's
  `manager_receive_response` calls `manager_adjust_clock` only for a sample it
  does NOT flag as a spike (`src/timesync/timesyncd-manager.c`), and that call
  is the only thing that writes `maxerror` back down, so a device whose
  replies are all being rejected holds usable-looking samples while the bound
  grows past the bar. So reading the sample instead of the kernel bit would
  not be more correct -- it would answer a different question -- and
  `synchronizing`, which reads as "in progress, nearly there", publishes a
  prediction the device cannot make about a state it can hold indefinitely.
  `polling` names what is observed and promises nothing.

  Moved with the wire string: `SyncStatus::Polling` and `"polling"`,
  `routes.rs`, the regenerated `openapi.json`, `types.ts`, both i18n locales
  (and `synchronized`'s own label, which said "synchronized with network time"
  -- the same overclaim), the time-panel tests, `docs/design/time.md` section
  5 (which now states what `NTPSynchronized` measures and why the other state
  is not called `synchronizing`), the `time.status` evidence line in
  `docs/design/diagnostics.md`, and `docs/user/configuration.md` with its
  `docs/zh/` mirror.

  Not changed, and why:

  - **`ntp_synchronized: None` classifies the same as `Some(false)`.** A
    timedate1 property read that does not answer leaves the payload's
    `synchronized` member absent while the state still asserts the bound is
    not reported. That is a second, real defect on this path -- and choosing
    what to report when the signal is unreadable is a design decision (a sixth
    state, or `unknown` widened past "timesyncd is not on the bus", which its
    own doc comment currently forbids), so it is recorded rather than invented.
    It is also the one thing that would distinguish root causes on the bench:
    whether the device's response carried `"synchronized": false` or omitted
    the member entirely settles whether timedate1 answered at all.
  - `docs/plan/PLAN-044.md` still says `synchronizing`: it is the completed
    record of what that plan delivered, and `docs/design/time.md` owns the
    live contract.
  - `docs/zh/design/built-in-ui-design.md` (and its `uploads/` copy) lists
    "synchronized/synchronizing/offline/degraded". It is a Chinese-original UI
    requirements document that predates the implementation and already
    disagrees with it in three other ways (`offline/degraded` as two states, no
    `invalid-source`, no `unknown`); editing one token would make a stale list
    look checked.

  Verified: `cargo test --locked -p mosd -p apid` green;
  `(cd verify && bun test)` 1248 pass; `(cd build && bun test)` 869 pass;
  `make docs-verify` green; `bash pkgs/mosd/apid/ui/build.sh --check` green.
  `cargo fmt` and `cargo clippy` were NOT run: `localhost/mos-build-rust`
  ships only cargo, rustc and std.
