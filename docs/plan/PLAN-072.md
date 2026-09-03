# PLAN-072 Design cloud registration: outbound-only, off by default

- **status**: draft
- **createdAt**: 2026-09-03 11:11
- **approvedAt**: (pending)
- **relatedTask**: (none — design only; task records are owed on approval)

## Context

### What the user decided

Fleet management **is** wanted. PLAN-054 was written as a conditional record
whose first question was *"whether mos sells fleet operation"*; that question is
answered yes as of 2026-09-03. PLAN-054 is updated to say so and stays the
parent decision record; this plan designs the first slice and nothing more.

PLAN-054's boundary is unchanged and this plan holds it: end at an approved
architecture, ownership model, cost envelope and a separately estimated
implementation backlog, and **do not silently implement a cloud service under
the embedded baseline.** No control plane is built by approving this record.

### What the tree has

- **A device identity minted on the device**: `provisioning.deviceId`, 16
  CSPRNG bytes as 32 lowercase hex, drawn at first boot and never issued by
  anyone. `docs/design/remote-management.md` §2 already notes that this gives
  enrollment something to bind to.
- **A release identity**: `/usr/share/mos/release-identity.env` carrying
  `BOARD`, `PROFILE`, `VERSION` and `COMMIT_DATE`, written at compose time.
- **No outbound anything.** *"There is no device-initiated management channel
  and no fleet plane in this tree: nothing dials out, nothing enrolls a device,
  no component holds more than one device. Every path in is inbound, on the
  LAN."*
- **An invariant any future channel must hold**, already written: each plane is
  an independent credential domain; an apid session is not an enrollment
  credential, an enrollment credential is not a root shell, and an endpoint
  holding a fleet's channel credentials must not thereby hold the keys that
  authorise an image.
- **A physical-access axiom**: `docs/design/security-model.md` §1 — physical
  possession is full control, and STATE is unencrypted flash.
- **A live requirement with no design**: `docs/design/remote-management.md` §2
  — reach a device behind NAT for support, without an inbound port. **This plan
  does not satisfy that requirement**, and §4 says so in terms.

## Proposal

### 1. What this is, and what it is not

**This is outbound-only registration and inventory reporting. It is not a
control channel, and it does not become one by increment.**

The distinction is worth a plan boundary because the two have different
compromise stories, not different feature sets:

- A **control channel** makes compromise of the plane equal to compromise of
  every device it reaches. That is the inverse of
  `docs/design/remote-management.md` §4's independent-credential-domain
  invariant, and it is what §3 of that document means by *"a trigger is a way
  into that path, never a bypass of it: an endpoint that could hand a device an
  installable payload directly would make compromise of the endpoint equal to
  compromise of every device it reaches."*
- **Registration and inventory** make compromise of the plane a *disclosure*
  problem: the attacker learns which devices exist, what they run, and what
  addresses they call from. Real, bounded, and answerable by revocation and
  disclosure rather than by a fleet-wide incident.

Everything in §5 follows from choosing the second.

### 2. The switch

**Where.** `[fleet].enabled` in the PLAN-070 factory record on META, default
`false`. It lives at the product tier because *may this device talk to a fleet
plane at all* is a fact about the product, in the same tier that answers which
trust roots the device honours. A device built with no factory record has no
fleet configuration and no fleet behaviour — the absent case of PLAN-070 §5,
unchanged.

**Who may flip it.** Two options, and this plan recommends the second:

- (a) **Factory only.** Simplest, and it means a device shipped without fleet
  can never join one without re-provisioning from a medium.
- (b) **The factory record pins the URL; an authenticated administrator may
  turn the switch on and off.** The administrator consents to enrolment but
  cannot redirect the device to a different plane.

**Recommended: (b).** The risk that matters here is *redirection* — a device
talking to somebody else's plane — not *consent*. Pinning the URL at the
factory removes redirection entirely; leaving the switch to the administrator
means a customer who buys fleet management after the fact does not need a
reflash to get it, and means the customer performs the act that starts the
outbound connection. A device that dials out because of a decision its owner
never made is the shape this product should not have.

**Does flipping it off deregister? Yes, and locally-authoritative.** The device
stops the outbound connection immediately and deletes its enrolment credential
from STATE. It *attempts* a deregistration call; if the plane is unreachable
the local side still completes. **The plane must treat "this device stopped
reporting" as the real signal and must never require a goodbye**, because the
alternative — off means off once the server acknowledges — makes a local switch
depend on a remote service, which `docs/design/security-model.md`'s autonomy
requirement forbids. A device that is off is off whether or not anyone was
listening.

### 3. Registration

**What identity is sent.** `provisioning.deviceId`; `BOARD`, `PROFILE` and
`VERSION` from `release-identity.env`; the factory record's product labels.
That is the whole list.

