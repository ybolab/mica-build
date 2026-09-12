# 20260911-1925-boot-artifact-size Shrink the signed boot artifact: compression and early-userspace closure

- **status**: in_progress
- **priority**: P1
- **owner**: boot-size/vhqwow6o
- **createdAt**: 2026-09-11 19:25

## Description

Reduce the size of the signed kernel component. The uncompressed initramfs is
50.3% of the s905x5m FIT and 42.7% of the cx3576 FIT, and 86% of its startup
half is shared libraries rather than programs. Two independent levers apply:
compressing the FIT payloads, and collapsing the early-userspace ELF closure.

This is flash per deployment, bytes per update download, and bytes hashed at
boot — not boot-peak RAM. The startup half is released at `switch_root`, so RAM
is not the goal here; that is the separate exitrd record.

No compatibility or migration paths are required.

## ActiveForm

Finalize the reviewed operator overlap and two clean-copy startup consumer joins;
retain completed 438 native, deploy and x64 boot-tools producers and their witnesses.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full-tier proposal: it crosses FIT/UKI packaging, the authenticated init, the
  Rust dependency licence policy, and boot/shutdown acceptance.
- Distinct from 20260910-0338-minimal-boot-shutdown,
  which owns the **resident** exitrd. That record's scope excludes the startup
  half on the ground that it is not resident; this record takes the startup half
  on the different ground that it is permanent artifact cost. The two do not
  overlap and can proceed independently.
- Route settled 2026-09-11: replace `veritysetup`/`dmsetup` with Rust directly,
  remove cryptsetup from the early userspace, and add `CONFIG_ZSTD` to cx3576's
  U-Boot so the kernel node compresses too. The declined cryptsetup-backend
  option stays recorded under the plan's *Alternatives*.
- The plan's Phase 2 moves a signature-enforcement boundary into this
  repository. Its acceptance is differential against the tool it replaces, plus
  negative and mutation cases; see the plan's *Verification*.
- Keep the concurrent CX3576 board and console repairs unchanged.

## Findings

- [Proposal](../plan/20260911-1927-boot-artifact-size.md) records the measured
  closures, compression ratios, decompressor support per board and the licence
  decision the device-mapper crate requires.

## Verification

- Measurements were read off already-built artifacts under `_out/`; no build was
  run and no source was changed as part of this assessment.

## Implementation evidence

- Dispatch hashes matched: plan 8b72a5f8e740b1125199c3c0bda1470dfacfe3cedacaeebb9c795548d2cfc393;
  task 64db4e752f1986599b5a659858046ad13fa6f8ca3b77b12a48bd7f9b31472c3d.
- Initial a3595587194a17c290272975e5a2e40be6ea15c2 worktree was clean.
  Merged exact reviewed fb6c4597 as ef5e27c7; both fb6c4597 and 36866b47 are
  ancestors. Only tracking/design conflicts needed resolution; both indexes
  and the startup plan remain. No uncommitted main state was read or copied.
- Current startup helper set is B2 BusyBox + blkid + veritysetup + dmsetup.
  Retained exitrd is B3 static mos-shutdown; historical closure numbers above
  require replacement with newly measured artifacts, kept separate by purpose.

- Phase 1 implementation bounds both expanded cpio and compressed bytes at
  67108864; FIT component/kernel limits remain 134217728 and FDT stays raw.
  FIT/UKI use the compressed ramdisk and compare the extracted signed bytes.
- Compression RED: missing compression.sh; subsequent negative test exposed
  `unexpected compression acceptance: validate_payload .../truncated.zst ...`.
  Bash conditional calls suppress errexit; explicit failure returns fixed it.
  GREEN includes deterministic output, malformed/truncated frame, changed
  source, oversized input/output and compressed expanded-limit refusal.
- Private source evidence: `_out/boot-size/logs/source-{first,second,third,fourth,fifth}.log`.
  Original compilation failure: `error[E0502]: cannot borrow *b as immutable
  because it is also borrowed as mutable` in the GPT test checksum writer.
  Fixed the temporary checksum borrow. Clippy then caught
  `chunks_exact_to_as_chunks` and `cloned_ref_to_slice_refs`; both corrected.
  Workspace tests, added native tests, final clippy and cargo-deny pass.
  No kernel or guest result is inferred from those fixtures.
- B granted one serial source/UAPI/packing container, 2 CPU on cpuset 4-5,
  4 GiB RAM and equal swap limit, timeout 1200 seconds/kill-after 30.
  Check image sha256:f962663a6b90735118eb2ce954d3a457e1ba784b023fc346469927b5ecc3f0a1;
  rustc 1.98.0 (88d9e12ae), cargo 1.98.0 (797e8a9bc), x86_64-unknown-linux-gnu.
  tmux vhqwow6o-38f603, pane %110. Private source/diff/file manifests, logs,
  limits and terminal exits live under `_out/boot-size/metadata/`.
- B has no confirmed CX bench. Missing physical evidence inputs: actual local
  CX3576 board identity, serial console/device or management endpoint, the new
  signed zstd FIT plus matching ZSTD-enabled U-Boot image/flash target, and a
  confirmed cold-power control path. Cold boot/reboot/poweroff/watchdog remain
  pending; no production or unrelated device is touched.

### Native startup and packing evidence (2026-09-11)

The reviewed B3 archive fixture is source 31e7d98896541b3e571462a307772b7a4f96a56f,
with original relevant-source binding in measurements.json from B. Its B2
startup is 23 regular files / 17,192,408 bytes, including BusyBox, blkid,
veritysetup, dmsetup and libraries. Those are the current baseline; the earlier
ARM helper/size tables are historical, not this worker's measured endpoints.

The selected GNU static route uses the existing pinned builder, target
x86_64-unknown-linux-gnu, target-feature=+crt-static and strip=symbols. Actual
mos-init is 2,403,504 bytes, SHA256
86786aec7b407de6a08e6bb700b90498818f03be89848df454044ea1a693aa4f.
PT_INTERP, DT_NEEDED, RPATH and RUNPATH are absent. Linker NSS warnings are
preserved in the log; actual empty-userspace and native guest operations pass.
No musl/toolchain speculation or new C crypto dependency is involved.

