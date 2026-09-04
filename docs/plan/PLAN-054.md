# PLAN-054 Design conditional fleet management

- **status**: approved
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-04
- **relatedTask**: [RFCT-290](../task/RFCT-290.md)

## Context

mos currently provides authenticated LAN management. It has no device-initiated
NAT-safe channel, enrollment/revocation, fleet inventory, targeting, staged
rollout, fleet observability or audited remote support. Those are not required
for a standalone appliance and should not enter the pilot baseline unless fleet
operation is an explicit product promise.

## The decision — 2026-09-03

**Fleet management is wanted.** The user answered the first question of
`COND/product` yes: mos sells fleet operation. This record is therefore **no
longer conditional on whether the product exists**, and the sections below are
re-marked to separate what that answer settles from what it does not.

What the answer settles:

- Fleet operation is a product promise, so enrollment, trust and update
  targeting are device-design inputs rather than speculative ones — the
  situation Alternative 3 named.
- The **first slice is chosen**: outbound-only device registration and
  inventory reporting, off by default, designed in **PLAN-072**.
- The **seam that carries the switch is chosen**: the `meta/` directory in this
  repository, an allowlisted public subset of which is baked into the image,
  designed in **PLAN-070**, which also carries the default update source and
  the pinned TUF root.
- **PLAN-071** is adjacent, not part of this: the `off | check | auto` update
  module is a local capability that works with no fleet plane at all. It is
  named here so nobody reads unattended updating as a fleet feature.

What the answer does **not** settle: everything in *Open product questions*
below. Each of those changes the architecture, and none is answered.

**The boundary of this record is unchanged.** It still ends at an approved
architecture, ownership model, cost envelope and separately estimated
implementation backlog, and a cloud service is still not to be implemented
under the embedded baseline. PLAN-072 estimates the **device half** only and
says in terms that the plane side is a service project with its own owner.

## Proposal

- **COND/product — PARTLY ANSWERED.** *Does mos sell fleet operation:* **yes**
  (2026-09-03). The remaining five questions — which party runs the control
  plane, supported scale/availability/regions, data residency, offline
  tolerance and support liability — are **open** and are restated below with
  what each one changes.
- **COND/design — FIRST SLICE SELECTED, the rest still conditional.** Device
  registration, its authentication shapes and revocation semantics are designed
  in PLAN-072. Still undesigned and deliberately so: outbound mutually
  authenticated *bidirectional* connectivity, identity rotation, policy
  targeting, staged update orchestration, command audit and break-glass remote
  support. `docs/design/remote-management.md` §2's NAT-traversal requirement is
  **not** satisfied by PLAN-072 and stays here.
- **COND/security — ANSWERED FOR THE SELECTED SLICE.** PLAN-072 §5 threat-models
  tenant isolation, replay, stolen-device credentials, a compromised control
  plane and operator roles, and §6 states device autonomy during loss of
  service in the form `docs/design/security-model.md` requires. The analysis is
  valid only for an outbound-only channel; a control channel re-opens all five.
- **COND/OPS/DOC — UNCHANGED, and unowned.** Retention, privacy, incident
  response, disaster recovery, SLOs and fleet-administrator journeys are
  plane-side, belong to whoever the answer to open question 1 names, and are
  deliberately not estimated in PLAN-072's backlog.
- End this plan at an approved architecture, ownership model, cost envelope and
  separately estimated implementation backlog; do not silently implement a
  cloud service under the embedded baseline.

## Open product questions

Still unanswered, restated with what each changes. These are the reason this
record stays `draft` after the product decision: an approved architecture needs
them, and guessing at any one of them would design the wrong thing.

1. **Who runs the control plane** — vendor, integrator, or end customer.
   Decides whether the plane is multi-tenant (and whether PLAN-072 §5's tenant
   isolation is a hard boundary or an operational one), whether the baked fleet
   URL is one value or one per customer — and, because it is baked, whether
   that means one image per customer — and who carries the operating cost.
2. **Scale and availability** — hundreds versus hundreds of thousands of
   devices, and what the plane promises. The device side is nearly insensitive
   to this by construction (PLAN-072 §6 makes the plane non-critical); the cost
   envelope is not.
3. **Data residency** — where inventory records live and whether a report may
   cross a region. A per-region URL is a baked value, so this is also a build
   and release-process question: a per-region URL is a per-region image.
4. **Offline tolerance as a plane-side promise** — the device's behaviour is
   settled (PLAN-072 §6: nothing degrades with time since contact). How long
   the plane waits before showing a device as *missing* rather than *absent*
   shapes the UI and the support workflow.
5. **Support liability** — what the vendor commits to when the plane is down or
   wrong. This most strongly decides who may flip the fleet switch and which
   registration-authentication shape is acceptable.
