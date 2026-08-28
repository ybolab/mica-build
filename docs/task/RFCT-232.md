# RFCT-232 PLAN-025 M3a: /state 404 and the two mosd.md dated notes

- **status**: completed
- **priority**: P2
- **owner**: bkd/zsebeg3b
- **createdAt**: 2026-08-28
- **claimedAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-025 (M3a)
- **design**: PLAN-025 M3a's two items — the live-state route's 404, and the two self-dated sentences in `docs/design/mosd.md` §5 that the tree has moved past

Two unrelated corrections that share only a milestone. The first is a semantic
one in apid: a live-state dot-path that does not resolve answered **422**, while
the settings tree answered **404** for the same condition, so one condition
carried two codes depending on which tree a client asked. The second is
documentary: two sentences in `mosd.md` §5 count and version things that have
since changed, and both are self-dated records, so they are corrected with a
dated note rather than rewritten.

## Scope

| file | change |
| --- | --- |
| `os/pkgs/mosd/apid/src/routes.rs` | `api_v1_state` reads fdo `InvalidArgs` as *"the dot-path does not resolve"* and answers 404; its `#[utoipa::path]` responses block gains the 404 |
| `os/pkgs/mosd/apid/src/tests.rs` | the red-green test, with the settings route's 422 beside it as the control |
| `os/pkgs/mosd/apid/openapi.json` | regenerated; the committed copy is test-asserted |
| `docs/design/mosd.md` | two dated notes — §5.3's reconciler count and table, §5.4's `SCHEMA_VERSION` sentence |
| 17 documents | citation line numbers re-anchored, mechanically, in their own commit (section 4) |
| `docs/task/RFCT-232.md`, `docs/task/index.md` | this record and one index row |

## 1. The measurement the fix rests on

The scope constraint decided the shape of this fix before anything was written:
PLAN-025 names `os/pkgs/mosd/apid` in and everything else under
`os/pkgs/mosd` out. The cleaner correction is mosd-side — raise a `NotFound`
error name for a state path that does not resolve, the way the settings tree
already does — and that is out of scope here. So the question was whether apid
can classify the existing name without guessing, which it can only do if the
name has exactly **one** producer on this route.

It does. `GetState`'s implementation is short enough to read whole:
`async fn get_state(&self, path: &str) -> fdo::Result<String> {`
(`os/pkgs/mosd/mosd/src/bus.rs:649`) has two failure paths and no others. The
first is the uptime read,
`.ok_or_else(|| fdo::Error::Failed("read /proc/uptime".to_string()))?;`
(`os/pkgs/mosd/mosd/src/bus.rs:652`), which is `Failed` and reaches apid as 500
`mosd_failed`. The second is the dot-path lookup,
`let value = json_path_get(&inner.state, path)`
(`os/pkgs/mosd/mosd/src/bus.rs:663`), whose `None` becomes
`fdo::Error::InvalidArgs` on the line below it. The whole-tree read (`""`) and
the `uptime` graft return early and cannot fail with a name at all.

So on this route, and only on this route, `InvalidArgs` means one thing. That is
what makes the reclassification a reading rather than a guess, and it is the
whole of the fix's justification: **if a second `InvalidArgs` producer is ever
added to `GetState`, this fix becomes wrong and must be replaced by the
mosd-side rename.** Stated here because nothing mechanical will notice.

## 2. The change

`api_v1_state` no longer hands its result straight to the shared classifier. It
inspects the error first, and only for the one name:

```rust
    let unresolved = match value
        .as_ref()
        .err()
        .and_then(|err| err.downcast_ref::<zbus::Error>())
    {
        Some(zbus::Error::MethodError(name, message, _)) if name.as_str() == FDO_INVALID_ARGS => {
            Some(message.clone().unwrap_or_else(|| name.to_string()))
        }
        _ => None,
    };
```

Everything else still goes through `resource_response`, and the answer it
produces is the same envelope §2.4 gives everywhere else: mosd's own message,
apid's classification, the path attached. The 404 it produces names
`settings_not_found` — the code the settings route already answers this
condition with, at `MOSD_NOT_FOUND => (`
(`os/pkgs/mosd/apid/src/routes.rs:701`) — so the two trees now agree, which was
the point. `docs/design/api.md`'s error table already reads
*"the dot-path does not resolve: mosd answered `com.mos.mosd1.Error.NotFound`"*
(`docs/design/api.md:1592`) as the 404 row and the fix agrees with it; that file
belongs to M3b and PLAN-023 and was not edited here beyond section 4's
re-anchor.

