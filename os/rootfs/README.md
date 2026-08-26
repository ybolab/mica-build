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

Board-agnostic mechanism, and since RFCT-111 M5d the CONTENT is filed per
board too: the units and their scripts come from `os/boards/<board>/hwinit/`
(six of each on cx3576; x64 has no such directory and stages an empty one), and
the board-specific facts they read — module names, sysfs paths, UART device,
CAN defaults, MAC seed, gadget IDs — come from conf files staged from
`BOARD_DIR/init/`, falling back to the in-repo `board/<board>/init/`, into
`/etc/mos/`. Both reach `stages/40-board` as staged directories
(`BOARD_HWINIT_DIR`, `BOARD_INIT_DIR`) because a `COPY` cannot be gated on an
`ARG`; until M5d the units were `COPY`d from `os/boards/cx3576/hwinit/` on every
board, so x64 carried all six and ran none. Every unit is condition-gated on its
conf file and never blocks, delays, or fails the boot; WiFi association / BT
pairing stay with connd. The units are enabled via `multi-user.target.wants`
symlinks like mosd.

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

`build-v2.sh` / `stages/` / `scripts/` / `overlay-v2/` are the build. The
design record is `docs/design/ro-root.md` — read it before changing anything
here.

## The build is a chain: `stages/`

There is no single `Dockerfile.v2` any more. `stages/` holds one Dockerfile per
stage — `10-base`, `20-install`, five `30-feature-*`, `40-board`, `90-pack` —
built in numeric order, each `FROM` the local image tag the previous one was
written to. `build-v2.sh` still stages the context and computes every argument;
sequencing is `os/build/run.sh --build-rootfs`.

**A feature is a file, so declining one is leaving the file out.** RFCT-111
replaced the `WITH_*` build arguments with stage selection: `--without
containers` builds a chain with no `31-feature-containers` in it, and the
driver refuses a name that matches no feature stage rather than silently
building the full image. `WITH_CONTAINERS=0` and `WITH_MOSD=0` still work —
`build-v2.sh` turns them into that flag — and `_out/<board>/rootfs-stages.txt`
records which features were declined, because an image built without a feature
stage and an image whose feature stage did nothing look identical afterwards.

`stages/README.md` is the file to read first: what the chain is, which stage
holds what, the one reordering the cut required and why, and the measurement
that the builder must use the `docker` driver.

## Where the shell is: `scripts/`

The stage files hold almost no shell. Every `RUN` body longer than one command
is a file in `scripts/`, reached by a bind mount that leaves nothing in the
image:

```dockerfile
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/<name>.sh
```

Build arguments still arrive through the environment, the way they always did,
so the scripts read `BOARD_RADIOS`, `MOS_ARCH`, `RAUC_BOOTLOADER` and the rest
unchanged. `WITH_CONTAINERS` and `WITH_MOSD` are no longer among them: they were
build arguments five scripts tested independently, and they are now the presence
of `31-feature-containers` and `33-feature-mosd` in the chain. The package lists and the single-command `RUN`s stayed in the stage
files: a stage's package set *is* the image, and a one-line `RUN` gains nothing
from a hop. `ARG` is per stage and now also per *file*, so an argument a stage's
`RUN`s read must be declared in that stage's file — `BOARD_RADIOS` is declared
twice for that reason.

`scripts/README.md` has the rest — why a mount and not a `COPY`, why these files
must stay POSIX `sh`, and how to check that a change to one of them is the
refactor it claims to be.

RFCT-111 M5a did this, so that M5b could split the single file into one
Dockerfile per stage: a stage boundary can only be drawn through shell that is
addressable. M5b then did the split.

## Build

```sh
# needs board/cx3576/out/kernel/modules.tar (make -C board/cx3576 kernel),
# or point BOARD_DIR at prebuilt BSP artifacts:
BOARD_DIR=/srv/ai/mos/board/cx3576 make os-rootfs-cx3576-v2   # rootfs only
BOARD_DIR=/srv/ai/mos/board/cx3576 make os-image-cx3576-v2    # rootfs + full v2 image
```