Explicitly **not** sent: the administrator credential, the webAdmin hash, the
AP PSK, the device password, SSH keys, settings, or anything under `/srv`.
Serial number and MAC addresses are an **open question** (§7), because a fleet
inventory genuinely wants a serial and sending one turns a device identifier
into a hardware identifier the customer did not choose to publish.

**Over what channel.** Device-initiated outbound HTTPS to the factory-pinned
`[fleet].url`. **No inbound port, ever** — that is the whole reason the channel
is device-initiated, per `docs/design/remote-management.md` §2's *"an appliance
whose owner has to forward a port has no support story, and one that forwards a
port carries an attack surface its owner did not choose."*

**Authenticated how — and the honest problem first.** **`deviceId` is not a
credential.** It is a CSPRNG value that appears in
`GET /api/v1/provisioning/status`, is embedded in the hostname
(`mos-<first 8 hex>`), and is meant to be printable on a label. Anyone who
reads it can claim to be that device. Registration therefore needs something
`deviceId` is not, and there are three shapes:

- **(a) Operator claim code.** The device registers itself as *unclaimed* and
  displays a short claim code (console, serial, label). An operator reads it
  off the device and enters it in the fleet UI; the plane binds the device to
  the tenant only on that match. **Cost:** one human step per device.
  **Benefit:** no factory secret, no per-device factory state, and the trust
  decision is made by the person who physically has the device — which is
  exactly the authority `docs/design/security-model.md` §1 already grants.
- **(b) Per-device factory-injected credential.** Zero-touch. Requires factory
  tooling that does not exist (`docs/design/manufacturing.md` §0), requires the
  factory record to become per-device (which PLAN-070 §4.1 argues against), and
  reintroduces the injected-secret shape `docs/design/provisioning.md` §3.1
  structurally excludes.
- **(c) Trust on first use.** First registration for an id wins; later ones are
  refused. **Cost:** an attacker who learns a `deviceId` before the device
  first registers takes the slot, and `deviceId` is on a label.

**Recommended: (a).** It is the only one that costs nothing the tree does not
already have, and its per-device human step is the same step an operator
already performs when they claim the device with an administrator password.
If the product requires zero-touch enrolment, that forces (b), which forces
factory tooling — a real cost, named here rather than discovered later.

**What the plane may send back.** In this slice, exactly two things: an
acknowledgement, and optionally a suggested update channel that the device
treats as a **hint an operator may override** — never as a policy write.
Explicitly not: commands, configuration, a bundle URL, a reboot, a shell, a
credential for anything else.

**After registration, inventory.** A periodic outbound report carrying what
registration carried plus the update lifecycle state and the health summary.
Same channel, same credential, same one-way direction.

### 4. What this deliberately does not do

`docs/design/remote-management.md` §2's requirement — reach a device behind NAT
for support — is **not satisfied by this plan**, and no part of it should be
read as a step toward satisfying it by accretion. Support reachability needs a
persistent, mutually authenticated, bidirectional channel with an audited
command surface and a break-glass path; that is a different security question,
a different cost envelope and a different approval, and it stays in PLAN-054's
open backlog.

Saying so is load-bearing: the natural next request after registration ships is
"and while the connection is open, let support run one command", and the answer
has to be a new record, not a patch.

### 5. The threat questions PLAN-054 lists

**Tenant isolation.** A device belongs to exactly one tenant, and the binding
is made at claim time (§3a) on the plane, not on the device. The device sends
nothing that names a tenant, so a device cannot be tricked across tenants; the
isolation failure mode is entirely server-side. **Open:** a multi-tenant plane
versus a per-customer instance is a cost-and-liability decision, not a device
decision (§7).

**Replay.** Registration is idempotent by `deviceId`. Inventory reports carry a
monotonically increasing counter, and the plane rejects a report whose counter
does not advance. **The counter is the anti-replay; the timestamp is a label**
— the device's clock has a floor, not a guarantee
(`docs/design/time.md`), which is the same rule
`docs/design/provisioning.md` §4.1.8 already applies to `lastImport.at`.

**Stolen-device credentials.** STATE is unencrypted and physical possession is
full control, so a stolen device's enrolment credential **is compromised, full
stop** — no device-side measure changes that, and none should be proposed. The
answer lives entirely at the plane: it must be able to revoke an enrolment, and
**a revoked device must keep working locally.** Revocation removes fleet
visibility; it does not brick an appliance. Anything else makes the fleet plane
a remote kill switch, which is the property §1 exists to avoid.

**A compromised control plane.** What it gets: the inventory (which devices,
what versions, what source addresses), the ability to lie in the channel hint,
and the ability to deny service to itself. What it does **not** get: an
installable payload, a configuration write, a shell, a reboot, or a rollback.

