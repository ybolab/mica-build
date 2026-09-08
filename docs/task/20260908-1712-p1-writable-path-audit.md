# 20260908-1712-p1-writable-path-audit P1-B: audit the enabled writers and produce the writable-path contract

- **status**: completed
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

This record is that audit. It produces the writer contract (section 4), the
negative list (section 5), the random-seed resolution (section 6), the
container-network destination and its reset rule (section 7), the `/var/tmp`
resolution (section 8), what P5 must change beyond the leaf mounts (section 9),
the board differences (section 10), and four findings the audit surfaced that
are not P5's to fix (section 11).

Acceptance: every contract row sourced observed / declared / inferred; the
negative list covers the whole shipped `/var`; the random-seed answer proven
with the real unit for start, shutdown write and reboot survival; `make
docs-verify` green from a `git archive` into an empty directory.

## ActiveForm

Completed the enabled-writer audit and the writable-path contract.

## Dependencies

- **blocked by**: [20260908-1423-file-ab-signed-components](20260908-1423-file-ab-signed-components.md)
- **blocks**: (none)

## Notes

- This task changes no layout, fstab, repart, tmpfiles, unit or overlay file.
  It produces what P5 consumes. The only code it adds is the observation
  harness in `tests/p1-writable-path-audit/`, which is in no producer's
  `BUILD_CONTEXTS` and in no `rootfs/compose` Dockerfile context, so it cannot
  reach an image.
- `docs/task/index.md` is not edited here; L1 owns it and indexes this record.
- Amended after the user's 2026-09-08 17:19 direction: **x64 under QEMU is the
  reference target**. Every runtime proof is an x64 measurement; cx3576 and
  virt-arm64 differences are listed separately in section 10, as declared or
  inferred, never folded into the x64 result.

## Validation

```sh
# static half (any board with a composed root in _out/)
bash tests/p1-writable-path-audit/extract-root.sh x64
bash tests/p1-writable-path-audit/audit-root.sh  x64

# runtime half
MOS_BOARD=x64 bash rootfs/build.sh && bash build/run.sh --mkimage-uefi --board x64
MOS_BOARD=x64 bun run pkgs/mosd/tests/apid-api/src/qemu.ts --prepare-only
bash tests/p1-writable-path-audit/boot.sh observe   observe
bash tests/p1-writable-path-audit/boot.sh candidate candidate

# reboot survival, read off the disk with the guest powered down
bash tests/p1-writable-path-audit/read-data.sh /p1-audit.log /p1-random-seed

make docs-verify
```

## 1. What was measured, and how

**The subject is the composed factory root, not the source tree.** The unit
files, tmpfiles rules and `/var` tree a device gets come from thirteen
producers plus the Debian base, so a source-tree grep answers a different
question. The roots below were read out of `_out/<board>/factory-root.oci`, the
OCI export `rootfs/compose/90-pack.Dockerfile` writes.

| Board | Root | Built here | Runtime proofs |
|---|---|---|---|
| x64 | `localhost/mos-factory-root:x64`, `linux/amd64` | yes, at `giteb036eedf5b4-1` | **yes** — QEMU boots through OVMF |
| cx3576 | `localhost/mos-factory-root:cx3576`, `linux/arm64` | yes | no — declared/inferred only (section 10) |
| virt-arm64 | `localhost/mos-factory-root:virt-arm64`, `linux/arm64` | yes | no — declared/inferred only (section 10) |

**Evidence classes.** Every row in sections 4 and 5 carries one:

- **observed** — measured in a running x64 guest this session;
- **declared** — read out of a shipped unit file, configuration file, tmpfiles
  rule or packaging record in the composed root;
- **inferred** — neither: derived from a binary's dynamic symbols, or from the
  demonstrated absence of a writer. Marked so P5 knows what is still owed a
  measurement.

