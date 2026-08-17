# PLAN-007 Derivation strategy switch - rebase onto upstream v1.14.0-rc.1 with k8s-less gating instead of deletions

- **status**: implementing
- **createdAt**: 2026-08-17 01:30
- **approvedAt**: 2026-08-17 01:30
- **completedAt**: -
- **relatedTask**: RFCT-005
- **supersedes**: PLAN-001..PLAN-004 deletion-based stages, where they conflict (see Context)

## Context

Stages 1.0-1.3 derived the appliance from Talos by **hard deletion**: fork commits
`5a435fe73` (delete runtime Kubernetes, etcd, cluster orchestration code), `53f0ded14`
(retire apid/trustd/talosctl, introduce webd skeleton and rescue trigger), and `893f76f36`
(clean Makefile/Dockerfile of talosctl and integration plumbing) removed
k8s/etcd/apid/trustd/talosctl/dashboard code outright.

That derivation has a structural cost: every upstream Talos release forces us to re-resolve
conflicts across thousands of deleted lines, and the deletions themselves diverge us from
upstream fixes in adjacent code. Meanwhile upstream has landed **experimental k8s-less /
etcd-less gating** (upstream commit `9ffa772ba`), which makes the control-plane stack
conditional at runtime rather than assuming it exists — exactly the mechanism our deletions
were approximating.

This plan switches the derivation strategy:

- The fork **rebases onto the upstream v1.14.0-rc.1 base** (commit `be6b96386`).
- Instead of deleting k8s/etcd/management code, we **port our appliance features onto the
  intact upstream tree** and rely on upstream's k8s-less/etcd-less gating plus our own
  `TypeAppliance` gating to keep unwanted subsystems from running.
- Future upstream rebases become a port of a small additive feature set, not a re-execution
  of mass deletions.

Where PLAN-001..PLAN-004's deletion-based stages conflict with this plan, **this plan
supersedes them**. Their functional goals (appliance machine type, webd, rescue,
no k8s at runtime) remain valid and are carried forward below; their "delete the code"
implementation strategy is abandoned.

## Proposal

### What gets ported onto the new base

1. **TypeAppliance machine type + validation** — the `machine.type: appliance` value in
   `pkg/machinery`, its parsing/String round-trip, and config validation rules (no
   `cluster:` section required, appliance-specific constraints), as introduced in Stage 1.0.
2. **webd skeleton** — the appliance web management service. Ported **additively**: webd
   comes up for appliance machines, but **apid stays**; webd no longer replaces the
   upstream management API.
3. **Rescue trigger** — the `talos.rescue=1` constants, the sequencer rescue phase, and the
   imager ISO bits that wire an alternate rescue boot entry.
4. **TypeAppliance gating** — sequencer/service gating so that for appliance machines
   **k8s, etcd, kubelet, cri, trustd, and dashboard do not run**. Built on top of upstream's
   experimental k8s-less/etcd-less gating (`9ffa772ba`) where it applies; our own
   machine-type checks cover the rest (trustd, dashboard, cri/kubelet startup).

### What is retained from upstream (no longer deleted)

- **apid and talosctl stay present and buildable.** The upstream-maintained management API
  and CLI remain the supported management path alongside webd; we stop carrying the cost of
  maintaining their removal.
- **trustd and dashboard code stays in tree** but is gated: neither may run for
  `TypeAppliance` machines.
- Kubernetes/etcd/cluster packages stay in tree and buildable; they are inert for appliance
  machines via gating.

### Relationship to earlier plans

| Plan | Disposition |
|---|---|
| PLAN-001 (introduce TypeAppliance, gate k8s) | Goals carried forward; port item 1 and 4 |
| PLAN-002 (delete k8s/etcd/cluster code) | Superseded — code is retained and gated instead |
| PLAN-003 (retire apid/trustd/talosctl, webd + rescue) | Partially superseded — webd and rescue carried forward (items 2, 3); apid/talosctl retirement abandoned |
| PLAN-004 (build pipeline repair after deletions) | Superseded — upstream build pipeline is kept intact |
| PLAN-005 / PLAN-006 (Stage 2.0 upgrade system) | Unaffected; they build on whichever base is current |

### Decisions

- **CRI**: the CRI service is gated off in code for `TypeAppliance` —
  `cri.ServiceController` skips starting the `cri` service when the machine type is
  appliance (kubelet already stays idle without k8s config documents).
- **Dashboard**: dashboard cannot be machine-type gated in code — it starts in the
  Initialize sequence before machine config is loaded. It is disabled per-image instead,
  by baking the `talos.dashboard.disabled` kernel cmdline parameter into the appliance
  image profile. The imager wiring for that cmdline belongs to a later board campaign,
  not this one.

## Implementation stages

1. Rebase the branch onto upstream `be6b96386` (v1.14.0-rc.1)
   -> verify: `git log` shows the upstream base; working tree clean.
2. Port TypeAppliance machine type + validation
   -> verify: `go build ./...`; `go test ./pkg/machinery/...` green.
3. Port webd skeleton (additive; apid untouched)
   -> verify: `go build ./...`; webd registers only for `TypeAppliance`.
4. Port rescue trigger (constants + sequencer rescue phase + imager ISO bits)
   -> verify: `go build ./...`; rescue phase present in the appliance sequence.
5. Implement TypeAppliance gating over k8s/etcd/kubelet/cri/trustd/dashboard, reusing
   upstream k8s-less/etcd-less gating where applicable
   -> verify: `go build ./...`; service/controller registration paths show no k8s, etcd,
   kubelet, cri, trustd, or dashboard startup for appliance machines.

## Acceptance criteria

1. The branch is based on upstream commit `be6b96386` with the appliance feature set applied
   as additive commits (no mass-deletion commits).
2. `go build ./...` is clean and `pkg/machinery` tests pass.
3. apid and talosctl build from the tree unmodified; trustd/dashboard code compiles but has
   no runtime path for `TypeAppliance` machines.
4. For a `TypeAppliance` machine, k8s, etcd, kubelet, cri, trustd, and dashboard do not run.

## Risks

- Upstream's k8s-less/etcd-less gating is **experimental**; its behavior may change in
  later upstream releases. Our TypeAppliance gating must not depend on its internals, only
  on its documented switch points.
- Retaining apid means the appliance now exposes the upstream management API surface; webd
  and apid coexist and their responsibilities must be kept distinct (webd = appliance UX,
  apid = upstream-compatible management).
- Gating-instead-of-deleting keeps dead-for-appliance code paths in the binary; image size
  and attack surface grow relative to the deletion approach. Accepted as the price of cheap
  upstream tracking; revisit if binary size becomes a hardware constraint.
- The rebase invalidates historical fork commits (`5a435fe73`, `53f0ded14`, `893f76f36`) as
  reference points; PLAN-001..004 documents stay as history but their diffs no longer apply
  to the tree.
