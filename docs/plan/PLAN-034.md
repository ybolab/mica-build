# PLAN-034 Simplify the rootfs packaging contract

- **status**: rejected
- **createdAt**: 2026-08-30
- **approvedAt**: (pending)
- **relatedTask**: RFCT-270

## Context

(The original detail file was lost; see Annotations. The title is the one the
index line carries. The owner should restore the plan from their own copy.)

## Proposal

(lost with the original file)

## Risks

(lost with the original file)

## Scope

(lost with the original file)

## Alternatives

(lost with the original file)

## Annotations

- 2026-08-30: rejected by the user. Ordered rootfs mutation is not the desired
  component-delivery model; the replacement plan must build independently
  installable Debian packages and compose the image from them.
- 2026-08-30: this record was created concurrently by another worker while a
  second worker allocated the same number for the buildkit rootfs-chain plan
  (now PLAN-035). The second worker's write replaced this file before the
  collision was noticed, and the original content could not be recovered from
  any checkout on the host. This stub keeps the index line resolvable.
