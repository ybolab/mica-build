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

Awaiting B source review of the implemented five phases. Full-image input join
and mandatory physical CX acceptance remain pending.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full-tier proposal: it crosses FIT/UKI packaging, the authenticated init, the
  Rust dependency licence policy, and boot/shutdown acceptance.
- Distinct from [20260910-0338-minimal-boot-shutdown](20260910-0338-minimal-boot-shutdown.md),
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
