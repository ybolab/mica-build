# 20260908-2229-file-ab-delivery-x64-first Complete signed file-based deployment delivery, x64 first

- **status**: in_progress
- **priority**: P1
- **owner**: worker/delivery-20260908
- **createdAt**: 2026-09-08 22:29
- **relatedPlan**: [20260908-1428-file-ab-signed-components](../plan/20260908-1428-file-ab-signed-components.md)

## Description

Implement the remaining P3-P10 phases of the approved plan. Finish the x64
producer, authenticated boot, three-partition image, installer, service/API,
health/fallback and acceptance path first, then apply and verify virt-arm64
and cx3576. No old-layout or update-package compatibility is required.

## ActiveForm

The clean cx3576 factory image is built and verified; physical bench qualification remains.

## Dependencies

- **blocked by**: (none; P1 and P2 completed)
- **blocks**: completion of the parent plan

## Current delivery status (2026-09-09)

P3-P9 are implemented. Current software acceptance, measurement and cleanup
below pass; P10 and the overall plan remain open for physical cx3576 acceptance.
No old-layout reader, migration, RAUC or lode update runtime
is retained. All acceptance sequences start with a complete current factory
image. Independent S905X5M BSP sources remain without a MOS system-image target.

### Full-image acceptance

Every listed result has an exit-zero controller record under `.tmp/`. The user
requested deletion of all `_out/` contents on 2026-09-09: artifact and transcript
paths recorded before the clean rebuild below are now historical locations.
The clean rebuild section identifies the currently available local artifacts.

| Gate | x64 evidence | virt-arm64 evidence | Result |
|---|---|---|---|
| Runtime, root/kernel/combined update, failed health, retained fallback, activation/state-write recovery and exitrd | `_out/file-runtime.0LmCjR/boot` | `_out/file-runtime.pKLWhT/boot` | PASS; `current-durable-acceptance2.rc` |
| Actual kernel panic and hardware-model watchdog reset; three persisted attempts then full-runtime fallback | `_out/kernel-faults.tLVZKC` | `_out/kernel-faults.lLWqrh` | PASS; `current-durable-faults2.rc` |
| Hang after native watchdog arming, before SYSTEM/systemd; three resets then fallback | `_out/early-hang.cUKNO2` | `_out/early-hang.PyknhY` | PASS; `current-early-hang-acceptance2.rc` |
| Configuration, application-data and full-factory reset; process killed after deletion, retry, then idempotent boot | `_out/reset-runtime.9OTWRY` | `_out/reset-runtime.mVvqiB` | PASS; `current-reset-x64-2.rc`, `delivery-reset-arm3.rc` |
| Latest pure factory image API | `_out/delivery-api-x64.7AnGb5` | `_out/delivery-api-arm.YTWdR2` | PASS; 153/153 and 151/151 combined checks (142 and 140 API checks) |

The runtime matrices include machine identity, random seed, persistent units,
support mounts before consumers, firmware readback, immutable var parents,
DATA growth and byte/inode quota containment under production writer privileges.
Panic and pre-SYSTEM tests do not prove reset coverage before the watchdog
driver/native arming point or during a physical firmware handoff.

Production HTTP acquisition passes at `_out/durable-http.Gov3YF`. The server
records completed response bodies and the guest verifies acquired objects.
Installed deployment `c602ea92caed25ee9326e321b953123a46672158f652baa05efaa2e2c31ffd0e`
boots offline without a NIC at both 2040-01-01 and 1970-01-01, with full services
and shutdown (`_out/offline-clock.N2mh67`, `current-durable-http.rc`).

### Current artifacts and component gates

- `delivery-packages.rc`: rebuilt mosd/apid for both architectures and composed
  x64, virt-arm64 and cx3576 roots after TLS durability and API schema cleanup.
  Root smoke is 12/12 on x64; ARM roots report the known qemu-user crun limitation
  explicitly. Full-system QEMU container and API checks pass separately.
- cx3576 `_out/final-cx.zsIRsh`: required FIT signature negatives, the complete
  three-partition image, 123 offline checks, DATA-only growth/identity refusal
  and the 14-artifact release gate pass (`delivery-cx-all.rc`).
- x64 `_out/delivery-api-x64.7AnGb5/release`: 14 required artifacts, SHA256SUMS
  and independent pinned release verification pass (`delivery-x64-release.rc`).
  Release provenance records the precommit dirty source used for these builds;
  it must not be rewritten to claim a later clean commit built them.
- Native transaction faults: 381 install/confirmation/GC cases cover 127
  boundaries with before/after/failure injection across UEFI and FIT
  (`_out/io-faults.CvEV2O`, `io-fault-matrix3.rc`). The production FIT C policy
  passes mocked hardware I/O under ASan/UBSan (`fit-firmware-io2.rc`).
- Boot/content/metadata overlap and removal, UEFI loader replacement/restoration
  and required FIT signer tests pass (`uefi-firmware-rotation2.rc`,
  `fit-trust-production.rc`, `_out/trust-rotation.yO4on0`). Physical ROM/SPL
  provisioning and USB/device readback are separate acceptance requirements.
- Actual offline seed refusal leaves the whole image SHA-256 unchanged for
  a symlink parent, non-directory parent and symlink target
  (`_out/seed-refusals.1ahZ57`, `current-seed-refusals.rc`).

### Measurements

| Update | Downloaded HTTP object bytes | Guest SYSTEM block-write bytes | Guest ESP block-write bytes |
|---|---:|---:|---:|
| Root only | 74,584,521 | 74,907,648 | 5,120 |
| Kernel only | 49,799,145 | 421,888 | 49,836,032 |
| Combined | 124,313,577 | 75,223,040 | 49,836,032 |

HTTP counts exclude headers and transport overhead. Block counters include
installation sync/GC and exclude physical flash amplification. Before/after
space accounting in that fixture is not a continuous peak measurement.

The fresh `_out/file-runtime.snfFfq/boot` measurement run samples during each
installation with a 100 ms sleep between paired SYSTEM/ESP observations. It
passes all three installs, subsequent authenticated boots and full exitrd
shutdown (`delivery-peak-usage.rc`). The parser also proves that an in-flight
peak exceeds both endpoint values in a synthetic control and refuses missing
live samples (`delivery-cleanup-checks.rc`). Sampled peaks cannot rule out
shorter unsampled peaks.

| Update | Live samples per partition | Observed SYSTEM peak bytes | Observed ESP peak bytes |
|---|---:|---:|---:|
| Root only | 51 | 149,327,872 | 49,958,912 |
| Kernel only | 42 | 149,409,792 | 99,688,448 |
| Combined | 73 | 149,491,712 | 149,417,984 |

Large-root proof at `_out/large-root.H5QHVu` compares 74,604,544-byte and
480,428,032-byte roots over three boots each. Median early-init times are
1,948/1,464 ms; maximum observed early-init RSS is 2,796/2,716 KiB. The paired
whole-runtime wall-time run at `_out/large-root-wall.Z46v4x` has medians
58,440/57,379 ms. This supports absence of a compulsory full-root boot hash scan;
it is not a claimed performance gain or a physical-board benchmark.

### Source, documentation and review

- Full mosd formatting, clippy, nextest (1,050/1,050), doctests, dependency policy
  and OpenAPI gate pass (`current-durable-rust-gate.rc`). The later API-description
  cleanup passes strict clippy, schema generation and 18 focused update tests.
- The final native deployment workspace's complete Rust gate passes 44 tests,
  formatting, strict clippy, doctests and cargo-deny
  (`delivery-native-full-gate.rc`). Its one explicitly ignored outer I/O matrix
  requires the dedicated shim runner and passes there as 381 cases above.
- Pinned build suite passes 362/362 across 22 files
  (`current-retired-toolbox-retest.rc`). Real signing tests use the existing
  tool timeout instead of Bun's five-second default; assertions remain intact.
- Final cleanup verifier/typecheck passes 644/644 (`docs-cleanup-verify.rc`).
  The obsolete EPHEMERAL diagnosis has a failing-before/passing-after regression.
