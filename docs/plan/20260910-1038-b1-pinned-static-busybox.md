# 20260910-1038-b1-pinned-static-busybox B1 pinned static BusyBox boot package

- **status**: completed
- **createdAt**: 2026-09-10 10:38
- **approvedAt**: 2026-09-10 10:38
- **relatedTask**: 20260910-1038-b1-pinned-static-busybox

## Context

B0 selected a no-link early-userspace payload: `/bin/busybox` is invoked
explicitly while util-linux `blkid`, `veritysetup`, and `dmsetup` remain
separate. Startup remains `mos-init`; B1 supplies only the payload build and
validation contract and must not alter startup, exitrd, or rootfs composition.
The main-runtime BusyBox and the declined PLAN-086 S5 tooling reduction are
unrelated and remain unchanged.

The L1-approved #313 source and B0 audit were integrated through L2 B commit
`3ac8ca287df2fdca4aa639b036d789d63a336aec`. This L3 merged that exact local
reference before investigation; no live main or remote L2 reference is used.

## Proposal

- Verify the latest stable BusyBox release and exact archive digest from the
  official upstream, then pin both with the existing package provenance.
- Add a deliberate static configuration containing only the required early
  mount, loop, switch-root, shell/parser, synchronization, and shutdown applets.
- Add a narrow component build interface for existing x64/arm64 boot Dockerfile
  conventions without changing production initramfs or exitrd assembly.
- Add a stable focused fixture that rejects missing/wrong-architecture/dynamic
  payloads and missing applets, verifies deterministic identity, and exercises
  a positive payload when source/tool availability permits.
- Add only the requested Make check target and run the required bounded gates.

## Risks

- BusyBox configuration dependencies can silently enable extra applets; the
  fixture must inspect the built applet list rather than trusting config text.
- Cross-architecture proof is valid only for targets actually compiled and
  inspected; results will be reported separately without inference.
- Component compilation is allowed, but full rootfs/kernel/image/QEMU builds
  remain prohibited without a relayed L1 grant.

## Scope

Write scope is limited to BusyBox-specific new files under `pkgs/mos-boot/`, a
new focused fixture under `tests/`, the fixture's Make target, and this node's
task/plan records plus their index rows. Production startup/exitrd assembly,
rootfs composition, Rust code, UI code, and campaign-wide tracking remain out
of scope.

## Verification

- RED: `timeout 120 bash tests/boot-busybox-package-test.sh` initially exited 1
  because the validator did not exist. Component builds then rejected the
  accidental dynamic PIE, missing multicall metadata, missing shutdown applets,
  and unavailable arm64 libc headers before those defects were corrected.
- GREEN: the focused fixture exits 0 for missing payload, wrong architecture,
  dynamic ELF, incomplete applets, wrong identity, positive fixtures, and
  deterministic identity. A container run against both built payloads also
  exits 0.
- BusyBox 1.36.1 is pinned from the official archive with source SHA-256
  `b8cc24c9574d809e7279c3be349795c5d5ceb6fdf19ca709f80cde50e47de314`.
  Two component builds produced the same x64 and aa64 identities. x64 is
  `c48d13f5cc6f68e5ef897de4c04f85cb0d8af510ff1af0256490b37029fa6c4a`
  at 1,213,152 bytes; aa64 is
  `d32412a3ebd0997df9917995c3df54dc93c7bdbc18d0e08e331c24fbfcdc7f2a`
  at 1,056,896 bytes. Each exposes exactly the 19 required applets.
- Final component metadata and log are
  `/tmp/mos-b1-busybox-build-reviewed.dUQptc/metadata.txt` and
  `/tmp/mos-b1-busybox-build-reviewed.dUQptc/build.log`; source commit
  `0e0951151569235a52af26e1fee0c7c77687c588`, image
  `sha256:d539b0bde58f6fdb15a704c5c3668c47da32bcc3a8fc4e8fc1254ff2b07a8b54`,
  exit 0.
- `timeout 120 make os-host-toolchain-lint` and `timeout 120 make docs-verify`
  exit 0. `timeout 120 make os-shell-pipefail-lint` exits 2 only for the known
  unrelated `pkgs/mosd/apid/ui/verify-ui-policy.sh:82` baseline; both changed
  scripts pass its focused scan.
- PMA-CR local review passes after correcting BusyBox provenance to
  `GPL-2.0-only`; no unresolved in-scope finding remains. Full rootfs, kernel,
  image, QEMU, cold-build, and physical-board checks were not run because the
  expensive-build grant remains zero.

## Alternatives

- Distribution BusyBox packages were rejected because they do not provide the
  deliberately pinned static per-architecture payload/config contract.
- An applet symlink farm was rejected by B0; explicit `/bin/busybox APPLET`
  invocation preserves a smaller and more auditable payload.

## Annotations

- 2026-09-10: Prior user approval recorded from the L3 dispatch. Compatibility
  is explicitly not required during system development unless later requested.
- 2026-09-10: Implementation and bounded verification completed. B2/B3 retain
  ownership of startup and shutdown integration.
