# RFCT-215 PLAN-023 closeout: api.md section 1 re-measured against the final surface

- **status**: completed — section 1 rebuilt from `app()` and `api_router()` (59 declared pairs, not 30; 27 under `/api`, not 4), the false quotation and 204 bare continuations replaced with gate-checkable full-form citations, section 1 now carrying none of the no-slash form; §2's introduction, §2.1's counts and §2.4's heading and re-audited Ships? table follow; six residue items re-measured and recorded, not fixed; 2170/2170 citations, 863/863 index, 836/836 Rust, oasdiff RC=0
- **priority**: P1
- **owner**: bkd/yyssrqns
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-023 (closeout)

The terminal task of PLAN-023. M1-M9 have merged: the write surface exists, the
bearer token is the only credential on `/api/v1/`, and section 1 of
`docs/design/api.md` still described a daemon nine milestones behind the tree.
This task re-measures section 1 from the router and makes it true, corrects the
two section-2 counts the campaign falsified without owning, corrects one count
in `test/apid-api`, and records — with its measurement — the residue the
campaign deliberately left open.

Everything below was measured at this branch's HEAD from the code. Nothing is
relayed: where a prior record stated a number, the number was taken again.

## 1. What section 1 said, and what the tree says

Section 1.2 was rebuilt from `app()` and `api_router()` the way RFCT-210
rebuilt section 2.3's inventory: read the declarations, write down what is
there. Every count in the rewritten subsection is a count of the declarations
it cites.

