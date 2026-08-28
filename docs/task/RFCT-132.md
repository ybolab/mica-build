# RFCT-132 Every unauthenticated request costs a D-Bus round trip against the one lock mosd holds over both trees

- **status**: completed
- **priority**: P2
- **owner**: bkd/0fibgdbm
- **createdAt**: 2026-08-26

The auth gate short-circuits on a valid session cookie before it talks to the
bus (`mosd/apid/src/routes.rs:697-702`), and the comment above it explains why:
a custom UI bundle serves dozens of static assets per page and none of them
need mosd. That covers the authenticated path.

The unauthenticated path is unchanged. A request with no cookie, or an invalid
one, reaches `state.api.get_settings("access")` at `:704` before the gate can
decide between setup mode and a login redirect. mosd serves that call under a
single mutex covering the settings tree and the live-state tree
(`mosd/mosd/src/bus.rs:49-53`), so unauthenticated traffic contends directly
with settings writes and reconciler updates. The listener is public by
construction — it is the recovery surface — and nothing rate-limits the gate
itself.

The fix wants the access subtree cached in apid with invalidation on
`SettingsChanged`, which the proxy cannot receive today
([[RFCT-133]]). Deciding it is a prerequisite, not a follow-on: caching
without an invalidation signal would serve a stale setup-mode decision, which
is a lockout.

## Resolution

**The cache** (`os/pkgs/mosd/apid/src/access_cache.rs`, wired into the gate:
`state.access_cache.get()` `os/pkgs/mosd/apid/src/routes.rs:3150-3164`): the unauthenticated path
serves `access` from memory while [[RFCT-133]]'s subscription is live, so
unauthenticated traffic stops contending with settings writes on mosd's
single mutex.

**The hard constraint — never a stale setup-mode decision — is held three
ways.** (1) The cache serves only while the signal subscription is provably
live; constructed unsynchronised, and any stream lapse or connect failure
drops it back to the per-request direct read the gate always did — the
fail-fresh fallback, costing latency, never staleness. (2) Fills are
generation-checked: the gate snapshots a generation before its direct read,
and a change signalled (or written locally) while the read was in flight
discards the fill. (3) apid's own `access.webAdmin` writers — the setup
wizard and both change-password surfaces via the shared helper — invalidate
the cache synchronously after the write, so the next unauthenticated
request re-reads without waiting for the signal's round trip.

**The M2a sequence the task names is tested exactly.**
`a_password_change_neither_reads_nor_leaves_a_stale_access_snapshot`: cache
primed by an unauthenticated request; `POST /api/v1/actions/change-password`
succeeds; asserted that the change flow verified against the bus (its
`access` read counter moved) and never the cache, that the cached snapshot
is gone before any signal could arrive, that the next unauthenticated
request refills with the post-change credential, and that the new password
logs in. `completing_setup_drops_the_cached_setup_mode_decision` covers the
other lockout-critical transition (setup mode ends and the gate must not
answer from the pre-write snapshot), and
`the_gate_serves_access_from_the_cache_only_while_subscribed` pins the read
counts across unsynchronised / subscribed / invalidated / lapsed. The
signal-driven half over a real bus is [[RFCT-133]]'s
`tests/settings_signal.rs`.

**Docs.** api.md §3.3's denial-of-service note narrowed a second time, and
§9 item 11 records the mitigation landing by the exact route its acceptance
note predicted.

**Commits.** `1951345` (gate wiring, handler invalidations, tests, docs),
`5502a4f` (citation re-anchoring).
