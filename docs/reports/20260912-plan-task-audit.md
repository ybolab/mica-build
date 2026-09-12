# Plan and task implementation audit — 2026-09-12

The main software paths are implemented, and the fresh x64 build now has
retained QEMU acceptance evidence. The principal remaining obligations are
current ARM images, physical-board qualification, independent cold-build
reproducibility, and the unimplemented fleet, managed-application and package
repository work. Task markers do not reliably distinguish these boundaries.

## Scope and evidence boundaries

- Report snapshot: `d100baefa0e86a5ab6868a6aa0d4fa7d3e701375` on local main,
  observed at 2026-09-12 13:32 UTC, with a clean working tree before this report.
- Initial audit baseline: `24fb01d069f1ab8fcf429a4939dd413bde0693e6` plus the
  then-present working-tree changes. Its focused test results retain that
  identity; they are not new tests of the report snapshot.
- Inventory: 72 plan detail files and 116 task detail files, excluding indexes.
  The initial audit had 71 plans and 115 tasks; the subsequent ARM build plan
  and task account for the increase.
- Method: inventory records, group related obligations, trace current source,
  callers, packaging and tests, execute focused checks, then separate source
  delivery from artifact and runtime acceptance. The inventory is exhaustive;
  the code review is grouped and risk-focused, not a line-by-line review of
  every historical change or a rerun of every record's acceptance procedure.
- Development requires no backward-compatibility guarantee unless explicitly
  requested. Removed RAUC/TUF readers, old layouts and old update formats are
  not outstanding implementation work. Current hardware constraints and
  signature/storage contracts still apply.
- This report changes no product source, task ownership, status marker or
  execution authorization. Historical campaign dispatch and resource grants
  are not instructions to resume work.

The report refresh corrects one material result of the initial audit:
`clean-x64-diagnosis` is now complete within its stated x64 scope. The new
completion record and retained logs were inspected before writing this report.
No image build or guest test was rerun for the report.

## Repository audit findings

### P0 and P1

No new P0 or P1 source defect was confirmed in the inspected scope. This is
not a repository-wide security certification or a hardware qualification.

### P2 — Fixed build-job limits remain after the removal task

The resource-limit removal plan (20260912-1113-remove-build-resource-limits)
is completed and states that no fixed build limits remain. The two changed
launchers do remove their Docker and Cargo ceilings, but other executable
build paths still impose fixed compiler parallelism:

| Source | Remaining constraint |
|---|---|
| [Boot-tools Dockerfile](../../pkgs/mos-boot/Dockerfile), lines 48 and 55 | Both x64 and arm64 loader builds use `ninja -j2`. |
| [Boot startup package test](../../tests/boot-startup-package-test.sh), line 104 | Requires `-j2` in the recorded Ninja command, preserving the unwanted policy. |
| [FIT sandbox Dockerfile](../../tests/file-ab-fit/Dockerfile.sandbox), lines 7–8 | Uses `make -j8` for U-Boot and its DTB. |

Impact: the current unrestricted-build policy is not fully implemented; these
builds cannot use the tool's default parallelism. Correct the remaining build
commands and the assertion that demands the cap, then verify both selected
target routes. Decompression memory bounds are a different contract and are
not removal candidates.

### P2 — Documentation gates do not validate the tracking inventory

[Index verification](../verify-index.sh), lines 12–18, and
[link verification](../verify-links.sh), lines 16–20, explicitly exclude plan
and task records. A green `make docs-verify` does not establish that the
tracking indexes, record status or evidence links are current.

The independent inventory found:

| Inventory | Detail files | Indexed records | Missing indexed targets | Unindexed detail files |
|---|---:|---:|---:|---|
| Plans | 72 | 72 | 0 | None |
| Tasks | 116 | 115 | 0 | RFCT-334 |

Format examples at the top of the indexes were excluded from this count.
Several older tasks also describe missing behavior that current code and
newer tests already provide. This leads to duplicate work or mistaken closure
unless records are reconciled against their replacement implementations.

