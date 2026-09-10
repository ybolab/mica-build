# 20260910-1050-c-public-meta-source-validation Validate public metadata before root staging

- **status**: completed
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
- L1 resolved that limitation with an exact four-file Git-environment grant: the source-identity function and its local integration fixtures, plus Toolbox read-only mount construction/options and real-container mount fixtures. No baseline waiver is selected. The implementation discovers actual gitfile/gitdir/commonDir locations, performs HEAD/dirty reads only in the existing pinned container route, and makes the checkout and necessary metadata mounts read-only. Canonical duplicates are combined, protected parent mounts cover descendants without writable remounts, and existing writable-only callers keep their original behavior. Tests use isolated Git fixtures and distinguish the linked HEAD from the common checkout HEAD; only fixture metadata receives deliberate write probes. This fix is committed independently from the public-meta repair within the same task.
- The independent Git repair is committed at `7319e2ecb305f3311601f2dd44cd47ce5a4a913f`. Its real-container RED/GREEN, original CLI/tamper assertions, and the 61-test public-meta regression are recorded in the task. Scoped source review passed; the one stable-source complete build suite remains the final acceptance gate, without a waiver or any kernel/root/QEMU/full-image build.
- Final acceptance is verified from the original, unrepeated `timeout 600s make os-build-test` execution at clean source `320b61152fbaafb09f80516e3bd83458f4ffd4e7`: start `2026-09-10T12:10:19Z`, PID `1286442` now absent, exit 0, 458 tests / 0 failures / 1277 assertions / 26 files. Exact evidence remains `/tmp/84wnkesf-repair-full-suite.json` and `.log`; the task retains all preceding failure, diagnosis, RED/GREEN, and shell/documentation evidence. L2 source review is PASS for both independent repair commits. The four-source diff SHA256 is `9151539598a1c66cfc8964d5425dbff24102a515da2976de76e82bf47d9748fd`; the focused wrapper's `7a04c0ae` hash additionally includes tracking changes.
- Collection turn 5 was interrupted, not a software gate failure. The authorized recovery at the `2026-09-10T19:02Z` boundary completes this same first repair through evidence collection and tracking only. Clean merge `737448a14fbb19c659821c82d162facec8f062f8` incorporates reviewed documentation-only LOCAL L2 `e03686e0a1225c5bb1d4a2a082ced4574d160af8`, preserving all other owners' rows and statuses. The seven implementation files remain byte-identical to the tested source. No implementation suite was repeated, no production source changed, and BKD remains in review rather than done. Completion establishes development source/container-fixture acceptance only, not hardware-qualified builds or publication.
