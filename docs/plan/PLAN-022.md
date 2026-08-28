# PLAN-022 Native networking: VLAN, bridge, and WireGuard

- **status**: approved (design-first)
- **createdAt**: 2026-08-27 17:05
- **approvedAt**: 2026-08-27 17:05
- **relatedTask**: RFCT-200..209 reserved
- **milestones**: M1 design, USER-GATED; M2+ set by the ratified design

## Context

User decision (2026-08-27), growing out of RFCT-135: the network form
accepting `eth0.100` and then failing on deny_unknown_fields is not a
validation bug to patch but a missing feature surface. The device is to
support native networking: VLAN interfaces, bridges, and WireGuard, managed
like everything else (settings tree -> mosd reconciler -> apid forms/API).

Known constraints from the tree: the settings model is deny_unknown_fields
with a dot-path API whose VLAN collision is documented in api.md section 2.2;
interfaces are reconciled by mosd (systemd-networkd or direct, to be
measured); WireGuard needs key handling under the same secret rules as the
AP PSK (0600, never logged, never in live state); kernel support for
wireguard/bridge/vlan on both boards must be measured, not assumed
(cx3576 vendor 6.1 kernel config vs x64 Debian kernel).

## Proposal

- **M1 (RFCT-200)** the design, user-gated like PLAN-019 M1: current
  networking model measured end to end (model.rs, reconciler, forms, API);
  the extended model proposed (interface types, naming, the dot-path
  collision resolution — this is where RFCT-135's syntax problem gets its
  real fix); reconciler mechanism chosen with evidence (networkd vs manual);
  WireGuard key lifecycle under the secret rules; kernel config deltas per
  board measured; API surface additions classified against section 2.1
  (additive vs versioned); migration for existing settings. Nothing is
  implemented until the user ratifies the design.

## Scope (until the design says otherwise)

- **In (M1)**: reading everything; writing only its task file.
- **Out**: all implementation, pending the gate.

## Amendment 1 — M1 design ratified (user, 2026-08-27)

The design in docs/task/RFCT-200.md (workstream branch) is ratified as
written, with the three gate questions answered:

1. Peer pre-shared keys stay OUT of schema v7 — every secret field is a
   standing redaction obligation; PSK support is an additive later change.
2. The private-key file pattern is ratified: 0750 `root:systemd-network`
   directory, key files 0640, atomic writes. systemd import credentials are
   the fallback ONLY if the M2 on-image check shows the systemd-network user
   cannot read the file. *(Path-spelling correction, measured at M5: the
   amendment's original `secrets/networkd/` spelling is unreachable —
   identity.rs pins `secrets/` itself to 0700 unconditionally, and path
   traversal needs execute on every component, so the group could never
   reach the file. The directory is the true sibling
   `<state>/networkd-secrets/`; the ratified pattern's substance — modes,
   ownership, atomicity — is unchanged, and a planted-parent traversal test
   holds the correction in place.)*
3. Minimal surface confirmed: no STP, no VLAN egress/ingress maps, no
   per-peer routing metrics in v7 — all reachable later as additive optional
   fields under api.md section 2.1's rules.

Milestones M2..M8 as proposed in RFCT-200 section 8 (RFCT-201..207;
RFCT-208/209 reserved for findings) are the plan of record. Additional
condition: task-file owner fields use the executing issue id
(`bkd/<issue-id>`), never an agent name — RFCT-200.md's own owner line is
corrected before its branch merges; the tree-wide `ai-agent` sweep (121
files) is routed to PLAN-021 M3.
