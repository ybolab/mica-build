# PLAN-061 Establish the `/mos` persistent system namespace

- **status**: completed
- **createdAt**: 2026-09-02 00:25
- **approvedAt**: 2026-09-02 00:31
- **completedAt**: 2026-09-02 01:27
- **relatedTask**: [RFCT-291](../task/RFCT-291.md)

## Context

The growable DATA filesystem currently mounts directly at `/srv`. MOS also
owns several paths inside it: custom UI bundles at `/srv/ui`, container storage
at `/srv/containers/storage`, and the bind-mount backing for `/home` and `/root`
at `/srv/home` and `/srv/root`. This makes `/srv` simultaneously a user data
area and an undocumented system namespace. Future online update downloads,
application artifacts and multiple custom UI versions would add more reserved
names.

`/srv/sys` would preserve that ambiguity and would not actually free `/srv`.
`/var/lib/mos` is already the correct home for small critical state on the
fixed STATE partition, but it is not suitable for update bundles, images or UI
packages: `/var` is fixed-size while DATA is the only filesystem that grows.
A product-owned `/mos` namespace is therefore the clearest public boundary.
It is also a functional prerequisite: online update acquisition, UI package
upload and future application acquisition all need a writable, persistent,
growable workspace before they can be product features. None may silently
stage large bytes on verity root, fixed STATE, EPHEMERAL `/var` or tmpfs.

Changing the DATA fstab row from `/srv` to `/mos` in one release is unsafe for
an A/B appliance. If the new slot migrates DATA and then boot rolls back, the
old slot still mounts the filesystem at `/srv` and expects `/srv/ui`,
`/srv/containers`, `/srv/home` and `/srv/root`. A path cleanup must preserve
that rollback before it can deliver a perfectly clean `/srv`.

## Proposal

### Stable path taxonomy

Adopt these roles:

| Path | Tier and owner | Contents |
|---|---|---|
| `/usr/lib/mos` | immutable rootfs | shipped executables, helpers and package-owned defaults |
| `/etc/mos` | immutable/config overlay | administrator configuration and trust anchors |
| `/run/mos` | tmpfs | boot-scoped runtime state and generated files |
| `/var/lib/mos` | bounded STATE | settings, secrets, APID session/audit state and other small critical records |
| `/mos` | growable DATA, MOS-owned | large retained artifacts managed by the appliance |
| `/srv` | growable DATA, user-owned | files and service data explicitly managed by the operator |

Reserve `/mos` as a whole. It is not a file browser or an extension point.
The path is writable because it is backed by DATA, but the root is not
world-writable: it is `root:root` mode 0755 and each service receives write
permission only on its owned subtree. Mount and writable-readiness checks run
before every system artifact writer. A missing, read-only or full DATA tier is
a named degraded/unavailable state; no daemon falls back to another filesystem.
Create subsystem roots rather than a generic shared staging directory:

```text
/mos/
├── ui/             custom UI packages, installed trees and private staging
├── updates/
│   ├── downloads/  resumable partial online/offline acquisition
│   ├── verified/   complete artifacts awaiting RAUC installation
│   └── staging/    bounded transaction-local work
├── apps/           future catalog artifacts and private package staging
├── containers/     container graphroot
├── home/           backing tree for /home
└── root/           backing tree for /root
```

Each subsystem owns its quotas, temporary names, cleanup and permissions.
Small authoritative metadata remains on STATE when losing it would make DATA
ambiguous; large bytes stay on DATA. `/mos` is not a replacement for every
existing `/var/lib/mos` path.

Readiness is more than `access(W_OK)`: boot verification resolves the mount
source to DATA, refuses symlink substitution, creates and fsyncs a private
probe file in the owning subtree, removes and fsyncs it, and reports free space
and filesystem read-only state. Writers repeat capacity checks for each
transaction and use same-filesystem staging plus atomic rename. The future
updater stores resumable partial data only in `/mos/updates/downloads`, moves a
fully downloaded and authenticated bundle into `verified`, and hands RAUC only
that verified path. Failed or interrupted downloads remain bounded and
reconcilable; they never become installable by filename alone.

### Phase A: rollback-compatible canonicalization

Implement the first release without changing the DATA mountpoint:

- keep DATA mounted at `/srv`;
- create a root-owned `/srv/.mos` and bind it at `/mos`;
- move known MOS-owned trees into `/mos` with same-filesystem atomic renames;
- leave relative compatibility symlinks at the former `/srv/ui`,
  `/srv/containers`, `/srv/home` and `/srv/root` names so an old slot can still
  boot and serve the same bytes;
- switch every new binary, unit and document to the canonical `/mos/...` path;
- record an fsynced layout version only after every step succeeds.

