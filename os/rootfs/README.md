# os/rootfs — Debian systemd arm64 rootfs (cx3576)

Builds a minimal Debian trixie + systemd root filesystem for the cx3576 board
as a squashfs + dm-verity slot image, ready to be written into an A/B rootfs
slot by the assembly step.

The v1 single-slot chain this directory started as — `build.sh`, `Dockerfile`,
and the `os/mkimage.sh` / `os/verify-image.sh` that consumed them — was deleted
by RFCT-107 (PLAN-014 M1); git history is its archive. The sections up to
"Layout v2" below describe the parts of the build that were never generation-
specific: the package set, the config directories, the image profile, mosd and
the board hardware-init layer.

## Package allowlist

Only: systemd systemd-sysv systemd-resolved udev dbus kmod openssh-server
iproute2 bluez rfkill wpasupplicant hostapd (plus their hard dependencies). Do
not add packages without updating this list.

bluez and rfkill exist for the board hardware-init layer (btattach + rfkill
unblock in `mos-bt`); with their new dependencies (libglib2.0-0, libdw1,
libelf1) they add about 11 MB of installed size (TOTAL_MB 204, budget 400) —
see `rootfs-report.txt`.

- **`wpasupplicant`** — the WiFi station role. mosd's `wifi_client` reconciler
  renders `/etc/wpa_supplicant/wpa_supplicant-<iface>.conf` and drives
  `wpa_supplicant@<iface>.service`. Both are the package's own contract, not a
  preference: the template's `ExecStart` has
  `-c/etc/wpa_supplicant/wpa_supplicant-%I.conf` baked in, so the file name and
  the unit name have to agree with mosd's or the supplicant starts against a
  configuration that is not there. Without this package `wifi.client` renders a
  file nothing reads and enables a unit that does not exist — which systemd
  reports on the device and nowhere else.
- **`hostapd`** — the provisioning access point. mosd's `wifi_ap` reconciler
  renders `/etc/hostapd/<iface>.conf` and drives `hostapd@<iface>.service`,
  whose `ExecStart` is `/usr/sbin/hostapd -B -P /run/hostapd.%i.pid $DAEMON_OPTS
  /etc/hostapd/%i.conf`. This is the path a device with no uplink is configured
  through, so "present but not wired" is the expensive failure here.

Deliberately **not** added: `dnsmasq`. The AP hands out addresses through
systemd-networkd's own `DHCPServer=yes`, which is already in the image and
whose lifecycle is the networkd reload the AP address needs anyway.

### Both connd packages ship an enabled unit that has to be masked

