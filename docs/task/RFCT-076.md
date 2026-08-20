# RFCT-076 Start-up bundle discovery and the compatibility re-check

- **status**: complete — bundle discovery runs after the listeners bind and after `APID_LISTENING` is printed, returns no error to `main`, and §6.1's class-3 and class-5 re-checks are wired to §2.1's served set
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-20 17:20
- **claimedAt**: 2026-08-20 17:20
- **completedAt**: 2026-08-20 18:40

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2.
Branch `bkd/mtl0ftfr`. Base `0f4990f`, the campaign head carrying RFCT-071,
RFCT-072, RFCT-073, RFCT-074 and RFCT-080.

```
$ git rev-parse HEAD
0f4990fd7e21a5be7ac70bb01d438d1ff6ea7f9a
$ git merge-base --is-ancestor 0f4990f HEAD && echo BASE-OK
BASE-OK
$ test -f mosd/apid/src/bundle.rs && test -f mosd/apid/src/assets/serve.rs && echo DEPS-OK
DEPS-OK
```

RFCT-071's `Store` and RFCT-074's router were both present at that base and
were consumed exactly as merged. `main` is at `b4b7c72` and carries neither, so
`DEPS-OK` printing is positive evidence of the right base rather than the
absence of a complaint.

## Description

RFCT-071 built every disk operation this task needs — `discover_staged`,
`pick_up_staged`, `activate`, `recheck_active`, `deactivate` — and RFCT-074
recorded that none of them was called from `main`. This task is that call, and
it is wired **under a constraint that outranks the feature**.

What it makes true, in one sentence: **a bundle on DATA is picked up,
re-checked against the API versions this binary actually serves, and taken down
when — and only when — it can talk to none of them; and none of that can stop
apid from listening.**

## Deliverable

| file | what |
| --- | --- |
| `mosd/apid/src/startup.rs` | new. The served-set constant, `discover`/`run`/`evaluate`, §6.1 classes 3 and 5, and thirteen `#[cfg(test)]` tests |
| `mosd/apid/src/main.rs` | one `mod startup;` line in alphabetical position, and eleven lines after `println!("APID_LISTENING …")` |
| `docs/task/RFCT-076.md`, `docs/task/index.md` | this record and its row |

```
$ git diff --name-only 0f4990f..HEAD
docs/task/RFCT-076.md
docs/task/index.md
mosd/apid/src/main.rs
mosd/apid/src/startup.rs
```

`routes.rs` and `tests.rs` were **not** touched — RFCT-075 owns both — and
neither was `bundle.rs`, `assets/*.rs`, `os/**`, `Makefile`, `docs/design/**`,
`docs/README.md`, `Cargo.toml` or `Cargo.lock`. **No dependency was added**;
the log-capture harness the tests use is built on `tracing-subscriber`, already
a direct dependency, and the temporary roots on `tempfile`, already a
dev-dependency.

**No `AppState` field was needed**, which is what made the fence holdable:
`AppState::bundles()` is already `pub(crate)` and `Store` already derives
`Clone`, so `main` hands `startup::discover` a clone of the store the asset
router reads and holds the result itself.

## The constraint, and the evidence that it holds

§6.1, repeated by §8.2 phase 4 as scope rather than as an implementation detail:

> Bundle discovery and evaluation must happen after the listeners bind and
> after `APID_LISTENING` is printed, and every possible outcome must be a state
> the daemon holds, never an error it returns. A bundle must not be able to
> stop apid from listening.

Three things enforce it, in increasing order of paranoia:

1. **Position.** The call sits at `mosd/apid/src/main.rs:83`, after the HTTPS
   listener binds (`:62`), after the HTTP listener binds (`:66`) and after
   `println!("APID_LISTENING …")` (`:72`).
2. **Type.** `startup::discover` returns `BundleState`, which has **no error
   variant**. `main` cannot propagate one by accident because there is nothing
   to propagate; the `?` that every step above line 72 uses has nothing to
   attach to. Nothing in `startup.rs` calls `unwrap`, `expect` or `panic!`
   outside `#[cfg(test)]`.
