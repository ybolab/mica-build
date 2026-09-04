# RFCT-295 Build the x64 kernel in tree, with its own config

- **status**: in-progress (implementation verified offline; QEMU boot pending)
- **priority**: P1
- **owner**: x64-kernel/session-20260903
- **createdAt**: 2026-09-03 19:21

## Description

x64 ships Debian's generic amd64 kernel. `mos-board-x64` depends on
`linux-image-amd64`, the kernel package's own postinst builds the initramfs
during the compose, and a 150-line klibc shell script in the initrd assembles
the dm-verity root because Debian's kernel has no `CONFIG_DM_INIT`. That makes
x64 the only board whose kernel this repository does not decide, the only board
where `boards/common/mos-required.fragment` is not enforced, and the only board
with a second implementation of the verity boot contract.

Design first: decide whether x64 should build its own kernel from a pinned
upstream source with a reviewed config, the way `boards/cx3576/bsp` does; where
that config lives and how drift is refused; what it must contain; whether an own
kernel keeps an initramfs; and what the change removes. Then implement it if the
design holds, and recommend against it with the evidence if it does not.

## ActiveForm

Designing, then building, the in-tree x64 kernel.

## Acceptance

**Design half.**

- `docs/plan/PLAN-074.md` carries Context, Proposal, Risks, Scope, Alternatives,
  an explicit approval boundary and a separately estimated implementation
  backlog, and answers all six questions the request poses: config location and
  maintenance, the upstream pin, the derived config contents, the initramfs
  decision, what the change removes from the shared kernel floor, and the
  recommend-against fallback.
- `make docs-verify` green.
- If the answer is "recommend against", the plan says so with the evidence and
  nothing is built.

**Implementation half, if the design holds.**

- A composed x64 image boots in QEMU through the existing harness.
- `bash verify/run.sh --verify` green, including the kernel checks.
- `tests/netavark-kernel-config-test.sh` green.
- `/usr/share/mos/manifest.tsv` names the kernel package, and the SBOM carries
  it.

## Dependencies

- **blocked by**: the concurrent kernel-floor extension (eBPF, firewall and
  bridge symbols in `boards/common/mos-required.fragment`) — this task consumes
  its deferred list and must merge it before landing.
- **blocks**: (none)

## Plan

- [PLAN-074](../plan/PLAN-074.md)

## Notes

The index rows for this task and for PLAN-074 are **owed**: this session was
told not to edit `docs/task/index.md`, `docs/plan/index.md` or
`docs/CHANGELOG.md`, because concurrent sessions hold them. `RFCT-295` and
`PLAN-074` were the lowest free identifiers across every worktree of this
project at 2026-09-03 19:21; a concurrent session may have taken the same pair
since.
