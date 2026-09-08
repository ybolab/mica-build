# 20260908-1712-p1-writable-path-audit P1-B: audit the enabled writers and produce the writable-path contract

- **status**: in_progress
- **priority**: P1
- **owner**: l3/iku9ubdw
- **createdAt**: 2026-09-08 17:12
- **relatedPlan**: [20260908-1428-file-ab-signed-components](../plan/20260908-1428-file-ab-signed-components.md)

## Description

P1-B of the file-based A/B plan. Section 5 of that plan states an initial path
contract and then says it "is not proof that every shipped writer has been
audited": P1 and P5 must record each remaining writer's exact path, owner,
persistence need, write/rename behaviour, initialization, dependency, capacity
limit and reset treatment, and must resolve the `systemd-random-seed` question
without exposing all of `/var/lib/systemd`.

This record is that audit. It produces the writer contract (section 5), the
negative list (section 6), the random-seed resolution (section 7), the
container-network destination and its reset rule (section 8), the `/var/tmp`
resolution (section 9), what P5 must change beyond the leaf mounts (section 10),
and the board differences (section 11).

Acceptance: every contract row sourced observed / declared / inferred; the
negative list covers the whole shipped `/var`; the random-seed answer proven
with the real unit for start, shutdown write and reboot survival; `make
docs-verify` green from a `git archive` into an empty directory.

## ActiveForm

Auditing the enabled writers and producing the writable-path contract.

## Dependencies

- **blocked by**: [20260908-1423-file-ab-signed-components](20260908-1423-file-ab-signed-components.md)
- **blocks**: (none)

## Notes

- This task changes no layout, fstab, repart, tmpfiles, unit or overlay file.
  It produces what P5 consumes.
- `docs/task/index.md` is not edited here; L1 owns it and indexes this record.
- Amended after the user's 2026-09-08 17:19 direction: **x64 under QEMU is the
  reference target**. Every runtime proof below is an x64 measurement; cx3576
  and virt-arm64 differences are listed separately in section 11, as declared
  or inferred, never folded into the x64 result.

## 1. What was measured, and how

**The subject is the composed factory root, not the source tree.** The unit
files, tmpfiles rules and `/var` tree a device gets come from thirteen
producers plus the Debian base, so a source-tree grep answers a different
question. The roots below were read out of `_out/<board>/factory-root.oci`, the
OCI export `rootfs/compose/90-pack.Dockerfile` writes.

| Board | Root | Built here | Runtime proofs |
|---|---|---|---|
| x64 | `localhost/mos-factory-root:x64`, `linux/amd64` | yes, at `giteb036eedf5b4-1` | **yes** — three QEMU boots through OVMF |
| cx3576 | `localhost/mos-factory-root:cx3576`, `linux/arm64` | yes | no — declared/inferred only (section 11) |
| virt-arm64 | `localhost/mos-factory-root:virt-arm64`, `linux/arm64` | yes | no — declared/inferred only (section 11) |

**Evidence classes.** Every row in sections 5 and 6 carries one:

- **observed** — measured in a running x64 guest this session;
- **declared** — read out of a shipped unit file, configuration file, tmpfiles
  rule or packaging record in the composed root;
- **inferred** — neither: derived from a binary's dynamic symbols, or from the
  demonstrated absence of a writer. Marked so P5 knows what is still owed a
  measurement.

**The runtime-write observation needs no strace,** which the image does not
ship. Every file in the factory `/var` tree carries the build's
`SOURCE_DATE_EPOCH` (`2020-01-01`) and the assembler fills EPHEMERAL from it
with `mkfs.ext4 -d`, so *anything under `/var` with a timestamp after that epoch
was written at runtime*. `find /var -xdev \( -newermt 2021-01-01 -o -newerct
2021-01-01 \)` in the guest is a complete enumeration of the boot's writers, not
a sample. The negative direction is measured too: the probe remounts `/var`
read-only and restarts the services, so "this path needs no writable backing" is
tested rather than asserted.

The probe is a throwaway harness seeded into STATE with the tree's existing
`tools/qemu-seed-state.sh` and booted with the tree's existing
`pkgs/mosd/tests/apid-api/src/qemu.ts`. It ships in no image and is committed
nowhere; section 12 records it verbatim so the measurement can be repeated.

## 2. Where this contract lives, and why

