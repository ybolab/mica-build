# RFCT-247 PLAN-026 M1: the CIDR gap on the typed network writes

- **status**: completed — both typed network write routes now run the wizard's CIDR rule, from one shared function, and answer 422 with §2.4's envelope; the pinning test is flipped and renamed
- **priority**: P1
- **owner**: bkd/fhd6s5xd
- **createdAt**: 2026-08-29
- **completedAt**: 2026-08-29
- **plan**: PLAN-026 (M1)

`PUT /api/v1/network/{iface}` accepted a static address the kernel cannot parse
and answered 204. The rule that would have refused it was live on three other
surfaces at the same moment. This closes the first of the six defects
PLAN-023's closeout measured and deliberately left open.

## 1. The defect, re-measured at this branch's base

The brief carried PLAN-026's line numbers from `c5f7e96`. Every one was
re-opened at that commit before anything was written, and every one held.

**Every position below is a line of `os/pkgs/mosd/apid/src/routes.rs` as it
stood at `c5f7e96`, and none of them is written in the citation form.** That is
deliberate. A full-form citation resolves against HEAD, where this task has
moved all four of these by between 29 and 61 lines, so writing one here would
make the gate green over a false statement; and the bare `` `:NNN` `` form the
narrow shape tempts is worse still, because `docs/verify-citations.sh` skips it
entirely and it can point at nothing forever. Pre-image positions are prose.

- `fn valid_cidr` sat at line 3449, with exactly one caller.
- That caller, `fn validate_iface`, sat at line 3480 and ran the rule at line
  3484, `if !dhcp && !address.is_empty() && !valid_cidr(address) {`.
- `validate_iface` had three callers, and all three were reached from a form or
  from the setup route: `iface_settings_from_form` at 3579, `setup_submit` at
  3893, `api_v1_setup` at 4155.
- The typed cluster's three write/remove routes were declared at lines 454-463
  and none of them called it.

So the gap was real and it was exactly where `docs/task/RFCT-215.md` section 6
item 1 pinned it. The RED test below is the measurement that matters, because a
call-graph reading is a claim about the code and a route test is a claim about
the wire.

## 2. RED first

`the_typed_network_writes_refuse_an_address_that_is_not_a_cidr`
(`os/pkgs/mosd/apid/src/tests.rs:8483`) was written and run before the fix
existed, committed at `6e1bf6e`. The first assertion it reaches is the item
route's status:

```
running 1 test
test tests::the_typed_network_writes_refuse_an_address_that_is_not_a_cidr ... FAILED

---- tests::the_typed_network_writes_refuse_an_address_that_is_not_a_cidr stdout ----

thread 'tests::the_typed_network_writes_refuse_an_address_that_is_not_a_cidr' (3265) panicked at apid/src/tests.rs:8496:5:
assertion `left == right` failed
  left: 204
 right: 422

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 352 filtered out; finished in 1.20s
```

`left: 204` is the defect on the wire: `PUT /api/v1/network/eth0` carrying
`{"dhcp": false, "static": {"address": "192.168.1.10"}}` was accepted and
written.

The test asserts four things, not one. Two refusals — the item route and the
map route — each with the 422, the §2.4 envelope, the `path` member naming the
entry, the wizard's own sentence, and nothing written. And two acceptances,
which are as much of the rule as the refusals: `dhcp` on with a junk address
still in the block, and `dhcp` off with no `static` at all. Without those two
arms the test would pass against a fix that refused more than the wizard does.

## 3. What changed

**One rule, three surfaces.** The address clause moved out of `validate_iface`
into `fn validate_static_address` (`os/pkgs/mosd/apid/src/routes.rs:3544`),
which is the only place in the file that spells the condition
`if !dhcp && !address.is_empty() && !valid_cidr(address) {`
(`os/pkgs/mosd/apid/src/routes.rs:3545`). `validate_iface` now ends in
`validate_static_address(dhcp, address)`
(`os/pkgs/mosd/apid/src/routes.rs:3528`), so the two form handlers and
`POST /api/v1/setup` reach the rule exactly as before, through a tail call.