- Dashboard lint, typecheck, 150 tests/coverage and build pass
  (`docs-cleanup-ui.rc`). Update-server checks, compiled output and dependency
  audit pass with 42 tests (`server-ci-check.rc`).
- API spec pins 42/42 and harness selftests 48/48 pass
  (`delivery-api-spec2.rc`, `delivery-api-selftest2.rc`). Full-image API tests
  validate the task observer's admitted-ID/coalescing behavior without changing
  the production systemd timeout.
- Clean package installation closure passes 99 checks over 14 roots and both
  architectures; trust-domain hygiene passes (`durable-closure-trust.rc`).
- Documentation catalog, relative links, truth-status declarations, Chinese
  user-guide coverage and dossier checks pass, including their negative fixtures
  (`docs-refactor-gates.rc`, final content in `delivery-docs-final2.rc`).
  Host-toolchain lint and 25 negative cases, layout tests, preserved S905X5M
  front-panel integration and API harness typecheck pass
  (`delivery-cleanup-checks.rc`). Current API/dashboard/recovery/build contracts
  replace historical proposals. Superseded translations, prototype exports and
  unconsumed S905X5M raw-layout declarations/mounts are removed.
- Review covered activation/confirmation/GC ordering, acquisition/archive bounds,
  authenticated early boot, FIT persisted attempts, immutable server objects and
  atomic TLS publication. Valid context whitespace in the two upstream patch
  files is preserved. Generated artifacts and private fixture keys are ignored.

### Defects found and resolved

Panic testing found non-durable first-boot TLS material. `apid` now publishes
the certificate/key as one mode-0600 `identity.pem`, synchronizing the file and
parent directory; session keys use the same durable helper. No split-file reader
or migration remains. The original failure and successful rebuilt panic matrices
are retained separately.

The reset observer now expects the exact absent-path response after successful
intent removal. ARM reset uses the pinned native Rust builder's cross C linker;
the two prior compiler failures never booted a guest and are not counted as
reset passes. Earlier harness shell-read races and load-related API failures
are also excluded from the acceptance counts. Stable fresh-image reruns pass.

### Remaining work

1. Obtain the local cx3576 bench's serial/USB or management endpoint and power
   control. No usable board interface/address is available in this workspace.
2. Run the [physical bench sequence](../bsp/cx3576-bench.md): current whole-image
   flash/readback, startup/services, watchdog handoff, exhausted-deployment
   recovery, firmware maintenance and power cuts at the declared write/sync/
   activation/attempt/confirmation boundaries. Record exact board revision and
   artifact identities. Collector dry runs are not hardware evidence.

The authorized implementation and cleanup are committed with this delivery
record. No remote push or publication is part of this local delivery.

## Earlier implementation notes

The chronological observations below describe intermediate states and failures.
The current status and acceptance table above supersede their pending claims.

- The user extended P10 cleanup to reorganize documentation and remove obsolete
  documentation, duplicate prototypes and dead code. Keep current contracts in
  `docs/design/`, task-oriented navigation in `docs/README.md`, and exact evidence
  in this delivery record. Replace mixed historical API/dashboard/recovery/build
  descriptions; remove superseded engineering translations and unused raw-layout
  declarations after checking consumers. Verify document membership, links,
  status/locale coverage and the affected source gates before committing.
- The user explicitly authorized committing P2 and completing the entire plan,
  with x64 boot acceptance before arm64 and cx3576 work. This satisfies the
  implementation approval gate. Execute sequentially without remote dispatch.
- P2 committed as `f22e6cd8`; no push requested.
- The user reaffirmed that no compatibility code, migration path or legacy
  fallback is permitted. All test machines are development devices and every
  acceptance sequence starts from a freshly flashed complete current image.
- Verify each phase against its existing acceptance matrix. Physical-board
  evidence must remain distinct from virtual-machine tests.
- P3-P10 remain incomplete until their implementation and acceptance pass.
- P3/P4 work in progress: independent SquashFS/verity support and root producers;
  immutable output directories; x64 root manifest no longer selects its kernel
  package. The Rust early loader checks the signed descriptor, binds support
  before switching root and never scans complete system images at boot.
- Focused producer tests (2), boot-selection tests (3) and layout tests (2)
  pass. Full x64 boot acceptance and the remaining phase gates are pending.
- P6 source review found that systemd 257.13 ignores the return value from
  boot_entry_bump_counters and can select exhausted entries. Build the matching
  257.13 loader with a small patch refusing launch on persistence failure or
  exhausted attempts; exclude exhausted entries from persistent/one-shot default
  lookup. The original source archive is SHA-256 pinned from Debian's snapshot.
  Require QEMU negative evidence; P1's successful-counting proof did not cover
  these failure cases.
- x64 QEMU boot passes on the three-partition GPT image with enrolled Secure
  Boot, signed root/support mappings and modules bound before switch-root. The
  P4 payload also rejects an unlisted var write with EROFS. This is a minimal
  test root, not full MOS service acceptance.
- Patched loader fault tests pass: a read-only ESP refuses kernel launch after
  failed attempt persistence; three invalid-descriptor trials select the valid
  retained fallback; exhausting both records refuses boot without counter refill.
  Evidence: `_out/file-ab-x64.8ORMnj/{boot.log,faults/}`; harness exit status 0.
- P5 runtime implementation now consolidates state/meta under DATA, adds narrow
  random-seed/timer/linger/network/tmp mounts, keeps var parents immutable, and
  replaces whole-var seeding. Namespace tests cover modes, symlink refusal and
  insufficient capacity. Project limits preserve 128 MiB / 2048 inodes, with a
  separate 32 MiB / 2048-inode disposable limit; real writer enforcement remains
  a QEMU gate. Ordinary services exclude CAP_SYS_RESOURCE because the kernel
  otherwise permits bypassing hard limits. The fixed growfs helper retains it
  because ext4 requires that capability for resizing.
- The x64 GPT growth experiment uses systemd-repart 257.13 directly on a copy of
  the disk: ESP and SYSTEM stay fixed; only DATA grows from 256 MiB to about
  1.4 GiB on a 4 GiB medium. Do not use --image here: that mode attempts to
  dissect a discoverable root partition, which this file layout does not have.
- The full x64 user-space root has been composed with 174 upstream/local
  packages before the new deployment package addition. The updated mandatory
  mos-deploy smoke registration passes: all 12 shipped binary smoke checks pass.
  Full MOS QEMU acceptance is pending.
- P6/P7 now have a Rust deployment store and mos-deploy CLI: bounded status,
  confirmation, rejection, object integrity checks, destination reservation and
  durable entry-last publication. Five focused storage tests and clippy pass;
  interruption coverage, GC, acquisition, server/API/UI integration remain open.
  The health gate's 88 checks pass using the new backend and fail when that
  backend or its authenticated deployment identity is absent.
- x64 kernel was rebuilt with the supplied public content anchor and built-in
  i6300ESB watchdog, NOWAYOUT and watchdog sysfs. The early loader now arms it
  before opening SYSTEM. Watchdog reset coverage, including the firmware-to-
  kernel interval, still requires measurement; do not claim complete coverage.

- 2026-09-09: Full-runtime QEMU reaches signed root/support and systemd's
  watchdog takeover. It exposed an incorrectly escaped random-seed mount name,
  loop-root discovery in stock repart, and the capability required by ext4
  growth. Fixes are under QEMU iteration; no full-runtime pass is claimed yet.
- Reset now derives DATA/state from one physical DATA root, serializes with the
  installer's lock, validates physical namespaces and rejects nested mounts
  including same-device binds. Eleven reset tests and mosd clippy pass. Removal
  directories are synced before clearing the durable reset intent.

