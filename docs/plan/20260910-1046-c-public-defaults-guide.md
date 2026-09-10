# 20260910-1046-c-public-defaults-guide Update the public defaults guide

- **status**: completed
- **createdAt**: 2026-09-10 10:46
- **approvedAt**: 2026-09-10 12:19
- **relatedTask**: 20260910-1046-c-public-defaults-guide

## Context

The current `meta.example/README.md` describes retired RAUC/TUF paths and a
user-space signing-key list. The reviewed configuration classification assigns
this slice only the public factory-default guide. The synced source tree does
not yet contain the separately scheduled D2 public-meta validation or fleet
projection work, so the guide must describe current code and staging behavior.

## Proposal

- Replace the stale guide with the exact fields found in the current example
  manifest and `BakedManifest` configuration.
- State the current no-source and fleet-off defaults, including the example's
  `update.policy` value.
- Separate the development generator's private signing-input output from the
  public-only directory consumed by root builds.
- Link to the existing generator and canonical key-delivery, release-artifact,
  and release-signing documents without duplicating their procedures.

## Risks

- Ambiguous directory wording could encourage private signing material to be
  staged into an image.
- Describing pending D2 or fleet work as current would make the public guide
  inaccurate.

## Scope

Edit `meta.example/README.md`, this task and plan, and only their rows in the
task and plan indexes. No source, generator, schema, or other product document
changes are included.

## Alternatives

No alternative implementation is needed; the approved classification fixes
both the source of truth and the bounded documentation scope.

## Annotations

- Existing campaign approval authorizes implementation without another
  proposal stop.
- Preserve the reviewed current-tree boundary until D2 validation lands.
- Completed with all focused documentation checks passing and a `PASS` scoped
  review verdict with no high-confidence findings.