STARTUP now has one regular executable, init. The B3 exitrd remains the
separate unchanged 2,047,144-byte shutdown, SHA256
d2c5c9a6e2473c0125670031c79014c6ee946b834e2e26f32a65f38939e68b35.
The startup observation path /sbin/mos-shutdown points to /exitrd/shutdown,
eliminating its former duplicate archive copy without changing retained bytes,
worker operations, teardown ownership or watchdog budgets. The B1 boot-only
BusyBox build/config/export tests and pins are retired; rootfs consumers and
build-time veritysetup remain.

Using the same original 66-byte B3 assembly-only boot.json (SHA256
5e84d68f9fe97906050678b64f6c7a61fcb53e3333119ecc8804453ffb61c02e):
old raw cpio is 21,293,056 bytes, SHA256
3cbfb7d5af5ebb66ecbbd51fc26fe0091b60dfb1e95a34e091a772cf8865ffd0;
new raw cpio is 4,453,376 bytes, SHA256
8170574517e77ee521a07ef1999719fdd719347f244eb3270d4c4e1b309cb8d8;
new zstd is 1,099,217 bytes, SHA256
67453b945285c9ecaf2d93057eeef79030edf40fb9a580e800eda6e3e8d030f8.
These are controlled assembly measurements, not a released kernel component.
Separate the startup closure reduction, removal of the duplicate shutdown copy,
and compression savings. Compression does not reduce expanded boot RAM.

A real disposable x64 TCG fixture used the unchanged original-J Linux6.12.107
kernel SHA256536a9d276d01fe116371f71ccd22d703f693f5642da0174163495bfb81876e0b,
with the original built-in certificate
101209c31085b09853c688d64c374d899ab904d508a4f69f0ae9b676c4ea0212.
The existing matching signer was used read-only; no private key entered the guest.
Reference veritysetup2.7.5 and dmsetup1.02.205 remain in this test-only fixture.
Full native/reference table equality and authenticated data read passed, followed
by missing signature, changed signature bytes, invalid PKCS7, unknown signer,
wrong root and omitted-key refusals. Unknown signer and absent key each return
ENOKEY, with distinct kernel verification messages.

The separate corrupted-data fixture loaded the signed mapping successfully,
then panicked on authenticated read (dm-verity device corrupted); it is not a
table-load refusal. Its console SHA256 is
ca66637f01bc90af2b059b6a3139c9d7f6375ed30cc5ba180982cb558209dc52.
The complete signed/negative/transition console SHA256 is
adfaaf9158ff3f22ed154d72a5eb0b03cd55b7f1e80aa26b8e906acd0e7d110c.
It includes actual GPT-only lookup/non-GPT rejection, read-only binds, moved
/dev /proc /sys /run, and old-root deletion before the final PID1 exec.

Mutation evidence is separate: an isolated guest with require_signatures=0
loads an unsigned table and the unchanged production readback guard rejects it.
The normal fixture keeps require_signatures=1. The kernel refuses writable
verity with "Device must be readonly (-EINVAL)"; a real writable zero target
independently proves the userspace status guard rejects writable state and
accepts the otherwise identical read-only state. Private source copies removing
the read-only requirement or full-table equality turn their green tests red.
No mutated source or unsigned policy is shipped.

Self-review RED "BOOT_STARTUP_GUEST_FAIL partial-activation-leaked" proved that
an alias creation failure after activation left a mapping. Rollback now covers
final alias/node validation too, removing only this creation receipt and keeping
the pre-existing unrelated alias object. The real guest regression passes.
Fixture wiring failures (missing dmsetup-created node and its stale alias) were
corrected after kernel output established the test problem, not by weakening
production guards.

Typecheck and kernel payload mutations pass (4 tests, 33 assertions); native
acquisition fixtures pass (15 tests, 60 assertions) after supplying valid static
ELF program headers. Rust tests/clippy and unchanged cargo-deny pass. Removing
the old argument formatter exposed an unused import, which was removed.
The full build suite reached its60-second bound during existing Docker toolbox
tests and has no aggregate PASS; three task-created unbounded idle toolboxes
were identified, stopped and removed. No shared builder or B7 resource changed.
The pinned Rust check image has no cargo-machete command; that attempted additional
gate is reported unavailable, not passed. All original failure logs are retained
in the private evidence directory. Mandatory full-image and physical acceptance
remain distinct from these source, ABI, guest and assembly results.

The same zstd1.5.7 recipe compresses the original baseline archive to 5,643,330
bytes, SHA2567fd558dc1197cfe98264e98bc0d711a596762fa3b9bf5a974691fae031488338.
This isolates compression from changed executable closure and the duplicate
shutdown removal. New compressed bytes are 1,099,217; these are assembly-fixture
measurements, never a boot-RAM or production-image claim.

Actual signed x64 UKI verification and compressed section comparison pass, and
in-place mutation of that section retains its certificate but fails the image
hash/signature. Self-review found an earlier objcopy extraction rewrote the PE
and discarded its signature; a disposable output copy and post-extraction
verification fixed that. An intermediate /dev/null output was rejected by
objcopy ("file truncated"), preserved as an original failure. The UKI fixture
uses its explicitly separate test boot signer, actual original-J x64 kernel and
current static init; it is offline packaging proof, not a trusted system boot.

B granted focused CX config/build/signature packing in the same serial slot
(B-BOOT-SIZE-CX-SERIAL-20260911-2133). Builder identity is
sha256:1a633508c14249e9521406dd62f2f344ad8ab8088438a66c33d48cd9e27dfe0d;
U-Boot source ece349ade2973e220f524ce59e59711cc919263f; rkbin source
ecb4fcbe954edf38b3ae037d5de6d9f5bccf81f4. The original public boot certificate
SHA256c9cd2241cc47266b302aceae71a280c4892f9bcaf32026c96f361cde42aad74b
remains unchanged. Only its exact file is mounted into this public-key build.

### Review handoff and final native witness

State: review-ready source, not done. Implementation is complete for all five
phases; plan acceptance is deliberately open for the reviewed full-system input
join and physical CX evidence. B owns review/integration; no main write, merge,
push, release or completed status occurred.