On x86 hosts, arm64 emulation comes from binfmt
(`docker run --privileged --rm tonistiigi/binfmt --install arm64`), and since
RFCT-111 M5b it is **required** for a cross build rather than optional.

What stood here said `build-v2.sh` falls back to a docker-container builder
whose buildkit image bundles QEMU, so host binfmt was not needed. That fallback
is gone, and the reason is measured: the chain resolves `FROM ${MOS_STAGE_PREV}`
against the **local docker image store**, and a `docker-container` builder
cannot read it — handed a tag that is present it answers `pull access denied,
repository does not exist`, about a registry. `build-v2.sh` now selects the
`default` (docker-driver) builder and refuses up front, with the `binfmt`
command, if it cannot reach the target platform. `stages/README.md` records the
measurement; `.gitea/workflows/privileged.yml` relied on the old fallback and
its note says so.

Outputs to `_out/cx3576/`, all consumed by `os/mkimage-v2.sh`:

| File | Contents |
|---|---|
| `rootfs-verity.img` | squashfs-zstd with the dm-verity hash tree appended, padded to a whole MiB |
| `rootfs-verity.env` | verity parameters as strict `KEY=value` |
| `boot-cmdline-a.txt` / `-b.txt` | the full kernel `append` line for each slot |
| `rootfs-report-v2.txt` | package list, installed size, setuid/setgid inventory, file capabilities |

Every layout constant is read from `os/boards/cx3576/board.env`; none is duplicated
in `build-v2.sh`, `stages/` or the overlay. The board console/storage
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
- **`curl`** — the health gate's apid probe (`os/rootfs/overlay-v2/usr/lib/mos/mos-health`) fetches
  `https://127.0.0.1/healthz`. It prefers `curl`, falls back to `wget`, and
  SKIPs when neither is present. `rauc` links libcurl but does not ship the
  binary, so without this package the gate reported green while covering two of
  its three components instead of three — a probe that skips is not a probe that
  passes. One line to revert if the size budget is ever revisited.

Deliberately **not** added: `squashfs-tools` and `cryptsetup-bin`. Packing the
root is a build-stage job (they are installed in `stages/90-pack.Dockerfile`'s
pack stage only), and the kernel opens the verity device straight from `dm-mod.create=`
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

`scripts/hwinit-install.sh` installs `hwinit-*`, `*.service` **and** `*.rules`
from `os/boards/<board>/hwinit/` — staged into `BOARD_HWINIT_DIR` — and derives
the enable list by iterating the board FACTS that are actually staged:

```
for c in /tmp/board-init/*.conf; do n="$(basename "$c" .conf)"; ... ln -sf ... ; done
```

This is not a style preference. The previous hardcoded
`for u in mos-modules mos-otg mos-can mos-bt` list is exactly how this file
drifted behind the since-deleted v1 `Dockerfile` once already: when `mos-mac` and
`mos-gadget` were added, both were *installed* by the existing globs but never
*enabled*, and `60-mos-gadget-getty.rules` was not installed at all — so a v2
image silently lost its stable MAC and its USB debug console with no error
anywhere. Adding `hwinit-<n>` plus `mos-<n>.service` under
`os/boards/<board>/hwinit/`, and an `<n>.conf` to the board, is sufficient.

**Both directions are asserted, and neither is a count.** A conf with no script
is an unread board fact and fails by name; a `/usr/lib/mos/hwinit-<n>` with no
`/etc/mos/<n>.conf` is a unit that can never run and fails by name. What is NOT
asserted at build time is the third direction — a board that declares
`BOARD_HWINIT_CONFS` and whose `init/` went missing stages no conf, installs no
unit, and the two counts agree at zero. That predates M5d, since `BOARD_INIT_DIR`
was already a staged directory, and `os/verify-image-v2.sh` holds it at image
level: it compares the declared facts against the installed helpers.

