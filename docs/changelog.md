# Changelog

## 2026-09-12 20:43 [decision]

Added draft plan and task `20260912-2043-unify-board-behavior` for shared board
compression, zstd delivery, signing-role checks and lifecycle acceptance. The
proposal preserves UEFI/FIT backends and current trust identities, requires an
ARM64 EFI zboot proof, and keeps physical acceptance distinct from build results.
No implementation is approved or performed by this documentation change.

## 2026-09-12 14:31 [progress]

On `git.ds.cc`, renamed repository `ybolab/mos` to `ybolab/mica-build` and
created the private, empty repositories `mica-build-env`, `micad`,
`mica-deploy` and `mica-podman` under `ybolab`, as the user authorized.
`origin` now points at `ybolab/mica-build`. No content was pushed; the split
plan's Phase 0 keeps the throwaway registry round trip and the runner check.

## 2026-09-12 14:24 [decision]

The project is now Mica OS; the split plan's repository names follow it:
this repository becomes `mica-build`, the substrate `mica-build-env`, the
package repositories `micad`, `mica-deploy` and `mica-podman` (replacing the
`mos-` names recorded at 14:06). Package, binary and workspace names inside
the tree are unchanged by the plan; renaming the Gitea repository and
repointing `origin` is added to Phase 0.

## 2026-09-12 20:35 [decision]

Closed the remaining signed-file delivery and cx3576 watchdog records at the
user's direction and removed the dead coordination shells; per the index rule
the closed records left the tree.

- Completed and deleted: 20260908-1423-file-ab-signed-components (task),
  20260908-2229-file-ab-delivery-x64-first (task),
  20260908-1428-file-ab-signed-components (plan) and
  20260909-2331-cx3576-boot-watchdog (task and plan). Software delivery is
  complete on x64 and the ARM images are built. Physical CX3576 startup,
  watchdog, recovery and power-cut evidence is not claimed by this closure and
  currently has no record of its own.
- Closed and deleted: 20260909-1421-apid-reboot. The generic dispatch and
  feedback repair is delivered and x64 reboot is proven; the originally
  affected device was never supplied, so that diagnosis is dropped.
- Closed and deleted as abandoned coordination: RFCT-273 and
  20260910-1013-open-plans-campaign (task and plan). The bkd campaign dispatch
  has been inactive since 2026-09-12. PLAN-037 stays as the roadmap umbrella.
- Shipped documents that linked the x64 delivery record now name it as text;
  seven truth-status lines dropped it from their evidence lists and keep their
  other citations.

## 2026-09-12 14:15 [progress]

Repointed `origin` to `ssh://git@git.ds.cc:33/ybolab/mos.git` and the
`cx3576-alpine` citations in the BSP documents to the renamed organisation.
Rewrote plan `20260911-2006-split-package-repositories` as a current-state
document: the six bindings, the coupling inventory, the probed forge facts,
the `mos-` repository set, the lock and join retirement, gate relocation and
phases; removed the draft narrative, closed decisions and superseded
alternatives, which stay recorded in the 13:57 and 14:06 entries above.

## 2026-09-12 14:06 [decision]

Package repository split: the user chose one repository per package, all
named with the `mos-` prefix (`mos-build-env`, `mos-mosd`, `mos-deploy`,
`mos-podman`). Evaluated OCI images against Debian archives as the package
format: both registries exist on `git.ds.cc`, but an image drops the
shlibdeps dependency contract, the install-closure gate, maintainer scripts
and the dpkg ownership that runtime selection and provenance read, while the
lock already gives a digest per archive. Archives stay; OCI remains the
builder-image and composed-root export format.

## 2026-09-12 14:54 [completed]

Completed signed virt-arm64, CX3576 and S905X5M full images and update archives,
plus the S905X5M recovery package. Static checks passed 104/126/105 respectively
(virt-arm64 skips its undeclared Bluetooth policy); QEMU API passed 149/149 and
verified real ARM64 reboot, persistence, poweroff and crun execution. Physical
board acceptance remains unexecuted. Corrected boot-tool architecture/PE
extraction and runtime closure omissions. Reused 21 frozen ARM64 packages and
successful kernel/firmware inputs with verified composition-only lineage.
Task and plan: `20260912-1329-arm64-board-builds`.

## 2026-09-12 13:57 [progress]

Revised plan `20260911-2006-split-package-repositories` against `7742a596`,
planning only. Since its first draft the tree gained a fixed producer join
(hard-coded commit, pool, receipt and native-executable digests in
`source-lineage.py` and `release-manifest.ts`), which is the plan's lock
mechanism done once by hand; the plan now retires it in Phase 1 and publishes
`mos-init`/`mos-shutdown` as a `mos-lifecycle` archive. Probed Gitea with the
exported token: version 1.26.1, organisation renamed `miehq` to `ybolab`,
Debian registry enabled and empty, no target repositories yet. Coupling
inventory re-counted at 100 files. Approval still pending.

## 2026-09-12 13:49 [progress]

Opened task and plan `20260912-1347-root-closure-reduction` from the
root-closure research report, planning only. The plan re-measures the current
x64 dev root (200.4 MB unpacked, 71.2 MB shipped) and records eight
corrections to the report: the health gate fails rather than skips without
curl, purge residue is down to one path, the five Rust binaries span two
workspaces, a multicall crosses four packages, `gconv` exclusion needs both
`select.py` and a pack script, and the curl, openssh-client and iptables items
fall under the declined PLAN-086 S5. In scope: mosd release profile with a
measured multicall prototype, `gconv` exclusion, e2scrub and `dpkg-realpath`
removal. Awaiting approval.

## 2026-09-12 13:45 [decision]

Pruned the settled tracking records identified by the plan and task audit
(`docs/reports/20260912-plan-task-audit.md`): 53 plan and 93 task detail
files whose own status heads read completed, closed or rejected left the tree
with their index rows, per the index rule that a finished record is deleted.
Every record remains in git history
(`git log --diff-filter=D -- docs/plan/ docs/task/`). No open record was
closed or reclassified; the audit's remaining obligations (current ARM and
physical-board qualification, independent cold-build comparison, Bluetooth
peer traffic, storage power cuts, the no-radio Wi-Fi diagnostic, fleet
runtime, managed applications and the repository split) stay with the open
records and the audit report.

- Completed plans: PLAN-078, 080, 085, 087, 088, 089, 911, 914, 917-926,
  20260908-1702-pma-project-injection, 20260910-0047-cx3576-hdmi-fullscreen-logo,
  20260910-0159-cx3576-uboot-console, 20260910-0517-writable-var-regdb,
  20260910-0555-apid-spa-interaction-refactor, 20260910-0559-s905x5m-current-system,
  20260910-0616-cx3576-storage-display-cleanup, 20260910-0726-unlimited-application-data,
  the C slices (20260910-1012 x2, 20260910-1046 x2, 20260910-1050 x3,
  20260910-1221-c-offline-fleet-config), 20260910-1013-b0-lifecycle-rootfs-audit,
  A1-A4 (20260910-1014), B1 (20260910-1038), B2 (20260910-1142), B4 (20260910-2100),
  B5 (20260910-2152), B6 (20260911-0110), 20260912-0614-development-workflow, 20260912-1113-remove-build-resource-limits
  and 20260912-1123-clean-x64-diagnosis.
- Rejected or closed plans: PLAN-910, 913, 915, 916 and B7
  (20260911-0145-b7-fresh-lifecycle-acceptance, canceled; the clean-x64
  record delivered the bounded x64 acceptance in its place).
- 20260910-0341-minimal-boot-shutdown (draft) was rejected and deleted as
  superseded: the native static startup/shutdown route under
  20260911-1927-boot-artifact-size replaced the BusyBox payload, as the audit
  records for B1/B2; reintroducing BusyBox would reverse current work.
- Completed tasks: RFCT-334 (completed but unindexed; deleted rather than
  re-indexed), 335, 343-360, 910-915, 917-920, 923, 924, 927-931, 933,
  935-939, 942, 943, 946, 947, and the timestamped records paired with the
  plans above plus 20260908-1712 P1-A/P1-B, 20260908-1727-status-gate-plan-naming,
  20260908-2115-p2-descriptor-contracts-x64, 20260909-2358-cx3576-system-1g,
  20260910-0040-strict-file-ab, 20260910-0254-cx3576-integrated-image,
  20260910-0338-minimal-boot-shutdown, 20260910-0350-cx3576-latest-boot-review
  and 20260910-0836-apid-ui-chunk-split.
- Closed tasks: RFCT-921, 926, 932, 944, 945 and the B7 task.
- Kept although completed: 20260910-1910-fleet-device-plane-protocol. It is
  the only normative home of the fleet protocol design (N1-N10) and
  `tests/fleet-protocol/fixtures.md` cites it as the contract; it stays until
  that design moves under `docs/design/`. Its task record was deleted.

Links to deleted records in `docs/changelog.md`, `docs/bsp/`, `docs/reports/`,
`tests/` and the open records became bare names. Three `cx3576-bench.md`
evidence citations dropped the deleted A2 and storage-cleanup records; the
document-level line now cites `docs/bsp/cx3576-example.md` and
`tests/cx3576-bench/collector-test.sh`. `rootfs/runtime/source-lineage.py`
and `build/src/release-manifest.ts` still name the B7 records in their frozen
producer-transition allowlists; those describe historical commits and were
left unchanged. Recorded under 20260912-1341-prune-settled-records.

## 2026-09-12 13:36 [fix]

ARM64 UEFI components now select the ARM64 boot-tools image for packaging and
record that image in kernel identity. A firmware-invocation regression failed
before the fix and passed afterward. Removed fixed bootloader Ninja job limits
under the existing build-resource policy. Docker route, native-payload, display
and startup archive checks passed. ARM/board production acceptance is pending.

## 2026-09-12 11:57 [verification]

Completed the fresh main x64 build at `a6b7b55c6183` using pinned Docker tools
and new development identities in ignored `meta/`. Produced the signed complete
image and update archive; root smoke passed 12/12 and real API acceptance
151/151. Native shutdown/QMP actions, same-VM reboot persistence, storage,
component update/fallback and all three interrupted-reset tiers passed.
The clean-x64 task records exact artifact hashes, measured sizes and evidence.
No-radio Wi-Fi reconciler errors remain a diagnostic follow-up. ARM, physical
hardware and unexecuted fault matrices are not covered by this result. No push.

## 2026-09-12 11:33 [progress]

Added `make os-keys-init` for idempotent development signing initialization in
`meta/`, using the existing three-domain generator in Docker. Existing keys
are validated without replacement; partial, mismatched, symlinked and unsafe
permission inputs fail. Fresh/repeated/concurrent and refusal tests passed,
as did documentation, shell and host-toolchain checks. A new development
identity was generated locally for the clean x64 rebuild; keys remain ignored.

## 2026-09-12 11:23 [decision]

The user canceled handoff continuation and requested a clean current-main x64
rebuild. Removed the handoff document and replaced B7 execution diaries with
closure notices; old dispatch instructions are inactive. Old filesystem outputs
were moved outside the project after force-removal was rejected. Dedicated MOS
Docker cache, containers and compiled images were removed. Product source edits
remain intact; no historical or new runtime acceptance is inferred.

## 2026-09-12 11:14 [decision]