Measured on `hostapd` / `wpasupplicant` 2:2.10-12+deb12u3 arm64 (`dpkg -L`, and
the postinst's links under `/etc/systemd/system/multi-user.target.wants/`), not
assumed:

| Unit | Ships | Enabled by the package | What the image does |
|---|---|---|---|
| `wpa_supplicant@.service` | yes, `-c/etc/wpa_supplicant/wpa_supplicant-%I.conf` | no | left installed and unenabled — mosd owns it |
| `hostapd@.service` | yes, `… /etc/hostapd/%i.conf`, `ConditionFileNotEmpty=/etc/hostapd/%i.conf` | no | left installed and unenabled — mosd owns it |
| `hostapd.service` | yes, non-templated, reads `/etc/hostapd/hostapd.conf` | **yes** | **masked** |
| `wpa_supplicant.service` | yes, D-Bus mode, no condition | **yes** | **masked** |
| `dbus-fi.w1.wpa_supplicant1.service` | `Alias=` link created by the postinst | — | **masked** (same unit under another name) |

`hostapd.service` is condition-gated on `/etc/hostapd/hostapd.conf` being
non-empty, so today it does not actually start — but that is one operator `cp`
away from a second hostapd fighting the reconciler for the radio while
`hostapd@wlan0.service` still reports healthy. `wpa_supplicant.service` has no
condition and does start; it also carries `RuntimeDirectory=wpa_supplicant`, so
systemd deletes `/run/wpa_supplicant` when it stops — taking the control socket
of the templated instance mosd started with it.

Masked rather than disabled because `wpasupplicant` ships
`/usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service`: a plain
`systemctl disable` leaves the D-Bus activation path open, and masking does not.

### Config directories

`/etc/wpa_supplicant` and `/etc/hostapd` are both mode **0700** — once a device
is configured they hold pre-shared keys in the clear. The root is a read-only
dm-verity squashfs, so each is a STATE-backed bind
(`etc-wpa_supplicant.mount`, `etc-hostapd.mount`) exactly as `/etc/ssh` is; a
reconciler rendering into a read-only path fails on device and nowhere else.

## Image profile (`/usr/lib/mos/profile.conf`)

`MOS_PROFILE=dev` by default; `MOS_PROFILE=prod bash os/rootfs/build-v2.sh`
builds the production image from the same tree. The build rejects anything that
is not exactly `dev` or `prod` in lowercase.

mosd reads this file once, on first boot, to seed `access.ssh.enabled`, and it
**fails closed**: a file that is missing, unreadable, misspelt or carrying an
unrecognised value all resolve to `prod`, which means SSH off. The comparison is
case-sensitive, so `DEV` resolves to prod too. Every one of those mistakes
produces an image where all the checks are green and the dev SSH path has simply
disappeared, which is why the value is validated at build time and asserted
again by `os/verify-image-v2.sh` against the packed
artifact — including that `dev` implies `ssh.service` is enabled in the image
and `prod` implies it is not.

The file lives in `/usr/lib` and not `/etc` because it describes the *image*,
not the device; that also puts it inside the read-only verity root, where a
production device cannot be edited into a development one.

## mosd

The mos management daemon is cross-built on the host
(`mosd/hack/build-aarch64.sh`, rust target `aarch64-unknown-linux-gnu` linked
with `aarch64-linux-gnu-gcc`) and installed into the rootfs:

- `/usr/bin/mosd` — aarch64 release binary
- `/usr/lib/systemd/system/mosd.service` — enabled via the
  `multi-user.target.wants` symlink
- `/usr/share/dbus-1/system.d/com.mos.mosd.conf` — D-Bus system bus policy
  (com.mos.mosd is root-only)
- `/usr/share/dbus-1/system.d/com.mos.ext.conf` — D-Bus system bus policy
  granting `own_prefix="com.mos.ext"` (v2 only), so integrator-installed
  extension units can own `com.mos.ext.*` names; system names stay closed
- `/var/lib/mos` — daemon state directory

No new apt packages: mosd only needs `dbus` and `systemd`, both already in the
allowlist. Set `WITH_MOSD=0` to build the rootfs without mosd (default is on).

## Board hardware init

Generic, board-agnostic mechanism in `os/hwinit/` (six best-effort units +
scripts); board-specific facts (module names, sysfs paths, UART device, CAN
defaults, MAC seed, gadget IDs) in conf files staged from `BOARD_DIR/init/`
(falling back to the in-repo `board/cx3576/init/`) into `/etc/mos/`. Every unit
is condition-gated on its conf file and never blocks, delays, or fails the
boot; WiFi association / BT pairing stay with connd. The units are enabled via
`multi-user.target.wants` symlinks like mosd.

| Unit | Conf | Does |
|---|---|---|
| `mos-modules` | `modules.conf` | `modprobe -q` the board's hardware modules; a module for an absent SKU is skipped |
| `mos-otg` | `otg.conf` | write the USB OTG role to its syscon node (`/etc/mos/otg-mode` overrides) |
| `mos-can` | `can.conf` | set bitrate / restart-ms / CAN FD and bring the interface up |
| `mos-bt` | `bt.conf` | rfkill unblock + `btattach` on the configured UART (ordered after `mos-modules`) |
| `mos-mac` | `mac.conf` | give every `eth*` with a kernel-random MAC a stable address derived from a hardware identity |
| `mos-gadget` | `gadget.conf` | build the CDC ACM debug console gadget and bind it to the UDC |

`mos-mac` exists because neither cx3576 NIC has a MAC in hardware, so the
kernel invents a random one on every boot: gmac0/eth0's dts node carries
neither `mac-address` nor `nvmem-cells`, and the PCIe RTL8168 has no EEPROM.
The address is derived as `02:` + `md5(seed + ifname)`, with the seed being the
eMMC CID — a read-only chip register that is unaffected by reflashing the
media, so a board keeps its MACs (and DHCP reservations) across image updates.
Interfaces whose `addr_assign_type` is not `NET_ADDR_RANDOM` are left alone,
and the unit is ordered before `network-pre.target` so networkd configures the
final addresses. The SoC OTP CPUID would be a deeper root of identity but has
no dts node in this tree and no hardware validation.

`mos-gadget` gives the board an out-of-band console: with the OTG port in `otg`
role the PHY enumerates as a device when a host PC is plugged in, and a udev
rule (`60-mos-gadget-getty.rules`) pulls in `serial-getty@ttyGS0` when the port
appears. The gadget serial number reuses the `mac.conf` seed, so USB identity
is stable too.

The Bluetooth adapter name needs no unit of its own: bluez's hostname plugin
is loaded by default and overrides `Name`, so the adapter follows the system
hostname as long as `/etc/bluetooth/main.conf` does not pin one.

---

# Layout v2 — squashfs + dm-verity rootfs (PLAN-010 M4)

`build-v2.sh` / `Dockerfile.v2` / `overlay-v2/` are the build. The design record
is `docs/design/ro-root.md` — read it before changing anything here.

## Build

```sh
# needs board/cx3576/out/kernel/modules.tar (make -C board/cx3576 kernel),
# or point BOARD_DIR at prebuilt BSP artifacts:
BOARD_DIR=/srv/ai/mos/board/cx3576 make os-rootfs-cx3576-v2   # rootfs only
BOARD_DIR=/srv/ai/mos/board/cx3576 make os-image-cx3576-v2    # rootfs + full v2 image
```

On x86 hosts, arm64 emulation comes from binfmt
(`docker run --privileged --rm tonistiigi/binfmt --install arm64`). If the
current builder still lacks linux/arm64 (e.g. host binfmt registration is
unavailable), `build-v2.sh` automatically falls back to a docker-container
builder named `mos-arm64`, whose buildkit image bundles its own QEMU emulators.

Outputs to `_out/cx3576/`, all consumed by `os/mkimage-v2.sh`:

| File | Contents |
|---|---|
| `rootfs-verity.img` | squashfs-zstd with the dm-verity hash tree appended, padded to a whole MiB |
| `rootfs-verity.env` | verity parameters as strict `KEY=value` |
| `boot-cmdline-a.txt` / `-b.txt` | the full kernel `append` line for each slot |
| `rootfs-report-v2.txt` | package list, installed size, setuid/setgid inventory, file capabilities |

Every layout constant is read from `os/layout/cx3576-v2.env`; none is duplicated
in `build-v2.sh`, `Dockerfile.v2` or the overlay. The board console/storage
cmdline fragment (`console=ttyFIQ0,… earlycon=… net.ifnames=0`) is a board fact
too and lives there as `BOARD_CMDLINE_ARGS`, moved out of `build-v2.sh` when
x64 became the second board to need a v2 image.

### The cmdline files are a contract

`os/mkimage-v2.sh` does not re-derive the verity table: it lifts the
`dm-mod.create="..."` and `dm-mod.waitfor=` fragments straight out of these two
files with `sed` and writes them into each boot slot's `mos-verity.env`, next to
the shared `boot.scr`. (The v2 slots carry no `extlinux.conf` — U-Boot tries
extlinux before `boot.scr`, which would bypass the RAUC A/B handshake.) So:

- `dm-mod.waitfor=PARTUUID=<that slot's rootfs GUID>` is **required**, and the
  assembler fails the build without it. `dm_init_init()` is a `late_initcall`
  and its `wait_for_device_probe()` does not cover eMMC card discovery.
- The `dm-mod.create=` table must be double-quoted, with the spaces inside the
  quotes.
- GUIDs are **lowercase** everywhere — cmdline and `fstab` alike — matching
  udev's `by-partuuid` symlinks, which libblkid formats lowercase. The kernel
  compares with `strncasecmp` and accepts either.
  `os/mkimage-v2.sh` cross-checks the cmdline against the layout env's
  uppercase `ROOTFS_x_GUID` case-insensitively (RFCT-020), so the two spellings
  coexist by design. Do not "reconcile" them by uppercasing the cmdline.

## Pack

Three steps: `mksquashfs -comp zstd -Xcompression-level 19 -noappend
-no-exports -mkfs-time <FILE_MTIME> -all-time <FILE_MTIME> -processors 1`, then
the ownership gate, then `veritysetup format` against the same file with
`--hash-offset=<squashfs bytes>`, the pinned `VERITY_SALT` and a pinned
`--uuid`. `-processors 1` and the two pinned UUID/salt values are what make the
image byte-reproducible; see the determinism table in
`docs/design/ro-root.md`.

**No `-all-root`** (and no `-force-uid`/`-force-gid`). Those rewrite ownership
but not mode bits, so every setgid binary whose group was not root ships
setgid-**root** — `ssh-agent`, `chage`, `expiry`, `unix_chkpwd`,
`dbus-daemon-launch-helper`. Ownership does not need forcing to be
deterministic: it comes from a pinned base image and a pinned package set.
Step 2 of the pack diffs the packed image's setuid/setgid inventory against the
source tree's and **fails the build** on any difference, so re-adding the flag
is a build error rather than a review finding. The verified inventory is in
`rootfs-report-v2.txt`.

## v2 package allowlist

The base list (systemd systemd-sysv systemd-resolved udev dbus kmod openssh-server
iproute2 bluez rfkill wpasupplicant hostapd — the two connd packages, their
masking and their config directories are documented under "Package allowlist"
above and apply identically here) **plus**:

- **`rauc`** — the update client itself. Required by RFCT-014 (slot definitions,
  `system.conf`) and RFCT-015 (install flow). Installed here so no other task
  has to touch a Dockerfile.
- **`rauc-service`** — the D-Bus service half. **Not optional, and not pulled in
  by `rauc`**: Debian splits the project in two, and `rauc` neither Depends on
  nor Recommends `rauc-service` (`rauc` 1.8-2 lists no `Recommends` at all).
  Debian's CLI is built *with* service support, so it never operates locally —
  it proxies every call over D-Bus. With `rauc` alone the image has no
  `de.pengutronix.rauc.conf` policy and no `de.pengutronix.rauc.service`
  activation file, so `rauc status` fails with *"The name de.pengutronix.rauc
  was not provided by any .service files"*, the health gate can never mark the
  slot good, and every update rolls back. 47 KB.
- **`libubootenv-tool`** — provides `fw_printenv` / `fw_setenv`. RAUC's U-Boot
  backend needs it, and so does the first-boot machine-id oneshot (RFCT-015).
- **`curl`** — the health gate's apid probe (`os/health/mos-health`) fetches
  `https://127.0.0.1/healthz`. It prefers `curl`, falls back to `wget`, and
  SKIPs when neither is present. `rauc` links libcurl but does not ship the
  binary, so without this package the gate reported green while covering two of
  its three components instead of three — a probe that skips is not a probe that
  passes. One line to revert if the size budget is ever revisited.

Deliberately **not** added: `squashfs-tools` and `cryptsetup-bin`. Packing the
root is a build-stage job (they are installed in `Dockerfile.v2`'s pack stage
only), and the kernel opens the verity device straight from `dm-mod.create=`
with no userspace tool involved.

Installed size: **217 MB against the 400 MB budget** (v1 is 204 MB). rauc,
rauc-service, libubootenv-tool and curl plus their dependencies account for the
13 MB; the budget is unchanged. `rauc-service` is 47 KB by dpkg Installed-Size,
which is below the megabyte rounding of `TOTAL_MB` — it did not move the number. curl's own chain is about 1 MB of that (`curl` 537 KB,
`libcurl4` 860 KB, `libssh2-1` 345 KB, `libnghttp2-14` 228 KB, `libpsl5` 152 KB,
`librtmp1` 142 KB, per `rootfs-report-v2.txt`).

