# PLAN-017 Docs reconciliation: api.md measured against the served OpenAPI surface, and the Talos framing retired

- **status**: approved
- **approvedAt**: 2026-08-26 22:05
- **createdAt**: 2026-08-26 21:55
- **relatedTask**: RFCT-155..159 reserved
- **milestones**: M1 api.md reconciled against openapi.json; M2 remote-management.md rewritten to the shipping system; M3 boards.md Talos framing retired; M4 provenance-line sweep (access.md, connd.md, provisioning.md)

## Context

`docs/design/api.md` (3,778 lines) still frames sections 2-9 as unimplementable
proposal ("there is nothing to check yet", section 0) while
`mosd/apid/openapi.json` now records a served surface: /api/versions,
/api/v1/meta, /api/v1/settings/{path}, /api/v1/state/{path}, the ApiError
envelope, and the oasdiff gate. Section 1.2's route table describes the
nineteen-path router measured at 86cd669; its citations resolve and are green
under docs/verify-citations.sh while pointing at unrelated code — the
resolves-but-wrong class RFCT-128 records. The user's decision (2026-08-26):
reconcile api.md against the implemented OpenAPI document.

Talos residue after PLAN-015 M5: remote-management.md 17 mentions (minus the
live naming contract at :10-11), boards.md's wider framing, and the
provenance lines in access.md:10/:52, connd.md:12. The user's decision:
Talos is gone; rewrite to the shipping system. `board/cx3576/README.md` is
NOT here — PLAN-018 moves and rewrites it.

## Proposal

- **M1 (RFCT-155)** api.md: section 0 restated (the served surface is
  measured against openapi.json and HEAD; unimplemented sections are marked
  proposal per-section, not per-document); section 1 re-measured at HEAD
  (real router, real citations with quotes); sections 2-3 annotated
  implemented/deferred per subsection against openapi.json (path-versioning,
  discovery, error envelope, redaction are implemented; bearer tokens, writes,
  actions, collections are deferred); every citation passes the gating
  checker.
- **M2 (RFCT-156)** remote-management.md rewritten present-tense for the
  mos daemon set; the apid naming contract stays.
- **M3 (RFCT-157)** boards.md: adding-a-board checklist and tier table
  measured against os/build + os/boards as they exist; runs after PLAN-018
  merges (path layout changes underneath it).
- **M4 (RFCT-158)** the provenance lines in access.md/connd.md/provisioning.md
  reduced to one-sentence present-tense statements or deleted.

## Ordering

M1/M2 are independent of PLAN-018. M3/M4 run after PLAN-018 reaches main.
docs/verify-citations.sh gates: every milestone lands green.

## Scope

- **In**: docs/design/api.md, remote-management.md, boards.md, access.md,
  connd.md, provisioning.md; docs/architecture.md touch-ups if measurement
  requires.
- **Out**: board/** (PLAN-018), *.zh.md, mosd/** source, openapi.json itself,
  docs/task and docs/plan except tracking.
