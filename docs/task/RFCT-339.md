# RFCT-339 Enumerated failure codes on the update and health paths

- **status**: completed
- **priority**: P1
- **owner**: bkd/h2sqi6m0
- **createdAt**: 2026-09-06 21:30

> The index line in `docs/task/index.md` is written by L1, not by this task.
> `scripts/task-state.sh claim` was deliberately not used: it edits the index
> under a lock, and this branch must not touch it.

## Description

PLAN-076 Gate B, row B4: *every free-text failure in `GetUpdateState` maps to
a code, or is reported as `unknown` — never as its text.* PLAN-037 states why
it blocks 1.0: the path reports failure as free text today, so no fleet or
support surface can say why an update failed without shipping a string that
fails the reporting rule.

The gate has two halves and the second is the one that carries the weight. A
mapping that falls back to the original string is a bigger open vocabulary,
not a closed one: a consumer that matched on the text breaks silently the day
the text changes upstream. So the fallback loses information deliberately —
the text goes to the log, the code goes on the wire.

## ActiveForm

Enumerating the update and health failure vocabulary and closing its fallback

## Dependencies

- **blocked by**: (none)
- **blocks**: PLAN-076 Gate B

## Notes

### What shipped

`pkgs/mosd/mosd/src/update_codes.rs` is the vocabulary: every code, one
module, with the two total mappings that classify foreign text
(`workspace_code`, `rauc_error_code`) and the one that clamps the automatic
path's reasons (`deferral_code`). Every mapping's fallback is `unknown` and
**none of them can answer with its input** — asserted as a property over
arbitrary strings, not as three examples.

Codes are minted where a failure is *constructed* wherever mos owns it
(`CodedReason` travels from the site that builds a failure to the site that
records it), and classified only where the text comes from a process mos does
not own. That is why `unknown` is reachable in exactly two places, and both
are documented as such.

Document members added or closed, all under `GetUpdateState` /
`GET /api/v1/update`:

| Member | Change |
|---|---|
| `lifecycle.code` | new; present exactly for `failed` and `update-unavailable` |
| `lifecycle.workspace.kind` | now `&'static str` — the field *cannot* hold a client's word |
| `lifecycle.last_refusal_code` | new |
| `lifecycle.deferred.reason` | now a code, clamped at the recording site |
| `lifecycle.reboot_gate.codes` | new; parallel to `reasons` — the health path |
| `last_error_code`, `install.error_code` | new |

Plus `GET /api/v1/health`'s `code` (`mosd_unreachable` / `mosd_timeout` /
`mosd_bad_answer`), classified from the error's **type** rather than from the
sentence it renders to.

`openapi.json` was regenerated in the same commit and states every code under
the route that serves it. That is enforced, not remembered:
`every_code_is_published_in_the_route_that_serves_it` reads the committed
document and fails for any producible code the route's description does not
name.

### Which codes have no test driving them

Per the acceptance clause, stated rather than left to be inferred.

**Driven end to end** (a real call produces the recorded document): the five
workspace kinds and their `unknown`; all fifteen deferral reasons and their
`unknown`; `client-exit-failure`, `client-spawn-failed`,
`client-output-unparseable`, `unverified-bundle-path`; `network-offline`,
`network-metered`, `client-unavailable`; `bundle-discarded`,
`suppression-cleared`; `install-in-flight`, `health-blocking`;
`signature-invalid` and RAUC's `unknown` (through a real install and through
the query merge); and all three health-path codes plus the coded-free `ok`
answer, through the real axum route.

**Asserted at the predicate, not at the document** — the predicate is the only
producer, and the document member it feeds is proven by a sibling code:

- `policy-invalid` — `update_policy.rs`'s invalid-file test.
- `no-source-configured` — `no_configured_source_refuses_check_with_its_own_reason`.

**Not reachable from any production path, and asserted only at the mapping:**

- `policy-not-loaded`. Both of its sites are defensive. `check_refusal` tests
  `loaded.error` first, so a document that failed to load answers
  `policy-invalid` before the no-selection branch is reached; and
  `selection_of` runs only after that same predicate admitted the operation,
  which it does not do without a selection. The branches are kept because
  PLAN-070 §5.1 forbids resolving "the document did not load" to the baked
  channel, and a test now pins what a caller who does reach one gets. This is
  a pre-existing unreachability, not one this task introduced.
- `no-source-configured` **as a `failed` state** (`run_fetch`'s own guard) is
  unreachable for the same reason; it is reachable and driven as a refusal.

**The gap the acceptance clause predicted.** `update_auto.rs` still carries no
`#[test]`, because `AutoDriver`'s cadence is keyed on `std::time::Instant` and
`tokio::time::pause` does not move it (RFCT-341 is adding that seam). So what
is proven is *what the wire may carry* — every one of the fifteen reasons, and
a word outside the set, driven through `UpdateLifecycle::defer` into the
recorded document — and what is **not** proven is *which reason the driver
picks for a given failure*. `update_auto.rs` now references the constants
rather than string literals, so the set cannot drift apart; the choice of
which one is still untested. `docs/design/updates.md` §6's owed-work table
records that split.

### Decisions worth recording

- **The fallback loses information on purpose.** No mapping has a
  pass-through arm; the rejected word goes to `tracing::warn!` at the mapping
  site. `every_deferral_reaches_the_document_as_a_code_and_nothing_else_does`
  asserts the rejected word appears in **no member** of the document, not just
  in the one it would have replaced.
- **`unknown` is not in any producer set.** `codes_are_distinct_kebab_case_words_and_none_is_unknown`
  enforces it, so "the fallback fired" and "a producer minted this" can never
  be confused.
- **RAUC's set has one member.** `signature-invalid` is claimed because
  PLAN-078 §5 measured the message from five separate refusals and
  `tests/rauc-trust-negative-test.sh` asserts on it. Every other RAUC failure
  is `unknown`. Adding needles for `Compatible mismatch` or a slot-write error
  would have been inventing a classification for a message nobody here has
  observed — the set grows per measurement.
- **Three failure facts got no code**: `client.available: false`,
  `policy_error` and `suppressed_error`. The member's presence *is* the
  enumeration; a code beside it would be a second spelling of one fact.
- **The support bundle was re-asked.** `apid/src/diagnostics.rs` carries an
  allowlist that drops unnamed members **silently**, so `last_error_code` and
  `install.error_code` were added to it (`REDACTION_SCHEMA_VERSION` 5 -> 6,
  `SCHEMA_VERSION` 3 -> 4). Without that, this gate would have been answered
  on the API and not on the surface a support case actually reads. The
  `lifecycle` subtree was deliberately **not** admitted: it carries
  `policy.sourceUrl`, an operator-typed URL whose userinfo can hold a
  credential — the same reason mosd refuses to log the document — so that is a
  redaction decision of its own, not a side effect of this one.
- **The built-in UI held a third copy of the vocabulary.**
  `automatic-updates-panel.tsx` lists the fifteen with i18n copy and falls
  back to rendering the raw reason. `unknown` was added to that list and to
  both locales, and the panel test's made-up `something-new` case was replaced
  with `unknown` — a fallback case the daemon can no longer produce is a test
  of the fixture, not of the product.

### Gates run

- `bash tests/rust-gate.sh mosd` (fmt, clippy `-D warnings`, nextest,
  doctests, cargo-deny) in `localhost/mos-build-rust-check:amd64` — PASSED.
- `bash pkgs/mosd/apid/ui/build.sh --check` (eslint, tsc, vitest) in the
  pinned bun image.
- `make docs-verify` from a `git archive` of the branch into an empty
  directory.