The invariant that guarantees the second list, stated because collapsing it is
the obvious cost saving: **the fleet plane never holds an update signing key
and never serves a bundle.** The update source is the factory-pinned TUF URL
and stays a separate hierarchy from the fleet URL *even when the same company
runs both*. `docs/design/remote-management.md` §4 already binds any future
fleet credential to this; PLAN-070 makes the two URLs separate fields for the
same reason.

**Operator roles.** Device-side there is exactly one role today — an
authenticated administrator on the LAN — and this plan adds none: **no
fleet-derived role grants anything on the device.** Plane-side roles are the
plane's design and out of scope here beyond one requirement: the plane must
distinguish read-only inventory access from any future action, from its first
version, because retrofitting a role boundary onto a plane that never had one
is how a support tool becomes a fleet-wide primitive.

### 6. Autonomy during loss of service

`docs/design/security-model.md` requires device autonomy during loss of service
to be stated, so it is stated in the strongest available form:

**There is no device behaviour that degrades as a function of time since last
contact with the fleet plane.** No lease, no heartbeat expiry, no
grace period, no feature that stops. With the plane unreachable indefinitely,
the device keeps: LAN management over apid, local update check/fetch/install,
offline lockbox import, rollback, recovery, applications, and every setting.

Behaviour on failure: retry with bounded exponential backoff to a cap, report
the failure in a `fleet` entry in the live-state tree with its reason and last
success, and do nothing else. The retry is the only thing that changes.

### 7. Open questions — product, not engineering

These change the architecture and nobody has answered them. They are PLAN-054's
list, narrowed to what this slice actually blocks on:

1. **Who runs the control plane** — the vendor, the integrator, or the end
   customer. Determines whether the plane is multi-tenant, whether §5's tenant
   isolation is a hard boundary or an operational one, and whether the
   factory-pinned URL is one value or one per customer.
2. **Scale and availability** — hundreds versus hundreds of thousands, and what
   the plane promises. The device side is nearly insensitive to this (§6 makes
   the plane non-critical by construction); the cost envelope is not.
3. **Data residency** — where inventory records live, and whether a device's
   report may cross a region. Determines whether the pinned URL must be
   per-region, which is a factory-record question and therefore a
   manufacturing-process question.
4. **Offline tolerance as a product promise** — §6 states the device's
   behaviour; what the *plane* promises about a device it has not heard from
   (how long before it is shown as missing rather than absent) is a product
   decision that shapes the UI and the support workflow.
5. **Support liability** — what the vendor commits to when the plane is down or
   wrong, which is the question that most strongly decides between (a) and (b)
   in §2 and between (a) and (b) in §3.
6. **Zero-touch enrolment: required or not** (§3). If required, it forces the
   per-device factory credential and the factory tooling
   `docs/design/manufacturing.md` §0 says does not exist. This is the single
   most expensive open question on the list.
7. **Serial and MAC in the inventory** (§3). An inventory that cannot match a
   device to a purchase order is less useful; publishing hardware identifiers
   is a privacy commitment. Decide before the first report format is frozen.

None of these is guessed at in this plan.

## Risks

- **The first outbound connection this product has ever made.** Every claim in
  `docs/design/remote-management.md` §4 about what the device does not do
  changes, and a build-asserted absence (*"no outbound management connection"*)
  becomes a conditional. Whatever asserts that absence must become an assertion
  about the switch being off by default, not be deleted.
- **Registration looks small and is a trust-establishment problem.** §3's three
  authentication shapes are the whole difficulty, and the recommended one (a
  human-carried claim code) is the one that adds friction — which is exactly
  the pressure that later produces a request for (c), trust on first use, whose
  cost is a label-readable identifier.
- **Increment pressure toward a control channel.** §4 exists because of it. The
  risk is not that someone argues for a control channel; it is that one arrives
  as three small additions to a registration endpoint.
- **A plane that is cheap to run and easy to compromise is worse than none.**
  The disclosure blast radius of §5 is bounded only while the plane holds no
  signing key and no command surface. A single decision to "just serve bundles
  from the same service" collapses it.
- **Approving this record could be read as approving a service.** It is not;
  the approval boundary below says so, and PLAN-054 keeps the line.

## Scope

In scope: the switch and its tier, the registration and inventory content, the
transport direction and its authentication shapes, the deregistration
semantics, the autonomy statement, and the threat analysis PLAN-054 requires.

Out of scope, explicitly: building or operating a control plane; NAT-traversing
support reachability (§4); remote command execution; remote configuration push;
fleet-driven update targeting or staged rollout; a remote kill switch; any
device-side role derived from a fleet identity.

### Implementation backlog — estimated separately from approval

**Device side** — this is the only half this repository could build.

