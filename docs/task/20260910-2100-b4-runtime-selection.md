# 20260910-2100-b4-runtime-selection Select explicit runtime payloads

- **status**: in_progress
- **priority**: P1
- **owner**: b4/a7z5l68m
- **createdAt**: 2026-09-10 21:00

## Description

Implement the approved B4 explicit runtime closure engine and fail-closed small
fixtures for campaign `mos-open-plans-20260910-100408`, L2 B `8t4ghqi6`.
Keep package selection and inventory authorities, feature-equivalent tools,
metadata and explicit non-ELF dependencies. Composition belongs to B5.

## ActiveForm

Implementing and verifying explicit runtime selection on offline fixtures.

## Dependencies

- **blocked by**: reviewed B3, integrated at `7508412cabddeea0ed2ac1fbba82a4ddd6ef9deb` (satisfied).
- **blocks**: B5 composition and B7 granted runtime acceptance.

## Notes

- Full tier; prior user approval explicitly covers implementation and scoped
  local commits. No additional approval gate. No compatibility or migration work.
- BKD confirmed this issue `a7z5l68m` working/running. Clean branch verified
  before the mandatory exact upstream merge `2af3a576219e051c7ad30f93746ec6aec370f161`.
  Resulting tree `2b7e004aca04423bc4098e7b2c4a9da2d9d98f50` equals the advertised tree;
  approved #313 and Git environment handoff ancestry verified.
- [Plan](../plan/20260910-2100-b4-runtime-selection.md). B0 source is
  [the committed audit](../plan/20260910-1013-b0-lifecycle-rootfs-audit.md), S3/S6.
- Tracking is file-based through the serializer. L2 D owns broad indexes and
  changelog reconciliation. Old residual task statuses are read-only.
- No expensive build grant; small fixtures and required gates only.

## Implementation progress

- Added an offline ELF/shebang runtime selector, 22 current consumer declarations,
  exact metadata/hardlink/xattr copying, per-file rootfs report provenance and
  verification of copied trees. No new package inventory or feature solver.
- RED was established before the selector existed. Additional actual mutation
  fixtures exposed ownership shrinkage, missing contributing copyright, loader
  precedence and intermediate symlink target loss; each now refuses correctly.
- 45 focused tests currently pass. Capability/ownership tests run for real;
  neither architecture nor metadata checks can silently skip.
- [B5 contract and residual map](../plan/20260910-2100-b4-runtime-selection.md)
  assigns each historical obligation and its separate runtime proof. L2 B owns
  coordination; B5 owns composition; B7 owns fresh runtime acceptance; D3 owns
  old-record reconciliation. Current implementation evidence is distinct from
  fresh first-boot, Quadlet, SSH-key/port and repeated-login evidence.
- No composition, lifecycle, public-meta/verifier, historical status, broad
  changelog or unrelated source was changed. No Bun/Rust/UI implementation;
  their stack implementation packs are not applicable.

## Local review

- pma-cr shared/Python self-review covered the complete new selector, declarations,
  fixtures, Makefile target and scoped tracking diff. No remaining high-confidence
  correctness finding in the bounded selector implementation (PASS).
- Review found a merged-usr search fallthrough defect; the new focused test first
  failed with `broken link for shared library libfirst.so: /lib/x86_64-linux-gnu/libfirst.so`,
  then passed after distinguishing an existing ancestor alias from a broken leaf.
- Current package composition, conditional generated-output completion and
  OCI/SquashFS transfers remain B5 acceptance, not tested production claims.