3. **Containment.** The work runs on `tokio::task::spawn_blocking`. That keeps
   a full-tree SHA-256 off an async worker, and it means a panic raised in code
   this module only *calls* — `bundle.rs`, which this task may not edit —
   arrives as a `JoinError` and becomes `BundleState::Unavailable` instead of
   unwinding `main`.

`BundleState` is total: `BuiltIn`, `Active`, `Deactivated` and `Unavailable`.
Every path through the module ends at one of the four.

### The test that the claim is worth exactly as much as

`no_hostile_store_can_stop_start_up` builds **nineteen** deliberately hostile
stores and runs the real entry point against each. The assertion is a **named
set** — which roots returned normally, diffed against which roots were built —
so a regression names the root that broke. `catch_unwind` is what makes the
diff possible: without it the first panic aborts the test and the remaining
roots are never tried.

All nineteen returned, and each resolved to a defined state:

```
  absent-root:                        no custom bundle is active; the built-in UI is being served
  root-is-a-regular-file:             could not be evaluated: read link …/current: Not a directory (os error 20)
  root-is-a-dangling-symlink:         no custom bundle is active; the built-in UI is being served
  root-is-unreadable (mode 000):      no custom bundle is active; the built-in UI is being served
  bundles-is-a-regular-file:          generation 1 is active: unchecked — no manifest
  current-dangles-into-nowhere:       generation 7 is active: unchecked — no manifest
  current-points-outside-the-store:   generation 1 is active: unchecked — no manifest
  current-is-a-regular-file:          could not be evaluated: read link …/current: Invalid argument (os error 22)
  current-is-a-directory:             could not be evaluated: read link …/current: Invalid argument (os error 22)
  current-target-is-not-numeric:      no custom bundle is active; the built-in UI is being served
  generation-is-a-regular-file:       generation 1 is active: unchecked — no manifest
  tree-contains-a-socket:             generation 1 is active: unchecked — no manifest
  record-is-garbage:                  generation 1 is active: unchecked — no manifest
  record-is-a-directory:              could not be evaluated: read …/records/1.json: Is a directory (os error 21)
  manifest-is-garbage:                generation 1 is active: unchecked — no manifest
  manifest-declares-no-versions:      generation 1 was deactivated: declared [] ∩ served ["v1"] = ∅ (class 5)
  staged-tree-contains-a-symlink:     no custom bundle is active; the built-in UI is being served
  staged-generation-overflows-u64:    no custom bundle is active; the built-in UI is being served
  staging-is-a-regular-file:          no custom bundle is active; the built-in UI is being served
```

**Negative-tested.** The `Err` arm of the store read was replaced with a
`panic!` and the test failed naming the four roots that reach it — not a count:

```
$ cargo nextest run -p apid -E 'test(no_hostile_store)'
FAIL [0.018s] (1/1) apid::bin/apid startup::tests::no_hostile_store_can_stop_start_up
start-up did not return for ["current-is-a-directory", "current-is-a-regular-file",
"record-is-a-directory", "root-is-a-regular-file"]; a bundle that can do this is a
crash loop with no listener bound
```

The injection was reverted immediately; it exists only in this record.

## The served-set constant

**Where it lives:** `mosd/apid/src/startup.rs`, as two items —

```rust
pub const SERVED_API_VERSIONS: &[&str] = &["v1"];
pub const CURRENT_API_VERSION: &str = "v1";
```

**How many versions it holds: one — `v1`.** That is §2.1's array as it stands
today (`{"versions":["v1"],"current":"v1"}`), and `current` is a member of it,
which §2.1 requires and `the_served_set_is_the_array_2_1_specifies` asserts as
a named-set diff rather than as a length.

**`GET /api/versions` was NOT landed.** It is unauthenticated and is therefore
an authentication decision, which §8.2 phase 2 reviews as a set rather than one
route at a time. RFCT-074's reservation still 404s the whole `/api/` subtree,
`/api/versions` included, and `the_api_reservation_answers_every_shape_with_the_envelope`
still passes unchanged. When phase 2 lands the route it serves this constant
rather than a second copy of it.

**The constant is read, not merely defined.** `run` is the only chooser of a
served set and it chooses `SERVED_API_VERSIONS`; `evaluate(store, served)`
takes the set as a parameter so the A/B case is reachable in a test.
`run_reads_the_served_set_constant` asserts it in both directions: a bundle
activated against a served set of `["v0"]` is deactivated by `run` with
`served=["v1"]` in the log line, and a bundle declaring `["v1"]` survives.
`CURRENT_API_VERSION` is read too — it goes into every start-up log line, so
deleting it fails to compile under `-D warnings`.

