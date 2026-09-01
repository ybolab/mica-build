# PLAN-054 Design conditional fleet management

- **status**: draft
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: (pending)
- **relatedTask**: [RFCT-290](../task/RFCT-290.md)

## Context

mos currently provides authenticated LAN management. It has no device-initiated
NAT-safe channel, enrollment/revocation, fleet inventory, targeting, staged
rollout, fleet observability or audited remote support. Those are not required
for a standalone appliance and should not enter the pilot baseline unless fleet
operation is an explicit product promise.

## Proposal

- **COND/product:** first decide whether mos sells fleet operation, which party
  runs the control plane, supported scale/availability/regions, data residency,
  offline tolerance and support liability.
- **COND/design:** if selected, define device enrollment and revocation,
  outbound mutually authenticated connectivity, identity rotation, inventory,
  policy targeting, staged update orchestration, command audit and break-glass
  remote support.
- **COND/security:** threat-model tenant isolation, replay, stolen-device
  credentials, compromised control plane, operator roles and device autonomy
  during loss of service.
- **COND/OPS/DOC:** specify retention, privacy, incident response, disaster
  recovery, SLOs and fleet-administrator journeys.
- End this plan at an approved architecture, ownership model, cost envelope and
  separately estimated implementation backlog; do not silently implement a
  cloud service under the embedded baseline.

## Risks

- Fleet work changes security, privacy, operations and ongoing service cost far
  beyond a local-device feature.
- Coupling safe local update/recovery to cloud availability can make devices
  less reliable; local autonomy remains mandatory.
- Building before product/hosting ownership is decided can create an unusable
  control plane or unsupported compliance obligations.

## Scope

In scope only after product confirmation: requirements, architecture, trust
boundaries, operating model, cost/scale assumptions and implementation backlog.
Out of scope: building or operating the fleet service in this plan.

## Alternatives

1. Include fleet management in the P0 appliance baseline. Rejected because
   standalone operation is valid and fleet scope is not yet selected.
2. Reuse the LAN API directly over inbound Internet access. Rejected because it
   assumes routability and broadens device exposure.
3. Ignore fleet needs until implementation. Rejected if the product is sold for
   fleets because enrollment, trust and update targeting affect device design.

## Annotations

- 2026-08-31: Fleet management was classified as conditional product work, not
  a CoreOS-parity requirement.
- 2026-09-01: Split from PLAN-037 and limited to a decision/design gate.
