# Storage policy and observation

Every current Mica OS factory image has three GPT partitions. UEFI uses
ESP/SYSTEM/DATA; U-Boot boards (cx3576, s905x5m) use FIRMWARE/SYSTEM/DATA. Their sizes, identities and
roles are declared in `boards/<board>/board.env`. DATA alone grows to the
available medium. Firmware and SYSTEM ranges remain fixed.

## Ownership

| Physical namespace | Exposed paths | Owner and purpose |
|---|---|---|
| SYSTEM | `/mnt/system` and verified root/support mappings | At most two signed deployments, descriptors and shared component objects |
| DATA/state | Selected service binds, `/etc/machine-id`, random seed | Device identity, credentials and persistent service state |
| DATA/meta | `/mnt/data/meta` | Native transaction state, catalog checkpoints, firmware receipt and appliance lifecycle records |
| DATA/mos | `/mos`, `/home`, `/root` | Managed applications, configuration, update workspace and user homes |
| DATA/containers | `/mos/containers` | Container images, writable layers, named volumes and network definitions |
| DATA/srv | `/srv` | Operator data |
| DATA/var | `/var` | Persistent service state, caches, logs and temporary files under a shared project limit |
| DATA/cache, DATA/tmp | Internal disposable paths | Share the bounded variable-data project with DATA/var |
| Memory | `/run`, `/tmp`, volatile journal | Per-boot runtime state |

The root remains read-only. DATA/var is bound over all of `/var`; services can
create new state directories without a separate mount per service. On first
boot `mos-seed-var` copies the packaged var template after quota setup, preserving
ownership, modes and symlinks. Later boots retain its content. The protected
`/var/lib/mos` and Bluetooth credential binds remain outside the general var
quota. Unit and Quadlet sources are bound to their existing search paths, then
reloaded after DATA is ready. Netavark definitions use `/mos/containers/networks`.

The `/mos`, `/var` and `/mos/containers` binds use private mount propagation.
Protected state and container child mounts stay at their logical paths; they
must not appear inside the physical DATA tree traversed by reset.

State/meta are private physical directories. The bound Mica OS state root permits
traversal to networkd's group-readable WireGuard key directory; credential
subdirectories remain mode 0700 and documents 0600. Binding an approved leaf
avoids granting a service access to unrelated physical state namespaces.

## Capacity

SYSTEM has a strict two-deployment budget. It contains `deployments`, `roots`
and `kernels`, including authenticated descriptors, hash text and signatures.
Download archives, partial downloads and acquisition state stay in DATA under
`/mos/updates`; logs, user data and application state also remain outside SYSTEM.
Short-lived object publication files are removed by interrupted-install cleanup.

Factory preflight budgets two full payloads with 128 MiB SYSTEM headroom (64 MiB
for UEFI ESP). After formatting SYSTEM, the builder subtracts measured ext4
metadata overhead, reserved blocks and the kernel's internal cluster reserve
before accepting that payload budget. Runtime installation checks actual `f_bavail`, inode
availability and reclaimable allocated blocks, then rechecks free space after
collection. Filesystem metadata and reserved blocks reduce usable capacity, so
partition size alone is not a payload limit. Content IDs share unchanged objects
between deployments. The cx3576 SYSTEM partition remains 1 GiB.

Bind mounts share one filesystem and do not create separate capacity totals.
Project 100 accounts for DATA/mos and DATA/srv; project 102 accounts for
DATA/containers independently. Both projects have zero soft/hard byte and inode
limits, meaning unlimited usage within DATA's available capacity. They retain
project inheritance and usage reporting, with no proportional capacity split.

Project 101 covers DATA/var, cache and tmp together. Its byte limit is one eighth
of DATA capacity, clamped to 32–256 MiB; its inode limit is one eighth of DATA
inodes, clamped to 2048–16384. This bounded variable-data limit is recomputed
after DATA growth. Images include ext4 quota/project features and matching
built-in kernel support. The API reports zero limits for unlimited projects.

Service bounding sets remove `CAP_SYS_RESOURCE`, so ordinary root services
cannot bypass the variable-data limit. The fixed growfs helper retains the
capability needed by ext4 resize. Unbounded system/user/container writers can
fill DATA; project quotas no longer guarantee a free-space reserve for state/meta.

## Startup and failure

Authenticated early boot establishes DATA and machine identity before systemd.
The board's `mos-grow-data` invocation verifies the SYSTEM partition and disk
UUID before passing the physical disk to `systemd-repart`. It uses packaged
partition definitions; only DATA has growth weight. Filesystem growth, namespace
initialization and quota setup precede consumers and bind mounts.

Missing, read-only or corrupt DATA is a shared-data failure. The system does not
create default credentials on the immutable root or blame a root deployment
repeatedly. SYSTEM failure similarly requires explicit recovery. Bounded journal
replay is distinct from a full offline filesystem repair, which boot does not
attempt automatically.

## API and reset

`GET /api/v1/storage/status` reads physical tiers, exposed binds, directory
accounting, device statistics and supported wear observations. Missing or
unobservable values are reported as such. Capacity is counted once for DATA,
not summed again for each bind. The explicit workspace probe creates and removes
one bounded test file under the system-owned update workspace.

Reset operates on allowlisted physical directories under a transaction lock.
It validates directory identity, rejects symlinks and nested mounts, bounds
traversal depth/count/time, syncs removals, and clears durable intent only after
completion. Configuration and application/user data scopes follow the selected
reset tier; machine identity, credentials and deployment/lifecycle records are
preserved as required by the reset contract. Root rollback never promises to
reverse arbitrary writable application data.