6. **Is zero-touch enrolment required?** If yes, it forces a per-device
   factory-injected credential, which forces the factory tooling
   `docs/design/manufacturing.md` §0 records as non-existent — **and a
   per-device delivery channel that no longer has a candidate in this tree.**
   PLAN-070's baked subset of `meta/` is fleet-identical, so every device
   flashed from one image carries the same bytes and cannot carry a per-device
   credential even in principle; the earlier draft merely argued against one. Answering
   yes therefore means designing a second, per-device seam from nothing. The
   single most expensive question here, and more expensive than it was.
7. **Do serial number and MAC addresses go in the inventory?** An inventory
   that cannot match a device to a purchase order is less useful; publishing
   hardware identifiers is a privacy commitment. Must be decided before the
   first report format is frozen.

Questions 1 and 3 block PLAN-072 slice C1; questions 6 and 7 block slice C2.
The rest are cost and commitment rather than device design.

## Risks

- Fleet work changes security, privacy, operations and ongoing service cost far
  beyond a local-device feature.
- Coupling safe local update/recovery to cloud availability can make devices
  less reliable; local autonomy remains mandatory.
- Building before product/hosting ownership is decided can create an unusable
  control plane or unsupported compliance obligations.

## Scope

In scope, and **now unblocked** by the 2026-09-03 product confirmation:
requirements, architecture, trust boundaries, operating model, cost/scale
assumptions and implementation backlog. The architecture and trust boundaries
of the first slice are delivered by PLAN-072; the operating model and the cost
envelope remain owed and depend on open questions 1, 2 and 5.

Out of scope: building or operating the fleet service in this plan — unchanged,
and unchanged by the product decision.

## Alternatives

1. Include fleet management in the P0 appliance baseline. Rejected because
   standalone operation is valid and fleet scope is not yet selected.
   **Re-read 2026-09-03:** the scope is now selected, and the first slice is
   still deliberately outside the P0 baseline — PLAN-072 ships off by default,
   so a device that never enables it is the appliance this alternative
   describes.
2. Reuse the LAN API directly over inbound Internet access. Rejected because it
   assumes routability and broadens device exposure. **Unchanged.**
3. Ignore fleet needs until implementation. Rejected if the product is sold for
   fleets because enrollment, trust and update targeting affect device design.
   **The condition now holds**, which is why PLAN-070's baked `meta/` carries
   the fleet switch beside the trust anchors rather than leaving it for later.

## Annotations

- 2026-08-31: Fleet management was classified as conditional product work, not
  a CoreOS-parity requirement.
- 2026-09-01: Split from PLAN-037 and limited to a decision/design gate.
- 2026-09-03: **The user decided fleet management is wanted.** This record is
  no longer conditional on the product question; the first slice is
  outbound-only registration, designed in PLAN-072, carried by the seam
  designed in PLAN-070. Seven product questions remain open and are
  listed above. Status stays `draft`: the boundary is an approved architecture
  *plus* an ownership model and a cost envelope, and the questions that produce
  the last two are unanswered. PLAN-071 (the local `off | check | auto` update
  module) is adjacent and independent — it is not fleet work.
- 2026-09-03: PLAN-070 was rewritten and the chosen seam changed: it is a
  `meta/` directory in this repository that the build bakes into the image, not
  a factory record on the META partition. Touched here only where that makes a
  statement false — the seam sentence above, Alternative 3, and open questions
  1, 3 and 6. Question 6 changed in substance and not only in wording: a baked,
  fleet-identical seam cannot carry a per-device credential even in principle.
  The other four questions, the boundary and the COND/* dispositions are
  unchanged.
- 2026-09-03: PLAN-070 was revised again — `meta/` holds signing material, so
  it is gitignored and only a public subset reaches the image. Touched here
  only where that makes a sentence false: the seam bullet above and question 6
  now say *the baked subset* rather than the whole directory. The decision, the
  boundary, the other questions and the COND/* dispositions are unchanged.
### Approved — 2026-09-04

The user approved this plan. Five of the seven open product questions were answered on
2026-09-03 and are recorded in full in PLAN-072 §7a; the answers apply here unchanged:

1. **Who runs the control plane** — the vendor by default, an integrator may run their
   own, and the server is open source. The device learns its plane from the baked
   `fleet.url` in `meta/`, which answers this record's own sub-question directly:
   **one plane per image**. A per-customer plane is a per-customer `meta/`, and a
   per-region URL is a per-region image.
4. **Offline tolerance** — the plane assists and never gates local execution. The model
   the user named is Victron VRM.
5. **Support liability** — a plane that is down does not affect the device; nothing is
   committed beyond that.
6. **Zero-touch enrolment** — required, keyed on `deviceId`, which selects trust on first
   use with the two mitigations PLAN-072 §7a requires. The per-device factory credential
   this record calls the most expensive question is **not** taken, and could not be: a
   fleet-identical baked set cannot carry a per-device secret even in principle.
7. **Serial and MAC in the inventory** — not required; `deviceId` is the identifier.

**Still open**: question 2 (scale and availability) and question 3 (data residency).
Neither is a device-side design input any longer — residency follows from question 1, and
availability is not a product promise — so both are cost and commitment questions for
whoever operates the plane, and they no longer block this record.
