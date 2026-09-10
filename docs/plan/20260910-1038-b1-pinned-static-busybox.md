# 20260910-1038-b1-pinned-static-busybox B1 pinned static BusyBox boot package

- **status**: implementing
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

## Alternatives

- Distribution BusyBox packages were rejected because they do not provide the
  deliberately pinned static per-architecture payload/config contract.
- An applet symlink farm was rejected by B0; explicit `/bin/busybox APPLET`
  invocation preserves a smaller and more auditable payload.

## Annotations

- 2026-09-10: Prior user approval recorded from the L3 dispatch. Compatibility
  is explicitly not required during system development unless later requested.