## §6.1 class 5: the relation is intersection, and the test that proves it

> An escape hatch that fires on the wrong condition is worse than one that does
> not exist, because the operator will trust it.

`a_bundle_matching_only_the_outgoing_major_stays_active` is the control for
that sentence. Served set `["v1","v2"]` with `current = "v2"`; the bundle
declares `["v1"]` only. Three assertions, and the third is what makes the first
two mean anything:

1. the bundle stays **active**;
2. the intersection is the **named set** `{"v1"}` — which member, not how many;
3. `current` (`"v2"`) is **not** in the declared range, so an implementation
   written as equality-against-`current` would have deactivated this bundle.

**Negative-tested.** The membership test was replaced with equality against the
served set's last member:

```
$ cargo nextest run -p apid -E 'test(startup::)'
FAIL (10/13) apid::bin/apid startup::tests::a_bundle_matching_only_the_outgoing_major_stays_active
a bundle matching the outgoing major must stay active, got generation 1 was deactivated
at start-up: declared API versions ["v1"] have no member in common with the served set
["v1", "v2"] (§6.1 class 5)
```

Two things in that output are the point. **Exactly one** of the thirteen tests
caught the bug — `an_empty_intersection_deactivates_and_the_log_names_both_sets`
passes happily under it — so this test is the entire control. And the failure
message prints the deactivation's own claim, *"declared `["v1"]` have no member
in common with the served set `["v1","v2"]`"*, which is visibly a lie: logging
both sets is what turns §6.1's *"indistinguishable from a correct one"* into
something an operator can read back. The patch was reverted immediately.

## The tests

| test | asserts |
| --- | --- |
| `no_hostile_store_can_stop_start_up` | nineteen hostile roots, every one returns; named-set diff |
| `a_panic_beneath_discovery_becomes_a_state_and_not_an_unwind` | a panic below this module arrives as a `JoinError` and becomes `Unavailable` |
| `the_served_set_is_the_array_2_1_specifies` | the set is `{v1}` by identity, has no duplicate, and contains `current` |
| `run_reads_the_served_set_constant` | the constant is fed to the class-5 check, both directions |
| `an_intersecting_range_stays_active` | declared `[v1,v2,v3]` ∩ served `[v1,v2]` = `{v1,v2}` by name; stays active |
| `a_bundle_matching_only_the_outgoing_major_stays_active` | §2.1's dual-major case; see above |
| `an_empty_intersection_deactivates_and_the_log_names_both_sets` | the A/B case; pointer gone, **tree still on disk**, log carries `declared=["v1"] served=["v2"]` |
| `a_bundle_with_no_manifest_stays_active_and_is_recorded_unchecked` | `CompatCheck::NotRun`, and the on-disk record says so |
| `a_digest_mismatch_deactivates_and_logs` | a file planted into the served tree; deactivated, mismatch logged, tree kept |
| `an_absent_srv_ui_is_normal_operation_and_not_an_error` | `BuiltIn`, the log carries **no `WARN` and no `ERROR`**, and the root is still not created |
| `a_staged_directory_is_picked_up_at_start_up` | §8.2 phase 4's second local install path |
| `an_unactivatable_staged_tree_does_not_stop_the_recheck` | a refused staged tree is logged and the active bundle is untouched |
| `discover_holds_the_state_for_a_real_store` | the async entry point `main` actually calls, end to end |

The class-1 test asserts on the **absence of a level**, not on the absence of a
failure: §6.1 says class 1 *"is the shipped state of every device and it must
not be logged as one"*, so the log is captured and searched for `WARN` and
`ERROR`. The capture harness is a `MakeWriter` into a `String` scoped by
`tracing::subscriber::with_default`, so the assertions are made against the
bytes the daemon would actually write.

## Checks run — prediction before, observation after

Predicted per term, before running.

