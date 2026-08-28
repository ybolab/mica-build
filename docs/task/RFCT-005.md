# RFCT-005 Port appliance feature set onto upstream v1.14.0-rc.1 base (rebase derivation)

- **status**: in progress
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-17 01:30
- **claimedAt**: 2026-08-17 01:30
- **completedAt**: -

## Description

Execute the derivation-strategy switch defined in PLAN-007: rebase the fork onto upstream
Talos v1.14.0-rc.1 (commit `be6b96386`) and re-apply the appliance feature set as additive
changes, instead of maintaining the Stage 1.x mass deletions (fork commits `5a435fe73`,
`53f0ded14`, `893f76f36`).

Scope:

1. Rebase the branch onto upstream base `be6b96386`.
2. Port `TypeAppliance` machine type + config validation (from Stage 1.0).
3. Port the webd skeleton, additively — apid stays present and buildable.
4. Port the rescue trigger: constants, sequencer rescue phase, imager ISO bits.
5. Add `TypeAppliance` gating so k8s, etcd, kubelet, cri, trustd, and dashboard do not run
   for appliance machines, reusing upstream's experimental k8s-less/etcd-less gating
   (upstream commit `9ffa772ba`) where it applies.

Out of scope: deleting any upstream code (k8s/etcd/apid/talosctl/trustd/dashboard all stay
in tree); Stage 2.0 upgrade-system work (PLAN-005/PLAN-006).

## ActiveForm

Porting appliance feature set onto the upstream v1.14.0-rc.1 base.

## Dependencies

- **blocked by**: (none — supersedes the RFCT-001..004 deletion lineage where they conflict)
- **blocks**: Stage 2.0 tasks (upgrade system)

## Notes

See [PLAN-007](../plan/PLAN-007.md) for the design and the disposition of PLAN-001..004.

Verification gates:

- `go build ./...` clean on the rebased tree.
- `go test ./pkg/machinery/...` green.
- apid and talosctl build unmodified; no k8s/etcd/kubelet/cri/trustd/dashboard runtime path
  for `TypeAppliance` machines.