The migration service runs after DATA mounts and before APID, container
storage, home/root binds or update acquisition. It is idempotent: source-only,
destination-only and already-linked states have named outcomes; conflicting
source and destination trees fail closed without deleting either. Temporary
and trash paths are cleaned only when their owner can prove they are not live.

Phase A makes `/mos` the only supported system API immediately, but `/srv` is
not yet physically pristine: `.mos` and rollback compatibility symlinks remain
reserved implementation details. This is the cost of preserving the old slot.

### Phase B: clean user/system split

After both bootable slots understand `/mos`, or as part of a factory/reflash
migration, move to the final layout:

```text
DATA mounted at /mnt/data
/mnt/data/mos  bind-mounted at /mos
/mnt/data/srv  bind-mounted at /srv
```

The verifier must prove `/mos` and `/srv` resolve to distinct directories on
the DATA partition, only DATA carries `x-systemd.growfs`, and neither path can
silently land on verity root, STATE or EPHEMERAL. The migration moves known
system entries into `mos/` and all remaining operator entries into `srv/` by
atomic rename. Compatibility links are removed only after the slot-compatibility
predicate is true. Phase B is the point at which `/srv` becomes completely
user-owned.

The compatibility predicate must be machine-checkable, not a calendar date:
both slot manifests report a release with the new layout capability, or the
device is undergoing an explicitly destructive factory/reflash migration.
PLAN-047's update state is the natural owner of that proof; until it exists,
Phase B stays disabled on field upgrades.

### Verification and delivery

Add negative and positive tests for empty/fresh DATA, each legacy system tree,
arbitrary operator entries, path collisions, partial prior steps, power loss
between renames, repeated execution, old-slot compatibility and Phase-B bind
separation. Update fstab generation, rootfs package payload, systemd dependency
ordering, home/root seed logic, container storage, APID defaults, both board
fixtures and verifier messages. Document recovery before enabling migration.

## Risks

- A one-step clean split would make rollback preserve bytes but change their
  paths. The staged design deliberately accepts temporary compatibility names
  instead of weakening A/B recovery.
- Migration runs as root over persistent user data. Any broad recursive copy,
  overwrite or inferred deletion could lose data. Operations must use explicit
  known roots, same-filesystem rename, no symlink following, fsync and
  collision refusal.
- A full DATA filesystem can prevent creation of layout metadata or new
  staging. The old layout must remain usable when migration cannot start.
- Old slots can create new legacy entries after rollback. Phase A must be
  re-runnable when returning to a new slot and reconcile only named legacy
  system paths; it must never classify an arbitrary name as system-owned.
- `/mos` is appliance-specific rather than FHS-standard. Its narrow purpose is
  large DATA-tier artifacts that cannot fit the standard STATE/EPHEMERAL
  locations; the documented taxonomy prevents it becoming a second `/var`.

## Scope

In scope: `/mos` path contract; rollback-compatible and final DATA layouts;
known `/srv` system-path migration; `/srv` user namespace; mount and service
ordering; container/home/root/custom-UI path consumers; reserved directories
for update and application artifacts; writable/readiness and no-fallback
contract; board/image/verifier tests; migration recovery and current
documentation.

Out of scope: implementing the online updater itself; changing RAUC slot
format; moving small STATE records out of `/var/lib/mos`; application catalog
implementation; changing user-visible `/home` or `/root`; deleting unknown
operator data; running Phase B without a proven compatible-slot condition.

## Alternatives

1. **Reserve `/srv/sys`.** Simpler, but `/srv` remains partly system-owned and
   the name does not distinguish data lifecycles; rejected.
2. **Put everything under `/var/lib/mos`.** FHS-shaped but wrong for this disk
   topology: STATE is fixed at 64 MiB and update/UI/container artifacts are
   unbounded; rejected.
3. **Immediately mount DATA at `/mos` and bind a user subtree to `/srv`.** This
   reaches the clean end state fastest but changes the old slot's paths after
   rollback; available only for factory/reflash migration, not selected as the
   field default.
4. **Bind `/srv/.mos` to `/mos` forever.** Preserves rollback with minimal
   work, but never makes `/srv` completely user-owned; selected only as Phase A.
5. **Add a new partition for `/mos`.** Clean separation but changes the frozen
   partition layout, consumes fixed space and complicates existing-device
   migration; rejected.

## Annotations

- 2026-09-02: Created from the request to unify third-party UI packages,
  online update downloads and other system artifacts under a MOS-owned path
  while opening `/srv` to users.
- 2026-09-02: User approved the default staged migration. Phase A is authorized
  now; Phase B remains gated on compatible-slot proof or factory/reflash.
- 2026-09-02: Delivered and verified rollback-compatible Phase A. Phase B is
  intentionally still gated and is not enabled by this completion.
