# PLAN-069 Design managed and untrusted application controls

- **status**: draft
- **createdAt**: 2026-09-03
- **approvedAt**: (pending)
- **relatedTask**: (none — conditional)

## Context

PLAN-051 published the two supported application delivery paths for the
default customer, a trusted product integrator: native code composed into the
signed image and delivered by the RAUC A/B lifecycle, and independently
released applications delivered as pinned OCI images through Quadlet. Both are
documentation and tested convention. Neither is a mechanism that can refuse a
release, and PLAN-051 says so in the pages it publishes.

The gap that leaves is named there rather than hidden: mos does not verify
image signatures, does not require resource ceilings, has no secret store, and
has no per-application rollback. `docs/design/applications.md` already
describes a managed application product built on exactly those missing pieces,
and its section 9 stage list is the sequencing this plan would implement.

This plan is **conditional**. It exists so that the documented gaps point at a
record instead of at nothing, and so that a later decision to promise managed
or untrusted applications starts from a stated scope rather than from an
incremental widening of the trusted-integrator guides.

## Trigger

Any one of:

- mos promises to run an application whose publisher is not the device's own
  integrator;
- a customer contract requires that a release be refused rather than
  discouraged — signature, ceiling, device grant or storage reservation;
- the managed application module in `docs/design/applications.md` is scheduled
  for implementation.

Until one of those holds, the trusted-integrator baseline is the product and
this plan stays a draft.

## Proposal

- **SW:** independent native bundle signing and activation — a signed artifact
  that is not the system image, verified at staging and re-verified at
  activation, with the activation privilege separated from acquisition.
- **SW:** container trust policy that can be distributed — a `signedBy`
  `policy.json` and the keys it names, delivered and rotated without a full
  image rebuild, replacing today's `insecureAcceptAnything`.
- **SW:** non-bypassable hardware and resource admission — device grants and
  CPU/memory/PID/I-O ceilings applied by a generator the application does not
  author, so that an omitted ceiling is a rejected release rather than an
  unlimited unit.
- **SW:** a protected per-application secret store — write-only through the
  API, delivered as credential files rather than environment variables, and
  absent from logs, task messages and support bundles.
- **SW:** an audit projection for install, update, activation and removal.
- **SW:** health-gated per-application rollback — a bounded health gate on an
  application update, last-known-good retention, and separate code and data
  rollback promises.

## Risks

- Every item above is enforcement, and enforcement that can be worked around
  is worse than documentation, because it reads as a guarantee. Each control
  needs a named bypass analysis before it ships.
- The container runtime is rootful. Signature admission authenticates a
  publisher and a digest; it does not turn a privileged runtime declaration
  into a sandbox, and no UI text may imply that it does.
- Per-application rollback and data rollback are different promises. Shipping
  the first while sounding like the second is the failure mode
  `docs/design/applications.md` section 4 already names.

## Scope

In scope: the six controls above and the admission, storage and API surface
they need. Out of scope: a public publisher marketplace, fleet rollout, and
any relaxation of the trusted-integrator guides PLAN-051 published — those
stay correct for the customer they describe.

## Alternatives

1. Tighten the PLAN-051 guides until they read as enforcement. Rejected: the
   documentation set's truth-status contract exists to stop exactly that.
2. Ship signature admission alone. Rejected as the first slice: a signed
   release with no ceiling and no admission is a trusted publisher's mistake
   running unbounded, which is the failure the trusted-integrator baseline
   already accepts and names.

## Annotations

- 2026-09-03: Created by RFCT-287 / PLAN-051 as the conditional destination for
  managed and untrusted application controls, so that the `unsupported` claims
  those documents publish cite a record.