**The runtime-write observation needs no strace,** which the image does not
ship. Every file in the factory `/var` tree carries the build's
`SOURCE_DATE_EPOCH` (`2020-01-01`), so anything under `/var` with a later
**mtime** was written at runtime, and `find /var -xdev -newermt 2021-01-01` in
the guest is a complete enumeration of that boot's writers rather than a sample.

> **ctime is not usable for this and the first run got it wrong.** The
> assembler builds EPHEMERAL with `mkfs.ext4 -d`, which stamps every inode's
> ctime at image build time, so `-newerct` matched all 53 factory paths and
> drowned the seven that were actually written. The probe now tests mtime only
> and prints it. The corrected result is section 4's observed column.

The negative direction is measured too: the probe remounts `/var` read-only and
restarts the services, so "this path needs no writable backing" is tested rather
than asserted.

**x64's amd64 pool was rebuilt at this tree's stamp** — thirteen producers plus
`build-env/deb/repo.sh`, because `make os-debs` refuses in this worktree without
the s905x5m BSP. The rootfs was composed on a private `docker-container` buildx
builder: on the `default` docker driver the composer chains stages through the
daemon-global `mos-rootfs-stage:x64-*` tags, which `rootfs/README.md:771`
records as producing "a complete, plausible root blended from two trees" when
two worktrees build at once — and a sibling agent held a live builder on this
daemon throughout.

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
the built tree to `/usr/share/factory/var` and leaves `/var` holding one child,
`/var/tmp`. The tree a running device sees is that factory copy restored onto
EPHEMERAL, either by the assembler (`mkfs.ext4 -d`, the normal case) or by
`mos-seed-var.service` after a wipe. The whole `/var` universe is **53 paths,
identical on x64 and virt-arm64, plus `/var/lib/bluetooth` on cx3576** — small
enough to audit exhaustively, which sections 4 and 5 do.

**Every `/var` bind target is absent from the read-only image.** Measured on all
three roots with `audit-root.sh`:

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
target does, because `/var` is writable today: systemd creates a `.mount` unit's
`Where=` directory itself, and `mos-seed-var` restores the rest. **Under a
read-only `/var` neither mechanism is available, so P5 must bake every mount
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

## 4. The writer contract

Every path that needs a writable backing under the three-partition layout. Rows
1–14 are the x64 set; board-only rows are in section 10.

### 4.1 Leaf table — what P5 mounts

| # | Runtime path | DATA source | Mechanism | Owner (unit / binary) | Ev |
|---|---|---|---|---|---|
| 1 | `/var/lib/mos` | `state/mos` | dir bind | `mosd.service`, `apid.service` (`StateDirectory=mos/apid`) | observed |
| 2 | `/etc/ssh` | `state/ssh` | dir bind | `mos-seed-state.service`, `sshd-keygen.service`, mosd sshd reconciler | observed |
| 3 | `/etc/hostname` | `state/hostname` | **file** bind | `systemd-hostnamed.service` via mosd's hostname reconciler | observed |
| 4 | `/var/lib/systemd/timesync` | `state/timesync` | dir bind | `systemd-timesyncd.service` (`StateDirectory=systemd/timesync`) | observed |
| 5 | `/usr/local/lib/systemd/system` | `state/systemd-units` | dir bind | operator / mosd unit reconciler | observed |
| 6 | `/etc/containers/systemd` | `state/quadlet` | dir bind | operator / Quadlet generator | declared |
| 7 | **`/var/lib/systemd/random-seed`** | `state/random-seed` | **file** bind | `systemd-random-seed.service` | see §6 |
| 8 | `/mos` | `mos/` | dir bind | mosd, apid, podman graph, update workspace | observed |
| 9 | `/srv` | `srv/` | dir bind | operator payloads | observed |
| 10 | `/home` | `mos/home` | dir bind | `mos-seed-home.service`, operator | observed |
| 11 | `/root` | `mos/root` | dir bind | root shell | observed |
| 12 | `/var/lib/systemd/linger` | — see §9 | dir, image | `systemd-logind.service` (`StateDirectory=systemd/linger`) | observed |
| 13 | `/var/lib/systemd/timers` | — see §9 | dir, image | `fstrim.timer` persistent stamp | observed |
| 14 | `/var/tmp` | — see §8 | dir, image | `PrivateTmp=yes` services | observed |