No board fact is restated in the v2 layer, and since M5d no board NAME is
either. Module names, sysfs paths, UART device and speed, CAN bitrate and FD
flag, MAC seed and gadget IDs all live in `BOARD_INIT_DIR` and are staged
verbatim into `/etc/mos`, where the units read them at runtime;
`stages/40-board` names no board at all, which `os/build/src/stages.test.ts`
asserts over every stage file.

## RAUC system.conf is rendered, not committed

`os/rootfs/overlay-v2/etc/rauc/system.conf` is **generated** by
`os/update/rauc/render-config.sh` (RFCT-014's renderer, which owns the template and
its assertions) and is gitignored. `build-v2.sh` runs the renderer before
staging the overlay, so the template plus `os/boards/cx3576/board.env` are the
single source of truth and the rendered file cannot drift from them.

`os/update/bundle.sh` still runs `render-config.sh --check`. It now guards a narrower
case — someone hand-editing the generated file after the last build — rather
than committed-copy drift, which can no longer happen. Note that `bundle.sh`
consumes `rootfs-verity.img` too, so `build-v2.sh` has necessarily run first
and the file is present.

## systemd-repart is a package of its own on trixie

**"Zero extra packages" was true on bookworm and is not on trixie**, which is
a fact worth stating rather than quietly editing: bookworm shipped
`systemd-repart` inside the `systemd` package, trixie splits it into a package
of its own. `os/rootfs/stages/10-base.Dockerfile` names it in the install list because of
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
`os/boards/cx3576/board.env`. There is deliberately no fallback. A build that
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

`cache-hot` is doing real work in that sentence and RFCT-111 measured how much.
**A cold x64 build does not reproduce itself.** M5a took three cold builds; M5b
took four more of the untouched single file — `1b3f5e50…`, `7aad6efd…`,
`55cf38f3…`, `af841f4f…` — and every one of the seven produced a different
`rootfs-verity.img` sha256. In every pairing the differing set was the same six
of 9,241 entries:

| Entry | Why it moves |
|---|---|
| `/boot/initrd.img-*` | `update-initramfs` does not compress reproducibly. The 961 files *inside* are identical between runs; only the container's bytes differ (three runs gave 37190070, 37189886 and 37189690 bytes) |
| `/usr/share/factory/var/log/dpkg.log` | records the wall-clock time of each of its 694 operations. Strip the timestamps and two runs are byte-identical: same operations, same order |
| `/usr/share/factory/var/log/apt/history.log`, `.../term.log` | same, `Start-Date`/`End-Date` |
| `/usr/share/factory/var/log/alternatives.log` | same |
| `/usr/share/factory/var/cache/ldconfig/aux-cache` | build-time cache |

They survive because the package-manager purge takes `/var/lib/dpkg` and
`/var/lib/apt` but not `/var/log`, and the pack stage then moves `/var` to
`/usr/share/factory/var` whole. Removing them would change image content, which
is outside PLAN-014's scope; this is recorded, not fixed.

**What this means for a byte-identity gate.** Changing the build necessarily
invalidates the layer cache, so "byte-identical before and after" cannot be
measured cache-hot — and measured cold it fails for the six reasons above
whether or not anything changed. A gate that compares sha256 across a build
change is measuring the clock. The gate that works: extract both images and
`diff -r --no-dereference` the trees, then check that the differing set is no
larger than the control's, where the control is two cold builds of the
*unmodified* file. `os/build/run.sh --build-rootfs --no-cache` exists so the
subject side can be cold without pruning the daemon's cache out from under
every other build on the machine.

### A SEVENTH ENTRY THE SIX-ENTRY CONTROL CANNOT SEE: the build DATE

