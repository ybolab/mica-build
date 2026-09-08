# Native applications on mos

A native application on mos is code that is **in the image**. It is built into
a Debian package at build time, composed into the verity-sealed root with
everything else, started by systemd as an ordinary unit, and replaced only by
a signed A/B system update. There is no `apt` on the device and no way to
install one later; that is a property of the product, not a gap waiting to be
filled.

This document is the integrator's guide to that path.
[containers.md](containers.md) is the guide to the other one, and the choice
between them is [../user/applications.md](../user/applications.md).

Everything cited here is linked into the source tree rather than transcribed
out of it, because `docs/verify-links.sh` resolves those links and fails
`make docs-verify` when one of them stops existing. The files are the
examples; this document is the map.

---

## 1. The one question

**Does this code have to move with the system update, or on its own
schedule?** Native means the first. Three consequences follow, and each of
them is checkable rather than a matter of taste:

- **One release, one artifact.** The application's version is the image's
  version. There is no separate application version to report, no way to ship
  a fix without shipping an image, and no combination of application and OS
  versions in the field that was not built and tested together.
- **Rollback is the slot's.** An A/B rollback takes the application back with
  the OS, in one atomic step, because they are the same filesystem.
- **A failure is the boot's.** A native unit that fails after an update fails
  the health gate, and a boot that does not reach `mark-good` is rolled back
  by the U-Boot attempt counter. See section 6.

If any of those three reads as a cost rather than a guarantee, the
application belongs in a container.

## 2. A package is a producer

The root filesystem is composed from a local Debian pool in one APT
transaction onto a pinned base. Adding a native application means adding a
**producer** to that pool — not editing a build stage.

A producer is one directory holding `producer.env` and a `Dockerfile`, found
anywhere in the tree; first-party ones live under
[`pkgs/*/deb/`](../../pkgs/mosd/deb) and
[`rootfs/packages-src/`](../../rootfs/packages-src), and board-specific ones
under `boards/<board>/deb/`. `producer.env` declares what the producer emits,
which architectures it emits for, and — per package — how many
`multi-user.target.wants` symlinks the archive is supposed to ship. The full
contract, including the control template, the version stamp, the `PREPARE`
hook and the pre-flight, is
[`build-env/deb/README.md`](../../build-env/deb/README.md), and it is not
restated here.

What is worth knowing before writing one:

- **`make os-deb-<producer>` needs no registration.** The target is a pattern
  rule resolved through `build-env/deb/producers.sh`; creating the directory
  is the whole of "adding a component".
- **Compilation is not packaging.** The packer image carries `dpkg-dev` and no
  compiler. Building the binary happens in the `PREPARE` hook, on the host,
  before the build — which is also why a cross-compiled `arm64` payload has to
  be packed inside an `arm64` container, so that `dpkg-shlibdeps` resolves
  against the right libraries.
- **The gate reads the archive, not a list.** `tests/deb-package-gate.sh`
  asserts unique file ownership across the pool, one version stamp across it,
  a `copyright` file per package, and the declared enablement symlink count
  per package. A dependency on another local package must be pinned to the
  exact pool version.
- **Anything `dpkg-shlibdeps` cannot see is written out by hand.** A program
  `exec`ed by name, a library opened with `dlopen`, a `useradd` in a
  maintainer script: ELF metadata does not carry those, so the control
  template does.

## 3. The unit, and what starts it

The package ships the binary, its unit, and — if it is meant to start at boot
— its own enablement symlink. `ENABLEMENT` in `producer.env` declares the
count, and a package that ships no link writes `0` rather than being left
out, so that an omission and a decision cannot look alike.

Two ordering facts are mos-specific and both are load-bearing:

- **`RequiresMountsFor=`** is how a unit says it must not start before the
  partition it writes to is mounted. STATE and DATA are bind mounts brought up
  during boot, and a daemon that starts ahead of them writes to the read-only
  root or to a tmpfs standing in for storage — which works, and then loses
  everything at the next power cycle.
  [`pkgs/mosd/dist/apid.service`](../../pkgs/mosd/dist/apid.service) carries
  the worked case and says in place why.
- **The unit cannot be edited on the device.** The root is an immutable
  dm-verity squashfs, and `systemctl edit` has nowhere to write. Anything that
  differs per device — a broker address, a site identifier — is read at
  runtime from a file on STATE, with the unit carrying only the fallback.
  [`pkgs/mosd/mqttd/dist/mos-mqttd.service`](../../pkgs/mosd/mqttd/dist/mos-mqttd.service)
  is the pattern: `EnvironmentFile=-` for the optional STATE file, defaults in
  `Environment=` lines, and the same defaults restated in the binary's own
  argument parsing so that a wiped environment cannot silently change the
  mode the daemon runs in.

