# 20260912-2058-fit-sandbox-job-limit Remove the fixed make job count from the FIT sandbox build

- **status**: pending
- **priority**: P3
- **owner**: (unassigned)
- **createdAt**: 2026-09-12 20:58

## Description

`tests/file-ab-fit/Dockerfile.sandbox` builds U-Boot and its DTB with
`make -j8`, contradicting the project policy of no fixed build job limits.

Acceptance: the Dockerfile uses the tool default parallelism (or `nproc`) and
the FIT sandbox build still succeeds.

## ActiveForm

Removing the fixed FIT sandbox job count.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Created by 20260912-2049-docs-restructure from the 2026-09-12 plan and task audit.
