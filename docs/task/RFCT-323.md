# RFCT-323 The assertions RFCT-314 deleted, restored — and the suites nobody had run

- **status**: completed
- **priority**: P1
- **owner**: bkd/lgo55mjs
- **createdAt**: 2026-09-05
- **baseline**: `4fc8e839a96f1bcc2068d316386ae9329cd68221`
- **worktree**: `/srv/bkd/worktrees/33z9aa5q/lgo55mjs`, branch `bkd/lgo55mjs`

## Description

[RFCT-314](RFCT-314.md) moved the settings store to per-subsystem documents
under `/mos/config/` and deleted `migration.rs` with its twelve steps. Deleting
the `V0→V12` tests along with the chain they tested was right; two of them
covered properties that **still hold and had nothing asserting them**, and
RFCT-314 said so in its own §6:

> `v3_document_with_unknown_key_fails_to_load` — the fail-closed rule … nothing
> asserts it. … the four `newer_*` / `stripping_*` tests — the tolerant rollback
> load. The mechanism was ported and generalised over `serde_json`, and **none
> of the ported code has ever been executed.**

This task restores both in the shape the split gave them, adds the property the
split itself created (**a rollback in one document costs one document**), and
runs the three suites RFCT-314 named as never run.

**This task is the batch's stated exception to its no-tests rule** — writing and
running tests is the deliverable, so the batch working-mode paragraph does not
apply here and the suites below were executed rather than deferred to L1.

## ActiveForm

Restoring the deleted fail-closed and tolerant-load assertions per document,
and running the suites.

## Dependencies

- **blocked by**: [RFCT-314](RFCT-314.md) (completed)
- **blocks**: (none)

## Acceptance

- **12 new tests** in `pkgs/mosd/mosd-settings/tests/settings.rs` (42 → 54) and
  two assertions added to existing tests, one in the same file and one in
  `pkgs/mosd/mosd/src/bus.rs`. §1.
- **Every one of them mutation-checked**: six mutations of the shipped code,
  each turning exactly the intended test (and no other) red. §3.
- `cargo test --locked -p mosd-settings -p mosd -p apid` in
  `localhost/mos-build-rust-check:amd64` — **green**: `apid` 319 + 1
  (`tests/e2e.rs`); `mosd` 503 + 1 (`tests/bus.rs`) + 7 (`tests/scan.rs`);
  `mosd-settings` 56 + **54** + 0 doc.
- `bash tests/mos-data-layout-test.sh` — **PASS**, and mutation-checked: with
  `ensure_dir "$SYSTEM_ROOT/config" 0700` deleted it is red with
  `FAIL config canonical directory`.
- `bash pkgs/mosd/hack/check.sh` through `make os-rust-gate` — **`pkgs/mosd`:
  ALL CHECKS PASSED**, 988 tests run / 988 passed, with `cargo fmt --all
  --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`,
  workspace doctests and `cargo deny check licenses bans advisories`.
  **`pkgs/rauc-sign`: RED, pre-existing on `main` and not touched here.** §5.
- Three **pre-existing gate reds on `main`** found by running the gate; two
  fixed mechanically (they are clippy's and rustfmt's own output), one reported
  and left alone. §5.
- `docs/verify-index.sh`, `docs/verify-links.sh`, `docs/verify-status.sh` green.
- `pkgs/mosd/apid/openapi.json` unchanged and re-verified — no route was
  touched, and `tests::the_committed_openapi_document_is_the_generated_one` is
  green inside the gate run above. §4.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## 1. What was restored, and in what shape

All in `pkgs/mosd/mosd-settings/tests/settings.rs` unless stated.

