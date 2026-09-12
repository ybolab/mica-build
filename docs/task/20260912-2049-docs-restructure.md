# 20260912-2049-docs-restructure Restructure the documentation system

- **status**: completed
- **priority**: P1
- **owner**: worker/docs-restructure-20260912-2049
- **createdAt**: 2026-09-12 20:49

## Description

Audit `docs/` for outdated and inconsistent content and restructure the
documentation system: tracking records, entry points, ownership boundaries,
stale engineering/user/website content, translations and documentation gates.
No backward compatibility is required for paths, names or record formats.

Acceptance: every retained document describes the current system under one
owner per fact; tracking indexes and records follow `/pma` formats; stale
records are closed or rewritten with changelog entries; `make docs-verify`
and `make docs-verify-test` pass with the gates extended to the tracking tree.

## ActiveForm

Restructuring the documentation system.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: 20260912-2049-docs-restructure.

- complete: make docs-verify gates pass except the concurrently edited split-package plan status; make docs-verify-test 8 suites pass; collector test passes.
