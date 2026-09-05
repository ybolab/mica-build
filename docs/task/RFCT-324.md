# RFCT-324 An apid log-capture test races on tracing's interest cache

- **status**: completed
- **priority**: P1
- **owner**: apid-log-capture-race/bkd-a7hb17jj
- **createdAt**: 2026-09-05 04:00

## Description

`main` is red under the default `cargo test`. One apid test fails in parallel
and passes alone:

```
panicked at apid/src/startup.rs:458:
§6.1 requires both the declared range and the served set in the line:
the log does not name ["declared=[\"v1\"]", "served=[\"v2\"]"]
--- log ---
```

`startup::tests::an_empty_intersection_deactivates_and_the_log_names_both_sets`
asserts what §6.1 requires of the class-5 line, and the product emits that
line correctly in every one of the failures. The log the test reads is empty,
so it is the capture that fails, not the assertion. The test predates this
week (`69febcae`); the merges that landed since added tests that now win the
race.

## ActiveForm

Taking apid's log capture off `tracing`'s process-global interest cache.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The failing test passes in parallel, shown under contention, with the method
  and the run count recorded.
- NOT fixed by `--test-threads=1`: that hides every future race of this shape.
- NOT fixed by deleting or ignoring the assertion. §6.1 requires both sets in
  the line and this is the only thing checking it.
- Whether this is the same root cause as any of the three RFCT-303 reported
  and did not change is stated, and whether the same fix reaches them.
- `cargo test --locked -p mosd-settings -p mosd -p apid --no-fail-fast` green,
  each binary's line quoted.