`/etc/shadow` → `/run/mos/shadow` and `/etc/resolv.conf` →
`/run/systemd/resolve/stub-resolv.conf` stay image symlinks into tmpfs; they are
deliberate and need no DATA backing. `/etc/machine-id` is a read-only tmpfs bind
systemd establishes itself (observed: `MNT /etc/machine-id tmpfs[/machine-id]
tmpfs ro`).

### 4.2 Requirements table — what each leaf owes

| # | Persistence | Write / rename behaviour | Initialization | Ordering dependency | Capacity | Reset |
|---|---|---|---|---|---|---|
| 1 | device lifetime; credentials | temp sibling + `rename` (`fswrite.rs::write_via_rename`) — **must be a directory** | dir must exist in image; contents created by mosd | before `mosd.service`, `apid.service` (their `RequiresMountsFor=`) | small; settings + apid state | tier 3 re-seeds; tiers 1–2 keep |
| 2 | device lifetime; host keys | `cp -an` + `ssh-keygen` create new files — **directory** | seeded by `mos-seed-state.service` from the image copy | before `ssh.service` | ~600 KiB, dominated by `moduli` | never cleared |
| 3 | device lifetime | **in-place write through the mount-point inode**; `rename` onto it is `EBUSY` — `fswrite.rs` already implements this rule | file must exist in image; seeded from the image's `/etc/hostname` | before `mos-apply-hostname.service` | one line | tier 3 re-derives from identity |
| 4 | device lifetime; clock floor | `clock` file rewritten every `SaveIntervalSec=60` | **dir must be created in the image** — absent from the factory tree today, systemd creates it only because `/var` is writable | `Before=systemd-timesyncd.service` | one empty file | never cleared |
| 5 | device lifetime | operator drops unit files | empty in image; `mos-seed-state.service` deliberately does not seed it | before `local-fs.target` | small | tier 2 clears |
| 6 | device lifetime | operator drops Quadlet files | empty in image | before `local-fs.target` | small | tier 2 clears |
| 7 | across reboot | see §6 | see §6 | see §6 | 32 bytes measured | never cleared |
| 8 | device lifetime; bulk | application writes | `mos-data-layout.service` skeleton | before `mos.mount` | shared bulk project quota with `srv/` | tiers 1–3 per `reset.rs` |
| 9 | device lifetime; bulk | operator writes | `mos-data-layout.service` | before `srv.mount` | shared bulk project quota | not cleared |
| 10 | device lifetime | operator writes | `mos-seed-home.service` | after `mos.mount` | bulk | not cleared |
| 11 | device lifetime | root shell writes | `mos-seed-root.service` | after `mos.mount` | bulk | not cleared |
| 12 | none | `StateDirectory=` creates it at logind start | **ship an empty dir in the image** — see §9 | — | empty on an appliance with no lingering users | n/a |
| 13 | none needed | `stamp-<timer>` touch files | **ship an empty dir**, or accept the timer losing persistence | — | one 0-byte file per persistent timer | n/a |
| 14 | none | `PrivateTmp=` per-service subdirectories | dir already in image | — | see §8 | tmpfiles ages at 10d |

Rows 12 and 13 are the two the plan's initial table does not mention and that
only a boot reveals: both were **observed created at runtime** on x64
(`/var/lib/systemd/linger`, `/var/lib/systemd/timers/stamp-fstrim.timer`), and
neither exists in the factory `/var`.

## 5. The negative list

Every remaining path the factory image ships under `/var`, with the evidence
that it needs no writable mount. *A directory's presence in the factory image is
not evidence that it needs to be writable* — this is that statement discharged
path by path.