- Full-runtime QEMU acceptance passes on `_out/file-runtime.JF3Vad/boot`:
  enrolled Secure Boot; signed root/support; DATA-only GPT/fs growth to about
  1.4 GiB; immutable var parents; privileged byte/inode quota enforcement with
  state/meta writes still available; first-boot persistent unit discovery;
  random-seed save/reload; health-controlled native confirmation with fallback.
  The source fixes were applied to the full composed root for this iteration;
  rebuilding the producer packages and final rootfs is in progress.
- The initial random-seed file bind fails fsync_full against a SquashFS parent.
  The fixed symlink to DATA plus explicit seeding dependency passes, including
  inode preservation and save/reload. A second-boot persistence check remains.
- All mosd tests pass (561 unit tests and 8 integration tests). The deployment
  store's six focused tests now include GC retaining running/current/fallback/
  candidate references and shared kernel objects; corrupt retained metadata
  refuses collection before any deletion. Full install/fault acceptance remains.
- The rebuilt production packages pass all 12 binary smoke checks. A fresh
  full-runtime image at `_out/file-runtime.KCQ5VF/boot` passes boot, Secure Boot,
  signed root/support, DATA growth and quota enforcement, immutable var parents,
  persistent extension startup, seed persistence and health confirmation.
- On that fresh image, generation 3 updates only rootfs and generation 4 only
  kernel. Both install, reboot and confirm successfully; the unchanged component
  metadata and bytes are reused. Generation 5 has a deliberately failing health
  policy: exactly three attempts reboot, then generation 4 boots and confirms.
  The exhausted candidate is removed, recorded as failed and leaves the highest
  generation at 5. Evidence is `updates/{3,4,5}/` under that directory; all three
  harnesses exit 0. These are VM interruption/boot observations, not physical
  storage power-loss evidence.
- The production component CLI builds root, kernel, firmware, signed deployment
  and complete factory image independently. All commands pass using explicit
  signing inputs at `_out/component-cli.371pEb`. Root packaging verifies exact
  verity geometry and requires empty real modules/firmware mountpoints.
- GC now removes interrupted pending/partial publications under the transaction
  lock, after authenticating all retained descriptors. The reproducing test
  failed with `unexpected artifact name` before the fix and passes afterward.
  Mount validation now rejects subdirectory binds, checks partition numbers and
  one shared disk, and binds SYSTEM to the authenticated boot policy UUID.
  These latest hardening changes require another full-image runtime gate.
- Shared SYSTEM discovery/mount failure now selects explicit reflash recovery
  instead of consuming all deployment attempts. Bounded ext4 journal replay is
  the only automatic filesystem repair; no offline full-filesystem repair is
  added. QEMU fault verification of this change is pending.
- virt-arm64 now declares the three-partition file layout, packages board policy
  independently of the kernel, and builds its kernel with a built-in PCI
  watchdog for the acceptance VM. Cross-architecture UKI/initramfs tooling and
  ARM runtime package locks are in progress. P3-P10 are not yet complete.
- The rebuilt x64 image at `_out/file-runtime.DnG3FG/boot` passes the latest
  mount-binding and interrupted-publication changes. Root-only generation 3,
  kernel-only generation 4, three failed health trials at generation 5, fallback
  confirmation, and combined generation 6 all pass. Unchanged components are
  absent from the update media. Firmware digests remain identical throughout.
  Fresh-image faults at `_out/file-faults.pQtHEo` pass ESP persistence refusal,
  invalid-descriptor fallback, exhaustion without refill, and shared SYSTEM
  corruption poweroff for reflash.
