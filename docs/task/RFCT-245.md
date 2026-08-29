# RFCT-245 PLAN-023 M9: the cookie cutover on /api/v1/

- **status**: completed — the session cookie no longer authenticates `/api/v1/`; §3.2's dated note records the window Amendment 1 opened and this milestone closed
- **priority**: P1
- **owner**: bkd/2oeudab8
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-023 (M9)

The last implementation milestone of PLAN-023, and the one that makes
`docs/design/api.md` §3.2 true. Amendment 1 ruled option 1 — dual-credential
with an in-plan cutover — and scheduled the cutover for a named milestone so
that §3.2's bearer-only sentence would be false only for a bounded window. This
is that milestone.

## 1. What the cutover is

`ApiSession` accepted a bearer **or** the browser session cookie. `ApiBearer`
accepted a bearer. After the cutover the two prove the same thing, so there is
one extractor and it keeps the accurate name: the 21 handlers that named
`ApiSession` name `ApiBearer`, and the type and its impl are gone.

The type's own doc comment scheduled this. It said the name was kept through
the change of meaning *deliberately*, because `docs/design/api.md` §1.2, §2.4
and §3.1 quote it and "the cutover milestone rewrites as one piece". Renaming
at M2 would have left the document quoting a symbol that was gone; renaming
here is the piece that comment deferred.

Three things did not change, each for a reason already on the record:

| Route | Credential after M9 | Why |
|---|---|---|
| `POST /api/v1/setup` | none | M8 made it the device's one unauthenticated write. It names no extractor, and that is what makes it unauthenticated — not an exception in the gate. |
| `POST /builtin/tokens` | session cookie | The bootstrap. Not an `/api/v1/` route. §3.2 designs it this way on purpose: without it no first token can exist. |
| `POST /builtin/tokens/revoke` | session cookie | The same, for §8.1's capability (iii). |
| the HTML panes | session cookie | The browser surface is untouched. |

Neither `/builtin/` handler names a credential extractor — the gate guards them
— so neither needed an edit for the cookie to survive there.

A cookie presented to an `/api/v1/` route is **401 with §2.4's envelope**, not
a 303 to `/login`. That is §3.1's trap: the redirect lands on `GET /login`,
which answers 200 with HTML, so a script reads the whole exchange as success.
The refusal is asserted with its envelope in the unit tests and against a live
apid, a live mosd and a real bus in `apid`'s end-to-end test.

The 22 OpenAPI 401 descriptions that promised "neither a bearer API token this
device holds nor a session cookie that verifies" said something no longer true.
They carry the token routes' wording now, so all 25 read alike.

## 2. The tests, and which assertions were amended

69 call sites presented a cookie to an `/api/v1/` route. They present a bearer
now; the routes, bodies and assertions are otherwise unchanged.

The credential is **seeded, not minted**, and that is a decision. `POST
/builtin/tokens` is itself a write to `access.apiTokens`, and twenty of these
tests assert `set_paths()` exactly — several assert it is EMPTY, which is the
entire content of a refusal test. A minted credential would put a second path
in every one of them. So `with_token(tree)` seeds one usable token into the
starting tree and 29 fixtures take it. Four tests keep the pane mint because
they assert nothing about writes. `failing_app` seeds too, and could not have
done otherwise: its premise is that a settings write FAILS.

Four assertions changed, and every one is a **tightening**. Named here so that
an amended assertion cannot be mistaken for a weakened one:

| Was | Is | What moved |
|---|---|---|
| `every_shipped_api_route_takes_a_bearer_or_the_cookie` | `every_api_v1_route_takes_a_bearer_and_refuses_the_cookie` | Bearer arm untouched — still 200 on all four paths. Cookie arm 200 → 401, and now asserts `code`, `source` and the absence of `Location`. A bare no-credential request is asserted beside it, which makes the cookie arm a statement about refusal rather than absence. |
| `the_write_route_takes_a_bearer_and_a_cookie_and_refuses_neither_silently` | `the_write_route_takes_a_bearer_refuses_the_cookie_and_refuses_neither_silently` | The old name promised a cookie arm the body never had. It has one now: 401 with the envelope, and the refusal wrote nothing. |
| `the_two_collections_take_a_cookie_or_a_bearer_and_401_without_either` | `the_two_collections_take_a_bearer_and_401_without_one` | Cookie arm 200 → 401 with the envelope. No path or method lost. |
| `the_network_cluster_takes_a_cookie_or_a_bearer_and_401_without_either` | `the_network_cluster_takes_a_bearer_and_401_without_one` | The same. |

No assertion was deleted and no route lost coverage.

`apid`'s end-to-end test gained the one thing nothing in the tree exercised:
the bootstrap itself. It logs in, mints at `POST /builtin/tokens` with the
cookie, parses the plaintext out of the pane's single `<pre>`, and presents
that bearer on the `/api/v1/` calls that follow. It also asserts that the
authenticated browser is refused there — 401, envelope, no `Location` — beside
the anonymous request that was already asserted, because the anonymous case
never distinguished "cookie refused" from "no credential sent".