| # | Slice | Size | Gate |
|---|---|---|---|
| C1 | The `[fleet]` switch read from the factory record, the administrator toggle of §2b, and the off-is-off deregistration | S | depends on PLAN-070 F1 |
| C2 | Registration client: outbound HTTPS, the identity payload, the claim-code display, the enrolment credential on STATE | M | payload asserted to contain nothing from the excluded list |
| C3 | Inventory report with the monotonic counter, backoff and the `fleet` live-state entry | M | replay rejected on a non-advancing counter |
| C4 | The autonomy assertion: a test that drives every local capability with the plane unreachable | S | §6 is a test, not a sentence |
| C5 | The channel hint as a hint — never a policy write | S | a hint cannot change `update-policy.toml` |
| C6 | Console: the switch, the claim code, the fleet state and its last error | M | — |
| C7 | Design docs: `remote-management.md` §2 and §4, `security-model.md` §7, a new fleet section | M | `make docs-verify` |

**Plane side** — **not this repository, not this backlog, and not estimated
here.** Enrolment store, tenant model, revocation, retention, incident
response, disaster recovery, SLOs and the fleet-administrator journeys are
PLAN-054's `COND/OPS/DOC` items and are a service project with its own owner
and its own cost envelope. Estimating them alongside C1–C7 would be the exact
elision PLAN-054's boundary forbids: it would make a service look like seven
device slices.

## Approval boundary

**This plan ends at an approved device-side architecture for outbound-only
registration.** Approval means agreeing that:

- the switch is off by default and lives in the factory record;
- registration is outbound-only, grants no inbound command surface, and is not
  a step toward one;
- the plane never holds an update signing key and never serves a bundle;
- a revoked or unreachable plane costs the device nothing;
- §7's seven questions are answered before the slices that depend on them (C2
  depends on 6 and 7; C1 depends on 1 and 3).

Approval does **not** authorise building a control plane, and does not
authorise C1–C7. PLAN-054 remains the parent record and its ownership and cost
gate is unchanged.

## Why three plans and not one

The user's request named three connected things, and they are connected. They
are nonetheless three records because they ask three different people three
different questions, at three different reversal costs:

- **PLAN-070** asks *where does trust live and what survives a reset* — an
  engineering and security decision, reversible only by touching every fielded
  device's META.
- **PLAN-071** asks *what may a device do to itself unattended* — an
  engineering and product-safety decision, reversible by editing one file on
  one device.
- **PLAN-072** asks *does this company operate a service* — a product,
  ownership, liability and recurring-cost decision that no amount of
  engineering review can settle, and that is irreversible in the way an
  operational commitment to customers is irreversible.

Folded into one record, the cheapest and most reversible decision (the update
policy, which changes nothing until an operator writes `auto`) becomes hostage
to the most expensive and least reversible one (running a cloud service). The
factory seam would be blocked on a hosting decision it does not need — it is
useful with the fleet switch permanently false, because its trust and update
halves stand alone. And the update module would be blocked on both, when it
works today on an operator-edited policy file with no factory record at all.

The dependencies that do exist are one-directional and narrow: PLAN-072 needs
PLAN-070's switch (C1 depends on F1), and PLAN-071 is *improved* by PLAN-070's
seeded source URL but does not require it. That is a dependency graph, not a
single decision.

## Alternatives

1. **Do nothing; PLAN-054 stays conditional.** No longer available: the product
   question is answered yes, and leaving the record conditional would misstate
   a decision that has been made.
2. **Build the NAT-traversing support channel first**, since
   `docs/design/remote-management.md` §2 calls that requirement live. Rejected
   as the first slice: it is the largest security surface in the fleet story
   and it needs the enrolment, identity and revocation model that registration
   establishes. Registration first means the control channel is later designed
   against an enrolment that already exists, rather than inventing both at
   once — which §2 of that document already warns produces two channels.
3. **Reuse the LAN API over inbound Internet access.** Rejected for PLAN-054's
   original reason, unchanged: it assumes routability and broadens device
   exposure.
4. **Put the fleet switch in the settings tree instead of the factory record.**
   Rejected: it makes "may this device dial out" an installation-time setting
   rather than a product fact, and it puts the URL somewhere a settings write
   could redirect. The pinned URL is the property that makes §5's compromise
   analysis hold.
5. **Serve update bundles from the fleet plane.** Rejected, and named because
   it is the obvious consolidation: it collapses two independent credential
   domains into one and turns a disclosure problem into a fleet-wide code-
   execution problem.

## Annotations

- 2026-09-03: Created as the third of three records answering the user's
  request. The user decided that fleet management is wanted; PLAN-054 is
  updated to record the decision and the remaining open product questions.
- 2026-09-03: This record designs the device half of one slice. The control
  plane is not designed, not estimated and not authorised here.
