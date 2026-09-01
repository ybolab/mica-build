# RFCT-288 Add diagnostics and operational network state

- **status**: implementing
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-052](../plan/PLAN-052.md)

## Description

Provide a bounded, redacted, offline-capable support snapshot and the observed
network/system state needed to troubleshoot embedded devices without SSH.

## Acceptance

- A system-information surface (API and built-in UI) answers device identity
  in one read: machine id, board, kernel version, system (image) version with
  its git stamp, build date, installed package versions (sourced from
  `/usr/share/mos/manifest.tsv`), active slot and uptime.
- A versioned snapshot contains release/board, the system-information surface,
  slot/reset, bounded logs, failures, storage, time, thermal/watchdog and live
  network evidence.
- Collection is bounded, atomic, authenticated and exportable offline.
- Redaction tests exclude credentials, keys, tokens, Wi-Fi/registry secrets and
  user content.
- Desired network settings remain distinct from carrier/address/lease/route/DNS
  and association state.
- Board adapters, retention/privacy operations and troubleshooting trees are
  validated.

## ActiveForm

Adding local diagnostics and operational network state.

## Dependencies

- **blocked by**: explicit approval of PLAN-052; status surfaces from PLAN-044, PLAN-049 and board telemetry
- **blocks**: pilot field service and evidence-based escalation

## Notes

- Central fleet collection and unrestricted shell/packet capture are excluded.
