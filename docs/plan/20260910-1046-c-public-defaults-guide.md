# 20260910-1046-c-public-defaults-guide Update the public defaults guide

- **status**: completed
- **createdAt**: 2026-09-10 10:46
- **approvedAt**: 2026-09-10 12:19
- **relatedTask**: 20260910-1046-c-public-defaults-guide

## Context

The original `e03686e0a1225c5bb1d4a2a082ced4574d160af8` implementation baseline
did not contain the separately scheduled D2 public-meta validation or fleet
projection work. After the original D1 completion, reviewed local upstream
`31d7c109f983a3b41664104d21568e92783c81c0` delivered D2 validation while the
fleet projection remained queued. The bounded integration refresh therefore
updates only the README's staging description to match the merged validator.

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
- The D2 boundary refresh preserves the completed plan state and prior evidence;
  it does not add fleet behavior or claim packed-image or physical qualification.
