# 20260910-1910-fleet-device-plane-protocol Design the fleet device-to-plane protocol

- **status**: completed
- **priority**: P1
- **owner**: worker-c/bvjc311u
- **createdAt**: 2026-09-10 19:10

## Description

Specify the authorized outbound registration, device credential lifecycle, operator conflict release and bounded one-way reporting contract. Deliver one implementation-ready plan and strict machine-validated design fixtures; no production implementation or activation.

## ActiveForm

Designing and validating the fleet device-to-plane protocol.

## Dependencies

- **blocked by**: (none; design explicitly authorized)
- **blocks**: Future separately approved device and plane implementation

## Notes

- Campaign: `mos-open-plans-20260910-100408`; node `FLEET-PROTOCOL`; L3 `bvjc311u`.
- Full-tier PMA; the dispatch authorization satisfies the proposal gate for design only.
- Clean isolated branch `bkd/bvjc311u` fast-forwarded to exact reviewed local L2 `e03686e0a1225c5bb1d4a2a082ced4574d160af8` before edits. Required C2, D5 and #313 ancestors verified.
- Plan: [protocol](../plan/20260910-1910-fleet-device-plane-protocol.md). Global history and index reconciliation belong to L2 D; retain these assigned records for handoff.

## Validation and review

- Design specification: [normative plan](../plan/20260910-1910-fleet-device-plane-protocol.md).
- Fixtures: [schema](../../tests/fleet-protocol/protocol.schema.json), [worked exchanges](../../tests/fleet-protocol/exchanges.json), [runner and evidence limits](../../tests/fleet-protocol/fixtures.md).
- Runtime: existing `IMAGE_BUN_1=oven/bun:1@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6`; Bun 1.4.0. No dependency install or live service.
- Actual command: `timeout 30s docker run --rm --pull=never --label ai-agent=true --name ai-agent-bvjc311u-fleet-gate --network none -v "$PWD:$PWD:ro" -w "$PWD" "$IMAGE_BUN_1" bun tests/fleet-protocol/validate.mjs`, from this isolated `/srv/bkd/worktrees/33z9aa5q/bvjc311u` checkout. **46 checks passed**, exit 0. Static schema/parser, ephemeral real signature-byte tests and explicitly symbolic sequence models remain separate proof grades.
- `timeout 60s make docs-verify`: exit 0; index 195/195, links 509/509, status 724/724, translation coverage rows 249/249, BSP document checks 131/131. The focused runner additionally checks own PMA links and unique index rows, which the global link/index gates exclude.
- `git diff --check` and `git diff --cached --check`: exit 0; staged scope and exact fixture-byte identity also passed before commit. Only the assigned paths and index rows changed.
- Gate ran in persistent-shell tmux `bvjc311u-f69a91`, PID `1410714`, started `2026-09-10T19:52:33.012612+00:00`, finished `2026-09-10T19:52:35.273488+00:00`. Log `/tmp/bvjc311u-gate.log`; metadata `/tmp/bvjc311u-gate-meta.json`; all fixture/docs/diff exit codes are 0. No detached gate remains.
- Gate source commit: `fbf7c727b23f6045293adf98cb385a7b35651eb8` with owned-file content manifest SHA-256 `c0cb5529044774a51558dd107c6a08c390e6989a74a2fa9c988f0ed5f49b92f0`. This is the verified completed-status snapshot; only these evidence notes were refreshed afterward.
- Fixture manifest SHA-256: `935a6d7f5bab0a9b5d1748720f16e9a8c91565cba4f5d45d5e4288625533f0ca` (sorted path-to-SHA256 JSON). All individual identities are printed in the gate log and recorded in its metadata.
- Schema SHA-256: `2a2d4b2a958ce9b6ce4b65e9eb722522ee6aea67c5de8f1116a8883de656f390`.
- Worked-exchange SHA-256: `a5b31d8ee5275620821edc63dca65a6349dfc2cc7670438372a754a6b3733106`.
- Runner SHA-256: `06f5098a776b9f1135b22826c14ad9a014712a5138be7e68b85fc0f3c6280530`.
- First draft fixture execution failed with `TypeError: JSON.stringify cannot serialize BigInt.` at the sequence-model snapshot. Replaced the model's JSON snapshot with a structured clone/deep comparison; the protocol canonicalizer still refuses non-wire BigInt values. Subsequent and final gates passed. The first staged whitespace check reported `tests/fleet-protocol/duplicate-header.http:4: new blank line at EOF.`; removed that extra blank line, then repeated the focused and documentation gates plus staged whitespace validation successfully.

