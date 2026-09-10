# Bounded lifecycle ioctl boundary

- **date**: 2026-09-10
- **owner**: B/lifecycle
- **review sunset**: 2026-12-10, or earlier availability of equivalent pinned safe wrappers
- **status**: accepted by L1 at 2026-09-10 12:21 UTC through L2 B
- **campaign**: mos-open-plans-20260910-100408

## Decision

Keep workspace unsafe_code=forbid and all business crates/binaries forbid.
One internal `pkgs/mos-deploy/lifecycle-sys` FFI member uses deny(unsafe_code)
and deny(unsafe_op_in_unsafe_fn), with allowances only on audited, typed wrappers
for watchdog GETSUPPORT/GETTIMEOUT/KEEPALIVE and loop GET_STATUS64/CLR_FD.
SETTIMEOUT or enable-only SETOPTIONS are authorized only if actually needed.
No general ioctl/raw-pointer API, watchdog disable/magic-close, loop configuration,
C library, bindgen, toolchain/dependency refresh or workspace-wide lint waiver.
Every unsafe block documents Linux ABI, initialization, borrowing/lifetime and
kernel writes. x64/aa64 request/layout assertions and harmless errno/FD tests are
required. The safe lifecycle owner imposes deadlines and closes inspection FDs
before final release checks; an ioctl return never proves storage release.

## Evidence and rationale

Pinned BusyBox 1.36.1 watchdog has unbounded feeding, warning-only timeout setting,
unverified writes and fatal-signal magic close; its loop query exposes filename
and offset rather than backing inode/device. Pinned rustix 1.1.4 supplies the
unsafe typed ioctl machinery but no dedicated safe wrappers for these requests.
The native supervisor requires actual watchdog timeout/readback and live loop
identity. PMA-Rust Lock 3 permits this isolated FFI boundary; business policy
remains safe Rust. Exact source evidence and implementation scope are in
[the B3 plan](../plan/20260910-1206-b3-bounded-exitrd-teardown.md).

## Review and removal

B/lifecycle reviews every unsafe site and ABI proof before L2 acceptance. Replace
wrappers with equivalent pinned safe APIs when available, and review no later
than 2026-12-10. Hardware/guest proof remains separate from fixture evidence.
