# RFCT-054 A persistent `/root` on DATA

- **status**: implementation complete — `bash mosd/hack/check.sh` (305 tests),
  `make os-shadow-test`, `make os-dbus-policy-test`, `make os-health-test`,
  `make os-repart-test` and both image builds with both profiles and both
  verifiers all green; no on-device claim is made
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 12:55
- **claimedAt**: 2026-08-19 12:55
- **completedAt**: 2026-08-19 13:35

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/phy46daw`, merged by
L2 into `bkd/hiu25adw`.

## Description

`/root` must persist, for the same reason `/home` does. On the read-only verity
root an operator cannot keep anything there: whatever they put in `/root` is
lost on reboot and replaced wholesale by the next A/B update, because `/root`
is a directory inside the signed squashfs. RFCT-039 landed exactly this pattern
for `/home`; this task is that pattern applied to the second path.

`/srv/root` is bind-mounted onto `/root` by `root.mount`, whose source is
created by `mos-seed-root`, a oneshot ordered **`Before=root.mount`**.

## The decisions, and why

### DATA, not STATE

Same reasoning as `/home`, and it is written into `root.mount`'s own comment
rather than only here, because the next person to read that unit is the one who
might "fix" it onto STATE.

A root home accumulates shell history, scratch scripts, a downloaded bundle —
**user data of unbounded size**, not configuration. STATE is 64 MiB of small,
precious **identity**: the settings tree, the sshd host keys, the shadow file.
A single update bundle staged for `rauc install` is ~72 MiB, which does not fit
on STATE at all, and an operator who filled STATE would take the settings tree
and the host keys down with it. DATA (`p11`, ext4, mounted at `/srv`) is the
only partition carrying `x-systemd.growfs` and the only one `systemd-repart`
extends to the end of the disk, so it is the only tier a root home can live on
without a ceiling.

### Two sentences about SSH keys that a reader will otherwise get backwards

Both are stated in `root.mount`, in the verifier's section comment, and here.

> **Key login does not depend on this bind.** Keys render to
> `/etc/ssh/authorized_keys.d/%u`, not `/root/.ssh/authorized_keys` — RFCT-034
> chose that path precisely because `/root` was ephemeral. So a `/root` that
> fails to mount does **not** lock anyone out.

Without that sentence a reader assumes the two are coupled and concludes the
opposite: that a broken `root.mount` is a lockout, or that this task is on the
login path at all. It is not. Nothing in this change touches authentication.

> **A key placed in `/root/.ssh/authorized_keys` now survives a reboot and
> still grants nothing.** `AuthorizedKeysFile` **replaces** the default
> locations rather than adding to them, so that file is inert — but it now
> **persists**, so anyone auditing the device will find a plausible-looking
> `authorized_keys` that does nothing.

That is worth saying out loud, because a persistent file that looks like a
grant is exactly the kind of thing someone later "fixes" into a real one. The
image ships an empty `/root/.ssh` (Debian's, mode 0700); this task does not
seed it, does not populate it, and does not make it meaningful.

### The mountpoint: confirmed present, not assumed

`/root` must exist as a directory in the packed read-only root — a verity root
cannot create a mountpoint at runtime, the trap RFCT-013 documented. Debian
already ships `/root`, so this was **checked against the built artifact rather
than assumed**: unpacking `_out/cx3576/rootfs-verity.img` shows

```
/root  drwx------  700  0:0   (.bashrc, .profile, an empty .ssh/)
```

It survives the pack stage. **The assertion is still required**, because
nothing guaranteed that it stays: no stage of the build asserted `/root`'s
existence, mode or owner, and a base-image change or a `rm -rf` in a future
`RUN` would have removed it silently. `/root` is therefore added to the
verifier's existing mountpoint set, and `os/rootfs/Dockerfile.v2` now creates it
explicitly with `mkdir -p -m 0700 /root && chown 0:0 /root && chmod 0700 /root`
rather than joining the 0755 mountpoint list — the mode is part of the contract,
so the build states it instead of inheriting it.

### Mode 0700 root:root, asserted at both ends

A root home that ends up group- or world-readable is a **different failure**
from the one being fixed, and `/srv` sits on DATA, which is **not
verity-protected**, so the mode is not implied by anything the signature
covers. It is therefore asserted twice:

- on the **packed mountpoint**, by the verifier (`stat` says `700` and `0:0`);
- on the **bind source**, by the seed, which `chmod 0700` / `chown 0:0`s
  `/srv/root` on **every** run, not only on the run that creates it.

The mode is the one thing the seed re-asserts unconditionally. It is a property
of the directory, not a file an operator authored, so repairing it destroys
nothing — unlike the contents, which are never touched again (below).

The `chown` uses the **numbers `0:0`**, not `root:root`, for the same reason
`mos-seed-home` pins `1000:1000`: the directory outlives every rootfs that will
ever be flashed onto the device, so its owner is part of the **on-disk
contract**, not something to resolve out of whatever `/etc/passwd` the running
image happens to carry.

## The ordering — taken from RFCT-039's finding, not re-derived

`mos-seed-root.service` is ordered **`Before=root.mount`**, not after. This is a
deliberate departure from the usual "a seed on a verity root must run after the
bind" rule, and RFCT-039 established why:

- **`mount(8)` never creates the SOURCE of a bind.** Only `Where=` is created by
  systemd, and on a verity root it cannot even do that. So `/srv/root` must
  already exist when the mount is attempted. A seed ordered *after* the bind
  could not have made that bind succeed in the first place — the mount would
  fail, `root.mount` would never activate, and a unit ordered after it would
  never run at all. There is no ordering in which an after-the-bind seed both
  creates the source and runs.
- **The hazard that rule exists for does not apply.** It exists because a seed
  writing to `/root` before the bind writes into the read-only verity squashfs
  and fails. `mos-seed-root` writes **only under `/srv`**, never under `/root`,
  so the hazard is removed outright rather than ordered around. `/srv/root` and
  `/root` are the same inode once the bind is up.

`tmpfiles.d` is unusable for the same reason RFCT-039 recorded, and that
ordering was checked rather than assumed there: `systemd-tmpfiles-setup.service`
carries `After=local-fs.target`, while `root.mount` is
`WantedBy=local-fs.target` and so runs *before* that target is reached. A
tmpfiles rule therefore runs strictly **after** the bind — too late to create
the bind source, which is the one thing that has to happen first.

The ordering is guaranteed **from both ends**: `mos-seed-root.service` declares
`Before=root.mount`, and `root.mount` declares `Requires=mos-seed-root.service`
/ `After=mos-seed-root.service`. Both units are enabled by symlink into
`local-fs.target.wants`, and the verifier asserts the `Before=`, both
enablements, and that the seed writes to the DATA path.

## Seeding: idempotent, non-clobbering, and the dotfiles

`mos-seed-root` creates `/srv/root` and, **only on the run that creates it**,
copies `.bashrc` and `.profile` out of the factory `/root` so an operator gets a
normal shell environment on first boot. Reading `/root` there is safe and
correct: the seed runs before `root.mount`, so `/root` is still the squashfs
copy Debian shipped, and nothing is ever written back to it.

Afterwards those files are **never overwritten**. An operator who edits
`.bashrc` must keep that edit across the next reboot — that is the entire point
of the feature, and re-copying the factory template on every boot would destroy
exactly what the bind exists to preserve. Only the directory's **mode** is
re-asserted; its **contents** are not.

There is no stamp file and no `ConditionPathExists=`, matching
`mos-seed-home`: the script is idempotent by construction, and a stamp would
freeze the tree at whatever the first boot happened to make.

## Verifier assertions — v2 only

### Why v1 is silent

`os/verify-image.sh` gets nothing from this task, and that silence is
deliberate rather than an omission. **v1 has no verity root and no DATA
partition to bind from.** Its root filesystem is a writable ext4, so `/root` is
already writable in place and there is nothing a bind would add; and there is no
`/srv` tier, no `root.mount`, and no seed to order against one. Asserting any of
this on v1 would be asserting the absence of a mechanism v1 does not have. This
paragraph exists so a reader who finds v2 covered and v1 untouched does not have
to reconstruct the reason, the same way RFCT-039 recorded its own v1 silence.

### `os/verify-image-v2.sh` (+4 checks; assertion 1 extends an existing check)

1. **`/root` exists as a directory in the packed root.** Added to the existing
   mountpoint set (`/mnt/state /mnt/meta /srv /var /home /root`) rather than
   given its own check, as RFCT-039 did for `/home`. A verity root cannot create
   a mountpoint at runtime.
2. **`root.mount` present AND enabled, `What=` on DATA.** The DATA mountpoint is
   **read out of the fstab entry for `DATA_GUID`**, not spelled `/srv` in the
   check, so a `What=` under `/mnt/state` fails on the **tier** and not on a
   string. Enablement is asserted separately: a unit present but unenabled
   leaves `/root` inside the read-only squashfs forever while a
   file-exists check still passes.
3. **`/root` in the packed root is mode `0700` owned `0:0`.**
4. **`mos-seed-root.service` present, enabled, ordered `Before=root.mount`, and
   the seed script present and executable.** The executable bit is asserted, not
   just the file: a non-executable `ExecStart=` target fails with `203/EXEC`,
   the bind source is never created, and `root.mount` fails on every boot.
5. **The seed writes only under `/srv`, never into `/root` before the bind** —
   plus that it creates `/srv/root`, `chmod 0700`s it and `chown 0:0`s it
   numerically. **This is a static check, not a behavioural one**: it reads the
   script, it does not run it. Idempotence and non-clobbering are properties of
   eleven lines of shell asserted by reading them.

## Verifier check counts

| image | profile | before | after |
| --- | --- | --- | --- |
| v2 (`os/verify-image-v2.sh`) | dev | 313/313 | **317/317** |
| v2 (`os/verify-image-v2.sh`) | prod | 313/313 | **317/317** |
| v1 (`os/verify-image.sh`) | dev | 136/136 | **136/136** (unchanged) |
| v1 (`os/verify-image.sh`) | prod | 136/136 | **136/136** (unchanged) |

Both v2 "before" numbers were measured on this branch, the prod one by stashing
the change and rebuilding, rather than carried over from RFCT-039's table.

## Assertions proven to fail when broken

Each scenario mutates a scratch copy of the verifier that injects one mutation
into the **unpacked** root right after `unsquashfs`, confirms the **specific**
check fails with the **right** message, and the unmutated tree is confirmed
clean before and after. The scratch copy is deleted afterwards; nothing of the
harness is committed. Mutating the unpacked tree avoids rebuilding and
re-signing the image seventeen times, exactly as RFCT-039 did.

| # | broken | check that fired |
| --- | --- | --- |
| — | *(control)* unmutated tree | **317/317 PASS** |
| 1 | `/root` removed from the packed root | "mountpoint(s) missing from the read-only root: /root" |
| 2 | `root.mount` deleted | "root.mount is not in the image" |
| 2 | `Where=` retargeted to `/rootx` | "root.mount mounts '/rootx', not /root" |
| 2 | `What=` retargeted to `/mnt/state/root` | "not under /srv (the DATA partition)" |
| 2 | `root.mount` enablement symlink removed | "exists but is not enabled" |
| 3 | `/root` widened to `0755` | "is mode 755 owned 0:0, expected 700 and 0:0" |
| 3 | `/root` chowned `1000:1000` | "is mode 700 owned 1000:1000, expected 700 and 0:0" |
| 4 | `mos-seed-root.service` deleted | "nothing creates /srv/root … mount(8) never creates the SOURCE of a bind" |
| 4 | `Before=root.mount` stripped | "has no Before= naming root.mount" |
| 4 | seed enablement symlink removed | "exists but is not enabled" |
| 4 | seed script deleted | "missing or not a regular file" |
| 4 | seed script `chmod 0644` | "not executable; ExecStart= would fail with 203/EXEC" |
| 5 | seed changed to `mkdir /srv/roothome` | "does not create /srv/root" |
| 5 | seed `chmod 0700` → `chmod 0755` | "does not chmod 0700 /srv/root" |
| 5 | seed `chown 0:0` → `chown root:root` | "does not chown 0:0 /srv/root numerically" |
| 5 | seed given `cp -p /srv/root/x /root/authorized_keys` | "mos-seed-root writes under /root: 47: …" |
| — | *(control)* unmutated tree, re-run | **317/317 PASS** |

The "writes under `/root`" pattern was additionally checked against
`mos-seed-home` as a control (it must not match) and against two independent
mutations of `mos-seed-root` (`cp … /root/…` and `mkdir /root/.ssh`, which must
both match), because a write-detector that never fires is indistinguishable
from a clean script.

## An offline sanity run of the seed (ad hoc, not shipped)

The seed was run three times in a throwaway `debian:bookworm-slim` container to
confirm the shell is not simply broken. This is **not** a test harness, nothing
of it is committed, and it does not appear in any check:

- run 1 on an empty `/srv`: created `/srv/root` at `700 0:0` with `.bashrc` and
  `.profile` copied from `/root`;
- an operator edit was then simulated — a line appended to `.bashrc`, a
  `scratch.sh` added, and the directory widened to `0755`;
- runs 2 and 3: `"/srv/root already present, contents left untouched"`, the
  appended line and `scratch.sh` both intact, the mode repaired to `0700`.

That is the intended behaviour, but it is an observation from one ad-hoc run on
a laptop container, not a claim the build or the verifier makes.

## Files changed

| file | change |
| --- | --- |
| `os/rootfs/overlay-v2/etc/systemd/system/root.mount` | NEW — bind `/srv/root` → `/root`, DATA-backed |
| `os/rootfs/overlay-v2/etc/systemd/system/mos-seed-root.service` | NEW — oneshot, `Before=root.mount`, in the local mount phase |
| `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-root` | NEW — idempotent, non-clobbering seed of `/srv/root` |
| `os/rootfs/Dockerfile.v2` | unit modes, enablement, seed script mode, `/root` created at `0700 0:0` |
| `os/verify-image-v2.sh` | 4 assertions + `/root` added to the mountpoint set |
| `docs/task/RFCT-054.md` | NEW — this record |

`docs/task/index.md` deliberately untouched (campaign rule). `mosd/**`,
`os/rootfs/Dockerfile` (v1), `os/verify-image.sh` and `docs/design/**`
deliberately untouched. `/home`'s units and seed script are untouched: this
mirrors RFCT-039's pattern, it does not refactor it, and no shared helper was
extracted from the two.

## Verification (2026-08-19)

```
bash mosd/hack/check.sh            ALL CHECKS PASSED (305 tests)
make os-shadow-test                RESULT: PASS (220/220 checks)
make os-dbus-policy-test           RESULT: PASS (10/10 checks)
make os-health-test                RESULT: PASS (54/54 checks)
make os-repart-test                RESULT: PASS (18/18 checks)

MOS_PROFILE=dev   os-image-cx3576      + verify-image.sh      PASS (136/136)
MOS_PROFILE=dev   os-image-cx3576-v2   + verify-image-v2.sh   PASS (317/317)
MOS_PROFILE=prod  os-image-cx3576      + verify-image.sh      PASS (136/136)
MOS_PROFILE=prod  os-image-cx3576-v2   + verify-image-v2.sh   PASS (317/317)
```

`bash docs/verify-index.sh` goes from **10 FAILED, 106 passed** to **11 FAILED,
106 passed**. The single new failure is `RFCT-054.md exists but has no row in
docs/task/index.md` — this record itself, joining the ten campaign records
already in that state. `docs/task/index.md` was deliberately not edited (campaign
rule); a sibling closes all eleven at once.

## What is NOT proven

**Nothing here boots a device.** Every claim below is about the contents of an
artifact; none of them is a hardware claim.

- **The bind is not proven to mount.** That `root.mount` is present, enabled,
  well-formed and DATA-backed is asserted from the packed image. Whether systemd
  actually activates it, in the ordering these units declare, is only observable
  on a real boot.
- **`/root` is not proven to persist.** No reboot happened. That `/srv/root`
  survives one follows from DATA being a real partition, but that is reasoning
  from the layout, not an observation.
- **An A/B update is not proven to preserve it.** No update was installed. The
  claim rests on DATA not being touched by RAUC, which this task did not
  exercise.
- **The seed is not proven to run on a device.** The ad-hoc container run above
  is not a device, not a DATA partition, and not part of any check. In the
  verifier, idempotence, non-clobbering and the "writes only under `/srv`"
  property are **static reads of the script**, not behaviour.
- **The dotfile seeding is not proven end to end.** That an operator gets a
  working shell environment on first boot depends on the copied `.bashrc` being
  the one bash reads through the bind, which is a boot-time property.
- **The mode on DATA is not proven.** The verifier asserts `0700 0:0` on the
  **packed mountpoint**; the mode of the real `/srv/root` on a real ext4 DATA
  partition is only whatever the seed sets when it actually runs.
- **The two SSH sentences are documentation, not assertions.** That
  `AuthorizedKeysFile` replaces rather than extends the default locations, and
  that keys render to `/etc/ssh/authorized_keys.d/%u`, are properties of sshd
  and of RFCT-034/RFCT-053 that existing checks cover. This task asserts neither
  and changes neither.

## Follow-up: neither seed script has an offline test harness

RFCT-039 flagged that it shipped `mos-seed-home` with no offline test, unlike
`mos-shadow-reconcile`, which has `os/shadow-reconcile-test.sh`. This task ships
`mos-seed-root` in exactly the same position. **Both gaps are the same gap**, so
recording it once here rather than twice:

> `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-home` and
> `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-root` are the two executables in
> the image with no test that drives them. Their idempotence and non-clobbering
> behaviour — the properties an operator's data depends on — are asserted by
> reading the scripts, never by running them. A single
> `os/seed-test.sh` in the shape of `os/shadow-reconcile-test.sh`, driving both
> against a scratch `/srv`, would close it for both at once: fresh creation,
> a second run over an existing tree, an operator-edited `.bashrc` surviving,
> and a widened mode being repaired.

Deliberately out of scope here: building it would roughly double this task, and
building it for `/root` alone would leave `/home` uncovered and the gap open.

## ActiveForm

A persistent `/root` for the SSH access campaign: `/srv/root` bind-mounted onto
`/root` from the DATA partition — user data of unbounded size, not
configuration, and the only tier that grows — with the bind source created by an
idempotent, non-clobbering `mos-seed-root` ordered `Before=root.mount`, because
`mount(8)` never creates the source of a bind and `tmpfiles.d` runs strictly
after `local-fs.target`; mode `0700 0:0` asserted on both the packed mountpoint
and the bind source, since DATA is not verity-protected; four new v2 verifier
assertions plus `/root` added to the mountpoint set, each proven to fail when
broken across seventeen scenarios; and the record states plainly that key login
does not depend on this bind and that an `authorized_keys` under `/root/.ssh`
now persists while still granting nothing.

## Dependencies

- RFCT-013 (read-only verity root; established that a mountpoint absent from the
  packed image cannot be created at runtime, which is what assertion 1 guards) —
  merged
- RFCT-034 (`AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u`, chosen because
  `/root` was ephemeral; the reason key login does not depend on this bind) —
  merged
- RFCT-036 (verifier integration; established the "prove it fails when broken"
  rule this task follows) — merged
- RFCT-039 (the identical pattern for `/home`: the DATA-not-STATE decision, the
  `Before=` ordering finding, the rejected `tmpfiles.d` route, and the
  read-`DATA_GUID`-from-fstab style this task mirrors) — merged
- RFCT-053 (mosd renders the same key list to every managed login account) —
  sibling; owns the mosd side of the key rendering this task does not touch
