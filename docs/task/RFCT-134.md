# RFCT-134 The admin password can be set exactly once and no operation anywhere changes it

- **status**: completed
- **priority**: P1
- **owner**: bkd/xexc9k2h
- **createdAt**: 2026-08-26

`access.webAdmin.password_hash` is written by one line in the whole tree:

```rust
let value = serde_json::json!({ "password_hash": hash });
```

at `mosd/apid/src/routes.rs:1024-1025`, inside `setup_submit`. Every other
reference reads it (`:645`, `:708`, `:917`, `:963`, `:1129`). The setup
handlers refuse to run once a hash exists (`:917`, `:963`), so the one writer
is unreachable after first boot.

The consequence is that an operator who believes the admin password is
compromised has no way to rotate it. There is no HTML pane and no API route;
the only paths back are a factory reset, which loses the settings tree and
every home directory, or the transient SSH root password followed by a
hand-edit of a file the settings tree owns. For a credential that is the sole
authentication on the device's management surface, "cannot be changed" is a
security property, not a missing feature.

Whoever adds it owns two decisions the tree does not answer: whether the
change requires the current password (it should), and whether it invalidates
existing sessions (`mosd/apid/src/session.rs:32` holds them in a map keyed by
cookie, so clearing it is one call).

## Resolution

Password change shipped end to end, on both surfaces, additive only.

**Decided semantics, recorded as decided (not re-decided):** the request
carries the CURRENT password and it is verified before the new hash is
written via the settings tree (`SetSettings("access.webAdmin", ...)`, the
same write shape as `setup_submit`); success invalidates ALL sessions
EXCEPT the one performing the change (`pub fn remove_all_except`
`os/pkgs/mosd/apid/src/session.rs:96` — a `retain` on the session map that
task text pointed at). Both outcomes are audited (`password` /
`wrong-password` or `changed`); the password itself is never logged.

**Surfaces.**

- HTML: `GET`/`POST /password`, an authenticated pane behind the gate,
  linked from the nav bar. Wrong current password answers 401 with the pane
  re-rendered; mismatch and the sub-8-character floor answer 400, mirroring
  the setup wizard.
- API: `POST /api/v1/actions/change-password` under §2.3's `actions`
  namespace, body `{"currentPassword", "newPassword"}` → 204. Failures are
  §2.4's envelope: `wrong_password` 403, `validation_failed` 422,
  `request_invalid` 400 (a custom `JsonRejection` mapping, not axum's
  plain-text answer), and the shared classifier for failed mosd calls
  (`mosd_unreachable` 503 + `Retry-After` included). The route is added to
  `is_declared_api_route` so unauthenticated callers get the 401 envelope,
  never the gate's redirect.

Both handlers call one helper (`change_password`
`os/pkgs/mosd/apid/src/routes.rs:3153-3207`), so the two surfaces cannot
diverge in semantics.

**RED-GREEN.** Tests were written first and observed red (404 on both
routes, 8 failing): wrong-current-password, success, other-session
invalidated, acting session survives — plus mismatch, short-password,
unauthenticated-in-both-gate-modes and malformed-body envelope cases, and a
`SessionStore::remove_all_except` unit test. All green after the
implementation. `/password` joined `ALL_MUTATIONS`, so the
unauthenticated-rejection sweep and the source-reading coverage test hold
it down.

**Additive.** `openapi.json` regenerated from the handlers (the committed
copy is test-asserted); the diff is 102 insertions, 0 deletions — a new
path object and a new `ChangePasswordRequest` schema, no existing shape
changed. No repo oasdiff runner exists and no oasdiff binary is available
on this host; additivity was verified by the diff shape instead.

**Commits.** `a2aaf84` (implementation, red-green), `11c0d8d`
(`validation_failed` instead of an invented near-duplicate code),
`a4c092f` (api.md §2.3 bullet rewritten from "the API does not invent one"
to documenting the shipped pair; §2.4 gains the `wrong_password` row;
citation renumbering for the shifted lines).
