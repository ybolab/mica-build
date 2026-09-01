# PLAN-049 Add storage status and data lifecycle management

- **status**: implementing
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-285](../task/RFCT-285.md)

## Context

mos already has storage-layout automation: fixed per-board GPT, A/B read-only
rootfs, separate META/STATE/EPHEMERAL/DATA tiers, DATA first-boot growth,
boot-time ext4 checks, bounded `/var` aging and periodic TRIM. It does not have
an operator-facing disk-management subsystem. There is no current capacity API,
media-health/wear state, DATA low-space policy, repair history, quota,
backup/restore, reset/wipe workflow, encryption decision or removable-media
contract.

## Proposal

- **SW:** add a read-mostly `StorageStatus` model for fixed tiers and physical
  media: identity, role, size, used/free/reserved space, mount/read-only/error
  state and last check/repair result.
- **SW/INT:** normalize available eMMC lifetime/EOL, NVMe SMART and SATA SMART
  signals by board/media, retaining raw evidence for support and clearly
  reporting unsupported metrics.
- **SW:** define warning/critical thresholds with hysteresis, protect bounded
  update workspace, and add per-application/container allocation or quota only
  where a product profile needs enforcement.
- **SW/DOC:** define offline filesystem repair and data-preserving replacement;
  publish versioned backup/export and restore contracts before claiming them.
- **OPS/SW:** make explicit product decisions for DATA/STATE encryption,
  device-bound keys, escrow/recovery, factory reset, secure erase and removable
  USB/SD trust/mount/eject behavior. Unselected features remain unsupported.
- **DOC:** explain the fixed layout and status/recovery operations; normal apid
  never exposes arbitrary repartition or format actions.

## Risks

- SMART/lifetime fields vary by device and can be absent or vendor-specific;
  normalized health must not fabricate precision.
- A full DATA tier can destabilize applications before update/recovery can run;
  reservation and alerting are P0 even if quotas are phased.
- Encryption or wipe promises without board key lifecycle and physical-media
  evidence are unsafe; those claims remain gated product decisions.

## Scope

In scope: fixed-tier/media inventory, current capacity, health/wear, thresholds,
repair evidence, space policy and explicit data-lifecycle decisions/docs. Out
of scope: a generic partition editor, LVM, RAID or storage pooling unless a
future SKU requires them.

## Alternatives

1. Call the existing GPT/growfs logic “disk management”. Rejected because it
   provides layout automation but no operator status or lifecycle operations.
2. Add a generic format/repartition API. Rejected because it undermines the A/B
   layout and enlarges the destructive remote surface.
3. Promise every media-health metric on every board. Rejected; availability is
   capability-reported and board-qualified.

## Annotations

- 2026-08-31: The user asked whether disk management exists. The precise answer
  is “storage layout foundation: yes; operator disk management: not yet”.
- 2026-09-01: Split from PLAN-037 as the fixed-storage lifecycle capability.
