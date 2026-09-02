# PLAN-049 Add storage status and data lifecycle management

- **status**: completed
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

## Completion (2026-09-02)

Delivered as RFCT-285. Design record: docs/design/storage.md.

- **Read-mostly StorageStatus** (`pkgs/mosd/mosd/src/storage_status.rs`): the
  fixed tiers from `boards/*/board.env` with identity, role, size,
  used/free/reserved space, mount/read-only state and the fsck evidence
  systemd actually records; the physical media beneath them. Served as
  `GetStorageStatus` on the bus and `GET /api/v1/storage/status` over HTTPS,
  with a `/storage` console page. Observed at call time, never cached, and
  with no write counterpart anywhere.
- **Media health, risk #1 respected**: eMMC lifetime/EOL normalized from the
  JEDEC sysfs registers as a 10% bucket with the raw values retained;
  NVMe/SATA SMART reported `unsupported` with the reason (no reader ships in
  this image) rather than as an empty object that reads as healthy. Absence
  is data everywhere on this surface — the one deliberate inversion is the
  install admission check, which refuses nothing on evidence it does not have.
- **Space policy**: 80/75 and 90/85 percent enter/clear hysteresis bands over
  DATA and STATE as base policy constants; a 256 MiB reserved update
  workspace exposed in status AND enforced at `request_install`, the one seam
  where mos consumes DATA space for an update. **No quotas**: this plan gates
  them behind a product profile needing enforcement, and none does.
- **Lifecycle decisions**: backup/restore, offline repair, data-preserving
  replacement, factory reset/wipe, secure erase, encryption and removable
  media are each explicitly `unsupported`, served in the API's `lifecycle`
  object and justified one by one in docs/design/storage.md §6 —
  "Unselected features remain unsupported", stated rather than implied.
- **No repartition surface**: asserted by a route-surface scan over the
  generated OpenAPI document plus probes of the paths a client would guess.

**Not done, and escalated**: per-board physical-media validation on real
eMMC/NVMe bench hardware. The wear path is covered by fixture-tree tests
only, which is a test of the parser and the assembly, not of a device.

## Completion addendum (2026-09-02): reworked onto the PLAN-063 layout

Delivered against the layout PLAN-063 / RFCT-292 established while this work
was in flight, not the one that mounted DATA at `/srv`.

- DATA reports at `/mnt/data`; `/mos` and `/srv` are reported as bind
  namespaces of it, with **one shared capacity pool reported once** on the
  `data` tier. This is PLAN-063 risk 3 discharged in the status shape, and
  PLAN-063's note that "quota and reservation work remains owned by PLAN-049"
  is what this plan answers.
- Readiness for `/mos` follows PLAN-061's contract verbatim — mount, source
  resolves to DATA, no symlink substitution, read-only state, free space, and
  a create/fsync/remove/fsync probe in the owned subtree. **RFCT-285 does not
  re-implement the layout**: `mos-data-layout` initializes it fail-closed and
  the two mount units order it; this plan reports on it and names the
  no-fallback states (`unavailable`) that PLAN-061 requires.
- The reservation targets `/mos/updates`, PLAN-061's artifact taxonomy.
- Still not done and still escalated: per-board physical-media validation on
  real eMMC/NVMe bench hardware.
