# 20260910-1050-c-packed-public-meta-validation Validate packed public metadata independently

- **status**: completed
- **createdAt**: 2026-09-10 10:50
- **approvedAt**: 2026-09-10 10:50
- **relatedTask**: 20260910-1050-c-packed-public-meta-validation

## Context

The approved C1 classification maps PLAN-070 F4 to the unpacked-image verifier. C.D2 now validates metadata before staging, but packed-image proof must independently inspect the image root and cannot import, call, or trust that staging validator. The existing file-root verifier already owns storage, container, identity, health, and required-file checks; those behaviors must remain unchanged.

The current runtime contract is `BakedManifest`. The packed tree must contain a non-empty regular, non-symlink `updates/manifest.json` with its exact current schema and may contain a regular, non-symlink `GENERATED` marker. No other entry is permitted, and every permitted file's bytes must be scanned for private material. Successful evidence must include examined paths and meaningful nonzero file and byte counts.

The required local L2 baseline is `2ac2e661eb1ed1d728aeaa91bd1086599eeadc0a`, containing C.D2 final `e30aebf2086c41f4b3c255de95f74ffb52fa2c62`, approved source `5d0dca577a782aa707d9530779c4b23f2a7eda31`, reviewed classification `0f9b4e7e0e25c0ffad151db793a72479f55f96a0`, and original evidence baseline `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.

## Proposal

- Extend only `verify/src/checks-file-root.ts` with a narrow packed public metadata check rooted beneath the supplied unpacked image.
- Validate directory and entry types without following symlinks, enforce the two-file allowlist, scan every permitted file, and decode the required manifest with strict UTF-8, duplicate-member detection, exact field/type checks, and full unsigned 64-bit bounds.
- Extend only `verify/src/checks-file-root.test.ts` with focused current-schema positive and negative fixtures, including the required RED sentinel and path-escape cases, while retaining the existing trust/private/extra-file assertions.
- Record focused RED/GREEN, existing verifier suite, documentation, whitespace, and PMA-CR evidence without invoking expensive image or hardware gates.

## Risks

- Filesystem checks can accidentally follow a symlink outside the image; each path component and final entry must fail closed before bytes are read.
- Ordinary `JSON.parse` loses duplicate members and cannot preserve full `u64` precision; validation must reject duplicate decoded member names and validate integer tokens without lossy number conversion.
- Diagnostics could expose secret bytes; failures must name only the path, key, and refusal reason.
- A vacuous scan could claim success; success requires the manifest and nonzero scanned file/byte evidence.

## Scope

Write only `verify/src/checks-file-root.ts`, `verify/src/checks-file-root.test.ts`, this task/plan pair, and their own index rows. Do not edit shared helpers, other verifier checks, the source-staging validator, runtime configuration, fleet behavior, build composition, signing, UI, or changelog.

## Alternatives

Importing or invoking C.D2's staging validator is rejected because it would not independently prove packed-image contents. A general scanner abstraction is also rejected; the grant is for one exact metadata boundary in the existing file-root verifier.

## Annotations

- The campaign dependency-release dispatch explicitly approves implementation and satisfies the PMA proposal gate.
- No compatibility or migration behavior is required.
- Full-image, kernel, root, QEMU, and physical hardware qualification remain integration-owner responsibilities.
- Focused RED is established at source `2ac2e661eb1ed1d728aeaa91bd1086599eeadc0a`: the packed-root test diff `6c54279dcc5d036b3af2e9bcc17713e54b57711b8bf4b80fb49fe2db34419700` produced 44 meaningful failures and 12 controls passing. Evidence is retained under `/tmp/heobtbj3-public-meta-red.{json,log}`.
- Implementation commit `5389d6517d6519416590c0af9cdef506ce6a20c0` independently inspects the unpacked image and imports no source validator. At that exact clean source, focused verification passed 63 tests / 170 assertions and `make os-verify-test` passed typecheck plus 703 tests / 6714 assertions. PMA-CR review is PASS with no high-confidence findings. Completed tracking passed `make docs-verify` and scoped whitespace verification; exact evidence is recorded in the related task.