Recommended correction: restore the missing task index entry and reconcile
the specific stale records below. A small tracking check should validate real
record rows and targets without confusing format examples with live entries;
it cannot replace code and evidence review.

## Software delivery and stale open records

“Implemented” below means a current executable path and its supporting tests
or configuration exist. It does not imply that every historical acceptance
row has passed on every board.

| Records or workstream | Current implementation evidence | Disposition |
|---|---|---|
| PLAN-070, RFCT-315 and C configuration slices | The shared resolver implements operator/effective precedence. [Provisioning route tests](../../pkgs/mosd/apid/src/tests/provisioning_api.rs) cover real isolated documents, absence versus null, invalid-input refusal and redaction. [Source validation](../../rootfs/scripts/validate-public-meta.sh) is called by `rootfs/build.sh`; [packed-root verification](../../verify/src/checks-file-root.ts) independently checks metadata and required native binaries. | Software slices are delivered. RFCT-315's missing-assertion description is stale. Retired anchor formats are superseded, not owed. |
| PLAN-071 automatic update policy | [Automatic update driver](../../pkgs/mosd/mosd/src/update_auto.rs) implements off/check/auto, maintenance windows, fetch/install and reboot decisions. [Daemon startup](../../pkgs/mosd/mosd/src/main.rs), line 462 at the snapshot, starts the driver. | Implemented and reachable. Manual/component-update guest tests do not independently prove every automatic scheduling scenario. |
| PLAN-080 and RFCT-310 container build policy | Existing build wrappers, CI routing and [host-toolchain lint](../../tests/host-toolchain-lint.sh) enforce the producer boundary. The focused lint run passed. | The policy mechanism is implemented. Separate current defects, such as fixed job counts, should not keep the original implementation description open indefinitely. |
| UI interaction refactor and UI chunk split | [Shared confirmation dialog](../../pkgs/mosd/apid/ui/src/shared/components/confirm-dialog.tsx) owns pending/success/failure behavior. Current UI routes and build configuration carry the later interaction and bundle work. | Source implementation exists; no complete UI or browser suite was rerun in this audit. |
| UI-011 coverage aggregation | [Vitest configuration](../../pkgs/mosd/apid/ui/vitest.config.ts) uses Istanbul with thresholds; [package scripts](../../pkgs/mosd/apid/ui/package.json) still run coverage. | The old Bun V8 merger path has been replaced. Current pinned-runtime coverage acceptance was not rerun here. |
| `20260908-2011-ssh-generator-vs-image-policy` | [System package Dockerfile](../../rootfs/packages-src/system/Dockerfile) masks `systemd-ssh-generator` with `/dev/null`; [runtime declarations](../../rootfs/runtime/consumers.json) preserve that mask. | A fix exists. Keep the exact listen-conflict and image-only-key authentication tests distinct from generic boot success. |
| `20260908-2011-state-units-never-load` | [mos-load-extensions.service](../../rootfs/overlay/etc/systemd/system/mos-load-extensions.service) reloads after the DATA-backed unit mount and requests `multi-user.target` again. [Container reconciliation](../../pkgs/mosd/mosd/src/reconciler/container.rs) separately reloads after its bind is active. | A fix exists. The specifically seeded first-boot unit acceptance still needs an explicitly matched result before closing the old task. |
| `20260908-2011-wtmp-unbounded-append` | [Tree surgery](../../rootfs/scripts/pack-tree-surgery.sh), lines 19–23, redirects wtmp/btmp/lastlog to `/run/mos`; [tmpfiles configuration](../../rootfs/overlay/etc/tmpfiles.d/mos-var.conf) creates the volatile targets. | Persistent DATA growth is removed by current policy. Repeated-login and effective tmpfs-bound evidence remain distinct acceptance items. |
| Writable var, unlimited application data and container storage isolation | [DATA layout](../../rootfs/overlay/usr/lib/mos/mos-data-layout), lines 42–58, bounds the variable-data project while setting system/user/container project limits to zero. | Implemented. The retained clean-x64 runtime logs now also cover quota and persistence behavior within their fixture scope. |
| PLAN-089 and RFCT-360 health confirmation | [Health gate](../../rootfs/overlay/usr/lib/mos/mos-health) requires named functional probes, rejects empty/unknown criteria, and does not give every optional service failure a confirmation veto. | Implemented; 79 focused assertions passed. |
| APID power feedback and original reboot investigation | [Power admission handler](../../pkgs/mosd/apid/src/routes.rs), line 7028 at the snapshot, awaits dispatch before 202 and reports refusals. Current tests cover admission failures and unconfirmed timeouts. | Generic software repair and x64 reboot proof exist. The originally affected physical device's cause remains unestablished. |

