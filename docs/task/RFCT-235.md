# RFCT-235 The podman base at two architectures in one build: MOS_BUILD_BASE_NATIVE

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-28
- **plan**: PLAN-025 (M2 residue, wall 1)

The cx3576 IMAGE build stops at os/pkgs/podman: its Dockerfile's
`FROM --platform=$BUILDPLATFORM ${MOS_BUILD_BASE} AS src` needs the build
base at the HOST architecture while the rest of the build runs at the
target's — one FROM cannot resolve one name to two architectures. The fix is
a MOS_BUILD_BASE_NATIVE build-arg resolved at the host architecture and
carried as a second OCI layout. Newly possible since the architecture-
qualified tag scheme landed (before it there was no amd64 base to resolve to
on a host that had built arm64); deliberately unshipped by RFCT-234 because
proving it costs an arm64 podman/crun/netavark/aardvark-dns compile under
emulation, and the campaign does not ship wiring it cannot measure.

Claiming this task requires a plan whose scope admits os/pkgs/podman. Wall 3
(os/rootfs needs a real host binfmt_misc registration for its smoke run) is
NOT this task and no tagging change reaches it; the booted cx3576 smoke
remains a stated obligation recorded in RFCT-206 section 7.

## Dependencies

- **blocked by**: (none — the tag scheme it needs is on main)
- **blocks**: the cx3576 image build on binfmt-less hosts.
