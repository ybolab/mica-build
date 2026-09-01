# PLAN-052 Add diagnostics and operational network state

- **status**: draft
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: (pending)
- **relatedTask**: [RFCT-288](../task/RFCT-288.md)

## Context

mos exposes reconciler state, health data and an API, but logs under `/var` are
disposable and there is no bounded redacted support bundle or troubleshooting
decision tree. Network configuration exists for Ethernet, Wi-Fi, AP, VLAN,
bridge and WireGuard, while operators lack coherent observed carrier, address,
lease, route and DNS state. Similar gaps exist for current storage, time,
thermal, watchdog and reset-cause evidence.

## Proposal

- **SW:** define one versioned diagnostic snapshot containing release/board,
  boot/slot/reset, bounded journal, service/reconciler failures, storage, time,
  thermal/watchdog and observed network state.
- **SW:** make collection bounded in size/time, atomic, available offline and
  exportable through authenticated local tooling/API without enabling SSH.
- **SW/SEC:** apply a reviewed redaction schema for credentials, tokens, private
  keys, Wi-Fi secrets, registry auth, user content and personally identifying
  network fields; test positive and negative fixtures.
- **SW:** expose operational network facts separately from desired settings:
  link/carrier, interface/address, DHCP lease, default route, DNS reachability,
  Wi-Fi association and explicit unsupported radio/modem capabilities.
- **INT:** validate board-specific reset reason, temperature, watchdog and radio
  fields; absence is reported, not silently treated as healthy.
- **DOC/OPS:** publish collection, privacy, retention and escalation procedures
  plus symptom-to-evidence-to-remediation troubleshooting trees.

## Risks

- Diagnostics can leak the very secrets needed to control the device; redaction
  is a tested security boundary.
- Volatile evidence may disappear on reboot; persistence must be minimal,
  bounded and compatible with flash-wear policy.
- Desired network configuration is not proof of connectivity; APIs and docs
  must keep desired and observed state distinct.

## Scope

In scope: diagnostic schema/export, redaction, bounded evidence, observed
network status, board telemetry adapters and troubleshooting. Out of scope:
central fleet log ingestion, arbitrary remote shell, packet capture by default
and SKU-specific cellular support unless separately selected.

## Alternatives

1. Ask support to collect unrestricted journals manually. Rejected because it
   is inconsistent, inaccessible on headless failures and unsafe for secrets.
2. Persist all logs indefinitely. Rejected because embedded flash and privacy
   require explicit bounds.
3. Infer live networking from saved settings. Rejected because configuration
   and actual carrier/lease/route/DNS state differ.

## Annotations

- 2026-08-31: Production embedded comparison identified diagnostics, reset and
  observed-network state as pilot serviceability gaps.
- 2026-09-01: Split from PLAN-037 as the local field-diagnostics capability.