The real existing boot producer ran from clean source
9673af581d9857a0ff3746a5483ca3e70533861e,
tree bd9052b9f4f0109a56aceb1051082493224a3298:
--producer boot --bins "mos-init mos-shutdown" --arch amd64.
A verified task-local create/inspect/start adapter retained the hook command,
changed its source mount to read-only and exposed only private target/cache
writes. Limits were4CPU/cpuset4-7/10GiB/equal memory-swap, with7200-second bound.
Container9c5f6c38f3ae16a8178620a77a04e2a4788d62a24d48f46176c66829c9c81119,
hostPID2192272, ran21:44:07.085300573Z..21:44:52.613168347Z, exited0 and was removed.
Producer image:
sha256:b13d4a7b877c9d6dd9a2766c4e80f1fd020218715d62877c69ce0dc2abe4fc12.
Cargo.lock:
9bc386de11e4acaa4cae14223330e93ffa3e5547b0dbcaa8c9d8b35e94c4a782.
Exact source/epoch/argv/tool/image/target/output evidence is in
_out/boot-size/native-9673af581d9857a0ff3746a5483ca3e70533861e/.
The native output complement check confirms no mos-deploy signing tool was
emitted by this boot producer. Its source-file hashes were rechecked afterward.

| Output | Bytes | SHA256 |
|---|---:|---|
| Native mos-init | 2,403,504 | 64fda99a1f9f1b66fd32adac10071cf5f3987f34628b627381f40f1be04c331e |
| Native mos-shutdown | 2,047,144 | 5eaf5fa59306073fddce1868139628b126945c30f81c51faec0de59ae806adba |
| Matched assembly raw cpio | 4,453,376 | b0e0e123486c7ee1e93ce1cdbd721ff7ad76158e3cb486bff14197a4696cf62d |
| Matched assembly zstd | 1,094,275 | 3ec1935dff501b7c61a3c52c123b3a59ccc3ebce035366ed45632954c7ac21c4 |
| Offline UKI with original boot anchor | 16,178,216 | 5839ad08717e7528f73aaf692f0efdd7e91c3087b5606ac1a5251482e67d718d |

These final producer outputs supersede the earlier static probe hashes, not
their historical evidence. Shared workspace/lock inputs require a new producer
identity for both binaries. The rebuilt shutdown has the same size, with a new
hash; the B3 retained teardown implementation and safety invariants are unchanged.
B7's immutable fb6c native outputs were directly rehashed and equal the original
baseline inputs738391aa... (init) and d2c5c9a6... (shutdown). Thus baseline control
uses actual reviewed B2/B3 bytes while retaining their original producer identity.

The final x64 guest uses the new producer's mos-init worker entry point for loop
attachment, authenticated DM creation and GPT lookup, alongside native mount
transitions. Its signed/differential/negative/rollback/read-only/GPT/cleanup
console hash is1d2030d0b26f8629027b58e2932263a98c8fbc5e8e5e07dc08112dfad7fbffcf;
compressed fixture6c56024e60a2c49472faf09d2213ed75e61d0921a25e57118642a62227553176.
The corresponding corrupted-data run loaded the table, then panicked on read;
consoleebc802c37dcd77f4d40fcc4b6565ba39c0feb50d0a9e5c319013fa4315281ddf,
compressed fixture3739bcfb7c6189042b63a034e227d05b7c92f3753059aac4fd7a18fc012edb1c.
Original kernel and content trust are unchanged. Both containers exited0 and
were removed. Auxiliary reference/mutation binaries remain test-only inputs.

Fresh-target execution of the unmodified pkgs/mos-deploy/hack/check.sh passed
fmt, clippy,97 nextest tests (2 existing skips), doctests and cargo-deny.
An earlier shared debug target retained a guard-removal mutation executable;
its failed nextest result is preserved, and a new private target eliminated
that cache collision without changing source guards or test expectations.
The appended empty-userspace check initially refused a non-PID1 wrapper; using
exec for that fixture, without relaxing its PID1 assertion, passed independently.
Both actual native ELFs pass interpreter/dependency/RPATH checks; x64 C UAPI
assertions also pass. Native source and producer identities are not relabeled
to a later tracking-only commit.

CX source reconciliation first refused the cached patch0008 mismatch. The
successful job cloned the exact cached upstream commit locally and applied
the complete current patch set, retaining before/after diffs and pin hashes.
It used2CPU/4GiB on4-5 and exited0 at21:38:39.527541781Z, then was removed.
Resolved config d464532ecd919a26106a3d7159c0c07a27654ce80e559d12be380235de42ef18
contains CONFIG_ZSTD=y; real ZSTD decompression symbols are linked.
The9,420,288-byte loader hash is
f945cea2d4a83bdba35c949a64d02806456a3b850ba9c64f435f4c1e60b9e808.
Control FDT hash:
3da67a97449d1c61b6ab1595e205288da8590a9bbc87b70eb132e4d91814be21.
The original boot anchor, MOS signed-file policy, standard countdown/console,
watchdog checks and loader size bound pass. The build reports its existing
optional tee-os blob notice; no TEE or adjacent board policy was added.

New U-Boot tools verify the FIT against both generated signing control and the
actual compiled firmware control FDT. Kernel and ramdisk mutations fail hashes,
ramdisk compression remains none, kernel is zstd and FDT remains none.
This offline FIT deliberately uses a historical44,890,624-byte CX Image
(be46ffa4781baebe93c0b3ca0922a3838fb64a16bd2d2964b6249a26c575fc2d)
and clearly marked static ARM ELF stand-ins; it is not new ARM native or physical
acceptance and has no promoted full-image producer receipt. The FIT is14,167,498
bytes/SHA1283acb1e1ecbb3088b50881be5eec295a75350aaff97ea812611b3b7f10dea7;
kernel zstd13,430,015 bytes/SHA11f06242b74b18874385bbb68bbf5452d4ae9cfa2e076f0b217a92f1fddef223.
Existing S905 resolved config
4f19743dd3ad74c7532a14a5678010641cee2a24c0cc3e2ff97ba1163497cea2
confirms CONFIG_ZSTD=y; its producer now asserts that resolution too.

PMA-CR self-review: PASS for scoped source, with the two first-round functional
findings fixed and no remaining high-confidence defect. Coverage is the delta
from ef5e27c7, including native/FFI safety, producer/packing, board configuration
and fixtures. This verdict does not waive acceptance gaps.
Host toolchain policy passes428/428. The broad shell gate still fails verbatim:
"FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right
of a pipe, in a file that sets pipefail". That unchanged UI path is excluded.
The whole build-suite timeout has no aggregate PASS and must not be hidden.

