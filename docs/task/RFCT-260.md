# RFCT-260 The AP reconciler's third copy of the WPA byte rule, and a refusal that names the secret's length

- **status**: pending
- **priority**: P0
- **owner**: unassigned
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