## Read-only root wiring (`overlay-v2/`)

Staged into the build context by `build-v2.sh`, with `*.in` templates rendered
from the layout env so the shipped image carries no placeholder:

| Path | Purpose |
|---|---|
| `etc/fstab.in` | `/srv` from DATA (`noatime,x-systemd.growfs`), `/mnt/state` from STATE, `/mnt/meta` from META, `/var` from EPHEMERAL (`noatime`, **no** growfs), tmpfs `/tmp` — all keyed on lowercased `PARTUUID=` |
| `etc/fw_env.config.in` | the redundant U-Boot env pair, addressed by partition GUID. The single `fw_env.config` source in the tree; RFCT-014's `render-config.sh` asserts its structure rather than shipping a competing file |
| `etc/repart.d/*.conf` | eight definitions in disk order; only `80-data.conf` grows. v1's root-growing definition is gone. The two `uenv` placeholders carry `SizeMinBytes=0`: repart will not claim an EXISTING partition below the definition's minimum, which defaults to 10 MiB, and the uenv pair is 64 KiB — without it the whole run aborts with *"Can't fit requested partitions into available free space"* and `/srv` never grows (RFCT-027) |
| `etc/tmpfiles.d/mos-var.conf` | age policies for `/var/tmp` and `/var/cache` — `/var` is now a fixed-size partition |
| `etc/systemd/system/mos-seed-var.service` | first-boot restore of `/var` from `/usr/share/factory/var` |
| `etc/systemd/system/mos-seed-state.service` | STATE directories + per-device sshd host keys; convergent, runs every boot (no run-once stamp — a stamp would stop a later image from seeding a STATE directory it introduces) |
| `etc/systemd/system/var-lib-mos.mount` | binds `/mnt/state/mos` onto `/var/lib/mos` so mosd's paths are unchanged |
| `etc/systemd/system/var-lib-bluetooth.mount` | binds `/mnt/state/bluetooth` onto `/var/lib/bluetooth` so pairings survive a `/var` wipe |
| `etc/systemd/system/etc-ssh.mount` | binds `/mnt/state/ssh` onto `/etc/ssh` |
| `etc/systemd/system/etc-hostname.mount` | binds `/mnt/state/hostname` onto `/etc/hostname`, so mosd's hostname reconciler can persist a change |
| `etc/systemd/system/etc-wpa_supplicant.mount` | binds `/mnt/state/wpa_supplicant` onto `/etc/wpa_supplicant`, the path `wpa_supplicant@.service` reads and the station reconciler writes |
| `etc/systemd/system/etc-hostapd.mount` | binds `/mnt/state/hostapd` onto `/etc/hostapd`, the path `hostapd@.service` reads and the AP reconciler writes |
| `etc/systemd/system/usr-local-lib-systemd-system.mount` | binds `/mnt/state/systemd-units` onto `/usr/local/lib/systemd/system`, the writable unit directory PLAN-011 D5 gives integrators. Empty in the Debian base, so nothing is seeded into it; `/etc/systemd/system` was rejected as the target because a bind there hides the boot chain's own units and their `local-fs.target.wants` enablement. The mountpoint is created by the pack stage — a verity root cannot make it at runtime |
| `etc/systemd/system/mos-apply-hostname.service` | re-applies the persisted hostname after the bind — PID 1 read the squashfs copy long before mount units ran |