Next runnable action: B reviews this exact scoped source and new native witness,
then coordinates the smallest explicit combined-source/input join with B7.
The shared mos-deploy workspace/Cargo.lock/native-hook changes require a new
deploy-package producer identity; there is no reviewed reusable full root for
this source. No independent full package/root/kernel-component/image candidate
was launched. Unchanged J kernel/mosd/podman/system inputs retain their original
identities if their relevant inputs are proven equal; no composition-only waiver.
B7's pending x64-only boot-tools route overlaps pkgs/mos-boot/Dockerfile and
build-tools.sh and needs a clean integration of the startup removals/zstd recipe.
Full signed-system selection/upgrades/trial fallback/reboot/poweroff and physical
CX cold boot remain pending. Exact missing bench inputs are the board identity,
console/device or endpoint, final reviewed image/flash target, and cold-power
control. Broad ARM acceptance remains deferred until approved main integration.

## B347-R1 review correction

- B requested changes on 2026-09-11: failed loop readback must not clear a changed
  or unknown binding. The same applies to SET_STATUS64 failure cleanup.
- Approved focused correction: consolidate attachment and readback at the typed
  syscall boundary, preserve same-FD and three-attempt EBUSY behavior, and clear
  only after current identity, flags and geometry prove this attachment.
- Preserve source 48d64990, native producer 9673af58 and all original evidence.
  New regression tests precede the fix; a later producer requires a new identity.
- Compare B 85c54845 single-target boot-tools changes read-only and prepare a
  private exact overlap proposal. No B7 consumer or unrelated baseline changes.
- Correction implemented: attachment and final status validation share the existing
  lifecycle-sys boundary. Expected backing device/inode and loop number come from
  the same live file descriptors; flags must be read-only, offset/size-limit zero.
  Invalid or unavailable final status returns an error without CLR_FD. After a
  SET_STATUS64 error, only a fresh exact status permits clear; cleanup failures
  still propagate. SET_FD EBUSY never configures/reads/clears, and caller retry
  remains bounded to three attempts. No shutdown teardown API was changed.
- A private fixed-operation seam first retained both original unsafe rollback
  decisions. RED: 2 passed / 4 failed, exit 101. Original traces include
  left ["set_fd", "set_readonly", "status", "clear"] versus expected
  ["set_fd", "set_readonly", "status"], and missing status before owned rollback.
  Log SHA256 ee677fd0f6a66474374aa3615240a9c1ad14b471953c77b8f023a56d3fc089b4;
  source diff 22b1d4a6b1d760a6518a7564242ac84c33ced6ef1b8fa1a0848b6d307c0e683e.
- GREEN: lifecycle-sys 14 tests, native_startup 4 tests, startup 1 test, fmt and
  workspace/all-target clippy passed. Six new tests cover changed device/inode,
  loop number, writable/autoclear flags, offset/size-limit, absent/error status,
  SET_FD EBUSY, exact owned rollback and clear failure. Log SHA256
  981ecfcb397e7cfd1f4e09f7f3893e085b6212488568bbeddc7d657807b73f6f.
- Serial resource evidence: RED container 9814bcf31849ed36dddd28bcaca5d2a27344a8276fc4bfae39b93af236460cd8,
  host PID 2227868, 22:26:24.164069566Z to 22:26:27.779472353Z, exit 101;
  GREEN e838930d172cad5c38a7600147cd3a37c5258d7ed5beeae45998826143832327,
  host PID 2237227, 22:27:41.414083823Z to 22:28:18.648604721Z, exit 0.
  Both ran in the pinned f962 check image with 2 CPU, cpuset 4-5, 4 GiB RAM and
  equal swap limit, two workers, network none, read-only source, separate fresh
  targets and 1200s TERM/30s kill bound verified before start. Both are removed;
  release this focused reservation. Full records: _out/boot-size/r1/r1-{red,green}/.
- Kernel basis: the supplied Linux 6.12 loop.c, SHA256
  b1804545f658a69571aea1f20131ec3dfc72c8f952e0a5496c0f94cd8d7e2f51.
  loop_change_fd can replace an open read-only binding; loop_clr_fd affects the
  current association. Separate status/clear ioctls are not atomic compare-and-clear.
  These are source-bound control-flow tests, not execution of a live device race.
- Exact private target-route proposal: .tmp/boot-size/r1/target-route-integration.patch,
  SHA256 63b227818b4ca26dfa4e90ebe64c229b99f37496eebf4f361925bf6ace6d986f.
  It applies to this worker's packing files and reconciles committed B 85c54845:
  keep validated single-target launcher and EFI-only loader output, retain zstd
  and compression.sh, keep retired BusyBox/ARM helper payloads removed, and move
  the target-routing checks into tests/boot-startup-package-test.sh. No route
  changes were applied to tracked source or B/B7 worktrees. git apply --check and
  15 isolated launcher/recipe cases passed, with zero builds/target executions;
  log _out/boot-size/r1/integration-route.log SHA256
  20c15a1acf4ff69669bb62769396f29b5b35c22bdb4437caaf289fcf7b66a52b.
- PMA-CR focused self-review: no remaining high-confidence finding. The prior
  full check/guest/native evidence stays tied to its original source and is not
  requalified by this correction. Native implementation input has changed; a
  later reviewed producer must emit a new source/recipe identity. B's bounded
  compressed-cpio consumer and exact observer-symlink binding are still pending,
  along with full signed-system and mandatory physical CX acceptance.

## Approved target-route integration

- B independently accepted 92b3cedd and closed B347-R1 with zero remaining
  introduced findings. Existing source/fixture limitations remain unchanged.
- Applied exactly the reviewed patch SHA256
  63b227818b4ca26dfa4e90ebe64c229b99f37496eebf4f361925bf6ace6d986f to
  pkgs/mos-boot/Dockerfile, pkgs/mos-boot/build-tools.sh and
  tests/boot-startup-package-test.sh. The resolution is a separate commit from
  the R1 correction, accompanied only by these existing task/plan updates.
