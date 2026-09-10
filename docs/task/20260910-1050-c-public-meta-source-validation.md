# 20260910-1050-c-public-meta-source-validation Validate public metadata before root staging

- **status**: in_progress
- **priority**: P1
- **owner**: worker-c/84wnkesf
- **createdAt**: 2026-09-10 10:50

## Description

Implement PLAN-070 F3/F5 current-contract refusals at the root build boundary. Validate the public metadata source before staging: accept only `updates/manifest.json` and optional `GENERATED`, require regular non-symlink files, reject private material in both permitted files, and validate the exact current baked-manifest schema without compatibility readers.

Acceptance requires focused RED/GREEN coverage through the validator invoked by `rootfs/build.sh`, shell syntax checks, documentation verification, and a scoped diff review. Hardware, kernel, QEMU, root composition, and full-image qualification remain out of scope.

## ActiveForm

Validating public metadata before root staging.

## Dependencies

- **blocked by**: 20260910-1012-c-config-update-obligations (BKD `kpuc7zcb`, completed and merged through `fa51970ca32c2a7d16f809134e78d249c0a1f897`)
- **blocks**: C.D3 packed-root public metadata validation

## Notes

- Campaign: `mos-open-plans-20260910-100408`, node C.D2, BKD issue `84wnkesf`.
- Evidence baseline remains `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.
- Current source commit after required local L2 sync: `fa51970ca32c2a7d16f809134e78d249c0a1f897`.