Six hwinit units (`mos-modules`, `mos-otg`, `mos-can`, `mos-bt`, `mos-mac`,
`mos-gadget`) are installed and enabled on the v2 path exactly as on v1; all of
them are read-only-root safe (they read `/etc/mos` and write only configfs and
sysfs). See `docs/design/ro-root.md` §6 for the one override that read-only
`/etc` does take away.
| `usr/lib/mos/mos-seed-*` | the two seed scripts |

`fstrim.timer` is enabled. Why all seven repart definitions are needed, why the
growth target moved off the root, and what happens to `/etc/machine-id` are all
explained in `docs/design/ro-root.md`.

## Board hardware init — the enable list is enumerated, not restated

`Dockerfile.v2` installs `hwinit-*`, `*.service` **and** `*.rules` from
`os/hwinit/`, and derives the enable list by iterating the units that are
actually present:

```
for f in /tmp/hwinit/*.service; do u="$(basename "$f")"; ln -sf ... ; done
```

This is not a style preference. The previous hardcoded
`for u in mos-modules mos-otg mos-can mos-bt` list is exactly how this file
drifted behind the since-deleted v1 `Dockerfile` once already: when `mos-mac` and
`mos-gadget` were added, both were *installed* by the existing globs but never
*enabled*, and `60-mos-gadget-getty.rules` was not installed at all — so a v2
image silently lost its stable MAC and its USB debug console with no error
anywhere. Adding a unit to `os/hwinit/` is now sufficient; the build also
asserts at least one unit was enabled, so a glob that matches nothing fails
loudly.