- `make os-rust-gate` green.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`
  untouched.

- complete: the capture was already scoped; what was global was the interest
  cache underneath it.

  **The hypothesis in the report is not what happened.** `capture` already used
  `tracing::subscriber::with_default`, so no global subscriber was ever
  competing with it for the events, and there is no `set_global_default` in
  this binary. Scoping the subscriber is necessary and it is not sufficient,
  because whether an event is dispatched at all is decided before any
  subscriber is consulted.

  **Root cause.** `tracing` caches an `Interest` per callsite, computed the
  first time that callsite is reached from the dispatchers registered at that
  instant, and a cached `never` is never reconsidered — the macro short-circuits
  and no subscriber, scoped or not, sees the event. In tracing-core 0.1.36 two
  routes produce `never`:

  - `callsite.rs`'s `Rebuilder::JustOne` — taken whenever the last
    `register_dispatch` left one live dispatcher, which is the normal state
    here because the capture dispatchers are short-lived — resolves the
    interest through `dispatcher::get_default`, i.e. through the *calling
    thread's* default. On a thread that is not capturing that is the global
    `NoSubscriber`, whose `register_callsite` returns `Interest::never()`.
  - `rebuild_callsite_interest` ends in `interest.unwrap_or_else(Interest::never)`,
    so a rebuild that sees no live registrar at all reaches the same value.

  A thread that reaches a log callsite while holding no dispatcher of its own
  therefore caches `never` for it, for the whole process. In this binary such
  threads exist: `no_hostile_store_can_stop_start_up` drives `run()` over the
  `manifest-declares-no-versions` root — an empty declared set, so an empty
  intersection, so the class-5 `warn!` — with no subscriber anywhere, and
  `startup::discover` runs its body on `tokio::task::spawn_blocking`, i.e. on
  a pool thread that never carries a test's scoped subscriber.

  **Why only in parallel.** The poisoning is healed by the next
  `Dispatch::new`, which rebuilds every registered callsite against the live
  dispatchers — and `capture` performs exactly that rebuild on its way in. So
  the interleaving that fails is narrow: the poisoning has to land *after* the
  victim's `Dispatch::new` and *before* the victim's own event. Serially that
  is unreachable, because the healing rebuild always precedes the event; which
  is why `--test-threads=1` passed 319 tests and proved nothing.

  **The fix.** `Interested`, a subscriber that reports `Interest::always()` for
  every callsite and discards every event, registered once for the life of the
  test binary by `capture` before it installs the scoped subscriber and before
  it runs the closure. One always-interested dispatcher permanently registered
  closes both routes: `get_default` on any thread now yields at least this one,
  and the live-registrar list is never empty. Where events go is unchanged —
  `with_default` still routes them to the capturing subscriber on the capturing
  thread, and they reach `Interested` only on threads that are not capturing,
  which drop them. The capture stays per test; nothing became process-wide
  except the floor that keeps `never` unreachable.

  **Shown red before green, deterministically.** A second thread was injected
  into the victim at the exact point its assumption lives — inside `capture`'s
  closure, holding no subscriber, reaching the class-5 callsite via
  `std::thread::scope` so the order is fixed rather than raced. Against the
  pre-fix sources that reproduces the reported failure exactly: same panic
  site, same message, same empty log. Against the post-fix sources, with the
  identical injection, it passes. The injection was then removed; `git status`
  does not carry it.

  **Shown under contention.** A labelled container running busy loops held the
  host's 1-minute load average at 23-28 for the pre-merge rows and 12-16 for
  the merged-tree rows. Runs at that load:

  | what | runs | result |
  | --- | --- | --- |
  | pre-fix, `startup::` filter, default parallel, `--cpus=0.25` | 200 | 200 pass — the natural race did not reproduce |
  | pre-fix, `startup::` filter, `--test-threads=32`, `--cpus=0.25` | 200 | 200 pass |
  | pre-fix, victim + poisoner only, `--test-threads=2` | 100 | 100 pass |
  | **pre-fix, victim with the injection** | **1** | **FAILED — the reported panic, verbatim** |
  | post-fix, victim with the injection | 5 | 5 pass |
  | post-fix, `startup::` filter, `--test-threads=32` | 400 | 400 pass |
  | post-fix, whole binary, default parallel | 25 | 25 pass |
  | post-fix on the merged tree, `startup::`, `--test-threads=32` | 400 | 400 pass |
  | post-fix on the merged tree, whole binary, default parallel | 15 | 15 pass |
  | post-fix on the final tree, `startup::`, `--test-threads=32` | 300 | 300 pass |
  | post-fix on the final tree, whole binary, default parallel | 10 | 10 pass |

  The natural race is rare — 500 unsuccessful pre-fix attempts before the
  injection — which is the same shape RFCT-303 reported and the reason the
  injection is the evidence rather than the run count. A pre-fix run of the
  whole binary was started and killed before it reported, so there is no
  measured pre-fix whole-binary row and none is claimed.

  **A measurement note for this family.** RFCT-303's starvation recipe does not
  work on a *concurrency* race. Under `--cpus=0.25`, `nproc` still reports 8
  but `std::thread::available_parallelism()` returns `Ok(1)`, because it reads
  the cgroup's `cpu.max` — so libtest defaults to one thread and the race is
  serialised rather than provoked. `--test-threads` has to be passed
  explicitly, and it was in the rows above.

  **The assertion is still load-bearing.** Checked by mutation: dropping
  `served = ?served` from the class-5 `warn!` fails the test on its own
  message, naming `served=["v2"]` as missing. The mutation was reverted.

  **The three RFCT-303 left: a different root cause, and this fix does not
  reach them.** RFCT-303's family are wall-clock races — an assertion that
  requires N operations to fit inside a fixed window, or a fixed sleep that has
  to out-last or under-cut a real operation. This one contains no sleep, no
  window and no deadline. It turns on the order in which two threads first
  arrive at a callsite, and it fails the same way on an idle machine that
  happens to schedule them that way; load only changes how often the order
  comes out wrong. Specifically:

  - `apid`'s `a_concurrent_collection_is_refused_not_queued` sleeps 30 ms and
    requires the second POST to land inside a 150 ms collection. Wall-clock,
    no log capture, untouched by an interest floor. Unchanged.
  - `mosd`'s
    `concurrent_transient_password_writes_stay_serialized_by_the_apply_lock`
    sleeps 50 ms and requires the second write to *not* have landed. Wall-clock,
    and still the riskiest of the family for RFCT-303's reason — a stall makes
    it pass while asserting nothing. Nothing here changes it. Unchanged.
  - `mosd`'s `wait_for_install_status` and `settled`, and apid's `settles`, are
    bounded polls whose budget stretches with load. RFCT-303 judged them the
    correct shape and nothing found here contradicts that. Unchanged.

  **A fourth of *this* shape, reported and not changed.**
  `mosd/src/reconciler/network.rs:1568` captures with `tracing::subscriber::set_default`
  and is structurally identical, but it has no poisoner today: the callsite it
  asserts on (`network.rs:705`, "could not delete network device") is only
  reached when `delete_link` fails during an apply, and the only reconciler
  wired with `FailingLink` is that same capturing test. The other `FailingLink`
  user drives `KeyRotation`, whose delete failure is returned rather than
  logged, so it never reaches 705. It becomes this defect the moment a second
  test makes an apply's `delete_link` fail. Named here so the next person does
  not have to re-derive it; changing it would be an unforced edit to a crate
  this task did not otherwise touch.

  Not changed, and why:

  - The product. `evaluate` emitted the class-5 line correctly in every
    failure; what went missing was the test's ability to see it.
  - `--test-threads`. Nothing in the repository was serialised.
  - The assertion. It is the only check that §6.1's line names both sets.


  **Verified** on the tree this branch carries, `main` at `e23a71a4` merged in:

  - `cargo test --locked -p mosd-settings -p mosd -p apid --no-fail-fast`
    green. apid 319 passed; apid `tests/e2e.rs` 1 passed; mosd 503 passed;
    mosd `tests/bus.rs` 1 passed; mosd `tests/scan.rs` 7 passed;
    mosd-settings 56 passed; `tests/settings.rs` 54 passed; doc-tests 0.
  - `make os-rust-gate`: **`RUST GATE PASSED (mosd rauc-sign)`** — fmt, clippy
    at `-D warnings`, doctests and cargo-deny for both workspaces, with
    nextest `988 tests run: 988 passed, 0 skipped` for `pkgs/mosd` and
    `62 tests run: 62 passed, 0 skipped` for `pkgs/rauc-sign`. `--all-targets`
    compiles the apid bin's test harness, so the added code is inside what
    clippy linted.

  **The gate took three merges to reach green, and none of the three defects
  was this change.** They were found, reproduced against a clean detached
  worktree at `4fc8e839` with this change absent, and fixed on `main` by other
  work while this task was in flight:

  1. `cargo fmt --check` diffs in `apid/src/routes.rs` and
     `apid/src/tests/provisioning_api.rs` — fixed by RFCT-323.
  2. clippy `collapsible_if` at `apid/src/routes.rs:6174`, which `check.sh`
     had been masking by failing on (1) first — fixed by RFCT-323.
  3. `pkgs/rauc-sign`'s `update::the_cli_reports_readiness_with_its_own_exit_code`
     at `tests/update.rs:1668`, exit 1 with `rauc-update: No such file or
     directory (os error 2)` where 3 was expected. Reproduced on a *fresh*
     target directory, so not a stale-cache artifact; traced to the F7/F8/F9
     baked-anchor work — fixed by RFCT-325.

  An earlier pass here repaired (1) and (2) locally and reverted the repairs
  once RFCT-323 landed the same fixes on `main`. Those files are untouched by
  this branch.