- Final Dockerfile SHA256
  169d9dff654eafd33a44a9b4ac2a1e23cee2604ec3fa558297d1530d1d98badf;
  launcher 9cd889316846898a113d14680ef241e520c8474416e020a76b3871950784de03;
  startup test 0f061473c01ecbeac2ddaa0842e639f510398b12f3728fc7efc954cfef64476c.
  All bytes match the accepted private proposal, and the exact previously tested
  route prefix plus its five supporting input files remain identical. The
  existing 15-case isolated route evidence is reused; no suite or build was rerun.
- Direct syntax and diff checks passed. Preserve strict x64/aa64 validation,
  amd64 producer platform, no ARM acquisition/compiler reachability for x64,
  selected EFI output, zstd/compression tooling and retired startup helpers.
  Pins, trust, licence/source inputs and B3 shutdown are unchanged by this step.
- No container or heavy allocation was used. No B/B7 worktree, rootfs consumer,
  release policy or frozen artifact was changed. Old native 9673 evidence retains
  its original identity and does not validate R1. A truthful successor producer
  and bounded compressed-cpio/exact observer-symlink consumer binding remain
  pending, together with full-system and mandatory physical CX acceptance.

## Reviewed combined boot-native producer

- B integrated the 52 reviewed implementation/tracking paths into
  438c9551ec751fcb346881541752a7596f10cb15, tree
  775874cfdce2ef40b7f51ae3090c6c6706a5deae, epoch 1789167215. The only
  integration source correction removes whitespace on an empty guest-init line.
- A detached clean production checkout is scoped beneath
  _out/boot-size/combined-438c9551ec751fcb346881541752a7596f10cb15/source.
  The working branch is not synchronized to B/main; previous outputs are retained.
- B authorized one actual boot-native hook run and direct static/empty-userspace
  proof: 4 CPU, cpuset 4-7, 10 GiB RAM with equal swap limit, four workers,
  7200s TERM/30s kill, verified before start. The Rust image is pinned to
  b13d4a7b877c9d6dd9a2766c4e80f1fd020218715d62877c69ce0dc2abe4fc12.
  Freeze source/lock/hook/tool/flags and use fresh private release targets/cache.
- Actual production succeeded once from that exact source. Container
  c7384fc81f12e549ed757e09ae8062169294d771ebbff11dabd7e74e91bcaae8,
  host PID 2262193, 2026-09-11T23:00:22.693748579Z to 23:01:10.147862158Z,
  exit 0, removed. Actual compiler rustc 1.98.0 (88d9e12ae), cargo 1.98.0;
  compiler binary SHA256 3690cc576ede140504698405d5d8fa3826aaadbe71699c6c4ed0a565d6f493e2.
  The original and actual argv, source, toolchain record and inspected limits
  are under metadata/native/ within the combined output root.
- New mos-init: 2403504 bytes, SHA256
  57c865ed0b58740faaba642cc417a0b0a3a487f3b6718a1e2fcc7e1355bdea97.
  New retained mos-shutdown: 2047144 bytes, SHA256
  77bf04b463ece3b0aaba03fa0f91fe0939faa87c5b9b81937b24636b3e2ef1ea.
  Both use x86_64-unknown-linux-gnu and the existing +crt-static/strip flags.
  These are separate executable/retained bytes; no new cpio/compression/image
  size or full-system qualification is claimed. Old 9673/fb6 outputs are intact.
- The real hook's readelf checks and the existing combined-source
  build/src/kernel-package.ts kernelExecutables parser passed on both new
  binaries: x64 ELF, no PT_INTERP, DT_NEEDED, RPATH or RUNPATH. Source inventory
  binds 49 files and rechecked unchanged after production; Cargo.lock stays
  9bc386de11e4acaa4cae14223330e93ffa3e5547b0dbcaa8c9d8b35e94c4a782.
- Actual stdout and stderr were collected before removal. Container stdout
  SHA256 b4203d65cc783e5a0d49461a2ef23987903eb20ec43425457aad0e836766c3a6;
  stderr b7d61b621ad51b14ea907406ec6e14cb82c8897f188a0673a8e76a567f9aa315.
  The existing GNU getaddrinfo/getpwuid_r static-link warnings and linker note
  about garbage collection remain verbatim; no warning-free claim is made.
- Serial benign proof used only SYS_CHROOT capability and network none.
  Container 19f655309b4718c9711acd16b989bdca2ca437d63ce1197efc3829eba14efb1c,
  host PID 2273695, 23:03:50.624232267Z to 23:03:50.718397749Z, exit 0,
  removed. The real startup binary executed with no loader/libraries/helpers,
  public invocation refused non-PID1 and the native mount worker refused EPERM.
  The new shutdown binary also refused non-PID1 before watchdog/shutdown work.
  Proof log SHA256 d8a1eb217ad8f161caff9fb6ae2b67c0dca0fae29dc8284469594411a7672728.
  No host/shared block device, watchdog, reboot, guest suite or ARM execution.
- Prepared read-only successor inputs: 59 deploy context/driver/workspace files
  and 19 boot-tools context/pin files, in metadata/successor-inputs.json
  (SHA256 5e04111b5b6103fac2ab34525532b5be88834bd4b8515a4196b7c6dc411f0fd2).
  Prospective deploy version 0.1.0+git438c9551ec75-1 is not a produced package.
  The native inputs equal accepted R1 source; changed deploy and x64-only
  boot-tools still need their own actual producer and exact consumer binding.
- All owned jobs are terminal, containers removed, and the 4 CPU/10 GiB
  reservation is released. tmux vhqwow6o-38f603 is an idle persistent shell.
  The detached production checkout remains clean; the worker branch contains
  only tracking updates for this continuation. B7 and shared resources were
  untouched. Full-system and physical CX acceptance remain pending.

### Approved startup consumer continuation (2026-09-11 23:14 UTC)

- L1 approved the exact 438 source/witness and compressed-native consumer scope;
  B granted one serial 2 CPU/4 GiB x64 source fixture slot. No generic approval
  remains. The finished 438 native producer and direct proofs are not replayed.
- Authorized exact local synchronization: 5d7d8c13303ba385730403921cad4721ab2d2c39,
  tree a34334fbba80aaa4473cbd4d0d33569a90361867, parents 2d436370 and 438c9551.
  The merge is clean, preserves both records/indexes, and leaves the separate
  production checkout and all previous artifacts immutable.
