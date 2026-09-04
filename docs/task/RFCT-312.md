# RFCT-312 A factory-fresh device must issue one administrator session, not one per concurrent claimant

- **status**: completed
- **priority**: P0
- **owner**: claim-race/bkd-m2oe5uj0
- **createdAt**: 2026-09-04 21:45

## Description

A release audit found that `POST /api/v1/setup` answered **201 to two
concurrent claimants** on a factory-fresh device, and that both issued sessions
read protected settings. The audit's test wrapped the backend in a barrier, so
the first question was whether the window it forced exists on the shipped path
at all.

**It does, and it is not a race that is hard to win.** The claim is a
check-then-act: the route reads `access` to decide the device is unclaimed and
writes `access` to claim it, and between the two sit the validators, an
argon2id hash and up to two more bus round trips. Nothing underneath closes it
— mosd's `persist_setting` takes the write lock, clones, sets and saves, so
each `SetSettings` is serialised but the READ before it is a separate call and
there is no compare-and-set anywhere on the path.

Closed by making the claim **one step**: a claim guard in `AppState`, taken
before the read and held past the write.

## ActiveForm

Closing the concurrent-claim window on `POST /api/v1/setup`.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The reproduction question answered by measurement against the real backend,
  either way, with the concurrency, the iteration count and the conditions
  stated.
- If real: the race closed; the auditor's test in the tree, red before and
  green after, plus assertions on the loser's outcome.
- `cargo test --locked -p mosd -p apid` green in `localhost/mos-build-rust:amd64`
  with `dbus-daemon` installed.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify` green.
- Any documentation whose statement changes, mirrored into `docs/zh/`.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## 1. Where the check-then-act is, and what makes it atomic today — nothing

`pkgs/mosd/apid/src/routes.rs`, `api_v1_setup`:

| Step | Call |
|---|---|
| **read** | `state.api.get_settings("access")`, then `if password_hash(&access).is_some() { 409 }` |
| between | the password-floor, hostname and `network` validators; `token::mint`; `spawn_blocking(auth::hash_password)` — argon2id, deliberately expensive; then the optional `hostname` and `network` writes, each its own bus call |
| **write** | `state.api.set_settings("access", …)` — the whole subtree, edited in place from the value read at the top |

The two are separate D-Bus calls with no token, generation or expected-value
carried between them. `SettingsApi` has exactly `get_settings` and
`set_settings`; there is no compare-and-set to use.

**The lower layer does not close it either.** `MosdService::set_settings` →
`persist_setting` takes `inner.write()`, clones the tree, applies the dot-path,
`store.save`s and swaps it in. That makes each write atomic and serialises
writes against each other, which is a different property: two claims that both
read an unclaimed tree both produce a valid whole-`access` write, and the store
faithfully applies both, last one winning. `Store::save`'s commit-by-rename is
what `docs/design/access.md` §4.4's *One commit point* rests on and it is
untouched by this — it bounds a power loss, not a concurrent reader.

The one claim gate that IS atomic by construction is the other channel's:
`provisioning_doc::import` checks `settings.access.web_admin.is_some()` and
writes through the same `&mut Settings` it checked, inside mosd, holding mosd's
own lock. That asymmetry was the defect — apid re-stated the same rule over a
read-modify-write it could not make atomic.

## 2. Reachability without the fabricated seam — measured, and reachable

Not argued from the code: driven end to end. A private `dbus-daemon --session`,
the **real** `mosd` binary on it (`MOSD_BUS=session`, `MOSD_DRY_RUN=1`, a fresh
`MOSD_SETTINGS_PATH` per iteration), the **real** `apid` binary against it over
real TLS, and real HTTP requests from `curl -Z --parallel-immediate` — one curl
process opening every transfer at once. **No barrier, no fake backend, no
instrumentation anywhere inside the handler.** Every iteration is a fresh
factory-fresh device: both daemons are restarted and the settings file removed.

The harness ran from repo-local scratch (`tmp/`, gitignored) in
`ai-agent/mos-m2oe5uj0-rust-dbus` — `localhost/mos-build-rust:amd64` plus
`dbus-daemon` and `curl`. Its core is short enough to record here rather than
leave as a path nobody can follow:

```bash
dbus-daemon --session --print-address=3 --fork 3>busaddr
export DBUS_SESSION_BUS_ADDRESS=$(cat busaddr)
for n in $(seq 1 "$ITER"); do
    rm -f "$RUN/settings.toml" "$RUN/apid.log"
    MOSD_BUS=session MOSD_DRY_RUN=1 MOSD_SETTINGS_PATH="$RUN/settings.toml" \
      MOSD_PROVISIONING_ROOT="$RUN/prov" MOSD_SHADOW_PATH="$RUN/shadow" mosd &
    until grep -q serving "$RUN/mosd.log"; do sleep 0.05; done
    APID_BUS=session APID_HTTPS_ADDR=127.0.0.1:8443 APID_HTTP_ADDR=127.0.0.1:8081 \
      APID_STATE_DIR="$RUN/apid" apid >"$RUN/apid.log" 2>&1 &
    until grep -q APID_LISTENING "$RUN/apid.log"; do sleep 0.05; done
    # every transfer opened at once, from ONE curl process
    curl -Z --parallel-immediate $args     # $args: -k -D hdr-N -w %{http_code} \
                                           #   -X POST .../api/v1/setup ... --next ...
    # count 201s; for each, replay its Set-Cookie against /api/v1/settings/hostname
    kill %2 %1; wait