- Native cross tools now build both x64 and arm64 systemd-boot/UKI/initramfs
  artifacts without executing target binaries. The complete arm64 root builds
  successfully (11 binary smoke passes; crun remains explicitly limited by
  qemu-user's fexecve behavior). The first full VM exposed missing QFMT_V2;
  project quota support is now a common built-in kernel requirement.
- The corrected full virt-arm64 image at `_out/file-runtime.5s72At/boot` passes
  signed boot, support binds, DATA-only growth, byte/inode quotas, immutable var
  parents, persistent extension startup, seed handling and health confirmation.
  Fresh-image faults at `_out/file-faults.FpM49O` pass the same four negative
  cases as x64. Its component update sequence is still running. Both VMs expose
  incomplete read-only loop/verity teardown at shutdown; this remains open.
- The update server now accepts exact signed deployment envelopes and immutable
  component objects, verifies every object before publication, reuses shared
  objects and publishes `mos/catalog/v1` inside the existing Ed25519 envelope.
  Old bundle input/routes are removed; the initial SQLite schema is replaced,
  without migration readers. OpenAPI 3.1 is generated from runtime validation;
  Scalar and the management console are included in the compiled service.
  All 39 server tests, contract snapshot, coverage gate, lint, typecheck and
  standalone build pass. Browser acceptance passes login, descriptor import,
  missing-object retry, upload, publication, reuse, withdrawal, trust display
  and Scalar with no page errors (`.tmp/p8-browser/result.json`).
- Native acquisition now verifies signed catalog freshness, source/digest URLs,
  exact deployment associations, catalog revision rollback/equivocation and
  deployment generation. Streaming offline `MOSUPD01` archives contain the same
  signed descriptor and at most five unique digest/length-bound objects; there
  are no archive paths, links or compression. The production archive CLI and
  44 focused TypeScript tests pass. Four Rust acquisition tests pass, including
  actual HTTP range resumption, corrupted/truncated imports, and shared-digest
  destination accounting; catalog tests and clippy also pass. The Rust gate
  image now includes curl for this real transport test. Device/API/UI integration
  and end-to-end online/offline acquisition on full images remain open.
- cx3576 kernel builds successfully with project quotas, a non-disarmable
  watchdog, immutable signed-verity command-line policy, and module archives
  without build-tree links (`.tmp/cx-kernel-file-ab.rc`, exit 0). Signed FIT firmware/backend,
  three-partition assembly and physical-board acceptance are not complete.
- The full virt-arm64 update sequence passes at `_out/file-runtime.5s72At/boot`:
  root generation 3, kernel generation 4, exactly three failed health trials at
  generation 5, fallback to generation 4, and combined generation 6. Firmware
  bytes are unchanged (`.tmp/arm-update-sequence.rc`, exit 0).
- The early loader now preserves the pinned systemd shutdown ELF closure in
  a separate bounded tmpfs. systemd pivots into it at shutdown to release the
  file-backed root before its backing SYSTEM filesystem. The previous x64
  shutdown log fails the new regression gate. A fresh full virt-arm64 image
  at `_out/file-runtime.Mx7qar/boot` passes runtime and complete filesystem,
  loop and DM teardown (`.tmp/exitrd-arm-runtime.rc`, exit 0). The fresh full
  x64 image at `_out/file-runtime.SwX1Oi/boot` also passes the runtime and
  complete-shutdown gates (`.tmp/exitrd-x64-runtime.rc`, exit 0).
- Native status now authenticates descriptors before reporting version and
  kernel/root identities. Workspace probe and bounded discard share the same
  physical DATA validation and transaction lock; discard preflights every path
  before removing files and preserves deployment metadata. Focused native tests
  and clippy pass. Full-image offline/HTTP acquisition acceptance is in progress.
- Full x64 acquisition acceptance now passes on that fresh image: production
  archive generation, offline import of root generation 3, installation and
  boot confirmation, HTTP publication through the standalone update server,
  signed catalog check and component fetch for kernel generation 4, installation
  and confirmation. Every boot completes exitrd teardown. Evidence is
  `.tmp/x64-acquisition.rc` (exit 0) and `updates/{3,4}/` in that image directory.
- Crash-state tests exposed activation and confirmation entries becoming durable
  before their DATA state write. Effective state now reconciles those native
  records without refilling attempts, so a repeated confirmation cannot prune
  an activated candidate. Eight deployment tests, five acquisition tests, the
  contract/boot/catalog suites and clippy pass. These latest recovery changes
  still require a refreshed full-image gate before final acceptance.
- Device integration has started with a strict native status model for running,
  current, fallback, candidate and failed deployment IDs. Its focused tests pass;
  the existing service/API/UI callers are still being replaced. The shared
  subprocess transport now bounds stdout/stderr and kills the whole transport
  process group on timeout or task cancellation. Both oversized-output and
  cancellation regressions fail before the fix and pass afterward. No legacy
  protocol is accepted by the new native status parser.
- The refreshed full x64 image at `_out/file-runtime.oil3MH/boot` passes all
  12 binary smokes, runtime and shutdown acceptance. Offline root generation 3
  and online kernel generation 4 additionally inject failure of the DATA state
  rename after durable activation. Native status still names the candidate,
  reconfirming the running deployment retains it, and the next boot confirms
  it. Both paths pass (`.tmp/x64-acquisition-recovery.rc`, exit 0). This is
  deterministic filesystem fault injection, not physical power-loss evidence.
- P8 suppression will use the backend's failed deployment IDs and monotonic
  generation floor. Those already prevent automatic reinstallation of a failed
  deployment across rollback and source changes. Remove the old slot/version
  observation store and its clear-suppression action; clearing a UI record must
  not bypass the backend's generation rule. A newly signed higher generation
  remains the release-side route for a corrected deployment.

- Native rollback now requires authenticated, confirmed running content, no
  pending candidate and a usable retained fallback under the command's existing
  transaction lock. Nine deployment tests, acquisition/catalog/boot tests and
  native clippy pass (`.tmp/p8-rollback-green.rc`, exit 0).
- The device service now uses mos-deploy for status, installation, confirmation,
  rejection and rollback. Native current/candidate/fallback identities drive
  system information and boot phases. The obsolete RAUC client, confirmed-slot
  observation store and clearable version suppression store are removed.
  The first complete service unit run passed 516 tests; protocol-specific
  fixtures and the reduced code vocabulary are being updated. Do not treat
  this as final service acceptance yet; D-Bus integration and fresh-image
  API acceptance remain outstanding.
- New apid confirm/reject routes and explicit deployment-ID installation have
  a reproducing route test (404 before implementation, pass afterward). They
  retain the existing credential, CSRF, audit and bus-error handling. The old
  mark and clear-suppression routes are removed. Rollback calls the native
  atomic rollback action after displaying the backend's verdict. API contract,
  full route suite, UI and final image verification are in progress.

- P8 service integration now uses native deployment IDs throughout D-Bus, API
  and UI. Confirm/reject/rollback replace slot marking; installation accepts
  only a verified deployment ID. Removed metadata-path options are rejected,
  and no version suppression reader remains. The full mosd/settings/apid run
  passes 986 unit tests and 10 integration tests plus strict Clippy; UI passes
  150 tests, lint and typecheck (97.11% statement coverage before removing the
  obsolete workspace-reservation display). Diagnostics retain native boot,
  component, generation and rollback evidence without admitting source URLs.
  Evidence: `.tmp/p8-native-final3.log`, `.tmp/p8-ui-storage.log`.
- Boot identity is now seeded durably on authenticated physical DATA before
  systemd starts, then bound read-only at `/etc/machine-id`. The firmware-env
  identity writer and its inert-success tests are removed. Native tests reject
  invalid/symlinked identity instead of regenerating it. DATA metadata failures
  carry a recovery classification even after the boot entry was durably
  confirmed. The latest complete x64 rebuild and boot/fault gates are running;
  these changes do not yet have a full-image acceptance result.

- Fresh x64 image `_out/file-runtime.fbnbie/boot` passes the current native
  service/API image boot, early persistent machine identity, all runtime checks,
  12 shipped-binary smoke checks and complete exitrd shutdown. Root/kernel/
  fallback updates and the expanded SYSTEM/DATA fault matrix are running on
  isolated image copies. Reset depth preflight and identity retention pass 12
  focused tests and strict Clippy; that later change needs a rebuilt image.
- cx3576 now declares FIRMWARE/SYSTEM/DATA. The common geometry uses sectors,
  preserving loader sector 64 and the two 64 KiB environments at 16/17 MiB in
  one reserved partition ending at 18 MiB. The geometry and component suite
  passes 45 tests and typecheck. FIT boot/backend, factory assembly and physical
  board acceptance remain open; this is not a cx3576 boot pass.
- The latest x64 update sequence passes root generation 3, kernel generation 4,
  exactly three failed health trials at generation 5 with fallback, and combined
  generation 6. Firmware bytes and persistent machine identity are unchanged.
  The five-case shared-storage/entry fault matrix also passes, including DATA
  corruption powering off before systemd. Evidence: `.tmp/p8-current-updates.rc`
  and `.tmp/p8-current-faults.rc`, both exit 0.
- Removed the settings schema compatibility reader, key stripping, migration
  report and fallback rewriting. Different schemas and unknown fields are
  rejected without changing their files. The full settings/mosd/apid suites and
  Clippy pass (`.tmp/p10-no-schema-compat-final.rc`, exit 0). Reset now preflights
  depth, count and time bounds and preserves machine identity; application
  extension writers start after reset preparation.
- Fresh ARM64 image `_out/file-runtime.ESQomW/boot` includes those settings/reset
  changes and sector-based assembly. It passes signed boot, DATA identity,
  runtime checks, a live native D-Bus update-state assertion and exitrd shutdown
  (`.tmp/p8-final-arm.rc`, exit 0). Build smokes have 11 passes and one explicitly
  executor-limited crun re-exec; that exception is not a crun version pass.
  ARM64 update and expanded fault gates are running.
- Native FIT storage now uses only bounded, canonical deployment records in
  redundant 64 KiB environments. CRC and flag wrap match an independent zlib
  fixture. Installing a FIT writes and verifies SYSTEM objects before activating
  its environment record; confirmation, rejection and rollback touch only the
  counter ranges. Four FIT deployment tests, four environment tests and the
  existing deployment/acquisition/boot/catalog/contract gates pass with Clippy
  (`.tmp/cx-fit-runtime-final.rc`, exit 0).
- Early init and mos-deploy select the backend from the authenticated board
  identity. FIT uses one strict chosen deployment digest and checks the physical
  FIRMWARE geometry before writes. Device status distinguishes `uboot-fit`
  verification from UEFI Secure Boot; full service/settings/API tests and Clippy
  pass (`.tmp/cx-fit-service.rc`, exit 0). This is implementation evidence, not
  a physical FIT boot result.
- The latest ARM64 fault and update runs reached a correctly confirmed fallback
  but failed a new harness assertion that allowed only `succeeded`, excluding
  the correct `rolled-back` lifecycle. The harness is corrected. Both full
  sequences must be rerun; their exit-1 results are not acceptance passes.
- Fresh x64 image `_out/file-runtime.qm20G0/boot` includes the explicit backend
  receipt fields and corrected lifecycle assertion. It passes all 12 binary
  smokes, full runtime/D-Bus checks and exitrd shutdown. The five-case fault
  matrix passes (`.tmp/cx-policy-x64-faults.rc`, exit 0). Its update sequence
  initially stopped during component signing with empty subprocess error text;
  the Docker signing deadline and error reporting are corrected, and the failed
  staging directory is retained as `updates-signing-timeout`. The rerun is in
  progress; no successful update result is claimed for the failed run.
- cx3576 production U-Boot now compiles a fixed policy before preboot and CLI,
  reads only canonical redundant counter data, flushes an enabled eMMC cache
  and reads back trial writes before FIT loading. Persistent environment command
  import is disabled. Its control FDT requires the explicit public FIT key;
  no private key enters that build. Cross-build, strict configuration checks
  and bounded C parser tests pass. This does not prove physical write durability
  or watchdog coverage.
- The actual signed FIT kernel package with authenticated radio firmware and
  regulatory database is `_out/file-fit.a259kw/kernel`. The FIT signing tests
  extract the control FDT from the shipped U-Boot FIT, compare it with the
  exported control FDT, and verify that U-Boot FIT occurs in the loader image.
  Required signature acceptance and rejection of modified kernel/DTB/initramfs,
  a missing signature and an unknown key all pass
  (`.tmp/cx-fit-signatures.rc`, exit 0). No physical cx3576 boot is claimed.
- The cx3576 board package now carries only hardware and storage policy. Board
  package/radio rebuilds leave kernel, modules and loader digests unchanged
  (`.tmp/cx-file-board.rc`, exit 0). Radio state binds use DATA. The full cx3576
  root build and refreshed ARM64 image gate are running.

- Confirmed-deployment corruption exposed a retry loop: uncounted boot entries
  were left selected after an early metadata refusal. Early PID 1 now retires
  an uncounted failed entry only when another usable record exists; native
  trial counters are never refilled. Shared SYSTEM/DATA failures still enter
  recovery. The health failure handler uses the same native retirement action
  and powers off if retirement cannot be persisted. Both UEFI and FIT store
  regressions and the shell failure-handler checks passed after recorded RED.
- Fresh x64 `_out/file-runtime.begjdr/boot` passes boot and shutdown, all 12
  shipped binary smokes, root-only/kernel-only/combined updates, exactly three
  unhealthy candidate attempts, and fallback. A separate confirmed-health
  failure retires after one failed boot and reaches the retained deployment.
  Firmware bytes and persistent machine identity remain unchanged throughout.
  `_out/confirmed-fault.m2Hgk9` separately proves confirmed metadata corruption
  retirement and fallback on the same fresh image.
- Fresh ARM64 `_out/file-runtime.dQgw8E/boot` passes boot/shutdown with the same
  retirement implementation. `_out/confirmed-fault.AwNMuV` passes confirmed
  metadata-corruption fallback; `_out/file-faults.wzbQ8H` passes the five native
  persistence, exhaustion and shared-storage faults. Its update sequence is
  running. An earlier ARM update run reached every successful boot but its
  final shell checks were interrupted by editing the running harness; that run
  is not recorded as a clean harness pass. The new run starts from a fresh image.
- cx3576 packages now own only board facts and radio integration. Kernel/support
  owns the exact board firmware files and the pinned signed regulatory database;
  the old rootfs regulatory-database lock entry is removed. Root composition
  passes 11 binary smokes; crun remains explicitly executor-limited. Board-only
  rebuilding preserves the compiled kernel, module archive and loader digests.
- `_out/file-fit.a259kw/image/disk.img` is the first cx3576 file factory image.
  Independent inspection passes GPT CRC/geometry, the unchanged loader bytes,
  both strict CRC-protected environment copies and empty protected slack, and
  the SYSTEM/DATA ext4 features including DATA project quotas. Production FIT
  signature checks use the control DTB extracted from the shipped U-Boot image
  and refuse modified kernel/DTB/initramfs, missing signatures and unknown keys.
  These are build/software checks, not physical-board boot evidence.
- `_out/cx-dirty-system.beCrvU` captures SYSTEM at partial-write, file-fsync and
  directory-publication boundaries using suspended block IO without flushing
  ext4. Every snapshot requires journal recovery. Pinned U-Boot 2026.07 sandbox
  reads the exact retained FIT bytes in all three; the newly published directory
  is absent before journal replay, requiring bounded fallback. This proves
  these filesystem snapshots only; it does not establish eMMC power-loss safety.
- P9 now has strict, cross-language `mos/firmware/v1` manifests binding board,
  architecture, generation, artifact bytes and fixed EFI/raw-loader destinations.
  Factory assembly authenticates the separate firmware package. The native
  `firmware-readback` action verifies installed bytes under the DATA transaction
  lock without modifying loader or counters; its UEFI/FIT tests pass. Newly
  assembled images retain the signed firmware receipt under DATA/meta.
- Independent firmware publication has a separate table/API and console page;
  its artifacts never enter the ordinary deployment catalog. Shared streaming
  object validation retains immutable digest/length checks. Fresh schema,
  OpenAPI, lint/typecheck, 41 service tests with coverage, and standalone build
  pass. Browser acceptance, physical readback, UEFI loader maintenance/fallback,
  key overlap/removal, and P10 cleanup remain outstanding.
- Firmware console acceptance passes in Chromium: failed upload retains its
  draft, retry succeeds, a later generation reuses the object, publication and
  exact signed-manifest download succeed, invalid write ranges are refused,
  withdrawal removes distribution, and the ordinary deployment catalog stays
  empty. Evidence: `.tmp/p9-browser/{check2.log,firmware.png}`. Native UEFI/FIT
  firmware readback tests and clippy pass; actual device readback remains a
  fresh-image gate after final packaging.
- Fresh ARM64 update acceptance now exits 0 on `_out/file-runtime.dQgw8E`:
  root-only, kernel-only, combined, three unhealthy trials, confirmed-health
  retirement, fallback and persistent machine identity all pass.
- Metadata service rotation requires explicit `METADATA_TRUST_KEYS` overlap,
  authenticates the persisted catalog and every published manifest on restart,
  and refuses key removal while a published object still depends on it. All
  42 service tests, coverage, OpenAPI, typecheck, lint and standalone build pass.
- `_out/trust-rotation.yO4on0/boot` proves content and metadata rotation on a
  complete x64 system. The overlap kernel boots old and new content; subsequent
  kernels use new metadata keys and new support signatures. The new-only content
  kernel refuses an old signature three times and reaches the retained current
  deployment (`.tmp/content-rotation-boot.rc`, exit 0).
- The same fixture proves independent offline EFI replacement and restoration
  from an authenticated saved package. After enrolling only the new boot key,
  the new loader and retained deployment boot; the removed-key loader is refused
  by UEFI with `Access Denied`. Evidence: `.tmp/uefi-firmware-rotation2.rc`, exit 0.
  These are disposable VM enrollment changes, not board fuses or platform firmware.
- Firmware maintenance validates both the incoming manifest and installed bytes
  before writing, saves the signed recovery package, and reads back the result.
  RockUSB writes only the bounded loader range and compares the entire reserved
  partition, preserving environment bytes. The host tool never resets a board.
  Stub tests cover restoration, unknown trust, corrupt installed data and damage
  outside the loader write. Actual cx3576 USB maintenance remains untested.
- P10 removes the TUF client/signing workspaces and raw-slot build drivers.
  The native workspace is now `pkgs/mos-deploy`, with only `mos-init` and
  `mos-deploy`; tests and clippy pass. The dependency graph loses 36 crates with
  no version change to retained dependencies. RAUC and root-owned kernel package
  producers are removed; the current package resolver passes 46 checks across
  258 resolutions with all 22 packages reachable and no exemption.
- The build driver now exposes component, root-composition and comparison modes
  only. Filesystem/GPT checks use the current three-partition definitions.
  All 346 remaining build tests and typecheck pass. The generic content-signing
  helper lives in `pkgs/mos-boot`; explicit development key generation creates
  independent boot, content and metadata inputs without overwriting a directory.
- cx3576 full-image flashing validates primary/backup GPT and current geometry
  before any device command, reads back every written byte, and resets only
  after both comparisons pass. Stub corruption in firmware, SYSTEM and DATA
  prevents reset; a short image is refused before the first USB operation.
- The user has not supplied a cx3576 interface/address. An optional scope question
  about s905x5m remains unanswered; current work preserves its BSP while removing
  its old system-image build entry points. It is outside this plan's three targets.
  Native firmware receipt recording, final fresh packages/images, FIT key overlap,
  the new image verifier, fault coverage, active docs and complete CI remain open.
- The baked user-space manifest no longer accepts metadata trust keys; only the
  authenticated kernel policy owns them. A RED parser test demonstrated the old
  requirement, followed by passing settings/APID tests and workspace clippy.
  `MOS_META_DIR` selects fresh public factory defaults without converting an
  existing configuration. No legacy configuration reader was added.
- The update-server CI container now includes its shared component contracts.
  Its complete clean install/check/build/audit passes: 42 tests, 369 audited
  packages and no reported vulnerability (`.tmp/server-ci-check.rc`, exit 0).
- FIT control-FDT generation supports one to eight explicit RSA public keys,
  requires a configuration signature from that set, and rejects duplicate keys.
  Actual FIT signature tests prove overlap acceptance, old-key removal and
  unsigned rejection (`.tmp/fit-trust-green.rc`, exit 0). Full loader builds
  embedding the overlap/new-only control FDTs are running. The final cx3576
  loader will use the separate development boot key, independently of content.
- Production FIT loader rotation builds now pass with the trust keys extracted
  from the actual shipped U-Boot images. Both overlap and new-only variants
  enforce the expected signer set; the default cx3576 loader now uses a separate
  boot certificate (`.tmp/fit-trust-production.rc`, exit 0).
- Fresh x64 `_out/file-runtime.Y45jxJ/boot` passes all 12 binary smokes, full
  runtime/D-Bus checks, installed firmware readback and receipt recording, and
  exitrd shutdown (`.tmp/final-x64.rc`, exit 0). ARM64 rebuilding is running.
- The current image verifier authenticates the two factory deployments, every
  referenced boot/root/support object, the complete verity trees, native trial
  records, and the independent installed firmware receipt. Old raw-slot image
  and s905x5m runtime-image verification entry points are retired. Independent
  network, D-Bus, container, MQTT, account, time and filesystem readers remain.
  Its focused suite passes 643 tests before the subsequent identity regression.
- Offline verification found a factory DATA quota-accounting defect: mke2fs
  initializes quotas before importing the seed tree. The assembler now accounts
  for the seeded files and requires a clean e2fsck before publication. Fresh
  `_out/factory-quota.NW4kTH/image/disk.img` passes all 101 applicable offline
  checks, with two explicit non-Wi-Fi skips (`.tmp/verify-current-x64-quota2.rc`,
  exit 0). Fresh boot acceptance must include this assembler correction.
- Producer preflight negative tests now use an isolated repository, including
  missing contexts/version keys, all hook count failures, warning-only inputs
  and the real Podman no-build/staleness checks. All 19 pass without modifying
  a real board source file or package pool (`.tmp/current-preflight-test.rc`, 0).

- Deterministic native transaction faults now cover both UEFI and FIT: 127 IO
  boundaries and 381 SIGKILL/ENOSPC cases across install, confirm and GC pass.
  Retained descriptors and all boot-visible referenced objects stay complete.
  The matrix is wired into CI (`.tmp/io-fault-matrix3.rc`, exit 0); native tests,
  format and clippy pass as well. This is not a physical storage power-cut proof.
- Current build, verifier and ten applicable shell/layout gates all pass
  (`.tmp/current-automated-gates.rc`, exit 0). Fresh ARM64 full runtime,
  firmware receipt readback/recording and normal shutdown pass on
  `_out/file-runtime.vy1Kne/boot` (`.tmp/final-arm.rc`, exit 0).
- Fresh x64 `_out/file-runtime.iux6nP/boot` includes corrected factory quota
  accounting and passes runtime, firmware receipt and shutdown gates
  (`.tmp/final-x64-boot3.rc`, exit 0). Test DATA seeding now preserves clean
  quotas and checks exact file/link readback; an initial invalid wants fixture
  was corrected before this successful boot.
- Current cx3576 `_out/final-cx.pGUpxc` builds an independent production root,
  signed FIT, signed firmware package and complete three-partition image.
  The shipped U-Boot control FDT accepts the matching boot signer and refuses
  missing, unknown and modified FIT signatures. Offline verification found two
  stale Wi-Fi seed-script assertions; current parser/negative tests pass (46),
  and full image verification is rerunning. No physical-board pass is claimed.
- QEMU API acceptance now requires an explicit complete image and public boot
  certificate, enrolls disposable UEFI keys, and enables DATA test services.
  GRUB command-line editing and the old STATE seeder are removed. The 48
  harness self-checks and typecheck pass; the real API run remains in progress.

- Current cx3576 complete image passes 123 offline checks with no skips
  (`.tmp/current-cx-verify2.rc`, exit 0). The packaged growth helper and actual
  repart definitions pass on a disposable loop disk: DATA grows, all firmware,
  counter and SYSTEM bytes remain identical, and wrong disk/SYSTEM identities
  are refused before GPT changes (`.tmp/current-cx-growth.rc`, exit 0).
- The updated install-closure gate passes 99 checks across 14 clean roots and
  both architectures, including reduced MQTT and independent radio packages.
  One crun invocation remains explicitly limited by qemu-user fexecve
  (`.tmp/current-install-closure.rc`, exit 0).
- Full x64 API acceptance exposed DATA/state/mos mode 0700 preventing
  systemd-network from traversing the bind to its group-readable WireGuard key
  store. The current seed grants root traversal with 0711 while credential
  subdirectories/documents retain 0700/0600. A complete rebuilt factory image
  `_out/current-api-x64.OOi2AN/image/disk.img` passes 142 API checks and 153
  combined harness checks, including real WireGuard key reads, credential
  isolation, native confirm/rollback and repeat refusal, and reset protections
  (`.tmp/current-api-x64-fixed.rc`, exit 0). ARM64 API acceptance is running.
- The early loader now logs measured elapsed milliseconds and process peak RSS
  before switch-root. Pinned clippy and both native init builds pass. Large-root
  measurements compare current complete images with and without 384 MiB of
  incompressible unused root data; results are still pending.
- Offline EFI maintenance now refuses recovery directories inside the ESP,
  including an alias through a symlinked parent. The regression is RED before
  the guard and all five maintenance tests are GREEN afterward.

- The current ARM64 complete image passes all 140 API checks and 151 combined
  boot/API checks (`.tmp/current-api-arm.rc`, exit 0), including the corrected
  WireGuard key traversal permissions and native rollback contract.
- Six fresh x64 boots compare 74,604,544-byte and 480,428,032-byte roots. Median
  early-init elapsed time is 1,948 ms and 1,464 ms; maximum process RSS is 2,796
  KiB and 2,716 KiB. All six reach full runtime and clean shutdown. Evidence:
  `_out/large-root.H5QHVu/measurements.json`. RSS excludes kernel/initramfs backing
  memory; timing differences are not claimed as a performance improvement.
- The latest cx3576 FIT/firmware/root factory image is `_out/final-cx.IBcIEb`.
  Required FIT signature negatives and all 123 offline image checks pass
  (`.tmp/latest-cx.rc`, exit 0; `_out/verify/cx3576-z97LiN`). Physical acceptance
  remains pending a local bench interface.
- The complete production firmware C policy now runs under ASan/UBSan against
  deterministic block callbacks. Short writes, failed cache flush, short or
  changed readback stop before FIT loading; the retained record remains intact.
  Successful persistence decrements before load. Two corrupt copies stop in
  recovery. Evidence: `.tmp/fit-firmware-io2.rc`, exit 0. This gate joins
  `make os-fit-records-test` and CI.
- The bench collector now reads authenticated deployment IDs/native status and
  records actual transaction/power traces. It never edits boot variables or
  refills attempts. Removed obsolete raw-slot boot/second-root and RAUC trust
  harnesses; current replacement coverage is the native update sequence,
  kernel verity matrix, FIT signature negatives and three-domain hygiene gate.
- Three-domain development key generation passes matching-public-key,
  separation, permissions and no-overwrite checks; `make os-trust-domain-test`
  is wired into CI. Active documentation and remaining fault cases are still
  being reconciled before P10 acceptance.
- The latest x64 complete runtime/update sequence passes root-only, kernel-only,
  combined, failed-health trial exhaustion and confirmed-health retirement
  (`.tmp/latest-x64-updates.rc`, exit 0). Firmware remains unchanged. This run
  includes the WireGuard traversal fix and measured native init; the subsequent
  provisioning transport cleanup is being rebuilt separately.
- cx3576 DATA-only growth passes again against `_out/final-cx.IBcIEb` using the
  actual packed root helper (`.tmp/latest-cx-growth.rc`, exit 0). Firmware and
  SYSTEM byte comparisons and identity-refusal cases remain green.
- Retirement lint, lint negatives and shell pipefail gates pass after the bench
  and trust-hygiene changes (`.tmp/retirement-lints3.rc`, exit 0). Board dossier
  structure/qualification grammar passes 139/139. Active docs status is reduced
  to 18 remaining stale references; the complete documentation gate is not yet
  accepted.
- Removed boot-a/boot-b probing from offline provisioning: current UEFI uses
  its ESP, and cx3576 uses removable media. The three roots are being rebuilt.
  The development marker observer now refuses duplicate/unknown domain records
  instead of merging an older generated format; its regression is RED at
  `.tmp/current-marker-red.rc` (101), with focused GREEN checks running.
- Runtime acceptance now records SYSTEM/ESP used capacity and block-write sector
  counters around installation. A separate timing wrapper measures wall time
  through full runtime acceptance; additional large-root repetitions are running.
  These measurements are not yet an accepted transfer/peak-space report.
- Current ARM64 runtime and full update sequence pass (`.tmp/latest-arm-runtime.rc`,
  exit 0; `_out/file-runtime.lrNU60/boot`), including root/kernel/combined updates,
  exhausted failed-health trials and retained fallback.
- Additional isolated x64 timing runs pass full runtime and clean shutdown for
  both root sizes. Median host wall time to runtime acceptance is 58,440 ms
  (small) and 57,379 ms (large), three fresh images each. Evidence:
  `_out/large-root-wall.Z46v4x/measurements.json`. This includes firmware and the
  runtime acceptance workload, rather than being a bare kernel startup timer.
- Native system-info/transient tests pass 19 + 20 cases after marker cleanup;
  strict Clippy passes (`.tmp/current-marker-green.rc`, exit 0). Both mosd packages
  and the three complete roots are queued for rebuild before final acceptance.
- s905x5m's independent BSP remains available, with no current MOS image claim.
  Removed its top-level raw-slot boot sources and complete MOS eMMC/installer
  Make entry points. Its board-specific package/legacy installer internals still
  need a scoped retirement review; do not describe P10 removal as complete yet.
- Retired the remaining s905x5m MOS package producers and complete eMMC/installer
  packaging stages. Independent BSP, peripheral/example sources and bootloader-only
  packaging remain. Current manifest coverage passes 41/41, 17 reachable producers,
  192 resolutions and six distinct refusals. Removed five unused Debian pins and
  only retired consumer associations from 13 shared pins; current package preflight,
  Debian tests and host/shell lint gates pass.
- Restored release-directory delivery for current independent artifacts through
  `build/run.sh --release`: MOSUPD01, signed firmware, measured image checksums,
  package SBOM/source-offer inventory, provenance, notes and board evidence.
  The new schema has no earlier-format reader. Thirteen tests pass, including
  executed documentation commands and repinned signed-object corruption. Empty
  development markers were RED before the guard and GREEN afterward; an additional
  dangling-marker refusal is included in the pending complete build suite.
  This unsigned directory manifest is an integrity record; complete image and
  physical acceptance remain separate obligations.
- Latest mosd/apid packages and x64/ARM64 roots include strict development-marker
  observation and current ESP provisioning transport. Fresh runtime fixtures are
  `_out/file-runtime.2mJ4jE/boot` and `_out/file-runtime.mzxQLp/boot`; first boot and
  root update pass, with the full sequences and measured installation IO running.
  The cx3576 root export completed, but its wrapper exited 1 after an edited shell
  reader encountered EOF; the stable current command is rebuilding it after pin
  retirement. That interrupted wrapper is not counted as a passed build.
- Documentation index, links and truth-status gates pass 195/195, 474/474 and
  722/722. Chinese current-version user documentation still has ten stale status
  and architecture mappings; the complete docs gate remains red until reconciled.
  Active build/root composition documentation is being replaced with current
  producer and acceptance contracts, without retaining old command aliases.
- The latest x64 complete runtime/update matrix passes again, including three
  failed-health trials and retained fallback (`.tmp/current-final-runtime-x64.rc`,
  exit 0). Measured SYSTEM writes are 74,936,320 bytes (root), 421,888 bytes (kernel)
  and 75,452,416 bytes (combined); ESP writes are 5,120, 49,836,032 and 49,836,032
  bytes. Maximum observed before/after occupancy is 149,549,056 SYSTEM bytes and
  149,417,984 ESP bytes. Evidence: `_out/file-runtime.2mJ4jE/boot/storage-measurements.json`.
  These are guest block counters, not physical flash amplification; HTTP body-byte
  measurements are running separately against the production update service.
- Latest cx3576 image `_out/final-cx.QXCLPH` passes required FIT signature negatives,
  all 123 offline checks (`_out/verify/cx3576-ASqiYC`) and actual DATA-only growth
  with firmware/SYSTEM unchanged (`.tmp/current-cx-final-image.rc` and
  `.tmp/current-cx-final-growth.rc`, both exit 0).
- A real current cx3576 release directory is assembled at
  `_out/final-cx.QXCLPH/release`: all 14 artifacts pass signed update/firmware,
  integrity, SBOM/provenance/source-offer, notes and evidence checks, followed by
  `sha256sum -c` and an independent gate rerun (`.tmp/current-real-release.rc`, 0).
  No physical board acceptance or public publication is claimed.
- Full local build/verify suites pass 362 and 644 tests. The release's pinned-Bun
  execution initially failed because that image has no git; source measurement
  now uses the existing tool-container abstraction. All 14 release tests pass in
  pinned Bun (`.tmp/current-release-container-green.rc`, 0). The complete component
  suite is added to CI after builder/network preparation, with its container run
  pending. Chinese user guides now match current architecture and normative status
  lines (249/249 coverage); design-document retirement continues.

- Current full runtime matrices passed for x64 (`_out/file-runtime.2mJ4jE/boot`)
  and virt-arm64 (`_out/file-runtime.mzxQLp/boot`), including root/kernel/combined
  updates, three failed health attempts, fallback and full exitrd teardown.
  Latest pure x64 factory API acceptance passed 153 combined checks at
  `_out/final-api-x64.H3o6VG`; these runs precede the TLS durability fix below.
- Production HTTP acquisition measurements passed root-only, kernel-only and
  combined update/boot sequences at `_out/file-http-measure.uij9t80g/boot`:
  74,613,193 / 49,799,145 / 124,342,249 downloaded object bytes respectively.
  Measurements count completed response bodies and exclude HTTP headers and
  transport overhead. The publication helper now uploads only missing required
  immutable objects and can resume an exact draft. It does not overwrite them.
- Pinned build acceptance initially failed 19 cases because Python and libcap
  tools were absent. `build/Dockerfile` now owns these requirements separately
  from the verifier image and records resolved Debian package versions. The
  complete pinned suite passes 362 tests across 22 files
  (`.tmp/current-full-container-build2.rc`, exit 0).
- Three actual DATA seeding refusals pass against an offline factory image:
  symlink parent, non-directory parent and symlink target. Every refusal leaves
  the entire image SHA-256 unchanged. Evidence: `_out/seed-refusals.1ahZ57` and
  `.tmp/current-seed-refusals.rc` (exit 0).
- Kernel panic injection proved three persisted attempts and fallback selection
  on both architectures, but the fallback service checks failed. The ARM64
  diagnostic run reports `private key format not supported`: first-boot TLS
  key contents had not been durably written before the panic. The result is
  retained at `_out/kernel-diagnostics.FKGuq6/boot.log`; neither failed matrix
  is counted as an acceptance pass.
- apid now publishes certificate and private key together as one mode-0600
  `identity.pem`, with file/directory sync and atomic rename. Session key writes
  use the same durable binary helper. No split-file reader or migration is
  retained. Regression tests failed before the change, then passed including
  loading the published identity into the actual Rustls server. The full mosd
  workspace gate passes (`.tmp/current-durable-rust-gate.rc`, exit 0).
- Removed unused raw-slot repart definitions, whole-var seed script/unit and
  the unused libubootenv runtime package/pins. Current source no longer offers
  these install/boot paths. Package rebuild and fresh complete-image acceptance
  are running for x64, virt-arm64 and cx3576 after the TLS fix and retirement.
- New early-init hang fixtures stop after the unchanged production watchdog-arm
  operation and before SYSTEM/systemd. Both fault binaries compile from an
  isolated source copy. Their QMP watchdog-reset/three-attempt/fallback matrix
  is queued against the freshly rebuilt images; no result is claimed yet.
- The cx3576 collector now uses native state and explicit component installation.
  Watchdog injection stops PID 1's existing feed by crashing the kernel with
  panic restart disabled, rather than trying to reopen its exclusive watchdog.
  Physical bench access remains unavailable; no hardware interface was touched.

- Fresh TLS-durable x64 factory `_out/file-runtime.0LmCjR/boot` passes complete
  runtime boot and its first root-only update/reboot. Full update, panic,
  watchdog and pre-SYSTEM hang matrices are running; results remain separate.
  The reset fixture `_out/reset-runtime.9OTWRY` proves configuration deletion
  interrupted by an actual SIGKILL, successful same-boot mosd restart/retry and
  a subsequent idempotent boot. Remaining reset tiers are still running.
- The reset observer initially expected JSON null for an absent settings path.
  Production correctly removes that optional field after applying reset; the
  observer now requires the exact missing-path response. Its initial failure
  and the successful production retry remain in `_out/reset-runtime.0gXoDT`.
  Two other interrupted harness runs were shell-read races during file edits;
  neither is counted as a pass. Stable scripts were rerun from fresh images.
- Latest cx3576 fixture `_out/final-cx.qPXFax` passes 123 offline checks
  (`_out/verify/cx3576-q81jqf`), required FIT signature negatives, DATA-only
  growth and the 14-artifact release gate. Fresh x64 API acceptance passes
  153 combined checks at `_out/durable-api-x64.TQV8iN`. An API-description-only
  cleanup is being repackaged; final artifacts and API checks follow it.
- Staged-file documentation, host-toolchain lint/negative tests and 644 verifier
  tests pass (`.tmp/current-staged-gates3.rc`, 0). Post-retirement package
  installation closure passes 99 checks over 14 fresh roots and both arches;
  trust-domain hygiene also passes (`.tmp/durable-closure-trust.rc`, 0).
- Removed unused carried-host-binary, foreign-GRUB-package and RAUC provenance
  branches from the build toolbox. Native API docs and test state fixtures now
  describe deployment IDs; the explicit old-path rejection test is retained.
  Regenerated OpenAPI, 18 update API tests and strict workspace Clippy pass.
  A full build run exposed three real-container signing tests using Bun's
  five-second default; those tests now use the existing tool-test time limit
  without dropping assertions. The complete rerun is pending.
- Local review covered native activation/confirmation/GC ordering, bounded
  acquisition and archive verification, early authenticated boot, FIT attempt
  readback, server immutable-object publication and atomic TLS identity writes.
  No additional high-confidence defect remains in those reviewed paths. This
  is risk-prioritized review; it does not claim a line-by-line review of every
  retired source file or historical engineering translation.
- Current cx3576 collector usage, unmet-prerequisite refusal and empty-report
  honesty pass at `.tmp/bench-collector-rdkt0ksz`. No serial/USB bench interface
  or board address is available in the workspace; physical acceptance remains
  pending. Collector dry-run output is not hardware evidence.

## Post-delivery power action regression (2026-09-09)

The [reboot investigation](20260909-1421-apid-reboot.md) fixes hidden power
refusals and the dashboard confirmation overlay. Its fresh x64 factory image
`_out/reboot-fixed.p8eARn/image/disk.img` and browser evidence
`_out/reboot-fixed-api.FIa1wh` pass refusal, actual reboot, reauthentication and
power-off, including two complete exitrd shutdowns. The Rust gate passes 1,053
tests and the UI gate passes 154. Those test images used package pools stamped
`git1875d1332170.dirty-1`; the later clean rebuild removed their `_out/` artifacts.
Their recorded provenance remains historical. Original-device diagnosis and
physical cx3576 qualification remain separate pending access details.

## Clean cx3576 rebuild (2026-09-09)

At the user's request, deleted `/srv/mos/_out` completely (approximately
227 GiB), then rebuilt the cx3576 kernel, firmware, native init, ARM64 container
runtime, package pool and rootfs. The source was clean commit
`38f2a37b9a3c`, including the power action feedback repair. This run rebuilt the
ARM64 pool only; the deleted x64 images were not regenerated.

