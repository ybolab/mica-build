# 20260912-1113-remove-build-resource-limits Remove build resource limits

- **status**: completed
- **createdAt**: 2026-09-12 11:13
- **approvedAt**: 2026-09-12 11:13 (explicit user request following investigation)
- **relatedTask**: 20260912-1113-remove-build-resource-limits

## Context

The deploy package builder and boot/shutdown fixture runner explicitly set 4 CPUs, 10 GiB memory, no swap and four Cargo jobs. Other build entry points do not impose these fixed limits. Historical B7 plans and the handoff retain task-specific quotas.

## Proposal

Remove the Docker resource flags and CARGO_BUILD_JOBS overrides from both scripts. Record the current unlimited build policy in AGENTS.md and the handoff, explicitly superseding historical quotas without rewriting execution evidence.

## Risks

Builds may consume more host resources; this is the requested behavior. Existing external host limits still apply.

## Scope

Two shell scripts, project instructions, the handoff and required tracking.

## Alternatives

A configurable fixed ceiling is unnecessary for the requested default behavior.

## Validation

Run bash syntax checks, inspect the diff and search executable sources for remaining resource flags; run make docs-verify. No full system rebuild is required for removing launch options.

## Results

Both shell syntax checks and git diff --check passed. make docs-verify passed all five checks (195 index, 541 links, 726 status, 249 translation coverage and 131 board assertions). Source search found no remaining fixed build resource flags; the remaining zstd memory option belongs to runtime decompression and is outside build scope. Local diff review found no issues. No full rebuild was run.