The three September 8 startup/login tasks should be described as “implemented;
specific acceptance outstanding,” rather than “not started.” They should not
be closed solely from the source inspection above.

## Fresh x64 acceptance: completed within the recorded scope

The clean-x64 task (20260912-1123-clean-x64-diagnosis) records
production source `a6b7b55c61834dd3200bbfbf7807b0e62d888806` and a complete
development image. The report refresh confirmed the image file exists and its
checksum sidecar agrees with the task:

```text
Image: _out/clean-x64/factory/mos-x64-20260912-114332.img
Size:  1881145344 bytes
SHA256 recorded in factory.sha256:
ea5bec779a14c46abbeb664fe29fdcda16cf2faa25192d0e3ec2908612c7295e
```

The image hash was read from the retained sidecar, not recomputed for this
report. The following terminal results were independently read from the
retained logs; they are evidence inspection, not new execution:

| Log under `_out/clean-x64/` | Observed result |
|---|---|
| `rootfs.log` | 12 smoke checks passed; zero failures or executor limitations. |
| `api-acceptance.log` | Final `RESULT: PASS (151/151 checks)`. |
| `actions-acceptance.log` | `NATIVE_ACTION_QMP_PASS` for poweroff and reboot. |
| `reboot-cycle.log` | `REBOOT_CYCLE_PASS` and `REBOOT_CYCLE_QMP_PASS`. |
| `runtime-acceptance.log` | Runtime checks on two boots, plus var and container persistence pass markers. |
| `updates-acceptance.log` | Component update sequence and confirmed-health fallback pass markers. |
| `reset-acceptance.log` | Interrupted configuration, application-data and full-factory reset/retry pass markers. |

The task also records signed-input tamper refusals and package/kernel/firmware
production. Those detailed producer and tamper logs were not all re-audited
for this report. API/action runs use the complete factory image with DATA test
units; storage/update/reset fixtures include probes and isolated fixture keys.
Their evidence must retain those distinctions.

These results close the requested fresh x64 build and diagnosis, not physical
watchdog reset, real storage power cuts, online delivery, every auto-update
scenario, or ARM qualification. A shutdown log that says
`externalActionProof=pending` is not itself QMP proof; the action and reboot
logs contain separate explicit QMP results.

## Implemented work with remaining acceptance