| Test | The property | Was |
|---|---|---|
| `a_document_with_an_unknown_key_fails_to_load_and_the_refusal_names_it` | fail-closed on an unknown key, nested inside the subtree the document carries, **and the refusal names the file** | `v3_document_with_unknown_key_fails_to_load` |
| `every_config_document_is_fail_closed_on_an_unknown_key` | the same rule at the top level of all seven | — (the reason the six share) |
| `a_document_that_does_not_parse_refuses_the_load_and_names_itself` | four ways to be unreadable, each named; and the contrast — remove the file and the same store loads | RFCT-314 §6, owed #2 |
| `an_older_document_is_refused_by_name_because_there_is_no_migration` | the `from < version` arm, which the deleted registry used to serve | — |
| `a_newer_document_loads_with_the_unknown_keys_dropped` | the tolerant additive strip, with the report's document, `from` and `dropped_keys` | `newer_additive_document_loads_with_unknown_keys_dropped` |
| `stripping_is_recursive_and_drops_same_named_keys_everywhere` | by name, at every depth, arrays included, recorded once | `stripping_is_recursive_and_drops_same_named_keys_everywhere` |
| `a_tolerated_document_saves_back_at_this_schema_version` | rolling forward restores the defaults, not the values | `tolerated_document_saves_back_at_this_schema_version` |
| `a_reshaped_newer_document_costs_its_own_subtree_and_nothing_else` | **the containment — new, see §2** | `newer_reshaped_document_falls_back_to_defaults_not_an_error`, whole-tree |
| `a_write_to_one_document_leaves_the_others_byte_identical` | the claim the split is made of, on inodes as well as bytes | — |
| `every_document_is_written_0600_including_over_a_laxer_one` | F6e's mode, all eight documents, including over a `0666` predecessor | RFCT-314 §6, owed #4 |
| `a_missing_configuration_namespace_refuses_and_names_the_mount` | `ensure_config_medium` on both `load` and `save`, the message naming `/mos`, nothing written | RFCT-314 §6, owed #3 |
| `the_update_document_lives_inside_the_configuration_namespace` | `DEFAULT_UPDATES_PATH` starts with `DEFAULT_CONFIG_DIR` | RFCT-314 §9 |

Two assertions added to tests that already existed:

- `get_unknown_path_is_not_found` gains `settings.get("schema_version")` — see §4.
- `mosd/src/bus.rs`'s `each_settings_failure_travels_under_its_own_error_name`
  gains `SettingsError::Unavailable` — see §4.

**Two deliberate choices in the fixtures, because both are how the deleted
tests decayed:**

1. **The newer-document stamp is derived, never a literal.**
   `newer_wifi_document` stamps `WIFI_SCHEMA_VERSION + 1`. Its predecessor
   carried the literal `13` and had to be repaired **nine times**; the moment
   the schema catches up with a literal, the document stops being newer, the
   tolerant path stops running, and the test goes on passing while asserting
   nothing about rollback. A derived stamp cannot fall behind.
2. **`every_config_document_is_fail_closed_on_an_unknown_key` stamps a literal
   `1` — and fails loudly, not vacuously, if a document bumps.** A v1 fixture
   read by a v2 build takes the `from < version` arm and raises
   `SettingsError::Migration`, which is not the `Parse` the test asserts. The
   test goes red and names the document. That is the opposite of the failure
   mode above and is why the literal is acceptable here.

**Not written, deliberately.** RFCT-314's owed list also has an enumeration of
the moved schema's secret-bearing field names against `redact.rs`'s
`SECRET_FIELDS`, and a tier-1 test that `/mos/config/` is cleared including a
document mosd does not model. Neither is in this task's scope; both are still
owed and neither has anything asserting it.

## 2. The containment, which is the property the split was actually for

RFCT-314 ported `load_newer` and made it per document, so *"a reshaped
`wifi.json` costs the Wi-Fi settings instead of every setting including the
admin credential"*. Nothing asserted that. It does now, and both halves are
asserted in one test:

- the newer document is **tolerated** as before — the load succeeds, the daemon
  runs, a report is produced;
- the loss is **exactly** that document's subtree. The assertion is not a list
  of survivors but one whole-value comparison — the saved tree with `wifi`
  replaced by its schema default — so a subtree the test forgot to name is
  still covered. The admin credential is named separately as well, because it
  is the one that put the device back in setup mode and it is not even in the
  same file.

§3's M5 is the mutation that matters: reinstate the pre-split blast radius and
this test, alone out of 54, goes red.

## 3. Six mutations, because "the tests pass" is not the claim

The claim is that these tests would have caught the regression. Each mutation
was applied to the shipped code, the suite run, and the code restored;
`git diff` on `store.rs` is empty afterwards.

| # | Mutation of `mosd-settings/src/store.rs` | Red |
|---|---|---|
| M1 | `load_newer`'s strip loop never runs (`0..64` → `0..0`) | `a_newer_document_loads_with_the_unknown_keys_dropped` **and** `stripping_is_recursive_and_drops_same_named_keys_everywhere` (2 of 54) |
| M2 | the temp file's mode is `0o666` instead of `DOCUMENT_MODE` | `every_document_is_written_0600_including_over_a_laxer_one` (1 of 54) |
| M3 | the "bytes did not change → do not rewrite" early return is deleted | `a_write_to_one_document_leaves_the_others_byte_identical` (1 of 54) |
| M4 | a parse failure returns `T::default()` instead of refusing | `a_document_that_does_not_parse_refuses_the_load_and_names_itself` (1 of 54) |
| M5 | **the pre-split blast radius**: any `defaulted` report makes the load return `Settings::default()` entire | `a_reshaped_newer_document_costs_its_own_subtree_and_nothing_else` (1 of 54) |
| M6 | `mos-data-layout` no longer creates `config` at `0700` | `tests/mos-data-layout-test.sh`: `FAIL config canonical directory` |