| Path | Why no writable backing | Ev |
|---|---|---|
| `/var/run` → `/run`, `/var/lock` → `/run/lock` | image symlinks; the plan keeps them as symlinks | declared |
| `/var/backups` | `dpkg-db-backup.timer` ships no unit file and nothing enables it | declared |
| `/var/cache/adduser` | `adduser` runs at build time only; no runtime caller | inferred |
| `/var/cache/ldconfig` | `ldconfig.service` writes `/etc/ld.so.cache` first, which is read-only — see §11 | declared |
| `/var/cache/private`, `/var/lib/private`, `/var/log/private` | `DynamicUser=` roots; the only unit setting it is `capsule@.service`, an uninstantiated template | declared |
| `/var/lib/dbus/machine-id` | symlink to `/etc/machine-id`; never written | observed |
| `/var/lib/misc` | no writer in the shipped set | inferred |
| `/var/lib/pam/*` | written by `pam-auth-update` at build time | declared |
| `/var/lib/shells.state` | written by `update-shells` at build time | declared |
| `/var/lib/systemd/catalog/database` | `journalctl --update-catalog` — see §11 | declared |
| `/var/lib/systemd/coredump` | `systemd-coredump` is not installed; `kernel.core_pattern=core` dumps into the process CWD | declared |
| `/var/lib/systemd/deb-systemd-helper-enabled`, `…-user-…` | dpkg-time enablement records | declared |
| `/var/lib/systemd/ephemeral-trees` | no `RootImage=` or portable service ships | inferred |
| `/var/lib/systemd/network` | `systemd-networkd-persistent-storage.service` writes here, but nothing persistent is required; it is empty after a boot | observed |
| `/var/lib/systemd/pstore` | `systemd-pstore.service` runs and writes nothing without pstore content | observed |
| `/var/lib/ucf/*` | `ucf` runs from maintainer scripts only | declared |
| `/var/lib/wtmpdb/wtmp.db` | dangling symlink to `../../log/wtmp.db`, which never appears — see §11 | observed |
| `/var/local`, `/var/opt`, `/var/mail`, `/var/spool`, `/var/spool/mail` | empty, no writer; `pam_mail.so` only stats the spool | declared |
| `/var/log/bootstrap.log` | debootstrap artefact, never reopened | inferred |
| `/var/log/btmp`, `/var/log/lastlog` | no `pam_lastlog`, `pam_lastlog2` or `pam_wtmpdb` in any `/etc/pam.d` file; both stayed 0 bytes across a boot with two SSH sessions | observed |
| `/var/log/journal` | journald `Storage=volatile`; the journal never lands on disk | declared |
| `/var/log/runit/ssh` | openssh packaging leftover; no runit is installed | declared |
| `/var/log/README` | symlink into `/usr/share/doc` | declared |
| `/var/log/wtmp` | **the one exception** — see §11; it grew to 768 bytes | observed |
| `/var/.updated`, `/etc/.updated` | `systemd-update-done` — see §11 | observed |

## 6. The random-seed resolution

**The plan's premise needed correcting first.** The brief describes the unit as
writing "one file with atomic replacement". The shipped binary does not. Its
dynamic-symbol table (systemd 257.13, `usr/lib/systemd/systemd-random-seed`)
imports `open64`, `ftruncate64`, `loop_write_full`, `fsync_full`, `fsetxattr`,
`fremovexattr` and `mkdirat_parents`, and **no `rename`, `renameat`, `linkat`,
`mkostemp` or any other temp-file primitive**. It writes through the existing
inode. That single fact decides the design, because the plan's warning — "do
not assume a file bind mount supports replacing the mount-point inode" — is
about a writer that renames, and this one does not.

The tree already knows this rule. `pkgs/mosd/mosd/src/fswrite.rs` documents it
for `/etc/hostname`, the one file bind mos ships today: *"rename(2) onto it
fails with EBUSY because it is a mount point"*, so that path is written through
the existing inode while directory-backed paths get the temp-sibling-and-rename
treatment. The random seed belongs in the first category.

**The resolution: a file bind mount, and nothing else.**

```text
/mnt/data/state/random-seed   ->  /var/lib/systemd/random-seed   (bind, file)
```