- Work in progress: fixed 438 producer membership and all 15 producer input
  maps; bounded single-frame zstd/newc validation, exact static manifests and
  observer symlink; directly affected negative tests. Existing J/fb6 cases and
  default mixed-source refusals remain separate. No producer path is treated
  as a composition-only change.
- Exact deploy and single-target boot-tools input inventories were submitted
  to B for successor scheduling. Their output identities remain producer
  results; no second native, full root, ARM or duplicate B7 candidate is run.

#### Native-format and witness checkpoint

- Implemented the fixed 438 native witness in the existing source-lineage
  boundary. The normalized consumer receipt is
  `_out/boot-size/consumer/native-witness.json`, 24067 bytes, SHA256
  e66650563f340e0ce8f722a7812f36bba8012ee98e3e220aa2bbea5d1864afc0.
  It references the unchanged original delivery 259d757f..., original argv,
  stdout/stderr, terminal and tool records from the single completed native
  invocation. Read-only verification checks 49 source inputs, 27 execution
  evidence files and both actual output hashes. The old fb6 role refuses it.
- Added a separate 438 native-format route, leaving the old raw representation
  scoped to the old role. It bounds unique PE ranges, compressed/load bytes,
  window and expanded output to 64 MiB; requires one checksummed zstd frame;
  rejects concatenated/skippable/trailing streams and malformed/truncated
  payloads. Decoding uses the existing pinned Bun runtime and its bundled zstd
  through a child with a 10-second kill deadline and independent output cap.
  No dependency, producer recipe, toolchain, target payload or trust pin changed.
- The newc validator examines entries without extraction: exact root-owned
  native files, modes, one-executable manifests and only the canonical observer
  symlink. It rejects extra/unsafe/duplicate members, hardlinks, wrong ownership,
  bytes, type, mode, target and noncanonical padding. Source/witness/capture
  validation now precedes joined native inspection; envelope authentication and
  signed object digest verification still precede decoding.
- RED history is immutable under `_out/boot-size/consumer/`: initial canonical
  positive failed `joined cpio header`; the first signed test exposed a missing
  fixture support file, then its corrected RED reproduced the same format
  refusal. New witness-role tests initially raised 22 unrecognized-role errors.
  The ordering RED returned `joined UKI header` instead of the required producer
  receipt refusal. A later test run passed six tests but its aggregate exited 2
  for four TypeScript test assertions; those assertions were corrected.
- GREEN: nine new TypeScript cases across focused single-file invocations,
  including actual 438 bytes, missing/corrupt/untrusted envelope signatures,
  authenticated object mutation, a lying expansion claim, manifests/membership,
  raw and virtual-only PE overlap, and source/capture ordering. Direct old raw,
  witness and lineage controls passed. The new Python witness test exercises
  its positive and 21 negative variants; both directly affected witness tests
  pass. Final TypeScript typecheck passes. These are consumer/source fixtures,
  not new native, kernel, guest, root or hardware qualification.
- Retained signed metadata fixture:
  `consumer-signed-binding/evidence/signed-startup.mosupd`, 2019798 bytes,
  SHA256 16db8ef40f246c34d5cf5e2194a8e30d75df672f3d01846226fb8a52ee8cbd1f.
  Its minimal PE payload is 2004992 bytes, SHA256
  bb0daac49de5cb8d11c5746e32334089ee68c1a0109908d50143db19b5bb83b0.
  The retained public-key text is base64 Ed25519 despite its fixture `.pem`
  filename. No private key is exported. These fixture packing sizes are not
  production -19 compression measurements or UKI Authenticode acceptance.
- Full original/fb6/438 input maps and both reviewed Git legs are retained in
  `input-inspection.json`; fb6-to-438 canonical delta SHA256 is
  b111da81645b0fd91697e18ef464635a7a5cd7c814ed84ba02cabd3a75efca88.
  All 15 full map hashes change because Makefile loses exactly the obsolete
  BusyBox test target. The version script only checks that this file exists.
  Three ARM-only producer maps also contain the focused U-Boot source changes;
  none supplies an archive in the original 15-member x64 pool. B received the
  exact proposed existence-only proof, retaining both full maps and refusing
  any other shared-input change. No input was excluded or declared equal.
- The full new join creator/record admission is still pending the exact
  Makefile disposition, new deploy/tool outputs and B7 immutable consumer
  handoff. This checkpoint does not admit a self-authorized 438 package pool;
  existing strict defaults and prior records retain their current meaning.
- Fresh producer checkout prepared at
  `_out/boot-size/combined-producers-438c9551ec751fcb346881541752a7596f10cb15/source`:
  clean exact 438/tree775874cf/epoch1789167215; all 59 deploy and 19 boot-tools
  input files rechecked. B has the exact deploy and single-target x64 commands
  and a replacement serial 4 CPU/10 GiB request, including task-owned BuildKit
  capability/driver details. No producer, builder, ARM or full image was run.
- PMA-CR checked the implemented format/witness boundary and callers. The
  source-before-decode ordering and virtual-only PE overlap were corrected and
  tested. No remaining introduced finding in this checkpoint; complete join
  admission and combined acceptance are explicitly unfinished. All owned
  fixture containers are terminal and removed; the 2 CPU/4 GiB source
  reservation is released at this checkpoint, with the temporary worker slot
  retained. Full-system, physical CX bench inputs and post-main ARM remain
  pending. Task and plan stay in progress; handoff is for review, never done.
- A final PMA-CR check found that the new archive validator allowed boot.json
  above mos-init actual 4096-byte reader budget. The added 4097-byte case first
  failed with `Received function did not throw`; the validator now uses the
  witnessed reader limit. Its focused GREEN and final typecheck are retained
  separately, without rerunning unchanged suites.

### 2026-09-12: exact input and producer execution continuation

B/L1 approved the fixed Makefile existence-only read proof, all 15 full maps with
four explicitly unselected ARM producer maps, and the dedicated pinned BuildKit
execution mechanics. These resolve the previous checkpoint's concrete input and
resource questions. The producer checkout remains exact 438c9551; consumer source
remains separate at 70c992c2. Deploy PREPARE must terminate before the private
BuildKit daemon starts. The serial 4 CPU / 10 GiB / cpuset 4-7 envelope replaces
the released source-gate allocation. No native replay or B7 mutation is planned.

### 2026-09-12 00:21: fixed input proof and preserved deploy boundary failure

