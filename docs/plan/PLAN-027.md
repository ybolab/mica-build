# PLAN-027 The filed-task batch: seven standing tasks claimed and settled

- **status**: approved
- **createdAt**: 2026-08-28 19:45
- **approvedAt**: 2026-08-28 19:45
- **relatedTask**: claims RFCT-135, RFCT-216, RFCT-223, RFCT-224, RFCT-225, RFCT-226, RFCT-235; RFCT-253..255 reserved for discoveries
- **milestones**: M1 RFCT-135 re-verified against the PLAN-022 surface; M2 RFCT-216 root-rotation tooling; M3 RFCT-223 upstream-tag check; M4 RFCT-224 bus-writability class decision; M5 RFCT-225 image-freshness guard; M6 RFCT-226 the /var/log residue; M7 RFCT-235 the podman native base

## Context

Seven filed tasks are pending with no plan claiming them. Each task file
holds its own measurement and acceptance shape; this plan admits them into
one workstream and adds only ordering and the shared discipline. Milestone
order is by risk of staleness first (RFCT-135 may already be closed by
PLAN-022's typed network surface), then by deadline weight (RFCT-216 is P1
with a hard horizon), then the P2 set.

Every milestone starts by re-measuring its task file's stated facts at the
milestone's own HEAD — a filed measurement is not a measurement
(`docs/plan/PLAN-025.md` learned this; the rule is standing).

## Proposal

- **M1 (RFCT-135)** The network form accepted a VLAN interface name the
  settings path syntax then rejected. PLAN-022 shipped typed VLAN support;
  this may be fixed, half-fixed, or moved. Re-measure the exact reproduction
  in the task file; fix what remains or close the task with the dated
  verdict and the passing reproduction as evidence.
- **M2 (RFCT-216)** rauc-sign root-rotation tooling, deadline before the
  first ceremony's one-year expiry. The task file's acceptance stands:
  rotation produces a new root, cross-signs per the written ceremony, the
  verify path accepts both across the overlap window, and the procedure is
  documented as a runbook the next operator can follow without this
  campaign's context. Tests against throwaway keys; no real key material
  in the repo or the record.
- **M3 (RFCT-223)** A scheduled upstream-tag check for the container
  engine's six pins: a workflow that compares the pinned tags against
  upstream releases and opens a visible signal (failing scheduled job) when
  a pin falls behind. No auto-bump — the signal is the deliverable.
- **M4 (RFCT-224)** Decide and settle `container.enabled`'s bus
  writability for the class, not the one key: enumerate the settings keys
  whose bus-write answer diverges from the class rule, decide once, apply
  uniformly, record the decision in the settings design doc.
- **M5 (RFCT-225)** The image-freshness guard did not survive the verifier
  port and exists in no module today. Reinstate it in the TS verifier where
  the port dropped it, with the original failure mode as the RED test.
- **M6 (RFCT-226)** The /var/log package-manager residue is now
  load-bearing for the stage-order gate. Settle it per the task file:
  either the residue is removed and the gate re-grounded, or the dependency
  is documented as deliberate with the gate's reliance stated where the
  gate is defined.
- **M7 (RFCT-235)** `MOS_BUILD_BASE_NATIVE` for the podman build: the
  task file specifies the build-arg, the second OCI layout, and the bounded
  scope (wall 3 — real binfmt/hardware — is explicitly not this task).
  This plan admits `os/pkgs/podman/` for it. Prove with a real build on
  this host per the task file's acceptance; the amd64 control runs before
  any arm64 verdict is recorded.

## Risks

- RFCT-216 touches signing tooling; the milestone must never require or
  embed real key material, and the ceremony doc is the contract.
- RFCT-235 fights the measured host quirks (no binfmt, buildx builder
  under-reporting); the task file and the harness facts page carry the
  proven recipe — follow it, do not rediscover it.
- Seven milestones is wide for one workstream; they are independent, so
  the L2 runs them by its own capacity judgment, write scopes disjoint by
  construction (each milestone's files are its task's files).

## Scope

- **In**: the seven claimed tasks' stated scopes — `update/`-adjacent
  signing tooling per RFCT-216, `.github/workflows/` for RFCT-223, mosd
  settings/bus for RFCT-224, the TS verifier for RFCT-225, rootfs build
  stages for RFCT-226, `os/pkgs/podman/` + `os/build-env/` for RFCT-235,
  and whatever RFCT-135's re-measurement still implicates.
- **Out**: PLAN-026 and PLAN-028 scopes, any new feature surface, wall 3
  of the cx3576 chain (hardware/binfmt), auto-bumping pins.
