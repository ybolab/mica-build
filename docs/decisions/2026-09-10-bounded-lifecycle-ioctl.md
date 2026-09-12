# Bounded lifecycle ioctl boundary

- **date**: 2026-09-10 (extended 2026-09-11)
- **kind**: stack-skill divergence (`/pma-rust` unsafe policy)
- **owner**: `pkgs/mos-deploy` maintainers
- **review sunset**: 2026-12-10, or earlier when equivalent pinned safe wrappers exist
- **status**: accepted

## Decision

The workspace keeps `unsafe_code = "forbid"`, and every business crate and
binary stays unsafe-forbidden. One internal FFI member,
`pkgs/mos-deploy/lifecycle-sys`, uses `deny(unsafe_code)` and
`deny(unsafe_op_in_unsafe_fn)` with allowances only on audited, typed wrappers
for these requests:

| Area | Requests |
|---|---|
| Watchdog | `GETSUPPORT`, `GETTIMEOUT`, `KEEPALIVE`; `SETTIMEOUT` and enable-only `SETOPTIONS` only where actually needed |
| Loop | `GET_STATUS64`, `CLR_FD`, `LOOP_CTL_GET_FREE`, `LOOP_SET_FD`, read-only `LOOP_SET_STATUS64` |
| Device mapper (ABI 4.0) | `DM_DEV_STATUS`, `DM_TABLE_STATUS` with `DM_STATUS_TABLE_FLAG`, `DM_DEV_REMOVE`, `DM_DEV_CREATE`, read-only single-verity `DM_TABLE_LOAD`, `DM_DEV_SUSPEND` (resume) |

Signature payloads are inserted with the safe `linux-keyutils` wrapper
(Apache-2.0 OR MIT) into the startup worker's process keyring and revoked after
table loading.

Not permitted: a generic ioctl or raw-pointer API, watchdog disable or magic
close, arbitrary request numbers, remove-all, forced or deferred removal, a C
library, `bindgen`, `libdevmapper`, or a workspace-wide lint waiver.

## Rules for every wrapper

- Each unsafe block documents the Linux ABI, initialization, borrowing and
  lifetime, and what the kernel writes.
- x64 and aarch64 request-number and layout assertions, plus harmless errno and
  descriptor tests, are required.
- Buffers are initialized and aligned; UAPI version, size, flag, count and
  offset checks, NUL termination and bounded response growth are mandatory.
  `DM_DEV_STATUS` responses are exactly 305 bytes; `DM_TABLE_STATUS` next
  offsets are relative to the first target.
- Only read-only active tables whose device, name, UUID, event number and
  target count match are accepted. Removal selects the freshly checked UUID on
  the same control descriptor; mutating requests are never retried.
- An ioctl return never proves storage release. The safe lifecycle owner
  imposes deadlines, closes inspection descriptors and proves disappearance
  afterwards; an `EBUSY` loop reservation race grants no ownership.

## Rationale

BusyBox's watchdog has unbounded feeding, warning-only timeout setting and
fatal-signal magic close, and its loop query exposes a filename rather than the
backing inode and device. The pinned `rustix` provides the unsafe ioctl
machinery but no safe wrappers for these requests. The native supervisor needs
real watchdog timeout readback and live loop and mapping identity.

## Review and removal

Every unsafe site is reviewed with its ABI proof before merge. Replace the
wrappers when equivalent pinned safe APIs exist, and review no later than
2026-12-10. Fixture evidence does not replace guest or hardware acceptance.
