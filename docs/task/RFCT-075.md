# RFCT-075 The built-in UI at a reserved prefix, and the escape

- **status**: completed — the built-in UI is reachable unconditionally at `/builtin/`, the whole subtree is reserved structurally, the pane carries a control that performs §5.3's deactivate, and the shadowing guard is fired in both directions as a standing test
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-20 17:20
- **claimedAt**: 2026-08-20 17:20
- **completedAt**: 2026-08-20 19:40

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2.
Branch `bkd/duquqrux`. Base `0f4990f`, the campaign head carrying RFCT-071,
RFCT-072, RFCT-073, RFCT-074 and RFCT-080.

```
$ git rev-parse HEAD
0f4990fd7e21a5be7ac70bb01d438d1ff6ea7f9a
$ git merge-base --is-ancestor 0f4990f HEAD && echo BASE-OK
BASE-OK
$ test -f mosd/apid/src/assets/serve.rs && test -f mosd/apid/src/bundle.rs && echo DEPS-OK
DEPS-OK
```

RFCT-074's router was present and is what this task extends: `mosd/apid/src/routes.rs`
declared `/` as `get(serve::root)` with the comment *"§6.3's reserved prefix …
is separate work and does not exist yet"*, and `assets/serve.rs` carried the
matching *"§6.3's reserved prefix … does not exist yet and is not created
here"*. This task's guard inverts dispatch order, and dispatch order is
RFCT-074's; without it the guard could not have fired at all.

## Description

§6 opens with the requirement the whole phase exists to satisfy: *"A device
whose custom UI is broken, half-uploaded or incompatible must remain
manageable, and the path back must not depend on why it broke."*

§6.3 chooses **(A) and (B) together, and neither alone**. (A) is a reserved
path the asset router can never shadow — the way *in*, which *"deactivates
nothing, so the next navigation to `/` is broken again."* (B) is removing
`/srv/ui/current` — the way *out*, which *"presupposes the access that may be
broken."* Concretely: **the built-in UI at the reserved prefix carries a control
that performs (B).**

What this task makes true, in one sentence: **one documented action —
`https://<device>/builtin/` — reaches a working interface whatever went wrong,
and one click there deactivates the bundle**, so the operator never has to
diagnose anything.

## The prefix: `/builtin/`

§6.3 calls it `/builtin/` illustratively and leaves the spelling open. **Fixed
as `/builtin/`**, unchanged from the design document, so the documented action
needs no translation and the operator types what the document writes. Both
spellings answer — `/builtin` and `/builtin/` — because an operator recovering
a device should not have to get a trailing slash right; F1 records why those two
are declared on opposite sides of the `nest` boundary.

It costs the prefix permanently, which §6.3 names as (A)'s price and accepts:
no bundle can serve anything at or under `/builtin/` ever again.

## Deliverable

