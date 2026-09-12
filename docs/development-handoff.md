# Development-machine handoff and remaining work

Snapshot: 2026-09-12 10:19 UTC. Campaign: `mos-open-plans-20260910-100408`.
The user requested source integration and a handoff, with remaining work to
continue on a new development machine. This document supersedes earlier
instructions to keep executing on the old machine.

## Source and execution checkpoint

- Reviewed source is merged into local `main` at
  `4a451011c02eb5dfe8a863aca05c30c05b50b1a7`, tree
  `97cf552a3773d08f25e1244ff557ea15b119d8f8`.
- The last reviewed B branch is `3a5127d5c4dc55cd8463d51dfa8e5833923f74a2`;
  B7 is `8b4fd0807c210d5267d4e5763a9ba77795c4f4e1`. Both are ancestors of
  main. No committed local branch remained unmerged at this checkpoint.
- The eight-file GPT/source-admission integration passed 31 lineage regression
  tests, TypeScript typecheck, shell syntax, documentation and whitespace
  checks. Existing source-bound GPT and actual producer tests were retained.
- L1 watchdog `gb4a328c` is paused, not deleted. L1 is `review/cancelled`
  after a requested soft interruption, with no pending messages. B/B7 have no
  live execution or build. The old machine must not resume automatically.
- The documentation commit containing this handoff does not change artifact
  identity. No push, publication, full guest qualification or completed
  physical acceptance is implied.

## Remaining work, in execution order

| Item | Owner / existing record | What remains and what counts as completion |
|---|---|---|
| Restore the execution environment and correct the stale reservation | B7 `#332` / `75btxdqb`, B `#316` / `8t4ghqi6` | Restore the inputs below and check their hashes. The task adapter still reserves 22 GiB: 10 GiB for B7, 10 GiB for a historical second worker, and 2 GiB margin. The second reservation has been released; the current maximum simultaneous allocation is 4 CPU / 10 GiB. Implement and review the precise reservation correction with positive/negative checks, keeping actual container totals, daemon headroom, CPU, disk, cleanup and no-extra-swap checks. This correction has been investigated but not implemented. Measure the new host before starting anything. |
| Finish x64 components and the new complete image | Same B7; [acceptance task](task/20260911-0145-b7-fresh-lifecycle-acceptance.md) and [plan](plan/20260911-0145-b7-fresh-lifecycle-acceptance.md) | Reuse the accepted root and its signature. Run only the unstarted kernel/support and firmware component stages, then produce signed deployment records and one complete timestamped x64 image. Pass provenance, signatures, tamper rejection, component closure, layout/readback and the fixed C verifier. Existing kernel output is an input, not a request to recompile Linux. |
| Complete x64 guest acceptance | Same B7, reviewed by B | Boot an isolated copy of that exact image on larger media, confirm SYSTEM discovery and DATA growth after the GPT correction, and complete normal reboot/poweroff/halt, update/fallback/reset, authenticated API phases, storage/service checks, memory/size measurements and required refusal cases. The earlier guest failed before APID; no API phase passed. Partial-startup cleanup is not normal shutdown acceptance. |
| Run the final ARM batch | Same B7 after a stable, accepted x64 baseline | Produce one virt-arm64 image and one joint CX3576 image from the reviewed source. Run virt guest/lifecycle checks and compare two independent equal-input cold roots; the first root supplies the image and the second proves reproducibility. Reuse verified kernel/firmware/packages only when their relevant inputs match. Keep virt-arm64 non-release status and the formal release CLI refusal. No new S905 image or eMMC installer is included. |
| Finish boot-size qualification | `#347` / `vhqwow6o`; [boot-size plan](plan/20260911-1927-boot-artifact-size.md) | All five implementation phases are merged. Complete the full-image startup/shutdown and retained-memory evidence through B7, then the mandatory CX ZSTD physical cold boot. Existing static ELF, small kernel fixtures and signed-payload tests do not close these rows. Keep the plan open until those results exist. |
| Qualify actual boards | A `#315` / `6064wf7l`; [current matrix](task/20260910-1014-a2-cx3576-acceptance-matrix.md) | Identify the bench, serial/API endpoint, flashed image, storage medium and power control. Collect the 38 required CX rows: startup, watchdog, recovery, update/physical interruption, storage and board functions, including HDMI hotplug/VT return. NPU ownership/qualification and native crun remain unresolved. Current S905 and the original APID reboot device also need physical evidence. Historical HDMI panic display is optional/superseded, not a mandatory new feature. |
| Reconcile final records | D3 `#335` / `55lngbuq`, D `#318` / `z36xbrtu`, L1 `#314` / `10nksom6` | Reconcile the existing task/plan/index/changelog records against actual final results. Keep source, root, full image, guest and physical outcomes distinct. Align B3's historical in-progress PMA record with its delivered x64 software scope while retaining B7's runtime/ARM obligations. Record later fixes and reviewed main integrations. Do not turn pending tests into PASS or close the campaign early. |

