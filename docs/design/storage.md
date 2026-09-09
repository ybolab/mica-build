# Storage policy and observation

Every current MOS factory image has three GPT partitions. UEFI uses
ESP/SYSTEM/DATA; cx3576 uses FIRMWARE/SYSTEM/DATA. Their sizes, identities and
roles are declared in `boards/<board>/board.env`. DATA alone grows to the
available medium. Firmware and SYSTEM ranges remain fixed.

## Ownership

| Physical namespace | Exposed paths | Owner and purpose |
|---|---|---|
| SYSTEM | `/mnt/system` and verified root/support mappings | Immutable signed deployments and shared component objects |
| DATA/state | Selected service binds, `/etc/machine-id`, random seed | Device identity, credentials and persistent service state |
| DATA/meta | `/mnt/data/meta` | Native transaction state, catalog checkpoints, firmware receipt and appliance lifecycle records |
| DATA/mos | `/mos`, `/home`, `/root` | Managed applications, configuration, containers and user homes |
| DATA/srv | `/srv` | Operator data |
| DATA/cache, DATA/tmp | Approved cache paths and `/var/tmp` | Bounded disposable disk-backed data |
| Memory | `/run`, `/tmp`, volatile journal | Per-boot runtime state |

The root and var parent skeleton are read-only. There is no whole `/var`,
`/var/lib`, `/var/cache` or `/var/log` bind or overlay. Known service leaves
include `/var/lib/mos`, timesync, networkd, timers and linger. Unit and Quadlet
sources are bound to their existing search paths, then reloaded after DATA is
ready. Netavark definitions use `/mos/containers/networks`.

State/meta are private physical directories. The bound mos state root permits
traversal to networkd's group-readable WireGuard key directory; credential
subdirectories remain mode 0700 and documents 0600. Binding an approved leaf
avoids granting a service access to unrelated physical state namespaces.

## Capacity

Bind mounts share one filesystem and do not create separate capacity totals.
Ext4 project quotas bound bulk and disposable data by both bytes and inodes.
The current initializer reserves 128 MiB and 2048 inodes for state/meta and
filesystem overhead, limits disposable project 101 to 32 MiB/2048 inodes, and
assigns the remaining bounded bulk budget to project 100. Images must include
ext4 quota/project features and matching built-in kernel support.

Service bounding sets remove `CAP_SYS_RESOURCE`, so root services cannot bypass
hard quota limits. The fixed growfs helper retains the capability required by
ext4 resize. Tests exercise production writer privileges and prove state/meta
writes still succeed after bulk/disposable limits are reached. A reserve is
measured containment, not protection against privileged manual changes.

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
