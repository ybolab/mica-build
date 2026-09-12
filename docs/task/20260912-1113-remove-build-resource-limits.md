# 20260912-1113-remove-build-resource-limits Remove build resource limits

- **status**: completed
- **priority**: P1
- **owner**: worker/build-limits-20260912-1113
- **createdAt**: 2026-09-12 11:13

## Description

Remove fixed build CPU, memory, swap and compiler job limits at the user's explicit request. Supersede historical task quotas with the current project policy.

## ActiveForm

Removing build resource limits and verifying scripts.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Full tier: two shell entry points and project documentation. Approval was granted by the user after the resource-limit investigation. Tracking is file-only. Existing B7 edits belong to another task and will be preserved.

- complete: Shell syntax, resource-flag search, local diff review and make docs-verify passed.