| Claim as it stood | Measured now |
|---|---|
| §1.2 "the `/api` subtree … **Four declared routes** and a not-found" | twenty-seven declared method+path pairs |
| §1.2's HTML table, twenty-two rows | thirty-two HTML method+path pairs; the table was missing `/password` (GET and POST), `/network/peers/add`, `/network/peers/remove`, `POST /builtin/tokens` and `POST /builtin/tokens/revoke` |
| §1.2 "**twenty-one** `.route()` calls … the nested `/builtin` router declares **two** … `api_router()` declares **four** — **twenty-seven**" | twenty-four, four and twenty-one — **forty-nine** `.route()` calls; three `.fallback()` and one `.method_not_allowed_fallback` |
| §1.2 "**thirty** declared method+path pairs" | **fifty-nine**: twenty-eight outer (12 GET, 16 POST), four nested (1 GET, 3 POST), twenty-seven under `/api` (9 GET, 3 PUT, 10 POST, 5 DELETE) |
| §1.2 "**No route accepts a JSON request body.** `Json` appears exactly once in the file" | ten handlers take one; `Json` appears eight times, and `json_body` is shared by four of the routes |
| §1.2 "named in twelve handler signatures" (`Form<...>`) | seventeen |
| §1.2 "`status_body`… `GetSettings("hostname")`, `GetState("network")`" | three bus calls: `hostname`, `network` and `uptime` |
| §1.1 "`grep -ci '<script\|javascript' mosd/apid/src/routes.rs` returns `0`" | returns `1`; the hit is prose in a doc comment. The substantive claim (no `script` element) still holds and is now evidenced by a command that measures it |
| §1.1 the `STYLE` body was said to run from `:3326` to a line holding `Err(err) => return bus_error(&err),` (`os/pkgs/mosd/apid/src/routes.rs:3349`) | it ends at line 3333; the line it named is inside `gate` |
| §1.3 "**five** [methods], across two proxy traits" | six: `rotate_wireguard_key` was added by M6 |
| §1.3 "`com.mos.mosd1` now serves **eleven** methods" | twelve |
| §1.3 "four [live-state] paths" | five literal paths, plus the health probe and the wildcard passthrough |
| §1.4 the gate was said to run from `:3271` to a line holding `static asset still serves while mosd is down` (`os/pkgs/mosd/apid/src/routes.rs:3335`) | it ends at line 3319; the line it named is inside the ordering comment |
| §1.4 decision 2 cited at `:3266-3270` | the session check is at `:3294-3298`; `:3266-3270` is the doc comment |
| §1.4 "There is no `Authorization` header path, no API key, and no token of any kind in the crate" | false in every clause since M2 |
| §1.4 the `access` read "is now paid only by an **unauthenticated** request" | every bearer check pays it too — see section 3 |
| §1.4 "sets the cookie … at `:4332-4336`" and `POST /setup` at `:3926-3931` | `:4360-4364` and `:3954-3958`; `:4332-4336` is the 429 branch |
| §1.5 `schema_version` row "read-only, value 7" | **8**, which the prose two paragraphs above already said |
| §1.5 `wifi.client` at `model.rs:295-296`, `wifi.ap` at `:297-298` | both land inside `pub struct ApiToken`; the fields are at `:361` and `:363` |
| §1.5 the SSH pane "edits it in memory (`:6711-6715`)" | `:6711-6715` is inside `ssh_password`; the edits are `keys.push(parsed);` at `:6828` and `keys.remove(index);` at `:6868` |
| §1.5 "apid's HTML panes read four paths today" | five |
| §1.5 `network` reconciler at `reconciler/network.rs:432-438` | `:633-639` |
| §1.6 the stylesheet "emitted into the page head (`:3316`)" | `:3344` |
| §1.6 the bundle store "written only by the deactivate control (`:5027`)" | `:5055` |
| §1.6 `tests.rs:1821` "reads the committed `openapi.json`" | the `include_str!` is at `:1824` |
| §1.7 item 1, the built-in branch "at `:4714`" | `:4742` |
| §1.7 item 2 "missing thirteen routes" | forty-four of the fifty-nine pairs |
| §1.7 item 3 "now eleven methods"; `set_transient_root_password` "called at `:6688`" | twelve methods; called at `:6716` and `:6795` |
| §1.7 item 4 "now four call sites"; `:6014`, `:5802`, `:6060` | eight call sites; `:6042`, `:6265`, `:6523` |
| §1.7 "`shell()` now renders **eight** links (`:3321-3334`)" | **nine** links at `:3349-3362`; `Password` is the missing one |
| §2 intro "**exactly four paths**, all `GET`" and "`components.schemas` are exactly five" | twenty-one paths, twenty-seven operations, twenty-six schemas |
| §2 intro "**Four read routes, no writes, no actions, no collections**" | reads, writes, four collections, five actions and one unauthenticated first-run route |
| §2.1 "**"JSON in" does not ship**" | ten routes take a JSON body |
| §2.1 "The twenty-six existing HTML paths" | thirty-two |
| §2.1 the discovery table's `"settingsSchemaVersion":6`, and `:736`/`:400`/`:762` | `8`; the handlers are at `:778` and `:804`, declared at `:416` and `:417` |
| §2.1 "`/healthz` … unauthenticated (`:3245`, `:3278-3280`)" | `:3321-3323`, released by the gate at `:3273` |
| §2.4's heading, "ten of its codes" | see section 4 |
| §2.4 "`bus_api_error` (`:3004-3052`)", "five error names declared at `:394-396`", "payload at `:646-661`" | `:3038-3088`, `:392-396`, `:686-703` |

## 2. The false quotation, and the sweep for others

`api.md:231` quoted
`resource_response(state.api.get_state(&path).await, &path)` against `:506`.
That expression exists nowhere in the tree: `api_v1_state` now separates an
unresolved dot-path out as a 404 before calling
`resource_response(value, &path)` (`os/pkgs/mosd/apid/src/routes.rs:1272`).

The citation gate could not see it. Its content check arms only on a
`path:line` token whose path contains a `/`; a bare `:506` continuation is
never resolved and never content-checked, so a quotation attached to one fails
silently and forever.

