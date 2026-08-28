# RFCT-135 The network form accepts a VLAN interface name that the settings path syntax then rejects

- **status**: completed — closed by PLAN-022's quoted path segments (`a0eaf81`), verified 2026-08-28 under PLAN-027 M1; the reproduction now lives in the tree as four tests
- **priority**: P1
- **owner**: bkd/fao2myqh
- **createdAt**: 2026-08-26

`valid_iface_name` permits `.` in an interface name:

```rust
.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
```

(`mosd/apid/src/routes.rs:806-811`), and the error message the pane shows
advertises it — *"letters, digits, '.', '_' or '-'"* (`:850`). `eth0.100` is
the standard spelling of a VLAN interface and passes validation.

`network_submit` then writes it as a dot-path: `set_settings("network.eth0.100")`
(`mosd/apid/src/routes.rs:1534`). `split_path` splits on `.` unconditionally
(`mosd/mosd-settings/src/path.rs:26-32`), producing three segments, so `100` is
offered as a field of `IfaceSettings` — which carries `deny_unknown_fields`
(`mosd/mosd-settings/src/model.rs:414-416`) and refuses it.

The operator sees the form accept the name and then a bus error, with no
message saying that VLAN interfaces cannot be configured at all. Either the
validator should reject `.` and say why, or the path syntax needs a way to
address a key containing one. The second is the real fix and is not apid's to
make: it is the settings dot-path syntax, and the same limit blocks any key
with a dot in it.

---

## Verdict, 2026-08-28 (PLAN-027 M1)

**Closed, and it was closed before this task was picked up.** PLAN-022 taught
the settings dot-path a quoted segment form (commit `a0eaf81`, *feat(mosd-settings):
quoted path segments for dotted keys*) and moved apid onto it. Everything below
was re-measured at this branch's HEAD; nothing is relayed.

Nothing above the rule was edited except the `status` and `owner` fields:
`docs/task/RFCT-200.md` cites the finding by line, so the finding keeps its
line numbers.

### Where the finding's citations point now

The filed record predates the move under `os/pkgs/`, so every path in it is
stale and so is every line number. Re-measured:

| As filed | Now |
|---|---|
| `mosd/apid/src/routes.rs:806-811` | `valid_iface_name` (`os/pkgs/mosd/apid/src/routes.rs:3430-3435`) |
| `:850`, the pane's message | `Interface name must be 1-15` (`os/pkgs/mosd/apid/src/routes.rs:3482`) |
| `mosd/apid/src/routes.rs:1534`, the write | `iface_settings_path` (`os/pkgs/mosd/apid/src/routes.rs:5548-5552`) |
| `mosd/mosd-settings/src/path.rs:26-32` | `split_path` (`os/pkgs/mosd/mosd-settings/src/path.rs:76-105`) |
| `mosd/mosd-settings/src/model.rs:414-416` | `deny_unknown_fields` (`os/pkgs/mosd/mosd-settings/src/model.rs:560-561`) |

### What the tree does today

1. **The path syntax has a spelling for the key.** A segment is bare or
   double-quoted, and the quoted form is TOML's own: *"TOML's own quoted-key
   syntax, which is what the store already writes for such a key"*
   (`os/pkgs/mosd/mosd-settings/src/path.rs:6-7`). Reads and writes share one
   splitter, `pub(crate) fn split_path(path: &str) -> Result<Vec<String>, SettingsError>`
   (`os/pkgs/mosd/mosd-settings/src/path.rs:76-105`), so a path that resolves
   for `get` is spelled the way it is spelled for `set`.

2. **apid builds the quoted form.** The write path is
   `format!("network.{}", quote_path_segment(iface))`
   (`os/pkgs/mosd/apid/src/routes.rs:3492-3494`), and `network_submit` sends it
   as `.set_settings(&iface_settings_path(&iface), &value)`
   (`os/pkgs/mosd/apid/src/routes.rs:5548-5552`). The quoting rule is
   `if segment.contains('.') || segment.contains('"')`
   (`os/pkgs/mosd/mosd-settings/src/path.rs:44-50`). So `eth0.100` leaves apid
   as `network."eth0.100"`: two segments, not three.