- the mount point is an **empty 0600 file baked into the immutable image** — it
  is absent from the factory `/var` today, so this is a new build-time artefact;
- the mount unit is `var-lib-systemd-random\x2dseed.mount`, the name
  `systemd-escape -p --suffix=mount /var/lib/systemd/random-seed` produces
  (measured in the guest);
- **no drop-in and no ordering edit is required.** The shipped unit already
  carries `RequiresMountsFor=/var/lib/systemd/random-seed`, and systemd resolves
  that onto the leaf mount by itself.

This is why the plan's insistence on a bind rather than a symlink matters: a
symlink would supply no mount unit for `RequiresMountsFor=` to find, and the
unit could start before DATA was mounted.

**Proven with the real unit on x64 under QEMU.** Measured, not read:

| Claim | Evidence |
|---|---|
| the leaf mount is DATA-backed | `BINDMNT /var/lib/systemd/random-seed /dev/vda9[/p1-random-seed] ext4 rw` |
| `/var` is genuinely read-only | `VARMNT /var /dev/vda8 ext4 ro,noatime`; a write to `/var/lib/systemd` was refused |
| systemd finds the leaf mount | `ESCAPED=var-lib-systemd-random\x2dseed.mount`; `SEEDMOUNTUNIT … loaded active mounted`; `RMF=/var/lib/systemd/random-seed`; `RSEEDAFTER "var-lib-systemd-random\x2dseed.mount"` |
| **shutdown write** (`ExecStop=save`) | `stop rc=0`, `success 0 inactive`; content changed `f66aebaa01d59892` → `597431c459b38981` |
| **the mount-point inode is not replaced** | `after stop: MP ino=35 was=35`, and `BINDAFTERSAVE` still shows the bind — a renaming writer would have detached it |
| **start** (`ExecStart=load`) | `start rc=0`, `success 0 active`; content changed `597431c459b38981` → `5aef1fc8fd9ff4af` |
| **reboot survival** | measured from the disk after the guest powered down, with `read-data.sh`: DATA still holds `/p1-random-seed`, **inode 35** — the same inode recorded at bind time — mode 0600, size 32, content `a1b0da94d99375ad…`, which differs from the `5aef1fc8fd9ff4af` the probe recorded as pre-shutdown. The shutdown `ExecStop=save` wrote new bytes **through the mount point onto DATA**, and they survived the power cycle |

Reboot survival is measured from the *host*, not from inside a later guest, and
that is the stronger form: after boot 2 powered down, boots that followed had no
bind in place, so their `systemd-random-seed` wrote to the real
`/var/lib/systemd/random-seed` on EPHEMERAL and left the DATA file alone. What
`read-data.sh` reads is therefore exactly the bytes boot 2's shutdown save
wrote, still on DATA, in the same inode.

The file is 32 bytes, which is `/proc/sys/kernel/random/poolsize / 8` on this
kernel — the capacity limit for row 7 is fixed by the kernel, not a policy
choice.

**Rejected alternatives, with the reason each fails.** Exposing all of
`/var/lib/systemd` is what the plan forbids, and it would additionally shadow
the image-provided `catalog/database` and `deb-systemd-helper-enabled` trees.
A symlink loses the mount dependency. Masking the unit loses the entropy
carry-over across reboots for no gain, since the file bind costs one mount unit.

## 7. The container-network destination

**Measured today.** `/etc/containers/storage.conf` puts Podman's graph on
`graphroot = "/mos/containers/storage"` and its runroot on
`runroot = "/run/containers/storage"`. `/etc/containers/containers.conf`
separately puts the network definitions on
`network_config_dir = "/var/lib/containers/networks"`. `/var/lib/containers`
does not exist anywhere in the shipped tree — not in the image, not in the
factory `/var` — so Podman creates it on the first `podman network create`, on
the disposable EPHEMERAL partition, beside nothing else it owns. `netavark`'s
only `/run` paths are `/run/sysctl.d/10-netavark-*` and `/run/user/`; it holds no
other persistent state.

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
inventing one. Disposable-data cleanup must not touch it: container networks are
application state, not cache or temporary data, and section 4 gives them no
cache or temp classification.


