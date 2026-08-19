# RFCT-029 /etc/shadow on STATE (symlink, factory copy, boot reconcile, verifier proof)

- **status**: implementation complete — both verifiers green, on-device behaviour is the user's acceptance
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 00:23
- **completedAt**: 2026-08-19 02:10

## Description

PLAN-010 M5 (access.md phase 1) gives every device its own root password. The
only file `pam_unix` will read for it is `/etc/shadow`, and on layout v2 that
path sits inside the dm-verity squashfs. The only writable paths under `/etc`
in v2 are the bind mounts `/etc/hostname` and `/etc/ssh`; `/etc/shadow` and
`/etc/.pwd.lock` are read-only. So sshd password authentication cannot work and
mosd cannot apply a per-device password.

This task ships `/etc/shadow` as a **symlink into the STATE-backed tree**,
seeded from a **factory copy**, and **reconciled on every boot**, and proves in
both verifiers that the file PAM reads is the STATE-backed one.

## Design

### Layout

| Path | What it is |
|---|---|
| `/etc/shadow` | symlink -> `/var/lib/mos/shadow` |
| `/var/lib/mos` | bind target of `var-lib-mos.mount`, `What=/mnt/state/mos` (STATE partition) |
| `/usr/share/factory/etc/shadow` | the image's own shadow, retained as the factory template |
| `/etc/passwd`, `/etc/group` | unchanged, still in the image, read-only |

A **symlink, not a bind-mounted file.** A bind-mounted file cannot be replaced
by `rename(2)`, and atomic replace is how mosd writes a credential without a
torn read. The existing `/etc/hostname` bind is a different case: systemd-hostnamed
rewrites that file in place.

`/usr/share/factory/etc/` is systemd's standard place for a factory template and
is the same idea the pack stage already applies to `/var`
(`/usr/share/factory/var`, restored by `mos-seed-var`).

Only the secret-bearing file moves. `/etc/passwd` and `/etc/group` stay inside
the signed, verity-covered root, so account *definitions* remain immutable while
account *credentials* become per-device.

### Reconcile on every boot, not seed-once

`/usr/lib/mos/mos-shadow-reconcile` runs on **every** boot from
`mos-shadow-reconcile.service`. A seed-once design freezes the file at
first-boot content, so a later image that adds a system account leaves it with
no shadow entry at all. M6 will hit this the moment balena-engine brings a
service account.

Two rules, in this order:

1. **An entry that already exists in the STATE file is NEVER touched.** The
   device's own credential always wins over the image's — an A/B update must not
   be able to reset a password the operator set.
2. **An account in `/etc/passwd` with no STATE entry gets one appended, always
   LOCKED.** The factory entry supplies the aging fields; the hash field is
   forced to a locked marker. If the factory copy has no entry for that account,
   a locked placeholder `user:!:<today>:0:99999:7:::` is written.

**Idempotent by construction**: appending is the only mutation the script makes,
so when nothing is missing it does not rewrite the file at all — it only
re-enforces `0640 root:shadow` and exits. Verified: inode, mtime, size and mode
are unchanged across a second run.

The script takes an optional shadow path (default `/var/lib/mos/shadow`) so the
same implementation serves both call sites. `mos-seed-state` passes
`/mnt/state/mos/shadow` explicitly, because on first boot it runs inside the
local mount phase, before `var-lib-mos.mount` has bound that directory onto
`/var`. There is exactly one place that decides shadow content.

That also covers a device whose STATE was seeded by an *older* image:
`mos-seed-state` is gated on `ConditionPathExists=!/mnt/state/.mos-state-seeded`
and would never run again, but the boot reconciler creates the STATE shadow from
the factory copy when it is missing.

### Ordering

```
Requires=var-lib-mos.mount
After=var-lib-mos.mount
Before=mosd.service ssh.service
```

`After=`/`Requires=` the mount, because the symlink only resolves to the
device's own file once `/mnt/state/mos` is bound over `/var/lib/mos`.
`Before=` both consumers, because sshd's PAM stack **reads** the file through
`pam_unix` and mosd **writes** the `root:` line. Running after either would mean
a boot where an account added by an update has no entry, or a race with mosd's
atomic replace.

### Modes and ownership

`0640 root:shadow`, on the factory copy and on the STATE file. The group is not
cosmetic: `unix_chkpwd` is setgid `shadow` precisely so a non-root PAM stack can
read this file. This is the same reason the pack stage deliberately avoids
`-all-root` (RFCT-017, `docs/design/ro-root.md` §3): that flag rewrites ownership
but not mode bits, which both widens setgid-root and breaks `unix_chkpwd`'s
ability to read shadow. The existing setuid/setgid inventory gate is unaffected
by this change — the shadow file is `0640`, so `find -perm /6000` never sees it,
and the source/packed inventories still diff clean.

### Why the surgery is in the pack stage

The symlink is created in the **pack** stage, not the rootfs stage, for the same
reason `/etc/resolv.conf` is: the `ROOT_PASSWORD` step and every package postinst
still need a real file. `chpasswd` would follow a symlink laid down earlier and
write *through* it into a path that does not exist yet.

## v1 asymmetry (R6)

v1 (`os/rootfs/Dockerfile`, single-slot writable ext4 root) gets **only** the
no-baked-credential assertion. It gets no symlink, no factory copy and no
reconcile unit, because its `/etc/shadow` is already writable in place: there is
nothing to redirect and adding the machinery would be pure risk for zero gain.
What the two images genuinely share is the rule that no usable root password may
ship inside one, so that — and only that — is asserted in both verifiers.