**The settings route is untouched.** `bus_api_error`'s table still maps
`FDO_INVALID_ARGS => (`
(`os/pkgs/mosd/apid/src/routes.rs:709`) to 422 `settings_rejected`, and every
other route still reaches it. Only `api_v1_state` reads the name differently,
because only `api_v1_state` has the single-producer fact to read it with.

**Additive.** The state route's OpenAPI responses block gains one status and
loses none: `200`, `401`, `422`, `500` and `503` all remain, with the same
`ApiError` / `ResourceValue` bodies they had, and `404` joins them. The
regenerated document is `1 file changed, 11 insertions(+), 1 deletion(-)` — ten
of those insertions are the new 404 object,
`"description": "The dot-path does not resolve (`settings_not_found`)",`
(`os/pkgs/mosd/apid/openapi.json:322`), and the eleventh-and-deletion pair is
one line: the 422's description used to end *"which is also the answer for a
dot-path that does not exist"*, which the fix makes false. No schema changed, no
status was removed, no body was retyped. A client generated from the old
document still parses every response the new one can produce, except that it
will now see a 404 it was not told about — which is the additive direction.

The 422 stays documented although this build can no longer produce it on this
route: removing a status is not additive, and its description now points at the
404 instead of claiming the missing-path case for itself.

## 3. Red, then green

The test asserts both halves — the state route's new answer, and the settings
route's unchanged one from the same fixture, which is the control that catches a
fix applied one layer too low.

Before the fix:

```text
        FAIL [   1.142s] (1/1) apid::bin/apid tests::a_state_dot_path_that_does_not_resolve_is_404_not_422
    thread 'tests::a_state_dot_path_that_does_not_resolve_is_404_not_422' panicked at apid/src/tests.rs:4173:5:
    assertion `left == right` failed
      left: 422
     right: 404
     Summary [   1.304s] 1 test run: 0 passed, 1 failed, 244 skipped
```

After:

```text
        PASS [   0.011s] (4/7) apid::bin/apid tests::the_openapi_document_covers_the_resource_routes
        PASS [   0.012s] (5/7) apid::bin/apid tests::the_committed_openapi_document_is_the_generated_one
        PASS [   1.147s] (6/7) apid::bin/apid tests::a_state_dot_path_that_does_not_resolve_is_404_not_422
        PASS [   2.187s] (7/7) apid::bin/apid tests::a_dot_path_that_does_not_exist_is_404_and_a_rejection_stays_422
     Summary [   2.188s] 7 tests run: 7 passed, 238 skipped
```

The last line of that run is the control: `a_dot_path_that_does_not_exist_is_404_and_a_rejection_stays_422`
(`os/pkgs/mosd/apid/src/tests.rs:4156`) is the settings route's existing
assertion that a rejection is still 422, and it passed unchanged.

**One existing test had to change, and it is the interesting one.**
`each_fdo_error_name_gets_its_own_envelope` walks §2.4's five rows against
**both** resource routes with one expected status per row, which is exactly the
assumption this fix breaks: `assert_eq!(response.status(), status, "{fdo_name} at {path}");`
(`os/pkgs/mosd/apid/src/tests.rs:4080`) failed with *"left: 404"* against
*"right: 422"* at `/api/v1/state/wifiAp`. The row is now route-dependent in the
loop, with the reason stated where the override is, and the other four rows and
the whole settings column are untouched. That failure is the evidence the change
is a real narrowing and not a widening: nothing else in the sweep moved.

## 4. The citation re-anchor, and what it cost

Editing `routes.rs` moved every line below the handler: `+1` through 586 and
`+28` from 587, and the regenerated `openapi.json` moved `+10` from 320.
`docs/verify-citations.sh` went from `1379/1379 PASS` to **85 failures**, none
of them a real staleness — every one was a quote that had stopped sitting at the
line number naming it.

