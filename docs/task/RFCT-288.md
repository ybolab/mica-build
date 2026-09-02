# RFCT-288 Add diagnostics and operational network state

- **status**: completed
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

## Completion (2026-09-02)

| Acceptance item | Evidence |
|---|---|
| System information answers identity in one read | `GET /api/v1/system/info`; `/_ui/system-information` in `pkgs/mosd/apid/ui/src/app/routes/system-information.tsx`; `answers device identity with one API read` and `names unavailable identity evidence instead of showing a healthy blank` in `-system-information.test.tsx`; diagnostics design section 2. |
| Versioned snapshot contains the required evidence | Snapshot schema version 1 in diagnostics design section 5 covers release/board, the complete system surface, boot slot/reset/update, bounded journal, failures, storage, time, telemetry and observed network evidence; the routes are under `/api/v1/diagnostics/snapshots`. |
| Collection is bounded, atomic, authenticated and offline-exportable | Bounds, atomic publication, retention and offline behavior are specified in diagnostics design section 7; authentication and attachment export are specified in section 8; the `/_ui/diagnostics` page is covered by `shows retention bounds and authenticated snapshot actions`, `generates a snapshot and refreshes the list`, and `deletes a snapshot and refreshes the list` in `-diagnostics.test.tsx`. |
| Redaction excludes secrets and user content | The three-pass boundary and exclusions are specified in diagnostics design section 6; `every_planted_secret_is_absent_from_the_produced_snapshot` provides negative coverage, and `every_benign_member_survives_the_pass` plus the API export assertion provide positive/export coverage. |
| Desired and observed network state remain distinct | `GET /api/v1/network/status`; diagnostics design section 3; `/_ui/network-status` in `network-status.tsx`; `shows live evidence separately from desired network settings` and `names unavailable top-level evidence without assuming lists exist` in `-network-status.test.tsx`; `matches route boundaries instead of similarly prefixed pages` in `src/components/app-shell.test.ts`. |
| Board adapters and operations are validated | `GET /api/v1/system/telemetry` and diagnostics design section 4 cover adapter parsing and explicit absence; fixture coverage validates those semantics. Sections 10.1-10.4 cover collection, privacy, retention, escalation and all five required troubleshooting trees. Physical-board validation of reset reason, temperature, watchdog and radio fields is hardware-dependent, **not done**, and escalated by the coordinating workstream. |