| Records or workstream | Delivered implementation | Remaining obligation |
|---|---|---|
| Signed file A/B plan (20260908-1428-file-ab-signed-components) and x64-first delivery | Signed components, redundant deployment records, native install/fallback, DATA layout, firmware maintenance and the newly observed x64 lifecycle results. | Current ARM integration and hardware-specific recovery, watchdog and storage power-cut matrices. Reconcile each historical P10 row rather than closing the umbrella from x64 alone. |
| B3 and [boot artifact size](../plan/20260911-1927-boot-artifact-size.md) | [Initramfs assembly](../../pkgs/mos-boot/initramfs.sh) ships one static startup executable and one retained shutdown executable, with bounded zstd transport. [Native producer](../../pkgs/mos-deploy/hack/build-deb.sh) builds and checks static ELF outputs. The fresh x64 image now exercises startup and shutdown. | Current ARM production and acceptance, mandatory physical CX cold boot, watchdog and teardown evidence. BusyBox implementation is no longer the missing work. |
| PLAN-086, B4, B5 and B6 runtime composition | [90-pack](../../rootfs/compose/90-pack.Dockerfile) actually calls offline composition/selection, verifies the selected tree and exports scratch outputs. Source lineage, metadata and deterministic packing checks exist. | Independent equal-input cold-build comparison and the remaining ARM/runtime matrix. Passing synthetic reproducibility fixtures or one clean build is not two-build byte equality. |
| [ARM64 board build sequence](../plan/20260912-1329-arm64-board-builds.md) | An active task now sequences virt-arm64, CX3576 and S905X5M. Existing board definitions and build implementations are present. | At the report snapshot the task is preparing the ARM environment. No newly completed ARM package, image or guest result was established by this report. |
| CX3576 watchdog, boot-log cleanup and late-HDMI records; A1–A4 | Current source includes watchdog, resource and display fixes, source fixtures and the acceptance collector. A4 has a bounded historical artifact/evidence delivery. | Exact-current-image cold boot, watchdog handoff/reset/recovery, HDMI/VT interaction, accelerators, radio and actual power-cut evidence. Historical A-only artifacts do not qualify a later combined image. |
| S905X5M current-system plan (20260910-0559-s905x5m-current-system) | Current signed-file SD-first layout, firmware, board/radio packages and verifier paths exist. Historical software/artifact delivery is explicitly scoped. | Current BM201 physical qualification and native crun execution. Complete eMMC OS installation is a separate milestone; `BOARD_RELEASE_TARGET=0` remains. |
| PLAN-912 and RFCT-922 Bluetooth peer interaction | Transport, bridge and BlueZ integration exist. | A controlled peer, actual pairing, profile traffic and persistence on the current image. An empty discovery scan proves none of these. |
| Original-device reboot investigation (20260909-1421-apid-reboot) | Generic API/UI repair and x64 reboot evidence. | Diagnose the originally affected device with its own current image and console/API evidence. |

## Features not implemented as a runtime product

| Records or workstream | What exists | What is absent |
|---|---|---|
| PLAN-054, PLAN-072 and PLAN-076 fleet | Offline desired configuration and its authenticated status projection; a completed [device-plane protocol design](../plan/20260910-1910-fleet-device-plane-protocol.md) with schema/crypto/model tests. | A running registration/reporting client and server chain, credential renewal/revocation, durable report queue and operational service integration. A design-test pass is not network runtime evidence. |
| PLAN-069 managed applications | Podman/Quadlet support and the [managed-application design](../design/applications.md). | The integrated catalog trust, admission, activation and managed lifecycle implementation. Existing container execution does not implement these consumers. |
| [Package repository split](../plan/20260911-2006-split-package-repositories.md) | Proposal and coupling inventory; current producers still build from the monorepo. | The proposed independent package fetch/lock/publish workflow and extracted repository layout. The proposed scripts are absent from `build-env/deb/`. |
| PLAN-077 / RFCT-305 production trust work | Development-grade marker, device grade projection and publication-refusal mechanisms. | Production custody/provisioning evidence and the operational decisions that remain applicable. This is separate from implementing the development system; remote re-anchoring is not an assumed compatibility obligation. |

## Historical and superseded work

- B1/B2 and the original minimal BusyBox feasibility plan describe earlier
  steps. Native static startup/shutdown now replaces that payload route.
  Reintroducing BusyBox to satisfy an old description would reverse the
  current implementation.
- B7 (20260911-0145-b7-fresh-lifecycle-acceptance) was canceled,
  not passed. The clean-x64 successor has delivered its bounded acceptance;
  remaining ARM and hardware obligations must retain active ownership.
- PLAN-078 and the retired RAUC/TUF/raw-slot work are historical or superseded.
  They do not create a requirement to restore removed formats or readers.
- PLAN-037 and the old open-plans campaign are umbrellas. They should summarize
  executable child work and evidence, not create duplicate implementation jobs
  or reactivate canceled dispatch instructions.
