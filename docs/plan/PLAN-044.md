# PLAN-044 Add RTC, NTP and timezone management

- **status**: completed
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-280](../task/RFCT-280.md)

## Context

`tzdata` is present, but the rootfs has no enabled network-time service and no
supported runtime timezone write. The cx3576 device tree declares an
AT8563/HYM8563-compatible RTC while its current kernel configuration disables
`CONFIG_RTC_DRV_HYM8563`. Wrong or rolled-back time undermines TLS, TUF expiry,
audit timestamps and scheduled operations.

## Proposal

- **SW:** include and enable `systemd-timesyncd` as an always-running base
  service. There is no enable/pause control in the API or UI.
- **SW:** add typed settings only for `time.ntp.servers` and
  `time.timezone`; validate server values and IANA timezone names, persist them
  through mosd, reconcile generated runtime configuration, and expose
  authenticated apid/UI read/write and synchronization status.
- **SW:** pin base policy to `PollIntervalMinSec=32s`,
  `PollIntervalMaxSec=2048s`, `ConnectionRetrySec=30s` and
  `SaveIntervalSec=60s`. These values are not user-facing settings.
- **SW:** keep kernel/RTC/API/log time in UTC, use timezone only for display and
  explicitly local schedules, and maintain a STATE-backed last-known-good clock
  floor for offline boot and read-only `/etc`.
- **SW:** define boot ordering for RTC, saved clock, network time, TLS and TUF;
  surface synchronized, synchronizing, offline/degraded and invalid-source
  states without stopping retries.
- **INT:** enable and validate the actual RTC driver and backup-power behavior
  per supported board; boards without an RTC publish that limitation.
- **DOC:** explain adaptive synchronization: healthy polling varies from 32 to
  2048 seconds, failures retry no faster than 30 seconds, and clock history is
  saved every 60 seconds.

## Risks

- Stepping a badly wrong clock can confuse logs and applications; status and
  audit records must distinguish correction from ordinary drift.
- An RTC node in DTS does not prove working hardware, oscillator accuracy or
  backup power; board validation is required.
- A writable timezone symlink under immutable `/etc` would violate the rootfs
  contract; mosd must own persistence and application.

## Scope

In scope: base package/service, settings schema and migration, reconciler,
API/UI, clock floor, RTC enablement, cross-board/offline tests and user docs.
Out of scope: PTP, NTS, user-configurable polling periods or an NTP pause switch.

## Alternatives

1. Run periodic one-shot `ntpdate`. Rejected because continuous drift,
   reachability and synchronization status matter.
2. Use `chrony` initially. Deferred; timesyncd meets the current appliance
   client requirement with a smaller contract.
3. Keep UTC without configurable presentation timezone. Rejected because local
   schedules and UI presentation still need an explicit IANA zone.

## Annotations

- 2026-08-31: The user selected persistent NTP, UI-configurable servers and
  timezone, and no pause control.
- 2026-08-31: Synchronization policy was fixed at adaptive 32-2048 second
  polling, 30-second retry and 60-second saved-clock intervals.
- 2026-09-01: Split from PLAN-037 as a software plus board-validation unit.

## Completion (2026-09-01)

- **Base service** (RFCT-280a): `systemd-timesyncd` installed via
  `mos-system` Depends, enabled statically in `sysinit.target.wants`, pinned
  policy shipped in `/etc/systemd/timesyncd.conf.d/50-mos.conf`; held by the
  `verify` checks `packed-timesyncd-installed/-enabled/-policy` and
  `packed-localtime-utc`.
- **Settings** (schema v9): exactly `time.ntp.servers` and `time.timezone`,
  validated by `mosd_settings::validate_ntp_servers` /
  `validate_timezone_name` (deterministic tzdata-name grammar; existence
  checked at reconcile time), enforced through `Settings::set` itself.
  Migration `MigrateV8ToV9` stamps only; `down` discards the subtree.
- **Reconciler**: `reconciler/time.rs` renders the server list to
  `/run/systemd/timesyncd.conf.d/60-mos-servers.conf` (restart on change) and
  the timezone to `/run/mos/timezone`. `/etc/localtime` is deliberately never
  touched — a bind over a symlink into zoneinfo would shadow the UTC zone
  itself; see docs/design/time.md §2.
- **Clock floor**: `/mnt/state/timesync` (seeded, `systemd-timesync`-owned)
  bound onto `/var/lib/systemd/timesync` by `var-lib-systemd-timesync.mount`,
  ordered before timesyncd; boot ordering RTC → saved floor → network time →
  TLS/TUF documented in docs/design/time.md §3.
- **Status**: `GetTimeStatus` on the bus, `GET /api/v1/time/status` over
  HTTPS: `synchronized` / `synchronizing` / `offline-degraded` /
  `invalid-source` (+ `unknown` when timesyncd is unobservable), with
  step-versus-slew correction evidence at timesyncd's own 0.4 s boundary.
  Read-only; nothing can pause retries.
- **API/UI**: the settings write route admits the two new dot-paths (typed
  shapes, 422 with the owning crate's sentence); the built-in UI gains a Time
  page (servers, timezone, live status) and the OpenAPI document the new
  route.
- **Board validation**: Step 1 of 4 **DONE** (2026-09-02, user, physical
  cx3576): the RTC driver is bound.

      root@mos-b360176c:~# cat /sys/class/rtc/rtc0/name
      rtc-hym8563 7-0051

  This is `rtc-hym8563` on I2C bus 7 at address `0x51`, with `/dev/rtc0`
  present. Steps 2-4 are **PENDING** on the bench: (2) perform a powered-off,
  offline boot after at least 1 hour and confirm `hwclock -r` shows elapsed
  real time (backup power); (3) confirm `GET /api/v1/time/status` reports
  `offline-degraded` with a clock above the saved floor on that offline boot;
  and (4) record those results here. Backup-power and offline-degraded
  evidence do NOT yet exist; the INT item stays open until steps 2-4 are
  recorded.