done
```

`MOSD_DRY_RUN=1` skips first-boot provisioning and constructs no reconcilers,
so the daemons touch nothing on the host; `APID_STATE_DIR` is reused so apid
mints its TLS material once rather than per iteration.

**Before the fix:**

| Concurrency | Iterations | Iterations issuing >1 `201` | Sessions issued and tested | Sessions that read protected settings | `access.apiTokens` rows persisted |
|---|---|---|---|---|---|
| 2 | 200 | **200** | 400 | **400** | 1 |
| 8 | 100 | **100** | 800 | **800** | 1 |

Every attempt reproduced it. Eight concurrent claimants got eight
administrator sessions, all eight of which read protected settings, on a device
that persisted **one** API token — so seven callers were handed a bearer token
that authenticates nothing and were never told, and whichever password was
written last silently replaced the others.

This is a TOCTOU that is won essentially every time, not one that merely could
be lost: the window is an argon2id hash wide.

**After the fix, same harness, same conditions:**

| Concurrency | Iterations | Iterations issuing exactly one `201` | Losing responses | Distinct losing status codes | Losing responses setting a session cookie |
|---|---|---|---|---|---|
| 2 | 200 | **200** | 200 | `409` | **0** |
| 8 | 100 | **100** | 700 | `409` | **0** |

## 3. The fix, and why the atomicity is where it is

`AppState` gains `claim: Arc<tokio::sync::Mutex<()>>`, in the shape
`ui_selection` and `collecting` already use, and `api_v1_setup` takes it before
the `access` read and holds it past the `access` write.

**In apid, not in mosd or the store.** `docs/design/access.md` §4.4 names the
only two writers that can create a first `access.webAdmin`: this route and
mosd's provisioning-document importer. The importer runs at
`mosd/src/main.rs:246`, and mosd requests its bus name at `:395` — so the
importer has finished before any apid call can be answered at all, and apid is
the sole claimant for as long as the device can be asked. Within apid, the
three `set_settings("access", …)` writers are this route, the recovery
credential and the change-password rotation; the other two refuse a device with
no credential, so neither can create a first one.

Putting it in the store instead would have meant either a general
compare-and-set on `SetSettings` — a bus API change for one caller — or mosd
refusing to write `access.webAdmin` over an existing one, which is exactly what
the rotation and the recovery credential legitimately do.

**Held across the hash and the writes rather than released after the check.**
The hash is the widest part of the window; a guard that ended at the check
would only narrow it. The consequence is the intended one: the loser waits for
the whole of the winner's claim, re-reads a claimed tree, and takes the
existing `409 already_configured` having written nothing — the same posture the
validators already keep.

## 4. The test

`a_factory_fresh_device_issues_one_administrator_session_to_concurrent_claimants`
in `pkgs/mosd/apid/src/tests/claim.rs`, carrying the auditor's property
sentence verbatim.

**Red before, green after** — the same test, in the same tree, run against the
handler with and without the guard:

```
running 1 test
thread '…a_factory_fresh_device_issues_one_administrator_session_to_concurrent_claimants'
panicked at apid/src/tests/claim.rs:737:5:
assertion `left == right` failed: A factory-fresh device must not issue two
administrator sessions to concurrent claimants; the two claims answered [201, 201]
  left: 2
 right: 1
