# RFCT-118 PLAN-016 M2: the read-only settings and state roots, redacted, under one error envelope

- **status**: completed
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-26 15:20
- **claimedAt**: 2026-08-26 15:20
- **completedAt**: 2026-08-26 16:40
- **plan**: PLAN-016 (M2)

Serve `docs/design/api.md` §2.2's two read-only roots over the `/api` prefix
M1 opened, redact every secret they can carry, and answer every failure with
§2.4's envelope classified from what mosd actually said rather than flattened
into one status.

## Scope

- `GET /api/v1/settings/{*path}` and `GET /api/v1/state/{*path}`, mapped onto
  the existing `SettingsApi::get_settings` / `get_state`. No trait method was
  added and `mosd/mosd/**` was not touched.
- A structural redactor (`mosd/apid/src/redact.rs`) on both roots.
- §2.4's classification, `Retry-After` on the one class that carries it, and an
  optional `path` member on the envelope.
- `mosd/apid/openapi.json` regenerated with both families and all five of
  their outcomes.

`GET` only. Writes, actions and the two collection resources are PLAN-016
Decisions item 2's deferral, not an omission.

## The state root is redacted too, and why

§2.2 states the redaction rule for the settings root only, because that is
where it derived the exposure from: `GetSettings("access")` returns
`access.webAdmin.password_hash` verbatim. The rule is applied to the live-state
root as well.

The live-state tree is an untyped `serde_json::Value` written from inside mosd
by its reconcilers. Nothing in its type stops a reconciler publishing a field
named `psk` — the WiFi ones handle exactly those values — and nothing would
report it if one did. A denylist that covers one root while the other serves
the same four field names verbatim is a hole with a tested-looking lid: the
settings tests would be green and the secret would leave over the other route.
The cost of the extension is that a state field legitimately named `hash` is
served as `"<redacted>"`; that is the same cost the settings root already
accepted, and it is visible in the response rather than silent.

## A dot-path that does not exist is 422, not 404

A path such as `no.such.path` reaches mosd, which answers
`org.freedesktop.DBus.Error.InvalidArgs`, so §2.4's table gives it
`settings_rejected` / 422 / `source: mosd`. This is a deliberate reading of the
table rather than a missing case:

- The table is exhaustive over the fdo error name, and `InvalidArgs` has
  exactly one row.
- §2.4's `not_found` row is defined as *"unknown route, or a collection item
  that does not exist"*. The route exists — it matched — and collection
  resources are out of phase 1 entirely.
- Distinguishing "no such path" from "path rejected" would mean apid parsing
  mosd's message text, which is the one thing §2.4 forbids: the message is
  passed through precisely because apid does not know mosd's rules.

**§2.2 already works this exact case, and it comes out a validation failure.**
Its VLAN example is an unknown dot-path: `network.eth0.100` is split on `.` by
`split_path` unconditionally, the trailing segment lands as a field named `100`
inside `IfaceSettings`, and `deny_unknown_fields` rejects it as
`Validation { path: "network.eth0.100", message: "unknown field `100`, expected
`dhcp` or `static`" }`. mosd maps `SettingsError::Validation` onto
`InvalidArgs`, which is §2.4's `settings_rejected` row. So 422 is the answer the
translation rule *produces* for a path that does not exist — the design
document's own worked example of one — and not a convenience this task chose.
§2.4 uses the same example to illustrate the envelope, at 422.

**And the choice is load-bearing, so it must not be tidied up later.** §2.1's
breaking list is exhaustive and it names *"changing which `error.code` (§2.4) an
existing failure emits"* as breaking: it bumps `v1` to `v2`. A later reviewer
who reaches for REST convention and re-reads this case as 404 `not_found` is
therefore not making a cleanup — they are spending a major-version bump on it,
and every correct v1 client that switched on `settings_rejected` is what they
are spending it against. Once M3's oasdiff gate lands, CI says so before the
merge rather than after. The reading is recorded here so the reasoning reaches
that reviewer instead of being re-derived from the status code alone.

An unknown *route* still answers 404 with the `not_found` envelope, unchanged
from M1.

## The denylist keys on the field name, and on the requested path's last segment

§2.2 requires the redactor to be structural — keyed on the field name at any
depth, arrays included — because the two `psk` fields sit inside arrays that
the dot-path syntax cannot name. That is what `redact::walk` does.

The requested dot-path is checked as well, and that is an addition to what
§2.2 writes down. A structural walk keys on a field name, and
`GET /api/v1/settings/access.webAdmin.password_hash` answers the hash as a
**bare JSON string** with no field name left in the value to key on — so a
purely structural redactor serves the credential to anyone who asks for it by
its full path, which would make the rule trivially bypassable. `redact::redact`
therefore answers the sentinel when the last segment of the requested path is
one of the four names.

