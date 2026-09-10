# 20260910-1050-c-native-endpoint-verification Verify native binaries contain no default update endpoints

- **status**: implementing
- **createdAt**: 2026-09-10 10:50
- **approvedAt**: 2026-09-10 20:35
- **relatedTask**: 20260910-1050-c-native-endpoint-verification

## Context

C1 D4 identifies the missing native equivalent of PLAN-070 F8 and RFCT-315 F8. The approved local L2 baseline is 9f773a9cb1ad1bd882e2f11784288aea4a9e262f. C.D3's independent public metadata validator is reviewed and preserved. ROOT_CHECKS already reaches packed-root verification, but currently has no compiled endpoint check. The current first-party inputs are /usr/bin/mosd, /usr/bin/apid, and /usr/bin/mos-deploy.

## Proposal

1. Add behavioral fixtures through the new ROOT_CHECKS entry: all three clean ELF inputs, endpoint-bearing ELF versus identical configured metadata URL, missing/empty/non-ELF/symlink inputs, and exact scan evidence. Verify RED before implementing.
2. Add the native endpoint check only in checks-file-root.ts. Validate input paths and ELF bytes, inspect all three binaries, and produce path-specific diagnostics without byte dumps. Verify GREEN through the same registry entry.
3. Review the scoped diff for endpoint exclusions and image-root resolution; run the focused verifier test, make os-verify-test, make docs-verify, and scoped git diff --check. Record exact commit/log/process/time/exit evidence. Distinguish fixtures from immutable packed-artifact evidence supplied by L2.

## Risks

- Broad URL exclusions can hide defaults; any exclusion must match a complete literal backed by current binary or embedded-source evidence, with a minimally changed negative control.
- Symlink traversal or absent inputs can fabricate success; refuse unsafe inputs before reading and require all three paths with nonzero file and byte counts.
- Embedded frontend namespaces and API documentation are not necessarily network defaults; classification requires exact current evidence, without domain-wide exemptions.

## Scope

Write only verify/src/checks-file-root.ts, verify/src/checks-file-root.test.ts, this task/plan pair, and their own index rows. Preserve public metadata, other root policy checks, historical classifications, runtime defaults, fixed trust, UI, and sibling records. No compatibility, third-party scan, retired updater restoration, network activation, full-image/kernel/root/QEMU build, or hardware qualification.

## Alternatives

No generic scanner helper is authorized. Keep the bounded check in the existing module; request missing immutable artifact evidence through L2 rather than rebuilding or guessing exclusions.

## Annotations

- The dependency-release amendment authorizes implementation now and satisfies the PMA proposal gate.
- Baked fleet remains off/null on this baseline. The reviewed protocol design adds no compiled endpoint or runtime. The separate offline fleet configuration slice is not merged and is not claimed here.
- L2 D owns global history; provide an English history note at handoff without editing changelog.

- Fixture implementation at 197e1e53f92e525f6284dc262698733d21c9f679 passes 109 focused tests and 749 verifier tests including typecheck; documentation verification passes. PMA-CR scoped review is PASS with zero high-confidence findings. No literal exclusion is inferred. This plan remains implementing until L2 supplies immutable current native inputs and exact embedded-source evidence for any required non-endpoint classification.

- Later clean-boundary sync: 0a8aa6e840bf455fd8cb088ab1e205b9f0e1e6f0 was merged as 3d6e55e38db3789b88ec5642bdd593aab8208d10 with only index append conflicts. The current source baseline now includes the approved offline fleet desired projection; original 9f773a9c evidence remains historical and accurate. Native verifier source bytes did not change across this merge.