- Actual deploy PREPARE ran once from clean 438c9551 and exited 0 at
  00:06:48.571688832Z. Container `7dfecb6f427a31c005106eb09c5fe1676d6acc3f9038c6ce3500e3ac23b209e6`
  used 4 CPU / 10 GiB / equal swap / cpuset 4-7. The staged `mos-deploy` is
  2,632,224 bytes, SHA256 `411419421b364a27fe466ba1b0f509ee2f054a502493d6f474f1a8f4fff2855d`.
  Prepare-only terminal receipt is 22,317 bytes, SHA256
  `11dbe5aee5a0d6063e7eb963f1509b5e86a6d878735afb7bdaa5d7c43477d7ec`.
  This is no deploy archive qualification and no second boot-native build.
- The package wrapper exited 1 before packing. Pinned private BuildKit started
  as `f97652ea80d48891db7d52eafebaf3e61ee066b853f3484cf293e8caab8187e4`,
  PID 2344641, at 00:06:54.892734484Z. Its actual worker report included
  `linux/amd64,linux/amd64/v2,linux/amd64/v3,linux/amd64/v4`; the local adapter
  incorrectly required a lone `linux/amd64` and refused before cgroup/client
  acceptance. The daemon was stopped and removed. Its labelled private volume
  is retained. No ARM platform was reported, but no isolation PASS is claimed.
  Original logs, create/start/stop events and failure are immutable under
  `_out/boot-size/combined-producers-438c9551ec751fcb346881541752a7596f10cb15/metadata/`.
- Implemented the fixed five-reader/Makefile contract and both reviewed source
  delta legs. The complete actual input proof is 591,271 bytes, SHA256
  `93902df4c3351b3d3e2c3ca3977f6b4bbd07fb2361c2f0aedc1f0c1c3d1b87ba`;
  full maps retain their different Makefile identities. Four ARM producers are
  explicitly unselected and unqualified, with no attributed reused source.
  No producer or Makefile source was changed.
- Focused Python source checks: original missing-contract RED (3 errors), one
  local editor syntax failure retained, then 4 passing tests with input, mode,
  membership, source and delta-leg mutations. These were ordinary bounded host
  checks (taskset 4-5, 60-second TERM/30-second kill), not guest/container claims.
  The new Bun complete-input case has an original missing-export RED, then
  1 passing test / 15 assertions and typecheck PASS in the pinned source image.
  Its terminal container `86aa31d648357c7a4547c44854484a81e3763833e87dd5cd4761124607e219ba`
  ran 00:18:28.695298346Z through 00:18:32.91490337Z, exited 0 and was removed;
  limits were 2 CPU / 4 GiB / equal swap / cpuset 4-5 / network none. No own
  consuming container remains. No unchanged native/guest/root suite was rerun.
- A private mechanical comparison against immutable B7 fbd70048 preserves its
  named 4716 role, output witness and downgrade guards. It is not applied to
  this branch or B7. The exact legacy BusyBox witness remains limited to the
  old native role; new compressed startup keeps its own source argument.
- PMA-CR inspected these input-contract helpers and direct tests: no introduced
  high-confidence finding in the implemented portion. Full new join creation
  and admission are still unfinished; the helpers deliberately do not authorize
  missing deploy/tool receipts. Next: B disposition of the one recorded daemon
  parser failure, a packaging-only continuation using the preserved PREPARE
  stage, then one x64 boot-tools producer and exact receipt/consumer binding.
  Keep task/plan in progress and handoff in review. Full system, physical CX
  and consolidated post-approved-main ARM acceptance remain pending.

### 2026-09-12: authorized packaging recovery

B-347-PACKAGING-RECOVERY-20260912-0039 approved one explicit daemon recreation
on the retained owned state, exact x64 platform-set parsing, and the remaining
frozen driver suffix using the successful PREPARE stage. The recovery preserves
all old failure records and writes new evidence under `metadata/pack-recovery-v1`.
No original compile, boot-native invocation or producer source is replayed.

### 2026-09-12: changed producers recovered and frozen

The authorized daemon recreation passed exact platform, cgroup and remote
transport checks. The original successful PREPARE was reused once through the
frozen driver suffix; deploy pack and index exited zero. New deploy archive:
758,104 bytes, SHA256
`31f1cdec9fc8babe3f3a21fa590adf8b6fd89d464efa447c09e0f3086a935be4`.
Its installed executable equals the original 2,632,224-byte PREPARE output.
The private pool contains that archive and exactly 14 byte-identical J archives.

The single x64 boot-tools producer exited zero at 00:48:40 UTC. Its new manifest
is `sha256:af672edb59f2e23c38a7e2245804760e5b90d3884aee6dac327cf1bd64d5a661`;
its actual OCI config is
`sha256:ccf6474e8a983bad48625c9204951a8a1a93af3a583b44126657f58e3b70c44a`.
Exported manifest/config/layers, selected EFI, compression scripts, license and
source inputs are bound under the producer metadata `pack-recovery-v1` directory.
The final package-query collector initially failed because shell expansion
consumed the dpkg format variables. Only that query was corrected and rerun;
all preceding passed checks and the failed record remain intact.

The first cleanup sampler preceded asynchronous daemon deletion. A later
read-only collector retained actual die/destroy events and absence; requested
daemon shutdown exited one, independently of successful producer exits. All
owned containers are absent, the labelled private state volume is retained,
and the 4 CPU/10 GiB producer reservation was released to B.

Normalized actual deploy witness SHA256 is
`224cac3207ca49a128e6881552cdd20d8b4972d22c579f3ee41bc5c4524845b0`;
boot-tools witness SHA256 is
`76b65b10a72537194d08f6b18dd997067a8d06920ede0e48607fe1c35387a47d`.
They retain 59/19 source inputs and 157 evidence bindings each. The complete
consumer admission is being implemented against these actual receipts. The
original architecture/stamp refusal is preserved; direct Python admission and
successor witness guards now pass. TypeScript, two clean copies and B review
remain pending. No full-system, physical CX or post-approved-main ARM result is
claimed.

### 2026-09-12: exact startup consumer admission