**The sweep.** Rather than fix the one row, section 1 was scanned for every
quoted span armed against a bare continuation, resolving the antecedent by the
rule M8 and M9 both used — *nearest preceding full-form citation anywhere in
the document*. **Ninety-four such pairs**, of which **eighty-two did not
resolve**. They are not eighty-two separate errors: the antecedent rule itself
breaks down inside a markdown table, where the nearest preceding full-form
citation can be several rows above and in a different file. Rows 202-212 of the
old §1.2 table resolved their continuations against
`os/pkgs/mosd/apid/src/bus_client.rs`, which is not where any of those handlers
live.

That is why the fix is structural rather than per-row: **§1.2's two tables were
rebuilt with full-form citations, each armed by an adjacent literal that the
gate can check.** A row that names a handler now names it as
`` `fn ssh_key_add` (`os/pkgs/mosd/apid/src/routes.rs:6877`) ``, which the gate
resolves *and* content-checks. The same was done for §1.5's settings-subtree
table, which was written entirely in the no-slash form.

## 3. The claims-made-false ledger, verified at HEAD

M2, M4, M7, M8 and M9 each recorded claims their work falsified and left them
for the milestone that owned them. Collected, verified, and — for the ones
inside section 1 — fixed.

| Recorded by | Claim | Verified at HEAD | Action |
|---|---|---|---|
| RFCT-213 §5 item 2 | §1.4's *"There is no `POST /api/v1/tokens` and no `DELETE /api/v1/tokens/{id}`"* | both are declared (`os/pkgs/mosd/apid/src/routes.rs:427-431`) | fixed in §1.4 |
| RFCT-213 §5 item 2 | §1.4's *"now paid only by an **unauthenticated** request"* | **false.** `access_settings` (`os/pkgs/mosd/apid/src/routes.rs:3243`) has two callers, the gate's unauthenticated path and `async fn bearer_is_stored` (`os/pkgs/mosd/apid/src/routes.rs:3218`), which reads it at `let access = match access_settings(state).await {` (`os/pkgs/mosd/apid/src/routes.rs:3224`); the source says why the token list is under `access` — *"The subtree the gate already reads, which is why §3.2 put the list under `access` rather than beside it: no second round trip per request."* (`os/pkgs/mosd/apid/src/routes.rs:3222-3223`) | fixed in §1.4, with the cache condition stated |
| RFCT-213 §5 item 3 | §2.4's row describing the 401 as raised by *"the session-cookie extractor"* | already corrected by M9; the row now reads `ApiBearer` | no action |
| RFCT-240 §5 item 2 | §3.2's *"the four served paths are `GET` only"* | §3.2 is not this task's section | recorded, not fixed |
| RFCT-240 §5 item 3 | §2.2's and §2.3's status prose about the whole write surface | not this task's sections; §2.3's inventory is RFCT-210's dated record | recorded, not fixed |
| RFCT-240 §5 item 5 | §2.3's *"There is no `POST` and no `PUT` anywhere under `/api`"* | false; §2.3's table is a dated measurement the campaign supersedes row by row | recorded, not fixed |
| RFCT-243 §8 | section 1 named as RFCT-215's | that is this task | done |
| RFCT-244 §10 | section 1, and the CIDR finding recorded and not changed | verified below | residue item 1 |
| RFCT-245 §6 | the gate's credential test reads only the cookie | verified below | residue item 2 |

Two of RFCT-240's items are worth naming precisely, because they look like
section-1 work and are not. `docs/design/remote-management.md`'s *"The JSON API
under `/api` is read-only"* and §2.2/§2.3's status prose are **not** in section
1 and not in the two section-2 counts this task was given; correcting one
clause of §2.3 would leave the twenty rows around it saying the opposite.

## 4. Section 2.4 re-audited

RFCT-242 flagged that §2.4's heading count and its dated "Ships?" table had
been overtaken, and correctly refused to correct a count over a table it had
not re-audited. This is the audit.