**In this task record, not in `docs/design/`.** `docs/design/ro-root.md` §4 is
the *current* writable-path design — five partitions, a disposable `/var` on
EPHEMERAL, `mos-seed-var` — and its own audit table is what this record
supersedes. A second `docs/design/` page describing a layout that no code
implements would put two design documents in contradiction with no gate able to
catch it: `docs/verify-index.sh` asserts membership in `docs/README.md` and
`docs/verify-links.sh` asserts link targets; neither can see that two pages
disagree. The plan already assigns the design-document rewrite to P10 ("update
active design/user docs"), which is when `ro-root.md` §4 stops being true and
can be replaced by this contract. P5's entry points — the plan's P1 row and the
umbrella task — both reach this record.

## 3. Three facts that frame the contract

**`/var` in the shipped image is already almost empty.** The pack stage moves
the built tree to `/usr/share/factory/var` and leaves `/var` holding one child:

```text
/var
/var/tmp
```

The tree a running device sees is that factory copy restored onto EPHEMERAL,
either by the assembler (`mkfs.ext4 -d`, the normal case) or by
`mos-seed-var.service` after a wipe. The whole `/var` universe is **53 paths,
identical on x64 and virt-arm64, plus `/var/lib/bluetooth` on cx3576** — small
enough to audit exhaustively, which sections 5 and 6 do.

**Every `/var` bind target is absent from the read-only image.** Measured on all
three roots:

```text
present  /etc/ssh  /etc/hostname  /etc/containers/systemd
present  /usr/local/lib/systemd/system  /mos  /srv  /home  /root
present  /mnt/state  /mnt/data  /mnt/meta  /var/tmp
ABSENT   /var/lib/mos  /var/lib/bluetooth  /var/lib/systemd/timesync
ABSENT   /var/lib/systemd/random-seed  /var/lib/systemd/rfkill
ABSENT   /var/lib/systemd/linger  /var/lib/containers  /var/lib/wtmpdb
```

Every `/etc` bind target exists in the image, because `/etc` is already
read-only and a mount point there has always had to be baked in. No `/var` bind
target does, because `/var` is writable today: `systemd` creates a `.mount`
unit's `Where=` directory itself, and `mos-seed-var` restores the rest. **Under
a read-only `/var` neither mechanism is available, so P5 must bake every mount
point into the squashfs.** This is the single largest build change the audit
produces and it is invisible from the source tree.

**The package manager and the log daemons are already gone.** There is no
`/var/lib/dpkg`, `/var/lib/apt`, `/var/cache/apt` or `/var/cache/debconf` in the
shipped tree; the purge removed them, so the plan's "do not add writable apt,
dpkg, debconf or ldconfig cache directories merely because packaging left paths
behind" has nothing to reconcile for the first three. No `cron`, `anacron`,
`atd`, `rsyslogd` or `logrotate` binary is installed — only orphan configuration
(`/etc/cron.daily/dpkg`, `/etc/logrotate.d/*`) that nothing reads. Exactly two
timers ship enabled: `fstrim.timer` (reads only) and
`systemd-tmpfiles-clean.timer`. `dpkg-db-backup.timer` appears in the packaging
records but ships no unit file and nothing enables it, so `/var/backups` has no
writer.

## 8. The container-network destination

**Measured today.** `/etc/containers/storage.conf` puts Podman's graph on
`graphroot = "/mos/containers/storage"` and its runroot on `runroot =
"/run/containers/storage"`. `/etc/containers/containers.conf` separately puts
the network definitions on `network_config_dir = "/var/lib/containers/networks"`.
`/var/lib/containers` does not exist anywhere in the shipped tree — not in the
image, not in the factory `/var` — so Podman creates it on the first `podman
network create`, on the disposable EPHEMERAL partition, beside nothing else it
owns. `netavark`'s only `/run` paths are `/run/sysctl.d/10-netavark-*` and
`/run/user/`; it holds no other persistent state.

The `containers.conf` comment explaining the choice is already stale: it says
"`/var/lib/containers` sits on the VAR partition beside the storage graph", and
the storage graph moved to `/mos/containers/storage`. The two are not beside
each other today.

**The change.** `network_config_dir = "/mos/containers/networks"`. This is a
configuration edit, not a mount: `/mos` is already a directory bind from
`/mnt/data/mos`, established by `mos-data-layout.service` and `mos.mount` before
any container starts, so the network definitions inherit that dependency and
need no `/var/lib/containers` mount at all. It also reunites the graph and the
network definitions under one owner, which is what the stale comment claimed was
already true.

**Reset retention, stated.** `/mos/containers` is in `APPLICATION_DIRS` in
`pkgs/mosd/mosd/src/reset.rs`, so:

| Reset tier | Effect on `/mos/containers/networks` |
|---|---|
| Tier 1 — configuration | **retained.** Tier 1 clears `/mos/config` only. |
| Tier 2 — application | **removed**, together with `/mos/containers/storage` and with the STATE Quadlet units in `/mnt/state/quadlet` that reference the networks. |
| Tier 3 — first boot | **removed**; `/mos` is re-seeded to `SYSTEM_SKELETON`, which lists `containers` as a directory to empty rather than delete. |

Tier 2 removing the networks *with* the Quadlet units that name them is the
property worth keeping: a network definition surviving the container payload
that used it is a dangling reference, and a Quadlet unit surviving its network
is a boot-time failure loop. Both are already covered because
`STATE_APPLICATION_DIRS` clears `quadlet` in the same tier. No new reset rule is
needed; the move brings the networks *into* an existing scope rather than
inventing one.

Disposable-data cleanup must not touch it: container networks are application
state, not cache or temporary data, and section 5 gives them no cache or
temp classification.
