# PLAN-053 Define security and manufacturing lifecycle

- **status**: completed
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **completedAt**: 2026-09-02
- **relatedTask**: [RFCT-289](../task/RFCT-289.md)

## Context

mos has a read-only dm-verity root, separate RAUC/TUF trust domains, per-device
credentials and some service sandboxing. Production RAUC key provisioning,
device credential/certificate rotation, factory identity records, debug/fuse
policy and a security-response lifecycle are incomplete. Many customer-selected
boards use opaque or binary-only boot stages, so rootfs integrity must not be
misrepresented as end-to-end secure boot.

## Proposal

- **DOC/SEC:** publish the threat and physical-access boundary separately for
  runtime root integrity, normal update authenticity, boot-chain authenticity,
  data confidentiality, recovery and rootful applications.
- **SW/OPS:** define production generation, injection, storage, rotation,
  revocation and recovery for RAUC/TUF public trust, device TLS identities,
  administrator credentials and any board boot keys. Private production
  material remains outside the repository.
- **INT/OPS:** version and verify factory inputs for serial/MAC, calibration,
  identity and keys; produce a manufacturing result, quarantine failures, and
  define rework/RMA ownership without cloning device identity.
- **INT/DOC:** record boot assurance per board/revision using PLAN-050 I1-I4
  evidence. Binary-only U-Boot is allowed at I1/I2 when A/B, recovery and
  negative update tests pass; I3/I4 require actual vendor capability and
  negative signature tests.
- **OPS/DOC:** define debug/JTAG/serial/recovery policy, vulnerability intake,
  severity/patch targets, advisory publication, incident response and support
  end-of-life.
- **SW/DOC:** explicitly report current data-at-rest and container-policy limits;
  encryption or managed-application enforcement proceeds only through its own
  approved plan.

## Risks

- Key ceremony prose without production ownership and negative tests does not
  create a trust boundary.
- Fusing debug or boot policy can be irreversible and can remove recovery;
  board-specific manufacturing validation is mandatory.
- Overstated “secure boot” or “tamper-proof” language can hide known opaque boot
  stages; release and website checks must reject unsupported claims.

## Scope

In scope: security model, key/credential lifecycle, factory records, board
assurance reporting, debug/recovery policy and security-response operations.
Out of scope: storing production private keys in git, universal I3/I4, generic
compliance certification and implementing optional encryption/app isolation.

## Alternatives

1. Require source-available U-Boot for every board. Rejected as an unrealistic
   embedded supply constraint; evidence level and limitations are more honest.
2. Call dm-verity secure boot. Rejected because an untrusted earlier stage may
   choose the kernel, command line and root hash.
3. Leave manufacturing to undocumented factory practice. Rejected because
   identity uniqueness, recovery and audit depend on a versioned process.

## Completion

### Delivered

- `docs/design/security-model.md`, `security-lifecycle.md` and
  `manufacturing.md` define the distinct trust boundaries, credential and
  response ownership, factory record contract, RMA invariant and honest limits.
- `boards/cx3576/evidence.json` and `boards/x64/evidence.json` report I1 with
  physical/debug boundaries and host-side update-negative evidence without
  raising the claim.
- `build/src/release-manifest.ts` enforces the I1-I4 evidence floors and
  refuses unsupported claim wording through `checkBoardEvidence`, as documented
  in `docs/design/release-artifacts.md` section 4.

### Verification

- `(cd build && bun test)` and `bash tests/release-verify-test.sh` — board
  evidence schema, level floors, unsupported wording and publication refusal.
- `bash tests/rauc-trust-negative-test.sh` and
  `bash tests/trust-domain-hygiene-test.sh` — wrong-key/tampered-bundle
  refusals and private-material boundaries.
- `make docs-verify` and `bash tests/shell-pipefail-lint.sh`.

Cargo gates were not rerun in this acceptance sweep: each merged Rust subtask
ran its Cargo gates on the identical delivered commit.

### Residue

- Factory station tooling, immutable input issuance, manufacturing-result
  storage, quarantine and RMA/rework workflow are proposed procedures requiring
  external factory/MES infrastructure and operator execution.
- Device TUF-root provisioning, RAUC keyring rotation and managed device PKI
  remain product decisions; board boot-key enrollment is not implemented.
- Both boards remain I1. I2 waits for provisioned production anchors and
  on-board A/B-fallback plus negative-update suites; I3/I4 wait for vendor boot
  capability, signature-negative evidence and board-specific debug/fuse policy.
- Vulnerability intake, advisory publication and EOL remain owned but
  operator-run channels.

### Acceptance matrix

| Acceptance | Verdict | Evidence and verification | Residue |
|---|---|---|---|
| Threat documentation separates rootfs integrity, update authenticity, boot authenticity, data confidentiality, recovery and rootful applications. | Satisfied | `docs/design/security-model.md`; `docs/design/security-lifecycle.md`; checked by `make docs-verify`. | None. |
| Trust anchors and device credentials have generation, injection, rotation, revocation and recovery procedures with negative tests. | Partially satisfied | `docs/design/security-lifecycle.md`; `docs/design/release-signing.md`; `tests/rauc-trust-negative-test.sh`; the negative and hygiene suites passed. | TUF-root provisioning, RAUC device-keyring rotation, managed device PKI and board boot-key procedures remain partial/proposed or operator-only. |
| Factory inputs/results are versioned and RMA/rework cannot clone identity. | Escalated | `docs/design/manufacturing.md`; `docs/design/provisioning.md`; documentation verification passed. | The invariant and record schema are documented, but factory station/MES tooling, immutable input issuance, result persistence, quarantine and RMA execution do not exist in this tree. |
| Each board/revision reports I1-I4 evidence and physical/debug boundaries; unsupported secure-boot claims fail publication checks. | Satisfied | `boards/cx3576/evidence.json`; `boards/x64/evidence.json`; `build/src/release-manifest.ts`; build Bun tests and the release verification gate passed. | Both boards truthfully remain I1; higher levels require the evidence named in their qualification prose. |
| Vulnerability intake, advisory, incident and EOL operations have owners. | Satisfied | `docs/design/security-lifecycle.md`; checked by `make docs-verify`. | The owner roles and procedures exist, while the operational channels remain manual/proposed. |

## Annotations

- 2026-08-31: The user selected best-effort trusted boot and documentation-led
  support for user-integrated, sometimes binary-only boards.
- 2026-09-01: Split from PLAN-037 as the security/manufacturing policy gate.
- 2026-09-02: Campaign `l1-6rjx4wrt-20260901180748` was integrated from merge
  branch `bkd/v0nvqwf3` for acceptance and completion.