They were re-anchored mechanically, by rule, from the pre-image: 193 citations
across 13 documents, line numbers only, in commit `de84b75` separate from the
behaviour change. Documents carrying the `dated-record` marker were excluded,
because re-pointing a frozen record falsifies it — the rule
`docs/verify-citations.sh` itself states. The `mosd.md` notes of section 5 then
moved that file's own lines, and 11 more citations were re-anchored the same
way.

**Two could not be fixed by number.** `api.md` quoted the state handler's whole
body as `resource_response(state.api.get_state(&path).await, &path)`, in two
places, and the fix splits that body. Both now quote the expression the handler
ends in, `None => resource_response(value, &path),`
(`os/pkgs/mosd/apid/src/routes.rs:613`), which is the smallest true restatement
of the same point. That is the only prose this task changed in `api.md`, a file
PLAN-025 M3b and PLAN-023 both hold; it is flagged rather than buried because
M3b may want to say more there about why the two routes now differ.

**Not covered, and left for M3b to decide.** `api.md` also carries 136 shorthand
`:NNN` citations — the form that names no file and resolves against a path given
earlier in the prose. `docs/verify-citations.sh` skips them by design — *"is shorthand for a path
named earlier in the prose and has no base to resolve against"*
(`docs/verify-citations.sh:39-41`) — so the gate is green with them stale.
Most of them do resolve against `routes.rs` and are now off by 28. No mechanical
rule re-anchors them safely: the base is context-dependent, and the same table
mixes `routes.rs` shorthand with `bus_client.rs` shorthand on one line. Guessing
would have corrupted a file two other workstreams are editing, so they were left
alone and counted instead.

## 5. The two dated notes

Both sentences sit under `## 5. Where this stands after M5 (2026-08-19)`, which
makes them records of that date and not claims about today. Neither was
rewritten. Each carries a note in the register §5.3 already uses for its
`SshdReconciler` correction: the original stays, the note says what is true now
and when it was measured.

**§5.3's count.** *"`reconciler::all()` returns five, in this order:"* and its
five-row table. The list returns seven:
`Box::new(container::ContainerReconciler::production()),`
(`os/pkgs/mosd/mosd/src/reconciler/mod.rs:40`) and
`Box::new(mqtt::MqttReconciler::production()),`
(`os/pkgs/mosd/mosd/src/reconciler/mod.rs:41`) were registered after the record
was written, in the last two positions. The note adds both rows in the table's
own three columns, each cell measured rather than inferred: the subtrees from
each reconciler's `subtree()`, and the executors from the constants the
reconcilers act on — the Quadlet directory's STATE bind unit and the
daemon-reload that makes a generator run, and the broker config path with the
two units MQTT drives.

**§5.4's schema version.** *"`SCHEMA_VERSION` stays at 3"*. The constant is
`pub const SCHEMA_VERSION: u32 = 7;`
(`os/pkgs/mosd/mosd-settings/src/model.rs:11`) today, which the same document
already half-knows: §5.1 reads the tree at v4 and §5.3a records PLAN-022's bump
to v7. The number is the only stale part. The sentence's point — that a power
action writes no settings, so `mosd-settings` is untouched by `Reboot` and
`PowerOff` — never depended on the version and is still true, so the note
preserves the point and retires only the number.

## 6. Verification

| gate | result |
| --- | --- |
| the new test, before the fix | `Summary [   1.304s] 1 test run: 0 passed, 1 failed, 244 skipped` |
| the new test, after the fix | `Summary [   2.188s] 7 tests run: 7 passed, 238 skipped` |
| `bash os/pkgs/mosd/hack/check.sh` | see the run below |
| `bash docs/verify-citations.sh` | `1390/1390 PASS` (baseline `1379/1379`; the notes add 11 quoted citations) |
| `bash docs/verify-index.sh` | `749/749 PASS` (baseline `748/748`; this record's row) |

## 7. Out of scope, and untouched

`os/pkgs/mosd/mosd/**` was read and not edited — the mosd-side `NotFound` rename
is the better fix and PLAN-025's scope excludes it, so section 1 records the
reading it rests on instead. In `routes.rs` only `api_v1_state` and its doc
attribute were touched, because PLAN-023 is editing the same file. `api.md` was
edited only as section 4 describes. No `.zh.md` file was touched, nothing under
`test/apid-api`, `os/tools` or `os/pkgs/rauc` was touched, and no other task or
plan file was edited beyond this record and its index row.