## 4. A dedicated user

Run the application as its own static system account, created by the
package's `postinst` with `useradd`/`groupadd` and a `passwd` dependency
written out in the control template. The worked example is the
[mqtt producer](../../pkgs/mosd/deb/mqtt).

**Static, not `DynamicUser=yes`**, and the reason generalises beyond the case
that forced it. A D-Bus policy file resolves `<policy user="...">` when
`dbus-daemon` reads it at startup, which is before any dynamic user for that
unit exists — so a rule naming a dynamic user parses, loads, and matches
nothing. A grant that cannot match is worse than a missing grant, because in
a diff and in a review it reads exactly like a working one. The same argument
applies to anything that has to name the identity ahead of time: a udev rule
granting a device node, a `chown` in a maintainer script, an ACL on a STATE
directory.

`DynamicUser=` also implies `RemoveIPC=`, `PrivateTmp=` and a `UMask=`; a unit
that declines it should state those explicitly rather than lose them silently.

## 5. State and data

The four storage tiers and the rule for each are
[../user/storage.md](../user/storage.md). For a native application:

| Where | What belongs there | Survives an A/B update |
|---|---|---|
| `StateDirectory=` under `/var/lib` | configuration, identity, counters, small durable records | yes — `/var/lib/mos` is a bind of STATE |
| `/mos` | system-owned application data the product manages | yes — DATA |
| `/srv` | integrator files, application data, container volumes | yes — DATA |
| `/var` | logs, caches, anything reconstructible | **no** — EPHEMERAL, wiped by design |

`StateDirectory=` is the one to prefer for small durable state: systemd
creates the directory, sets its mode, and — with `ProtectSystem=strict` — it
is the only writable path the unit gets without naming another. Set
`StateDirectoryMode=` explicitly when the contents are secret; the systemd
default is `0755`.

Do not put an application's durable data on `/var`. It is 512 MiB, it is
disposable, and it is wiped deliberately. Storage that works for months and
is then gone with no error anywhere is the failure mode this rule exists to
prevent.

## 6. Health and logs

Logs go to the journal, which is on `/var` and therefore volatile. That is a
decision: a device that keeps every daemon's stdout forever fills the
partition its own updates need.

Health is where the native path differs most from the container one, and it
is worth being exact about what it does and does not promise — **it promises
less than it used to, deliberately** (PLAN-089).
[`rootfs/overlay/usr/lib/mos/mos-health`](../../rootfs/overlay/usr/lib/mos/mos-health)
runs once per boot, waits for systemd to settle, and confirms the booted slot
when a **required set** passes: the boot transaction finished, mosd answers on
`com.mos.mosd1`, apid answers on `/healthz`. The set is named by `require=`
lines in
[`/etc/mos/health.conf`](../../rootfs/overlay/etc/mos/health.conf). Everything
else the gate observes, **including a unit in the failed state**, is reported
and never fatal. A slot that is never confirmed is rolled back by the U-Boot
attempt counter.

Until PLAN-089 the rule was the inverse — any failed unit not named in a
`tolerate-failed` allowlist refused the slot, and that allowlist shipped empty.
It cost a cx3576 a boot credit on every boot for a oneshot that governs nothing
on that SKU. The criterion is now "can this slot be recovered", not "is
everything on this device working".

So a native application unit is **not** inside the update health gate. Three
things follow:

- **A crash loop after an update does not roll the device back.** It leaves a
  running, reachable, updatable device with a broken application on it — which
  is the better of the two failures, because the alternative is a device
  rolled into a slot that may not run either. Detect it with the health report
  and the diagnostics, and fix it with an update.
- **What an application CAN still fail is a required member.** A unit that
  takes the network down, wedges mosd, or takes port 443 away from apid fails
  the gate — not because it is an application, but because it removed the way
  in. `Type=notify` with a real readiness signal, and `WatchdogSec=` with a
  keepalive, are still how a unit tells systemd the truth about itself; they
  now inform the report rather than the verdict.
- **The required set is a build-time decision.** `/etc/mos/health.conf` is
  inside the read-only root, so what the gate requires is an image change that
  goes through review, not something set on a device after the fact. A conf
  with no `require=` line is REFUSED rather than read as "confirm anything":
  an empty required set would mean always-mark-good.
- **A failed unit is still visible.** The gate reports the count and the names
  to mosd at live-state `health.units`, one journal line per unit, and the
  entry ships in a diagnostic snapshot under `failures.health`.

