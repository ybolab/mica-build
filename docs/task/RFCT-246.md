# RFCT-246 PLAN-023 M9 prerequisite: `test/apid-api` drives bearer end to end

- **status**: completed — `05d-bearer` was RUN against a booted x64 guest and drives the whole `/api/v1/` surface on a bearer token alone, 37/37 in the phase and 376/376 across both boots; one stale `05b` assertion the merge exposed was corrected to M6's ruled 404
- **priority**: P1
- **owner**: bkd/x4agijkt
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-023 (M9 prerequisite)

M9 removes the session cookie from `/api/v1/`. It may not be scheduled until
`test/apid-api` proves a bearer token drives the API surface end to end, because
after that cutover the cookie is gone and a harness that still leans on it is a
harness that cannot run. This task is that proof, and the bar is RFCT-212's, not
this task's own: that milestone declined to write an `apid-api` phase it would
not execute, on the reasoning that *"a phase written but never run is a claim,
not a measurement"*. So the deliverable is not the phase. It is the phase, run
against a booted image, with the output pasted.

## 1. The merge this branch is cut across

The branch was cut from `main`, which is ahead of `bkd/vu5b6kk0`, so the first
step was `git merge bkd/vu5b6kk0`. Sixteen files conflicted, and every one of
them conflicted on **line numbers alone**: both sides had edited
`os/pkgs/mosd/apid/src/routes.rs` and both had then re-anchored the same
citations against their own tree. Classified mechanically — strip the digits
from each side of each hunk and compare — 121 of the 124 conflicted hunks were
numbers-only.

Resolution, and why each way round:

- `docs/task/index.md`: both row blocks kept, ascending, per the campaign rule.
- `os/pkgs/mosd/apid/src/routes.rs`, the `GET /api/v1/state` response list: the
  **union**. `bkd/vu5b6kk0`'s 401 wording, which names the bearer, and `main`'s
  404 `settings_not_found` row from PLAN-025 M3a. Taking either side alone would
  have made the document disagree with the merged handler, which still answers
  `ApiError::mosd("settings_not_found", message).at(&path)`
  (`os/pkgs/mosd/apid/src/routes.rs:1270`) on an unresolved dot-path — and the
  auto-merged `openapi.json` had already landed on exactly that union,
  so either side alone would also have desynchronised the two.
- Every other hunk: resolved to `bkd/vu5b6kk0` with `-X theirs`, then
  re-anchored.

### 1.1 The re-anchor, done from the pre-image and not by hand

The three citation rules of record apply and the corpus is too large to eyeball:
252 citations across 17 documents moved. They were re-anchored **mechanically**,
per citation:

1. Decide the side from the DOC LINE. A citation's number was anchored against
   whichever tree its own line of prose was written on, so the line is looked up
   in each side's blob of that document. Present in one only decides it.
2. Map the cited line through a line-level diff of that side's blob of the
   **cited** file against the merged worktree file.
3. Where the doc line sits on both sides and the two sides disagree on the
   answer, leave it and report it. That case arose once, in `docs/plan/`, which
   the citation gate does not scan and this task does not edit.

Four citations were then fixed by hand, because a mechanical map cannot invent a
line that no longer exists. Two of them are still this branch's; the fourth was
later superseded by RFCT-214, as the note below records:

| citation | why the map could not answer it |
|---|---|
| *"resource_response(value, &path)"* (`docs/design/api.md:837`) | `main` replaced the state handler's one-line tail with a `let value = …` and a match, so the quoted call text changed as well as its line |
| *"resource_response(value, &path)"* (`docs/design/api.md:1310`) | the same call, quoted a second time in section 2.2 |
| *"pub const SCHEMA_VERSION: u32 = 8;"* (`docs/design/mosd.md:433`) | RFCT-232's dated note quoted the constant at 7, and the campaign branch's M2-part-1 bump made it 8 |
| the same quote in `docs/task/RFCT-232.md` | the same problem, in the record that made the note |

The `mosd.md` edit changes a **number inside a dated note**, not the note's
claim: the sentence says in the same breath that the version is the stale part
and that the point survives it, and it was written against a tree where the
constant was 7. The merge made it false as a quotation while leaving it true as
an argument, and a quotation that no longer quotes anything is what the citation
gate exists to catch.