The source changes required by a newly discovered defect must be committed and
reviewed before their affected outputs are rebuilt. Preserve prior failures;
do not rerun successful producers just because main acquired another commit.

## What is already delivered

A's encoder OPP and HDMI/VT repairs, current acceptance matrix and original CX
candidate; B0-B6's audit, static tools, startup/shutdown, explicit runtime
selection, composition/provenance and no-cache work; C's completed nine-node
delivery; D1/D2 and interim D3 tracking are in main. C includes public metadata
checks, real provisioning coverage, offline fleet desired configuration and
the device-to-plane protocol design. The UI, writable storage and S905 signed
SD software delivery are also committed.

The current x64 checkpoint has stronger evidence than the old full image:

| Identity | Value / qualification |
|---|---|
| Composition source | `ae40a791d763830a8e4a7cd7b0bb83a8b8945902`, tree `e2ea87818636e931117f8c7b07f5372d5cf864aa` |
| Rebuilt native/deploy source | `d2e352d0a4226f10b8b2587cd7c1bc5040b8d234` |
| Reused package source | `e176876b733d675d1e20b40b42628cd4e18b197d`; 14 unchanged packages plus the rebuilt deploy package |
| Reused boot-tool source | `438c9551ec751fcb346881541752a7596f10cb15`; do not relabel these tools as the native source |
| Canonical lineage SHA-256 | `a54c66c0d5b82f66389bf53ba86bcdf66e41e375341d9aa040f257e4187546a8` |
| Root OCI | 80,730,112 bytes; SHA-256 `822dc6a2fadd6a8e13f89dd9399a0cbf72f79ba2d78c6a7baf85d4793fe0b2ab` |
| Actual root result | 08:40:30 UTC exit 0; 261 packed files checked; 12/12 packed-binary smoke passed |
| Signed root image | 71,200,768 bytes; SHA-256 `f651ba2e03db9a3ebdaa649e75beb71c846d6793306478ff75e0353ea9deeb4f` |
| Root verity root hash | `76617bf9a4fb21cbcf544bc2aeb80d4c9b4cf60ad7818b4896cd82b130096a09` |
| Root signature SHA-256 | `bac4abb76c0034f9634b5947f4efbb1c479788bc5d01fb839361f54e20ea0beb`; independently verified against the existing public trust |

The older complete x64 image `mos-x64-20260912-052246.img`, SHA-256
`ca6bdd50cad6c3dc2e93160316316092c84cc0da995f022909014e36556037b9`,
uses `ed7231cd` and failed GPT discovery after its disposable medium grew.
Keep it as historical evidence; it is not the corrected image. The earlier A
CX image `mos-cx3576-20260911-012036.img` is likewise an A-stage delivery,
not a joint image containing all later B changes.

## Transfer material

The local handoff directory is `_out/machine-handoff/20260912-1019/` under
`/srv/mos`. It contains the Git bundle, checkpoint, campaign evidence archive,
transfer inventory and checksums. These files are ignored build/coordination
material, separate from this committed document. Consult its `inventory.json`
for the actual packaged contents and exclusions.

Large artifacts and private signing material require separate transfer; the
small handoff package is not a complete build-cache or image backup.

| Material | Old-machine location / handling |
|---|---|
| Source and local refs | `/srv/mos`; use the handoff Git bundle if the remote lacks these local commits. The bundle carries committed history, not worktree modifications. |
| Active execution outputs and inputs | `/srv/bkd/worktrees/33z9aa5q/75btxdqb/_out/`; preserve the complete current wave, including its isolated source snapshots, pools, native/kernel/tool outputs, input receipts and prepared execution adapters. |
| Main output store | `/srv/mos/_out/`; retain referenced original board artifacts and transfer inputs as needed. Do not assume these ignored files are included by Git. |
| Reviewed A artifacts for later CX reuse | The A4 record's external composition snapshot under `/srv/station/work/tmp/mos/1zjiu5h5/` exists. The historical `/srv/bkd/worktrees/33z9aa5q/1zjiu5h5/_out/` path is absent at this checkpoint. Locate the referenced Image/DTB/modules, firmware and source evidence in the surviving snapshot/current wave before transfer, or explicitly rebuild missing inputs later. |
| Campaign receipts | `/tmp/mos-open-plans-20260910-100408/`; archived in the handoff directory because `/tmp` is not durable. Some receipts reference other task-specific temporary files; the inventory lists the known external locations, not an exhaustive dependency closure. Inspect the selected continuation receipts before deleting the old machine. |
| Development signing identity | The top-level wave's `trust/` and current candidate's `private/W3/`, plus any source paths named by signing-input receipts. Transfer privately and verify against the recorded public anchors; do not commit keys or generate replacement keys to bypass missing input. |
| Docker execution environment | Preserve pinned image identities and any task-owned cache volumes that will be reused. Images/volumes and live container IDs are not part of a Git bundle. Recreate the executor and measure the new host; old PID/cgroup observations are historical evidence. |
| Historical uncommitted work | `legacy-247-unmerged.patch` preserves the six old changes from `bkd/zpqc1v2a`. They are excluded from main and the active candidate. Do not apply this obsolete RAUC-era tooling patch as part of the migration. |