**Method.** Every `ApiError::apid(` and `ApiError::mosd(` construction in
`os/pkgs/mosd/apid/src/routes.rs` with a literal code, counted by line.
**Fifty-seven call sites carrying twenty-two distinct codes.**

    22  validation_failed        1  mosd_failed
     7  request_invalid          1  mosd_unreachable
     5  settings_invalid         1  method_not_allowed
     3  settings_not_found       1  key_limit_reached
     2  settings_read_only       1  key_exists
     2  mint_failed              1  hashing_failed
     1  wrong_password           1  hash_failed
     1  token_limit_reached      1  already_configured
     1  ssid_exists              1  not_found
     1  settings_rejected        1  not_authenticated
     1  settings_io              1  peer_exists
                                ---
                                 57

- **All seventeen codes §2.4's own table names ship.** The two the snapshot
  recorded as **not** shipping both do: `request_invalid` (seven sites) became
  reachable when routes started taking JSON bodies, and `validation_failed`
  (twenty-two sites, the most-used code in the crate) when apid's own
  validators moved onto the API path.
- **Five codes ship that §2.4 never proposed:** `settings_invalid`,
  `already_configured`, `mint_failed`, `hash_failed`, `hashing_failed`. Each is
  additive under §2.1 — a new `error.code` for a failure that previously had no
  distinct code. They are listed beside the table rather than folded into it,
  because that table is the section's proposal and these were not proposed.

The heading therefore moves from *"ten of its codes"* to *"all seventeen of the
codes it names, five more it never proposed"*, and the Ships? table is replaced
by the seventeen-row audit above, every row citing the constructing line.

## 5. The citation rule of record, as applied here

The corrected rule — *the side holding content re-derivations wins, because
they cannot be recovered mechanically; the side holding shifts loses, because
they can* — did not have to arbitrate a conflict in this task, and the test the
rule prescribes is why. There were two merges of `bkd/vu5b6kk0`.

The first, at the start, was a **fast-forward**: this branch was cut from the
same commit L2 then stood on, so there was nothing to reconcile.

    $ git merge-base HEAD bkd/vu5b6kk0
    77a32789d43bc3ce1d8abb26374aaaf672506369      # == HEAD before the merge

The second, at the end, brought in L2's dated-note commit on RFCT-245. The
rule's test was run on it before merging:

    $ git diff --stat $(git merge-base HEAD bkd/vu5b6kk0) bkd/vu5b6kk0 -- os/
    (empty)
    $ git diff --stat $(git merge-base HEAD bkd/vu5b6kk0) bkd/vu5b6kk0
     docs/task/RFCT-245.md | 16 ++++++++++++++++

The incoming side changed no code, so under the corrected rule every citation
change it carried would have had to be **carried, not discarded**. It carried
none, and it touched one file this task had not, so the merge was clean and the
rule cost nothing here. It is recorded because the test, not the outcome, is
the part that has to be repeated next time.

The rule that *was* applied is the one about this task's own edit. Rewriting
section 1 moves every line below it in `docs/design/api.md`, and other
documents cite those lines. Those citations are **shifts**, not
re-derivations, so they were remapped mechanically, in a commit of their own,
from the gate-green pre-image — no constant offset, difflib equal-block
opcodes only, both endpoints of a range mapped independently, and a citation
moved only when its destination text is byte-identical to its source.

**Antecedent rule stated, because it is not optional context.** For the bare
`:NNN` continuation form this record uses *nearest preceding full-form
citation anywhere in the document* — M8's rule, under which it reported
209/146 and could not reproduce M7's 184 under any scoping.

**Bare continuations are RFCT-214's census and were not swept.** This delta
moves them only where it rewrote the prose around them. Counted as
`` `:NNN` `` and `` `:NNN-MMM` `` tokens — a form the gate's token regex does
not match at all, so it appears in no line of the gate's own summary:

