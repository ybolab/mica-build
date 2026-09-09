# Storage

MOS uses three partitions. UEFI boards have ESP/SYSTEM/DATA; cx3576 has
FIRMWARE/SYSTEM/DATA. Only DATA grows to use the medium. SYSTEM contains immutable
signed deployment files, and firmware remains separate from normal OS updates.

> status: shipped — evidence: `boards/x64/board.env`, `boards/virt-arm64/board.env`, `boards/cx3576/board.env`

## Where files belong

| Path | Purpose |
|---|---|
| `/mos/config` | Appliance configuration managed through the API |
| `/mos/apps`, `/mos/containers` | Managed applications and container data |
| `/srv` | Operator files and application data |
| `/home`, `/root` | Persistent user homes backed by `/mos` |
| Selected `/var/lib` leaves | Persistent service state on DATA |
| `/var/tmp` | Bounded disk-backed temporary data |
| `/run`, `/tmp` | Volatile per-boot data |

Identity, credentials and service state are stored under physical DATA/state;
update and lifecycle records use DATA/meta. Those namespaces are managed by the
system. Use the API for configuration rather than editing their internal files.

The `/var` parent tree is read-only. Only explicitly supported leaves are
writable; an arbitrary new `/var` directory fails with EROFS. Logs remain
volatile, so save diagnostic evidence before shutting down a test device.

> status: shipped — evidence: `docs/design/storage.md`, `rootfs/overlay/etc/systemd/system/`

## Capacity and cleanup

All DATA binds share one filesystem. The storage API reports its capacity once,
with directory/project accounting and bind readiness alongside it. Bulk and
disposable writers have byte and inode quotas that preserve measured room for
essential state and metadata. Ordinary services cannot bypass these limits with
`CAP_SYS_RESOURCE`.

A directory reset removes only the selected allowlisted scope and preserves
identity and retained lifecycle/deployment records. OS rollback does not undo
writable application data. Full reflash replaces the current image contents;
it is not a secure erase of every physical sector beyond the image.

> status: shipped — evidence: `pkgs/mosd/mosd/src/storage_status.rs`, `pkgs/mosd/mosd/src/reset.rs`, `rootfs/overlay/usr/lib/mos/mos-data-layout`

## Failure

Missing, read-only or damaged DATA/SYSTEM stops the affected boot path for
explicit recovery. The system does not create default credentials on the
immutable root, reset exhausted counters or silently mount a substitute state
directory. Save serial and image/component identities when reporting a failure.

Physical eMMC durability and board recovery require the cx3576 bench tests;
QEMU and offline checks establish only their stated software behavior.

> status: board-dependent — evidence: `docs/design/uboot-ab-handshake.md`, `docs/task/20260908-2229-file-ab-delivery-x64-first.md`