M1's first run stopped at the first failure; it was repeated with
`--no-fail-fast` to get the second name, which is the row above.

## 4. The three things to confirm rather than assume

**`GET`/`PUT /api/v1/settings/schema_version` — confirmed 404 on both verbs,
and only the write half had a test.**

- `PUT` is decided in apid: `is_settings_root` derives the root set from
  `Settings::default()`, `schema_version` is not in it, and
  `an_absent_root_is_404_and_a_malformed_path_is_422` already asserts the 404
  with `settings_not_found` for exactly that path.
- `GET` is **not** decided in apid — the route hands the dot-path to mosd, so
  the leg that decides it is `Settings::get`. Nothing asserted it, and apid's
  own fixture cannot: its fake `get_settings` answers a canned error for every
  path except `""` and `"access"`, so a GET test written there would assert the
  fake. The assertion went where the decision is, as one line in
  `get_unknown_path_is_not_found`. The rest of the chain was already covered:
  `Settings::get` → `SettingsError::NotFound` → `com.mos.mosd1.Error.NotFound`
  (`bus.rs`) → 404 `settings_not_found` (`routes.rs`).
- A count went stale with the change and is corrected here:
  `the_settings_schema_has_the_nine_roots_the_write_route_knows` asserts a list
  of **eight**. `schema_version` was the ninth. Renamed to `…_eight_roots_…`
  with the reason at the comment.

**`GET /api/v1/meta`'s `settingsSchemaVersion` still answers**, reporting
`mosd_settings::STATE_SCHEMA_VERSION` read live, and `apid/src/tests.rs`'s
`meta_body()` builds its expectation from the same constant rather than a
literal. Confirmed green in the run above.

**`docs/design/api.md` §2.1 disagreed with the code and lost.** The prose is
right — it says the member reports the STATE document's version, that it is
**1** today, and that a client cannot get per-subtree versions from it. The
**discovery table three lines above that prose still illustrated the response
as `"settingsSchemaVersion":8`**, a number that is not even in the sequence the
paragraph below it recites (`4 → 6 → 12 → 1`). Corrected to `1`. Nothing gates
this value — §2.1 says so itself: *"the index check tests membership, not
content"* — which is exactly why it drifted.

**`SettingsError::ReadOnly` has no producer, and the bus test's own claim was
false in a different way than expected.** The test is
`each_settings_failure_travels_under_its_own_error_name` and its doc says
*"Every `SettingsError` variant, against the error name it must travel under"*.

- The three-way distinction is intact **as a mapping**: the test constructs
  `ReadOnly` directly, so `to_bus_error`'s arm and the
  `com.mos.mosd1.Error.ReadOnly` name are still asserted. What is gone is
  **reachability** — no settings operation produces the variant, so nothing
  drives that arm from a real call. RFCT-314's reading ("down to two legs") is
  right about the product and the test still pins the contract it claims to.
- What was actually wrong: the table enumerated **six of seven** variants.
  `SettingsError::Unavailable` — the variant RFCT-314 *added*, mapped to
  `org.freedesktop.DBus.Error.IOError`, and the one an operator meets when DATA
  does not mount — had no row. Added. The list is a hand-written enumeration
  and nothing makes it exhaustive by construction; that is a real weakness and
  is left as it was found rather than redesigned here.

## 5. Three gate reds that were already on `main`

Running the gate is what found them. None is in RFCT-314's slice and none is
mine; all three reproduce at `4fc8e839` with this branch's changes reverted.

**Fixed, because they are the tools' own output and the gate cannot report
anything past them:**

