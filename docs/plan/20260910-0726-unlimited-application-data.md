# 20260910-0726-unlimited-application-data Unlimited application data with bounded var

- **status**: completed
- **createdAt**: 2026-09-10 07:26
- **approvedAt**: 2026-09-10 07:26
- **relatedTask**: 20260910-0726-unlimited-application-data

## Context

Projects 100 and 102 currently divide the remaining DATA budget after bounded
variable data and a state reserve. The user now explicitly removes limits from
/mos, /srv and containers. Existing mounts remain private.

## Proposal

Set project 100/102 soft and hard byte/inode limits to zero (unlimited), retaining
project IDs for accounting. Remove proportional budgets and reserve claims.
Keep project 101's current var/cache/tmp limit. Update focused tests, runtime
assertions and current policy documentation.

## Risks

Unbounded writers can fill DATA; there is no aggregate quota-backed state reserve.
Separate namespaces provide accounting and mount isolation, not physical capacity.

## Scope

Quota initializer, its tests, reporting text and current storage documentation.
No kernel, board, root layout or UI changes. Previously delivered images retain
their original bytes and do not include this follow-up policy.

## Alternatives

Retaining limits contradicts the explicit request; no new configurable policy
or separate filesystem is needed.

## Verification

Reproduce old limits with the changed contract test, then run the focused layout
suite, real ext4 quota checks and relevant source/doc gates. Reuse existing tools
and builds; no full firmware rebuild is needed for quota values.

## Outcome

Implemented and verified. Evidence and image applicability are recorded in the task.
