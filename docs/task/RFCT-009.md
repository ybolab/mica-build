# RFCT-009 mosd skeleton (Rust management plane, PLAN-010 M2)

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 01:16
- **claimedAt**: 2026-08-18 01:16
- **completedAt**: -

## Description

Execute PLAN-010 M2: build the mosd skeleton — the Rust management plane on the systemd
base. Related plan: PLAN-010 M2. Design contract: `docs/design/mosd.md` (approved
2026-08-18).

Scope / deliverables:

1. New top-level `mosd/` Rust workspace on the pma-rust baseline: edition 2024, forbid
   unsafe, fmt/clippy `-D warnings`/nextest/cargo-deny gates via `mosd/hack/check.sh`.
2. `mosd-settings` crate: typed settings tree v1 (`schema_version`, `hostname`,
   per-interface network dhcp/static); dot-path get/set; atomic TOML persistence
   (default `/var/lib/mos/settings.toml`); bidirectional v0<->v1 migration framework.
3. `mosd` daemon: zbus service `com.mos.mosd`, object `/com/mos/mosd`, interface
   `com.mos.mosd1` with `GetSettings`/`SetSettings`/`GetState` + `SettingsChanged`
   signal; live-state tree; `MOSD_DRY_RUN` test gate; systemd unit + D-Bus policy in
   `mosd/dist/`.
4. Two reconcilers behind mockable executor traits: hostname via
   `org.freedesktop.hostname1`; network rendering `50-mos-<iface>.network` files to
   `/run/systemd/network` with networkd Reload.
5. Image integration: aarch64 cross build; rootfs ships binary+unit+policy behind
   `WITH_MOSD` default ON; `os/verify-image.sh` grows 42 -> 47 checks.

Work checklist:

- [ ] Workspace scaffold + quality gates (`mosd/hack/check.sh`)
- [ ] `mosd-settings` crate (settings tree v1, persistence, migrations)
- [ ] Daemon (zbus service) + systemd unit + D-Bus policy
- [ ] Reconcilers (hostname, network) behind mockable executor traits
- [ ] aarch64 cross build + image/verify integration
- [ ] Docs finalize

Acceptance:

- `./mosd/hack/check.sh` green.
- `make os-image-cx3576` + `make os-verify-cx3576` green with mosd included.
- On-device "settings applied live + survive reboot" is the user's hardware
  acceptance — out of scope here; never claimed done by agents.

## ActiveForm

Building the mosd skeleton (Rust management plane) for PLAN-010 M2.

## Dependencies

- **blocked by**: RFCT-008 (M1 image pipeline)
- **blocks**: PLAN-010 M3 (webd on mosd)
