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

## Corrective review round 1

- L2 authorized this bounded corrective round on the existing task, with at
  most two total corrective rounds. Source is clean
  `87b2c833be8a514b4e8eff7fa622dc0ef767c897`; approved upstream ancestry remains
  satisfied. No new merge, task, policy change or resource grant is needed.
- L2's independent review supersedes the initial self-review verdict: R1 found
  that declared runtime links could be replaced by files/directories; R2 found
  that a missing required package ownership list could silently shrink a
  multi-package root rule. Both require new RED fixtures and minimal fixes.
- Plan: enforce runtime-link contracts on canonical paths regardless of observed
  type; require one native ownership capture per selected/rule-required package;
  verify valid symlinks, complete captures, filtering and architecture aliases.
- Previous detached gates all ended. Aggregate exit code is 1, metadata
  `/tmp/mos-b4-gates-XP9wpM/metadata.json`, SHA-256
  `98093a59475c6ad2cc4b0629a1be253dc8466521d93170f198b0451948206bdb`.
  Runtime 45, manifest 46 (22 reachable, 257 resolutions, 6 refusals), Debian
  54 plus lock, host-toolchain, docs and diff gates exited 0. Shell lint exited
  2 solely for the accepted baseline below. Do not retry or edit UI to hide it.

```text
FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'
make: *** [Makefile:350: os-shell-pipefail-lint] Error 1
```

- The shell lint result is 158/159; its original full log and SHA-256 remain
  retained with the original aggregate failure. No gate remains detached.

### Corrective implementation and verification

- R1: every active runtime-link declaration is a required root keyed by the
  canonical installed path. Selection checks the actual symlink type, exact
  target and producer resources before normal resource handling. Duplicate
  canonical aliases fail. No service, SSH or accounting policy changed.
- R2: native ownership capture names are unique per installed package. Each
  selected consumer and every package referenced by an active root rule needs
  its own list before package-scoped matching. Unrequired installed packages
  remain filtered; native `name:architecture.list` handling is preserved.
- Corrective RED: `timeout 120 bash tests/rootfs-runtime-test.sh`, unchanged
  committed selector plus eight new fixture methods, exited 1 (53 tests,
  10 failures). `/tmp/mos-b4-r1-eg4pye25/red-metadata.json` records the exact
  source and file hashes; `red.log` SHA-256 is
  `7b20051f9c116dfda2224375ebae3ab68b00ce4f3ea2611749d0286df64e8037`.
- Corrective GREEN: the same command exited 0 (53 tests, no skips), with the
  same fixture SHA-256. `/tmp/mos-b4-r1-eg4pye25/green-metadata.json` records
  worktree source identities; `green.log` SHA-256 is
  `c1abd55dc3307ae38e615ad0b25761934d9a3625d5d7429246481ad6f49f8c2b`.
- pma-cr shared/Python local diff review covered ownership ingestion, selected
  consumer validation, canonical link registration, root matching, recursive
  retention, publication and all new fixtures. R1/R2 are addressed by real
  filesystem mutations; valid controls preserve metadata and selection filtering.
  No new high-confidence finding remains in this corrective diff. Composition
  and fresh runtime behavior are still outside this review.

### Corrective review summary

| Severity | Count | Status |
| --- | --- | --- |
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: PASS for the bounded corrective diff. Original gate aggregate remains
failed with the accepted shell baseline; this verdict does not turn it green.
