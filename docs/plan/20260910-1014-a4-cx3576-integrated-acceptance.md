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

## Authorized composition phase — components emitted; full candidate in progress

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

Recovery retry 2 terminated on 2026-09-10T21:48:19Z, exit 2. Cache verification
succeeded with zero downloads; compose/pack emitted the new current-layout root
within its 254 MB / 400 MB installed-size budget. Mandatory smoke failed before
execution because the task's load-copy tar editor damaged a layer boundary.
The original seven-member OCI is readable and all three blob hashes/sizes match;
its SHA-256 is `d23db6942e49b002aee615d60027a962eaf4752097d09755a7eae55529365f5f`.
The emitted verity image, geometry, actual layout/public-meta/ELF hashes and
retained warnings are recorded in the paired task. They do not establish root
runtime, signatures, a complete image or hardware qualification.

The read-only diagnosis locates one missing 512-byte layer block in the edited
copy and the shifted config header, not a proven internal GNU tar root cause.
Proposed recovery is confined to constructing and validating a fresh load-only
archive before the unchanged smoke, preserving original bytes and content IDs;
it needs actual-boundary RED/GREEN and L1's concrete decision via L2. No adapter
fix, new copy, load, smoke, gate or composition advance is authorized by terminal
collection. Retries 2 of 2 are exhausted. Passed packages/kernel and emitted
root are preserved, not rebuilt. Heavy usage is zero; the persistent shell is
idle. The completed PMA status still covers only the earlier collector/kernel
outcome; no status/index operation is made for this blocked content update.

On 2026-09-11 L1 explicitly approved the adapter-only recovery above through
L2. Preserve automatic retries=2 and separately record
`l1AuthorizedAdapterRecovery=1`; no automatic fourth recovery. Correct only a
new private adapter, preserve the actual corrupt archive as RED and original
as positive control, prove streamed reconstruction GREEN and review its Python
and shell boundaries before loading. Run unchanged smoke directly on existing
root bytes; do not rebuild packages/root/kernel. The previous blocker/history
remains a dated outcome, not the current authorization state.

The exact C verifier tool handoff at `48acef7f` is resolved, separately from
actual candidate execution. Its required third native ELF is mos-deploy, not
mos-mqttd. Use only a separately identified tool snapshot for the eventual
authenticated image scan; no C payload is imported into artifact source
`9d1218e2`. Prior PMA completion fields and all physical blockers are unchanged.

The unchanged mandatory smoke passed on 2026-09-11T00:45:29Z..00:45:57Z,
exit 0, at artifact source `9d1218e2` and documentation checkpoint `6d08754c`.
It executed 11 PASS / 1 EXECUTOR-LIMITED (crun) / 0 failures / 0 unclaimed
through BuildKit/qemu-user. The task preserves the exact crun diagnostic and
unasserted-version limit; this is not native crun or physical qualification.
Original root/OCI, source, corrected/broken copies and shared factory alias
were revalidated unchanged. No passed input was rebuilt.

Continue step 3 with the new private `components-20260911-C9sQha` gate:
sign the existing root, then produce new support/FIT using the exact compiled
kernel, approved source-equivalent init and existing matching development keys.
Public derivation correspondence and fixed FIT-tool script hashes passed.
The task records byte-preserving filename mappings, exact manifests, limits
and detached-gate paths. Detailed loader/service/device closure, firmware-key
authentication, fresh records/full image and C-final candidate verification
remain following obligations, not inferred passes. Historical automatic
retries=2 and separate authorized adapter recovery=1 remain unchanged.

Component production passed on 2026-09-11T01:00:14Z..01:00:34Z, exit 0,
documentation checkpoint `809329ab`, unchanged artifact source `9d1218e2`.
All 16 emitted files and original inputs were revalidated. The task records
new root/kernel/support IDs, full build-identity reconstruction with the
selected init, and authenticated inherited firmware descriptor. This is not
yet full FIT-under-firmware/CMS-negative or full-image acceptance.

Continue with the single `candidate-20260911-4LPPCz` gate: actual embedded
firmware trust and negative cases; separately inspect init/exitrd/root ELF
closure; create fresh generations 2026091101/2026091102 and a timestamped full
image; run current board offline checks and exact C-final `48acef7f` as a
separate read-only tool. Preserve detailed failures and all successful inputs.
No rebuild, automatic fourth recovery, source import or physical action is
part of this continuation. D receives these phase deltas through L2 only.

### Final current-A candidate evidence — 2026-09-11

The original candidate gate remains RED (exit 1, 01:19:24Z..01:22:16Z), solely
for the task-owned per-object closure model. Its trust/negative/image/offline
subchecks and the exact C-final authenticated runner passed, the latter with
126 checks / 0 skipped and 3 native ELFs / 19824184 scanned bytes.
L1 separately authorized a bounded checker correction after inspecting the
actual bytes; `historicalAutomaticRetries=2`, `l1AuthorizedAdapterRecovery=1`
and `l1AuthorizedCheckerCorrection=1` are distinct, with no blanket retry grant.

Actual original-root ARM64 loader `--list` exited 0 at 01:34:26Z..01:34:27Z.
Its complete consumer/loaded-SONAME map and 22 OCI/packed-root file identities
justify the private context correction without inheriting RUNPATH or adding a
global systemd directory. Focused RED/GREEN covers the actual readelf failure,
missing/wrong/hash-mismatched providers, transitive/version failures and
RPATH/RUNPATH controls; 13 tests pass. Only affected static root closure was
rerun, 01:40:13Z..01:40:24Z, exit 0, 1050/1050. All earlier 1049 successful
rows retain exact hashes/interpreters/provider maps; initramfs/exitrd gates
were preserved. The task detail binds all commands, reports and limitations.

The new aggregate is `F/checker-correction-20260911-0v18dL/aggregate.json`,
SHA-256 `cd8e152347765734a29b5eb4428ef05da610056ade8387aaac07fa6f0375af9e`:
current-A software PASS with the existing crun executor limitation, not native
or physical qualification. Exact image `mos-cx3576-20260911-012036.img` has
SHA-256 `9939186656bd553e337237e0f4cb44584f24088e17f4e453a9d2d7032754827e`,
fresh signed generations 2026091101/2026091102 and SYSTEM=1 GiB. Artifact source
remains `9d1218e2`, kernel `38a362cd`, verifier tool `48acef7f`; inherited firmware
and dirty-development init provenance are not relabelled. No passed artifact
or gate was rebuilt, no B/C payload imported and no old RED erased.

Repository changes remain the existing task/plan/bench evidence only. PMA
completion fields preserve the earlier bounded software outcome; there is no
reopen/index/status operation. Scoped shared/Python review and cheap docs checks
precede the final local documentation commit and L2 review. Heavy use returns
to 0; evidence and the idle shell are retained. All mandatory physical rows,
NPU, S905/original-device and native crun remain unqualified; optional D5 is
nonblocking. D alone reconciles later global history through L2's handoff.