| file | what |
| --- | --- |
| `mosd/apid/src/routes.rs` | the reserved subtree declared, `builtin_home` (the status pane plus the escape control), `builtin_deactivate` (§5.3's operation), `builtin_not_found`; `home` split into `status_body` + `home` so `/` renders exactly what it rendered before; the prefix named on `/login` and in the pane navigation |
| `mosd/apid/src/tests.rs` | seven tests: the shadowing pair, the property test with its control, deactivate, POST-only, and two named-set assertions |
| `docs/task/RFCT-075.md`, `docs/task/index.md` | this record and its row |

Nothing else was touched. `mosd/apid/src/bundle.rs`, `assets/path.rs`,
`assets/mime.rs` and `assets/serve.rs` are consumed exactly as merged;
`main.rs` is **unchanged** — no `mod` line was needed because the escape is two
handlers in the file that already holds every built-in page, and staying out of
`main.rs` entirely keeps this task clear of RFCT-076's concurrent startup work.
`os/**`, `Makefile`, `docs/design/**`, `docs/README.md`, `Cargo.toml` and
`Cargo.lock` are unchanged, and no dependency was added.

## §6.2: the built-in UI stays compiled into the binary

Nothing here creates a file. No `include_str!`, no `include_bytes!`, no
`assets/`, `static/` or `public/` directory, and no non-Rust file added to the
crate. The escape pane, the acknowledgement page and the subtree's 404 are
`maud` `html!` expansions over the same one `&str` stylesheet constant every
other page uses.

Re-measured on this tree rather than assumed:

```
$ grep -rn "include_str!\|include_bytes!" mosd/
(none)
$ find mosd/apid -type f ! -name '*.rs'
mosd/apid/Cargo.toml
```

This is not tidiness. §6.2 names dm-verity as the **only** load-bearing
protection on the artifact: `/` is a squashfs with no fstab entry that could
remount it, so a write to `/usr/bin/apid` fails at the block layer *even though
apid runs as root*, and `apid.service`'s `[Service]` section is four directives
— `Type=`, `ExecStart=`, `Restart=`, `StateDirectory=` — with no
`ProtectSystem=`, no `ReadWritePaths=` and no `User=`. Re-read on this tree and
it is still four. Turning the built-in UI into files on disk would move it out
from behind the one protection it has.

## §6.3's precedence is the router's declaration order, again

```rust
Router::new()
    .route("/", get(serve::root))              // §4.1 rule 3's exception, unchanged
    .nest(
        BUILTIN,                               // "/builtin" — the WHOLE subtree
        Router::new()
            .route("/", get(builtin_home))     // matches `/builtin`
            .route(BUILTIN_DEACTIVATE_LEAF, post(builtin_deactivate))
            .fallback(builtin_not_found),      // `/builtin/index.html`, `/builtin/assets/app.js`, …
    )
    .route(BUILTIN_PATH, get(builtin_home))    // "/builtin/", which the nest does not claim — F1
    .route("/setup", ...)                      // …the rest of §4.1 rule 3, unchanged
    .nest("/api", Router::new().fallback(api_not_found))
    .route("/api/", any(api_not_found))
    .fallback(serve::fallback)                 // §4.1 rule 4
```

The whole subtree is reserved, not just the two pane paths. **A prefix reserved
for only some of its paths is not reserved**: a bundle really can ship
`builtin/index.html` and `builtin/assets/app.js`, and if the fallback answered
those the operator following the one documented action would be looking at
files the broken bundle chose.

No handler checks for this prefix. `assets/serve.rs` is untouched and knows
nothing about it; the escape is unshadowable because axum matches declared
routes before it consults a fallback and for no other reason — §4.1's *"a rule
enforced by the dispatch mechanism is worth more than a rule enforced by a check
somebody can forget to write."*

**`/` is unchanged.** §6.3 asks for exactly one *unconditional* path to the
built-in UI, not two. `/` stays conditional — the active bundle's index when one
is active and readable, the built-in UI otherwise — and `home` renders exactly
the markup it rendered before: the split into `status_body` + `home` moved
nothing, and the escape control is added by `builtin_home` only.

## The escape control

`POST /builtin/deactivate` calls `Store::deactivate()` and reimplements nothing.
§5.3 already says of it: *"the same operation as §6.3's escape, which is why it
is specified here rather than invented there."*

- **POST only**, matching every other state change in this crate. There is no
  GET handler, so a prefetch, a crawler or a mis-clicked link cannot deactivate
  a working custom UI — asserted, including that the store still reports
  generation 1 active afterwards.
- **No confirmation checkbox**, unlike the power actions, and the difference is
  deliberate. A power action interrupts every service and needs a hand at the
  appliance to undo; deactivation removes one symlink, leaves the bundle's files
  on disk, and is undone by activating again. §6.3 asks for *"one click from
  there"*, and a recovery path is the wrong place to add a step the operator can
  fail.
- **Both outcomes are the same success.** `Store::deactivate` returns whether a
  pointer was there to remove; a second click says *"No custom UI was active.
  Nothing changed."* and is still 200. §6.3 requires an outcome that does not
  depend on what was wrong, and "nothing was active" is not an error.
- **The pane states what it will do and what happens next**: that it removes
  `/srv/ui/current`, that `/` then serves the built-in interface, that this
  survives a reboot, and that the bundle's files stay on disk.

## §6.3's property, asserted directly rather than by class

§6.3's argument is that *"the built-in handlers do not read `/srv/ui` at all, so
no bundle state — absent, corrupt, unreadable, wrong version — can affect
them."* `the_escape_answers_identically_whatever_the_bundle_store_holds`
asserts that property itself. The exhaustive five-class behavioural suite is
RFCT-078's and is not duplicated here.

Six bundle-store states, named by identity:

| state | what it is |
| --- | --- |
| no store directory at all | the shipped state of every device |
| store root unreachable: its parent is a regular file | `ENOTDIR` on the first syscall |
| a healthy bundle active | the control's positive case |
| active bundle whose index is a symlink, not a regular file | mutated outside the install path |
| active bundle whose manifest was corrupted after install | see F5 |
| `current` repointed outside the store | an operator with a root shell |

The escape's rendered page is **byte-identical** across all six. One line is
elided before comparison — `<p>Uptime: …</p>`, the only wall-clock-dependent
markup on the pane — and the elision is asserted to have fired, so it cannot
quietly mask a pane that failed to render at all.

**The control that makes that meaningful** is the second half: `/` reads the
store, so it must *not* be identical across the same six states. The states that
reach the bundle at `/` are asserted by identity, and the assertion carries its
own reason — *"if this set were empty the states above would be
indistinguishable and the equality assertion would prove nothing."*

## The shadowing guard, both directions

Built on RFCT-074's shape: `a_bundle_cannot_shadow_the_reserved_api_subtree`,
`without_the_reservation_the_bundle_does_shadow_the_api` and the
`asset_router_without_the_api_reservation` helper.

1. A bundle is installed **through `Store::activate`** containing real files at
   `builtin/index.html` and `builtin/assets/app.js`, and the test **lists the
   installed tree** (`installed_files`) and asserts both are in it.
2. The same router serves `/decoy.txt` from that bundle with 200 and the file's
   bytes, so nothing below can be explained by the bundle not being served.
3. `/builtin` and `/builtin/` answer 200 from the binary's own copy;
   `/builtin/index.html` and `/builtin/assets/app.js` answer the subtree's own
   404. For each, the assertion that neither the bundle's marker bytes **nor its
   index** appear is made **first**, on the body rather than the status.
4. `without_the_reservation_the_bundle_does_shadow_the_builtin_prefix` runs the
   same bundle through the same asset handler with the reservation removed and
   asserts the bundle's bytes **do** come back — kept as a standing test.

**Both observations, run.** Green:

```
$ cargo nextest run -p apid -E 'test(escape) or test(builtin) or test(built_in)'
        PASS [   0.057s] (1/9) apid::bin/apid bundle::tests::absent_root_reads_as_the_built_in_ui
        PASS [   0.706s] (2/9) apid::bin/apid tests::without_the_reservation_the_bundle_does_shadow_the_builtin_prefix
        PASS [   1.301s] (3/9) apid::bin/apid tests::a_bundle_cannot_shadow_the_reserved_builtin_prefix
        PASS [   1.305s] (4/9) apid::bin/apid tests::the_escape_control_deactivates_the_custom_ui_and_the_root_reverts
        PASS [   1.323s] (5/9) apid::bin/apid tests::get_on_the_escape_control_is_not_routed_and_leaves_the_bundle_active
        PASS [   1.325s] (6/9) apid::bin/apid tests::the_built_in_panes_reachable_beside_an_active_bundle_are_named
        PASS [   1.342s] (7/9) apid::bin/apid tests::the_escape_path_is_named_on_the_surfaces_that_lead_to_it
        PASS [   2.344s] (8/9) apid::bin/apid tests::without_a_readable_index_the_fallback_is_the_built_in_ui
        PASS [   6.718s] (9/9) apid::bin/apid tests::the_escape_answers_identically_whatever_the_bundle_store_holds
     Summary [   6.719s] 9 tests run: 9 passed, 102 skipped
```

Guard fired — the `.nest(BUILTIN, …)` and `.route(BUILTIN_PATH, …)`
declarations deleted from `routes.rs`, which is what puts the asset service in
front of the prefix:

```
$ cargo nextest run -p apid -E 'test(a_bundle_cannot_shadow_the_reserved_builtin_prefix)'
        FAIL [   1.151s] (1/1) apid::bin/apid tests::a_bundle_cannot_shadow_the_reserved_builtin_prefix
thread 'tests::a_bundle_cannot_shadow_the_reserved_builtin_prefix' panicked at apid/src/tests.rs:1955:9:
/builtin: the reserved prefix answered with the bundle's index: <!doctype html><title>custom</title>
```

The failure prints the bundle's own bytes, not a bare status mismatch, and the
path it prints is the escape's own URL — an operator following the one
documented action would have landed on the broken UI. `routes.rs` was restored
immediately and re-run green; the deletion exists only in this record.

## Named sets, asserted by identity

**Built-in panes reachable beside an active bundle that ships a file at every
one of their names.** Expected `/builtin/`, `/hostname`, `/network`, `/power`,
`/ssh`; probed that set plus `/`, `/builtin/index.html` and `/decoy.txt`, which
must *not* answer from the binary, so an over-wide reservation appears as an
unexpected member. Diffed both ways and failing names missing and unexpected.
`/builtin/` is the Status pane, moved there by §6.3; the other four were already
declared routes and so were already unshadowable — §6.3 asks for exactly one
*unconditional* path and this is the set that produces.

**Surfaces that name the escape** (see F2): `/login`, the navigation on
`/network`, and the reserved subtree's own 404 at `/builtin/index.html`. Failing
names which surface went silent. The assertion is on the **link**
(`href="/builtin/"`) and deliberately not on the bare path: the subtree's 404
echoes the path that was asked for, so a `contains("/builtin/")` there would be
satisfied by the request rather than by the page naming the way back.

## Findings — reported, not designed around

**F1. `nest` claims the bare prefix and not the trailing-slash one, which is the
mirror image of RFCT-074's F1 and reverses which spelling needs the extra
declaration.** RFCT-074 measured `nest("/api", r)` — a nested router carrying
only a fallback — claiming `/api`, `/api/x` and `/api/x/y` but **not** `/api/`,
and closed the gap with an explicit `.route("/api/", …)`. Writing the analogous
pair here as `.route(BUILTIN, get(builtin_home))` *plus* `.nest(BUILTIN, …)`
does not merely fail to help; it panics at router construction:

```
thread '…' panicked at apid/src/routes.rs:111:10:
Overlapping method route. Handler for `GET /builtin` already exists
```

So the nest owns the bare path, `/builtin` must be served by a `"/"` route
*inside* the nest, and `/builtin/` is the spelling that needs declaring outside
it. Both were measured to answer 200 from the binary with a bundle installed at
`builtin/index.html`. This is the same axum behaviour RFCT-074 documented, seen
from the other side; §4.1's claim that rule 1 *"is the shape axum's router
already has"* is no truer for `/builtin/` than it was for `/api/`.

**F2. §6.3's named discoverability mitigation is the one surface that cannot
work.** §6.3 closes (A)'s cost — *"(A) only helps an operator who knows the
URL"* — by observing that *"the built-in error pages already exist
(`mosd/webd/src/routes.rs:106-116`) and can name the path."* Those lines are
`bus_error`, the crate's **only** error page, and it is reached only when a mosd
call fails. But `gate` calls `state.api.get_settings("access")` on every path
except `/healthz` *before* dispatch, and returns `bus_error` when that fails —
so at the moment the 502 page is on screen, `/builtin/` is answering 502 for the
same reason. Naming the prefix there would advertise a path that is down.

Not designed around, and not silently skipped: the prefix is named on the three
built-in surfaces an operator with a broken custom UI actually reaches — the
sign-in page (the gate bounces every unauthenticated request there, whatever the
bundle is doing), the navigation on every built-in pane (for an operator already
signed in), and the reserved subtree's own 404. `bus_error` was left alone.

**F3. Every §6.2 and §6.3 source citation is to `webd`, and the crate is now
`apid`.** `mosd/webd/src/routes.rs`, `mosd/webd/src/main.rs`,
`mosd/webd/src/config.rs`, `mosd/dist/webd.service`, `WEBD_LISTENING` and
`WEBD_STATE_DIR` do not exist on this tree. The **substance** re-measured and
holds in every case, so this is a rename that documentation reconciliation must
sweep, not a claim that failed:

| §6.2 / §6.3 claim | re-measured |
| --- | --- |
| built-in UI is `maud` `html!` with one inline `&str` stylesheet, *"no external assets"* | holds, `mosd/apid/src/routes.rs` |
| no `include_str!`/`include_bytes!` anywhere | holds, none in `mosd/` |
| no non-Rust file in the crate but its manifest | holds, `mosd/apid/Cargo.toml` only |
| the unit's `[Service]` is four directives, no `ProtectSystem=`, no `User=` | holds, `mosd/dist/apid.service` |
| `os/rootfs/build-v2.sh:75-76` stages the binary and unit | holds, at those exact lines, `apid` for `webd` |
| `os/rootfs/Dockerfile.v2:294-295`, `:297-299` install and assert the enable symlink | holds, at those exact lines, `apid` for `webd` |
| the built-in error pages exist at `routes.rs:106-116` | the *page* exists (`bus_error`); the line numbers have moved and see F2 |

`docs/design/api.md` was not edited; a later L3 owns documentation
reconciliation.

**F4. A corrupted `mos-ui.json` does not stop the bundle being served, and that
is correct.** Found by the property test's control half naming it: the expected
set of states reaching the bundle at `/` was written as the healthy state alone,
and the diff reported *"unexpected: active bundle whose manifest was corrupted
after install."* The expectation was wrong, not the code — §4.3's immutable
cache class is opt-in and RFCT-074's F5 reads the manifest best-effort from the
served tree, so an unparseable manifest costs the bundle that one cache class
and nothing else. Recorded because "the manifest is corrupt" reads like §6.1
class 3 and is not: class 3 is the recorded **digest** mismatching, checked at
activation and start-up, and neither is the manifest parsing at request time.

**F5. The escape is behind the auth gate, so §6.3's "one documented action" is
two for a logged-out operator.** RFCT-074's F8 kept `.layer(gate)` over
everything, and §6.3 states no authentication posture for the prefix, so the
posture was not narrowed here: `/builtin/` requires a session like every other
pane. For an operator who is already signed in, §6.3's claim holds exactly. For
one who is not, the action is *sign in, then go to `/builtin/`* — and `/login`
is itself a declared route that no bundle can shadow, and now names the escape.
Worth stating because §6.3's test is about the operator not having to *diagnose*
anything, which still holds, and not about the number of clicks.

**F6. `/api/` and `/builtin/` are both reserved subtrees with deliberately
different not-found shapes.** `/api/` answers §2.4's JSON envelope with
`Content-Type: application/json`; `/builtin/` answers a built-in HTML 404 that
names the escape. Not a contradiction — one subtree is a programmatic API and
the other is the interface an operator is staring at — but the two are described
by the same §4.1 rule and the difference should be a decision on the record
rather than an accident.

## Cross-site posture, unchanged

`POST /builtin/deactivate` inherits exactly the posture the crate's other state
changes have: the session cookie is `Secure; HttpOnly; SameSite=Lax; Path=/`
(asserted by `session_cookie_value` in the test helpers), so a cross-site form
POST carries no cookie and is bounced to `/login` by the gate. No new hole and
no new mechanism; RFCT-069 owns the CSRF question for the crate as a whole.

## Checks run

Every count predicted before running, per term.

| command | predicted | observed |
| --- | --- | --- |
| `bash mosd/hack/check.sh` | 361 + 7 new tests = **368** | `368 tests run: 368 passed, 0 skipped`; `ALL CHECKS PASSED` |
| `bash docs/verify-index.sh` | 249 + 3 (forward, reverse, once-each for `RFCT-075.md`) = **252** | `252/252 PASS` |
| `bash docs/verify-index-test.sh` | **8/8**, unchanged — no case added | `RESULT: PASS (8/8 cases)` |
| `make os-image-cx3576-v2` | assembles | image assembled |
| `make os-verify-cx3576-v2` | **323/323**, unchanged — this task adds no verifier assertion | `RESULT: PASS (323/323 checks)` |

The image verifier's number is a control on scope, not a description: this task
adds nothing to `os/`, so a change in it would have said the fence was crossed
before the diff did.

`BOARD_DIR=/srv/ai/mos/board/cx3576` — the main checkout's prebuilt BSP
artifacts, because a BKD worktree has none. That shortcut is valid **only**
because this task changes nothing under `board/`, and it changes nothing under
`board/`. The image pair is not skippable: this task compiles into `apid`, and
`/usr/bin/apid` is packed into the verity squashfs, so an aarch64 cross-build
failure is exactly what the host-side checks cannot see.

## Deliberately out of scope

- **§6.1's start-up discovery and the compatibility re-check** — RFCT-076,
  running concurrently. `main.rs` is untouched, and no `mod` line was added to
  it.
- **The served-set constant and `GET /api/versions`** — RFCT-076 and phase 2.
  `/api/` still 404s everything and this task changed nothing about it.
- **The exhaustive five-broken-classes behavioural suite** — RFCT-078. The
  property test here asserts §6.3's own argument (the handlers never read
  `/srv/ui`) rather than enumerating classes.
- **The image assertion that the prefix is absent from the writable root** —
  RFCT-077.
- **Any upload or activate-over-the-network path** — phase 5. Nothing here
  installs or activates; the only bundle operation reached is `deactivate`.
- **`docs/design/api.md`** — F2, F3 and F6 are recorded here, not patched
  there.

## What is NOT claimed — hardware

**This work was not exercised on hardware.** Both overstatements are wrong and
both are avoided:

- Hardware **has** booted. A **v1** image reached the `mos login:` prompt on a
  real CX3576-Z, and the repart/maskrom and SPL-hash investigations ran against
  a real board. "Never booted" would be false.
- What has **never been exercised on hardware** is the **v2** stack — verity
  root, A/B, `rauc install`, and apid itself. "Verified on device" would be
  equally false.

§6.3 says so in its own words: *"No hardware claim is made anywhere in this
section."* What this task did: ran the router in-process against bundle stores
in temporary directories, and cross-built `apid` into a v2 image checked on the
host. **A packed image verified on a host is not a booted device.** No assertion
here observes `/builtin/` fetched over TLS from a device, `/srv/ui/current`
removed on a mounted DATA partition, or the deactivation surviving a real
reboot.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
