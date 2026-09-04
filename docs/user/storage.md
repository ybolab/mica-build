# Storage

mos manages a fixed, board-declared partition layout; it does not expose a
partition editor, and it answers "where does my data go?" with four tiers,
each defined by what happens if it is lost. Understanding the tiers is most of
what an operator or integrator needs from this page.

## 1. The four tiers

| Tier | Mounted at | Holds | Grows? | Lost when |
|---|---|---|---|---|
| **STATE** | `/mnt/state` (with binds into `/etc` and `/var/lib`) | configuration and identity: settings, credentials, SSH host keys, WiFi configs, pairings | no — small and fixed | reflash only |
| **DATA** | system-owned `/mos` and operator-owned `/srv` | application data, container storage, UI/update artifacts, operator files | **yes** — fills the disk on first boot | reflash only |
| **META** | `/mnt/meta` | update and appliance metadata (RAUC slot status) | no | reflash only |
| **EPHEMERAL** | `/var` | disposable runtime residue: logs, caches | no — fixed size | reflash, **and** routine cleanup |

The root filesystem itself is a read-only, dm-verity-protected squashfs in a
fixed A/B slot; it is never written and never resized. An A/B update writes
only the rootfs and boot slots — every tier above survives it.

> status: shipped — evidence: `docs/design/ro-root.md`, `boards/cx3576/board.env`

## 2. The rules that follow

- **Keep namespaces separate.** Appliance-managed artifacts belong under
  `/mos`; integrator files, scripts, application state and container volumes
  belong under `/srv` (or `/home` and `/root`, whose backing trees live under
  `/mos`). Both namespaces are backed by DATA and survive reboots and updates.
- **Never store anything you want to keep on `/var`.** It is deliberately
  small, aged by daily cleanup rules, and disposable by contract — the build
  fails if anything precious lands there. Storage that "works for months and
  then is gone" is the failure this rule prevents.
- **DATA is shared.** Container images and volumes, custom UI bundles and
  application data draw on one partition. An application that logs without
  rotation starves its neighbours; `podman system df` shows the container
  share.
- **Arbitrary `/etc` edits do not persist.** The supported persistence path is
  the settings tree ([configuration.md](configuration.md)); the deliberate
  STATE-backed exceptions are enumerated in the design record.
- **First-boot growth is one-way.** DATA grows to fill the disk on first
  boot; nothing shrinks it back. After a reflash, blocks beyond the image's
  extent are unreachable rather than erased — the disposal caveat in
  [recovery.md](recovery.md).

Periodic TRIM is enabled for the writable filesystems, and boot-time
filesystem checks cover them.

> status: shipped — evidence: `docs/design/ro-root.md`, `make os-repart-test`

## 3. What you can observe today

`GET /api/v1/storage/status` answers the tiers in one authenticated read,
observed at request time rather than cached: per tier the resolved device, the
partition size, the mount and filesystem, used/free/reserved space with the
percentage the low-space policy is judged against, and the boot-time
filesystem check systemd recorded for it. A tier this board does not have is
reported as absent with the reason rather than omitted, and the booted rootfs
slot is resolved through its verity device so it does not read as unmounted.

Three things beside the tier list are worth knowing before reading one:

- **`/mos` and `/srv` report readiness, not capacity.** They are two binds of
  the single DATA filesystem, so the bytes are counted once against the tier
  and neither bind carries a space object; each reports whether it is mounted,
  whether its source really is the DATA partition, and — for `/mos` — whether
  a write probe succeeded. `/srv` is never probed: it is the operator's
  namespace, and the surface says so rather than passing silently.
- **Low-space pressure is a band, not a number to interpret.** DATA and STATE
  enter `warning` at 80% used and `critical` at 90%, and clear lower, so a
  tier sitting on a threshold cannot flap between two states.
- **Media health is normalized where the device answers and `unsupported`
  where it does not.** eMMC wear is reported as the 10% bucket the JEDEC
  register actually carries — a range, never a single "27% worn" — with the
  raw register beside it; NVMe and SATA report unsupported with the reason,
  because this image ships no SMART reader.

A fsck result is the number the checker exited with, not a boolean, because
that number carries the repair fact: 0 is clean and 1 means errors were
*corrected*. There is no check history — systemd keeps the last invocation
and so does this surface — and a tier with no check unit reports that nobody
has checked it rather than reading as clean.

The ordinary tools still answer on the device — `df` for capacity, `podman
system df` for the container share of DATA, the journal for check output —
and the API is what an operator or an integration reads without a shell.

> status: shipped — evidence: `docs/design/storage.md`, `pkgs/mosd/apid/openapi.json`

## 4. What the device will not do to its storage

There is no partition editor. No format, repartition, resize, mount, unmount
or erase operation exists on the management API, and a build that grew one
fails its own check. Every storage lifecycle decision beyond that is answered
explicitly in the status body rather than left to be inferred from a missing
route, and today every answer is the same one: backup and restore, offline
repair, data-preserving media replacement, a factory reset of the tiers,
secure erase, encryption at rest and removable media are all unsupported. The
design record carries the reason for each; promoting one is a visible change
to that list, not a quiet new endpoint.

Since PLAN-074 the KERNEL both boards ship carries the dm-crypt target and the
cipher an encrypted volume would use. That is a build-time capability and not a
feature: no volume is encrypted, the image ships no tool that could format or
open one, and nothing about the answer above changes. It is provisioned early
only because adding a kernel symbol later costs a rebuild of every board. Read
a symbol list as what it is — encryption at rest remains unsupported, and
promoting it is still the gated decision this page and
`docs/design/security-model.md` section 6 describe.

> status: unsupported

The one storage policy that does bite an operator is the update workspace:
256 MiB of DATA is held for update work, and an install is refused before it
starts when that reservation is gone. It is a reservation, not a quota —
nothing counts or caps per-application or per-container usage, and nothing
stops an application filling DATA once the check has passed.

> status: shipped — evidence: `docs/design/storage.md`, `pkgs/mosd/mosd/src/storage_status.rs`