Actual pma-cr local DESIGN review used the core policy and Bun/backend review
baseline, read the full protocol/state model and strict fixture runner, and
cross-checked the immutable current identity/reset/update/configuration callers.
No product service or build/lint scaffold is introduced by this design-only
fixture directory. High-confidence draft inconsistencies were resolved:
current interface kinds, native deployments without invented raw-slot labels,
updated local drop metadata versus stable report digests, recovery of a lost
renewal response beyond report-key overlap, exact path/schema binding, and
live status without a flash write for every successful report. A final sequence-model
review also made the minimum renewal interval relative to the current issuance
time and added a current-key early-renewal refusal control; the normative
protocol was unchanged and all gates were rerun.

| Severity | Remaining findings |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

**Verdict: PASS for DESIGN.** JSON/model checks do not prove filesystem durability,
strict point-validation behavior in future libraries, TLS/runtime interop,
physical reset/power-cut behavior or a deployed plane. N9 specifies those later
acceptance gates. FLEET-CONFIG `r3suq4rc` remains unmerged at the inspected
upstream. No production/client/server/OCI activation, image build, main
integration, push or publication was performed.

English history note for workstream D: Designed the current fleet device-to-plane
v1 protocol with TOFU possession proof, scoped operator recovery, independent
credential lifecycle and atomic bounded report acknowledgements. Added strict
design fixtures and source-linked future acceptance slices; production
implementation and deployment remain separately unapproved.

- complete: Completed the authorized implementation-ready DESIGN and 46 focused checks; documentation gates and design review passed. Production implementation/deployment remain future.

## Repair 1 history

- Same completed task and owner `worker-c/bvjc311u`; the explicit repair dispatch
  authorizes the two design-validation corrections. No serializer reopen or
  additional task is introduced. The original 46-check result is historical
  coverage and did not cover the newly reported receipt-principal/header cases.
- Verified the isolated tree clean at `ea4a8dca18a4ec81ee54ee75fe4c1d6cc9f74605`.
  Merged exact reviewed local L2 `f30e2492a4f4a0d29f91f13d02abbcc2f92c093a`
  (tree `64c7c9be5ea9fd470de79ac4b658374d696488a2`) with noninteractive
  `git merge --no-edit`; merge commit `e0c43478f84cb2d43ddda197d7c59b063655da99`.
  Only append conflicts in the two indexes occurred; both parents' unique rows
  and statuses were preserved. Original evidence baseline `e03686e0` remains
  unchanged; FLEET-CONFIG is still unmerged on the new source.
- Initial execution completed normally at `2026-09-10T19:53:55.619Z`.
  Recovered stalls at `19:22:08.405` and `19:32:08.415` remain historical
  evidence; cancellation after L2 released the verified idle process was not
  an implementation failure.

### Repair 1 validation and design review

The three RED runs used the new negative/success controls with the original
renewal function and header schema. Wrong device and wrong role each failed
with `AssertionError: Missing expected exception.`; the permitted complete
HTTP/1.1 envelope failed with `AssertionError: unknown member Host`.
No prior log was replaced. Every phase below has separate
`/tmp/repair1-bvjc311u-<phase>.log` and `.meta.json` files; metadata includes
exact command, start/finish, wrapper/command PID, source commit, dirty diff
SHA-256 and every owned source/fixture SHA-256.

| Phase | Actual outcome | PID | Started UTC | Exit |
|---|---|---|---|---|
| `red-device` | RED: missing expected exception | `1430939` | `2026-09-10T20:11:27.731534+00:00` | 1 |
| `red-role` | RED: missing expected exception | `1431006` | `2026-09-10T20:11:28.692371+00:00` | 1 |
| `red-headers` | RED: unknown member Host | `1431026` | `2026-09-10T20:11:29.268899+00:00` | 1 |
| `green-p1` | GREEN: 3 checks | `1434524` | `2026-09-10T20:15:58.053685+00:00` | 0 |
| `green-p2` | GREEN: 4 checks | `1434543` | `2026-09-10T20:15:58.531361+00:00` | 0 |
| `green-full` | GREEN: 53 checks | `1434562` | `2026-09-10T20:15:59.011811+00:00` | 0 |
| `docs` | PASS: 195/509/724/249/131 checks | `1434580` | `2026-09-10T20:15:59.496884+00:00` | 0 |
| `diff` | PASS: whitespace | `1436783` | `2026-09-10T20:16:01.310253+00:00` | 0 |

- All phases ran from `e0c43478f84cb2d43ddda197d7c59b063655da99` in persistent-shell
  tmux `bvjc311u-f69a91`. Fixture commands used existing pinned `IMAGE_BUN_1`,
  `--pull=never`, `--label ai-agent=true`, `--network none`, and only this
  worktree mounted read-only; documentation/diff checks ran in the local shell.
- RED dirty diff SHA-256:
  `fd61897dc31e1a77f5830f6dd989391556e54d1a9925aeda342a2f3812bc8c80`.