| check | predicted | observed |
| --- | --- | --- |
| `bash docs/verify-index.sh` | **252/252** = 249 base + 3 (section 3 is forward + reverse + once-each per record, and this adds one record and one row) | `249/249 PASS` → **`252/252 PASS`** |
| `bash docs/verify-index-test.sh` | **8/8**, unchanged — no assertion added to the verifier | `RESULT: PASS (8/8 cases)` |
| `bash mosd/hack/check.sh` | **374 tests** = 361 base + 13 new; `ALL CHECKS PASSED` | `374 tests run: 374 passed, 0 skipped`; `ALL CHECKS PASSED` |
| `make os-image-cx3576-v2` | assembles | assembled |
| `make os-verify-cx3576-v2` | **323/323**, and it **must not move** — this task adds no verifier assertion, so a moved number would mean the fence was exceeded | `RESULT: PASS (323/323 checks)` |

The image verifier prediction is a control on scope rather than on function: a
number predicted *not* to move says the fence held before the diff does.

`BOARD_DIR=/srv/ai/mos/board/cx3576` — the main checkout's prebuilt BSP
artifacts, because a BKD worktree has none. That shortcut is valid **only**
because this task changes nothing under `board/`, and it changes nothing under
`board/`. The image pair is not skippable: this task compiles into `apid`,
which is packed into the verity squashfs, so an aarch64 cross-build failure is
exactly what the host-side checks cannot see.

## Findings — reported, not designed around

**F1. §6.1 and §8.2 phase 4 cite a crate and a unit file that no longer exist
under those names.** Both sections were written against `86cd669`, before the
`webd` → `apid` rename. The substance holds exactly; only the paths are stale.

| citation in `docs/design/api.md` | in the tree at `0f4990f` |
| --- | --- |
| `mosd/webd/src/main.rs:50` `Config::from_env()?` | `mosd/apid/src/main.rs:52` |
| `mosd/webd/src/main.rs:51` `ensure_state_dir` | `:53` |
| `mosd/webd/src/main.rs:53`, `:54` TLS loads | `:55`, `:56` |
| `mosd/webd/src/main.rs:59`, `:63` the two binds | `:61`, `:65` |
| `mosd/webd/src/main.rs:69` `WEBD_LISTENING` | `:71`, and the marker is **`APID_LISTENING`** |
| `mosd/dist/webd.service:9` `Restart=on-failure` | **`mosd/dist/apid.service:9`**, line number correct |

`grep -c 'mosd/webd/' docs/design/api.md` is **155**, so this is a
document-wide drift and not a §6.1 defect. `docs/design/api.md` was not edited;
reconciliation is a later task's. The `?`-chain-then-bind-then-print ordering
the constraint is derived from is real and was re-measured, which is the part
that mattered.

**F2. §6.1 class 3 cannot see a tree that was never activated through the
store, and that is the spec's own scope rather than a gap in this wiring.**
`Store::recheck_active` computes `digest_matches` as
`self.read_record(generation)?.map(…)` — `None` when no record exists — and
`Recheck::corrupt()` is `digest_matches == Some(false)`. So a tree an operator
drops into `bundles/7` and points `current` at reads as *"active, unchecked"*,
not as corrupt. Four of the nineteen hostile roots land exactly there. §6.1
writes class 3 as *"digest **recorded at activation**, re-checked"*, so this is
in scope by construction; §5.3 models it explicitly with
`CustomUi.recorded: Option<…>` and the comment *"a tree placed under `bundles/`
by hand"*. **It is not a safety hole**: such a tree is still subject to §6.1
classes 1, 2 and 4 at the asset router on every request, so a `bundles/1` that
is a regular file or an index that will not open serves the built-in UI.

**F3. A corrupted activation record silently downgrades class 3 from "mismatch"
to "unchecked".** `Store::read_record` ends in `serde_json::from_slice(&bytes).ok()`,
so `records/<gen>.json` full of garbage is indistinguishable from an absent
record — the `record-is-garbage` root above reports *"active, unchecked"*. An
operator with a root shell who corrupts the tree *and* the record escapes the
start-up check. The honest counterweight is that the same operator can simply
delete the record, and §6.1 already concedes class 3 is *"a case an operator
caused with a root shell"*. **Not closed here**: the `.ok()` is in `bundle.rs`,
which this task may not edit, and distinguishing "absent" from "unparsable"
changes `read_record`'s signature. It belongs to whoever next owns §5.3.