| | pre-image `c21a2d4` | this HEAD |
|---|---|---|
| `docs/design/api.md`, whole file | 377 | 168 |
| `docs/design/api.md`, section 1 only | 235 | 31 |
| `docs/task/RFCT-210.md` | 17 | 17 |

**209 removed from api.md, 204 of them inside section 1**, each replaced by a
full-form citation the gate resolves and, wherever an adjacent literal exists,
content-checks. None was re-pointed while staying bare except inside sentences
this task rewrote. RFCT-210's count is untouched, as M9 also left it.

**The no-slash form.** This one the gate does count, as *"skipped, bare
filename with no directory to resolve against"*: **416** corpus-wide at the
pre-image, **393** now. In `docs/design/api.md` the `routes.rs:NNNN` shape went
from 42 tokens to 34, and **section 1 now carries none at all** — the eight
`routes.rs:` and twenty `bus_client.rs:` tokens in §1.2/§1.3 went with the
table rewrites, and §1.5's fourteen `model.rs:` tokens were re-derived to full
form with the settings-subtree table. The 393 that remain are outside section 1
and are recorded for the gate backlog, not fixed here.

## 6. Residue: code defects the campaign measured and deliberately left open

**Not fixed here, and not to be read as unknown.** Each was re-measured at this
HEAD so whoever plans the next phase starts from evidence rather than from a
memory of a report.

1. **The CIDR gap — `PUT /api/v1/network/{iface}` accepts an invalid CIDR and
   answers 204.** `fn valid_cidr` (`os/pkgs/mosd/apid/src/routes.rs:3493`) has
   exactly one caller, `fn validate_iface` (`os/pkgs/mosd/apid/src/routes.rs:3524`), which
   runs it at `if !dhcp && !address.is_empty() && !valid_cidr(address) {`
   (`os/pkgs/mosd/apid/src/routes.rs:3545`).
   `validate_iface` has three callers: `iface_settings_from_form`, at
   `validate_iface(form.iface.trim(), dhcp, address)?;`
   (`os/pkgs/mosd/apid/src/routes.rs:3640`), and `setup_submit`, at
   `&& let Err(message) = validate_iface(iface, dhcp, address)`
   (`os/pkgs/mosd/apid/src/routes.rs:3954`) — both HTML — and, since M8,
   `api_v1_setup`, at
   `if let Err(message) = validate_iface(iface, cfg.dhcp, address) {`
   (`os/pkgs/mosd/apid/src/routes.rs:4216`). **No route of M6's
   typed network cluster calls it.** Pinned by
   `the_setup_route_runs_the_wizards_cidr_bound_where_the_network_routes_do_not`
   (`os/pkgs/mosd/apid/src/tests.rs:10312`).
2. **The gate asymmetry — a bearer-only client asking for an *undeclared* path
   under `/api/` is redirected to `/login`.** The gate hands off only declared
   routes (`os/pkgs/mosd/apid/src/routes.rs:3317`) and its whole credential test
   is the cookie (`os/pkgs/mosd/apid/src/routes.rs:3338-3342`); a bearer does not
   satisfy it. Predates M2. Asserted by
   `an_absent_token_id_is_404_and_a_malformed_one_is_422`
   (`os/pkgs/mosd/apid/src/tests.rs:6427`), whose bearer arm asserts the 303.
3. **`is_quotable` stays in the renderer, so the WiFi route still accepts a psk
   containing a quote or a backslash.** `fn is_quotable`
   (`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:200-204`) is applied only
   inside `fn encode_psk` (`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:234`), at
   `if !is_quotable(psk) {` (`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:248`). What the API route
   runs is `mosd_settings::validate_wifi_psk(psk)`
   (`os/pkgs/mosd/apid/src/routes.rs:2227`), and that function checks a 64-digit
   hex PMK or a length band and nothing else
   (`os/pkgs/mosd/mosd-settings/src/model.rs:449-460`). A psk carrying `"` is
   accepted at the route and rejected at render time.
