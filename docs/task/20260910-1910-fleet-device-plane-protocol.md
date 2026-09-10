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
