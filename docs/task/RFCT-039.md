# RFCT-039 A persistent `/home` on DATA, and the `mos` account that owns it

- **status**: implementation complete — `bash mosd/hack/check.sh` (298 tests),
  `make os-shadow-test`, `make os-dbus-policy-test`, `make os-health-test`,
  `make os-repart-test` and both image builds with both profiles and both
  verifiers all green; no on-device claim is made
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 15:10
- **claimedAt**: 2026-08-19 15:10
- **completedAt**: 2026-08-19 18:05

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/j2i4v3po`, merged by
L2 into `bkd/hiu25adw`.

## Description

Venus OS keeps its user home persistent across reboots and firmware updates.
mos did not: `/home` was an empty directory inside the read-only verity
squashfs, so nothing an operator put there survived even a reboot, and there was
no account that owned it. This task gives v2 a `/home` bound from the DATA
partition and gives both images a real `mos` account to own it.

## The decisions, and why

### DATA, not STATE

`/srv/home` is bind-mounted onto `/home`. STATE was the obvious-looking choice
and is the wrong one.

STATE is 64 MiB of small, precious **configuration and identity**: the settings
tree, the sshd host keys, the shadow file, the WiFi PSKs. A home directory is
**user data** — whatever an operator copies into it. A single update bundle
staged for `rauc install` is ~72 MiB, which does not fit on STATE at all, and an
operator who filled STATE would take the settings tree and the host keys down
with it.

DATA (`p11`, ext4, mounted at `/srv`) is the tier for exactly this. It is the
only partition carrying `x-systemd.growfs` and the only one `systemd-repart`
extends to the end of the disk on first boot, so it is the only tier a home
directory can live on without a ceiling.

This is written into the unit's own comment, not only here, because the next
person to read `home.mount` is the one who might "fix" it onto STATE.

### A real `mos` account

A persistent home with no owner serves nothing. `mos` has shell `/bin/bash`,
primary group `mos`, home `/home/mos`, and a locked password. Both images get
it, so the two do not drift in their account definitions.

### uid/gid pinned to 1000:1000

This is the decision most likely to be undone by someone who does not see why,
so it is asserted numerically in three places (both Dockerfiles' build-time
guards, `mos-seed-home`, and both verifiers) rather than once.

The home directory **outlives the rootfs that created it**. It sits on DATA and
survives every A/B update, so its owner is part of the **on-disk contract**, not
a build-time allocation detail. If `useradd` had picked the id dynamically and a
later image resolved it differently, every file already in `/home/mos` would be
owned by a uid that no longer exists — and nothing would fail: not the build,
not the update, not the next boot. The operator would simply find their own
files unreadable. That silence is why the number is pinned and why the seed
`chown`s to the **numbers**, never to the name `mos:mos`, which would resolve to
whatever the running image happens to say.

### No sudo, no supplementary groups — a deliberate deferral

`mos` is in no supplementary group. Not `adm`, not `shadow`, nothing reaching
the settings tree, and `sudo` does not ship. This is a **recorded deferral, not
an oversight**: phase 1 has no privilege policy to express, the web UI is the
admin surface, and a guessed policy would outlive the release that guessed it.

A deferral nothing asserts is one `usermod -aG` away from being undone silently,
so both verifiers assert it — membership *and* the absence of the `sudo` binary,
since a group grant needs a binary to mean anything and vice versa.

### `mos` is NOT a privilege tier

sshd is configured with `AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u`, and
a sibling task (RFCT-053) makes mosd render **the same key list** to
`.../mos` as to `.../root`. So:

> **Every authorised key is a root key.**

`mos` buys a persistent working directory and a non-root default shell. It does
not buy a weaker grant. Do not hand a colleague a key here expecting to have
handed them an unprivileged shell. This is stated in both Dockerfiles and in the
verifier's section comment, because it is the sentence someone needs to hit
before they add a key for the wrong reason.

### v1 is silent on persistence, deliberately

v1 gets the **account** and nothing else. It has no verity root, no DATA
partition and no `home.mount`, so there is nothing to bind `/home` from and
nothing that would survive a reflash; `--no-create-home` means the directory
does not exist there at all. A reader who finds an account with no persistent
home on v1 should find this paragraph rather than have to reconstruct it. The
v1 verifier's own section comment says the same thing at the point of use.

## The bind, and the ordering hazard

`home.mount` follows `var-lib-bluetooth.mount` in structure: `Type=none`,
`Options=bind`, `RequiresMountsFor=/srv`, `WantedBy=local-fs.target`.

The seed, `/usr/lib/mos/mos-seed-home`, is a oneshot ordered
**`Before=home.mount`** — not after it. That is a deliberate departure from the
usual "a seed on a verity root must run after the bind" rule, and the reason is
structural:

- **`mount(8)` never creates the SOURCE of a bind.** Only `Where=` is created by
  systemd, and on a verity root it cannot even do that. So `/srv/home` must
  already exist when the mount is attempted. A seed ordered *after* the bind
  could not have made that bind succeed in the first place — the mount would
  fail, `home.mount` would never activate, and a unit ordered after it would
  never run at all. There is no ordering in which an after-the-bind seed both
  creates the source and runs.
- **The hazard that rule exists for does not apply here.** It exists because a
  seed writing to `/home` before the bind writes into the read-only verity
  squashfs and fails. `mos-seed-home` writes **only under `/srv`**, never under
  `/home`, so the hazard is removed outright rather than ordered around.
  `/srv/home/mos` and `/home/mos` are the same inode once the bind is up.

A `tmpfiles.d` rule was rejected for the same reason, and the ordering was
checked rather than assumed: `systemd-tmpfiles-setup.service` carries
`After=local-fs.target`, while `home.mount` is `WantedBy=local-fs.target` and so
runs *before* that target is reached. A tmpfiles rule therefore runs strictly
after the bind — too late to create the bind source, which is the one thing that
has to happen first.

The ordering is guaranteed from both ends: `mos-seed-home.service` declares
`Before=home.mount`, and `home.mount` declares
`Requires=mos-seed-home.service` / `After=mos-seed-home.service`. Both units are
enabled by symlink into `local-fs.target.wants`, and the verifier asserts the
`Before=`, the enablement, and that the seed writes to the DATA path.

## Seeding: idempotent and non-clobbering

`mos-seed-home` creates `/srv/home` (0755 root:root) and, **only if it is not
already there**, `/srv/home/mos` owned `1000:1000` mode `0700`. An existing home
is left exactly as it is — it holds an operator's files and it outlives the
rootfs, so re-asserting its mode or owner on every boot would be a write to
someone else's data, not a repair.

There is no stamp file and no `ConditionPathExists=`, unlike `mos-seed-state`.
The script is idempotent by construction, and a stamp would freeze the tree at
whatever the first boot happened to make — so a later image adding a second
account would find no home for it.

## The locked-password guarantee: **it holds at flash time**

> **The factory shadow in the built image carries `mos:!:18262:0:99999:7:::`.**
> The account is locked in the artifact itself, before the device has ever
> booted. The guarantee does **not** depend on `mos-shadow-reconcile` running.

This was checked against the built image rather than assumed. `useradd` runs in
the rootfs stage, so `/etc/shadow` already carries a locked `mos` line by the
time the pack stage copies it to `/usr/share/factory/etc/shadow`.
`mos-shadow-reconcile` would also have appended a locked entry on first boot
(rule 3 of its three rules, covered by `os/shadow-reconcile-test.sh`), but it
never has to: it finds the account already converged.

The distinction matters for anyone reasoning about a device that has been
flashed and not yet booted. Here that window is closed.

### The rule generalised from `root` to every account

RFCT-024 established that an **empty** password field is not a locked marker but
**passwordless login** — `pam_unix` accepts any password, including none — and
scoped the rule to `root`, because `root` was the only account there was. This
task creates the second, so a `root`-shaped check would have quietly stopped
covering the case it was written for and would have left a third account exposed
all over again.

The test is now: **every account in `/etc/passwd` has a shadow entry whose
password field is a locked marker** — not empty, not a usable hash. It is
enforced in three places:

- the **pack-stage guard** in `os/rootfs/Dockerfile.v2` (the build fails),
- `os/verify-image-v2.sh` against `/usr/share/factory/etc/shadow`,
- `os/verify-image.sh` against `/etc/shadow` (v1 has no factory copy and no
  reconciler — its root is a writable ext4 — so the same property is asserted
  against the real file).

`root` keeps its own dedicated case ahead of the loop, because its cause is
specific and actionable (the `ROOT_PASSWORD` build arg) and a generic message
would send the fix in the wrong direction.

**Two failure modes, two messages**, on purpose. They are different defects: an
EMPTY field means the account accepts any password on this device; a USABLE HASH
means a credential every device in the fleet shares, since a signed rootfs is
byte-identical across all of them. One message would let either be diagnosed as
the other.

## Verifier assertions

### `os/verify-image-v2.sh` (+9)

1. `/home` joined the existing mountpoint set (`/mnt/state /mnt/meta /srv /var
   /home`). A verity root cannot create a mountpoint at runtime — the trap
   RFCT-013 documented.
2. `home.mount` is present, mounts `/home`, is **enabled** (symlink in
   `local-fs.target.wants`), and its `What=` is under the DATA mountpoint. The
   mountpoint is **read out of the fstab entry for `DATA_GUID`**, not spelled
   `/srv` in the check, so a `What=` under `/mnt/state` fails on the *tier* and
   not on a string.
3. `mos-seed-home.service` is present, enabled, and ordered `Before=home.mount`.
4. `mos-seed-home` creates `/srv/home/mos` (the DATA path, never `/home`), mode
   `0700`, chowned to its pinned `MOS_UID:MOS_GID`, and those pinned numbers
   equal the ones `/etc/passwd` gives `mos`.
5. `mos` exists in the packed `/etc/passwd` with uid **1000**, gid **1000**,
   group `mos` = gid **1000**, shell `/bin/bash` (**and `/bin/bash` actually
   ships**), home `/home/mos` — numerically, not by name.
6. `mos` has no supplementary groups and no `sudo` ships.
7. `mos`'s home is **inside what `home.mount` binds**.
8. Every account in the factory shadow is LOCKED — not empty, not a usable hash.
9. **No second D-Bus policy file** for `com.mos.mosd` anywhere in
   `/etc/dbus-1/system.d` or `/usr/share/dbus-1/system.d`.

### `os/verify-image.sh` (+4)

The account (5), the no-sudo/no-groups deferral (6), the all-accounts locked
rule against the real `/etc/shadow` (8), and the second-policy-file check (9).
Not the bind: v1 has nothing to bind from.

### Assertion 9, routed here from RFCT-048

`dbus-daemon` reads system-bus policy from **both** `/usr/share/dbus-1/system.d/`
and `/etc/dbus-1/system.d/`, concatenating every `.conf` and letting later rules
override earlier ones. A second file naming `com.mos.mosd` would therefore not
be a stricter policy layered on top — it could hand back exactly the
default-context allow RFCT-048 removed, **and every one of that task's policy
checks would still pass**. RFCT-048 named this as the one reopening path it left
unasserted; this is that assertion. The bus name is read from `mosd.service`'s
`BusName=`, so it cannot go stale against a rename, and the blessed file is
excluded by **name**, not by directory — a second file in
`/usr/share/dbus-1/system.d/` is exactly as dangerous as one in `/etc`.

## Verifier check counts

| image | profile | before | after |
| --- | --- | --- | --- |
| v1 (`os/verify-image.sh`) | dev | 132/132 | **136/136** |
| v1 (`os/verify-image.sh`) | prod | 132/132 | **136/136** |
| v2 (`os/verify-image-v2.sh`) | dev | 304/304 | **313/313** |
| v2 (`os/verify-image-v2.sh`) | prod | 304/304 | **313/313** |

## Assertions proven to fail when broken

Each scenario mutates a scratch copy, confirms the **specific** check fails with
the **right** message, and the unmutated tree is confirmed clean before and
after. The verifiers read the packed artifact, so each scenario injects its
mutation into the unpacked root (v2) or through a `dbg()` wrapper (v1) rather
than rebuilding the image twenty times.

### `os/verify-image-v2.sh` — 20 scenarios

| broken | check that fired |
| --- | --- |
| `/home` removed from the packed root | mountpoint set names `/home` as missing |
| `home.mount` deleted | "not in the image" |
| `What=` retargeted to `/mnt/state/home` | "not under /srv (the DATA partition)" |
| enablement symlink removed | "exists but is not enabled" |
| `mos-seed-home.service` deleted | "nothing creates … the bind fails, because mount(8) never creates the SOURCE of a bind" |
| `Before=home.mount` stripped | "no Before= naming home.mount" |
| seed enablement symlink removed | "exists but is not enabled" |
| `/usr/lib/mos/mos-seed-home` deleted | "is not in the image" |
| seed `MOS_UID` set to 1001 | "pins uid '1001' … not 1000:1000" |
| seed changed to `mkdir /home/mos` | "must create the home under the DATA path" |
| `mos` uid changed to 1001 | "expected 1000:1000" |
| `mos` removed from `/etc/passwd` | "no 'mos' account" |
| shell changed to `/usr/sbin/nologin` | "the login shell must be /bin/bash" |
| home changed to `/var/lib/moshome` | "which is NOT inside '/home'" |
| `mos` added to `adm` | "member of supplementary group(s): adm" |
| `mos` factory shadow field emptied | **EMPTY password field** message |
| `mos` given a usable `$2b$` hash | **usable password hash / shared secret** message |
| `mos` line removed from the factory shadow | "is missing: mos" |
| second policy file dropped in `/etc/dbus-1/system.d` | "a second D-Bus policy file mentions com.mos.mosd" |
| *(control)* unmutated tree | 313/313 PASS |

### `os/verify-image.sh` — 10 scenarios

uid drift, account removed, wrong shell, wrong home, `adm` membership, empty
shadow field, usable hash, missing shadow entry, `sudo` present, second policy
file. Each fired its own message; the unmutated tree is 136/136.

### The pack-stage guard in `os/rootfs/Dockerfile.v2` — 3 scenarios

Exercised where it actually runs: a scratch `Dockerfile` corrupts the factory
shadow just before the guard and the **build itself** must fail.

| broken | outcome |
| --- | --- |
| non-root account (`mos`) given an EMPTY password field | build fails: "…EMPTY password field: mos. An empty field means PASSWORDLESS login…" |
| non-root account (`mos`) given a usable `$2b$` hash | build fails: "…carrying a usable password hash: mos. A signed rootfs is byte-identical on every device in the fleet…" |
| *(control)* unmutated | build succeeds, guard prints its summary |

The two failures carry **different messages**, which is the point: they are
different defects with different fixes.

## Two defects found and fixed along the way

Both are mine or exposed by my change, and both are recorded rather than left.

### A flaky check in both verifiers (pre-existing)

The libcrypt format check is

```sh
LC_ALL=C tr -c '[:print:]' '\n' <"${LIB}" | grep -Fq -- "${CRYPT_PREFIX}"
```

With `-q`, `grep` exits the instant it matches, `tr` takes SIGPIPE, and
`set -o pipefail` turns that 141 into a **FAILED check on a library that does
carry the format**. It reproduced roughly one run in three (observed: PASS,
FAIL, PASS on three consecutive runs of an unmodified image), which is exactly
how a check like this survives — it looks like a transient. Dropping `-q` and
redirecting to `/dev/null` makes `grep` read to EOF, so `tr` never gets the
signal. Confirmed stable over five consecutive runs afterwards. Fixed in both
verifiers because both carry the identical pipeline.

### `useradd` broke build determinism (introduced here)

`useradd` stamps **today's date** into the shadow last-change field, so the
packed rootfs — and therefore its dm-verity root hash — would have differed on
every build day for no content reason at all. `os/mkimage-v2.sh` documents
determinism as a property of this pipeline. Pinned with `chage -d 2020-01-01`
(day 18262, the same date as the layout's `FILE_MTIME`), and asserted in both
Dockerfiles' build-time guards.

## Files changed

| file | change |
| --- | --- |
| `os/rootfs/overlay-v2/etc/systemd/system/home.mount` | NEW — bind `/srv/home` → `/home`, DATA-backed |
| `os/rootfs/overlay-v2/etc/systemd/system/mos-seed-home.service` | NEW — oneshot, `Before=home.mount`, in the local mount phase |
| `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-home` | NEW — idempotent, non-clobbering seed of `/srv/home/mos` |
| `os/rootfs/Dockerfile` | the `mos` account + build-time guards |
| `os/rootfs/Dockerfile.v2` | the `mos` account + guards; `/home` mountpoint; unit modes and enablement; locked-password guard widened to every account |
| `os/verify-image.sh` | 4 assertions; SIGPIPE flake fixed |
| `os/verify-image-v2.sh` | 9 assertions; SIGPIPE flake fixed |
| `docs/task/RFCT-039.md` | NEW — this record |

`docs/task/index.md` deliberately untouched (campaign rule). `mosd/**`
deliberately untouched — a sibling owns `reconciler/sshd.rs`.

## Verification (2026-08-19)

```
bash mosd/hack/check.sh            ALL CHECKS PASSED (298 tests)
make os-shadow-test                RESULT: PASS (220/220 checks)
make os-dbus-policy-test           RESULT: PASS (10/10 checks)
make os-health-test                RESULT: PASS (54/54 checks)
make os-repart-test                RESULT: PASS (18/18 checks)

MOS_PROFILE=dev   os-image-cx3576      + verify-image.sh      PASS (136/136)
MOS_PROFILE=dev   os-image-cx3576-v2   + verify-image-v2.sh   PASS (313/313)
MOS_PROFILE=prod  os-image-cx3576      + verify-image.sh      PASS (136/136)
MOS_PROFILE=prod  os-image-cx3576-v2   + verify-image-v2.sh   PASS (313/313)
```

## What is NOT proven

**Nothing here boots a device.** Every claim below is about the contents of an
artifact, and none of them is a hardware claim.

- **The bind is not proven to mount.** That `home.mount` is present, enabled,
  well-formed and DATA-backed is asserted from the packed image. Whether systemd
  actually activates it, in the ordering these units declare, is only observable
  on a real boot.
- **The home is not proven to persist.** No reboot happened. That `/srv/home/mos`
  survives a reboot follows from DATA being a real partition, but it is reasoning
  from the layout, not an observation.
- **An update is not proven to preserve it.** No A/B update was installed. The
  claim that the home survives one rests on DATA not being touched by RAUC,
  which this task did not exercise.
- **The seed is not proven to run.** `mos-seed-home` was not executed on a
  device. Its idempotence and its non-clobbering behaviour are properties of
  eleven lines of shell, asserted by reading them, not by running them against a
  real DATA partition. There is no offline test harness for it, unlike
  `mos-shadow-reconcile`, which has `os/shadow-reconcile-test.sh`. **That is a
  gap**: the seed is the only new executable this task ships and it has no test
  that drives it. It was left out deliberately to keep the change surgical, and
  it should be closed by a follow-up rather than forgotten.
- **No login was attempted.** That `mos` can actually log in — that PAM accepts
  the locked account for key-based SSH, that `/bin/bash` starts, that the home
  is writable by uid 1000 — is untested. Only the account's *definition* is
  asserted.
- **The key claim is inherited, not verified here.** "Every authorised key is a
  root key" follows from `AuthorizedKeysFile %u` over one shared list, which
  RFCT-053 implements in mosd. This task asserts the sshd drop-in that makes it
  true (already covered by an existing v2 check) but does not test the rendering.
- **`sudo` absence is asserted, not enforced by policy.** Nothing prevents a
  future package pulling it in; the verifier would catch it, which is the intent.

## ActiveForm

A persistent `/home` for the SSH access campaign: `/srv/home` bind-mounted onto
`/home` from the DATA partition — user data, not configuration, and the only
tier that grows — owned by a real `mos` account pinned to uid/gid 1000 because
the directory outlives the rootfs that created it; no sudo and no supplementary
groups as a recorded phase-1 deferral; RFCT-024's "an empty shadow field is
passwordless, not locked" rule generalised from `root` to every account in both
verifiers and in the pack-stage guard; thirteen verifier assertions across the
two images, each proven to fail when its property is broken.

## Dependencies

- RFCT-013 (read-only verity root; established that a mountpoint absent from the
  packed image cannot be created at runtime, which is what assertion 1 guards) —
  merged
- RFCT-024 (an empty shadow field is passwordless, not locked; this task
  generalises that rule from `root` to every account) — merged
- RFCT-036 (verifier integration; established the "prove it fails when broken"
  rule this task follows) — merged
- RFCT-048 (D-Bus policy restricted to root; routed the second-policy-file
  assertion here as the one reopening path it left unasserted) — merged
- RFCT-053 (mosd renders the same key list to `authorized_keys.d/mos`) —
  sibling; owns the mosd side of "every authorised key is a root key"