Removed fixed Docker CPU/memory/swap caps and the four-job Cargo override from
the deploy builder and boot/shutdown fixture runner at the user's request.
The project build policy and handoff now supersede historical B7 resource
envelopes, job ceilings and reservation requirements; historical execution
evidence remains intact. Shell syntax, local diff review and all five
documentation checks passed. No full rebuild was needed.

## 2026-09-12 10:19 [progress]

Reviewed GPT startup/source-admission changes and their accepted root/signature
records are merged into main at `4a451011`. The user requested continuation on
a new development machine. The L1 watchdog is paused and its read-only turn
was stopped; no build or guest was interrupted. The development handoff (subsequently removed)
records remaining components, x64/ARM/physical acceptance, the stale two-job
memory reservation, source/artifact identities and transfer requirements.
No incomplete acceptance result is promoted to PASS.


## Development source integration and workflow (2026-09-12)

Reviewed native startup/shutdown, explicit runtime composition and campaign
cleanup are integrated into local main. Source review, signed-image production
and full runtime qualification now have separate status. The existing x64
candidate remains immutable while its guest acceptance continues.

The development runbook batches preflight checks, reuses unchanged verified
producers and resumes affected stages automatically. One half-hour campaign
watchdog replaces duplicated periodic review scanning; recovered fixture or
transport errors retain evidence without requiring individual approval.

## S905X5M signed-file development images (2026-09-10)

The S905X5M port (20260910-0554-s905x5m-current-system) now produces
current signed SD images using paired MOS firmware in eMMC boot0. Native records
at 120/124 MiB, required FIT verification and independent firmware receipts
replace the retired cfgload/raw-slot path. Root/kernel updates preserve firmware;
only DATA grows. Wi-Fi and Bluetooth remain independently selectable, with shared
SDIO transport, protected pairing state and an optional BM201 front panel.

The kernel embeds content/regulatory trust and fixes the vendor watchdog for
userspace ownership, a 60-second timeout and NOWAYOUT. Final firmware/FIT and
content signatures, 104 offline image checks, interrupted transactions and real
DATA-only growth passed. ARM64 root smoke has 11 passes and one known crun
emulator limitation. Physical board acceptance remains pending and the board is
excluded from qualified releases. No compatibility migration is supplied.

## Split apid console chunks (2026-09-10)

The approved bundle split (20260910-0836-apid-ui-chunk-split) groups the
console's vendor libraries into React, Base UI, router and i18n chunks that the
browser fetches and compiles in parallel, and removes a route re-export that had
hoisted the whole system page into the entry. The entry chunk falls from 594 kB
to 106 kB and no chunk trips Vite's size warning. On an appliance the saving is
parse and compile time on a weak core; the bundle is served from local flash, so
transfer was never the cost. The policy gate now refuses a route module that
exports anything but its route, which is the mistake that caused the hoist.

## apid console rebuilt on the shadcn registry (2026-09-10)

The approved console refactor (20260910-0555-apid-spa-interaction-refactor) (20260910-0555-apid-spa-interaction-refactor)
replaces the hand-written component layer with shadcn `base-nova` primitives over
`@base-ui/react` and extracts a shared composite library the feature pages
consume. Sixteen registry primitives were added through the CLI and fifteen
composites built on them; `src/components/`, the duplicate `cn`, the `lib/api`
re-export and 500 of 591 stylesheet lines are gone, and the remaining stylesheet
carries only tokens, in oklch, plus two decorative marks. No dependency was
added: the toast is `@base-ui/react/toast` through the registry's own wrapper.

Eleven confirmations had each re-derived the same interaction and ten never
closed their dialog, because `base-nova` leaves closing to the caller by design;
they are now one `ConfirmDialog` that owns the close, the pending state and the
report. Every write reports success as well as failure through one toast
channel, replacing 94 inline callouts of which only eight ever said a write had
worked. Dialogs are bounded by the viewport and scroll their own body, so a
1024x520 panel no longer clips the title off the top and the buttons off the
bottom. The language picker left the header menu, which used to stay open behind
its own backdrop.

`verify-ui-policy.sh` now enforces the library rule in `build.sh --check`: no
forbidden UI ecosystem, no hand-written primitive, no raw control or colour
literal in a feature, and one component tree. Coverage measures the application
rather than a seven-file allowlist — 82% of statements over 1,593, against a
previously reported 97% over 208. Tests went from 154 to 232, plus 22 browser
cases; three visual baselines were regenerated for the deliberate `base-nova`
spacing change. Two defects were found by browser measurement during the work: a
menu label outside a group crashed the settings menu, and the header controls
rendered white on white.

## Unlimited system, user and container data (2026-09-10)

The quota correction (20260910-0726-unlimited-application-data) removes byte and inode limits
from /mos, /srv and container storage while retaining independent directories
and project accounting. Only the variable-data project remains bounded. There
is no aggregate quota-backed DATA reserve. Focused layout and real ext4 writes
verify the new policy; previously delivered flash images retain their old limits.

## Independent container storage and CX3576 presentation (2026-09-10)

The approved continuation (20260910-0616-cx3576-storage-display-cleanup) (20260910-0616-cx3576-storage-display-cleanup)
gives container images, layers, volumes and download temporary files a dedicated
DATA directory, bind and project quota. Three bounded byte/inode budgets preserve
the system reserve without double-counting capacity. Private mount propagation
keeps protected state/container mounts out of physical reset paths. The HDMI
bitmap now shows centered YBO - Hub OS with a surrounding gradient; Alt+F2 selects
an authenticated tty2 while tty1 stays idle. Source-proven camera/TEE/Mali/IRQ,
autofs and FIT metadata fixes are included, retaining upstream matched regdb.
Two signed boots per x64/ARM64, all three interrupted reset tiers and 125 CX3576
offline checks pass. Physical display, radio and accelerator qualification remains
open; returning from the console does not yet redraw the kernel logo.

## Writable var and matching regulatory database (2026-09-10)

The approved storage and regdb repair (20260910-0517-writable-var-regdb) (20260910-0517-writable-var-regdb)
binds all of /var to DATA/var, replacing per-systemd-state and var-tmp mounts.
General variable data shares a project budget of one eighth of DATA, capped at
256 MiB and 16384 inodes, with minimum limits of 32 MiB and 2048 inodes.
Identity, management credentials and native metadata retain protected storage.
The BSP exports its built-in regulatory certificates, and support packaging
verifies the pinned upstream database/signature pair against them before
publication. Unknown-signer and tampered-database checks refuse output.

Two signed boots each on x64 and ARM64 pass new StateDirectory creation, var
persistence, real quota exhaustion, protected reserve writes and complete exitrd
teardown. ARM64 full-system crun execution closes the qemu-user smoke limitation.
Build/verifier suites pass 389/645 tests; 22 Rust storage tests, fmt/clippy and
documentation checks pass. The timestamped 1,299 MiB CX3576 image passes all 124
offline checks, required FIT signature negatives and flash geometry. The task
records the exact artifacts; physical board rfkill/regdb acceptance remains open.

Campaign-level record, one entry per plan, newest first. Details live in the
plan file and the task records it names; this file holds the one-paragraph
history a reader can scan without opening either.

## Latest CX3576 boot-log assessment (2026-09-10)

The new serial-log assessment (20260910-0350-cx3576-latest-boot-review) binds `_out/tio.log` to
generation 8 of the integrated image and observes management/API startup and
health completion. It identifies missing rfkill state storage and a confirmed
regulatory-database signer mismatch; the matching upstream pair passes offline
trust validation. GPU IRQ lookup and NPU/IOMMU overlap are distinguished from
unproven hardware failures. Existing board cleanup, radio/accelerator workloads
and reboot/watchdog qualification remain open. This is analysis only.

## Minimal BusyBox boot and shutdown feasibility (2026-09-10)

The feasibility assessment (20260910-0338-minimal-boot-shutdown) records a
draft replacement (20260910-0341-minimal-boot-shutdown) for generic startup tools and the
retained shutdown environment. Signed Rust boot policy remains necessary, and
BusyBox does not supply the device-mapper helpers. The current ARM64 shutdown
payload is 16.45 MiB; the existing dmsetup closure alone is 4,765,416 bytes.
Command differences and boot/shutdown acceptance are recorded before any code
change. Implementation approval is pending; concurrent board repairs remain
unchanged.

## Integrated cx3576 image and boot-log review (2026-09-10)

The integrated image task (20260910-0254-cx3576-integrated-image) combines
current strict A/B root/init with the centered HDMI logo and native U-Boot console
repairs. The timestamped 1,299 MiB image preserves 1 GiB SYSTEM and passes 389
build tests, 123 offline checks, FIT signature negatives and DATA-only growth.
Source hashes and reused component identities are recorded with the image.
Review of the existing boot-log proposal confirms remaining board/config/FIT
items and updates the initramfs measurement; accelerator and physical acceptance
remain separate. The pre-existing `embed-trust.sh:15` shell-lint failure remains
explicit. Other owners' changes and the draft cleanup plan are preserved.

## Restore the standard CX3576 U-Boot console (2026-09-10)

