# RFCT-947 Integrate the S905X5M branch into updated local main

- **status**: in_progress
- **priority**: P1
- **owner**: miehq
- **createdAt**: 2026-09-08 10:00 UTC
- **relatedPlan**: PLAN-926

## Scope

Update local main to origin/main, then merge board/s905x5m-mainline with
both histories retained. The user explicitly clarified this direction.
No remote main push, package/image build or device update is included.

## Acceptance

- Updated upstream and the adaptation tip are both ancestors of local main.
- Conflict resolutions preserve both board families' boot contracts.
- S905X5M satisfies the new shared metadata and source-check contracts.
- Relevant build-driver, verifier and documentation checks pass.
- Hardware gaps in RFCT-944/RFCT-945 remain accurately recorded.

## Evidence

Local main fast-forwarded from 09c384cd22de to 3c5374f3f951.
Implementation and checks follow [PLAN-926](../plan/PLAN-926.md).
