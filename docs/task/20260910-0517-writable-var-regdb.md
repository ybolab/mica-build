# 20260910-0517-writable-var-regdb Writable var with bounded DATA storage and matching regdb

- **status**: completed
- **priority**: P1
- **owner**: worker/writable-var-20260910
- **createdAt**: 2026-09-10 05:17

## Description

Implement the user's approved whole-/var writable DATA policy, enforce project
byte/inode limits, and repair the regulatory database signer mismatch found in
the latest CX3576 boot log. Complete-image development only; no migration or
compatibility paths. Preserve unrelated working changes.

## ActiveForm

Completed the approved storage and regulatory database repairs and signed-image acceptance.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full PMA tier: packaging, initialization, verification and storage observation.
- User authorization: make all of /var writable and apply a quota if possible.
- Baseline: d64b23a7 plus the uncommitted boot-log assessment documentation.
- Plan: [implementation and acceptance](../plan/20260910-0517-writable-var-regdb.md).

## Acceptance

- First-boot arbitrary /var state creation and persistence after reboot.
- Read-only root preserved; missing DATA fails consumers closed.
- Real byte/inode quota exhaustion rejects service writes while protected
  identity, mosd state and native metadata remain writable.
- Eliminate per-systemd-leaf mounts and obsolete immutable-var checks.
- Package a database/signature pair trusted by the target kernel.
- Relevant regression suites, image verification and x64 signed boot pass.

## Implementation and verification progress

- Whole /var now binds DATA/var. Four systemd leaf mounts and the separate
  var-tmp mount are removed. Protected mosd/Bluetooth state and machine identity
  retain their existing physical ownership; no old-layout import exists.
- Project 101 covers var/cache/tmp together. Its budget is one eighth of DATA,
  bounded to 32–256 MiB and 2048–16384 inodes. State/meta retain the existing
  128 MiB / 2048 inode reserve. The optional quota question received no answer;
  the announced bounded automatic policy is the implementation default.
- The CX3576 BSP exports regulatory trust certificates from its configured
  source and checks their DER bytes occur in the built Image. FIT support
  packaging verifies the pinned upstream database/signature against that bundle
  before copying either file. Unknown-key and modified-content cases refuse
  publication; the selected pair passes.
- RED evidence: missing DATA/var, missing seed helper, the obsolete immutable-var
  verifier contract, and missing var usage in the Rust storage response.
- GREEN: two layout/seed scripts; 389 build tests; 645 verifier tests; 22 Rust
  storage tests plus fmt/clippy; docs checks; host-toolchain checks including
  new files (393 files); shell syntax (11 changed/new scripts).
- x64 signed production-root acceptance passes two boots. An early
  DefaultDependencies=no StateDirectory service starts after var.mount without
  a per-directory mount. General var writes persist into boot two. Real byte
  and inode exhaustion produces EDQUOT with production service capabilities,
  while protected state/meta writes succeed. The observed project 101 limit
  is 191246 KiB / 12288 inodes on the grown test DATA filesystem.
- Both x64 boots complete native service/health and firmware readback acceptance,
  enter exitrd and detach every filesystem, loop and DM device. No failed service start
  or ordering cycle appears in either boot log. The initial var template occupies
  540 KiB; project limits do not preallocate that many bytes.
- Evidence directory: `.tmp/writable-var-regdb/`. A fixed source snapshot and
  per-file hashes preserve the tested implementation. All three production root packages are built. The CX3576 complete image
  passes final assembly and verification.

## Build issues resolved

- Direct package discovery scanned historical .tmp checkouts as duplicate
  producers. Builds use an isolated current-source checkout, without changing
  the unrelated producer-discovery implementation or removing other work.
- The first BSP export failed because its Docker context allowlist omitted the
  new certificate exporter. The explicit allowlist is fixed and the BSP passes.
- The first Rust fmt check identified a line wrap in the new regression. The
  corrected test and full focused checks pass.

- ARM64 full-system QEMU acceptance also passes two boots, var persistence,
  byte/inode exhaustion, native service health and complete exitrd teardown.
  The same service budget is observed: 191246 KiB / 12288 inodes. The machine ID
  remains identical across both boots.
- ARM64 package smoke records 11 passes and one declared executor limitation:
  `Failed to re-execute libcrun via memory file descriptor` under qemu-user.
  A separate acceptance-only assertion executes `crun --version` successfully
  as 1.29.1 inside both full-system ARM64 guests. It is added only to the signed
  test root; the production root and primary workspace are unchanged.
- Initial shutdown unmount attempts can report EBUSY while root/support loops
  remain live. All four guest logs subsequently enter exitrd and report every
  filesystem, loop and DM device detached; no finalization failure is present.
- Local review: PASS, zero findings; `.tmp/writable-var-regdb/review.md`.

## Delivered artifacts and final acceptance

- Complete factory image:
  `_out/cx3576-var-regdb-20260910/image/mos-cx3576-20260910-060545.img`.
- Logical size: 1,362,100,224 bytes (1,299 MiB); SYSTEM remains 1 GiB.
- SHA-256: `a04d6119c3060c72dc5a99afca9e3c9e344301759c20e40bd6ed84ae6ada1e82`.
- Signed deployments: generation 9
  `4b65e7b501e7278617ca33346d24a18eb193c08e5005db1d87b722ccf6489e73`
  and generation 10
  `927551d5e32a5ed1b8bd7f4854b042f209969c447c251fcd3af7cf2886b9f570`.
- CX3576: 124 offline checks, zero skipped; fixed flash geometry, actual embedded
  firmware control FDT, required FIT signature verification and all modified,
  unsigned and unknown-key negatives pass.
- The kernel Image is byte-identical to the previous integrated BSP
  (`c3953f7a7ab0a2ab181d20fdc568b341d7481bab7653eaea101a52d38ee25fcc`).
  This repair changes the authenticated support contents and root policy. The
  current native-console/centered-logo firmware and unchanged mos-init are reused
  from their previously verified inputs; all production root packages are rebuilt
  at d64b23a7d92a-dirty with the recorded implementation snapshot.
- Production components and full evidence:
  `.tmp/writable-var-regdb/source/_out/writable-var-regdb/`.
- QEMU evidence: `.tmp/writable-var-regdb/boot-x64-{1,2}.log` and
  `boot-virt-arm64-{1,2}.log`. These are full-system acceptance images with test
  units, not additional public factory releases.
- Physical CX3576 radio service results remain untested. Flash the complete new
  factory image and collect `systemctl --failed`, the rfkill/regdb service
  journals, regulatory status and actual wireless traffic before closing physical
  acceptance. This task does not complete the separate P10 hardware milestone.

- Final delivered-image checksum passes. Both initialization helpers also refuse
  a missing DATA root without creating a replacement directory.
- Kernel component: `66466eab1e00eda4eb1b48ce7068f1dd337b289a51f6c5d8f651ffc1e570f713`.
- Root component: `c25bf03cdf9a69fda73ef644dd59540210e13146aaec695e46dd20b27a1b18b2`.

- complete: Implemented and verified writable var, project quotas and matched regdb; x64/ARM64 signed boot acceptance and CX3576 image checks pass. Physical board acceptance remains separate.
