# PLAN-063 Adopt the direct development-stage DATA layout

- **status**: completed
- **createdAt**: 2026-09-02 01:33
- **approvedAt**: 2026-09-02 02:14
- **completedAt**: 2026-09-02 02:38
- **relatedTask**: [RFCT-292](../task/RFCT-292.md)

## Context

PLAN-061 introduced `/mos` through a rollback-compatible intermediate layout:
DATA still mounts at `/srv`, `/srv/.mos` binds to `/mos`, and legacy system
names below `/srv` are relative symlinks. That design is correct for fielded
A/B systems but adds a migration program, a layout marker, compatibility
links, collision states and a future capability-gated Phase B.

MOS is still under development. The project policy is now that compatibility
is not a default requirement; it is implemented only when the user explicitly
requests it. The intermediate layout therefore solves a constraint that does
not exist and prevents `/srv` from being a clean user-owned namespace today.

The current implementation is concentrated in:

- all three fstab renderers (`rootfs/build.sh` and the two board packages),
  which mount DATA directly at `/srv`;
- `mos-data-layout`, `mos-data-layout.service` and `mos.mount`, which create and
  bind `/srv/.mos` and migrate four legacy names;
- the system package payload and local-fs enablement;
- the verifier fstab, home/root and fixture models, which resolve `/mos` back
  through `/srv/.mos`;
- current storage, UI, container, application and rootfs documentation.

APID, Podman, home/root seeders and future update/application paths already use
the canonical `/mos/...` names. Their public paths do not need another change.

## Proposal

Adopt the final clean layout immediately, with no migration or compatibility
behavior:

```text
DATA PARTUUID -> /mnt/data       ext4, noatime,x-systemd.growfs
/mnt/data/mos -> /mos           bind, system-owned
/mnt/data/srv -> /srv           bind, user-owned
```

Change every fstab renderer to mount DATA at `/mnt/data`. Keep
`mos-data-layout.service` as a small fail-closed initializer ordered after that
mount; it creates only the two namespace roots and the known `/mos` subsystem
directories with explicit ownership and modes. It performs no rename, copy,
legacy-path lookup, compatibility symlink or layout-version migration.

Change `mos.mount` to bind `/mnt/data/mos` to `/mos` and add an enabled
`srv.mount` binding `/mnt/data/srv` to `/srv`. Both mounts require the layout
initializer and precede `local-fs.target`. Add `/mnt/data` to the immutable
rootfs mountpoints and package both mount units.

Update verifier fixtures and checks so they prove:

- the DATA PARTUUID mounts only at `/mnt/data` and is the only growfs row;
- `/mos` and `/srv` are enabled binds with distinct sources beneath that DATA
  mount;
- `/mos/ui`, container storage and persistent home/root backing resolve through
  `/mnt/data/mos`, never STATE, EPHEMERAL or the immutable root;
- the packed root contains `/mnt/data`, `/mos` and `/srv` mountpoints;
- no current source, test or living documentation treats `/srv/.mos` or the
  compatibility phase as the active layout.

Replace the migration tests with fresh-layout, idempotence, permission,
writability and hostile-symlink tests. Update current English and Chinese
documentation. Preserve PLAN-061/RFCT-291 as historical records, adding only a
supersession annotation rather than rewriting their decision history.

## Risks

- Existing development media will not discover data under `/srv/.mos` or the
  former `/srv/{ui,containers,home,root}` paths. Reflash or explicit manual
  movement is required; this is accepted by the no-compatibility policy.
- Incorrect local-fs ordering could expose empty immutable-root directories or
  start APID/home/container consumers before DATA is ready. Unit dependencies
  and verifier fixtures must cover the complete chain.
- `/mos` and `/srv` share one filesystem and capacity pool even though their
  namespaces are separate. Quota and reservation work remains owned by
  PLAN-049.
- The internal `/mnt/data` path becomes a system implementation detail. Product
  APIs and user documentation must expose `/mos` and `/srv`, not encourage
  direct writes below `/mnt/data`.

## Scope

In scope: fstab generation for both boards and the main image build; DATA and
bind mount units; layout initialization; system package payload/enablement;
verifier fixtures, parity checks and focused shell tests; storage, UI,
container, application and rootfs documentation; supersession records; final
quality gates and commit.

Out of scope: migration of existing media; A/B slot compatibility; API or UI
package-contract changes; new quotas; online updater implementation; moving
small critical STATE data out of `/var/lib/mos`.

## Alternatives

1. **Mount DATA directly at `/mos`.** This is simpler for system data but leaves
   `/srv` either non-persistent or nested inside the system namespace; rejected.
2. **Keep DATA at `/srv` and bind one child to `/mos`.** This removes legacy
   links but still reserves system content inside the user namespace; rejected.
3. **Use two partitions.** It provides physical separation but changes the
   partition layout and imposes fixed capacity boundaries; unnecessary.
4. **Keep PLAN-061 Phase A.** It preserves rollback but the project has no
   compatibility requirement; rejected by the user clarification.

## Annotations

- 2026-09-02: Created after the user clarified that compatibility must not be
  assumed during system development and should be implemented only when
  explicitly requested.
- 2026-09-02: User approved direct implementation of the clean DATA layout.
- 2026-09-02: Delivered the direct `/mnt/data` layout, independent `/mos` and
  `/srv` binds, fail-closed initialization, verifier coverage, package output
  and current English/Chinese documentation. No compatibility path remains in
  current implementation.
