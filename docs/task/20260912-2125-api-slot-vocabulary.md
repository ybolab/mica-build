# 20260912-2125-api-slot-vocabulary Remove slot-era vocabulary from the update API contract

- **status**: pending
- **priority**: P3
- **owner**: (unassigned)
- **createdAt**: 2026-09-12 21:25

## Description

`pkgs/mosd/apid/src/update_api.rs` documents the update state as "per-slot
status, `booted_slot`, `primary`, `pending_not_confirmed` ... `last_mark`",
and that text is generated into `pkgs/mosd/apid/openapi.json`, while the
document mosd actually returns carries `boot`, `state`, `deployments`,
`rollback`, `install`, `last_action` and `lifecycle`. Other mosd/apid comments
and fixtures still use slot names.

Acceptance: the OpenAPI description matches the fields mosd returns; the
OpenAPI drift gate passes; no public API description uses slot vocabulary.

## ActiveForm

Aligning the update API contract with file deployments.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Found by 20260912-2049-docs-restructure; outside its documentation-only scope.