- Complete factory image: `_out/cx3576/image/mos-cx3576-20260909-164233.img`, 2,435,842,048 bytes.
- SHA-256: `324e0ca02ecfede11a8e0f35302d2588265769b7e50bed932700db74405ea252`.
- Checksums and public metadata anchor: `_out/cx3576/image/SHA256SUMS` and
  `_out/cx3576/image/metadata.public.key`.
- Offline image verification passes 123 checks with no skips. Required FIT
  signature negatives, flash geometry and DATA-only growth pass; growth
  preserves every firmware/counter/SYSTEM byte and refuses wrong identities.
- Root smoke passes 11 checks; crun remains explicitly executor-limited by
  qemu-user's memory-file-descriptor re-execution support.
- `_out/cx3576/release` passes the 14-artifact release gate and all checksums,
  including the complete image, offline update archive and signed firmware.
- Controller logs are in `.tmp/clean-cx3576-20260909`; `delete.rc`,
  `boot-components.rc`, `debian-cache.rc`, `build.rc` and `assemble.rc` are zero.

The initial Debian snapshot download stalled in Bun; the existing official
Debian mirror option populated the cache with every pinned digest verified.
The optional container orchestration route lacked the local Buildx profile;
the supported host Bun orchestration route completed rootfs composition using
the pinned build containers. Initial failure records remain beside the passing
retry logs. Physical cx3576 startup, reboot and USB readback remain untested.

