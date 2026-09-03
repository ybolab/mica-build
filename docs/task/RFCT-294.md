# RFCT-294 Add eBPF, firewall and bridge symbols to the common kernel floor

- **status**: in_progress
- **priority**: P1
- **owner**: kernel-floor/bkd-yp3us6yw
- **createdAt**: 2026-09-03 19:22

## Description

`boards/common/mos-required.fragment` is the board-independent kernel floor and
says nothing about eBPF or about the firewall back-end. Its only BPF-adjacent
line is the `bpf` entry in `CONFIG_LSM=`, which names the BPF LSM rather than
the eBPF runtime, and cx3576 ships `# CONFIG_BPF_JIT is not set` while `crun`
programs the cgroup-v2 device controller as a BPF program on every container
start.

Add both groups to the floor, make `verify/src/checks-kernel.ts` able to assert
a symbol that has no module (eBPF and the nf_tables family bools are builtin
bools with no `.ko`), and bring both boards up to it. Every candidate symbol is
measured against the config Debian actually ships before it enters the floor: a
requirement one of the two kernels cannot satisfy is not common. Design record
and the per-symbol reasoning: PLAN-073.

The bridge half of the same floor is in scope for the same reason: same-bridge
container traffic is switched at layer 2 and a host firewall cannot see it
without `BRIDGE_NETFILTER`, `NF_TABLES_BRIDGE` and `NF_CONNTRACK_BRIDGE`.

Because x64 is separately scheduled to build its own kernel, every candidate is
also filed into one of three buckets — required now, deferred to the x64 kernel,
or dropped on merit — and the deferred list is a deliverable that task consumes.

Out of scope: shipping `iptables`/`nftables` packages, any firewall policy, any
eBPF-based data path, and building x64's own kernel.

## ActiveForm

Adding the eBPF and firewall kernel floor and bringing both boards to it.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- `boards/common/mos-required.fragment` and `verify/src/checks-kernel.ts` agree,
  proved by a test rather than by reading, and the checker's own test drives the
  new module-less symbol shape RED.
- `bash tests/netavark-kernel-config-test.sh` green, extended where the new
  list overlaps its citations.
- A composed x64 image with `bash verify/run.sh --verify` green, including the
  new checks.
- The cx3576 BSP kernel rebuilt against the new config, a rootfs composed
  against it, and `bash verify/run.sh --verify --board cx3576` green. The
  rebuild also exercises the `CONFIG_RTC_DRV_HYM8563=y` assertion the kernel
  Dockerfile has carried unexercised; report whether it passes.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify`.
- `docs/design/boards.md` §4.1–§4.4 carry the requirement, its per-symbol
  reason, the operator-observable `br_netfilter` asymmetry and the three-bucket
  measurement; `docs/zh/design/boards.md` mirrors all of it in the same commit.
- The deferred-to-x64-kernel list is stated with the reason each symbol was
  deferred, or stated as measured empty with the evidence.
- `CONFIG_DEBUG_INFO_BTF` decided on measured evidence, with the price and the
  recommendation written down.