## 3. Citations

Re-anchored in their own commit, numbers only, from the pre-image at the merge
that closed RFCT-246 — gate-green there at 1714/1714 before any code in this
task ran, which is what makes it usable as a base.

310 citations across 24 documents: **170 single** `path:N` and **140 range**
`path:N-M`. By cited path: routes.rs 297, tests.rs 19, assets/serve.rs 2,
access.md 2, openapi.json 1, model.rs 1, bus.rs 1.

The map is difflib's equal-block opcodes over pre-image and tree, so a citation
moves only when its line survives in an unchanged block and the destination
text is byte-identical to the source. Both endpoints of a range are mapped
independently and both must satisfy it. Nothing was mapped by adding a
constant, and there is no constant to add: M8 measured eight distinct bands and
this delta spans more, because the cutover deleted a type in the middle of the
file and rewrote 22 attribute strings above and below it.

**Antecedent rule for the bare continuation form: nearest preceding full-form
citation anywhere in the document.** Stated because M8 reported 209/146 under
it and could not reproduce M7's 184 under any scoping, so it is not optional
context. This task moves none of them — they are RFCT-214's census, they carry
no path to re-resolve, and their count and text are unchanged (api.md 26,
RFCT-210.md 5).

Four citations could not be mapped and were re-derived by content instead, in a
separate commit, because a line map cannot recover a symbol that no longer
exists. All four named code this task deleted: `pub(crate) struct ApiSession;`
twice, its rejection message, and its cookie branch.

- `docs/design/api.md` §1.4 and §2.4 now describe `ApiBearer`. §1.4 is
  RFCT-215's section and was edited only in the clause this task falsified.
- `docs/task/RFCT-240.md` §4 records an M4-era decision and is left exactly as
  written; only its dangling citation is re-pointed, with a parenthesis saying
  the type was later collapsed.

## 4. Gates

| gate | result |
|---|---|
| `bash docs/verify-citations.sh` | **1711/1711 PASS** |
| `bash docs/verify-index.sh` | **859/859 PASS** |
| `bash hack/check.sh`, unmodified, in `localhost/mos-build-rust:amd64` | **ALL CHECKS PASSED** |
| oasdiff 1.29.1 `breaking --fail-on ERR` vs `main` at `77a3278` | **RC=0** |

The container was confirmed `amd64` by
`docker image inspect --format '{{.Architecture}}'` before any result from it
was believed, and `dbus` was installed in it so the bus round-trip test could
run. `bash -c`, never `bash -lc`.

**oasdiff.** A cutover is the one change in this campaign that could
legitimately have been breaking, and it is not: *"No breaking changes to
report, but the specs are different."* Removing a credential is not a schema
change. The specs differ in exactly 22 lines, all of them the 401 `description`
string, and a description is not a contract §2.1 makes a promise about.

**Test arithmetic.** 836 before, 836 after — **no net change**.

    836  L2 baseline
    +0   tests added
    -0   tests removed
    ---
    836  this tree, all passing

Counted across all three attribute spellings, which sum to the run's own total:

    400  #[test]
    418  #[tokio::test]
     18  #[tokio::test(
    ---
    836

Five tests were RENAMED and their assertions amended; none was added or
deleted, which is why the total does not move. Each is asserted by name against
the run log:

| name in the run log | result |
|---|---|
| `every_api_v1_route_takes_a_bearer_and_refuses_the_cookie` | PASS |
| `the_write_route_takes_a_bearer_refuses_the_cookie_and_refuses_neither_silently` | PASS |
| `the_two_collections_take_a_bearer_and_401_without_one` | PASS |
| `the_network_cluster_takes_a_bearer_and_401_without_one` | PASS |
| `the_api_password_change_succeeds_and_drops_every_browser_session` | PASS |

## 5. The final bearer run — the evidence M9 stands on

RFCT-246 built `test/apid-api`'s `05d-bearer` and ran it 37/37, 376/376 across
two boots — but against an image built **before** M7's actions and M8's setup
route existed, and of course before this cutover. M9 was gated behind a run
that includes them, so the image was rebuilt from this tree and the suite run
against it.

    x64-mos-v2-1787939109.img   1.9 GiB, built 2026-08-28 17:45 from this branch

    boot 1  phases 01-transport .. 07-reboot     RESULT: PASS (345/345 checks)
    boot 2  phases 07b-postreboot, 08-poweroff   RESULT: PASS ( 17/17  checks)
    ---------------------------------------------------------------------------
    total                                        RESULT: PASS (378/378 checks)
    SUITE EXIT rc=0        FAIL lines in the whole log: 0

`05d-bearer` itself: **37/37**, the same figure RFCT-246 measured, now on an
image that has M7's actions, M8's `POST /api/v1/setup` and M9's cutover in it.
Its own summary line is the one M9 is about:

    PASS: a request carrying NO credential is 401, and not the gate's 303 to /login

