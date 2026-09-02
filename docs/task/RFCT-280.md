# RFCT-280 Add RTC, NTP and timezone management

- **status**: completed
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-044](../plan/PLAN-044.md)

## Description

Deliver reliable embedded time using board RTC evidence, an always-running
timesyncd base service, persistent trusted-time recovery and managed NTP/timezone
settings.

## Acceptance

- `systemd-timesyncd` is installed/enabled with 32-2048 second adaptive polling,
  30-second retry and 60-second saved-clock policy.
- mosd/apid/UI support only NTP servers and IANA timezone settings; there is no
  pause/enable switch.
- RTC, saved-clock, network-time, TLS and TUF ordering is tested offline and
  online, while machine/RTC/API/log time remains UTC.
- Synchronization/degraded status is visible and failures continue retrying.
- Each qualified board records RTC presence, driver and backup-power evidence.

## ActiveForm

Adding always-running NTP, RTC and timezone management.

## Dependencies

- **blocked by**: explicit approval of PLAN-044; access to qualified board hardware
- **blocks**: reliable online signed updates and trustworthy audit timestamps

## Notes

- Polling and retry periods are base policy, not user-editable UI fields.

## Completion (2026-09-01)

- Delivered in two halves: the base service/policy/enablement (RFCT-280a) and
  the settings/reconciler/floor/status/API/UI half (RFCT-280b). Design record:
  docs/design/time.md.
- Acceptance, item by item: timesyncd installed/enabled under the pinned
  32-2048 s / 30 s / 60 s policy (verify `packed-timesyncd-*`); mosd/apid/UI
  expose only `time.ntp.servers` and `time.timezone` with no pause/enable
  switch anywhere; the STATE-backed saved-clock floor
  (`var-lib-systemd-timesync.mount`, ordered before timesyncd) plus RTC gives
  max(RTC, saved) before TLS/TUF consumers, with offline (floor holds, status
  `offline-degraded`, retries continue) and online (`synchronized`) behaviour
  covered by deterministic classifier and reconciler tests; machine/RTC/API/
  log time stays UTC (`packed-localtime-utc`), the timezone being presentation
  only; synchronization status is visible read-only at
  `GET /api/v1/time/status` and distinguishes a clock step from ordinary
  drift where the last sample allows.
- **RTC board evidence — NOT done**: the "each qualified board records RTC
  presence, driver and backup-power evidence" item requires cx3576 hardware
  and was NOT performed in this change; it is escalated by the coordinating
  workstream and remains open. This record does not claim it.