M5b's control builds straddled midnight UTC and turned up an entry M5a's could
not, because both of M5a's ran on one day. Two builds on **different days**
also differ in

| Entry | What differs |
|---|---|
| `/usr/share/factory/etc/shadow` | `systemd-network`, `messagebus`, `systemd-resolve` and `sshd` carry LAST-CHANGE `20690` on 2026-08-25 and `20691` on 2026-08-26 |
| `/etc/shadow-` | the same four, plus `mos`'s own pre-`chage` row, which the backup keeps |

This is the exact failure `chage -d 2020-01-01` exists to prevent, and the
comments on the three mos accounts say so outright: *"useradd stamps TODAY into
it, which would make the packed rootfs — and therefore its dm-verity root hash
— differ on every build day for no content reason at all."* The pinning covers
the three accounts this build creates. It does not cover the accounts Debian's
own package postinsts create, and it does not cover the `-` backup files, which
snapshot the state **before** `chage` ran.

So the packed root, and its verity root hash, depend on the calendar day.
Reported, not fixed: `/etc/shadow-` and `/etc/passwd-` are `useradd`'s
pre-modification backups, unreadable and unwritable on a read-only verity root
and read by nothing in the image, so removing them or pinning their dates is an
image content change and outside PLAN-014's scope. A gate that must compare two
builds should run them on the same day, or strip these two files.

### RFCT-111 M5b: the stage split, measured

The chain (`stages/`) against the single file it replaced, both built cold on
one day, x64:

| | entries |
|---|---|
| control — two cold builds of the unmodified single file | **6** |
| subject — unmodified single file vs the chain | **14** |
| beyond the control | **8**, every one in the account family |

The eight are `/etc/passwd`, `/etc/group`, `/etc/gshadow`,
`/usr/share/factory/etc/shadow` and the four `-` backups. They are the price of
`account-mos.sh` moving into `10-base` while the two MQTT service accounts stay
with the feature material, and they are semantically inert — which was proved
rather than asserted:

- the four live files are **identical as sets**; `mos` only changes line
  position, and every uid, gid, shell, home and hash is unchanged.
- the four `-` backups differ by **exactly one entry**: `useradd` snapshots the
  file before each change, so the backup now holds the state before
  `mos-mqtt-broker` (which includes `mos`) instead of the state before `mos`.
- `unsquashfs -lln` over both images is identical for mode, uid, gid and path
  on all 9,241 entries; the only size changes are these files and the initrd.

**The reorder is not optional.** The floor's operator account cannot come after
a feature's service accounts and still be the floor, so no arrangement of the
stage vocabulary preserves that order. RFCT-111's acceptance anticipated this —
"byte-identical **where achievable**; if apt-layer reordering makes that
unattainable, the fallback gate is full verifier parity plus an explicitly
anchored new-baseline commit". This is that anchor, and the parity half was run:
`MOS_BOARD=x64 bash os/verify-image-v2.sh` on an image assembled from a
chain-built rootfs reports **`RESULT: PASS (290/290 checks, 22 skipped)`**, the
same count as before the split.

### RFCT-111 M5c: the feature cut, measured

`30-40-unsplit` cut into five `30-feature-*` stages and `40-board`, with the
board work moved behind every feature. Both sides built cold on **2026-08-26**
through the same driver with the same arguments — the only difference is the
tree — and both extracted with the same `unsquashfs`:

| | entries |
|---|---|
| control — two cold builds that changed nothing (M5a, and M5b again) | **6** |
| M5b's subject — the single file vs the four-stage chain | 14 |
| **M5c's subject — that chain vs the nine-stage chain** | **6** |
| beyond the control | **0** |

The differing set **is** the control's set, entry for entry:
`/boot/initrd.img-*`, the four `/usr/share/factory/var/log` files and
`aux-cache`. Nothing in the account family moved this time, which is the
difference between M5c's reordering and M5b's: M5b had to lift `account-mos.sh`
into the floor stage past two service accounts, and M5c moved no account-
creating RUN across another one.

