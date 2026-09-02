# RFCT-291 Establish the `/mos` persistent system namespace

- **status**: completed
- **priority**: P0
- **owner**: codex/mos-data-namespace-20260902
- **createdAt**: 2026-09-02 00:25

## Description

Make `/mos` the canonical root for large, persistent, system-managed artifacts
on the growable DATA tier, while moving `/srv` toward a user-owned namespace.
Use a staged layout migration that preserves A/B rollback compatibility instead
of changing the DATA mountpoint in one irreversible step.

## Acceptance

- The path taxonomy distinguishes immutable `/usr/lib/mos`, configuration
  `/etc/mos`, runtime `/run/mos`, bounded critical STATE at `/var/lib/mos`,
  large system artifacts under `/mos`, and user-managed data under `/srv`.
- `/mos/ui`, `/mos/updates`, `/mos/apps`, `/mos/containers` and persistent home
  backing are on DATA, are created with explicit ownership/modes, and have
  subsystem-local staging/cleanup policies.
- `/mos` is mounted and positively checked writable before APID, the future
  online updater, application acquisition or any other system artifact writer
  starts; a read-only or exhausted DATA tier fails those writers with a named
  degraded state rather than falling back to rootfs, STATE or `/tmp`.
- The first migration phase provides canonical `/mos` paths while legacy A/B
  slots can still resolve their former `/srv/...` system paths.
- The clean Phase-B split is documented but remains disabled until both slots
  prove the layout capability, or a factory/reflash migration is selected.
- Fresh DATA, legacy-tree migration, repeated execution, collisions and hostile
  symlink substitutions have automated acceptance coverage.
- Rootfs composition, systemd ordering, fstab generation, both board layouts,
  verifier rules and current architecture/user documentation agree.

## ActiveForm

Establishing the `/mos` persistent system namespace.

## Dependencies

- **satisfied by**: approved rollback-compatible Phase A
- **follow-up**: capability-gated Phase B in [PLAN-061](../plan/PLAN-061.md)
- **unblocked**: [UI-007](UI-007.md), canonical update-download and application artifact paths
- **plan**: [PLAN-061](../plan/PLAN-061.md)

## Notes

- 2026-09-02: Classified as a Full task because DATA currently mounts directly
  at `/srv`; container storage, custom UI data, `/home` and `/root` backing,
  image assembly and verifier rules all encode that contract.
- 2026-09-02: Investigation found that an immediate DATA remount at `/mos`
  would change what an old A/B slot sees after rollback. PLAN-061 therefore
  recommends a compatibility bind phase before the clean namespace split.
- 2026-09-02: The user clarified that future online update and related product
  features require a guaranteed writable system path. `/mos` is now explicitly
  the writable DATA-tier contract, not merely a naming cleanup.
- 2026-09-02: User approved PLAN-061's staged default: implement compatibility
  Phase A now and keep the clean Phase B split capability-gated.

- complete: Phase A delivered; Phase B remains capability-gated by PLAN-061.
