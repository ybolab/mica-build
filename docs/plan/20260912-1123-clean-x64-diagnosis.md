# 20260912-1123-clean-x64-diagnosis Clean main x64 rebuild and diagnosis

- **status**: implementing
- **createdAt**: 2026-09-12 11:23
- **approvedAt**: 2026-09-12 11:23 (explicit user request)
- **relatedTask**: 20260912-1123-clean-x64-diagnosis

## Context

The user canceled handoff continuation. Current main includes uncommitted
resource-policy changes. Build the actual worktree and record its exact diff.

## Proposal

1. Clear old outputs, temporary worktree, dedicated cache and compiled images;
   remove handoff guidance. Verify absence without touching unrelated projects.
2. Rebuild pinned Docker toolchains and validate versions, without resource caps.
3. Build and validate x64 packages separately from rootfs composition.
4. With explicit signing inputs, build kernel/support, firmware and the complete
   image; verify layout, signatures, closure and tamper refusals.
5. Diagnose real QEMU startup, lifecycle, authenticated API and storage behavior.
   Preserve new failures and never equate source/build checks with runtime PASS.

## Risks

Signing identity requires selection. Dirty-source outputs must keep their actual
input identity. Automatic approval rejected recursive force removal; move old
filesystem outputs into a quarantine outside the project and never consume them.

## Scope

Current main x64 software and full-image diagnosis. No ARM/fleet/compatibility work.

## Alternatives

The user rejected continuation of the old migration candidate.

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