**The `RFCT-232.md` half was superseded, and by the better answer.** This branch
first made the same numeric edit there, and then the second merge below brought
down RFCT-214's census, which had reached the same conflict and resolved it the
other way round: keep the record's measured `= 7`, drop the line anchor, and say
in the text that PLAN-023's v8 bump has since moved the value. That preserves
what the task measured instead of quietly restating it, which is the right
treatment for another task's record and is RFCT-214's call to make, not this
one's. RFCT-214's version is what is in the tree; this branch's numeric edit to
that file is gone.

## 2. What was built

One phase, `test/apid-api/src/phases/05d-bearer.ts`, registered in
`test/apid-api/src/main.ts` between `05c-kernel-net` and `06-backoff` and added
to the first boot's default phase list in `test/apid-api/run.sh`.

Its position is forced from both ends. It needs the session cookie `03-login`
established, because the bootstrap mint is the one request in the phase that
uses it; it needs the `wg-e2e` tunnel `05b-wireguard` declares and leaves
behind, because the rotate action needs a subject; and it must sit before
`06-backoff`, which spends the login guard, and before `07-reboot`, which takes
the guest down.

### 2.1 The cookie is used once, structurally

The phase issues **one** cookie-authenticated request: `POST /builtin/tokens`.
That is not a shortcut, it is the only door. The three `/api/v1/tokens` routes
take `ApiBearer`, which refuses a session outright — *"this route accepts a
bearer API token only; a session cookie is not a credential here, and a browser
mints its first token at POST /builtin/tokens"*
(`os/pkgs/mosd/apid/src/routes.rs:3154`) — so the first token cannot be minted
with a token.

Every request after that mint is issued from a **second `Client`**, constructed
inside the phase. Its jar has never been handed a `Set-Cookie` line and nothing
in the phase logs in with it, so no request it makes can carry a cookie. That is
structural rather than a `sendCookies: false` argument repeated on thirty calls,
because a flag can be forgotten on one of thirty and an empty jar cannot. The
emptiness is asserted at the top of the phase and again at the end, so the
property is a check and not a comment.

### 2.2 What it covers

| # | what | route |
|---|---|---|
| 1 | the bootstrap mint, and the plaintext spelled `mos_<id>_<secret>` | `POST /builtin/tokens` (cookie) |
| 2 | a settings read | `GET /api/v1/settings/hostname` |
| 3 | a settings write, flipped and flipped back | `PUT /api/v1/settings/mqtt.enabled` |
| 4 | a collection listing | `GET /api/v1/ssh/authorized-keys` |
| 5 | a collection `POST` and its `DELETE` | `POST` / `DELETE /api/v1/ssh/authorized-keys[/{fingerprint}]` |
| 6 | an action | `POST /api/v1/actions/wireguard/wg-e2e/rotate-key` |
| 7 | the listing, a second mint through the API, and a revocation by id | `GET` / `POST /api/v1/tokens`, `DELETE /api/v1/tokens/{id}` |
| 8 | the revoked token refused on the **next** request, the second still working | `GET /api/v1/settings/hostname` |
| 9 | **no credential at all is 401** with section 2.4's envelope | `GET /api/v1/settings/hostname` |

Item 9 is the negative M9 depends on, and it is asserted as more than a status:
the response must be `application/json`, carry `error.code`
`not_authenticated` and `error.source` `apid`, carry a human `message`, and
**omit** `path` — a failed authentication names no dot-path. It must also not be
the gate's 303 to `/login`, which is the failure section 3.1 names by hand: a
client that follows that redirect lands on a 200 HTML page and reads the whole
exchange as success.

Item 3 chose `mqtt.enabled` out of `WRITABLE_SETTINGS`' four because it is the
only one no other phase touches: 05-mutate drives `container.enabled` and
`access.ssh.enabled` through their panes and 07b-postreboot reads `hostname`
back across the reboot.

Item 5's fingerprint carries a `/`, deliberately, and is sent percent-encoded —
the spelling apid's own route tests use in `ssh_key_url`:
`fingerprint.replace('/', "%2F")`
(`os/pkgs/mosd/apid/src/tests.rs:7342`). Sent raw it would split the segment
and the resulting 404 would read as "apid forgot the key".

