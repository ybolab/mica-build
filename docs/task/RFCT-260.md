# RFCT-260 The AP reconciler's third copy of the WPA byte rule, and a refusal that names the secret's length

- **status**: completed
- **priority**: P0
- **owner**: bkd/cn1b4hux
- **createdAt**: 2026-08-28
- **plan**: none yet — found by PLAN-026 M3 out of its scope, re-measured by
  the routing L2, filed by the campaign coordinator; claiming this needs a
  plan that admits `os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs`

## What was measured (2026-08-28, at ffa65ca)

PLAN-026 M3 (RFCT-249) unified the station-path WPA byte predicate into
`mosd_settings::is_wpa_quotable` so the settings validator and the client
reconciler state the byte set once. The AP reconciler holds a third copy that
M3's scope did not admit, plus its own copies of the length bounds:

1. `fn is_plain` re-states the byte set —
   `(0x20..=0x7e).contains(&byte) && byte != b'"' && byte != b'\\'`
   (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:278`) — with a
   leading/trailing-space rule of its own.
2. The bounds are re-declared, not imported: `const RAW_PMK_LEN: usize = 64;`
   (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:84`),
   `const MIN_PASSPHRASE_LEN: usize = 8;`
   (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:86`) and
   `const MAX_PASSPHRASE_LEN: usize = 63;`
   (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:88`). The file imports only
   `ApMode, Settings, WifiApSettings` from mosd_settings. After M3 lands, the
   station path has one rule and the AP path an independent second copy of
   both the bytes and the numbers.
3. The refusal contradicts its own hygiene note: `fn psk_directive` documents
   that the error deliberately does not name the value, per the module's
   secret-hygiene note — and its own refusal then interpolates `psk.len()`
   into `"the pre-shared key is {} characters; WPA2 requires \`
   (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:359`). The station path's
   `validate_wifi_psk` states the same rule and honours it; this one states
   it and breaks it, in the direction of leaking a fact about a secret.

## Not measured, and it sizes the task

Whether that refusal text can reach an API caller. It is raised
reconciler-side into an `anyhow` error; where such an error surfaces was NOT
established. `wifi.ap` is a documented settings subtree, but that is not the
same as the reconciler's refusal text being readable by a client. Settling
this decides whether item 3 is an internal inconsistency (P2 stands) or a
disclosure (raise to P1 and fix the message first, ahead of any refactor).

## Reachability measurement (2026-09-01)

**Answer: YES — the refusal text reaches an API caller, on two routes.** Item 3
was therefore a disclosure, fixed first.

The reconciler's `anyhow` error is caught in
`pkgs/mosd/mosd/src/bus.rs:622-638` (`fn record`), which stores
`{"error": err.to_string()}` into the live-state tree under the reconciler's
name (`wifiAp`) and returns `format!("{name}: {err}")` as a failure message.
From there:

1. **Live state.** `GetState` serves the live-state tree over D-Bus; apid
   proxies it (`pkgs/mosd/apid/src/bus_client.rs:300-304`) and serves it to
   HTTP clients at `GET /api/v1/state/{path}`
   (`pkgs/mosd/apid/src/routes.rs:1568-1575`). The route's redaction is by
   field name only — `psk`, `passwordHash`, `hash`, `privateKey`
   (`pkgs/mosd/apid/src/redact.rs:40-44`) — so the `error` field's text passes
   through verbatim.
2. **Apply tasks.** `reconcile_subtree` collects the failure messages
   (`pkgs/mosd/mosd/src/bus.rs:542-558`) and the apply worker joins them into
   the task record's `message` (`pkgs/mosd/mosd/src/bus.rs:575-584`), which is
   published in live-state `tasks` and via the `TaskChanged` signal
   (`pkgs/mosd/mosd/src/bus.rs:593-618`). apid mirrors the signal
   (`pkgs/mosd/apid/src/bus_client.rs:166-186`) and serves the record at
   `GET /api/v1/tasks` and `GET /api/v1/tasks/{id}`
   (`pkgs/mosd/apid/src/routes.rs:1508-1544`), `message` included.

The error is triggerable by a client: `validate_wifi_psk` is enforced at write
time only for `wifi.client` networks (`pkgs/mosd/apid/src/routes.rs:2515-2522`,
`pkgs/mosd/mosd/src/reconciler/wifi_client.rs:248`), and the settings model
deliberately does not enforce it in `Deserialize`
(`pkgs/mosd/mosd-settings/src/model.rs:459-464`) — so an out-of-range
`wifi.ap.psk` is accepted by the generic settings write, stored, and refused at
reconcile time with the refusal text landing on both routes above.

## Acceptance

- The reachability question above answered with a measurement, first.
- One statement of the byte predicate and one of the length bounds, shared
  from mosd-settings, with the AP reconciler importing both; its extra
  leading/trailing-space rule either lifted alongside or documented as
  AP-specific where it lives.
- The psk_directive refusal stops naming the length (or any property) of the
  rejected secret; a test asserts the message shape.
- Behaviour otherwise unchanged: same accept/reject sets, asserted by tests
  on both sides of the refactor.

## Completion (2026-09-01)

- **Reachability**: answered YES — see the measurement section above. The
  refusal was a disclosure, so the message was fixed first.
- **De-leaked refusal**: `psk_directive`'s length refusal no longer
  interpolates `psk.len()`; it states the rule only
  (`pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:358-362`). The new test
  `the_length_refusal_is_the_same_sentence_for_every_length` asserts the
  refusal is byte-identical for a 7-character and a 70-character key and
  carries neither observed length.
- **One home for the byte set and the numbers**: the AP reconciler's private
  `RAW_PMK_LEN` / `MIN_PASSPHRASE_LEN` / `MAX_PASSPHRASE_LEN` copies are
  deleted; it now imports the constants `mosd-settings` already exported next
  to `is_wpa_quotable`, and `fn is_plain` calls
  `mosd_settings::is_wpa_quotable` instead of restating the byte range. The
  emptiness and leading/trailing-space rules stay in `is_plain`, documented as
  AP-specific: they are about hostapd's line reader, not wpa_supplicant
  quoting. `mosd-settings` itself needed no change.
- **Behaviour unchanged**: the accept/reject tests
  (`a_key_hostapd_cannot_carry_is_an_error_that_does_not_name_it`,
  `a_sixty_four_character_hex_key_is_emitted_as_a_raw_pmk`, the SSID
  plain/hex partition tests) predate the refactor and pass on both sides.
- **Test evidence**: `cargo test --workspace --locked` green at the base
  commit and after the change, plus `cargo test --doc --workspace --locked`
  after the change, run inside `localhost/mos-build-rust:amd64`. That image
  ships no rustfmt, clippy, nextest or cargo-deny, so those `hack/check.sh`
  sub-checks could not run.
