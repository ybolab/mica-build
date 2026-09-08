# RFCT-947 Integrate the S905X5M branch into updated local main

- **status**: completed
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

Local main fast-forwarded from 09c384cd22de to 3c5374f3f951, then integrated
adaptation tip 2e276018c1c7 with both histories retained. Four textual conflicts
were resolved. Additional integration fixes cover optional slot-specific boot
digests, S905X5M display/DRAM declarations, paths inside the extracted root and
display fixtures that exercise fresh slot reads.

Typechecks passed. The final runs passed 1,468 verifier tests and 171
boot/bundle/geometry unit tests, plus the package matrix (514 legal
resolutions), 155 container-network configuration assertions and all
documentation checks. Seven real-bundle tests were excluded because
packaging remains stopped. The apid source matches the previously tested
adaptation tip. See [PLAN-926](../plan/PLAN-926.md) for exact counts and scope.

Delivery is on local main only. The remote branches and running device were
not changed, and the unresolved hardware findings remain open.