## What R5 does and does not prove

**Proves**: the shadow file that ships in the artifact carries no usable root
password. The `root:` entry's hash field is a locked marker (`!` / `*` / empty),
not a hash. Since a signed rootfs is byte-identical on every device in the
fleet, this is exactly the property that makes "the credential is not in the
image" checkable rather than asserted. Setting `ROOT_PASSWORD` now turns the
build red — at build time in the pack stage *and* in the verifier — instead of
silently shipping a fleet-wide shared secret.

**Does not prove**: anything about the password the device ends up with. That is
mosd's job at runtime and is only observable on a real boot. It also does not
prove that PAM succeeds — only that it cannot succeed using something baked in.

One deliberate asymmetry: the verifiers accept an empty hash field as "not a
hash", per the M5 spec's marker list, whereas `mos-shadow-reconcile` rewrites an
empty field to `!`. An empty field is not locked — `pam_unix` treats it as "no
password required" — so the script is stricter than the check. Debian's default
`root:*:...` means neither path is exercised today.

## Verifier changes

### v2 (`os/verify-image-v2.sh`) — 228 -> 247 checks (+19)

The end-to-end property is proved in **both directions**, the way M4 proved the
U-Boot pairing:

| Check | Asserts |
|---|---|
| `/etc/shadow` is a symlink to `/var/lib/mos/shadow` | the exact target, not merely that a symlink exists |
| no regular `/etc/shadow` in the squashfs | nothing shadows the STATE-backed copy |
| `/var/lib/mos/shadow` absent from the squashfs | the symlink can *only* resolve through the STATE bind |
| the **actual** link destination's directory is `var-lib-mos.mount`'s `Where=`, and its `What=` is under `/mnt/state` | the link lands on STATE, not on a directory nothing mounts. Derived from the link, never from the expected constant — a check against the constant keeps passing for a retargeted symlink, which is exactly the defect |
| `/etc/passwd`, `/etc/group` are regular files | only the secret-bearing file moved |
| `/usr/share/factory/etc/shadow` is a regular file | the template exists |
| it carries every account in `/etc/passwd` | not empty, and not missing accounts — otherwise the checks above would pass for the wrong reason |
| the image defines a `shadow` group | `unix_chkpwd`'s setgid target exists |
| factory copy is `0640` and `0:<shadow gid>` | modes/ownership survived packing |
| `/usr/lib/mos/mos-shadow-reconcile` is a regular file | the reconciler ships |
| `mos-shadow-reconcile.service` is a regular file | the unit ships |
| `mos-shadow-reconcile.service` **is enabled** | a `.wants` symlink exists — M4 shipped hwinit units installed but never enabled and every check passed |
| its `ExecStart=` is the reconciler | the unit runs the right thing |
| `After=` names `var-lib-mos.mount` **and that unit is in the image** | x3 for `Before=mosd.service` and `Before=ssh.service`; an ordering naming a missing unit is silently inert |
| `mos-seed-state` passes `/mnt/state/mos/shadow` | first boot seeds the real STATE path, not the not-yet-bound `/var` one |
| R5: `root:` hash field is a locked marker | no fleet-wide shared secret in the artifact |

The ordering checks match whole tokens (`sed` the directive, split on spaces,
`grep -Fxq`), so `Before=xmosd.serviceX` or a mention in a comment does not pass.

### v1 (`os/verify-image.sh`) — 88 -> 89 checks (+1)

R5 only, read out of the ext4 root with `debugfs`.

### Build-time gate (`os/rootfs/Dockerfile.v2`, pack stage)

The same chain is asserted at build time, where it can only pass for the
intended artifact: symlink target, `Where=` of `var-lib-mos.mount`, factory copy
present with `0640` `0:<shadow gid>`, every `/etc/passwd` account covered, the
`root:` hash locked (naming `ROOT_PASSWORD` as the cause), the reconcile unit
present + executable + enabled + ordered, and `ssh.service` actually present.
`mosd.service` existence is checked in the verifier rather than here, because the
Dockerfile still supports `WITH_MOSD=0` builds while the verifier already assumes
mosd is installed.

## Known limits

- Between `mos-seed-var` restoring `/var` and `var-lib-mos.mount` binding STATE
  over `/var/lib/mos`, `/etc/shadow` is a dangling symlink. Nothing in that
  window reads it: the reconciler is ordered after the mount, and sshd and mosd
  after the reconciler. A unit that read shadow during the local mount phase
  would see a missing file rather than a wrong one, which is the safe failure.
- `/etc/.pwd.lock` stays on the read-only squashfs, so the `shadow` suite's
  locking is unavailable on device. Nothing here depends on it: the reconciler
  and mosd both write by temp-file + atomic rename, which needs no lock file.
  `docs/design/ro-root.md` already records `.pwd.lock` writes as failing
  silently with nothing depending on them.
- On-device behaviour (a real boot, a real ssh password login) is the **user's**
  acceptance. It was not and cannot be executed here.

## Files changed

- `os/rootfs/Dockerfile.v2` — pack-stage symlink + factory copy + build-time gate; overlay chmod/enable for the new unit and script
- `os/rootfs/overlay-v2/usr/lib/mos/mos-shadow-reconcile` — NEW
- `os/rootfs/overlay-v2/etc/systemd/system/mos-shadow-reconcile.service` — NEW
- `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-state` — first-boot seed call
- `os/verify-image-v2.sh` — the v2 assertions
- `os/verify-image.sh` — the no-baked-credential assertion only
- `docs/task/RFCT-029.md` — this record