- Earlier S905X5M intake, rollback and installer records must be read in their
  historical layout context. Current SD-first and future eMMC obligations
  should use the current signed-file records.

## Needs runtime verification and coverage gaps

The clean-x64 task records a new no-radio diagnostic: `wifiClient` fails while
creating `/etc/wpa_supplicant`, and `wifiAp` reports D-Bus `FileNotFound`.
The [client apply path](../../pkgs/mosd/mosd/src/reconciler/wifi_client.rs),
lines 464–482, renders configuration even when disabled; its writer at lines
360–372 creates the parent directory. This corroborates the recorded client
path, but the full radio-availability and AP failure chain was not re-audited
here. Keep this as a focused follow-up with a no-radio regression and a
radio-enabled acceptance case. Generic x64 API success is not wireless
qualification.

Other limits:

- No Rust workspace gate, complete UI coverage/browser suite, new full image,
  QEMU guest, physical board or fault-injection matrix ran during this audit.
- No physical power-cut or production key-custody evidence was established.
- Specific SSH-generator, seeded-unit and repeated-login obligations need
  matched acceptance results; generic boot/storage passes do not cover every
  named scenario automatically.
- No structural dead-code removal is proposed. Superseded records are not
  evidence that an executable file is unreachable.
- There is no meaningful overall completion percentage: plans overlap, some
  deliver designs, some deliver source, and some require physical acceptance.

## Focused verification executed during the initial audit

All commands below exited zero. They ran against the initial audit worktree,
not the later x64 artifact or the report snapshot. Host Bun was used for the
two selected TypeScript test files; this was not a pinned product rebuild.

| Command | Result |
|---|---|
| `make docs-verify` | Index 195, links 534, truth status 726, translation coverage 249 and board assertions 131 passed. Does not validate the plan/task inventory. |
| `bash tests/health-test.sh` | 79/79 checks passed. |
| `bash tests/host-toolchain-lint.sh` | 428/428 files clean; zero findings within the lint's declared detection scope. |
| `python3 tests/rootfs-runtime/selection_test.py` | 87 tests passed. |
| `bash tests/rootfs-runtime-test.sh` | 135 composition tests and `ROOTFS_REPRODUCIBILITY_PASS`; fixture evidence only. |
| `bun test verify/src/checks-file-root.test.ts` | 271 tests passed. |
| `bun test build/src/public-meta.test.ts` | 61 tests passed. |
| `node tests/fleet-protocol/validate.mjs` | 53 static/schema/crypto/model checks passed; no fleet service exercised. |
| `bash tests/cx3576-bench/collector-test.sh` | Collector fixtures and 39-row report contract passed; no board accessed. |

Local transcript identities, retained as audit evidence rather than permanent
repository dependencies:

```text
/tmp/mos-plan-audit-checks.log
SHA256 a403ea2170c85bd504b71ab11f6b6cd689843b2b78290370dcce9bd16d966afa

/tmp/mos-plan-audit-extra.log
SHA256 4d65706fd4c5cadebae001d8f67bfcd0bf34151dba7848503556a5abd16585c1
```

## Recommended next actions

1. Remove the remaining fixed compiler-job limits and correct the assertion
   that requires `-j2`; verify both loader target routes and FIT build syntax.
2. Preserve the completed clean-x64 source/artifact binding. Continue the
   already-active ARM sequence, recording each board's actual build and guest
   result without treating compilation as hardware acceptance.
3. Resolve the no-radio reconciliation diagnostic with a reproducing test and
   focused acceptance; retain the distinction between optional subsystem
   health and the required boot-confirmation probes.
4. Reconcile old task descriptions against delivered replacements and the new
   x64 evidence. Keep seeded-unit/SSH/login, cold-build and physical-board
   acceptance rows explicit; restore RFCT-334's index entry.
5. Execute independent reproducibility and board matrices with current input
   identities, including Bluetooth peer traffic and actual storage power cuts.
6. Schedule fleet runtime, managed applications and repository extraction by
   product priority and their own approved scope. Do not count completed
   protocol or feasibility documents as these implementations.
