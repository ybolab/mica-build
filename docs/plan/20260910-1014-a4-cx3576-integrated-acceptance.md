# 20260910-1014-a4-cx3576-integrated-acceptance CX3576 integrated artifact and board acceptance

- **status**: completed
- **createdAt**: 2026-09-10 11:38
- **approvedAt**: 2026-09-10 11:38 (campaign charter `mos-open-plans-20260910-100408`)
- **relatedTask**: 20260910-1014-a4-cx3576-integrated-acceptance

## Context

The branch now contains the exact reviewed L2 source at
`a39807d8392f0838e6e5438e3e57518f9b1bdd81`, including the approved S905X5M
source, A1 encoder repair, A2 acceptance baseline and A3 late-HDMI/VT repair.
A1 and A3 host fixtures passed, but no coherent ARM64 kernel/object/modpost build
has yet proved their combined result. The A2 matrix identifies nine concrete
collector gaps: guessed API/media defaults, incorrect health and storage policy,
no 180-second observation or early watchdog handoff, missing current display and
accelerator/radio evidence, incomplete install provenance, and stale rescue-SD
recovery wording. No current bench endpoint or flashed image is confirmed.

## Proposal

1. Add focused host tests that reproduce the collector's current-contract gaps,
   then minimally update the collector and bench procedure so identity inputs are
   explicit, required-health and 180-second evidence are distinct, current
   storage/display/accelerator/Bluetooth/watchdog/recovery obligations are
   recorded, and the report never upgrades an unobserved row.
2. Run the cheap mandatory source, shell, watchdog, netavark and documentation
   gates. Apply the complete pinned kernel patch series to a task-owned source
   tree and rerun A1/A3 fixtures against that actual source and new DTB.
3. Commit the coherent source identity, then launch at most one granted CX3576
   kernel build in a persistent tmux shell using the existing recipe and explicit
   trust/artifact inputs. Bind Image, DTB, config, modules/support, FIT and object
   evidence to the committed source, timestamp and hashes. Run only applicable
   negative/readback/offline checks for a newly assembled candidate.
4. Record every physical CX3576 and S905X5M obligation as blocked with exact
   operator prerequisites when no confirmed bench exists. Review the actual diff
   with pma-cr, complete scoped tracking, commit only owned files and report once
   to L2 through the guarded BKD follow-up endpoint.

## Risks

- A collector can create false confidence if defaults are mistaken for device
  discovery or optional failures are treated as required-health failures.
- A successful host fixture or kernel build does not prove boot, watchdog,
  display, accelerator, radio, power-cut or recovery behavior on hardware.
- Existing build recipes may require unavailable signing inputs or collide with
  shared scratch discovery; missing inputs are blockers, not permission to invent
  keys or consume another workstream's outputs.
- The S905X5M artifacts are source-equivalent dirty development builds, not a
  clean-commit rebuild or physical qualification.

## Scope

Write only the unique A4 task/plan and scoped index entries,
`docs/bsp/cx3576-bench.md`, `docs/bsp/cx3576-bench-collect.sh`, and new focused
collector tests under `tests/cx3576-bench/`. Kernel, board, build, rootfs,
lifecycle, packaging, shared verifier, sibling tracking and global history files
are read-only. One expensive CX3576 kernel/root/QEMU job may run at a time; no
full image rebuild is justified by documentation alone.

## Alternatives

Manual wrapper instructions alone would leave the known collector defects
repeatable and unaudited. Reusing historical images or fixture passes as current
hardware evidence is rejected because neither binds a current flashed image to
the named board and physical observations.

## Annotations

- Approval source: user-approved full-tier campaign
  `mos-open-plans-20260910-100408` and final A4 start handoff on 2026-09-10.
- Development-only newest-image delivery; backward compatibility is not required.
- L2 integrates this branch; D owns later changelog/global reconciliation.
- Recovery retry 1 resumes the existing owned work after the prior execution's
  unexplained exit 137 / SIGKILL. No upstream sync is repeated. Scoped review
  reproduced and corrected four evidence-integrity defects with RED/GREEN;
  the checkpoint keeps this plan implementing while the committed-source kernel
  gate is pending. Exact recovery logs and coordination mappings are in the
  paired task.
- A/L2 coordinates CX3576, S905X5M and original-device reboot acceptance; A4
  integrates evidence, but physical operator/device/endpoint inputs remain
  unconfirmed. The available A kernel gate is independent of future reviewed
  B/C integration, which is not imported or treated as source-identical.