Driven further than the entry count, because six entries that differ for the
right reason and six that differ for a new one look the same in a list:

- `unsquashfs -lln` over all **9,241** entries differs on **one line**, and only
  in the initrd's SIZE (37,189,906 against 37,189,851 bytes). Every mode, uid,
  gid, and path on both sides is identical.
- `dpkg.log` with its timestamps stripped is **byte-identical**: the same 694
  operations in the same order. That is the direct check on the ordering
  constraint the cut was designed around — the `apt` transactions still run
  radios, containers, `grub-editenv`, kernel.
- `alternatives.log` is two lines and identical once `update-alternatives`' own
  timestamp is removed; `apt/history.log` is identical once `Start-Date` and
  `End-Date` are.

The recipe is in `_out/gate/` of the M5c worktree — `chain-cold.sh` (one tree,
one cold chain), `extract.sh` (M5b's, verbatim but for the root) and
`compare.sh` — and it is meant to be re-run rather than cited.

### RFCT-111 M5d: the board parameterisation, measured — and a SEVENTH entry

`40-board`'s two fixed `cx3576` `COPY`s replaced by staged directories
(`stages/README.md`, "Declining a board"). Every build below is cold, x64,
**2026-08-26**, through the same driver, and every tree is a `git` checkout cut
the same way — so the tree is the only difference between a control pair and a
subject pair.

| | entries |
|---|---|
| M5b's subject — the single file vs the four-stage chain | 14 |
| M5c's subject — that chain vs the nine-stage chain | 6 |
| **the control, RE-MEASURED here — the base tree against ITSELF, two cold builds 22 minutes apart** | **7** |
| **M5d's subject vs the first control build** | **7** |
| **M5d's subject vs the second control build** | **6** |
| **beyond the control, in either pairing** | **0** |

**The control is 7 today and was 6 for M5a, M5b and M5c.** The seventh is
`/usr/share/factory/var/log/apt/eipp.log.xz` — apt's dump of the problem it
handed its solver — and it is in the control, not in the change. It first showed
up as a seventh entry against a subject build, which is exactly the shape of a
regression, so it was measured rather than argued: a second cold build of the
UNMODIFIED base tree reproduces it against the first, with the same signature.

| | eipp.log.xz |
|---|---|
| decompressed size | 1,490 lines, identical on every side |
| differing lines, control pair | 12 |
| differing lines, subject pair | 12 |
| what differs | `APT-ID:` and nothing else, in both pairs |
| by how much | a constant **+4**, in both pairs |

`APT-ID` is an index into apt's in-memory package cache, which spans every
package the lists offer and not just the ones installed. Four more records in
`deb.debian.org`'s index — the archive moved during the session — shifts every
id by four and changes nothing about what is installed. `dpkg.log` proves that
half directly: **byte-identical over all 694 operations** once timestamps are
stripped, in the subject pair. And the third pairing settles it — the subject
against the control's SECOND build, which fell on the same side of the archive
move, is **6**, the pre-M5d set exactly.

The rest of the differing set is the one this file has recorded since M5a:
`/boot/initrd.img-*`, the four `/usr/share/factory/var/log` files and
`aux-cache`. That is what an x64 build of this change should look like — x64 is
the board that DISCARDED both of the things being parameterised, so a real
difference would have meant the mechanism changed what a board carries.

Driven past the entry count, because seven entries that differ for the right
reason and seven that differ for a new one read identically in a list:

- **`unsquashfs -lln` over all 9,241 entries differs on ONE line** in the
  subject pair, and only in the initrd's SIZE (37,189,836 against 37,190,017
  bytes). **The control pair also differs on exactly that one line** (37,189,836
  against 37,190,044). Every mode, uid, gid and path on all three sides is
  identical — which is the check that matters here, because a `COPY` that
  changed what it stages would move a mode or a path before it moved a byte.
