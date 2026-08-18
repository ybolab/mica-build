# RFCT-010 webd v1 on the mosd bus (PLAN-010 M3)

- **status**: implementation complete — pending user hardware acceptance
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 01:59
- **claimedAt**: 2026-08-18 01:59
- **completedAt**: -

## Description

Execute PLAN-010 M3: bring up webd v1 — the web UI daemon on top of the mosd
D-Bus API. Related plan: PLAN-010 M3. Kiosk is explicitly out of scope here and
deferred to the display phase.

Scope / deliverables:

1. New `webd` crate in the `mosd/` workspace (`mosd/webd/`): axum + axum-server
   HTTPS with rustls (RING provider; no aws-lc-rs/openssl in `Cargo.lock`),
   rcgen self-signed certificate persisted under `/var/lib/mos/webd`
   (`StateDirectory`), HTTP :80 -> 308 redirect to https.
2. Auth: argon2id first-run admin password stored in the settings tree at
   `access.webAdmin.password_hash` — settings schema v2 with bidirectional
   v1<->v2 migration (`MigrateV1ToV2`); HMAC-signed session cookies
   (Secure/HttpOnly/SameSite=Lax, in-process store, 24h TTL); global
   5-failure/30s login backoff.
3. UI panes: status, network, hostname, plus a combined first-run setup wizard.
   Server-rendered with maud; no CDN dependencies, no JS build step.
4. End-to-end integration test (`mosd/webd/tests/e2e.rs`) over a private
   session bus with a real mosd + real webd: setup -> login -> SetSettings
   hostname via HTTP -> GetSettings reflects the change.
5. Image integration: `mosd/dist/webd.service` (`After=mosd.service`,
   `StateDirectory=mos/webd`), shipped and enabled in the cx3576 rootfs behind
   `WITH_MOSD`; aarch64 cross build.

Landed commits: eb995dc (schema v2), 9c496c6 (scaffold/auth), aa7cab6
(panes/wizard), 0fa21a9 (e2e test), 135c034 (image integration).

Work checklist:

- [x] Settings schema v2 (`access.webAdmin`) + v1<->v2 migration
- [x] webd scaffold: HTTPS/TLS, sessions, auth core
- [x] Panes (status/network/hostname) + first-run wizard
- [x] e2e integration test (real mosd + webd over a private bus)
- [x] webd.service + image/verify integration + aarch64 build
- [x] Docs finalize

Acceptance:

- `./mosd/hack/check.sh` green.
- `make os-image-cx3576` + `make os-verify-cx3576` green with webd included.
- On-device "browser to `https://<board-ip>/` -> first-run wizard -> applied
  settings survive" is the user's hardware acceptance — out of scope here;
  never claimed done by agents.

## Verification (2026-08-18)

Final verification on integration branch head `fbf20dd`:

- `bash mosd/hack/check.sh` — ALL CHECKS PASSED: `cargo fmt --check`, clippy
  `-D warnings`, cargo nextest (incl. the webd e2e test over a private session
  bus with real mosd + webd; 24 webd tests, run twice), cargo-deny
  licenses/bans/advisories ok.
- `make os-image-cx3576` + `make os-verify-cx3576` — RESULT: PASS (70/70
  checks; M2 baseline was 47), including the 5 new webd checks (binary
  present, aarch64 ELF, unit ordering, StateDirectory, unit enabled).
- Assembled image 457179136 bytes (~427 MiB, down from 1554 MiB); rootfs
  ~204 MB installed within the 400 MB budget (see RFCT-011 for the sizing
  work); byte-identical across cache-hot rebuilds.
- Pending user hardware acceptance: browser to `https://<board-ip>/` ->
  first-run wizard -> applied settings survive.

## ActiveForm

Building webd v1 (web UI daemon on the mosd bus) for PLAN-010 M3.

## Dependencies

- **blocked by**: RFCT-009 (M2 mosd skeleton)
- **blocks**: PLAN-010 M4 (A/B updates); kiosk (display phase)