1. `cargo fmt --all --check` was **red on `main`** under the pinned
   `rustfmt 1.9.0-stable`: `pkgs/mosd/apid/src/routes.rs:6176` and `:6186`
   (from `7eec2310`, RFCT-322's `MarkerPresence::spend`) and
   `pkgs/mosd/apid/src/tests/provisioning_api.rs:47` (from `68ba23dd`).
2. `cargo clippy -- -D warnings` was **red on `main`**:
   `apid/src/routes.rs:6174` `collapsible_if`, the same `MarkerPresence::spend`
   — collapsed into the let-chain clippy prescribed;
   `pkgs/rauc-sign/src/update.rs:608` `needless_borrows_for_generic_args` —
   `fs::File::open(&verified)` → `open(verified)`, where `verified: &Path`.

   Both hunks in `apid` come from the branch whose own record says *"**Tests
   were not written and no suite was run**"* (RFCT-322 Acceptance). The gate is
   where that lands.

**Reported and NOT fixed** — it is a product/harness defect in a workspace this
task has no business in:

3. `pkgs/rauc-sign`'s `tests/update.rs:1668`
   `the_cli_reports_readiness_with_its_own_exit_code` fails. Verbatim:

   ```
   thread 'the_cli_reports_readiness_with_its_own_exit_code' panicked at tests/update.rs:1668:5:
   assertion `left == right` failed: Output { status: ExitStatus(unix_wait_status(256)), stdout: "", stderr: "rauc-update: No such file or directory (os error 2)\n" }
     left: Some(1)
    right: Some(3)
   ```

   Confirmed identical at `4fc8e839` with this branch's one-character
   `update.rs` change reverted, so it is not a consequence of item 2. Two facts
   for whoever picks it up. **The error chain is a bare `io::Error` with no
   context** — `main` prints `{err:#}`, the whole colon-joined chain, and the
   chain is one clause — so some `?` on an `fs` call is missing its
   `.with_context`, and whatever file is missing is unnamed. **And that is also
   why the exit code is 1 rather than 3**: the `Unready` downcast cannot fire on
   an `io::Error`. `Command::Fetch` runs `check_baked` → `client::verify_baked`
   **before** `Workspace::from_env()`, so on this path an unready workspace can
   never produce `EXIT_UNREADY` if anything earlier fails. `client::verify_baked`
   was last changed by `c9514b49` (*"the client reads the baked anchor"*), which
   is the first place to look.

## 6. What the `0600` test pins, and what it does not

It pins the consequence — every one of the eight documents lands `0600`,
including when it replaces a `0666` file — and **not the ordering**. A mode set
*after* the rename would leave an identical end state, so no post-hoc
observation from outside the process can separate the two; the window is only
visible to a concurrent opener. `write_document` sets the mode on the temp file
before `persist`, and that is what keeps the ordering. Stated at the test, and
recorded here as a partial rather than left to be read as more than it is.

The second half of the test also required writing a settings tree that changes
**all eight** documents, because an unchanged document is deliberately not
rewritten — a narrower edit would have left seven of them at `0666` and the
test would have failed for a reason that is not its subject. That coupling is
worth knowing: `configured()` exists to touch every document exactly once.

## 7. `load_updates`'s absent-is-default against the store's absent-is-refusal

RFCT-314 asked whether a test should pin the dependency between the two.
**Yes — and not the one that looks obvious, and not here.**

The two behaviours are each asserted now, separately and correctly:
`configuration::load_updates` returns the baked defaults for a missing
`updates.json` (§5.1's decision, right for that layer), and
`a_missing_configuration_namespace_refuses_and_names_the_mount` pins the
store's refusal for a missing `/mos/config/`. Neither says anything about the
other, and a test that merely put them side by side would assert nothing new.

What actually makes them consistent is an **ordering**: mosd cannot start
without the mount, so the update reader can never observe an unmounted DATA.
That claim lives in three places and no test reads any of them together —
`RequiresMountsFor=/var/lib/mos /mos` in `pkgs/mosd/dist/mosd.service`,
`ensure_config_medium` being called on the startup path
(`pkgs/mosd/mosd/src/main.rs`), and `update_policy.rs` reading the document
after that point. The pin worth having is **"mosd's startup refuses before any
update-policy read happens"**, which is a statement about `main.rs`'s ordering
and belongs with whoever owns the startup path — F6f/F10 — not with a repair of
deleted assertions. It is named here so the question has a written answer;
**neither behaviour was changed.**

## 8. What is still not executed

- The redactor enumeration (RFCT-314 §6, owed #4) and the tier-1
  `/mos/config/` sweep (owed #6). Not in scope, still owed, still nothing
  asserting either.
- `SettingsError::ReadOnly`'s reachability — by construction, since it has no
  producer. §4.
- The `0600` **ordering** as distinct from its consequence. §6.
- The mount-ordering pin of §7.
- Anything that composes an image or a deb pool.
- `docs/zh/design/` still lags its English sources, RFCT-314 §6's out-of-scope
  note unchanged. Checked for this one: `docs/zh/design/api.md` carries no
  `settingsSchemaVersion` at all, so §4's correction has no mirror to drag with
  it.