No board fact is restated in the v2 layer. Module names, sysfs paths, UART
device and speed, CAN bitrate and FD flag, MAC seed and gadget IDs all live in
`BOARD_INIT_DIR` and are staged verbatim into `/etc/mos`, where the units read
them at runtime.

## RAUC system.conf is rendered, not committed

`os/rootfs/overlay-v2/etc/rauc/system.conf` is **generated** by
`os/rauc/render-config.sh` (RFCT-014's renderer, which owns the template and
its assertions) and is gitignored. `build-v2.sh` runs the renderer before
staging the overlay, so the template plus `os/layout/cx3576-v2.env` are the
single source of truth and the rendered file cannot drift from them.

`os/bundle.sh` still runs `render-config.sh --check`. It now guards a narrower
case — someone hand-editing the generated file after the last build — rather
than committed-copy drift, which can no longer happen. Note that `bundle.sh`
consumes `rootfs-verity.img` too, so `build-v2.sh` has necessarily run first
and the file is present.

## systemd-repart is a package of its own on trixie

**"Zero extra packages" was true on bookworm and is not on trixie**, which is
a fact worth stating rather than quietly editing: bookworm shipped
`systemd-repart` inside the `systemd` package, trixie splits it into a package
of its own. `os/rootfs/Dockerfile.v2` names it in the install list because of
that, and `os/verify-image-v2.sh` asserts the enablement symlink. The failure
if it were missing announces nothing — the device boots and DATA simply never
grows past the 64 MiB the assembler creates.