The existing Python and TypeScript joined-source validators now admit only
`mos/producer-join/startup-v1` with the four fixed J/438 receipt roles. They
retain both complete producer delta legs, all 15 full input maps, the exact
72-byte Makefile read-contract proof, the unqualified ARM declarations, 14 J
archives and the new deploy/control/index identities. Later consumer changes
must still preserve complete producer maps. Only the two existing 1925/1927
tracking files receive a startup-specific exception outside producer contexts;
`COMPOSITION_PATHS` is unchanged.

The release validator binds the new x64 boot-tools image and rejects packages
from the four unqualified ARM producers even when installed as `Architecture:
all`. Existing signed compressed native/manifest/observer checks remain intact.
The actual creator passed against the clean 438 producer checkout, all three
new producer witnesses and the immutable original J frozen receipt. That input
diagnosis is not a final consumer-checkout or full-image acceptance claim.

Direct RED retained the Python package-stamp and TypeScript lineage-stamp
refusals. GREEN covers the actual admission and 20 record mutations, both real
successor receipts and 22 semantic/file mutations, and two explicit release
tests with 23 assertions including capture/default/ARM-installed refusal.
These were bounded station source checks using recorded Bun 1.4.0/Python tool
bytes; no source-test container or heavy reservation was consumed. The first
TypeScript check found a missing local runtime binding, which was corrected;
the final typecheck and docs/diff checks pass. Unchanged native, guest, format,
kernel and producer suites were not replayed.

PMA-CR examined the changed joined-source blocks, actual producer receipts,
source/format dispatch, consumer/input boundaries and retained failure evidence.
No unresolved introduced source finding remains in the local review. The exact
private B7 overlap proposal is under `b7-overlap-v2/startup-on-fbd70048.patch`;
it preserves named 4716 and legacy downgrade refusals, retains both test sets,
and confines legacy BusyBox to its existing source role. It is syntax-checked,
not applied or qualified as an integrated candidate. A missing test closure in
the first private mechanical resolution was recorded and corrected.

The final committed consumer source is the input to the two-clean-copy CLI gate;
its canonical lineage, exact file hashes and terminal evidence are frozen in
`_out/boot-size/consumer/startup-final-handoff/delivery.json`. Independent B
source/overlap integration review and later combined signed-system acceptance
remain required. Task and plan stay in progress, handoff in review.

### 2026-09-12: reviewed mask and named-tool overlap

The additive B handoff authorizes the exact committed four-mask delta from
`b5d9917c` to `f4c1c4c4`, preserving named 4716 and startup 438 roles. The
existing private compatible named-tool proposal is now being combined in this
worker with that delta; no broad Git synchronization or producer input change
is performed. The replacement 2 CPU/4 GiB source slot is used for affected
combined-source tests only. Earlier producer/source receipts and failures remain
immutable. Exact TypeScript patch contexts required mechanical import/test
placement resolution because startup tests occupy the old adjacent anchors.

The combined overlap is now implemented in eight existing source/test/tracking
paths. `consumers.json` is byte-identical to reviewed `f4c1c4c4`; its four new
mask rows are the only declaration change. Named 4716 constants and witness
functions retain their reviewed committed semantics. The complete startup
input proof and creator are unchanged; no producer or default composition
allowlist has been relaxed. Frozen 438 native/deploy/tool outputs are retained.

The mask RED failed with `broken link
/usr/lib/systemd/system/cryptdisks-early.service: missing path: /dev` before the
reviewed declarations were applied. The bounded Python GREEN passed eight
composition, mask, named-role and actual-startup admission tests. The explicit
single-file Bun gate initially exposed an incomplete startup-schema test
fixture; it correctly reached the legacy downgrade refusal. Adding the actual
startup schema to that fixture preserves its intended missing-receipt refusal.
The final six targeted release cases (39 assertions) and typecheck pass. The
first failure and all original gate inventories are retained separately.

All source containers ran serially with actual cgroups `200000 100000`, CPUs
`4-5`, memory `4294967296` and swap `0`; each is terminal and removed. The Python
container used captured read-only image inspection fixtures with exact-command
refusals, not a host Docker socket. Final actual two-copy admission uses the
real immutable producer files and read-only local image inspection. No producer,
PREPARE, native, full-image, guest or ARM invocation was repeated.

PMA-CR local review passes with zero unresolved introduced findings. The final
commit is the input to the new two-clean-copy gate, whose source, canonical
lineage, actual tool/receipt bindings and terminal evidence are retained at
`_out/boot-size/consumer/mask-final-handoff/delivery.json`. Earlier
`startup-final-handoff` evidence remains immutable. Independent B integration
review and later affected signed-system acceptance remain pending; the task and
plan stay in progress and the handoff ends in review. Physical CX still requires
the exact local device, serial endpoint, current/final image, flash and power
inputs. Consolidated ARM acceptance remains deferred until an approved main
merge.

### 2026-09-12: final reviewed operator overlap

Applied only the exact two-path patch from clean `70a7a408` to reviewed
`66385757`: `consumers.json` and its existing composition tests. Patch SHA256
`1097e14539cbb84b5a7331f64d2bf8d770276b69114b196f372383e6358cc9ab`;
both resulting Git blobs equal the reviewed source. Docker alias, 13 operator
paths, 18 resources including the quota service helper and nine native rc links
retain exact ownership/type/mode/target rules. The four masks and three retained
dpkg-owned operators remain; routel remains the only omitted operator.

The source handoff reuses byte-bound B7 composition evidence at its original
J/fb6/4716 identity and unchanged 70a7 startup checks. No producer, selector,
compose, capture policy, joined-source allowance or trust byte changed. Final
current-context verification and two canonical joins use the real 438 native,
deploy and tool receipts, complete producer maps and the actual 15-archive pool.
They run from two clean copies of this final committed source. Their exact
source, per-path overlap, receipts, capture/release results and terminal evidence
are retained in `_out/boot-size/consumer/operator-final-handoff/delivery.json`.
Old fb6 captured root/deploy bytes retain their original attribution and must
refuse admission as the new 438 candidate.

Local PMA-CR covers the two-path integration and unchanged admission boundaries;
independent B review remains required. The task and plan remain in progress,
with the handoff in review. B7 owns the next combined x64 root/support/signed
image/lifecycle batch; no duplicate producer or root was launched. Full 438
system acceptance and physical CX device/serial/current and final image/flash/
power evidence remain pending. Broad ARM acceptance follows the approved frozen
batch-2 startup-chain main integration.