3. **`deny_unknown_fields` is untouched, and no longer bites.**
   `pub struct IfaceSettings`
   (`os/pkgs/mosd/mosd-settings/src/model.rs:560-561`) still carries it. It
   refused `100` only because the unquoted path offered `100` as a field of the
   interface; the quoted path never does. The old spelling still fails, and a
   test says so.

4. **The validator is unchanged, and the message still matches it.** The whole
   rule is
   `b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')`
   (`os/pkgs/mosd/apid/src/routes.rs:3430-3435`), and both sentences an
   operator can be shown state exactly that charset and that bound: the pane's
   *"Interface name must be 1-15 characters of letters, digits, '.', '_' or '-'."*
   (`os/pkgs/mosd/apid/src/routes.rs:3482`) and the typed route's
   *"an interface name is 1 to 15 characters of letters, digits"*
   (`os/pkgs/mosd/apid/src/routes.rs:2496`). The finding's first alternative —
   reject `.` and say why — was not taken, and the message did not have to
   change, because the name is now writable.

### The grammar edge, checked rather than assumed

`quote_path_segment` returns a segment containing `"` quoted anyway, so a path
built from one is malformed and fails rather than addressing some other key.
That is a backstop, not the guard. The guard is the charset above, which admits
no `"` — so a name carrying one is refused **before** the path builder, on the
form (422, page re-rendered) and on `PUT /api/v1/network/{iface}` (422), with
no write attempted. Asserted by
`network_post_refuses_a_quote_in_an_iface_name`
(`os/pkgs/mosd/apid/src/tests.rs:406-439`); the store refuses `eth"0` from
below in
`set_rejects_a_network_key_that_is_not_an_interface_name`
(`os/pkgs/mosd/mosd-settings/tests/settings.rs:1723-1751`).

A `.` that is not a VLAN spelling is treated the same way, because the rule is
about the character and not the convention:
`network_post_quotes_any_dotted_name_not_only_a_vlan`
(`os/pkgs/mosd/apid/src/tests.rs:441-454`).

### The reproduction, now carried by tests

The route-level test that already existed asserted only the *spelling* of the
write path, and could not have caught a regression in what the write lands on:
`FakeSettings` split every path on `.` unconditionally, so a VLAN write would
have gone to the two keys `"eth0` and `100"` and the test would still have
passed. The fake now splits with the store's own grammar —
`mosd_settings::path_segments`
(`os/pkgs/mosd/apid/src/settings_api.rs:138-147`) — which is what makes an
end-to-end assertion possible:

- `network_post_quotes_a_dotted_iface_name`
  (`os/pkgs/mosd/apid/src/tests.rs:340-374`) — POST `iface=eth0.100&dhcp=on`,
  303 to `/network?saved=1`, write path `network."eth0.100"`, the stored
  `network` map exactly `{"eth0.100": {"dhcp": true}}`, the value addressable
  at `network."eth0.100".dhcp`, and the pane re-rendering the entry it just
  wrote.
- `the_dotted_iface_path_apid_builds_is_accepted_by_the_settings_model`
  (`os/pkgs/mosd/apid/src/tests.rs:376-404`) — the string apid actually builds,
  driven into the real `mosd_settings::Settings`: it lands on the one key
  `eth0.100`, and the unquoted spelling this task filed still fails with
  ``unknown field `100` ``.
- `a_quoted_segment_round_trips_a_dotted_interface_key`
  (`os/pkgs/mosd/mosd-settings/tests/settings.rs:1640-1674`) — PLAN-022's own
  fixture: get, set of a leaf inside the entry, TOML persistence and reload all
  spell the key the same way.
- `an_unquoted_dotted_key_is_still_a_field_of_the_interface`
  (`os/pkgs/mosd/mosd-settings/tests/settings.rs:1678-1691`) — the filed
  failure, preserved as the failure it still is.

### Residue

None in this task's scope. One thing measured and deliberately not acted on:
whether an interface named `eth0.100` is *configured* as a VLAN is the
reconciler's question, not the path syntax's, because
`is authoritative, not the interface name`
(`os/pkgs/mosd/mosd-settings/src/model.rs:552-554`) — `kind` decides, the name
is a convention. This task closes the addressing failure the finding named.
`docs/design/mosd.md` states nothing the tree contradicts on either half, so it
was not edited.
