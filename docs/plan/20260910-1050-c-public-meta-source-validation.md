# 20260910-1050-c-public-meta-source-validation Validate public metadata before root staging

- **status**: implementing
- **createdAt**: 2026-09-10 10:50
- **approvedAt**: 2026-09-10 10:50
- **relatedTask**: 20260910-1050-c-public-meta-source-validation

## Context

The approved C1 classification maps PLAN-070 F3/F5 to this slice. At source commit `fa51970ca32c2a7d16f809134e78d249c0a1f897`, `rootfs/build.sh` checks only the required manifest for a small private-key pattern set, stages it, and conditionally stages a non-empty `GENERATED` marker. It does not reject extra source entries, inspect the marker, or validate the exact runtime schema. `BakedManifest` is the current runtime contract and rejects unknown fields.

The development evidence baseline remains `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`; this slice establishes content-equivalent source validation and does not claim a hardware-qualified build.

## Proposal

- Add `rootfs/scripts/validate-public-meta.sh` as the single narrow validator for the public-only input directory.
- Invoke that helper from `rootfs/build.sh` before copying any public metadata into the staging tree, then preserve 0644 output modes and the optional marker semantics.
- Add `build/src/public-meta.test.ts` fixtures that execute the actual helper and prove both rejection and acceptance behavior, including the required initial RED cases.

## Risks

- A schema mismatch could reject valid current metadata or admit a field the runtime does not understand; fixtures will mirror `meta.example` and exercise every nested object.
- Unsafe traversal could follow symlinks or ignore special files; validation will use an exact relative-path allowlist and inspect file types before reading.
- Error output could expose sensitive bytes; failures will identify only the path, key, and reason.

## Scope

Write only the approved public-meta block in `rootfs/build.sh`, the new validator and focused Bun test, plus this task/plan and their index rows. No compatibility logic, trust override, dependency, production endpoint, release-signing, verify-side, UI, root-composition, or hardware changes.

## Alternatives

Embedding the checks directly in `rootfs/build.sh` would duplicate fixture logic and make the real staging contract harder to exercise. A general scanner is intentionally rejected; this slice needs one exact two-file boundary.

## Annotations

- The campaign dispatch explicitly approved implementation and satisfies the PMA proposal gate.
- No compatibility or migration behavior is required.
- First repair retains this plan and its original evidence baseline. It adds raw-token object-member tracking before JSON decoding can discard duplicate keys, fatal UTF-8 decoding of the exact input bytes, and lexical ancestor checks before path normalization. The current schema, u64 range, public-file allowlist, private-material checks, and staging invocation remain unchanged. The detached repair RED was collected with 6 pass and 10 meaningful failures; GREEN and the existing suite diagnosis remain required.
- The repaired actual-helper suite passed all 61 tests with typecheck and a nonzero-test guard. Focused release diagnosis and an exact approved-upstream/current comparison demonstrate a separate linked-worktree Git metadata mount failure in `build/src/release-cli.ts:18-24`. That file remains outside this implementation grant; L2 has the concrete path handoff. This plan remains implementing until required acceptance is resolved, with no compatibility, staging-mode, or trust-boundary expansion.
- Reviewed C.D5 upstream `578bc651a4d2b3faaea21310105ec5aa931f784e` was merged at the clean checkpoint boundary, retaining all upstream tracking rows. The repaired helper/test bytes are unchanged by that merge, and the relevant existing image-resolution/path fixtures passed afterward. The remaining acceptance limitation is the separately demonstrated release source-identity failure, not a validator failure.
