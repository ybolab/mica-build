# RFCT-100 Move the packed root from Debian 12 to Debian 13, and unpin the checks that were pinned to 12

- **status**: implementation complete — image verify 371/371, `os/ui-location-test.sh` 43/43, `mosd/hack/check.sh` 506/506
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-23 11:10
- **claimedAt**: 2026-08-23 11:10

The v2 root was built on `debian:bookworm-slim`. **Nothing in the repository
argued for that choice** — every mention of bookworm in `docs/` is an
after-the-fact observation ("in Debian bookworm `fw_printenv` comes from
`libubootenv-tool`"), never a decision. The v2 base was set on 2026-08-18, by
which time trixie had been stable for a year. It was inheritance from v1, not
a decision, and the image was on oldstable because of it.

## What the upgrade broke, and what each one turned out to be

Four failures. **Three were checks pinned to bookworm; one was real.**

**1. uid 990 is taken by `sshd` on trixie.** It was free on bookworm, and
`mos-mqttd` was pinned to it by RFCT-097. Caught by the collision check that
task added — which is exactly why the check exists: without it `useradd` would
have failed, or worse succeeded at some other uid, leaving
`mosd/dist/mos-mqttd.conf` granting a uid the unit does not run as. The bridge
would then have connected to its broker and published nothing, with no error
at the point of cause. Moved to **970**, free on both releases and well below
the 999 that `useradd --system` allocates downward from.

**2. The licence assertion named `gcc-12-base/copyright`.** trixie ships
gcc-14. Now counts copyright files instead of naming a package.

**3. The purge list named `perl5.36.0`.** trixie ships 5.40. Now a glob.

**4. `systemd-repart` is a separate package on trixie.** This is the real one.
`docs/task/RFCT-008.md` recorded the bookworm fact as *verified* — "systemd-
repart ships inside bookworm's systemd 252 package; verified" — and the
upgrade invalidated it. Without the package the unit is absent, the
`sysinit.target.wants` symlink with it, and **DATA never grows past the 64 MiB
the image assembler creates**. Nothing about that failure announces itself:
the device boots and the partition is simply small. It is named in the install
list now, and the verifier's existing enablement assertion is what caught it.

## The lesson, written into the Dockerfile

Three of the four were assertions keyed to a version of the thing they were
checking. **A check pinned to a version of the thing it is checking fails on
the upgrade it exists to survive.** Both fixed checks now test the property —
a copyright count, a version glob — rather than a package that happened to be
in one release.

Two more assertions were widened for the same reason rather than repointed:

- `fw_setenv` is a **symlink to `fw_printenv`** on trixie (libubootenv now
  ships one multi-call binary) and was a second regular file on bookworm. The
  assertion is now that the path RESOLVES to a regular file, whichever way the
  packager spelled it — asserting "regular file" fails on a correct trixie
  image and asserting "symlink" fails on a correct bookworm one.
- `bluetooth.conf` moved from `/etc/dbus-1/system.d` to
  `/usr/share/dbus-1/system.d` — the general relocation of *vendor* D-Bus
  policy out of `/etc`, which belongs to the admin. mos's own policies already
  install to the `/usr/share` path; bluez caught up. Both are accepted, since
  dbus-daemon reads both.

## Re-measured rather than assumed to carry

PLAN-011 M5 bet the extension model on `/usr/local/lib/systemd/system` sitting
below `/etc` and `/run` in the unit load path, measured on systemd 252.
Re-measured on trixie's systemd 257: **unchanged** — `/etc` 5th, `/run` 7th,
`/usr/local/lib` 10th, `/usr/lib` 11th. The record in the mount unit and in
`docs/plan/PLAN-011.md` now carries both measurements rather than one that had
stopped describing the image.

`docs/design/ro-root.md`'s repart-walks-dm-verity note is marked as **owed**,
not done: the version string changed and the behaviour was not re-checked.
Recorded as an open item rather than silently re-dated.

## Result

| | bookworm | trixie |
|---|---|---|
| rootfs installed | 203 MB | 210 MB |
| systemd | 252 | 257 |
| podman available | 4.3.1 (no Quadlet) | 5.4.2 (Quadlet) |
| image verify | 371/371 | 371/371 |

The podman row is context, not a dependency: PLAN-012 builds the engine
statically from source and it is base-independent by construction.

## Not claimed

**No on-device verification.** systemd moved five major versions; the evidence
here is 371 image assertions and 506 host tests, and neither is hardware.

**The `pack` stage is still bookworm**, deliberately: it is build tooling that
never ships, and changing `mksquashfs`/`veritysetup` versions in the same
change would have made the root hash move for two reasons at once. It is a
separate change with its own evidence.