- First GREEN dirty diff SHA-256:
  `259416cae7820147964d4592c813e094e5d60107a049f2eb2b298b327edcfc6e`;
  fixture manifest SHA-256:
  `98d1e7009295bd12ca94fcf6c43342b62524dd3628ec05d7b9eeb00432080e52`.
- Commands: `bun tests/fleet-protocol/validate.mjs` within the pinned Docker
  command already recorded above; focused arguments select `receipt recovery
  rejects wrong device`, `receipt recovery rejects wrong role`, `permitted
  HTTP/1.1 envelope`, `repair1 P1`, or `repair1 P2` respectively. The focused
  selector fails when no check matches. The full 53-check gate retains the
  original 46 groups and adds seven repair groups, with multiple positive and
  negative assertions per group. This is not a runtime integration count.
- `make docs-verify` still reports index 195/195, links 509/509, status 724/724,
  translation coverage 249/249 and BSP 131/131. Own PMA links/unique completed
  rows are additionally asserted by the full fixture runner.
- Actual scope inspection via `/tmp/repair1-bvjc311u-scope.py` passed: precisely
  six repair paths, both parents' index rows/statuses preserved, unchanged C2
  and configuration bytes, unchanged JSON body schemas and eight body/result
  examples, placeholder-only signatures/origin. No FLEET-CONFIG source arrived.
- After that first GREEN, self-review added a positive control omitting optional
  User-Agent/Connection and named exact later transport gates in N9. The final
  snapshot checks use separate `final-full`, `final-docs`, `final-scope` and
  `final-diff` phase logs/metadata under the same repair prefix; all four passed with exit 0.
  Final fixture validation again passed 53 checks; documentation totals are
  unchanged. No fixture is edited
  during a running gate.

Actual pma-cr local DESIGN review used the core and backend fixture policies.
The review read the entire changed functions and callers, complete N1–N10
contract and existing device/server sequence checks. It verified:

- Receipt recovery checks device role/ID before return, keeps current G/epoch,
  old key, next key, request ID and exact body digest fences, and remains a
  read-only exception after report-key overlap. Ordinary fresh renewal still
  requires the current unexpired key and the issuance-relative 24-hour floor.
- Complete ordinary-header allowlisting and case-insensitive duplicate refusal
  precede schema/auth; HTTP/1.1 authority and HTTP/2 pseudo-fields are bound to
  configured origin/method/path. Optional headers survive schema validation.
  Cookie/command/transfer headers, invalid version, null/malformed values,
  wrong authority, duplicate singleton fields and excessive sizes are refused.
- Existing first-writer/CAS, release/revocation ordering, atomic report receipt,
  counter/queue crash model and bounded retry behavior remain intact. Report
  acknowledgements still require authenticated exact bindings before retirement.
  Body allowlists, off/reset autonomy and separate OS/application trust are unchanged.

| Severity | Repair 1 remaining findings |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

**Repair 1 verdict: PASS for DESIGN.** These are schema/decoded-envelope,
ephemeral signature-byte and symbolic state-model checks. No deployed-service
vulnerability, real transport/HPACK decoder, filesystem durability, TLS interop
or physical power-cut proof is claimed. Future production implementation,
external repository/operations decisions, deployment and OCI remain unapproved.
The completed task/plan status and existing serializer claim are retained.

English history note for workstream D: Repaired special renewal receipt
principal binding and aligned the strict request header schema with permitted
HTTP/1.1 envelopes and explicit HTTP/2 authority checks. Recorded independent
RED evidence, expanded the design gate to 53 checks, and preserved the original
46-check history and implementation/deployment boundaries.

Final snapshot source: `e0c43478f84cb2d43ddda197d7c59b063655da99`, dirty diff
SHA-256 `522cbd5eea6ecfd86a63a98b77f09efe9c66ed8c68d6f70deba8edc471e73b47`.
The final fixture gate ran at `2026-09-10T20:19:07.262450+00:00`, PID
`1439982`, ended `2026-09-10T20:19:07.762623+00:00`, exit 0.
Fixture manifest SHA-256:
`8e592147677b1663ae225293f743a00ec5a234f00c8eb8caa0855da980d915f4`.

- `protocol.schema.json` SHA-256: `97026ec21bbc8c1b012197dd85286a9d2c61bb1780bbb2fc9d8d65ab891be3c4`.
- `exchanges.json` SHA-256: `ff035cb66173a4aca99d88fce3a75ec2106374c8f77e7f9b1932bb42ba07bf06`.
- `validate.mjs` SHA-256: `7f5d9007a266270fe26a746fa3d4b3390033f787d071e03d31ad1f2442166c40`.

Only this task's result notes were refreshed after the final snapshot gate;
protocol and fixture bytes are unchanged. Staged whitespace/scope and own
tracking links are checked again before the scoped local commit. Final HEAD
and parent identities are supplied through the single L2 review handoff.