## 7. Named hardware

Device access is systemd's, with nothing mos-specific over it:

- `DeviceAllow=` names the node and the access mode, and — with
  `PrivateDevices=` off for that unit — is what makes a device reachable from
  a unit that is otherwise sandboxed.
- `SupplementaryGroups=` is how a dedicated user reaches a node owned by a
  group such as `dialout`, without the node's ownership being changed.
- A **udev rule shipped in the package** is how a node gets a stable name and
  the right group in the first place. It needs the static account from
  section 4 to exist by the time it runs.
- `ConditionPathExists=` distinguishes "this board does not have that device"
  from "this unit is broken". The first should skip the unit; only the second
  should fail it — and only the second should fail the health gate in
  section 6.

Device names are board facts. Take them from the board's dossier under
[../bsp/](../bsp/cx3576-example.md) rather than from another board's unit;
[`boards/cx3576/hwinit/`](../../boards/cx3576/hwinit) is where the shipped
board-specific units live.

## 8. Ceilings

`CPUQuota=`, `MemoryHigh=`, `MemoryMax=`, `TasksMax=` and the
`IOReadBandwidthMax=`/`IOWriteBandwidthMax=` pair are the same kernel
controllers, spelled the same way, as in
[containers.md](containers.md) section 8 — a native unit reaches them
directly instead of through a generated one.

The reason to set them is not the application's own failure. It is that DATA
and `/var` are shared: a native daemon that leaks memory or logs without
bound takes down mosd, apid and the update path with it, and the first
symptom is a device that cannot be managed remotely to be fixed.

**Nothing requires them.** A unit with no ceilings is composed into the image
and started like any other. There is no admission step, and this document is
the only thing asking.

## 9. The update, and what does not roll back with it

A native application updates when the image does: the new root is written to
the inactive slot, the bootloader switches, and the binary, the unit and the
OS move together or not at all. Rollback is the same edge in reverse, and it
is automatic on a boot that fails the health gate
([../user/update-rollback.md](../user/update-rollback.md)).

**The code rolls back. The data does not.** STATE and DATA are outside the
A/B pair by design — that is what makes them survive an update — so an
application that migrated its own schema on first start after an update is,
after a rollback, an old binary pointed at new data. The A/B mechanism cannot
see that and will not warn about it.

This is the same hazard as the container one and it has the same owner: the
integrator writes migrations that the previous version can still read, or
keeps a copy it can restore, or accepts that the rollback restores service
rather than state. mos holds no opinion and offers no per-application
rollback of either kind.

## 10. The writable unit directory, and why it is not this path

`/usr/local/lib/systemd/system` is a bind of STATE
([`usr-local-lib-systemd-system.mount`](../../rootfs/overlay/etc/systemd/system/usr-local-lib-systemd-system.mount)),
and a unit dropped there survives a reboot and an A/B update. It exists, it
works, and it is deliberately **not** the supported way to deliver a native
application.

The reason is section 9 read backwards. A unit installed there is outside the
A/B pair, so it does not roll back when the system does: after a rollback it
is still running, still enabled, and now paired with an OS release it was
never built against. The failure is not a refusal — it is an application that
starts and behaves subtly differently, on a device that has already had one
bad day.

Use it for what it is good at: a debugging drop-in, a temporary unit during
bring-up, an override an operator installs knowingly and removes. Note also
that systemd reads it **below** `/etc/systemd/system` and `/run/systemd/system`
in the unit load path, so it cannot override a unit mos ships — which is
intentional.

## 11. What is not enforced

Stated plainly, because everything above is documentation and tested
convention rather than a mechanism that refuses:

- **Nothing signs a separately installed unit.** Image content is covered by
  the RAUC bundle signature and dm-verity; a file written into
  `/usr/local/lib/systemd/system` or the Quadlet directory on a running
  device is covered by neither.
- **No ceiling is mandatory.** Sections 8 and containers.md section 8 describe
  what to set; nothing checks that anything was set.
- **There is no secret store.** A native application's credentials are files
  the package or the operator puts on STATE, owned by root or by the
  application's account, and mos does not create, rotate, escrow or audit
  them.
- **There is no per-application rollback.** Native code inherits the whole-slot
  A/B rollback, which is not the same promise: it moves every application on
  the device, and it moves none of their data.

The controls that would change these answers — signed independent bundles,
admission that can refuse a unit, non-bypassable ceilings, a protected secret
store, per-application health-gated rollback — are a separate product with a
separate cost, and are left to [PLAN-069](../plan/PLAN-069.md) rather than
designed here.