- **`dpkg.log` with its timestamps stripped is byte-identical** — the same 694
  operations in the same order. `grub-editenv-install` did not move, so the apt
  order the feature stages are arranged to preserve is intact.
- `alternatives.log` (2 lines) and `apt/history.log` (12 lines) are identical
  once their own timestamps are removed.
- **`apt/term.log` is 657 lines on both sides and differs on exactly THREE**,
  which are the RSA/ECDSA/ED25519 host-key fingerprints `openssh-server`'s
  postinst echoes as it generates them. The keys themselves are removed by
  `stages/10-base` and are not in the image; only the console echo survives in
  the log.
- `/usr/lib/firmware` **does not exist** in any of the three packed roots, which
  is the behaviour `firmware-install.sh` was written to keep: a board with no
  radio gets no empty directory standing where firmware would be.

**A DIFFERENCE THE GATE FOUND IN ITSELF, recorded because it is the kind that
reads as a subject failure.** The first run of this gate reported 6 differing
entries and then **24 differing lines in the `-lln` listing** — a mode
difference, group-write set on `/etc`, `/usr`, `/usr/lib` and nine overlay
files. Not the change: the control tree had been snapshotted with
`git archive HEAD | tar -x`, which produced `664`/`775` where a checkout under
`umask 022` gives `644`/`755`, and the overlay is `cp -a`'d from those files
into the build context. The content diff could not see it — `diff -r` compares
bytes, not modes — so the listing is what caught it. **A gate for a refactor has
to be cut so that the two sides are the same KIND of thing**, and a tar
extraction and a checkout are not.
Fixed by cutting the control side with `git worktree add --detach` instead, so
both sides are checkouts made the same way; the numbers above are that run.

The recipe is in `_out/gate/` of the M5d worktree — `chain-cold.sh` (one tree,
one cold chain, and the extra `--arg`s the subject's `40-board` declares passed
by the caller, because the driver REFUSES an argument no stage declares),
`extract.sh` and `compare.sh` — and it is meant to be re-run rather than cited.

Also cold-build-dependent, and now closed: the byte layout used to depend on
whichever `squashfs-tools` and `cryptsetup` came out of a floating
`debian:bookworm-slim` in the pack stage. RFCT-108 (PLAN-014 M2) pins that base
by digest through `os/build-env/images.env`, so the pack tools are a decision
rather than a build date.

### RFCT-111 M5e: the milestone gate — and the number that is NOT zero

The three sections above each gate one STEP of the cut against the step before
it. This one gates **the whole of M5**: the nine-stage chain at the tree that
ships, against the tree as it stood the commit before the cut
(`66bb0b8`'s parent — the last tree with no `os/rootfs/stages/` in it, built
from `Dockerfile.v2` alone). Cold, x64,
**2026-08-26**, both sides cut with `git worktree add --detach`, both on the
`default` buildx builder.

**Each side ran its OWN `os/rootfs/build-v2.sh`, unmodified.** The two drivers
are not the same program — the pre-M5 one calls `docker buildx build` over one
Dockerfile, the M5 one calls `os/build/run.sh --build-rootfs` over nine — and
neither takes `--no-cache`. M5c and M5d handled that by re-listing the argument
set `build-v2.sh` computes into a `chain-cold.sh`; that works, and the
transcription is a second variable between two sides whose whole claim is that
there is only one. Here `--no-cache` is injected instead by a `docker` shim on
`PATH` at exactly two Dockerfile shapes — `os/rootfs/Dockerfile.v2` and
`os/rootfs/stages/*.Dockerfile` — so the staged inputs (mosd, podman, rauc)
build warm and identically on both sides and nothing about the argument set is
retyped. Coldness is then MEASURED rather than assumed: BuildKit prints `CACHED`
on every step it reuses, and across all three builds the only `CACHED` lines are
the digest-pinned base-image resolves. Not one `RUN` was reused.