Keep the same absolute `/srv/mos` and BKD worktree paths where practical.
Receipts and prepared scripts use absolute paths. If paths change, adapt the
execution layer and record new execution evidence while preserving immutable
artifact contents and their original source identities. Recreate linked
worktrees from Git before restoring their ignored outputs; copying a worktree
alone does not copy its external Git metadata.

## Resume on the new machine

1. Verify the handoff checksums and Git bundle. Restore the latest bundled
   `main`, read this document and the existing B7 task/plan, and check for later
   user decisions before treating this snapshot as current.
2. Recreate the B7 worktree at its recorded commit and restore its ignored
   outputs. Check all referenced source snapshots, archives, public trust and
   private signing inputs. A missing cache may be rebuilt; a missing signature
   identity or unverified artifact must not be silently substituted.
3. Use the prepared `components-v4` runner and readiness receipts as the
   continuation specification. Its old container IDs, host capacity and
   one-shot output names need a fresh execution setup. Correct the stale
   reservation with focused refusal tests before a launch. Do not overwrite
   existing failed or successful metadata.
4. Finish only kernel/support and firmware, followed by the new image and x64
   guest scenarios. The accepted root and signature must be reused unchanged
   unless a newly reviewed source/input change actually affects them.
5. After x64 is accepted, schedule the one ARM batch and physical evidence.
   Complete D3 reconciliation from these real outcomes.
6. Reuse the existing issues if BKD project state is migrated. Otherwise create
   the minimum coordination needed and retain this campaign/owner mapping as
   history. Do not restore all completed workers or duplicate the old DAG.
   Resume at most one L1 watchdog after explicit continuation; routine progress
   stays internal, with user messages only for real decisions.

The prepared runner is below B7's wave directory:

```text
wave/e176876b733d675d1e20b40b42628cd4e18b197d/
  Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/
    GptJoin-ae40a791d763830a8e4a7cd7b0bb83a8b8945902/
      tools/components-v4/run.py
      tools/components-v4/readiness.json
      metadata/successor-readiness-v2.json
      metadata/W3/components-run3-terminal.json
      artifacts/W3/root-v2/
```

Runner SHA-256:
`2d6b5d5aea5d59fe9467fce04388b0452fd53971437dc3bb9b93a2e36cd2693c`.
Its adapter is under `tools/components-v3/`. The reservation investigation is
in campaign evidence directory `L1-memory-guard-investigation-bpzheu1a/`.

## Preserved constraints and separate future proposals

- Development only: fresh complete images, no old-system compatibility or
  migration code. SYSTEM stays 1 GiB and holds only the supported deployments
  and required deployment metadata; download/validation staging stays on DATA.
- `/mos`, `/srv` and the separate container storage remain unlimited by the
  application quota; writable `/var` retains its own bounded policy.
- Keep the approved static startup/shutdown, authentication, signed trust,
  bounded watchdog and safe storage cleanup. Python tooling is build-side;
  this handoff does not introduce target Python or revive RAUC/lode.
- The UI shell-pipefail baseline failure is preserved in earlier evidence;
  this handoff neither retests it nor claims it was repaired.
- [Package repository separation](plan/20260911-2006-split-package-repositories.md)
  is a written draft, not implemented or approved by this handoff. Topology,
  repository names and registry/tool-image inputs still need resolution.
- Fleet client/server implementation and managed OCI activation are not part
  of the remaining authorized campaign. The protocol design and offline
  desired configuration are delivered; no cloud service has been enabled.
- The old P2 issue `#305` was stopped with no owned implementation. Reconcile
  its bookkeeping against the work already delivered; do not restart a second
  P2 implementation from that old branch.

This handoff completes documentation and preserves a restart point. It does
not mark any unfinished implementation or acceptance obligation completed.
