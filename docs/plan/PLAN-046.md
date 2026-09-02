# PLAN-046 Deliver install, onboarding and provisioning

- **status**: completed
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

## Completion (2026-09-02)

- **Provisioning document** (P1): `mosd_provisioning_doc` in
  `pkgs/mosd/mosd/src/provisioning_doc.rs` parses, validates and applies a
  versioned document; both offline transports are staged before mosd starts by
  `rootfs/overlay/usr/lib/mos/mos-provisioning-import` under
  `mos-provisioning-import.service`. Idempotence and secret redaction are
  covered by that module's own tests; the record it writes is read back through
  `GET /api/v1/provisioning/status`
  (`pkgs/mosd/apid/src/provisioning_api.rs`, `ProvisioningStatus`). Contract:
  `docs/design/provisioning.md` §4.1.
- **Claim lifecycle** (P2): `access.claim` at settings schema v11
  (`ClaimSettings` / `ClaimChannel` in `pkgs/mosd/mosd-settings/src/model.rs`)
  records which channel minted the administrator credential and whether the
  credential is still the bootstrap secret. `GET /api/v1/claim` projects it;
  the forced rotation is enforced once, in `ApiCredential::from_request_parts`
  (`pkgs/mosd/apid/src/routes.rs`), so a route added later is bound by default,
  with `POST /api/v1/actions/change-password` and `/api/v1/session` the only
  exemptions — an operator holding a bootstrap credential can always sign in,
  see why they were refused, and clear the bound. `POST /api/v1/setup` on a
  claimed device answers 409 `already_configured`.
- **Replay safety**: a claim is ONE `Store::save` of `access` — the credential
  and the record land together — so a power loss leaves the device claimed or
  unclaimed and never half-claimed. Asserted at the unit level
  (`pkgs/mosd/apid/src/tests/claim.rs`); see the bench items below for the
  power-loss case on hardware.
- **Console** (U1): `pkgs/mosd/apid/ui/src/features/onboarding/`
  (`claim-panel`, `provisioning-panel`, `rotation-notice`) binds those routes
  into the built-in UI, with tests beside each panel.
- **Operator documentation** (X1): `docs/user/install.md`,
  `docs/user/first-run.md` and `docs/user/manufacturing.md`, mirrored under
  `docs/zh/user/`; the cx3576 install entry is recorded in
  `docs/bsp/cx3576-example.md`.
- **Live evidence**: `pkgs/mosd/tests/apid-api` phase `06-onboarding-claim`
  drives `GET /api/v1/provisioning/status`, `GET /api/v1/claim` (`via: setup`)
  and the 409 second setup against a booted x64 guest — the claim record
  surviving a bus round trip and a TOML save, which no route test can say.

### What is closed, and where

- Closed by code and static gates: the provisioning document's schema,
  validation, idempotence and secret handling; the claim record and its forced
  rotation; the already-claimed refusal.
- Closed only in QEMU: the claim and provisioning surfaces on a booted device
  (phase 06 above). The device is x64 under TCG; cx3576 has no boot evidence
  here.
- **Bench-dependent, and therefore NOT closed:** the flash-and-first-boot
  journey on real cx3576 hardware, including the recovery-entry procedure;
  either offline transport exercised from real media on a real board;
  claim/rotation across a real power loss; and "manufacturing ownership,
  failure quarantine and first-run guides tested end to end", which is
  documented (`docs/user/manufacturing.md`, `docs/design/manufacturing.md`) and
  has no factory run behind it. RFCT-282's first, third, fourth and fifth
  acceptance bullets are met in code and documentation and are unproven on
  hardware; see that task's Completion for the operator steps.