| | entries, of 9,241 |
|---|---|
| the control — the pre-M5 tree against ITSELF, two cold builds 7 minutes apart | **6** |
| the subject — the pre-M5 tree against the nine-stage chain | **14** |
| **beyond the control** | **8** |

**Eight, and not zero, and it is the recorded outcome rather than a
regression.** All eight are the account family — `/etc/passwd`, `/etc/group`,
`/etc/gshadow`, `usr/share/factory/etc/shadow` and the four `-` backups — and
all eight are one account at a different LINE POSITION. `account-mos.sh` moved
into `10-base` when the chain was cut (`stages/README.md` tables it), while the
two MQTT service accounts stayed with the feature material in
`34-feature-mqtt`, so the `mos` operator is now created before them and used to
be created after. Measured rather than reasoned: the four live files are
**identical as SETS** (`sort` and `diff` agree), same uid, same gid, same
fields; the four `-` backups differ by exactly one entry each, because `useradd`
snapshots the file before each change and the change it snapshots is a different
one. Nothing resolves differently — `/etc/passwd` is not order-sensitive — and
RFCT-111's acceptance clause names this case: byte-identity "where achievable",
and otherwise "full verifier parity plus an explicitly anchored new-baseline
commit". Section 3 of this gate is that parity: `RESULT: PASS (290/290 checks,
22 skipped)`, 0 FAIL, on an image assembled from a chain-built rootfs.

**The seventh control entry of M5d is gone, which is what M5d predicted.**
`apt/eipp.log.xz` is byte-identical on both pairings today, so the control is
**6** again — the number M5a, M5b and M5c measured. A control that was 6, then
7, then 6 is a property of the day and of `deb.debian.org`'s index, exactly as
M5d recorded it, and not of any tree.

Driven past the entry count, because eight entries that differ for the right
reason and eight that differ for a new one read identically in a list:

- **`unsquashfs -lln` over all 9,241 entries: 0 differing rows on BOTH
  pairings**, comparing mode, uid/gid and path with size and mtime excluded and
  re-sorted on that triple. Every mtime in both listings is the pinned
  `2020-01-01 00:00`. The listing's only differences are SIZES: the initrd on
  both pairings (gzip, and the control moves it too), and `/etc/passwd-`,
  `/etc/group-`, `/etc/gshadow-` on the subject pairing — the same one account.
  The comparison was driven from the failing side before it was believed: one
  mode bit, one gid and one renamed path each register, and the unmutated pair
  is 0.
- **`dpkg.log` with its timestamps stripped is byte-identical over all 694
  operations, on BOTH pairings.** That is the direct check on the ordering the
  feature stages are arranged to preserve, and it is intact across the entire
  milestone — not just across M5d.
- `apt/history.log` differs on 16 lines, every one a `Start-Date` or `End-Date`.
  `alternatives.log` differs on 4, which are one `update-alternatives --install`
  of `mt` with a different timestamp on each side.
- **`apt/term.log` differs on 22 lines: 16 are `Log started`/`Log ended`, and
  6 are the RSA/ECDSA/ED25519 host-key fingerprints `openssh-server`'s postinst
  echoes** — three per side. Those six appear in the CONTROL pairing as well, so
  they are the day and not the change; the keys themselves are removed by
  `stages/10-base` and are not in the image.
- `/usr/lib/firmware` does not exist in any of the three packed roots, and
  `/etc/shadow` is a symlink to `/run/mos/shadow` on both sides, which is why it
  is absent from the differing set while the factory copy is in it.

The recipe is in `_out/gate/` of the M5e worktree — `cold.sh` (one tree, one
cold build, through that tree's own driver), `bin/docker` (the shim, with its
decision driven from both sides), `extract.sh`, `compare.sh` and `lines.sh` (the
per-log accounting above) — and it is meant to be re-run rather than cited.
