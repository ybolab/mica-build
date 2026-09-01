# PLAN-044 Add RTC, NTP and timezone management

- **status**: implementing
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