## 8. `/var/tmp` and `PrivateTmp=`

**Who asks for it.** Nine enabled units set `PrivateTmp=`, and the shipped
systemd already answers the question for two of its own:

```text
PrivateTmp=yes           apid, mosd, mos-mqtt-broker, mos-mqttd,
                         systemd-hostnamed, systemd-localed,
                         systemd-logind, systemd-timedated
PrivateTmp=disconnected  systemd-resolved, systemd-timesyncd
```

`PrivateTmp=disconnected` is systemd 256+'s "private tmpfs, do not touch the
host tree" mode, and `libsystemd-core-257.so` carries both mode names. Upstream
already uses it for the two units that must survive an early or hostile `/var`.

**Observed on x64, with `/var` writable (the boot's own state):** exactly three
`/var/tmp/systemd-private-<machine-id>-<unit>-<random>` directories, for
`mosd.service`, `systemd-hostnamed.service` and `systemd-logind.service`. The
`connected` mode does use the host's `/var/tmp`.

**Observed with `/var` remounted read-only:** `mosd` and `apid` both restarted
**successfully** with `PrivateTmp=yes` (`success 0 active`), and equally
successfully after a `PrivateTmp=disconnected` drop-in (`success 0 yes active`).

> **What this does and does not settle.** It settles that a *restart* under a
> read-only `/var` is fine. It does **not** settle the first start of a boot
> whose `/var` was read-only from the outset, because in this experiment the
> per-service directories had already been created while `/var` was writable.
> `rootfs/compose/90-pack.Dockerfile` records the failure mode from the other
> direction: when `/var/tmp` did not *exist*, `systemd-resolved.service` died
> with `226/NAMESPACE` on every boot, which is why the pack stage creates it.

**The contract.** `/var/tmp` must **exist** as a directory in the immutable
image — it already does, and `PrivateTmp=disconnected` still needs the mount
point. Whether it needs a *writable* backing is decided by whether any
`PrivateTmp=yes` unit survives:

- **Recommended:** add `PrivateTmp=disconnected` to the four mos units
  (`mosd`, `apid`, `mos-mqtt-broker`, `mos-mqttd`) and drop-ins for the four
  Debian ones. `/var/tmp` then needs no writable backing at all, and the plan's
  "`/var/tmp` only if a shipped workload needs it" resolves to *no*.
- **If any `PrivateTmp=yes` remains**, P5 must give `/var/tmp` a DATA-backed
  leaf and prove the first start of a cold boot, not just a restart. The plan
  forbids silently making it a tmpfs; `disconnected` is the supported way to get
  tmpfs semantics per service, which is why it is the recommendation.

## 9. What P5 must change beyond the leaf mounts

1. **Bake the whole `/var` skeleton into the squashfs.** Today `/var` in the
   image is two paths and the real tree is restored onto EPHEMERAL. With `/var`
   on the read-only root, the 53-path factory tree plus every mount point in
   section 4 must be image content. **Measured consequence of getting this
   wrong:** `systemd-rfkill.service`, whose `StateDirectory=systemd/rfkill` does
   not exist, failed `exit-code 238` under a read-only `/var`, while
   `systemd-logind`, `systemd-pstore` and `systemd-timesyncd`, whose directories
   do exist, all restarted successfully. 238 is systemd's
   `EXIT_STATE_DIRECTORY`.
2. **`/var/lib/systemd/network` needs a decision.**
   `systemd-networkd-persistent-storage.service` failed `exit-code 1` under a
   read-only `/var` even though its directory exists — it writes *into* it. The
   plan's DATA table already lists `state/network` "where networkd persistent
   storage is enabled"; this measurement says it is enabled, so either give it
   the leaf or mask the unit.
3. **Retire `mos-seed-var.service`, its stamp and `/usr/share/factory/var`.**
   With `/var` immutable there is nothing to seed. The plan already calls for
   this; the audit confirms nothing else reads the factory copy.
4. **Reconcile the tmpfiles rules.** `/usr/lib/tmpfiles.d/var.conf` and
   `debian.conf` create and chmod `/var`, `/var/lib`, `/var/cache`, `/var/log`
   and friends, all of which become image-owned and read-only.
   `/etc/tmpfiles.d/mos-var.conf`'s two ageing rules (`q /var/tmp … 10d`,
   `e /var/cache … 30d`) lose their subject.