4. **The gate-list/router agreement gap.** `fn is_declared_api_route`
   (`os/pkgs/mosd/apid/src/routes.rs:541-562`) is a second list of eighteen
   clauses, and nothing checks it against the router's registrations — the one
   test that names it (`os/pkgs/mosd/apid/src/tests.rs:5874`) is about path
   matching, not membership. axum exposes no route table to compare against.
5. **The mosd-side convergence.** `api_v1_state` reads an fdo error name and
   rewrites it — `if name.as_str() == FDO_INVALID_ARGS`
   (`os/pkgs/mosd/apid/src/routes.rs:1262`) — and its own comment says the
   cleaner fix is a `NotFound` name mosd-side
   (`os/pkgs/mosd/apid/src/routes.rs:1247-1256`). M6 shipped exactly that split
   for the rotate-key path, `return Err(SettingsFault::NotFound(format!(`
   (`os/pkgs/mosd/mosd/src/bus.rs:885`), so the two paths now disagree about
   which side names the condition.
6. **The import unsplits are now unblocked.** `use axum::routing::delete;` and
   `use axum::routing::put;` sit on their own lines
   (`os/pkgs/mosd/apid/src/routes.rs:30-31`) to keep RFCT-210's quoted negative
   resolving, with the reason in the comment above them
   (`os/pkgs/mosd/apid/src/routes.rs:25-29`). Section 1.2 now re-states that
   negative as a measurement of its own, so the record no longer depends on
   that line surviving verbatim. **Folding them is a code change and was not
   made here.**

## 7. Out of scope, untouched

- `docs/plan/**` and `docs/plan/index.md` (L2 closes those out),
  `docs/task/RFCT-216.md`.
- Every shipped route: nothing under `os/pkgs/mosd/` was edited by this task,
  which is why the Rust gate is a pure regression check.
- `docs/design/api.md` sections 2.2, 2.3, 3.x, 4-9, except the two counts this
  task was given in §2.1 and §2.4 and the §2 introduction they depend on.
- RFCT-214's bare-continuation census outside section 1, and the no-slash
  citation backlog outside section 1. Both are measured in section 5 and left.

## 8. Gates

| gate | result |
|---|---|
| `bash docs/verify-citations.sh` | **2170/2170 PASS** |
| `bash docs/verify-index.sh` | **863/863 PASS** |
| `bash hack/check.sh`, unmodified, in `localhost/mos-build-rust:amd64` | **836 tests run: 836 passed, 0 skipped**; `ALL CHECKS PASSED` |
| oasdiff 1.29.1 `breaking --fail-on ERR` vs `main` at `77a3278` | **RC=0** |

The container was confirmed `amd64` by
`docker image inspect --format '{{.Architecture}}'` before any result from it
was believed, and `dbus` was installed in it so the bus round-trip test could
run. `bash -c`, never `bash -lc`.

**The Rust gate is a pure regression check.** Nothing under `os/pkgs/mosd/` was
edited by this task, so 836 is the count it must stay at, and it did — the same
836 M9 closed on. `git diff --stat <L2 tip> HEAD -- os/` is empty.

**The citation count moved a long way and the reason is the point.** 1713 at
the pre-image, 2170 now. The growth is not new prose: it is section 1's detail
citations changing from forms the gate skips — 204 bare continuations and 42
no-slash tokens — into full-form citations it resolves, plus this record's own.
The bare-filename skip count fell 416 → 393 in the same pass, and the census
floors were raised to the measured counts in the commit that raised them.

**The unquoted ceiling moved 434 → 452** for `docs/design/api.md`, raised in
the same commit as the change, which is the ratchet's own override procedure.
The net is a document with 18 more unquoted citations and 246 fewer unresolved
ones. `docs/task/RFCT-215.md` takes a ceiling of 8.
