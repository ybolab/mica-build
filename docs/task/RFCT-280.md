# RFCT-280 Add RTC, NTP and timezone management

- **status**: implementing
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