The list stays fail-open: a future secret-bearing field under a name it does
not carry is served. §2.2 says the mitigation is a test rather than a hope, and
`every_redacted_field_name_comes_back_redacted_from_the_settings_root` is it —
it walks the response, collects every field the denylist names wherever it sits,
asserts the fixture still carries all four names, asserts every collected value
came back as the sentinel, and then asserts no plaintext marker survived
anywhere in the bytes.

## `bus_client.rs` was not changed, and that was measured first

§2.4 records that apid **flattens**: `BusSettings` converts every `zbus::Error`
with `err.into()`. The section's remedy is to match on the `zbus::Error` before
converting it. That turned out to be unnecessary, and the measurement is the
reason:

`anyhow::Error`'s blanket `From<E: std::error::Error + Send + Sync + 'static>`
**stores** the concrete error rather than rendering it to a string, so the
`zbus::Error` — its `MethodError(OwnedErrorName, Option<String>, Message)`
variant and the fdo name inside it — is still recoverable by
`anyhow::Error::downcast_ref::<zbus::Error>()` after the existing conversion.
Verified before the classification was written and pinned by
`the_zbus_error_survives_the_conversion_to_anyhow`, so the day that premise
stops holding one test says so in one sentence instead of five tests failing
one row each. `bus_client.rs` is untouched.

## What §2.4's table maps onto

| fdo error name | `code` | HTTP | `source` |
|---|---|---|---|
| `org.freedesktop.DBus.Error.InvalidArgs` | `settings_rejected` | 422 | mosd |
| `org.freedesktop.DBus.Error.IOError` | `settings_io` | 500 | mosd |
| `org.freedesktop.DBus.Error.Failed` | `mosd_failed` | 500 | mosd |
| anything else, or no `MethodError` at all | `mosd_unreachable` | 503 | apid |

mosd's message is copied into `message` untouched; `Retry-After: 5` rides the
503 alone. `path` carries the dot-path at fault, which these routes always
name — it stays absent on `not_found` and `not_authenticated`, which name none.

## The gate predicate agrees with the router

`is_declared_api_route` gained the two families through `resource_dot_path`,
which requires a **non-empty** dot-path after the prefix. That is not a
stylistic guard: axum's `{*path}` wildcard matches at least one character
(measured), so `/api/v1/settings` and `/api/v1/settings/` reach the reserved
subtree's not-found handler. A predicate that claimed them would hand an
unauthenticated request for one of them to a route that does not exist, turning
today's redirect into a 404. Both spellings are asserted in both auth states
and in both gate modes.

Each root carries three spellings — the shared prefix, axum's `{*path}` route
and OpenAPI's `{path}` template — because the router and the document cannot
use the same string. `the_resource_path_spellings_agree` holds the two suffixed
forms to the prefix.

## Known gaps

- A write method on a **declared** resource path (`POST
  /api/v1/settings/hostname`) answers axum's bare 405 rather than §2.4's
  envelope, in both auth states. This is the shape M1's declared routes already
  have — `POST /api/versions` behaves the same way — and not something this
  milestone introduces; it belongs to whoever adds the write routes §2.2
  specifies. Undeclared paths are unaffected and keep their 404 envelope.
- `GET /api/v1/health` (§2.4's third case) is not served. It is a separate
  endpoint with its own gate exemption and is not in M2's slice.

## Acceptance

- Both roots answer 200 with exactly the dot-path's value for an authenticated
  caller, redacted, for a subtree, a scalar reached through one, and a scalar
  at the root of the tree.
- All four error classes are reachable and asserted with their code, status,
  source, verbatim message, `path` member, and `Retry-After` on the 503 alone.
- Unauthenticated resource reads answer 401 with the `not_authenticated`
  envelope and no `Location` header, in both gate modes.
- `/api/versions` still answers unauthenticated, in setup mode, and when the
  gate's own settings call fails.
- Every undeclared `/api` path keeps both of its answers byte for byte, the
  bare family prefixes included.
- `mosd/apid/openapi.json` is byte-identical to what `apid --openapi` prints.
- `bash docs/verify-index.sh` exits 0.

## Dependencies

- Follows RFCT-117 (M1), whose `ApiSession` extractor, `ApiError` envelope,
  `is_declared_api_route` predicate and `context_path` composition this
  milestone reuses rather than re-invents.
- M3 (RFCT-119) diffs the spec this milestone grew.