## Storage tiers, and the /var contract

`/srv` (DATA) grows to fill the media and holds the application data worth the
disk. `/mnt/state` (STATE) holds configuration and identity. `/mnt/meta` (META)
holds update metadata. `/var` (EPHEMERAL) is **fixed-size disposable residue** —
logs, caches, package bookkeeping — and wiping it is a supported recovery
action.

That contract is enforced, not just documented: the pack stage fails the build
unless every precious path under `/var` is redirected onto STATE by an enabled
bind mount whose mountpoint exists in the factory `/var`. Today that covers
`/var/lib/mos` (mosd settings, apid credentials) and `/var/lib/bluetooth`
(pairing keys), plus an assertion that journald is `Storage=volatile` and that
`/var/lib/dbus/machine-id` is a symlink rather than a baked per-image identity.
The rule is: **identity, credentials, pairings and update state never live on
`/var`**. Full audit in `docs/design/ro-root.md` §4.

The DATA constants (`DATA_GUID`, `DATA_PARTNUM`, `DATA_FS_UUID`,
`MOS_VAR_MIB`) are **required**: `build-v2.sh` fails if any is missing from
`os/layout/cx3576-v2.env`. There is deliberately no fallback. A build that
quietly emitted the superseded nine-partition arrangement — `/var` growing, no
`/srv` — would pass every downstream check, which is precisely the class of
silent-wrong-artifact this layout work exists to prevent.

## CJK guard

The pack stage runs a CJK check over the mos-owned paths — the overlay's mount
units, seed scripts, `repart.d` definitions, `fstab` and `fw_env.config`.
Vendor packages ship translations and are deliberately not scanned.

## Dev root access on v2

There is **no baked root credential on v2, ever** — not for the dev profile
either. A v2 rootfs is byte-identical on every device that flashes it, so any
usable hash in the image is a fleet-wide shared secret; the pack stage asserts
the factory shadow carries only locked markers and **fails the build**
otherwise, which is why `build-v2.sh` has no `ROOT_PASSWORD` plumbing at all.

What a developer actually gets on v2:

- **A transient root password**, set at runtime through mosd
  (`SetTransientRootPassword`, driven from apid's admin UI). It lands in the
  STATE-backed `/etc/shadow` and works for SSH (while enabled) and the serial
  console alike; `mos-shadow-reconcile` clears it on the next boot, which is
  what makes it transient. See `docs/design/access.md` §4.1.
- **The serial console**, whose getty is always there but whose root account
  stays locked until such a password is set.
- **Persistent access by SSH public key**, via the settings tree — the
  supported long-term path; every authorized key is a root key.

## Determinism, and what still deviates

Two cache-hot `make os-rootfs-cx3576-v2` runs produce a byte-identical
`rootfs-verity.img`. sshd host keys are **not** baked into the image — they
would be a private key shared by every device and would change the verity root
hash on every cold build; `mos-seed-state` generates them per device on first
boot instead.

What still deviates on a cold build: the byte layout depends on the
`squashfs-tools` and `cryptsetup` versions pulled from `debian:bookworm-slim` in
the pack stage. Pinning that base image by digest is the follow-up.
