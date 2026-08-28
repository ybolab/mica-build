# RFCT-246 PLAN-023 M9 prerequisite: `test/apid-api` drives bearer end to end

- **status**: in progress
- **priority**: P1
- **owner**: bkd/x4agijkt
- **createdAt**: 2026-08-28
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
  (`os/pkgs/mosd/apid/src/routes.rs:1228`) on an unresolved dot-path — and the
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
line that no longer exists:

| citation | why the map could not answer it |
|---|---|
| *"resource_response(value, &path)"* (`docs/design/api.md:674`) | `main` replaced the state handler's one-line tail with a `let value = …` and a match, so the quoted call text changed as well as its line |
| *"resource_response(value, &path)"* (`docs/design/api.md:1105`) | the same call, quoted a second time in section 2.2 |
| *"pub const SCHEMA_VERSION: u32 = 8;"* (`docs/design/mosd.md:433`) | RFCT-232's dated note quoted the constant at 7, and the campaign branch's M2-part-1 bump made it 8 |
| *"pub const SCHEMA_VERSION: u32 = 8;"* (`docs/task/RFCT-232.md:211`) | the same quote, in the record that made the note |

The two `SCHEMA_VERSION` edits change a **number inside a dated note**, not the
note's claim: both sentences say in the same breath that the version is the
stale part and the point survives it, and both were written against a tree where
the constant was 7. The merge made them false as quotations while leaving them
true as arguments, and a quotation that no longer quotes anything is what the
citation gate exists to catch. Flagged to L2 rather than treated as routine:
RFCT-232 is another task's record.

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
(`os/pkgs/mosd/apid/src/routes.rs:3111`) — so the first token cannot be minted
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
(`os/pkgs/mosd/apid/src/tests.rs:7038`). Sent raw it would split the segment
and the resulting 404 would read as "apid forgot the key".

### 2.3 What it leaves behind

What it found. The flag is flipped back, the key it adds is removed, and both
tokens it mints are revoked — the second by itself, which is also the last
check: a token that revoked itself is refused on its own next request. The one
thing not restored is `wg-e2e`'s private key, which a rotation replaces by
definition; 05b leaves the tunnel behind and no later phase reads its key.

## 3. Findings, not fixed here

- `test/apid-api/README.md`'s phase table did not list `05c-kernel-net` before
  this task and still does not. Only the row for the phase this task adds was
  written, because the table is not this task's to correct.
- The same file's *"two boots, ten phases"* and `src/runner.ts`'s identical
  sentence were already one short of the registry before this task, and are now
  two short. Left as found, for the same reason, and recorded here so the count
  is not read as this task's arithmetic.

## 4. Gates

`docs/verify-citations.sh` and `docs/verify-index.sh`, both on the merged tree.
The Rust gate is not this task's: no Rust changed here beyond the merge's own
`GET /api/v1/state` response-list union, which is a doc-comment attribute. The
`oasdiff` gate is not this task's either: `openapi.json` is untouched except by
the merge.