### 2.3 What it leaves behind

What it found. The flag is flipped back, the key it adds is removed, and both
tokens it mints are revoked — the second by itself, which is also the last
check: a token that revoked itself is refused on its own next request. The one
thing not restored is `wg-e2e`'s private key, which a rotation replaces by
definition; 05b leaves the tunnel behind and no later phase reads its key.

## 3. The run, which is the deliverable

Built here, because the harness builds nothing and no x64 image existed on this
host: `MOS_BOARD=x64 bash os/rootfs/build-v2.sh && bash os/build/run.sh
--mkimage-x64`, giving `x64-mos-v2-1787929866.img`. `os/pkgs/rauc/out-amd64` and
`os/pkgs/podman/out-amd64` were **copied** from a sibling worktree rather than
rebuilt, after `diff -r` showed both package sources identical to this tree's
(only the build-generated `versions.lock` differed). `mosd` and `apid` are
compiled from source by `build-v2.sh` itself, so the image under test carries
this merge's bearer routes and not a sibling's.

Then `bash test/apid-api/run.sh`, twice.

### 3.1 Run 1 — RED, and not on this phase

    FAIL: rotating an interface that is not a declared WireGuard entry is 422
        expected: status 422
        actual:   status 404 Not Found
        request:  POST /api/v1/actions/wireguard/no-such-iface/rotate-key
    FAIL: the refusal carries §2.4's envelope: settings_rejected, from mosd, naming the dot-path at fault
        expected: JSON containing {"error":{"code":"settings_rejected","source":"mosd","path":"network.no-such-iface"}}
        actual:   JSON {"error":{"code":"settings_not_found","message":"network.no-such-iface is not a declared network entry","source":"mosd","path":"network.no-such-iface"}}
    RESULT: FAIL (282/284 checks)

A merge seam, and the daemon is the correct side of it. `05b-wireguard.ts` came
from `main`, which predates PLAN-023 M6; RFCT-242 section 1 rules that on this
route *"404 added: an undeclared entry. 422 now means only 'exists and is not a
tunnel'"*, and this merge is the first tree carrying both the corrected daemon
and the stale assertion. Because the runner skips every later phase once one
fails, **`05d-bearer` never ran** — it was `SKIP`ped along with 05c, 06 and 07.
A skip is not a pass and it is not a measurement either, which is the whole
reason this task was told to run the thing.

The two assertions were corrected in place. `test/apid-api/**` is this task's to
edit and `os/pkgs/mosd/**` is not — and no `os/` change was needed, because apid
was already right.

### 3.2 Run 2 — the measurement

