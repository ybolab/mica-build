# FEAT-001 Build the update server and release console

- **status**: completed
- **priority**: P1
- **owner**: update-server/session-20260904
- **createdAt**: 2026-09-04 21:02

## Description

Implement the requested TypeScript and Bun update service in `update-server/`, with a simple Chinese administration console. Follow [PLAN-079](../plan/PLAN-079.md). No old TUF interface compatibility is required.

## ActiveForm

Implementing and verifying the update service and console.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- Authenticated draft creation, bounded streaming uploads, publication, withdrawal, metadata refresh and audit history.
- Persistent records and artifacts; signed expiring metadata; downloads with byte ranges.
- Responsive console with real API operations and clear empty/error states.
- Lint, strict type checking, tests with coverage, standalone build and browser verification.

## Notes

The user directly requested implementation. Scope is the new server; changing the OS client or baked trust anchors is separate work. Tracking is file-based.

- complete: Implemented the server and console. Lint, strict typecheck, 36 tests, coverage, executable build, browser flows and dependency audit passed; the OS reader remains outside this task.
