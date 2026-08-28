# RFCT-099 Remove package management from the packed root, and keep the licence texts

- **status**: completed — implementation complete, image verify 371/371, `os/ui-location-test.sh` 43/43 cases; rootfs 227 MB → 203 MB
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-23 09:40
- **claimedAt**: 2026-08-23 09:40

The v2 root is a read-only dm-verity squashfs and updates arrive as whole RAUC
slots. Nothing on the device can install a package — yet the image shipped
`apt`, `dpkg`, `perl-base`, `debconf` and their databases, because
`debian:bookworm-slim` brings them and nothing removed them.

Two costs, and the second is the one that matters: ~24 MB of weight that
cannot be used, and a working package manager for anyone who reaches a shell
on an appliance whose entire security model is that its root cannot change.

## What shipped

A purge step in `os/rootfs/Dockerfile.v2`, placed after the package inventory
(`dpkg-query` needs `/var/lib/dpkg`) and before the `TOTAL_MB` measurement, so
the budget gate in `build-v2.sh` weighs the root that actually ships rather
than the one that was built. The report's package list is captured first and
kept: it is the inventory of what was installed, which the capability check
still leans on.

Removed: the `apt` and `dpkg` binaries and libraries, their state under
`/var/lib`, `/var/cache` and `/etc`, `perl-base`, `debconf`, `gpgv`, and every
script whose interpreter was perl. Measured result: **227 MB → 203 MB**.

**`openssh-client` and `coreutils` are kept, by decision.** `coreutils` is
17.6 MB and busybox would reclaim most of it, but every script in the image
and in the verifier would then run against different tool semantics — a
separate change with its own regression surface. `openssh-client` is 5.7 MB
and outbound `ssh`/`scp` is a field-support capability, not packaging residue.
Both are recorded in the Dockerfile so the next size pass does not read them
as oversights.

**`/usr/share/doc` is kept, and this is where the usual "slim image" recipe is
wrong.** Measured: 2.75 MB total, of which 2.06 MB is 159 `copyright` files —
the licence texts Debian ships to satisfy the redistribution terms of the GPL
and the other licences in the image. Deleting the directory saves 0.69 MB of
changelogs and breaches those terms to do it. An assertion now holds the
licences in place, with a negative control that removes them.

## Verification

**Three image assertions** in `check_no_package_manager`, written above the
fixture boundary so `os/ui-location-test.sh` can drive them without an image:
no package-manager binaries and no dpkg/apt state; the licence texts survived;
no script names a removed interpreter.

The first checks **both** `/var/lib/dpkg` and `/usr/share/factory/var/lib/dpkg`.
The pack stage relocates `/var` to the factory tree and `mos-seed-var` copies
it back on the first boot, so a check that looked only at `/var` would report
a clean root that repopulates itself. That case has its own negative control.

**Four negative controls**, each observed failing with its own message: apt
left in the root; the dpkg database left under the factory tree; the copyright
files removed; a perl script left behind after perl was removed.

Image verify **371/371**, `os/ui-location-test.sh` **43/43 cases**.

## The build-time self-check earned its place immediately

The purge asserts, in the same `RUN`, that the package managers are gone, that
a list of runtime-essential commands survived, that no dangling perl shebang
remains, and that the licence texts are still there. It is a build **failure**,
not a warning.

The first run failed on it. The survey that preceded the change had listed the
perl scripts under `/usr/bin` and was truncated by a `head -10` before it
reached `/usr/sbin`; the truncated list was read as complete. The build then
named all six that had been missed — `adduser`, `deluser`, `update-rc.d`,
`pam-auth-update`, `pam_getenv`, `dpkg-fsys-usrunmess`. Without the check they
would have shipped as scripts that fail at the moment they are invoked, with
an error about a missing interpreter rather than about the purge that caused
it.

Recorded because the surveying mistake is the one likely to repeat: **a
truncated listing and a complete listing look identical once the pipe closes.**

`adduser` and `deluser` turned out to be safe for a second, independent
reason: `/etc/passwd` is inside the read-only verity root — only `/etc/shadow`
is symlinked onto STATE — so no account can be created on a running device
whether or not the tool is present.

## Not claimed

**No on-device verification.** The evidence is the assembled image and the
offline fixture, not hardware.

**This is not the end of the size work.** `coreutils` (17.6 MB) and the
busybox question are untouched and deliberately out of scope. The remaining
inventory after this change is 203 MB against a 400 MB budget.