`RESULT: PASS (376/376 checks)` over two boots (boot 1: 343/343; boot 2:
17/17), with `05d-bearer` green on all 37 of its own checks. The phase output,
verbatim:

    PHASE 05d-bearer: the bearer credential drives /api/v1/ end to end, and no credential is 401
    PASS: the bearer client's cookie jar is empty before the phase starts, so no /api/v1/ request below can carry a session
    PASS: the shared client still holds the session cookie 03-login established, which is what the bootstrap mint needs
      -- 1. the bootstrap mint: the session cookie, used once and then never
    PASS: POST /builtin/tokens with the session cookie mints the first token (the only way the first token can exist)
    PASS: the mint page carries the token identifier and the plaintext, which appear in this one response and never again
    PASS: the plaintext is spelled mos_<id>_<secret> and carries the identifier the page displayed
      -- 2. the surface, driven by Authorization: Bearer and nothing else
    PASS: a settings READ over the bearer: GET /api/v1/settings/hostname is 200
    PASS: the read answers the value itself (ResourceValue is serde(transparent)), not a wrapper around it
    PASS: the flag this phase writes reads back before it is touched: GET /api/v1/settings/mqtt.enabled is 200
    PASS: a settings WRITE over the bearer: PUT /api/v1/settings/mqtt.enabled true is 204
    PASS: the write took: reading mqtt.enabled back over the bearer answers true
    PASS: mqtt.enabled is restored to false, so this phase leaves the device as it found it
    PASS: a collection LISTING over the bearer: GET /api/v1/ssh/authorized-keys is 200
    PASS: the listing is an object carrying `keys` and the collection's `notice`, not a bare array
    PASS: a collection POST over the bearer: adding an authorized key is 201
    PASS: the add answers the fingerprint `ssh-keygen -lf` prints, which is this entry's DELETE segment
    PASS: the added key is in the listing the bearer reads back
    PASS: a collection DELETE over the bearer: removing the key by its percent-encoded fingerprint is 204
    PASS: the delete took: the fingerprint is absent from the listing afterwards
    PASS: an ACTION over the bearer: POST /api/v1/actions/wireguard/wg-e2e/rotate-key is 200
    PASS: the rotation answers the new public half in padded base64, and no private material
    PASS: the rotation body carries no `privateKey` member -- there is no read-back route for the private half, ever
      -- 3. the token lifecycle: list, mint a second, revoke the first
    PASS: GET /api/v1/tokens over the bearer is 200
    PASS: the listing is an array carrying the bootstrap token by the id and name it was minted under
    PASS: the listing publishes neither the plaintext nor the stored digest
    PASS: POST /api/v1/tokens with the first token as credential mints a second: 201
    PASS: DELETE /api/v1/tokens/{id} revokes the first token, addressed by id and authorised by the second: 204
    PASS: the revoked token is refused on the very NEXT request: 401
    PASS: the refusal is §2.4's envelope with `not_authenticated`
    PASS: the second token still drives the API in the same breath: 200
      -- 4. no credential at all: the 401 the cookie cutover depends on
    PASS: a request carrying NO credential is 401, and not the gate's 303 to /login
    PASS: the 401 is JSON, so a client that parses the envelope on every other failure has something to parse here
    PASS: the 401 body is §2.4's envelope: `error.code` is `not_authenticated` and `error.source` is `apid`
    PASS: the envelope carries a human message and omits `path` -- a failed authentication names no dot-path
    PASS: a bearer token this device does not hold is 401, indistinguishable from none at all
      -- 5. cleanup: the token set this phase created, removed
    PASS: the second token revokes itself, leaving the device with the token set it started with
    PASS: a token that revoked itself is refused on its own next request: 401
    PASS: the bearer client's jar is STILL empty at the end: every /api/v1/ request in this phase was driven by the token alone

### 3.3 The run is still the measurement of this HEAD

The suite ran at `1207096`, and this branch then merged `bkd/vu5b6kk0` a second
time to pick up RFCT-214's citation census. The whole of what that merge changed
under `os/pkgs/mosd/` is four lines of **key order** in `openapi.json`
(`"404"` and `"405"` swapped on the state route), a generated document the
running daemon never reads. No `.rs` file under `os/pkgs/mosd/` differs between
the commit the image was built from and this HEAD, and nothing under `test/`
differs either. The image under test is therefore behaviourally the daemon this
tree describes, and the run above is not restated from an older tree.

### 3.4 The sentence M9 is waiting on

**`test/apid-api` drives `/api/v1/` end to end on a bearer token alone.** The
session cookie is used for exactly one request in the phase, the bootstrap mint
at `POST /builtin/tokens`, which is outside `/api/v1/` and which M9 does not
touch. Every `/api/v1/` request the phase makes — a read, a write, a collection
listing, a collection add and its removal, an action, and all four token
operations — is carried by `Authorization: Bearer` on a client whose cookie jar
was empty before the first of them and was still empty after the last, asserted
both times. M9's precondition is discharged, and the negative it depends on is
measured on a real guest: no credential is a JSON 401 in section 2.4's envelope,
not a 303 to a page that answers 200.

## 4. Findings, not fixed here

- `test/apid-api/README.md`'s phase table did not list `05c-kernel-net` before
  this task and still does not. Only the row for the phase this task adds was
  written, because the table is not this task's to correct.
- The same file's *"two boots, ten phases"* and `src/runner.ts`'s identical
  sentence were already one short of the registry before this task, and are now
  two short. Left as found, for the same reason, and recorded here so the count
  is not read as this task's arithmetic.

## 5. Gates

`docs/verify-citations.sh` and `docs/verify-index.sh`, both on the merged tree.
The Rust gate is not this task's: no Rust changed here beyond the merge's own
`GET /api/v1/state` response-list union, which is a doc-comment attribute. The
`oasdiff` gate is not this task's either: `openapi.json` is untouched except by
the merge.