## Earlier bounded outcome — retained chronology

Collector correction and evidence delivery are complete. The coherent kernel
gate at `38a362cd3ce46bab6d1f04489503dca9b92b664c` passed on
2026-09-10T19:16:56Z..19:31:44Z, exit 0; all 42 emitted artifact/object/source
checksum entries were revalidated. The paired task records exact output hashes,
actual target ELF/call evidence, the host-only fixture limits and inherited
warnings. Documentation commits after that checkpoint do not relabel artifacts.

Current-contract composition is blocked by a concrete artifact gap: both known
CX packed roots still contain older bounded application quotas. Existing public
trust and development signing paths are available, so absent future B/C code or
“missing keys” is not used as the blocker. The root/packaging owner must provide
an admissible current CX root and source-bound native init; new signed support,
FIT and deployment records then require their own exact-candidate gates. No
image, firmware, x64/virt-arm64 matrix or the passed kernel was rebuilt merely
for documentation. This completes the bounded software/evidence deliverable,
not exact-image composition or any of the mandatory physical rows.

## Authorized composition phase — in progress

The subsequent exact L1/L2 source/input handoff resolves the earlier current-root
and native-init dependency. It authorizes read-only execution of the existing
recipes at `9d1218e2689eb5e3fce99ad1736f3a1fdc8c8801` in a private,
self-contained clean checkout, not B/C source integration or product edits.
The completed status above retains the earlier outcome; the new phase state is
recorded here and in the paired task without fabricating a PMA reopen operation.

1. Verify exact source and selected inputs, preserve the passed kernel identity,
   and rebuild only selected packages whose old stamps fail current freshness.
   First serialize system/profile/CA/radio policy and the ARM64 CX board package;
   collect actual archive hashes, source identity, index and layout-script proof.
2. Complete the remaining selected ARM64 producers and existing package gates,
   then build a new CX dev root with management, containers and normal radios.
   Verify installed current layout, units, dependencies, public defaults and
   console/reset policy from the actual root, not the old images.
3. Reuse the approved native init and inherited firmware with their original
   provenance; generate new support/FIT, signatures, fresh records and full image.
   Run exact-candidate negative/signature/readback/offline gates without importing
   pending B/C payload. A separately pinned approved C verifier may be used only
   as a tool with a distinct verifier identity.
4. Review the concrete evidence and scoped docs, record exact outcomes and
   remaining hardware rows, then commit locally for L2 integration. D owns global
   history. One heavy job runs at a time; each detached gate is reported promptly
   and collected by L2 before continuing. No physical action is authorized.

This is the next artifact phase of the same node, not recovery retry 2. The
paired task holds the exact private paths, command and gate metadata.

Policy-package milestone collected: six producers passed at exact `9d1218e2`
on 2026-09-10T20:29:32Z..20:31:34Z, exit 0. Their actual current layout script,
archive/index hashes and source identity were revalidated. The next serialized
gate builds only the remaining five ARM64 native producers and checks the
selected CX archive set. Container-engine binary reuse was validated against
the approved original package and pinned sources, not relabelled as a new
upstream compile. Full root/signature/image and physical acceptance remain
separate following stages; no full two-architecture package matrix is claimed.

Native-package milestone collected: the remaining five selected producers
passed at exact `9d1218e2` on 2026-09-10T20:48:22Z..20:57:03Z, exit 0.
All 14 selected archives and their recorded ELF/dependency/ownership evidence
were checked; three dpkg-shlibdeps warnings remain explicitly recorded. Proceed
with the unchanged CX dev root recipe and mandatory smoke gate, then inspect
actual root semantics before signed composition. No policy/native/kernel
rebuild or new source synchronization is needed. The pending exact C.D4 verifier
handoff gates its later candidate scan, not this root build.

Subsequent root acquisition failed at 2026-09-10T21:21:41Z, exit 2: the pinned
`adduser_3.152_all.deb` download reached the original 600s ceiling before root
installation. L2 authorized recovery retry 2 (maximum 2). The current lock's
172 runtime archives and bootstrap helper were then verified from exact existing
caches and staged privately; the unchanged offline cache verifier passed.
This demonstrated input change permits one recovery root gate, with new logs
and preserved failed evidence. No product edit, timeout relaxation, package or
kernel rebuild, automatic retry 3, or hardware pass is authorized or claimed.
