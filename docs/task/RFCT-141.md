# RFCT-141 The static-asset traversal guards have no over-the-wire coverage, because no device under test has a bundle

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-26

`test/apid-api/` talks to apid over the network on a booted image and covers
the transport, the setup and login flows, the cookie, the read-only surface and
a form post travelling all the way to a reconciler. It does not reach the
path-resolution guards.

`serve::respond` calls `asset_path::resolve` — the function holding the
dot-segment rejection, the residual-escape rejection, the NUL rejection, the
escaped-separator rejection and the canonicalised-root containment assertion —
only inside `if let Some(root) = active_root(..)`. Every device the suite runs
against has no bundle at `/srv/ui`, so `active_root` is `None` and not one line
of the guard set executes. The phase says so in its own header rather than
letting the result read as coverage
(`test/apid-api/src/phases/04-readonly.ts:168-186`).

The 404s the phase does observe come from the static-asset fallback's
`offers_html()` and `ends_in_a_route_segment()` conditions and from nowhere
else — the right statuses arrived at by a different route. A probe for
`/../../etc/passwd` passing there proves nothing about traversal.

Closing it needs a bundle seeded at `/srv/ui` on **DATA** before the phase
runs. The available seeding tool writes STATE only, so the work is a seeding
step, not a new assertion.