The approved console repair (20260910-0159-cx3576-uboot-console) restores
the native one-second any-key countdown in the MOS firmware. Timeout and `boot`
execute the registered `mosboot` signed deployment command; entering the console
does not consume a trial. The early pre-CLI bypass is removed, with native
countdown/command and firmware I/O regressions. The
[development console policy](design/uboot-ab-handshake.md#development-console-policy)
requires an explicit user request before removing this standard entry.
The rebuilt loader and a candidate retaining the HDMI repair pass required FIT
signature checks, all 123 offline image checks, flash geometry and checksum.
The delivery record (20260910-0159-cx3576-uboot-console) identifies the
artifacts; physical UART/HDMI acceptance remains untested.

## Strict two-deployment file A/B replacement (2026-09-10)

The approved replacement task (20260910-0040-strict-file-ab) replaces old
inactive B only after authenticating the new inputs and confirming running A.
Native records retire B before collection; shared components survive, and new B
is activated only after durable publication. Both FIT environment copies forget
retired objects. Factory and runtime capacity checks budget two deployments,
including measured ext4 overhead. Native tests cover 549 interrupted/error cases,
transaction restart and replacement-only space availability; Rust/build suites
pass 46/385 tests. Clean-source x64 and ARM64 guests pass signed startup, component
updates, three-trial fallback and DATA archive retirement-failure recovery. The
1,299 MiB cx3576 image passes 123 offline checks, required FIT signatures and
DATA-only growth; SYSTEM is 1 GiB with 197 MiB allocated. The task records the
pinned source, reused BSP kernel and image checksum. Physical P10 remains open.

## 2026-09-10 00:51 [decision]

The user narrowed `20260910-0047-cx3576-hdmi-fullscreen-logo` to one centered
CX3576 HDMI logo with no cursor and approved implementation. The earlier
fullscreen-scaling and late-logo-lifetime proposal is superseded by correcting
the effective kernel command line and its authenticated packaging policy.

The implemented fix embeds `fbcon=logo-pos:center,logo-count:1` and
`vt.global_cursor_default=0` in the forced kernel command line, with matching
packaging and board declarations. Four regressions reproduce the original defect
and pass after the repair; all 388 build tests pass. The rebuilt kernel contains
the policy and its signed 1,299 MiB candidate image passes required FIT signatures,
123 offline checks, flash geometry and checksum validation. The
delivery record (20260910-0044-cx3576-hdmi-fullscreen-logo) identifies the
image and reused root/firmware inputs. Physical HDMI display remains untested.

## cx3576 boot-log repair planning (2026-09-10)

The [repair plan](plan/20260910-0029-cx3576-boot-log-cleanup.md) classifies the
historical boot diagnostics, records disconnected HDMI as expected, and covers
board configuration, FIT descriptions, and current-image physical acceptance.
Exact archive accounting confirms that the released 32.1 MiB initramfs includes
a separate 16.45 MiB shutdown payload retained by the runtime design. The plan
distinguishes Linux fixes from vendor BL31 limitations; implementation remains
pending approval.

## cx3576 SYSTEM reduced to 1 GiB (2026-09-10)

SYSTEM is now 1024 MiB and DATA starts at 1042 MiB. Firmware layout validation,
flash preflight/readback and the board package's runtime repart limits use the
same geometry. The full ARM64 package pool, signed root and firmware are rebuilt;
the complete image is 1299 MiB, down by 1 GiB. SYSTEM uses 197.0 MiB including
filesystem overhead and has 827.0 MiB free. All 384 build tests, 123 offline
checks, signature negatives, flash readback fixtures and real DATA-only growth
pass. The completed task (20260909-2358-cx3576-system-1g) (20260909-2358-cx3576-system-1g)
records exact artifacts, sources and the initial loop-device test failure; the
completed plan with the same ID is consolidated there and in current layout docs.
Physical board acceptance remains pending.

## cx3576 boot watchdog repair (2026-09-09)

The RK3576 clock driver now enables the watchdog clocks needed by DesignWare
probe, fixing the pre-Linux `required boot watchdog unavailable` stop. Probe and
start failures report their errors before storage access or attempt consumption.
RockUSB recovery runs cyclic watchdog service while waiting for USB. Pinned-source
regressions reproduce both defects and pass after repair. The rebuilt complete
image passes FIT signature negatives, 123 offline checks and flash geometry; the
task (20260909-2331-cx3576-boot-watchdog) identifies its exact artifacts
and component sources. Bench instructions reflect the enabled SYSFS/NOWAYOUT
configuration. Physical startup and watchdog acceptance remain pending.

## Timestamped factory images (2026-09-09)

Factory image publication now uses `mos-BOARD-YYYYMMDD-HHmmss.img` with UTC
build time to the second. Release packaging preserves and validates the name in
its manifest, checksums and provenance; cx3576 flashing selects the newest
matching image by default. The existing cx3576 handover uses its actual
`20260909-164233` build time with unchanged bytes and source identity. All 384
build tests, real image CLI output, release verification and flash selection
checks pass. The completed task and plan `20260909-1725-timestamped-factory-images`
are consolidated into the delivery record (20260908-2229-file-ab-delivery-x64-first)
and current build/install documentation to avoid retaining obsolete work records.

## Clean cx3576 image rebuild (2026-09-09)

Deleted the generated `_out/` tree at the user's request and rebuilt the complete
cx3576 image from clean commit `38f2a37b9a3c`, including the apid power feedback
repair. The image passes all 123 offline checks, required FIT signature negatives,
flash geometry, DATA-only growth and the 14-artifact release gate. Root smoke
reports 11 passes and the existing crun qemu-user limitation. Earlier generated
images and transcripts were removed; the delivery record (20260908-2229-file-ab-delivery-x64-first)
identifies the new artifacts and preserves the distinction from pending physical
board acceptance.

## Power action feedback (2026-09-09)

Apid now waits for mosd to admit a reboot or power-off request before answering
202. Refusals return 409 with the reason; failed dispatch, an unavailable daemon
and an unconfirmed timeout retain explicit backend error responses. The dashboard
closes its confirmation dialog so success and failure remain visible, and avoids
automatic power retries. Reboot interlocks are unchanged. Regression tests cover
admission, refusal, failure, timeout, confirmation and cancellation; the full Rust
and frontend gates pass. The investigation (20260909-1421-apid-reboot)
records fresh-image browser evidence and the unresolved original-device context.
The completed focused plan `20260909-1425-apid-power-feedback` is consolidated
into that open investigation rather than retained as an obsolete plan entry.
Fresh x64 acceptance verifies a visible 409 refusal, admitted reboot, distinct
boot IDs, reauthentication and admitted power-off, with complete exitrd cleanup
on both shutdowns. Both architecture package pools were rebuilt at one source
stamp; the physical device's specific failure still needs its access details.

## Signed file-based deployments (2026-09-09)

Documentation cleanup replaces the accumulated API/dashboard proposals
(PLAN-039/040/060/061/062/066), recovery narrative (PLAN-048) and build-harness
history with current contracts at their existing design paths. Superseded
Chinese engineering translations now link from the language portal to the
authoritative English pages; the current Chinese user guides remain. The old
exported `docs/zh/design/mos-ui` prototype, its ZIP and duplicate uploaded brief
are removed after the shipped React implementation replaced them. The separate
product design brief remains. Git history retains removed content; no obsolete
operational instructions or compatibility stubs are kept in the active tree.

Replaced the raw-slot RAUC/GRUB installation model with independently signed
firmware, kernel/support and rootfs components. Fresh images use three GPT
partitions, authenticated native boot attempts, serialized file installation,
health confirmation and retained fallback. DATA owns persistent state and
quota-limited writable leaves; var parents stay immutable. Server, API, device
UI, release packaging and current user documentation use the new contracts.
Earlier layouts, update protocols and migration paths are removed. Independent
S905X5M BSP sources remain, with its superseded MOS image producers retired.

QEMU, kernel/firmware signature negatives, transaction fault injection and
current-image integration provide software evidence. Kernel panic testing found
and fixed first-boot TLS identity durability. cx3576 firmware/FIT/image packaging,
offline verification and DATA-only growth pass; physical startup, watchdog
handoff and storage power-cut qualification remain pending bench access. The
implementation plan (20260908-1428-file-ab-signed-components) and
delivery task (20260908-2229-file-ab-delivery-x64-first) track the exact
artifacts, completed checks and remaining acceptance work.

Final software acceptance passes on x64 and virt-arm64, including all three
interrupted-reset tiers, panic/watchdog and pre-SYSTEM hang fallback, offline
boot at wrong clocks, and latest factory API runs (153/151 combined checks).
The x64 sampled installation-space run also passes all three update types and
subsequent boots. Cleanup gates include 644 verifier tests, 150 frontend tests,
both Rust workspace gates and document/negative-fixture checks. Physical
cx3576 acceptance remains the outstanding P10 requirement.

## PLAN-926 — S905X5M integration into updated local main (2026-09-08)

Updated local main to upstream 3c5374f3 and integrated the S905X5M adaptation,
including the Wi-Fi switch and front-panel repairs. Conflict resolution keeps
CX3576's slot-specific boot digests and S905X5M's independent payload contract.
Added the newly required display/DRAM declarations and aligned board readers
with upstream's path resolution inside extracted roots. Display fixtures now
exercise fresh slot reads. Verifier and build-driver typechecks passed, with
1,468 verifier tests and 171 boot/bundle/geometry unit tests passing. This is
a local source integration; image packaging, remote main publication and
device deployment are outside its scope. Existing hardware gaps remain open.

## PLAN-925 — Wi-Fi client switch API alignment (2026-09-08)

The built-in network page's Wi-Fi switch returned 409 because mos-apid omitted
`wifi.client.enabled` from its settings write allowlist. The boolean leaf now
returns 202 with an apply task, while adjacent Wi-Fi settings remain refused.
OpenAPI and the resource inventory are synchronized. Formatting, clippy and
325 apid binary tests passed, including switch, validation and session/CSRF
regressions. The device and existing images still contain the earlier service;
no packaging or deployment followed the user's disk-space stop instruction.
RFCT-945 records successful managed Wi-Fi DNS/HTTPS and unresolved gateway
ICMP loss separately from this API repair.

## PLAN-924 — S905X5M front-panel executable permissions (2026-09-08)

The package producer now installs both front-panel entry points as mode 0755.
The composed-root verifier checks optional executable modes and the panel
stop helper. All 1,394 verifier tests, actual package/root mode checks, 392 SD
image checks and 14 executable smoke checks passed. A temporary device bind
repair also passed service start/stop/restart. Replacement SD and RAUC artifacts
were produced before packaging was stopped; the later installer rebuild was
terminated. RFCT-944 retains the SD/eMMC boot-state ambiguity and remaining
runtime qualification gaps. The running root filesystem was not replaced.

## PLAN-923 — Local initialization helper and S905X5M SD inspection (2026-09-08)

Adapted the workspace-local initialization helper to the current JSON API,
session/CSRF contract, asynchronous apply tasks and additive SSH-key workflow.
Credentials are stored privately and retries preserve existing device state.
Fifteen isolated protocol cases and live fresh/repeat initialization passed.
SD runtime checks verified storage identity, management, Ethernet/NTP, MQTT,
container networking, radio discovery and basic HDMI/USB access. The image
remains degraded: non-executable front-panel scripts also prevent the boot
health gate from confirming the slot. RFCT-943 records the evidence and
RFCT-944 tracks the remaining runtime defects. The helper remains outside
the MOS Git checkout; this entry records its local delivery.

## PLAN-922 — S905X5M package integration on current mainline (2026-09-08)

Added the S905X5M/BM201 BSP to the top-level layout and package-based rootfs
pipeline, with resolved kernel configuration exports, independent radio
selection, and default-off front-panel and MQTT reference packages. SD images
and RAUC bundles consume the selected package's boot export; eMMC packages and
installer cards keep their separate media contracts. Runtime checks follow
mainline configuration and package inventories. The port retains mainline's
cx3576 boot-digest protocol and supports the x64 GRUB toolset on arm64 builders.
Factory-root smoke checks can use the existing BuildKit executor when Docker's
classic image store rejects a validated OCI archive.
Build evidence is recorded in RFCT-942. Existing-device configuration migration
and qualification of the new image on hardware remain separate work.

## PLAN-084 — Per-package JSON manifests and independent cache updates (2026-09-06)

Debian runtime pins now live in 172 individual JSON files with explicit target
variants, plus a separate bootstrap-helper record. All 342 previous target pins
and consumer mappings are preserved. `--package NAME` refreshes or verifies one
archive without processing unrelated package records; a real empty-cache run
fetched one archive and passed disconnected verification. The Bun builder renders
temporary installation records, keeping JSON tooling out of the target system.
Validation passed 40 archive checks, both-architecture selection checks, 920 build
tests, 1,279 verifier tests, 315 applicable image checks, 12 executable smoke
checks and all eight QEMU E2E phases with 137 assertions and no failures or skips.
See PLAN-084.

## PLAN-083 — Locked Debian runtime packages and QEMU acceptance (2026-09-06)

Runtime package manifests now pin versions, architectures, URLs and SHA256
checksums. Docker mounts a reusable archive cache; composition starts with 68
bootstrap packages and adds selected dependencies using dpkg without network
access or APT. The x64 system contains 159 upstream and 13 local packages.
Validation passed 920 build tests, 1,279 verifier tests, 315 applicable image
checks, 12 executable smoke checks and all eight QEMU/API E2E phases with 137
assertions, zero failures and zero skips. The guest tests now create a managed
WireGuard tunnel to exercise permissions on a real daemon-generated key.
Arm64 archives are verified; physical board acceptance remains separate.
See PLAN-083.

## PLAN-081 — Repository audit repairs (2026-09-05)

Closed stale-password session issuance, partial settings persistence, invalid UI
installation requests, diagnostics sandbox permissions, stale update/session UI
state, authenticated MQTT bridge connections and the package preflight regression.
Settings now use a private recoverable undo journal across DATA and STATE. CI adds
preflight, DATA layout and update-server checks, keeps generated OpenAPI equality,
and removes mandatory backward-compatibility enforcement during development.
English and Chinese current-state documentation is reconciled. Verification passed
1,047 mosd workspace tests, 149 UI tests, 920 build tests, 1,279 image-verifier tests,
25 preflight cases, 36 update-server tests and an isolated systemd sandbox probe.
Board and power-cut acceptance remain separate. See PLAN-081;
the audit resolution record it was written beside was a temporary document and
has been removed.

## PLAN-079 — Update server and release console (2026-09-04)

`update-server/` now provides a Bun/TypeScript service with a Chinese release
console, administrator sessions, streaming RAUC artifact uploads, publication
and withdrawal, expiring Ed25519-signed catalogs, range downloads and an audit
trail. SQLite stores release state; a standalone executable embeds the console
and database migration. The new protocol replaces TUF on the server side;
the existing OS client still needs its new reader before devices can use it.
Validation includes 36 tests, real HTTP range checks, full browser workflows
against the executable, and a clean dependency audit. Details and run commands
are in PLAN-079.

## x64 builds its own kernel, and there is no initramfs (2026-09-04)

x64 shipped Debian's generic amd64 kernel — 108 MB, with its own maintainer
scripts, its own initramfs run during the compose, and a klibc shell script in
the initrd that assembled the verity root. It now builds its own kernel from
mainline `v6.12.107`, pinned by tag and verified by digest, from a reviewed
fragment merged over `x86_64_defconfig` with the resolved config recorded in
tree and a build that refuses a config that drifted from it.

The reason was not size. `boards/common/mos-required.fragment` called itself the
board-independent baseline and was not one: measured against the Debian config
x64 actually shipped, of its 23 `=y` lines, 10 held, 12 were `=m`, one was absent
and its `CONFIG_LSM` was a different string — and nothing in the tree checked any
of it. That gap had already cost a whole-board outage: a change to the verity
format updated two of its three consumers and missed the klibc script, so every
x64 image was unbootable while cx3576 stayed green, because cx3576's kernel reads
the same command line directly and never runs that code.

**The initramfs is gone with it.** `rootfs/initramfs/` is deleted, initramfs-tools
and klibc-utils are out of the root, and there is no initrd in either slot's boot
partition, in `grub.cfg`, in the assembler or in the bundle. The kernel carries
`DM_INIT` and `DM_VERITY` built in and GRUB's `dm-mod.create` does what the shell
script did. Measured on the built artefacts: the kernel package drops from 108 MB
to 15 MB, the root from 435 MB to 296 MB, the RAUC bundle from 298 MB to 132 MB,
and 4230 modules become 8. The bzImage grows, from 11.6 MiB to 14.9 MiB, because
the drivers are built in — that is the trade, stated rather than hidden. Both
first-boot repartition and RAUC installation were always ordinary units after
`/sbin/init`, so removing the initrd took nothing from either.

The checks changed meaning rather than being deleted. `checks-kernel.ts` accepted
`=y` or `=m` over 7 symbols; it now requires `=y` **and** builtin over 31, which is
itself the provenance check — Debian's config has twelve of them `=m` and
`CONFIG_DM_INIT` nowhere, so a distribution kernel returning goes red. The
assertion that an x64 slot must carry an initrd was inverted rather than dropped,
and a BusyBox clause that would have become vacuous over an archive that can no
longer exist was restated stronger.

The floor is now one floor. The container-network symbols moved out of cx3576's
per-board loop into the shared fragment that both boards merge and assert after
`olddefconfig`. That consolidation also introduced, and then caught, the exact
defect the work exists to prevent: replacing a 59-symbol floor with a 41-symbol
one dropped 22 symbols and compensated for them only on the board that already
had them, so `CONFIG_NF_CONNTRACK_MARK` — the DNAT mark netavark sets for
published ports — was silently absent from x64's own config. The netavark gate
found it, and it and `NF_NAT_MASQUERADE` are named in the shared floor now.

The kernel also provisions the disk-encryption capability, and that is all it
does: `DM_CRYPT`, `CRYPTO_XTS` and `CRYPTO_AES` in a separately labelled block
that says it is the only block whose entries name no consumer, and that carries
its exit condition — each line leaves when a consumer lands in the image, and the
whole block is deleted if the product decision reverses. Nothing is encrypted at
rest; the image ships no cryptsetup, formats no LUKS header and has no unlock
path. Derived as three symbols, measured as six, because the crypt target selects
ESSIV in 6.12 and accelerated x86 AES pulls in cryptd and the SIMD helpers.
`CONFIG_TRUSTED_KEYS` and `CONFIG_ENCRYPTED_KEYS` stay off: cx3576 has no TPM —
its device tree declares none — so on that board the symbol would seal against
nothing, and enabling them would decide by accident where a volume key lives,
which is the first question an unlock design has to answer.

## The base image carries a firewall vocabulary, and keeps its unit off (2026-09-03)

`mos-system` now depends on both `nftables` and `iptables`. Neither is a
firewall: the image ships no rule set, no policy, no persistence and nothing
that reapplies a rule after a reboot. What it gains is the ability to look and
to act at all, on every profile — before this, a build that declined containers
had no firewall tooling whatsoever, because `nft` reached the image only as a
dependency of `mos-podman`.

Two front-ends over one backend is supportable only if the documentation says
which one answers which question, so it does. `nft list ruleset` is the complete
view of the `nf_tables` subsystem, including the container network driver's own
tables; `iptables -S` shows only what came through the iptables front-end, and
on a device running containers, reading it as "the firewall on this box" is
wrong. `iptables` here is `iptables-nft`, a translation layer over the same
kernel subsystem — the legacy binaries ship in the same Debian package, the
alternatives group is in auto mode where nft outranks legacy, and nothing in the
tree runs `update-alternatives`. A check asserts that endpoint, because a
flipped alternatives group leaves an executable `iptables` writing to a rule
store nothing else on the device reads.

The unit that ships with `nftables` needed a decision rather than an absence.
`nftables.service` runs `nft -f /etc/nftables.conf`, whose first line is `flush
ruleset` — on a device with containers that clears the container network's rules.
It was not enabled, but only because nothing had enabled it: measured on a clean
trixie root, **no shipped preset rule matches `nftables.service` at all, and
systemd's fallback for an unmatched unit is enable**, so a single `systemctl
preset-all` was enough. `mos-system` now ships `50-mos-nftables.preset` with
`disable nftables.service`, the postinst asserts the outcome, and a verify check
resolves the preset the way systemd does — basename masking across `/etc`,
`/run` and `/usr/lib`, first matching rule wins — rather than grepping for the
line it hopes is decisive.

On the image this project ships the closure delta is six packages and 2768 KiB,
because four of the ten were already present through `mos-podman`; the profile
this decision actually changes is the container-less one, which pays ten
packages and 4351 KiB for a firewall vocabulary it previously did not have.

## The kernel floor covers eBPF, the firewall back-end and bridge filtering (2026-09-03)

`boards/common/mos-required.fragment` named the virtual link kinds and netavark's
fib expressions and nothing else, so two capabilities the shipped runtime already
depends on were unstated. crun programs the cgroup v2 device controller as a
`BPF_PROG_TYPE_CGROUP_DEVICE` program, and on cgroup v2 that program *is* the
device policy — there is no controller file to write instead — so the eBPF core,
`bpf(2)`, the JIT and `CGROUP_BPF` are engine facts rather than diagnostics
niceties. The firewall half is derived from what `iptables-nft` actually resolves
through: the nf_tables core and its inet, ip and ip6 families, the xt compat
expression and the x_tables core it depends on, conntrack, NAT and masquerade.
Bridge filtering adds three more, because traffic between two containers on one
bridge is switched at layer 2 and no host firewall sees it otherwise.

Eighteen symbols, each with the clause that says what it buys. Deliberately left
out and recorded as such: the legacy `IP_NF_*` back-end and `BRIDGE_NF_EBTABLES`,
which nothing in the image uses; the per-extension matches and targets, which are
policy; `BRIDGE_VLAN_FILTERING`, which has no consumer because mosd renders VLANs
as their own netdevs; and `BRIDGE_IGMP_SNOOPING`, which is not neutral — built, it
stops forwarding multicast to ports that sent no report, which is how mDNS
discovery inside a container network breaks. BTF was priced by building it — 7.7
MiB added to `Image` in both A/B slots and twice the build time — and declined
until something ships a CO-RE tool.

The floor is now checked from both sides: `verify/src/checks-kernel.ts` asserts it
against Debian's built artefact on x64, the fragment is merged before
`olddefconfig` and asserted against the built config on cx3576, and a test reads
the fragment and requires every registered symbol pinned there. Eight symbols
build no object of their own, so a register entry may omit its module, and the
modprobe check names in its PASS message which symbols it skipped — a green line
cannot be read as covering them. One asymmetry is written down rather than
smoothed over: `br_netfilter` defaults its `call-iptables` switches on and
registers its hooks once a bridge exists, so a FORWARD policy reaches same-bridge
container traffic on the board whose kernel builds it in and not on the board
where it is a module. The capability is common; the default state is not.

## The built-in console follows the prototype's information architecture (2026-09-03)

PLAN-067 closed the visual gap to the approved prototype; this closes the
structural one. Page titles lose their descriptions and gain a status slot, the
footer reports release and active slot, the connection has the prototype's
three states with a banner, and preferences become a searchable language picker
and a segmented appearance control. Overview's attention rows stop being
hard-coded copy and become device facts. Network merges observed state into the
interface table and opens an interface detail route with a review dialog and an
apply strip whose every step is observed. Services opens a service detail route
and the terminal window. Applications gains its filters, retained-data count
and Desired column. Access becomes four labelled sections. System folds to the
prototype's six tabs, with the update check table, automatic policy, manual
upload and configuration backup.

Two rules governed the work. Nothing states a device fact the device did not
report: service endpoints, bridge membership, whether a change would cut off
this browser, and the update checks are all derived or omitted. And anything
designed but not yet real is built, disabled and marked at the section that is
incomplete, not only at the bottom of the page. Six shipped surfaces the
prototype has no place for are retained under sections that name them as
additions. PLAN-068.

## The built-in console matches the prototype detail for detail (2026-09-02)

PLAN-064 reproduced the approved prototype in outline; the shipped console now
reproduces it in detail. The OKLCH re-derivation of the palette is replaced by
the prototype's own Klein values for both themes, including the hover,
accent-soft, accent-strong, skeleton and chrome roles. The type scale drops to
the prototype's 22px page titles, 16px section titles, 15px control and table
text and one 13px secondary size, and the shell adopts its 56/52px header,
square logo mark with a stacked wordmark and hostname, navigation pills with an
inverted active state, 44px footer on the page ground and 300px drawer with a
status block. Buttons, inputs, tags, tables, tab strips, switches, dialogs,
progress bars and the blueprint-framed sign-in card follow the prototype's
sizes, radii and states, and the breakpoints move to 581px and 1100px. Content,
routes, API bindings and the simulation boundary are unchanged. PLAN-067.

## Built-in UI builds are isolated from source (2026-09-02)

The built-in UI now has one production and quality path through the Bun image
pinned by `build-env/images.env`; host Bun discovery and configurable output
directories are gone. The UI source is mounted read-only, while dependency
installation, generated metadata and Vite output are confined to
`_out/apid-ui/`, with the production tree fixed at `_out/apid-ui/dist`. Rust
target and package builders also mount repository source read-only, write Cargo
artifacts through a separate target mount and consume the UI tree through
`/build/apid-ui:ro`. This supersedes PLAN-065's source-adjacent producer
placement without changing APID's embedded VFS or runtime routes. PLAN-066.

## Built-in UI assets are generated before Rust builds (2026-09-02)

`pkgs/mosd/apid/ui/dist/` is now ignored generated output rather than a second
source of truth in Git. The frontend production entry uses local Bun or the
pinned Bun container; local checks, target builds and package producers run it
before Cargo and pass the absolute output directory explicitly. APID's build
script validates that tree, copies accepted bytes into Cargo-owned output and
generates the same sorted embedded VFS. The frontend gate now proves source,
tests and a fresh production build, while a focused contract gate prevents
generated files or unwired Cargo entries from returning. PLAN-065.

## The built-in UI now implements the complete product prototype (2026-09-02)

The recovery SPA now matches the approved horizontal Klein-blue prototype and
uses the shadcn/ui base-nova contract on Base UI, Spectrum-aligned OKLCH tokens,
self-hosted Barlow fonts, responsive desktop/mobile navigation, persisted
English/Simplified Chinese and light/dark preferences, and route-level lazy
loading inside the embedded VFS. Overview, typed network management, system
services, credentials, UI package versions and authenticated update actions
use the current APID contracts. Applications, browser terminal, time, automatic
update policy, storage, diagnostics/support, backup and recovery are complete
interactive simulations backed only by ephemeral in-memory state; every
affected page labels that boundary at its bottom. Vitest and Playwright cover
the simulation boundary, navigation, preferences and critical workflows. The
34-file embedded tree is 1,067,103 bytes raw and 501,172 bytes as the sum of
per-file gzip streams; 250,984 raw bytes are the twelve Latin Barlow font
assets, and the remaining increase from the 676 KiB baseline delivers the
complete route and interaction surface. PLAN-064.

## The built-in UI moved to an internal namespace (2026-09-02)

The verity-covered recovery SPA now owns `/_ui` and uses canonical `/_ui/`
asset and navigation URLs; `/` redirects there when no usable custom UI is
active. `/ui` has no compatibility alias and is now an ordinary custom-UI
route, so an integrator bundle can own that path without being intercepted by
APID. The route router, one-decode reserved-segment guard, Vite/TanStack bases,
localized recovery copy, committed hashed assets, tests and current English
and Chinese guidance moved together. `/api/v1/ui` and `/mos/ui` retain their
existing API and storage meanings. PLAN-060.

## Application delivery, an emergency binary and a recovery interface (2026-09-03)

`docs/user/applications.md` now routes application code on one question — may
this code be a release behind the OS? — into either build-time `.deb`
composition under the RAUC lifecycle (`docs/design/native-applications.md`) or
digest-pinned OCI/Quadlet delivery. Three more Quadlet examples are fed to the
shipped generator by the documentation test, so a broken example is a red gate
rather than a customer's discovery. What is not enforced is named: signature
admission, mandatory ceilings, a secret store and per-application automatic
rollback; the slot-wide rollback the boot health gate does perform is stated
separately rather than folded in, because folding it in would have made the
group false.

`mos-busybox` ships one unexpanded `/usr/bin/busybox` for emergencies. Depending
on Debian's package would have shipped an initrd carrying busybox and 271 applet
hard links through the initramfs hook it also installs — the applet farm the
plan rejects, arriving as a side effect of one dependency line — so the producer
extracts the single file and runs no maintainer script. Verify walks the packed
root for symlinks and for files sharing the binary's inode, because the hook
expands as hard links.

Physical recovery actions now have a system-layer interface: a board declares
its own actions in `board.env`, mosd maps a boot-time intent through that
declaration into the presence assertion and reset tier the existing flows
consume, and a board that declares none refuses and says so. Both shipped boards
declare none, and the debug serial console is withdrawn as a candidate — on
cx3576, displacing its getty was measured to wedge the tty and block systemd.
PLAN-045, PLAN-048, PLAN-051.

## Install, onboarding, provisioning and recovery (2026-09-02)

A device can now be configured before anybody logs into it: a versioned,
totally validated provisioning document arrives on the boot partition or on
removable media, applies in one save or not at all, and is refused once the
device has an administrator — so a fielded appliance cannot be reconfigured
from a stick. Claiming records how it happened, and a bootstrap credential is
bound by a forced rotation at first sign-in rather than by an expiry, because
an unclaimed device is the one with no trusted clock and a window that closes
with nobody in it would brick. Slot state is inspectable and a manual rollback
is guarded: it can only ever mark the booted slot bad, never mark a target
good, and it refuses a target that was installed more recently than the
running system or that cannot be ordered against it — which derives "the
target has run before" from RAUC installing only the inactive slot, a premise
now named where the guard lives. Reset has three tiers with a table that says
what each one preserves as well as what it clears, executed from an intent
record applied on the next boot; META and the system slots are unreachable
because the type that carries the roots has no member for them. Secure wipe is
deliberately absent until a board evidences a device-level erase primitive.
The console renders every reachable flow and explains the two that are not.

Not closed, and the records say so: the presence gate ships and nothing writes
a presence assertion, so tier 3 and credential recovery are implemented,
tested and unreachable on a fielded device; every install, flash and
first-boot procedure is documented and unrun on hardware. PLAN-046, PLAN-048.

## Time, storage, diagnostics and the system-information surface (2026-09-02)

The image now keeps time on purpose: `systemd-timesyncd` ships as base policy
with a pinned 32-2048 s poll, a 30 s retry and a 60 s clock save, its saved
clock bound onto STATE so `max(RTC, last known good)` holds before TLS and TUF
validity are ever checked. NTP servers and the timezone are typed settings
with a runtime reconciler; the timezone is presentation only, rendered to
`/run/mos/timezone`, and `/etc/localtime` stays UTC because a bind over the
zoneinfo symlink would hand the operator's zone to every reader of UTC. The
cx3576 kernel now asserts its RTC driver. `GET /api/v1/storage/status`
reports the PLAN-063 tiers: DATA at `/mnt/data` with `/mos` and `/srv` as
binds of one pool whose capacity is stated once, readiness proven by a real
probe write with named unavailable and degraded states, eMMC wear as a JEDEC
bucket range beside its raw evidence, and every lifecycle action explicitly
unsupported. `GET /api/v1/system/info` assembles what this device is from
the shipped manifest, machine id, uname and RAUC; `/api/v1/system/telemetry`
and `/api/v1/network/status` report observed state, kept distinct from the
desired configuration, and say so when a fact is absent. Diagnostics
snapshots collect one at a time under `/mos/diagnostics` with retention and
explicit deletion, redacted by a fail-closed allowlist. A Wi-Fi AP
passphrase refusal no longer names the secret's length. Board validation of
RTC backup power, media health, fsck evidence and the telemetry fields needs
bench hardware and is recorded as not done. PLAN-044, PLAN-049, PLAN-052.

## Release identity, authenticated updates and the security lifecycle (2026-09-02)

A release is now a validated manifest (version, channel, board
compatibility, artifacts with sizes and digests, source and build identity)
with SHA256SUMS, a CycloneDX SBOM taken from the image's package manifest,
provenance and a license inventory; `make os-release-gate` refuses to
publish without them or without board evidence. Devices carry
`rauc-update`: it discovers releases from signed TUF metadata, downloads
resumably into `/mos/updates/downloads`, moves only an authenticated bundle
into `/mos/updates/verified` and hands RAUC that path alone, with an offline
import through a lockbox. mosd owns the update lifecycle (idle through
rolled-back, plus `update-unavailable` when the DATA pool is missing,
read-only or exhausted) under a fail-closed policy file for maintenance
windows, metered links and a health-gated reboot; apid exposes it under
`/api/v1/update` and the System page exposes its state and typed actions.
`docs/design/security-model.md` separates six security boundaries and is
the canonical I1-I4 boot-assurance ladder; `security-lifecycle.md` and
`manufacturing.md` name owners for keys, releases, advisories, factory
records and RMA. Both boards honestly remain I1. Production key ceremonies,
release hosting and every board-side fault row are operator or bench work
and are listed in the task records. PLAN-043, PLAN-047, PLAN-053.

## User documentation, website briefs and the BSP porting set (2026-09-02)

`docs/user/` now carries the fifteen-page customer journey from download to
support under an explicit documentation contract: audience, page ownership
and a truth-status taxonomy on every claim. `docs/website/` holds one content
brief per official-website page. `docs/bsp/` is the porting manual, the
vendor intake rubric, the `board.env` reference, the dossier template with
its cx3576 instance, the field-reliability qualification matrix, the I1-I4
boot-assurance ladder and the support tiers. `docs/zh/` mirrors all three
sets. `make docs-verify` grew four gates -- internal links, truth-status
lines, en/zh coverage and dossier shape -- each with its own negative test.
The twelve cx3576 qualification rows still read "not tested"; they need a
bench run. PLAN-042, PLAN-050.

## The os/ wrapper is gone (2026-09-02)

`os/boards`, `os/build`, `os/build-env`, `os/pkgs`, `os/rootfs`, `os/tests`,
`os/tools` and `os/verify` now live at the repository root. The wrapper dated
from when the tree was expected to hold more than the OS; it never did.
Every path reference followed -- including the self-locating scripts that
derive the repository root from their own depth, and both TypeScript path
modules, whose `OS_DIR` (now equal to `REPO_ROOT`) was retired. The `os-*`
make target names stayed: they are names, not paths. Historical records keep
the paths they were written with. Landed as 69febcae.

## Built-in UI assets are an isolated embedded tree (2026-09-01)

APID now generates a sorted compile-time VFS from the complete committed
`ui/dist` tree instead of naming `index.html`, `app.js` and `app.css` in Rust.
Vite emits content-hashed vendor, route and locale chunks; page routes and the
Simplified Chinese catalog load on demand, while every resource remains inside
the verity-covered binary. `/`, `/ui` and `/api` are terminal ownership domains:
misses and ambiguous encoded or repeated-separator paths cannot cross between
the custom UI, built-in UI and JSON API. The Chinese UI development guide now
documents the VFS, lazy-loading, cache and path-isolation contract. PLAN-059.

## The built-in UI is bilingual and theme-selectable (2026-09-01)

The recovery SPA now ships typed inline English and Simplified Chinese
resources and browser-local language selection, plus persisted system, light
and dark appearance modes available before and after authentication. Its owned
shadcn `base-nova` controls remain backed solely by Base UI, while local
semantic tokens now follow Adobe Spectrum 2 color hierarchy, focus, state,
density and accessibility guidance without importing a second component
runtime. Every shipped route was localized, theme and locale document metadata
stay synchronized, and the complete embedded APID asset tree remains deterministic.
PLAN-058.

## Package versions mean something, and the image says what it holds (2026-09-01)

Upstream repacks now carry their upstream version in front of the pool's git
stamp -- `mos-podman 5.8.6+git…`, `mos-rauc 1.13+git…`, declared per producer
by `VERSION_FROM` in producer.env -- while first-party packages keep the
workspace version. The pool-wide invariant weakened from one version to one
stamp, in the gate, the compose preflight and the exact-version Depends pins
(now pinned to the named package's own pool version; the cross-boundary pin
uses the new `@SYSTEM_VERSION@` control token). The composed image ships
`/usr/share/mos/manifest.tsv`, its bill of materials written before the
package-manager purge and asserted by os/verify. The `radios` producer split
into independent `wifi` and `bluetooth` producers, and each radio name is its
own `MOS_ROOTFS_WITHOUT` token -- declining Bluetooth keeps Wi-Fi -- with the
umbrella `radios` token removed. The container-network kernel floor (VETH and
the nft fib family) moved into the shared `mos-required.fragment` and into
os/verify's per-image kernel checks for the Debian-kernel board. PLAN-041.

## The v2 suffix is retired (2026-09-01)

The `v2` in file and target names dated from when the current layout coexisted
with a legacy chain; that chain is gone, so the suffix stopped naming a
distinction. `os/rootfs/build-v2.sh` is now `build.sh`, `os/rootfs/overlay-v2/`
is `overlay/`, the cx3576 assembler `mkimage-v2*` is `mkimage-cx3576*` (the
name `mkimage-x64` already used), the make targets dropped their `-v2`, and
images assemble as `<board>-mos-<epoch>.img`. Prose that said "v2 image" or
"layout v2" now says "mos image" or "the A/B layout". Version numbers that
really are versions -- the settings schema's v2, the API `/api/v2` rule,
upstream releases -- are untouched, and historical records (this file,
docs/plan, docs/task) keep the names they were written with.

## The rootfs is composed from Debian packages (2026-08-31)

The nine-file rootfs stage chain is gone. A root is now one APT transaction
against a local package pool -- `_out/debs/<arch>/`, built and indexed by
`make os-debs` -- on a digest-pinned Debian base, followed by one finalizer
that closes and packs it. What used to be a floor stage, a read-only-root
wiring stage, four feature stages and a board stage is package metadata:
fifteen packages from ten producers discovered from the tree, with
configuration order coming from their own `Depends` rather than from a number
in a filename. Declining a feature is naming fewer packages, through a resolver
that refuses a set not naming exactly one profile package. Enablement is
package-owned symlink payload; nothing anywhere calls `systemctl enable`. The
RAUC keyring stays the one path that is not package payload, staged per build
from `ca/`, and it is a different seam from the TLS trust store `mos-ca-trust`
ships. The switch-over was accepted on a gate that built x64 through both paths
at one commit and judged every difference between the two roots -- 35
differences, 35 sanctioned, 0 unsanctioned -- whose reasoning is kept as a
closed record in `os/tests/dual-build-sanctions.md`.

## Built-in UI is a pure SPA over the management API (2026-08-31)

apid now embeds a React/Vite application at `/ui`; `/` serves a valid active
custom bundle and otherwise redirects to that built-in UI. All server-rendered
Maud pages and non-API form mutations, including `/containers/enable`, were
removed. Setup, login and logout have JSON session routes, API handlers accept
either a stored bearer token or a signed browser session, and session mutations
require a per-session CSRF header. Custom UI status/deactivation is likewise an
API resource. mosd now obtains an on-demand normalized network snapshot from
systemd-networkd, and the network API/SPA report the observed interface count,
configured intent and each link's operational, carrier, address-family and
address details. The committed frontend assets are rebuilt and byte-compared
in CI before Cargo embeds them.

## Settings writes are bounded, scoped and queued (2026-08-31)

apid-to-mosd and mosd-to-systemd waits now have five-second bounds, while
mosd keeps settings/live-state reads separate from its serialized apply lock
and reconciles only overlapping subtrees. Persisted settings writes enter one
bounded, coalescing queue whose task records are mirrored into apid by
`TaskChanged`; the settings and transient-password APIs return 202 plus a task
id, and bearer clients can read the bounded task collection or one record.
The zero-JavaScript SSH pane redirects to that task and meta-refreshes only
until success, failure, interruption, or confirmed history loss, and no
plaintext password can enter the queue.

## cx3576 builds on a host without binfmt (2026-08-30)

The rootfs stage driver links its chain one of two ways, decided by the
builder's driver: by tag in the daemon's image store on the `docker` driver,
as before, or by OCI layout on any other -- each stage exported
`type=oci,tar=false` under `_out/<board>/stages/` and handed to the next as a
named build context under the tag its `FROM` names. A `docker-container`
builder bundles its own emulator, so `os/rootfs/build-v2.sh` now selects
`mos-<arch>` when `default` cannot reach the platform, the way the RAUC and
podman builds already did, instead of refusing with the host binfmt command.
The smoke run that closes the build follows: when the daemon cannot execute
the root, every register entry runs inside that builder through one throwaway
build per artifact, with the same register and the same judging. With that,
every cx3576 step -- builder images, U-Boot, kernel, RAUC, podman, mosd, the
rootfs, the image, its verification and the bundle -- builds on an amd64 host
with docker and buildx and nothing registered on it.

## MQTT bridge hardened against its application peers (2026-08-30)

A review of the decoupled bridge found it still treating its D-Bus peers as
mosd. Every `GetItems` and `SetValue` into an application is now bounded by
five seconds, so a hung application is recorded as unreachable instead of
stopping the heartbeat and every other application. The rumqttc event-loop
task no longer waits on the runtime: requests that arrive while it is busy
are dropped, and a reconnect travels on its own channel, closing a deadlock
between the two bounded channels. An activation that fails while the
application still owns its name -- one that claims the name before it
registers `/` -- is retried by a bus sweep five seconds later.

The documented application policy now grants root `GetItems`: the stock
system bus has no root exemption, so a package that granted only the bridge
was published to MQTT and reported non-conforming by mosd's registry on every
boot. Image verification requires that grant for every enrollment. The MQTT
reconciler no longer lets an identity that fails validation block the off
path, and a read of a path no application publishes is ignored rather than
answered with a retained null under the client's chosen name.

## MQTT enrollment decoupled from service naming (2026-08-30)

`com.mos.ext.*` is no longer a privileged application namespace. All services
use the uniform `com.mos.<class>[.<suffix>]` grammar, while MQTT eligibility is
an independent package-owned contract: an exact regular-file enrollment under
`/usr/lib/mos/mqtt-applications.d` must be paired with exact D-Bus name
ownership and `mos-mqttd` Item1 grants. Global prefix ownership and the central
mqttd policy were removed; wildcard, prefix, unenrolled, and unpaired grants
fail image verification.

`mos-mqttd` now has zero D-Bus access to `com.mos.mosd`. `GetDeviceId` and the
bridge identity proxy were removed; mosd instead renders the already-validated
topic identity into `/run/mos/mqttd-device.env` before starting the bridge.
mosd retains its explicit local `com.mos.mosd1` management API because APID and
mosd are separate processes, but exports no Item1 façade and no settings,
state, signal, or action to MQTT. This entry supersedes the extension-namespace
and single-`GetDeviceId` exception described in the immediately following
entry.

## MQTT restricted to application data (2026-08-30)

`mos-mqttd` no longer mirrors the `com.mos.mosd` management tree. It now
discovers only class-bearing `com.mos.ext.*` application services, validates
their identities and item paths at the trust boundary, coordinates one
device-wide heartbeat/full-publish lifecycle, and fails closed when two
applications claim the same class and instance. System settings and state —
including SSH, networking, credentials, containers and MQTT configuration —
and power or update actions have no MQTT read, publication or write path.

The bridge's sole system-management permission is the new read-only
`com.mos.mosd1.GetDeviceId` method used to form topic addresses. APID now calls
the dedicated `Reboot` and `PowerOff` management methods directly, and mosd's
obsolete system `com.mos.Item1` façade and action-item implementation are gone.
D-Bus policy and image verification pin the exact grant across all policy
files. Application disappearance, watcher failure, invalid item paths and
address collisions withdraw retained values rather than leaving stale state.

## Mosd workspace tests consolidated and repository prose audited (2026-08-30)

The repository-root `test/apid-api/` harness now lives at
`os/pkgs/mosd/tests/apid-api/`, beside the D-Bus policy harness moved out of
`os/pkgs/mosd/hack/`. Repository-root discovery, container workdirs, fixtures,
Make targets, verification inputs, executable modes, and current documentation
all follow the new ownership boundary. Cargo unit and integration tests remain
crate-local, while `os/tests/` remains the home for OS-wide tests.

The accompanying audit removed a committed conflict marker, unstable source
line citations, stale references to deleted build and verification scripts,
incorrect current paths, and incomplete prose in design documents and code
comments. It also corrected a stale build-test expectation that still named the
deleted bundle script. Validation passed the 48-case documentation index, the
31-file shell pipefail scan, 689 build tests, 1,096 image-verification tests,
47 APID self-checks, 38 API specification pins, 45 D-Bus policy checks, and the
Rust workspace tests and clippy gates. The full QEMU APID run was not available
because this checkout has no `_out/x64` image; dry-run resolution reached the
new paths and stopped only at that missing prerequisite.

## Scratch root renamed to `tmp/` (2026-08-29)

`runtime/` collided with a real runtime path twice over. A genuine `runtime/`
directory in this repository would have been silently gitignored, and
`build-harness.md` quotes `/srv/bkd/runtime/bun` two sections above the one
that defined the scratch root, so a reader had to work out which `runtime` was
meant. It is `tmp/` now — unambiguous, and the convention PMA already states
for throwaway files. Nothing in the tree read the old name: it was a rule in
`.gitignore` and a section of `build-harness.md`, not a path any script builds.

Renaming it exposed a gap in the citation sweep. That sweep matched
`name.ext`, so it could not see a filename with no extension (`Dockerfile:41`)
or one whose dot comes first (`.gitignore:33`) — and the doc it was about to
rewrite cited `.gitignore:33`, a line number the rename itself was about to
invalidate. Twenty-three such citations survived and are now gone, across
`build-harness.md`, `uboot-ab-handshake.md`, `boards.md`,
`mos-required.fragment`, `podman/Dockerfile` and three `os/verify` sources.

Still there, and measured rather than fixed: about a hundred bare continuation
references in `os/verify/src/` and `os/build/src/` — `:1750`, `:2096` and the
like — pointing into `os/verify-image-v2.sh`, the shell verifier that was
deleted. They are archaeology in comments, not links anything resolves, and
clearing them is a separate pass over roughly a hundred sites.

## The docs gate narrowed to what ships (2026-08-29)

`docs/plan/` and `docs/task/` are PMA process tracking. They are not part of
the product, and a record is deleted when it closes, so the sets an index gate
asserted over them were down to two task records and zero plans — a check that
reports green without having checked anything. Both sections are removed.

What remains is the pairing a reader depends on: `docs/design/*.md` against
`docs/README.md`, both directions, plus the once-each assertion that catches a
document listed twice. A design document that no index lists is not broken,
does not fail a build, and is simply never found again; nothing else in the
tree can catch that.

The gate goes from 352 lines to 118 and the negative suite from 398 to 202 —
750 to 320 against 16 documents, where it had been 750 against 18 rows.

One gap closed on the way out. The forward direction for `design/` — a
document that exists with no row — had no negative case of its own: the task
half of that pair had been carrying it, and removing the task section would
have left the gate's primary assertion untested. It has a case now, and the
suite is 4/4.

`docs/research/` is not gated because it does not exist; it went with the
Venus OS evaluation. `check_readme_dir` still takes its directory as an
argument, so if a second shipped tree appears, one call adds it.

## Talos removed from the tree, and the settled records pruned (2026-08-29)

Talos is gone. The three references that were not history went with it: the
`.gitignore` entry for a `talos/` directory that does not exist, the base name
in the Makefile's retired-`os` message (the target keeps its recipe — a retired
build path that exits 0 is the failure mode every check here exists to
prevent), and the `apid` name-collision note in `remote-management.md`, which
disambiguated a daemon no reader can now encounter.

`README.md` keeps one mention, deliberately: the design-lineage sentence.
Talos really is where the immutable-root idea came from, and crediting an
influence is not the same as naming a dependency.

The rest of the Talos residue was inside settled records, so applying this
campaign's own rule cleared it. PLAN-029 M3 established that a record is
deleted when it closes; the closures in the previous commit left seven behind,
which contradicted it. Every settled record is now pruned — thirteen in all,
including this campaign's own PLAN-029 and RFCT-262/263/264. `docs/plan/` holds
no plan records, and `docs/task/` holds RFCT-253 and RFCT-260, the two that are
genuinely open.

An empty plan set turned out to break `docs/verify-index.sh`: an unmatched glob
expands to the pattern itself, and the forward loop reported `PLAN-*.md` as a
record with no row. It failed closed rather than passing green, which is the
right direction, but it was still a defect. Both forward loops now skip a path
that does not exist. The negative suite stays at 17/17 — it mints its own
`PLAN-900` fixture rather than borrowing a real record, which is what keeps the
plan assertions armed against an empty tree.

## Backlog cleanup (2026-08-29)

The open set was four plans and five tasks; most of it was bookkeeping rather
than work. Verified against the tree, then closed:

- **RFCT-005 and PLAN-007 — the Talos rebase, abandoned.** Both proposed
  rebasing the fork onto upstream Talos v1.14.0-rc.1. The project took the
  other fork, PLAN-010's systemd base. There is no fork left to rebase. The
  last three references outside the records — a `.gitignore` entry for a
  directory that does not exist, the base name in the Makefile's own "retired"
  message, and the `apid` name-collision note in `remote-management.md` — went
  with them. What stays is the design-lineage sentence in `README.md`, which
  credits an influence rather than naming a dependency.
- **RFCT-008 and PLAN-010 M1 — superseded.** The systemd rootfs prototype was
  replaced by the v2 chain (`os/rootfs/build-v2.sh` over nine stage
  Dockerfiles, squashfs+dm-verity, A/B layout) that M2-M5 build on and that
  ships. M1 was the only milestone still open under a plan whose other four
  were implementation-complete. Its remaining done criterion — hardware boot
  to sshd — was never recorded, and closing it does not claim it.
- **PLAN-006 — completed by supersession**, executed on the systemd base as
  PLAN-010 M4. **PLAN-008 — completed by supersession**: the connectivity
  concern ships as two mosd reconcilers, and no `connd` process exists,
  deliberately.
- **RFCT-007 — completed.** Item 1 had shipped. Item 3, the flashing matrix,
  is delivered in `os/boards/cx3576/bsp/README.md`: five paths, which board
  state each applies to, and why `ums` is reachable only from U-Boot and never
  from Maskrom. **Item 2, the `update.img` pipeline, is closed as superseded
  and will not be built** — three flash paths already write a whole-disk image
  through `rkdeveloptool wl 0`, and the RK packaging format would require
  vendoring `afptool` and `rkImageMaker`, closed-source SDK binaries, for no
  capability the tree lacks.

Left open, and genuinely open: **RFCT-253** (whether `access.ssh` may stay
bus-writable, a decision on evidence already gathered) and **RFCT-260** (the AP
reconciler's third copy of the WPA byte rule, and a refusal that names the
secret's length). Standing and untracked: the arm64/cx3576 verifications owed
to a host with binfmt.

## PLAN-029 — Documentation system rebuild (2026-08-29)

The documentation tree went from 276 files and 77,319 lines to 42 files and
17,306, and stopped being coupled to code positions. Delivered as one record,
RFCT-262, because record proliferation was one of the things being removed.

- **Decoupled from code.** 3,843 `path:line` citations are gone from the
  documents, along with the gate that kept them resolvable
  (`docs/verify-citations.sh`, its test and three baselines — 1,821 lines, two
  `Makefile` targets and a CI step). Documents now name a module or a contract.
  The HTTP surface defers to `os/pkgs/mosd/apid/openapi.json`, which CI already
  holds equal to what the shipped binary prints and diffs for breaking changes —
  moving the API surface off an ungated prose transcription and onto a gated
  artifact. api.md's transcribed route table and operation inventory collapsed
  accordingly; its design reasoning stayed.
- **Settled records pruned.** 205 completed `RFCT-*` and 24 closed `PLAN-*`
  deleted, both indexes rewritten to the survivors. RFCT-257 and RFCT-261 were
  closed rather than kept: both were work scoped against the citation gate this
  campaign removed, so leaving them open would have left the tree with a task to
  build on machinery that no longer exists.
- **Re-anchored on the current version.** `docs/research/` deleted with the
  Venus OS comparison it existed for; the eight `*.zh.md` siblings replaced by
  `docs/zh/`, written against the tree rather than translated from a moving
  target. mosd.md was a M2 brief under five dated amendments claiming schema v4
  in one heading and v7 in another while the code is at v8, and five reconcilers
  where seven are registered; the amendments are collapsed into one statement of
  where the design stands.
- **Tests.** Measurement did not support a broad prune — `os/verify` runs a
  0.84 test-to-source ratio and `os/build` 1.06, close to one test file per
  module — so only what lost its subject went: the citation gate's negative
  suite, and `os-layout-lint-test`, a filename filter over a suite
  `os-verify-test` runs whole and which nothing invoked. `test/apid-api` is
  recorded as the manual harness it already was. The index gate's negative suite
  stayed green at 17/17; its plan cases now mint their own completed plan rather
  than borrowing a real one the pruning rule would delete.

Left open deliberately: 97 references to deleted records remain in 24 non-docs
files, mid-sentence in doc comments and in the generated `openapi.json`. They
resolve in the history, and clearing them costs a 24-file prose edit plus a
regeneration.

**Amendment 1 (same day).** Two things the milestones left short. Code no
longer cites task or plan records at all — 390 references across 125 files,
including the doc comments `utoipa` publishes into `openapi.json`, so an API
client was being shown `docs/task/RFCT-210.md`. The document was regenerated
from the corrected source, never hand-edited. Doing that surfaced two classes
M1's own dangling check had missed by requiring a `.md` suffix: 179 record
references in the living design documents and 94 pointers at the deleted
`docs/research/`. Both are now zero. `docs/zh/design/` also grew from six
documents to all sixteen.

## PLAN-021 — The defect and debt batch (2026-08-28)

Fifteen of the sixteen filed tasks closed: RFCT-094, RFCT-096, RFCT-129
through RFCT-134, and RFCT-136 through RFCT-142; the sixteenth, RFCT-135,
grew into PLAN-022 rather than closing here. Alongside the filed batch,
RFCT-180 delivered the M1 quick-fix batch (test timeouts, the audit-trail
flake, dead instructions and dead code), and RFCT-190/191 ran the M3 ghost
sweeps — stale provenance references across os/** re-measured and repointed
or dated, plus the docs-side re-measures, owner sweep, and gate repairs.

The five defect clusters, by outcome:

- **Credential and auth**: the admin password is changeable after setup
  (RFCT-134), /healthz states what it actually checks (RFCT-131), and one
  outage no longer reports as both 502 and 503 (RFCT-140).
- **API/bus plumbing**: uptime comes from mosd instead of apid's own
  /proc read (RFCT-129), the three settings failures reach the API as
  distinct errors (RFCT-130), per-request GetSettings round trips are
  cached (RFCT-132), and apid receives mosd's SettingsChanged (RFCT-133).
- **Hardening**: apid's unit sandboxes the filesystem it serves
  (RFCT-137), cargo-deny enforces the no-C posture it previously only
  named (RFCT-138), the unreachable bundle store's fate is decided and
  recorded (RFCT-136), and the traversal guards gained over-the-wire
  coverage with a bundle-carrying fixture (RFCT-141).
- **Device**: the U-Boot boot-credit read is ordered against writers
  (RFCT-142), and the production keyring provisioning path is documented
  and testable while staying fail-closed (RFCT-139).
- **Test honesty**: dotted keys' missing item objects are certain rather
  than theoretical (RFCT-094), and "0 skipped" no longer hides skips
  (RFCT-096).

## 2026-09-08 17:02 [decision]

Repository wired into the PMA workflow per the skill as of 2026-09-08 15:42
UTC. `docs/CHANGELOG.md` renamed to `docs/changelog.md` (18 references
rewritten). Two records renamed from the interim slug-first form to the
`<timestamp>-<feature-slug>` form, IDs stable in meaning:
`file-ab-signed-components-20260908T1423Z` → `20260908-1423-file-ab-signed-components`
(task) and `file-ab-signed-components-20260908T1428Z` →
`20260908-1428-file-ab-signed-components` (plan); their four cross-references
updated. Added `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/decisions/`,
`.gitattributes`, `.editorconfig`, `.env.example`. Fast path stays
enabled. Record: `docs/plan/20260908-1702-pma-project-injection.md`.

## 2026-09-08 17:11 [progress]

Plan `20260908-1428-file-ab-signed-components` (file-based A/B, independently
signed components, three-partition layout, unified DATA) approved by the user
for implementation. Task `20260908-1423-file-ab-signed-components` claimed by
L1. P1 — the feasibility gate — is being dispatched as two parallel L3 tasks;
later phases wait on its evidence per the plan's own sequence.

## 2026-09-08 17:14 [progress]

P1 of `20260908-1428-file-ab-signed-components` dispatched: `ew42ee3o`
(P1-A, boot/trust primitives) and `iku9ubdw` (P1-B, writer audit), records
`20260908-1712-p1-signed-verity-boot` and `20260908-1712-p1-writable-path-audit`.

## 2026-09-08 17:19 [progress]

User direction on `20260908-1428-file-ab-signed-components`: parallel
execution confirmed; x64 completes each phase first and is verified under
QEMU, then the same layout is applied to cx3576 and the other boards. The
plan's sequencing rule and annotations record it; both P1 tasks were
re-prioritised by follow-up, and P1-A reports its x64 stage separately so P2
for x64 can open on it.

## 2026-09-08 17:27 [progress]

`docs/verify-status.sh` now accepts any plan record under `docs/plan/` (index
excluded) for a `proposed` status line, instead of only `PLAN-NNN.md`; the
negative test carries both record shapes and an index-only case, and the
user-doc contract (en and zh) states the rule. Task `20260908-1727-status-gate-plan-naming`.

## 2026-09-08 19:32 [progress]

P1-A of `20260908-1428-file-ab-signed-components` reports the boot/trust half
feasible as drafted: signed dm-verity accepted/refused with the plan's errno
set on x64, virt-arm64 and the cx3576 vendor kernel; one kernel boots two
signed roots; cx3576 FIT enforcement in the U-Boot sandbox; systemd-boot
shared-UKI Type #1 entries with boot counting on x64 and virt-arm64. L1
verified the raw logs, re-ran the gates and refused a byte-flipped signature.
Merge pending the committed harness and the x64 contract.

## 2026-09-08 20:11 [progress]

Three tasks opened from the P1-B audit's findings, none part of the file-based
A/B contract: `20260908-2011-state-units-never-load` (units seeded into STATE are never
loaded on first boot), `20260908-2011-ssh-generator-vs-image-policy` (port 22 conflict
and `AuthorizedKeysFile` override) and `20260908-2011-wtmp-unbounded-append`. Recorded
pending; not dispatched from the P1 watchdog.

## 2026-09-08 20:22 [progress]

P1-B of `20260908-1428-file-ab-signed-components` merged: the x64 writable-path
contract (14 leaves, 25 paths with no writer), the random-seed file bind proven
across start, shutdown and reboot, the container-network destination under
`/mos`, and the change list P5 inherits. L1 reproduced the static audit and one
candidate boot before merging. Record `20260908-1712-p1-writable-path-audit`.

## 2026-09-08 21:04 [progress]

P1-A of `20260908-1428-file-ab-signed-components` merged, completing P1: the
feasibility gate passed on every proof without weakening a requirement. The
kernel floor now embeds a verity trust anchor and requires the root-hash
signature check, the contract reads it back, and the signed-boot lab is on the
tree. Two shell lints that the P1-B merge had left red on main were fixed in
the same step. P2 (frozen artifact/descriptor contracts) is dispatched for x64.

## 2026-09-08 21:06 [progress]

P2 (x64) of `20260908-1428-file-ab-signed-components` dispatched: `ofu05clu`,
record `20260908-2105-p2-descriptor-contracts-x64`. Watchdog cron replaced to watch it.


## 2026-09-08 21:50 [progress]

P2 of `20260908-1428-file-ab-signed-components` is complete locally after the
user resumed work following P1 review. Rust and Bun share strict signed
component contracts and golden negatives; support identity binds all verity
metadata. The server's Ed25519 signer is shared with build tooling, root hashes
use pinned RSA/SHA-256 PKCS#7 signing, and BSPs require explicit public trust
inputs instead of silently minting keys. x64 QEMU accepts the anchor before
validity and after expiry; built-in-key revocation returns EACCES. Replacement
kernel rotation remains P9. Build 1,028, focused contracts/signing 42, Rust 68
and server 36 tests passed, along with the compiled server, docs and relevant
shell/trust gates. Record `20260908-2115-p2-descriptor-contracts-x64`; P3 is next.

## 2026-09-10 10:13 [progress]

Campaign `mos-open-plans-20260910-100408` established its task, implementing
plan, and ownership registry under L1 `#314` / `10nksom6`, with D coordinated
by `#318` / `z36xbrtu` and the campaign task serialized to stable owner
`bkd/z36xbrtu`. A (`#315` / `6064wf7l`), B (`#316` / `8t4ghqi6`), and C
(`#317` / `58sdocnk`) retain their bounded workstreams; external active owner
`#313` / `4ay6q72f` retains S905X5M integration. The integration branch is
`main` and the committed source base is
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.

The approved charter covers parallel dispatch, scoped local L3 commits, and
L3-to-L2 merges, but no L2-to-`main` merge, remote publication, or `done`
transition. Fresh newest-image flashing is the development target; historical
compatibility readers, migrations, RAUC restoration, raw-slot paths, and old
update-package support remain out of scope. D1 records tracking only. D2 waits
for D1 to merge into `bkd/z36xbrtu`; D3 waits for D1, D2, and L1's exact
approved sibling/`#313` commit and lifecycle evidence before global
reconciliation. PLAN-037 remains a non-executable umbrella, and PLAN-086 S5's
2026-09-08 rejection remains in force alongside the separate allowed BusyBox
startup/shutdown plan.

Initial active L3 grants are A=2, B=1, C=2, D=1 (maximum six). Expensive-build
grants are A=1, B=0, C=0, D=0 (maximum two, with one position reserved while
`#313` builds); D performs no full image build. Missing indexed CX3576 records,
removed RAUC/TUF references, and PLAN-086 lifecycle divergence remain explicit
D2/D3 obligations. No product implementation, image build, hardware proof, or
historical reconciliation is claimed by this entry.

## 2026-09-10 10:31 [progress]

D1 incorporated the campaign's timestamped coordination evidence without
changing sibling-owned records. L1 observed the unique A/B/C/D 15-minute crons
`gf4aphxr`, `nkglvdlt`, `w8lj5nbz`, and `v2kr5k8p` enabled and nondeleted at
2026-09-10 10:14–10:15 UTC. The registry now records A1–A4, serial B0–B7, and
C1–C2 ownership, dependencies, models where supplied, owned paths, grant use,
and verification boundaries. Their running and todo states remain timestamped
observations; D owns only later global index/changelog reconciliation and does
not reset their task or plan states.

`#313` / `4ay6q72f` reported S905X5M implementation and offline acceptance
complete and released implementation ownership, but its 108 delivery changes
remain dirty and unstaged on `main` at source base
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`. No approved commit/tree handoff
exists. L1 validated the 1,730-entry source record with canonical
`sourceSha256` `5eab1647263866e310b98999e9d5df063aa6bbe3248fc8a0bd7ee7a907c75b42`
and reverified the 56-entry artifact manifest; these remain read-only dirty
evidence, not synchronized source or hardware acceptance. D3 and B1 stay
blocked on L1's exact approved committed identity.

The recorded S905X5M artifacts retain development signing and dirty identities;
no hardware was flashed and `releaseTarget=false`. Every physical-board row
remains pending. `#313` retains its completed delivery records for eventual
preservation. Its unused reserved expensive position returned to L1's
unallocated pool; grants remain A=1 and B/C/D=0 until reassigned. No `main`
merge, push, compatibility fallback, product implementation, image build, or
hardware claim was performed by D1.

## 2026-09-10 10:39 [progress]

L1 supplied the user-authorized `#313` S905X5M source handoff, superseding the
10:31 no-commit state for current dependency decisions while preserving it as
chronology. Exact local commit
`5d0dca577a782aa707d9530779c4b23f2a7eda31`, tree
`a8b079edc67010b6662b2243a5647950eb7176ef`, and parent
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d` carry the subject
`feat: integrate s905x5m with signed-file boot and SD images`. The approved
scope has 108 changed paths, 105 after rename detection; L1 verified its 1,730
source-record entries against canonical `sourceSha256`
`5eab1647263866e310b98999e9d5df063aa6bbe3248fc8a0bd7ee7a907c75b42`.
`main` was clean after the local commit, no push occurred, and `#313` reports
no remaining implementation, build, cleanup, or source lock.

Immutable `committed-source.json` maps 1,727 committed files/links plus three
deletions to the complete tree and has SHA-256
`ce4330ed3845acf77e5e7f061d62255761eed80d21172211139ca7dc6180cd7c`.
The original source record and 56-entry artifact manifest remain byte-for-byte
unchanged. Existing artifacts remain source-equivalent pre-commit
dirty-stamped development builds with `BOARD_RELEASE_TARGET=0`, not rebuilt
clean artifacts or hardware evidence. Physical S905X5M rows and the separate
complete eMMC installer milestone remain open.

D1 did not synchronize source. At D's next safe boundary, L2 may take only the
exact approved commit into its clean branch; D2 must then use the integrated
local `bkd/z36xbrtu` HEAD. D3's `#313` source dependency is satisfied, but D3
still waits for reviewed A/B/C handoffs and ordered final reconciliation. The
registry also records reviewed B0 commit
`488b8d68b240ae818dc4b763c46ed7b7f9904129` without claiming it is integrated
into B. Grants remain L3 A/B/C/D=2/1/2/1 and expensive A=1, B/C/D=0, with the
second expensive slot unallocated at L1. No main merge, push, publication, or
`done` transition is authorized.

## 2026-09-10 11:11 [progress]

D2 reconciled the bounded open task/plan set for campaign
`mos-open-plans-20260910-100408` without changing product code or current
architecture/design wording.

The dangling index-only task
`cx3576-reproducible-bsp-20260907T1356Z` and plan
`cx3576-reproducible-bsp-20260907T1400Z` were introduced together by
`dfe16aca45fd66ccea766cbe31d5facf0787ff4a`; neither detail path has any blob
in reachable history. PLAN-087 identifies the plan as an untracked draft from
issue `69d0bv7y`, reconciles its measurements and scope, and records completion
through RFCT-343 and RFCT-345. Both dangling rows were therefore removed rather
than fabricated or restored.

PLAN-037 remains an implementing, non-executable coordination umbrella owned by
campaign D (`bkd/z36xbrtu`). Its dated RAUC/TUF and raw-slot roadmap text is
explicitly historical; current execution follows the strict signed-file
contracts. PLAN-086 and RFCT-336 now truthfully identify campaign B ownership
of remaining S3/S6 work. The user's 2026-09-08 decision is unchanged in meaning:
**S5 was declined, not deferred and not owed; the slice is out of the plan.**
The separate BusyBox boot/shutdown work does not authorize general
shell/network-tool reduction, outbound-SSH removal, or PAM/NSS/crypto pruning.

Historical S905X5M records were reconciled against current signed-file task
`20260910-0554-s905x5m-current-system` and plan
`20260910-0559-s905x5m-current-system`. PLAN-910, PLAN-913, PLAN-915 and
PLAN-916 are closed as superseded; PLAN-911 is completed by its recorded
hardware smoke result; PLAN-912 retains the real controlled-peer gap with no
invented owner. RFCT-915 and RFCT-335 are completed. RFCT-921, RFCT-926,
RFCT-932, RFCT-944 and RFCT-945 are closed as superseded. RFCT-922 remains
pending and unassigned for a controlled-peer run on a fresh current image.

Four obsolete task details left the tree with their index rows: RFCT-916
(`Declare the shared kernel surface for container networking`) had completed
historical PLAN-911 evidence and an obsolete M2/RAUC deployment path; RFCT-925
(`Decide the tree-wide FIT verified-boot design`) is superseded by the current
required signed-FIT contract; RFCT-934 (`Prove the s905x5m A/B watchdog and
rollback on hardware`) used the removed RAUC/raw-slot path, while its physical
watchdog/power-cut gap remains open in the campaign; RFCT-940 (`The installer
card blocks Linux boot on a board it already installed`) already said it was
fixed and proven on hardware. Its full evidence remains in Git history.
RFCT-941 (`The installer reinstalls on every boot because its receipt never
persists`) is also fixed and proven, but remains because the current S905X5M
board dossier links to its evidence; its link to deleted RFCT-940 became a bare
historical ID. Current S905X5M physical installation, boot, peripheral,
watchdog, recovery, power-cut, shutdown, MQTT and native-container obligations
remain explicitly unassigned and blocked on a fresh newest-image bench run in
the campaign record; historical evidence was not relabeled as current proof.

PMA lifecycle transitions used `task-state.sh`: RFCT-273 and RFCT-336 were
unclaimed from their stale owners and claimed by the current D and B
coordinators; RFCT-335 and RFCT-915 were completed; RFCT-921, RFCT-926,
RFCT-932, RFCT-944 and RFCT-945 were closed; RFCT-922 was unclaimed. Serializer
rejections for legacy noncanonical records are preserved verbatim in the
campaign task. No owner/status field was hand-edited after a rejection.