## Timestamped factory image handover (2026-09-09)

The current cx3576 image and release copy use
`mos-cx3576-20260909-164233.img`, reflecting the original completion time of
2026-09-09 16:42:33 UTC. Every image byte and the clean `38f2a37b9a3c` source
identity are preserved. Refreshed release provenance, manifest and checksums
bind the timestamped name; no generic-name alias is retained.

Subsequent component CLI builds publish `mos-BOARD-YYYYMMDD-HHmmss.img` with
UTC completion time and `SHA256SUMS`. Release assembly preserves that basename,
and cx3576 flashing defaults to the newest matching timestamp. The focused
regression first reproduced the lost release name; all 384 build tests now pass.
Real CLI assembly, unchanged delivered-image hashes, the 14-artifact release
gate and flash default/override/missing-image checks pass. Local review finds no
blocking issues. Controller evidence lives in `.tmp/image-naming`; the disposable
CLI image is removed after verification. Physical board acceptance is unchanged.

## Physical cx3576 boot blocker repair (2026-09-09)

The reported `required boot watchdog unavailable` stop is traced to the missing
RK3576 clock enable callback: DesignWare probe returns -ENOSYS before Linux.
The [focused investigation](20260909-2331-cx3576-boot-watchdog.md) adds the
watchdog gates, explicit probe/start diagnostics and cyclic service in RockUSB
recovery. Actual-source regressions reproduce both faults and pass after repair.

Current full image: `_out/cx3576/image/mos-cx3576-20260909-235323.img`;
SHA-256 `d8c29cd014ba574bee3c36c90adb6f44d691dd92e20da1480746a0770c17c04f`. Firmware and assembly
use clean `d70a9b26aa4f`; root/kernel retain clean `38f2a37b9a3c`. Separate source
records live in `_out/cx3576-watchdog-r2/build-record.json`. Required FIT signature
negatives, all 123 offline checks, flash geometry and checksums pass. The older
release directory does not contain this repair. Physical startup, recovery dwell,
watchdog handoff/reset and power-cut qualification remain pending; P10 is open.
