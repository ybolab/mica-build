# 20260910-0726-unlimited-application-data Remove system, user and container data limits

- **status**: completed
- **priority**: P1
- **owner**: worker/unlimited-data-20260910
- **createdAt**: 2026-09-10 07:26
- **relatedPlan**: [20260910-0726-unlimited-application-data](../plan/20260910-0726-unlimited-application-data.md)

## Description

Apply the user's explicit quota correction: /mos, /srv and container storage
have unlimited byte/inode quotas. Keep separate directory mounts and project
accounting, and retain the bounded /var project. No compatibility or migration.

## ActiveForm

Completed unlimited application data policy and focused verification.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

User authorization specifies the exact change. Preserve concurrent UI/BSP work.
Verify only affected policy and runtime behavior; this request does not require
rebuilding kernels, all architecture roots or a complete flash image.

## Implementation and verification

- Projects 100 (/mos and /srv) and 102 (containers) now have zero soft/hard
  byte and inode limits. Project inheritance, usage reporting and private mounts
  remain. Project 101 retains its existing bounded /var/cache/tmp policy.
- Removed proportional application/container budgets, aggregate reserve assertions
  and obsolete runtime container-exhaustion checks. Current docs and API detail
  explain that unlimited writers can consume all available DATA.
- RED: the updated layout test failed with `system/user data must be unlimited`.
  GREEN: the layout suite passes on small and large filesystem fixtures.
- Real ext4 check uses the existing production x64 root tools on a new 512 MiB
  filesystem. Writers without CAP_SYS_RESOURCE write 96 MiB each to /mos and
  /srv, and 384 MiB to containers, exceeding the previous project limits.
  Project 100/102 reports have zero byte and inode limits. /var still returns
  EDQUOT at its own limit while all three unlimited namespaces remain writable.
- Evidence: `.tmp/unlimited-data/{red,layout,ext4,rust}.log` and `quota.csv`.
- Review is scoped to the quota policy and its direct assertions/documentation.
  Previous BSP, mount propagation, console and signed-image acceptance remain
  historical evidence; no new kernel or flash image is built for this correction.
- The delivered `mos-cx3576-20260910-072131.img` retains the earlier bounded
  policy. This source correction takes effect in the next complete image build.

## Previous task duration

The previous storage/display task ran approximately 06:16–07:23 UTC. It included
BSP kernel compilation, three architecture/board root builds, two signed boots
per x64/ARM64, nine interrupted-reset boots, keyboard-console acceptance, full
image assembly and 125 offline checks. Mount propagation broke reset and caused
another root build/acceptance cycle. Repeated build work increased elapsed time.
This correction uses focused policy and real filesystem verification instead.

- Final gates: storage observer tests, fmt/clippy, layout/var seeding, host-toolchain
  and pipefail checks pass. No unresolved source-review findings.

- complete: Removed application/container limits; focused filesystem and source gates passed.