Factored rather than called directly, and the reason is the name check. The
typed routes already refuse a bad interface name through `fn check_iface_name`
(`os/pkgs/mosd/apid/src/routes.rs:2488`), whose message is the API's
(*"an interface name is 1 to 15 characters of letters, digits, `.`, `_` or
`-`"*). Calling `validate_iface` from those routes would have carried a second,
unreachable spelling of that same refusal into the cluster. Splitting the clause
costs one function and leaves one copy of the CIDR rule in the file.

**The API-side refusal** is `fn address_refusal`
(`os/pkgs/mosd/apid/src/routes.rs:2532`), built beside `fn relational_refusal`
(`os/pkgs/mosd/apid/src/routes.rs:2508`) and in its shape: it turns the
validator's own message into §2.4's envelope with `validation_failed` and
nothing else.

**Two call sites, both on the write paths.**

| Route | Call | What is checked |
|---|---|---|
| `PUT /api/v1/network` | `if let Err(response) = address_refusal(iface, cfg) {` (`os/pkgs/mosd/apid/src/routes.rs:2656`) | every entry of the body, which on this route is the whole map it will store |
| `PUT /api/v1/network/{iface}` | `if let Err(response) = address_refusal(&iface, &cfg) {` (`os/pkgs/mosd/apid/src/routes.rs:2727`) | `cfg`, the one entry the request carries |

`api_v1_network_iface_remove` (`os/pkgs/mosd/apid/src/routes.rs:2769`) is
untouched. It re-validates the map it read, without the removed entry, and
putting the CIDR rule into that shared re-validation would make removing an
unrelated interface start failing on bad data already on disk — data the
request neither carried nor caused. The rule is on the entries a request
carries and on nothing else, which is why the item route checks `cfg` and not
the candidate tree it just built for the relational pass.

## 4. Three decisions, and what each one turns on

**The message is the wizard's, unchanged.** `"Static address must be IPv4 CIDR
notation, e.g. 192.168.1.10/24."` is what the setup form prints and what the
API now returns. A second phrasing would let the two surfaces drift into
describing the same rule two ways, which is the failure mode this whole
milestone is about.

**The `path` member names the entry, not the subtree.** Every other refusal on
`PUT /api/v1/network` reports `network`, because a relational rule is about the
tree. A bad address is about one entry, and on the map route `network` would
not say which of the entries the body carried is the wrong one, so
`address_refusal` builds the path with `iface_settings_path`. The test asserts
`network.eth1` from a two-entry body.

**The check runs after the relational pass, not before it.** A body that breaks
a relational rule *and* carries a bad address gets the answer it got before
this milestone existed. Ordering it first would have changed the message on
bodies that were already refused, which is a change nobody asked for; ordering
it last means the only behaviour that moved is the one that was 204.

## 5. The pinning test, flipped

`the_setup_route_runs_the_wizards_cidr_bound_where_the_network_routes_do_not`
asserted `NO_CONTENT` from the typed route with the comment *"recorded, not
fixed"*. Both its name and its doc comment said the gap was open, so flipping
the assertion alone would have left the file stating something false about
itself. It is now
`the_setup_route_and_the_network_routes_run_one_shared_cidr_bound`
(`os/pkgs/mosd/apid/src/tests.rs:10446`): the same entry still goes three ways,
and the third arm asserts 422, the `validation_failed` code, `network.eth0` in
`path`, the wizard's sentence in `message`, and that nothing was written. Its
doc comment now records the convergence and keeps the reason the setup route
runs the rule on its own account — a factory-fresh device configured with an
unparseable address has no other way in.

No test was deleted. One was added and one was renamed; the crate goes from 836
to 837.

| | `#[tokio::test]` | `multi_thread` | `#[test]` | total |
|---|---|---|---|---|
| `main` at `a06e9dd` | 418 | 18 | 400 | 836 |
| this branch | 419 | 18 | 400 | 837 |

`cargo nextest` reported `837 tests run: 837 passed` on this branch before its
last merge, which agrees with the attribute count. The gate row in section 8
reads `839` because the merged tree also carries M3's two, which are RFCT-249's
and not this task's.

The near-miss counter is `354` both here and at `bkd/5q6am5rw`'s own tip, so
this task's 471-token class A pass and the tests.rs pass below moved it by
nothing: no citation was left with a quote sitting near it but not against it.

## 6. The published spec

`os/pkgs/mosd/apid/openapi.json` was regenerated with
`cargo run -p apid -- --openapi > apid/openapi.json` and never hand-edited; a
test asserts the committed file is exactly those bytes. Both affected routes
already documented a 422, so the diff is two description strings and no new
status, no new schema, no removed member:

- `PUT /api/v1/network`, 422: gained *"an entry declares a static address that
  is not IPv4 CIDR notation"*.
- `PUT /api/v1/network/{iface}`, 422: gained *"the entry declares a static
  address that is not IPv4 CIDR notation"*.

A client reading only the document now learns the refusal exists. That the
change is additive under `docs/design/api.md` section 2.1 is not asserted here;
it is the oasdiff row in section 8.

`docs/design/api.md` is not amended. Section 2.4's table already carries
`validation_failed` and already names `validate_iface` as one of the four
validators reachable from `/api/v1/`; this milestone adds no code, no status
and no bound that section does not already state. The only edits this task made
to that file are citation re-anchors.

## 7. The citation re-anchor, in two passes and two commits

The `routes.rs` and `tests.rs` edits shift documentation citations. Both passes
ran after the code commit, and the two classes were kept apart.

**The base was proved, not assumed.** `docs/verify-citations.sh` was run
against a clean `git archive` extract of `main`, inside this worktree, and read
`2170/2170 PASS` at `c5f7e96` and `2175/2175 PASS` at `a06e9dd`. So every
citation that failed after the code commit had been valid at the pre-image, and
all of them are class A.

**Class A — mechanically shifted** (`a6b5d3a`). 471 tokens across 22 documents.
The map comes from the `-U0` hunks of `git diff c5f7e96 HEAD` on the two files,
never from a constant offset: within `routes.rs` alone the drift is **+29**
below line 2516, **+38** below 2621, **+44** below 2685 and **+61** below 3483,
and in `tests.rs` it is **+81** below 8472. A token was rewritten only when the
destination line at HEAD is byte-identical to the source line at the pre-image,
and both ends of every range were mapped independently. A token whose old line
falls inside a changed hunk was refused rather than guessed. Six tokens sit in
documents carrying a `<!-- dated-record: -->` marker and were left alone.

**Class B — content re-derived** (`7c455da`). Exactly two tokens, one in
`docs/task/RFCT-215.md` and one in `docs/task/RFCT-244.md`, both naming line
10312 of `os/pkgs/mosd/apid/src/tests.rs` as it stood at the pre-image — written
here without the citation form on purpose, because that line is something else
now and a token pointing at it would resolve while meaning nothing. That line
was the pinning test's signature, and this
milestone renamed the test, so there is no shifted line to map to: the content
had to be found. Both citations now point at the renamed signature, and both
sentences say what the test asserts today while keeping the measurement their
own task made, under the name it ran under then. Neither document carries a
dated-record marker, so neither could be left stale.

`docs/task/RFCT-244.md` section 8b's test table still lists the old name beside
*"**204** from M6's route"*. That row is a record of the tests that task
shipped, it carries no citation, and no gate reads it; it is left as it was
written and is named here so the discrepancy is on the record rather than
found later.

## 8. Gate results

All four re-run on the merged tree, in this worktree, after both citation
passes. None was measured in the shared checkout.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `2221/2221 PASS`, RC=0, near-miss `354` |
| `bash docs/verify-index.sh` | `879/879 PASS`, RC=0 |
| `bash hack/check.sh` in the amd64 builder, `dbus` installed first | `Summary [ 175.980s] 839 tests run: 839 passed (1 slow), 0 skipped`; `advisories ok, bans ok, licenses ok`; `ALL CHECKS PASSED` |
| `oasdiff breaking … --fail-on ERR --severity-levels …` vs `main` tip `7566210` | `No breaking changes to report, but the specs are different.`, **RC=0** |

`main`'s own tree at `a06e9dd` reads `2175/2175` and `867/867`, measured here
rather than relayed, in a clean `git archive` extract. The rest of the delta is
this record and the two merges: eleven citations and four index assertions of
its own, plus `RFCT-260.md` and `RFCT-252.md` arriving from `bkd/5q6am5rw`.
Nothing this task did to the corpus removed a citation or left one unresolved —
the class A pass rewrote 471 tokens and every one of them still resolves and
still content-checks against the line it was moved to.

The Rust gate ran the script unmodified, in `localhost/mos-build-rust:amd64`
with the worktree bind-mounted at `/work`, `bash -c` and not `bash -lc`, and
`dbus` installed in the container first — without it the bus round-trip test
exits 100. The first run of it failed on `cargo fmt --check` alone, at one call
this record's RED test wrote as a single line; the formatter's output was taken
and folded into the fix commit, and the citation pass was redone from the
pre-image afterwards so no citation was ever anchored against an unformatted
tree.

`bkd/5q6am5rw` was merged three times, and the test `docs/task/RFCT-215.md`
section 5 prescribes was run before each. The first two brought docs and no
code; the second conflicted on `docs/task/index.md` alone, resolved the
campaign's way with both row blocks kept and ascending, and exposed two
citations in the arriving `docs/task/RFCT-252.md` that point into
`docs/task/RFCT-215.md` section 6 item 6 — lines this task's own class B edit to
item 1 had pushed down by five, re-anchored mechanically from the incoming side
as the pre-image.

**The third merge is the one the rule was written for.** It brought M3
(`docs/task/RFCT-249.md`), which changes code, and both sides had re-anchored
the same documents. Twelve citation hunks conflicted. Under the corrected rule —
*the side holding content re-derivations wins, because they cannot be recovered
mechanically; the side holding shifts loses, because they can* — every conflict
resolved to this side: eleven of them were shift-against-shift, where neither
number survives the merge anyway, and the twelfth was this task's class B
re-derivation of the renamed test against M3's mechanical shift of the line it
used to sit on.

Then the shifts were recomputed, because resolving a conflict does not make the
kept number right. The two sides moved disjoint files except one:
`os/pkgs/mosd/apid/src/routes.rs` is this branch's alone and
`os/pkgs/mosd/mosd-settings/src/model.rs`, `lib.rs` and
`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs` are M3's alone, so citations
into those are already correct on their own side. `os/pkgs/mosd/apid/src/tests.rs`
is the file **both** inserted into, so after the merge no citation into it held
on either side and every one was recomputed against the merged file. Provenance
was read rather than assumed — a token that conflicted and was resolved here is
anchored to this tree, one that arrived from M3 to M3's, decided from each
side's own version of the citing document. Fifteen mapped from this side, one
from M3's, eleven agreed either way, eleven were already correct; nothing was
ambiguous and nothing was refused. Each mapping was accepted only when a
seven-line window around the destination is byte-identical to the source, so a
lone `}` cannot match by accident.

oasdiff is the 1.29.1 release the workflow pins, checked against the pinned
`sha256:541f7c66c933495fceef24eaf5c48aa66c19069f366f7bd0a60a6a4820c5e533`
before use, run with the two severity promotions the workflow writes
(`response-optional-property-removed err`,
`response-non-success-status-removed err`). **RC=0 against `main`'s current tip
is what proves the 422 additive**, and it is the current tip and not the
dispatch-time one: `main` moved four times while this task ran, from `c5f7e96`
to `7566210`, and the base was re-read from its tip at each run rather than
cached. `main` has not touched `os/pkgs/mosd/apid/openapi.json` in any of those
commits, so every one of those runs compared against the same base bytes.

## 9. Out of scope, untouched

The WireGuard peer routes, the HTML panes, `api_v1_network_iface_remove`'s
re-validation, and the five remaining PLAN-026 milestones. `valid_ipv4`,
`is_ip_or_cidr` and the peer validators were not consulted or changed: this
task moved one clause and gave it two new callers.
