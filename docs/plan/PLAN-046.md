# PLAN-046 Deliver install, onboarding and provisioning

- **status**: implementing
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-282](../task/RFCT-282.md)

## Context

mos builds whole-disk images for x64 and cx3576, and cx3576 has a RockUSB
recovery path. Empty STATE can seed device identity, hostname and secrets, and
apid contains setup/login flows. There is not yet one verified customer journey
for selecting a compatible artifact, flashing it, booting without a network,
claiming the device and applying repeatable initial configuration. The generated
device credential is not yet a complete onboarding channel.

## Proposal

- **DOC/INT:** define one supported installation path for every board/profile
  claimed by a release, including prerequisites, media selection, verification,
  destructive-data warning, flashing, first boot, status indications and return
  to recovery.
- **SW:** define a versioned, validated provisioning document for device
  identity, administrator bootstrap, Ethernet/Wi-Fi, NTP/timezone, certificates
  and approved product-profile settings. Applying it must be idempotent and
  redact secrets from logs/status.
- **SW/INT:** support factory injection and at least one zero/offline-network
  onboarding path appropriate to each qualified board; do not assume cloud
  metadata, SSH or Internet availability.
- **SW:** turn bootstrap credentials into a bounded claim flow with expiry or
  forced rotation, explicit already-claimed behavior and safe retry after power
  loss.
- **OPS:** define who creates identity/credentials, which factory records are
  retained, and how failed or duplicated provisioning is quarantined.
- **DOC:** publish first-run, headless/offline and recovery-entry guides with
  board-specific evidence and data-loss boundaries.

## Risks

- A universal transport may not exist across boards; the schema can be common
  while transport and physical-presence rules stay board-specific.
- Power loss between identity creation and claim can duplicate or orphan
  credentials; transitions must be transactional and replayable.
- Factory logs or media can leak bootstrap secrets; retention and erasure are
  part of acceptance, not a later documentation detail.

## Scope

In scope: release-to-first-login journey, provisioning schema, claim state,
offline/factory transport contracts, board runbooks and end-to-end tests. Out of
scope: fleet enrollment after onboarding, arbitrary configuration management or
implementing every vendor flashing utility.

## Alternatives

1. Require SSH for first boot. Rejected because production appliances may never
   expose a persistent shell.
2. Require Internet/cloud metadata. Rejected because embedded installation must
   tolerate offline factories and sites.
3. Document manual edits to STATE. Rejected because secret handling and schema
   migration need a validated platform boundary.

## Annotations

- 2026-08-31: Embedded-first provisioning was defined around factory,
  removable/local and zero-network paths rather than CoreOS cloud metadata.
- 2026-09-01: Split from PLAN-037 as the release-to-first-login capability.
