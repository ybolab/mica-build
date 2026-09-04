# RFCT-297 Design device state reporting to the fleet plane (PLAN-072 §7b's B)

- **status**: completed
- **priority**: P1
- **owner**: fleet-telemetry-design/bkd-i1q7wlus
- **createdAt**: 2026-09-03 20:05

## Description

Design only. PLAN-072 §7b records the user's A/B/C scope decision — A (identity)
and B (identity plus state reporting) are wanted, C (remote configuration) is
deferred — and routes B to its own record. This task is that record: PLAN-076,
the device half of state reporting to the fleet control plane, the layer the
user named Victron VRM.

Nothing is implemented. The user's request is the approval for *designing* B;
the design itself ends at an explicit approval boundary, as PLAN-070, PLAN-071
and PLAN-072 do.

The plan inherits four things from PLAN-072 and does not renegotiate them: the
switch off by default, device-initiated outbound only with no inbound port ever,
autonomy during loss of service as a product promise, and trust-on-first-use
enrolment with its two required mitigations.

Its whole cost is one question. PLAN-072 §3's identity list ends with "that is
the whole list", which works for a short fixed set; state reporting re-asks it
for a set that grows every time somebody wants one more metric, so the answer
has to be a rule rather than a list. The plan proposes the rule, applies it to a
concrete first set, and shows it excluding a field a reporter would obviously
reach for.

Out of scope: any implementation; remote configuration or any command surface;
changes to registration; changes to the update path beyond the enumerated
failure code B needs from it; a plane-side data model beyond the wire contract.

## ActiveForm

Designing device state reporting to the fleet plane.

## Dependencies

- **blocked by**: (none — design only)
- **blocks**: (none)

## Acceptance

- `docs/plan/PLAN-076.md` carries Context, Proposal, Risks, Scope, Alternatives,
  an explicit approval boundary, and an implementation backlog estimated
  separately from that approval.
- The user's request is recorded as the approval for designing B, and the plan
  says so in terms.
- The plan answers all six questions the task poses: the rule for what leaves
  the device and its application to a first set with one worked exclusion;
  cadence and unreachable-plane behaviour with a bounded buffer; the operator's
  switch and the device-side visibility of what is sent; where it runs; the wire
  contract and its versioning; and what this must not become.
- Every source named in the task is judged rather than assumed:
  `GET /api/v1/storage/status`, the thermal and network status surfaces, service
  health, `release-identity.env`, and the diagnostics redaction schema in
  `pkgs/mosd/apid/src/diagnostics.rs` — with an explicit statement of whether
  the same rule applies and why it differs.
- Where the analysis concludes part of B should not be built as asked, the plan
  recommends against with the evidence.
- `make docs-verify` green.
- `docs/zh/` mirrored where the repo's convention requires it.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched;
  L1 owns those.

- complete: PLAN-076 written. The rule is four questions (bounded at source;
  about the device not the site; actionable at fleet tier; safe as a series)
  plus a procedural clause (versioned allowlist in source, no dynamic keys,
  four written answers per added field, and a device route that serves the
  exact payload). Worked exclusion:
  `network.interfaces[].addresses[].address`, failing three of four. The
  diagnostics boundary is reused as mechanism and rejected as content policy,
  for three reasons taken from `docs/design/diagnostics.md` §6/§8. Three parts
  of B as the user described it are recommended against: a reachability field
  (unbuildable — it is `true` in every report that exists), free-text failure
  detail (only a fail-open filter exists for it), and a monitor-grade cadence.
  `make docs-verify` green. No `docs/zh/` change was required: its coverage
  gate governs `user/`, `website/` and `bsp/`, and this record touches none of
  them.