test result: FAILED. 0 passed; 1 failed
```

**The seam moved from the auditor's wrapper onto the fake.** The auditor's
`ClaimRace` was a second full delegating `SettingsApi` beside the file's
existing `InterruptOnce` — 94 lines, almost all pure delegation — and, being
a wrapper, it displaced `FakeSettings` as the backend the test holds, so
`access_of(&fake)` and `fake.set_paths()` could no longer be used. The
behaviour is now a hook on the fake itself, `FakeSettings::hold_access_reads`,
in the shape `set_diagnostic_delay` and `refuse_updates` already have. The test
keeps `test_app`'s `(router, fake)` pair and every assertion helper in the file
works on it unchanged.

**The barrier is bounded, and the bound is load-bearing.** A barrier that
forces two reads to interleave DEADLOCKS against the fix: once the claim is one
step the second read cannot happen until the first request has finished, so the
first read waits for a party that can never arrive. The hold is therefore a
`tokio::time::timeout` around the rendezvous, and it disarms itself when it
expires — reaching the bound is the property holding, not a hung test. The
comment at the site says the rendezvous widens a window and does not create
one, and points at the shipped-path measurement in §2 as the evidence that the
window is real.

**The loser's outcome, which the auditor's test did not assert.** A count of
201s does not say what happened to the claimant that lost. Added:

- the losing response is `409`, not a 500 and not a silent 201;
- it carries `already_configured` at `access.webAdmin` — an answer an operator
  can act on, naming the route that changes a password;
- it sets **no session cookie**, so no losing session exists to test;
- the device wrote `access` exactly **once** and holds exactly **one** API
  token;
- the winner's session reads protected settings, and the winner's password
  authenticates a fresh login while **the loser's password does not** — the
  assertion a last-write-wins claim fails even if it handed out a single
  cookie. The winning login runs first because a failed one arms
  `docs/design/access.md` §3.3's backoff.

## 5. What the finding does to the two documents named, and to a third

**`docs/design/access.md` §4.4 — CHANGED, in this commit.** Its *Claiming
twice* subsection asserted the refusal without qualification: "`POST
/api/v1/setup` on a claimed device answers 409 `already_configured` and writes
nothing." That was true of a sequential second claim and false of a concurrent
one, which is the only place the promise could be broken. A paragraph now
states the concurrent case, what it measured before the fix, and what makes it
hold — and records that the guard is in apid because apid is the only claimant
while the device is reachable, which is the same two-writer premise the section
already rests on.

**`docs/design/provisioning.md` §4.1.4 — UNCHANGED, and it should be.** The
already-claimed rule governs the document importer, whose check and write are
one `&mut Settings` inside mosd under mosd's own lock, before mosd requests its
bus name. It was atomic by construction throughout, and the race never touched
it. Its §4.1.3 atomicity argument is about a power loss and is likewise intact.

**`docs/plan/PLAN-072` §7a — UNCHANGED, and the reasoning survives on its own
terms.** §7a accepts trust-on-first-use because a stolen `deviceId` buys "a
wrong inventory record on the plane and a real device that cannot register, not
control of a device". That premise is that `deviceId` is not a credential the
DEVICE accepts — and it is not, before or after this fix. The claim race was a
different attack with a different entry point: it needed the attacker to reach
the device's own HTTPS API during the seconds a factory-fresh device is being
claimed, which is the local-network position §7a never claimed to defend
against and which no `deviceId` grants. So this is not an amendment to §7a; it
is a second, unrelated way to get device control, now closed. **§7a's two
required mitigations are untouched and remain unbuilt.**

**`docs/user/first-run.md` §4 — UNCHANGED, deliberately.** Its sentence is "a
second setup call **on a claimed device** is refused with `already_configured`
and writes nothing". That is scoped to a device that is already claimed, and it
was true before this work and is true after it; the race was two claims against
a device that was still UNCLAIMED when both were admitted. Nothing there
asserted a property the code failed to keep, so nothing there changes.

**`docs/zh/` — nothing to mirror.** The only changed document is
`docs/design/access.md`. `docs/zh/design/access.md` is a condensed rendering
that covers §§0–6 and 9–10 and does not carry §4.4's claim model at all, so
there is no Chinese statement of the changed claim to bring into line; adding
one would be translating a section the mirror deliberately omits. `design/` is
also outside the coverage gate's trees — `docs/zh/verify-coverage.sh` governs
`docs/{user,website,bsp}/` — so no row moves either.

## 6. What was NOT changed, and why

- **`SettingsApi` gained no compare-and-set**, and mosd gained no `ClaimDevice`
  bus method. Either would be a bus-surface change for one caller, and §3's
  reading says the caller is the right place while apid is the only claimant.
  If a third claimant ever arrives inside mosd, the guard moves there — that is
  the same condition `docs/design/access.md` §4.4's two-writer reading already
  depends on, so it fails in one place rather than two.
- **The browser wizard's write order** is untouched. The comment above
  `api_v1_setup` notes it writes in a different order and that closing that gap
  needs a transactional multi-path write on the bus; that is a separate
  finding, and the wizard reaches the claim through this very route, so it is
  covered by this guard.
- **The 409 body, its code and its `at` path** are unchanged. The loser gets
  the refusal the route already had; nothing new was invented for it, and the
  test asserts the existing one rather than a new one.
- **`access.claim` and the schema** are unchanged. Nothing about the record
  needed to move — the defect was that it could be written twice, not that it
  said the wrong thing.
- **A stale reference was left alone.** The comment above the validators in
  `api_v1_setup` cites a test named
  `the_api_setup_route_validates_before_writing_where_the_form_path_does_not`,
  which no longer exists — the HTML form claim surface it compared against is
  gone, and `POST /api/v1/setup` is now the only claim route in apid. That is
  reported rather than deleted: it is pre-existing and unrelated to this
  defect, and it is load-bearing for the *scope* of this fix, since a second
  claim surface would have needed the guard too.
- **The image gate was not run.** No `_out` tree here and nothing in this change
  reaches an assembled image: it is three source files in `apid` plus one design
  document, with no packaging, unit, overlay or verify-contract surface touched.

## 7. Gate results — 2026-09-04, on this branch after `main` was merged

| Gate | Result |
|---|---|
| `cargo test --locked -p mosd -p apid` | **green**, 824 tests — apid 319 + 1 e2e (318 + this task's one), mosd 496 + 1 bus + 7 scan |
| `cargo clippy --locked -p apid --all-targets -- -D warnings` | **NOT RUN — reported, not worked around**: `localhost/mos-build-rust:amd64` ships cargo, rustc and std only, and has no `clippy` component to add offline (`error: no such command: clippy`). `cargo test --locked` is the merge floor this environment can hold; `pkgs/mosd/hack/check.sh` runs clippy where the component exists |
| `(cd verify && bun test)` | **green**, 1268 tests across 39 files |
| `(cd build && bun test)` | **green** — see below |
| `make docs-verify` | **green**, 183 + 449 + 734 + 231 + 43 |
| Shipped-path reproduction, before the fix | **red in both configurations**: 200/200 at concurrency 2, 100/100 at concurrency 8 |
| Shipped-path reproduction, after the fix | **green**: exactly one 201 in 300 iterations, all 900 losers `409`, none with a cookie |
| The new unit test against the unguarded handler | **red**, with the auditor's sentence |

The Rust gate ran in `ai-agent/mos-m2oe5uj0-rust-dbus` — `localhost/mos-build-rust:amd64`
with `dbus-daemon` added — so `tests::power_bus` and `tests::settings_signal`
stood up real private session buses instead of refusing to skip.

The apid UI bundle `apid/build.rs` embeds was not rebuilt: `pkgs/mosd/apid/ui`
is byte-identical to `main`'s on this branch, so `_out/apid-ui/dist` was copied
from the main checkout rather than re-run through the pinned bun image. Nothing
in this change touches the UI.