5. **`mos-health`'s `df -P /var` becomes meaningless** — `/var` will be the
   read-only root. The capacity signal has to move to DATA.
6. **`storage_status.rs` reports per-partition tiers.** `TIERS` names
   `/mnt/meta`, `/mnt/state` and `/var` as separate mounts and `BINDS` names
   `/mos` and `/srv`; under one DATA filesystem these must stop being summed as
   independent partitions, which is the plan's "`df` on bind mounts must not be
   summed" requirement.
7. **`network_config_dir`** → `/mos/containers/networks` (section 7).
8. **`PrivateTmp=`** → `disconnected` on the four mos units (section 8).

## 10. Board differences

x64 and virt-arm64 differ only in identity, architecture and console: a diff of
their `board.env` files shows `LAYOUT_BOARD`, the FAT volume IDs, the image name
prefix, `BOARD_CMDLINE_ARGS`, `BOARD_SIZE_BUDGET_MB`, `MOS_ARCH`,
`ESP_REQUIRED_FILES` and `BOARD_RELEASE_TARGET` — no layout, feature or radio
difference. Their composed roots have **identical** enabled-unit sets,
`PrivateTmp=` sets and 53-path factory `/var` trees. The contract is expected to
carry unchanged; P5 owes it the same composed-root read, not a re-derivation.

cx3576 is the one board that adds rows, all from `BOARD_RADIOS="wifi bluetooth"`:

| Path | Source | Owner | Ev | Note |
|---|---|---|---|---|
| `/var/lib/bluetooth` | `state/bluetooth` | `bluetooth.service` (`StateDirectory=bluetooth`, mode 0700) | declared | pairing keys; the only extra path in cx3576's factory `/var` |
| `/etc/wpa_supplicant` | `state/wpa_supplicant` | mosd wifi reconcilers | declared | holds every network's PSK; 0700 |
| `/etc/hostapd` | `state/hostapd` | mosd wifi-AP reconciler | declared | holds the AP key; 0700 |
| `/var/lib/systemd/rfkill` | — | `systemd-rfkill.service` | **inferred** | `99-systemd.rules` sets `ENV{SYSTEMD_RFKILL}="1"` on any rfkill device, so the socket is pulled in on a board with radios. Absent from cx3576's factory `/var`, and the x64 measurement shows an absent `StateDirectory` fails `238`. **Owed a bench measurement.** |

`bluetooth.service` additionally sets `ConfigurationDirectory=bluetooth` with
`ConfigurationDirectoryMode=0555` while the image ships `/etc/bluetooth` at
0755. Whether systemd tolerates that on a read-only `/etc` is **not measured**
and is owed to the bench.

## 11. Four things the audit surfaced, none of them P5's

These are recorded here because the audit measured them; they are not part of
the writable-path contract and are not fixed on this branch.

**11.1 `/usr/local/lib/systemd/system` ships inert.** A unit installed into
`/mnt/state/systemd-units`, the extension mechanism `docs/design/ro-root.md` §4
describes, **never runs**. systemd enumerates `multi-user.target.wants` when it
builds the initial transaction, which is before
`usr-local-lib-systemd-system.mount` binds STATE over the directory; the entry
does not exist yet and nothing issues a `daemon-reload` afterwards. Observed
on the first boot of this audit — the console shows

```text
[  OK  ] Mounted usr-local-lib-systemd-syst…emd units from the STATE partition.
```

and the seeded unit is still never loaded. Reproduce with

