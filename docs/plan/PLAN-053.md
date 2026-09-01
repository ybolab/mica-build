# PLAN-053 Define security and manufacturing lifecycle

- **status**: draft
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: (pending)
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

## Annotations

- 2026-08-31: The user selected best-effort trusted boot and documentation-led
  support for user-integrated, sometimes binary-only boards.
- 2026-09-01: Split from PLAN-037 as the security/manufacturing policy gate.
