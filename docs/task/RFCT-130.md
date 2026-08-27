# RFCT-130 Three distinct settings failures reach the API as one error code, so a missing path and a bad value are indistinguishable

- **status**: completed
- **priority**: P2
- **owner**: bkd/0fibgdbm
- **createdAt**: 2026-08-26

`to_fdo` maps `SettingsError::NotFound`, `SettingsError::ReadOnly` and
`SettingsError::Validation` all onto `fdo::Error::InvalidArgs`
(`mosd/mosd/src/bus.rs:487-491`). The three are separate variants with separate
messages in `mosd/mosd-settings/src/error.rs:9-21`, and the distinction is
destroyed at the bus boundary.

apid recovers the fdo error *name* correctly by downcast
(`mosd/apid/src/routes.rs:535-536`), so nothing is lost after mosd — but there
is only one name left to recover. `FDO_INVALID_ARGS` therefore answers
`422 Unprocessable Entity` with the single code `settings_rejected`
(`mosd/apid/src/routes.rs:541-544`) for all three conditions. A client asking
for a dot-path that does not exist gets the same status and the same code as
one submitting a malformed value, and can separate them only by parsing
mosd's message text — which is prose, not contract.

Splitting them is a mosd change: `NotFound` wants its own fdo name so the API
can answer `404`, and `ReadOnly` wants one so the API can answer `409`. apid's
match arm is the consumer that makes the split worth making.

## Resolution

**mosd side.** The standard fdo vocabulary has no names for these two
conditions, so mosd coins interface-scoped ones: `com.mos.mosd1.Error.NotFound`
and `com.mos.mosd1.Error.ReadOnly`, replied by a `SettingsFault` type with a
hand-written `zbus::DBusError` impl (the derive's passthrough variant would
have flattened every wrapped fdo name to `org.freedesktop.zbus.Error`);
`Validation` keeps `InvalidArgs`, `Io` keeps `IOError`, `Parse`/`Migration`
keep `Failed`, delegated to fdo so its "replies stay byte-identical"
(`os/pkgs/mosd/mosd/src/bus.rs:490-549`). `mosd-settings/src/error.rs` did not
need changing.

**apid side.** `bus_api_error` gains the two arms: 404 `settings_not_found`
and 409 `settings_read_only`; 422 now means a rejected value only —
`ApiError::mosd("settings_rejected", message)` (`os/pkgs/mosd/apid/src/routes.rs:558-581`). `GetState`'s own
not-found stays `InvalidArgs`/422 — it is not raised through the settings
error mapping and was out of this task's scope.

**RED-GREEN, both sides of the bus.** mosd side: `bus_roundtrip` (real
`dbus-daemon`, real daemon) asserts the three names on the wire per failure
class — red against the old code (`InvalidArgs` where `NotFound` was
expected), green after; plus a unit test over every `SettingsError` variant's
name and description. apid side: `each_fdo_error_name_gets_its_own_envelope`
gains the two rows and `a_dot_path_that_does_not_exist_is_404_and_a_rejection_stays_422`
replaces the old deliberate-422 test — both observed red (503 fallback / 422)
against the old classifier, green after.

**Docs.** api.md §2.4's two code tables gain the codes additively; §8.2
phase 1 and §9 record that the split landed before v1 froze. `openapi.json`
regenerated (committed copy is test-asserted byte-for-byte); the diff is a
new 404 response object on the settings GET plus a narrowed 422 description
string — additive by diff shape; no oasdiff binary exists on this host, as
with RFCT-134.

**Commits.** `1025e02` (implementation, tests, docs), `5502a4f` (citation
re-anchoring).