```sh
bash tools/qemu-seed-state.sh unit.service /systemd-units/unit.service
bash tools/qemu-seed-state.sh unit.service /systemd-units/multi-user.target.wants/unit.service
```

then boot: the mount succeeds, the unit does not start. `status: shipped` in
that design section is therefore an overstatement of what the mechanism does on
first boot.

**11.2 `ssh.service` fails when the generator already holds port 22.**
Observed: `systemctl start ssh.service` returns `exit-code failed` when
`sshd-extra.socket` (from `systemd-ssh-generator`) is already listening on
`[::]:22`. Only reachable when something sets `systemd.ssh_listen=`, which the
harness does; it is recorded so the interaction is not rediscovered as a
regression.

**11.3 Login accounting writes `/var/log/wtmp`, not `wtmp.db`.**
`/usr/lib/openssh/sshd-session` and `sshd-auth` import `wtmpdb_login`,
`wtmpdb_logout` and `wtmpdb_get_id`, and `libwtmpdb`'s only `/var` path string
is `/var/log/wtmp.db` — which suggested a SQLite writer that a file bind could
not serve. **The measurement says otherwise:** across two boots with SSH
sessions, `/var/log/wtmp.db` never appeared, while `/var/log/wtmp` grew from 0
to 768 and then to 2304 bytes. The active writer is the classic append-only
`wtmp`, and `/var/lib/wtmpdb/wtmp.db` stays a dangling symlink. `/var/log/wtmp`
is therefore the one member of section 5's list that does have a writer; it is
an unbounded append with no rotation (no `logrotate` is installed), so P5 should
either mask it or accept a growing file on a DATA leaf. Recorded, not repaired.

**11.4 The generated `sshd@.service` overrides `AuthorizedKeysFile`, and mosd
owns the path the image config names.** Two separate facts, both worth
recording because together they make "write the key to the obvious file" fail.

`systemd-ssh-generator`'s `sshd@.service` starts sshd with

```text
ExecStart=-… -i -o "AuthorizedKeysFile ${CREDENTIALS_DIRECTORY}/ssh.ephemeral-authorized_keys-all .ssh/authorized_keys"
```

A command-line `-o` is parsed before the configuration file and OpenSSH keeps
the first value obtained, so under that generator the effective
`AuthorizedKeysFile` is the credential file plus `~/.ssh/authorized_keys` —
**not** `/etc/ssh/authorized_keys.d/%u`, which is what the image's own
`sshd_config.d/05-mos-authorized-keys.conf` sets. Confirmed here: seeding a
`01-`-prefixed drop-in naming a third path changed nothing, which is what
`-o` winning predicts.

Separately, `pkgs/mosd/mosd/src/reconciler/sshd.rs` **renders**
`/etc/ssh/authorized_keys.d/<account>` from `settings.access.ssh.keys` on every
reconcile, and `Profile::ssh_enabled_default()` returns `false` for **both**
`dev` and `prod`, so a factory device renders an empty file there. Writing that
file directly is therefore futile on the normal boot path too — the settings
tree is the source of truth, which is the intended design and is recorded here
only so a later harness does not rediscover it.

**An open question this audit did not close.** The harness authenticated on
boots 1 and 2 and was refused on boot 3 with `Permission denied (publickey)`,
after answering the readiness probe on the same boot. `read-data.sh` shows
`/mos/root/.ssh/authorized_keys` on DATA at mode 0600, 89 bytes, byte-identical
to the harness public key, so the file sshd's `-o` names was present and correct
when the refusal happened. **I did not isolate the cause**, and the earlier
draft of this section blamed mosd's reconciler — that claim is withdrawn: the
reconciler does not touch `~/.ssh`, and the drop-in experiment that would have
confirmed it did not behave as the theory required. Recorded as an open
question, not a diagnosis.

It cost this audit nothing: the one claim boot 3 was to carry — reboot survival
of the DATA-backed seed file — is measured from the disk instead (section 6),
which does not need a login and is the stronger measurement.