378 against RFCT-246's 376 is **+2**, and the two are named: the mint
`05b-wireguard` now performs for itself.

    PASS: POST /builtin/tokens with the session cookie mints this phase's bearer (M9: /api/v1/ takes no cookie)
    PASS: the mint page carries the plaintext, which appears in this one response and never again

### The one harness change, and it is the harness rather than the daemon

`05b-wireguard` drove four `/api/v1/` reads and the rotate action on the session
cookie 05-mutate leaves in the jar. After the cutover that cookie is not a
credential there, so the phase mints its own bearer at `POST /builtin/tokens`
— the bootstrap, which is not an `/api/v1/` route and still takes the cookie —
and sends it thereafter. It mints rather than borrowing 05d's because 05d runs
**after** it, and a phase depending on a later one would invert the runner's
order.

Two assertions in it were NOT changed, deliberately:

- the anonymous rotate still sends no credential at all and still asserts 401.
  Giving it one would delete the assertion M9 exists to make.
- the 5b.6 loop keeps both surfaces in one list and picks the credential per
  path. The claim is that NO surface serves a private key; two loops would let
  one of them quietly stop being checked.

`04-readonly` and `05d-bearer` needed nothing. `04-readonly` presents the cookie
only to UNDECLARED paths, which the gate answers and which the cutover does not
touch. `05d-bearer` was written for this milestone — its own header says the
phase *"may not"* lean on the cookie *"because after that cutover the cookie is
gone"* — and it uses a second `Client` whose jar is structurally empty.

Build prerequisites, recorded because the first two attempts failed on them and
the third did not: `os/pkgs/rauc` and `os/pkgs/podman` must be built first
(`MOS_ARCH=amd64`), and `MOS_BUILD_CONTAINER=1` must **not** be set for
`os/rootfs/build-v2.sh` — that mode refuses `--build-rootfs`, because the
rootfs build drives `docker buildx`, which is a CLI plugin the pinned container
does not carry. RFCT-235's podman wall is the arm64 cross-build and does not
reach an x64 host build.

## 6. One finding, reported and not fixed

**A bearer-only client that asks for an UNDECLARED path under `/api/` is
redirected to `/login`.** The gate's whole credential test is
`if session::cookie_from_headers(request.headers())`
(`os/pkgs/mosd/apid/src/routes.rs:3374`), and only *declared* routes are handed
off to answer for themselves, so an undeclared path under the prefix reaches
the gate and a bearer does not satisfy it. That is §3.1's trap on the surface
§3.1 is about: the 303 lands on `GET /login`, which answers 200 with HTML.

It is **not** introduced by M9 — the gate has taken only the cookie since long
before M2 — and the tree already asserted it before this task, in
`an_absent_token_id_is_404_and_a_malformed_one_is_422`, whose bearer arm
asserts the 303 and is left exactly as it was. Three tests that assert the
reserved subtree's `not_found` therefore keep the cookie, each with a comment
saying why it is the cookie there.

Harmonising the gate is out of scope for M9 (which is the write surface's
credential, not the gate's) and is left for whoever takes the surrounding
cleanup, beside the CIDR gap M8 measured and deliberately left open.

## 7. The merge RFCT-246 could not make

RFCT-246's task became unstartable in BKD, so M9 carried its branch in. Five
files conflicted, all citation/index, none in code.

> **Dated note (2026-08-28, after this task reported).** The premise of this
> section's heading and of the sentence above it is false, and neither is
> rewritten: they record what was believed while M9 ran and what was done on
> that belief. RFCT-246's task was **not** unstartable. The mechanism was
> measured afterwards: on this server BKD execution is driven by the follow-up
> queue, and a status transition spawns no process at all. Every remedy tried
> on that issue was status-side, which is exactly why none of them worked, and
> the issue revived on a plain follow-up.
>
> Nothing done here depended on the belief. `bkd/x4agijkt` was merged as plain
> commits, which is the same operation whether or not its task could have been
> woken, and Duty 2's run had to happen on the cutover tree in any case — so
> routing it back would have meant a merge in each direction for no gain. What
> changes is only the reason the carry was necessary: it was a scheduling fact
> about this campaign, not a property of the task.

The four citation-bearing documents were resolved against **RFCT-246's** side
rather than the L2 side, which is the opposite of the instruction, and the
measurement is why. `redirect_app()` is at `routes.rs:3232` in the merged tree.
The L2 side cited `3204-3208`, which lands on a `tracing::warn!` inside a
bearer check; RFCT-246 cited `3168-3172`, exact at its own base. At the shared
base api.md read `3140`; RFCT-246 re-derived it to the correct `3168`, while L2
applied a correct +64 map to the uncorrected `3140` and got `3204`. So the L2
numbers are a right map over a wrong input and RFCT-246's are the
content-re-derived ones. Taking RFCT-246's side and mapping once through the
base→tree delta reproduces the L2 number wherever L2 was right — the fdo error
constants, `377/378/379` → `394/395/396` — and corrects it where it was not.
47 citations, every endpoint byte-identical at both ends, 0 unmapped.
