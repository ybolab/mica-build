# RFCT-285 Add storage status and data lifecycle management

- **status**: completed
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-049](../plan/PLAN-049.md)

## Description

Add operator visibility and safe lifecycle policy to the existing fixed GPT,
tiered filesystems, DATA growth and TRIM foundation.

## Acceptance

- StorageStatus reports each fixed tier and physical medium, current space,
  mount/error state and check/repair evidence.
- Available eMMC/NVMe/SATA health signals are normalized per board without
  inventing unsupported metrics.
- Low-space thresholds, hysteresis and reserved update workspace are enforced.
- Backup/restore, repair, reset/wipe, replacement, encryption and removable-
  media choices are explicitly supported or explicitly unsupported.
- Normal apid exposes no generic format or repartition action.

## ActiveForm

Adding fixed-tier storage status and lifecycle management.

## Dependencies

- **blocked by**: explicit approval of PLAN-049; media access for board validation
- **blocks**: update-space guarantees, recovery semantics and storage troubleshooting

## Notes

- Current answer: layout automation exists; operator-facing disk management does
  not yet exist.

## Completion (2026-09-02)

Design record: docs/design/storage.md.

Acceptance, item by item:

- **StorageStatus per tier and medium.** `pkgs/mosd/mosd/src/storage_status.rs`
  reports every fixed tier of `boards/*/board.env` — the A/B rootfs slots,
  `esp`/`boot-a`/`boot-b`, META, STATE, EPHEMERAL and DATA — with identity
  (label, role, device), partition size, mount/read-only state, space
  (total/used/free and the filesystem's own reserved pool as a separate
  number) and the last check systemd recorded. A tier absent on a board is
  reported `present: false` with the reason rather than omitted, and the
  booted rootfs slot resolves through its verity mapper so it reports as
  mounted at `/` instead of unmounted.
- **Media health normalized, unsupported reported.** eMMC lifetime/EOL comes
  from `/sys/block/*/device/{life_time,pre_eol_info}` and is reported as the
  10% JEDEC bucket it is (`usedPercentMin`/`usedPercentMax`), never as a
  single fabricated percentage, with the raw registers retained beside it.
  NVMe/SATA SMART reports `supported: false` with the reason — this image
  ships no `smartctl` or `nvme-cli` — because an empty health object reads as
  healthy.
- **Low-space thresholds, hysteresis and the reserved workspace.** 80/75 and
  90/85 percent enter/clear bands over DATA and STATE (base policy constants,
  not user settings), and a 256 MiB reserved update workspace ENFORCED at
  `MosdService::request_install` — the one seam where mos consumes DATA space
  for an update — before the in-flight flag is taken or RAUC is touched. A
  bundle already staged under the DATA mount counts back towards the floor;
  absent evidence never refuses. No quota system was added; PLAN-049 gates
  quotas behind a product profile and none exists.
- **Lifecycle decisions explicit.** Backup/restore, offline repair,
  data-preserving replacement, factory reset/wipe, secure erase, encryption
  and removable media are each answered in the status body under `lifecycle`
  and each is `unsupported`, with the reason for each recorded in
  docs/design/storage.md §6. None is implemented, partially or behind a flag.
- **No generic format or repartition action.**
  `normal_apid_exposes_no_format_or_repartition_action` scans the generated
  OpenAPI document (pinned elsewhere to exactly what the handlers produce)
  for the forbidden vocabulary and probes the paths a client would guess,
  asserting the search space is populated first so the scan cannot pass
  vacuously.
- **apid and UI.** `GET /api/v1/storage/status` (authenticated, GET-only,
  documented in `openapi.json`) plus a `/storage` console page following the
  existing i18n page conventions, in English and Simplified Chinese.

**Per-board physical-media validation — NOT done.** The eMMC path is
exercised against fixture sysfs trees, not against a real eMMC's wear
registers on a bench board, and the NVMe/SATA path reports `unsupported` with
no device to validate against. That validation is hardware-dependent; it is
escalated by the coordinating workstream and remains open. This record does
not claim it.

## Completion addendum (2026-09-02): reworked onto the PLAN-063 layout

The record above was written against the layout that mounted DATA at `/srv`.
PLAN-063 / RFCT-292 replaced it while this work was in flight, and the
storage surface was reworked onto it rather than left describing a layout the
image no longer has. What changed, and what that means for the acceptance
bullets:

- **The DATA tier now reports `/mnt/data`**, and `/mos` and `/srv` are
  reported as its two bind namespaces under a `namespaces` member, each with
  its source path, mount state and whether the mount resolves to the DATA
  partition. Because they are one filesystem, they carry **no capacity of
  their own**: the bytes are reported once on the `data` tier, the shared pool
  is named in the body, and a test asserts no bind ever grows a `space` field.
  That is PLAN-063's own risk 3 ("`/mos` and `/srv` share one filesystem and
  capacity pool") answered in the shape rather than in prose.
- **Readiness is PLAN-061's contract, and RFCT-285 no longer re-implements
  it.** `mos-data-layout` is the fail-closed initializer and `mos.mount` /
  `srv.mount` are the ordering, so what this task adds is the *report*:
  mounted, source-resolves-to-DATA, source-is-a-real-directory (not a symlink
  substitution), read-only state, free space, and the create/fsync/remove/fsync
  probe under `/mos/updates/staging`. Not mounted, and mounted-from-something-
  that-is-not-DATA, are both `unavailable` rather than `degraded`, which is the
  PLAN-061 no-fallback rule stated where a caller can read it.
- **The reserved update workspace re-targets to `/mos/updates`** (PLAN-061's
  `downloads`/`verified`/`staging` taxonomy, which PLAN-063 keeps). The
  admission check in `request_install` tests that path rather than "is the
  bundle on the DATA filesystem" — under the new layout that weaker question
  would be true of a file in the operator's home directory. Thresholds and
  hysteresis apply to the DATA filesystem as one pool, plus STATE, unchanged.
- **The probe is the only write in the module**, it happens in the
  system-owned namespace only, and it is removed whether or not it succeeded.
  `/srv` is never probed: `mos-data-layout`'s ownership table gives mosd no
  subtree of the user namespace, so the probe reports `notAttempted` with that
  reason and never a pass.

Escalations are unchanged: per-board physical-media validation on real
eMMC/NVMe bench hardware is still NOT done and still escalated.
