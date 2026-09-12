# 20260912-1123-clean-x64-diagnosis Clean main x64 rebuild and diagnosis

- **status**: in_progress
- **priority**: P1
- **owner**: worker/x64-clean-20260912-1123
- **createdAt**: 2026-09-12 11:23

## Description

Clear previous MOS build and handoff state. Rebuild the complete current main
x64 system and diagnose actual startup. Preserve current source edits.

## ActiveForm

Cleaning previous state and rebuilding pinned Docker tools.

## Dependencies

- **blocked by**: signing identity selection before kernel/signing stages
- **blocks**: complete x64 runtime qualification

## Notes

Full tier. User explicitly authorized cleanup and full rebuild. No fixed
resource quotas, handoff reuse, parallel agents, new campaign, commit or push.
SYSTEM remains 1 GiB and current signing/auth/storage/watchdog contracts apply.

## Preparation result — 2026-09-12

The old MOS private daemon, cache volume and compiled images were removed.
Old filesystem outputs and the temporary worktree were moved to
`/srv/ybolab/mos-discarded-20260912-1123/` after automatic approval rejected
force deletion; they are not build inputs. The handoff file was removed from
the documentation entry points; B7 now carries only closure notices.

All seven amd64 builder images were rebuilt using current main, pinned inputs,
no cached build layers and no fixed resource quotas. Builder floor/version and
linking probes passed. Docker documentation checks, shell syntax and whitespace
checks passed; local review found no new high-confidence issue. Execution
evidence is in `_out/clean-x64/`. No product binaries or image have yet been
built in this clean run. The package runner is prepared but refuses a dirty
main. Local commit authorization and the new development signing identity
selection have been requested; no commit, key generation or push was performed.

## Approved key initialization addition — 2026-09-12 11:29 UTC

The user authorized new development keys in `meta/`, an idempotent one-command
initializer using the existing RSA boot/content and Ed25519 metadata generator,
and local commits. Add `os-keys-init`; validate existing material without
rotation and refuse partial, mismatched or symlinked inputs. Use the existing
public-only root configuration input separately. Exercise fresh/repeated and
refusal cases through Docker before generating the actual identity and committing.
This is part of the approved clean x64 build task; no new campaign is created.

## Key initialization verified — 2026-09-12 11:33 UTC

Added `make os-keys-init` using the existing development generator and pinned
OpenSSL container. Fresh and empty directories are initialized; existing
identities are validated read-only. Tests cover repeat stability, two concurrent
callers, missing certificate, mismatched certificate, symlink and private-file
permission refusals. Original RED (missing initializer, exit 127) and final
GREEN logs are retained in `_out/clean-x64/`. Documentation, shell syntax,
whitespace and host-toolchain policy checks passed. Local review found no
high-confidence issue. New development boot/content/metadata keys were created
and verified in ignored `meta/`; no private material is staged. The user
authorized local commits. Freeze the resulting clean main commit for production
and keep runtime progress in ignored evidence until the next source boundary.
