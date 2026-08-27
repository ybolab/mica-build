# RFCT-132 Every unauthenticated request costs a D-Bus round trip against the one lock mosd holds over both trees

- **status**: in progress
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