**F4. `"apiVersions": []` deactivates, and it should be read as intended
rather than as an edge case.** An empty declared range intersects nothing, so
§6.1's *"empty intersection and nothing else"* fires. That is the letter of the
rule and it is also the right answer — a bundle declaring no API versions has
declared that it can talk to none — but it is worth naming, because it is the
one input where "the bundle carries a manifest" and "nothing could be checked"
are **not** the same thing: an absent manifest is `NotRun` and stays active, an
empty array is `Ran { compatible: false }` and does not.

**F5. `Store::pick_up_staged` tries only the highest staged generation.** It is
`self.discover_staged()?.pop()`, so a store with `.staging-3` and `.staging-9`
where 9 is invalid leaves 3 staged and un-activated until the next start-up
after 9 is removed. Consumed as merged and not worked around; `discover_staged`
is public if a later task wants a loop. This module logs the refusal and
continues to the re-check, which is asserted by
`an_unactivatable_staged_tree_does_not_stop_the_recheck`.

**F6. The start-up re-check delays the first served response by a full-tree
SHA-256, and that is a deliberate trade rather than an oversight.** `discover`
is awaited before the router is built, so the listeners are bound and the
kernel is accepting into the backlog while the digest runs, but nothing is
answered yet. The alternative — spawn discovery and serve concurrently — opens
a window in which a request is served from a bundle start-up is about to
deactivate, which is the escape hatch firing late on a UI the operator can see.
Sequencing was chosen. §6.1's property is about **binding**, and binding has
already happened.

**F7. The `mode 000` root does not exercise `EACCES`, because the tests run as
root.** `root-is-unreadable` returns `BuiltIn` rather than `Unavailable` — root
ignores the mode. The same class of gap RFCT-074 recorded as its F9, named here
rather than claimed. The `EACCES` path is `Err`-handled by construction (it is
the same `Err` arm as `ENOTDIR`, which **is** exercised by
`root-is-a-regular-file`), but that specific errno is not covered by a test.

**F8. `bundle.rs` still carries `#![allow(dead_code)]` and this task does not
remove it.** Its comment says *"the asset router and the start-up re-check that
consume it are separate phase-4 work"*, and both have now landed — but
`Store::delete`, `Store::generations` and several `Rejection` variants remain
uncalled outside tests, so removing the attribute would not compile.
`bundle.rs` is out of this task's fence in any case.

## Deliberately out of scope

- **`GET /api/versions`** — phase 2, on L1's explicit ruling. The constant is
  landed; the route is not, and `/api/` still 404s it.
- **`/builtin/` and §6.3's escape control** — the reserved prefix still does
  not exist.
- **The upload route, multipart, any archive dependency** — phase 5.
- **`routes.rs` and `tests.rs`** — RFCT-075's, untouched. No `AppState` field
  was needed; see the deliverable table.
- **Re-checking a *non-active* generation.** §6.1 says apid *"re-evaluates
  every activated bundle's declared range"*; `Store::recheck_active` evaluates
  the one `current` points at, which is the only one being served. A bundle
  kept by §5.3 step 5's prune-to-two is not reachable by any request, so
  evaluating it would produce a log line about something nobody can see.

## What is NOT claimed — hardware

**This work was not exercised on hardware.** Both overstatements are wrong and
both are avoided:

- Hardware **has** booted. A **v1** image reached the `mos login:` prompt on a
  real CX3576-Z, and the repart/maskrom and SPL-hash investigations ran against
  a real board. "Never booted" would be false.
- What has **never been exercised on hardware** is the **v2** stack — verity
  root, A/B, `rauc install`, and apid. "Verified on device" would be equally
  false.

**The start-up path in this task has never run on a device.** Every observation
above comes from a store in a temporary directory on the build host, plus an
aarch64 cross-build packed into a v2 image checked on the host. Nothing here
observed apid starting under systemd, `/srv/ui` on a mounted DATA partition, a
bundle surviving a reboot, or §8.2 phase 4 acceptance 4 — the actual A/B update
into an image serving only `v2`, which is the scenario class 5 exists for and
which only a real update can produce. The A/B case is simulated in a test by
passing a different served set to `evaluate`; that is a faithful model of the
comparison and is **not** a model of the update.
