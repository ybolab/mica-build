# os/rootfs — Debian systemd arm64 rootfs (cx3576)

Builds a minimal Debian trixie + systemd root filesystem for the cx3576 board
as a squashfs + dm-verity slot image, ready to be written into an A/B rootfs
slot by the assembly step.

The sections up to "Layout v2" below describe the parts of the build that are
not specific to the packed layout: the package set, the config directories, the
image profile, mosd and the board hardware-init layer.

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
again by the image verifier (`bash os/verify/run.sh --verify --board <b>`)
against the packed artifact — including that `dev` implies `ssh.service` is enabled in the image
and `prod` implies it is not.

The file lives in `/usr/lib` and not `/etc` because it describes the *image*,
not the device; that also puts it inside the read-only verity root, where a
production device cannot be edited into a development one.

## mosd

The mos management daemon is cross-built on the host
(`os/pkgs/mosd/hack/build-aarch64.sh`, rust target `aarch64-unknown-linux-gnu` linked
with `aarch64-linux-gnu-gcc`) and installed into the rootfs:

- `/usr/bin/mosd` — aarch64 release binary
- `/usr/lib/systemd/system/mosd.service` — enabled via the
  `multi-user.target.wants` symlink
- `/usr/share/dbus-1/system.d/com.mos.mosd.conf` — D-Bus system bus policy
  (com.mos.mosd is root-only)
- `/usr/lib/mos/mqtt-applications.d` — exact package-owned MQTT application
  enrollments; each application package also ships its own exact D-Bus name
  ownership and `mos-mqttd` Item1 grants. There is no global prefix policy and
  mqttd has no policy access to `com.mos.mosd`
- `/var/lib/mos` — daemon state directory

No new apt packages: mosd only needs `dbus` and `systemd`, both already in the
allowlist. Set `WITH_MOSD=0` to build the rootfs without mosd (default is on).

## Board hardware init

Board-agnostic mechanism, and the content is filed per board: the units and
their scripts come from `os/boards/<board>/hwinit/` (six of each on cx3576; x64
has no such directory and stages an empty one), and the board-specific facts
they read — module names, sysfs paths, UART device, CAN defaults, MAC seed,
gadget IDs — come from conf files staged from `BOARD_DIR/init/`, falling back to
the in-repo `os/boards/<board>/bsp/init/`, into `/etc/mos/`. Both reach
`stages/40-board` as staged directories (`BOARD_HWINIT_DIR`, `BOARD_INIT_DIR`)
because a `COPY` cannot be gated on an `ARG`. Every unit is condition-gated on
its conf file and never blocks, delays, or fails the boot; WiFi association / BT
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

# Layout v2 — squashfs + dm-verity rootfs

`build-v2.sh` / `stages/` / `scripts/` / `overlay-v2/` are the build. The
design record is `docs/design/ro-root.md` — read it before changing anything
here.

## The build is a chain: `stages/`

`stages/` holds one Dockerfile per stage — `10-base`, `20-install`, five
`30-feature-*`, `40-board`, `90-pack` — built in numeric order, each `FROM` the
local image tag the previous one was written to. `build-v2.sh` stages the
context and computes every argument; sequencing is
`os/build/run.sh --build-rootfs`.

**A feature is a file, so declining one is leaving the file out.** Stage
selection is what the chain has in place of `WITH_*` build arguments:
`--without containers` builds a chain with no `31-feature-containers` in it,
and the driver refuses a name that matches no feature stage rather than
silently building the full image. `WITH_CONTAINERS=0` and `WITH_MOSD=0` work —
`build-v2.sh` turns them into that flag — and `_out/<board>/rootfs-stages.txt`
records which features are declined, because an image built without a feature
stage and an image whose feature stage does nothing look identical afterwards.

`stages/README.md` is the file to read first: what the chain is, which stage
holds what, the order constraints that fix it, and the measurement that the
builder must use the `docker` driver.

## Where the shell is: `scripts/`

The stage files hold almost no shell. Every `RUN` body longer than one command
is a file in `scripts/`, reached by a bind mount that leaves nothing in the
image:

```dockerfile
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/<name>.sh
```

Build arguments arrive through the environment, so the scripts read
`BOARD_RADIOS`, `MOS_ARCH`, `RAUC_BOOTLOADER` and the rest.
`WITH_CONTAINERS` and `WITH_MOSD` are not among them: the decision they select
is the presence of `31-feature-containers` and `33-feature-mosd` in the chain.
The package lists and the single-command `RUN`s stay in the stage files: a
stage's package set *is* the image, and a one-line `RUN` gains nothing from a
hop. `ARG` is per stage and also per *file*, so an argument a stage's `RUN`s
read must be declared in that stage's file — `BOARD_RADIOS` is declared twice
for that reason.

`scripts/README.md` has the rest — why a mount and not a `COPY`, why these files
must stay POSIX `sh`, and how to check that a change to one of them is the
refactor it claims to be.

## Build

```sh
# needs os/boards/cx3576/bsp/out/kernel/modules.tar (make -C os/boards/cx3576/bsp kernel),
# or point BOARD_DIR at prebuilt BSP artifacts:
BOARD_DIR=/srv/ai/mos/os/boards/cx3576/bsp make os-rootfs-cx3576-v2   # rootfs only
BOARD_DIR=/srv/ai/mos/os/boards/cx3576/bsp make os-image-cx3576-v2    # rootfs + full v2 image
```

On x86 hosts, arm64 emulation comes from binfmt
(`docker run --privileged --rm tonistiigi/binfmt --install arm64`), and it is
**required** for a cross build rather than optional.

`build-v2.sh` selects the `default` (docker-driver) builder and refuses up
front, with the `binfmt` command, if it cannot reach the target platform. There
is no docker-container fallback, and the reason is measured: the chain resolves
`FROM ${MOS_STAGE_PREV}` against the **local docker image store**, and a
`docker-container` builder cannot read it — handed a tag that is present it
answers `pull access denied, repository does not exist`, about a registry.
`stages/README.md` records the measurement.

Outputs to `_out/<board>/`. The first four are consumed by the image assembler
-- `os/build/src/mkimage-v2.ts` and `mkimage-x64.ts`, entered through
`bash os/build/run.sh --mkimage-v2|--mkimage-x64`. The last three are **not**:
they are read by the smoke runner, and nothing copies any of them into the
image.

| File | Read by | Contents |
|---|---|---|
| `rootfs-verity.img` | assembler | squashfs-zstd with the dm-verity hash tree appended, padded to a whole MiB |
| `rootfs-verity.env` | assembler | verity parameters as strict `KEY=value` |
| `boot-cmdline-a.txt` / `-b.txt` | assembler | the full kernel `append` line for each slot |
| `rootfs-report-v2.txt` | a reader | package list, installed size, setuid/setgid inventory, file capabilities |
| `factory-root.oci` | smoke runner | the packed root as an OCI-layout archive; `docker load -i` it |
| `factory-root.txt` | smoke runner | what that archive is: `ref`, `platform`, `target`, `archive`, `bytes`, `sha256`, `source-date-epoch`, TAB-separated |
| `rootfs-stages.txt` | smoke runner | the stage chain as built, and a `# declined:` line naming the feature stages left out -- or saying in parentheses that none were |
| `mosd-build.txt` | smoke runner | **the commit `mosd` and `apid` in this root were built from** |

### `mosd-build.txt`, and why it is a copy

`os/pkgs/mosd/hack/build-target.sh` writes `_out/mosd-build.txt` on every build --
`target`, `elf-arch` and `commit`, TAB-separated, the same shape
`factory-root.txt` uses so one reader reads both -- and `build-v2.sh` copies it
into `_out/<board>/` beside the factory root. **It is not copied into the
image.**

Copied rather than read from the top-level path, because the top-level one
describes *whatever was compiled most recently*: build cx3576 and then x64 and
`_out/mosd-build.txt` says `aarch64-unknown-linux-gnu` while `_out/x64/` still
holds x86-64 binaries. The per-board copy is what keeps the smoke runner
comparing an image against the build that produced it.

`build-v2.sh` **removes** it when `mosd` is declined, for the same reason it
empties the staged `mosd/` directory: a record left by a previous build would
describe binaries this image does not carry, and the smoke runner would then
assert a commit against an artifact that is not there. Absent is a state it
already handles -- it prints that nothing was asserted, and says so on its own
first lines -- and stale is one nothing could catch.

Every layout constant is read from `os/boards/cx3576/board.env`; none is duplicated
in `build-v2.sh`, `stages/` or the overlay. The board console/storage
cmdline fragment (`console=ttyFIQ0,… earlycon=… net.ifnames=0`) is a board fact
too and lives there as `BOARD_CMDLINE_ARGS`, moved out of `build-v2.sh` when
x64 became the second board to need a v2 image.

### The cmdline files are a contract

The assembler does not re-derive the verity table: it lifts the
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
  The assembler cross-checks the cmdline against the layout env's
  uppercase `ROOTFS_x_GUID` case-insensitively, so the two spellings
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

- **`rauc`** — the update client itself: the slot definitions, `system.conf`
  and the install flow are all its.
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
  backend needs it, and so does the first-boot machine-id oneshot.
- **`curl`** — the health gate's apid probe (`os/rootfs/overlay-v2/usr/lib/mos/mos-health`) fetches
  `https://127.0.0.1/healthz`. It prefers `curl`, falls back to `wget`, and
  SKIPs when neither is present. `rauc` links libcurl but does not ship the
  binary, so without this package the gate covers two of its three components
  and still reports green — a probe that skips is not a probe that passes. One
  line to revert if the size budget is ever revisited.

Deliberately **not** added: `squashfs-tools` and `cryptsetup-bin`. Packing the
root is a build-stage job (they are installed in `stages/90-pack.Dockerfile`'s
pack stage only), and the kernel opens the verity device straight from `dm-mod.create=`
with no userspace tool involved.

Installed size: **217 MB against the 400 MB budget**. rauc,
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
| `etc/fw_env.config.in` | the redundant U-Boot env pair, addressed by partition GUID. The single `fw_env.config` source in the tree; `os/pkgs/rauc/render-config.sh` asserts its structure rather than shipping a competing file |
| `etc/repart.d/*.conf` | eight definitions in disk order; only `80-data.conf` grows. The two `uenv` placeholders carry `SizeMinBytes=0`: repart will not claim an existing partition below the definition's minimum, which defaults to 10 MiB, and the uenv pair is 64 KiB — without it the whole run aborts with *"Can't fit requested partitions into available free space"* and `/srv` never grows |
| `etc/tmpfiles.d/mos-var.conf` | age policies for `/var/tmp` and `/var/cache` — `/var` is a fixed-size partition |
| `etc/systemd/system/mos-seed-var.service` | first-boot restore of `/var` from `/usr/share/factory/var` |
| `etc/systemd/system/mos-seed-state.service` | STATE directories + per-device sshd host keys; convergent, runs every boot (no run-once stamp — a stamp would stop a later image from seeding a STATE directory it introduces) |
| `etc/systemd/system/var-lib-mos.mount` | binds `/mnt/state/mos` onto `/var/lib/mos` so mosd's paths are unchanged |
| `etc/systemd/system/var-lib-bluetooth.mount` | binds `/mnt/state/bluetooth` onto `/var/lib/bluetooth` so pairings survive a `/var` wipe |
| `etc/systemd/system/etc-ssh.mount` | binds `/mnt/state/ssh` onto `/etc/ssh` |
| `etc/systemd/system/etc-hostname.mount` | binds `/mnt/state/hostname` onto `/etc/hostname`, so mosd's hostname reconciler can persist a change |
| `etc/systemd/system/etc-wpa_supplicant.mount` | binds `/mnt/state/wpa_supplicant` onto `/etc/wpa_supplicant`, the path `wpa_supplicant@.service` reads and the station reconciler writes |
| `etc/systemd/system/etc-hostapd.mount` | binds `/mnt/state/hostapd` onto `/etc/hostapd`, the path `hostapd@.service` reads and the AP reconciler writes |
| `etc/systemd/system/usr-local-lib-systemd-system.mount` | binds `/mnt/state/systemd-units` onto `/usr/local/lib/systemd/system`, the writable unit directory the record integrators. Empty in the Debian base, so nothing is seeded into it; `/etc/systemd/system` is not the target, because a bind there hides the boot chain's own units and their `local-fs.target.wants` enablement. The mountpoint is created by the pack stage — a verity root cannot make it at runtime |
| `etc/systemd/system/mos-apply-hostname.service` | re-applies the persisted hostname after the bind — PID 1 reads the squashfs copy long before mount units run |
| `usr/lib/mos/mos-seed-*` | the two seed scripts |

Six hwinit units (`mos-modules`, `mos-otg`, `mos-can`, `mos-bt`, `mos-mac`,
`mos-gadget`) are installed and enabled here; all of them are read-only-root
safe (they read `/etc/mos` and write only configfs and sysfs). See
`docs/design/ro-root.md` §6 for the one override that read-only `/etc` does
take away.

`fstrim.timer` is enabled. Why all seven repart definitions are needed, why the
growth target moved off the root, and what happens to `/etc/machine-id` are all
explained in `docs/design/ro-root.md`.

## Board hardware init — the enable list is enumerated, not restated

`scripts/hwinit-install.sh` installs `hwinit-*`, `*.service` **and** `*.rules`
from `os/boards/<board>/hwinit/` — staged into `BOARD_HWINIT_DIR` — and derives
the enable list by iterating the board facts that are actually staged:

```
for c in /tmp/board-init/*.conf; do n="$(basename "$c" .conf)"; ... ln -sf ... ; done
```

This is not a style preference. A hardcoded unit list is what installation and
enablement drift apart through: a unit the globs install and the list never
enables costs the image its stable MAC or its USB debug console, with no error
anywhere. Deriving the list keeps them in step, so adding `hwinit-<n>` plus
`mos-<n>.service` under `os/boards/<board>/hwinit/`, and an `<n>.conf` to the
board, is sufficient.

**Both directions are asserted, and neither is a count.** A conf with no script
is an unread board fact and fails by name; a `/usr/lib/mos/hwinit-<n>` with no
`/etc/mos/<n>.conf` is a unit that can never run and fails by name. What is not
asserted at build time is the third direction — a board that declares
`BOARD_HWINIT_CONFS` and whose `init/` is missing stages no conf, installs no
unit, and the two counts agree at zero. The image verifier (`os/verify/`) holds
that one at image level: it compares the declared facts against the installed
helpers.

No board fact and no board name is restated in this layer. Module names, sysfs
paths, UART device and speed, CAN bitrate and FD flag, MAC seed and gadget IDs
all live in `BOARD_INIT_DIR` and are staged verbatim into `/etc/mos`, where the
units read them at runtime; `stages/40-board` names no board at all, which
`os/build/src/stages.test.ts` asserts over every stage file.

## RAUC system.conf is rendered, not committed

`os/rootfs/overlay-v2/etc/rauc/system.conf` is **generated** by
`os/pkgs/rauc/render-config.sh`, which owns the template and its assertions,
and is gitignored. `build-v2.sh` runs the renderer before
staging the overlay, so the template plus `os/boards/cx3576/board.env` are the
single source of truth and the rendered file cannot drift from them.

The bundle builder, `os/build/src/bundle.ts`, runs `render-config.sh --check`.
It guards a narrower case — someone hand-editing the generated file after the
last build — rather than committed-copy drift, which the renderer rules out. It
consumes `rootfs-verity.img` too, so `build-v2.sh` has necessarily run first and
the file is present.

## systemd-repart is a package of its own on trixie

trixie splits `systemd-repart` into a package of its own where bookworm shipped
it inside `systemd`, so it is not free with the init system.
`os/rootfs/stages/10-base.Dockerfile` names it in the install list for that
reason, and the image verifier (`os/verify/`) asserts the enablement symlink.
The failure if it were missing announces nothing — the device boots and DATA
simply never grows past the 64 MiB the assembler creates.

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

## Determinism, and what it took to get there

Two cache-hot `make os-rootfs-cx3576-v2` runs produce a byte-identical
`rootfs-verity.img`. sshd host keys are **not** baked into the image — they
would be a private key shared by every device and would change the verity root
hash on every cold build; `mos-seed-state` generates them per device on first
boot instead.

**A cold x64 build reproduces itself.** Two cold builds of one unmodified tree,
at one commit, each on a `docker-container` builder created for it so that
neither could replay the other's cache, produced the same `rootfs-verity.img` —
`6ca98787…` on both sides — and the same `/boot/initrd.img`, `01e29d26…`.
Measured 2026-08-31.

This section used to say the opposite, and it was right to: seven cold builds
of one tree gave seven different hashes. Three separate surfaces carried
build-host state into the packed root. Each has been removed rather than
tolerated, because a floating root is a floating dm-verity root hash, and
`SQUASHFS_TIME` and `VERITY_SALT` are pinned precisely to stop that.

| Surface | What it carried | What was done |
|---|---|---|
| `/boot/initrd.img-*` | build-host inode numbers on 182 of 183 cpio entries, and the wall clock in 71 mtimes | `stages/40-board` declares `SOURCE_DATE_EPOCH`; `build-v2.sh` passes the same instant it pins the squashfs to. `initramfs-tools` then clamps every staged mtime to the epoch, passes `cpio --reproducible` so entry inodes are renumbered from 1, and compresses with `gzip -n` |
| `/usr/share/factory/var/cache/ldconfig/aux-cache` | glibc's `{dev, ino, ctime, size}` for every shared library, as the BUILD host saw them | dropped in `pack-tree-surgery.sh`. A regenerable cache, already wrong for the device the moment it ships, and `ldconfig` rebuilds it anyway |
| `/usr/share/factory/etc/shadow` and `/etc/shadow-` | the shadow last-change DAY for the accounts Debian's postinsts create: `systemd-network`, `messagebus`, `systemd-resolve`, `sshd` | `account-pin-shadow-dates.sh`, in `stages/90-pack`'s `closed` stage, pins every account to day 18262 — the same `2020-01-01` the three mos accounts already carried |

The third is the one worth remembering, because of how it hid. The value is a
**day**: two builds in one session agree, so it passed every test this tree
had, and it would have failed a dual-build gate at random months later for a
reason nobody would have connected to a calendar. It also needed the pin run
**twice** — `/etc/shadow-` is the snapshot `chage` takes *before* it writes, so
one pass leaves the backup holding the unpinned row of whichever account was
pinned last. `pack-assert-shadow-chain.sh` reads the field back out of the
packed tree across both files, prints the number of account rows it examined,
and refuses a zero.

**What this means for a byte-identity gate.** Changing the build necessarily
invalidates the layer cache, so a comparison across a change is cold on at
least one side. That used to make sha256 useless here, because a cold pair
differed whether or not anything had changed. It is usable now: a cold pair of
an unmodified tree agrees, so a difference is a difference. Two cautions
survive, and both are about the apparatus rather than the tree.

- **Both sides cold, or neither.** A cached layer and a cold rebuild can
  install different package versions — the base image is pinned by digest, the
  archive it installs from is live — so a warm-against-cold pair measures the
  Debian mirror. Compare cold against cold, and show it: `dpkg.log` from
  `_out/<board>/pkg-logs/` with its timestamps stripped is byte-identical over
  all 694 operations when both sides took the same package set.
- **When it does differ, attribute before concluding.** A whole-file sha256
  cannot tell a working fix from a broken one. Unpack the cpio and charge each
  difference to exactly one category — content first, then mtime, then inode —
  because a fix that pins every mtime and leaves inode numbers floating still
  fails a byte comparison and is not a failed fix.

`os/build/run.sh --build-rootfs --no-cache` exists so the subject side can be
cold without pruning the daemon's cache out from under every other build on the
machine. A `docker-container` builder created for the run is emptier still, and
buys a second thing: the driver then chains the stages by OCI layout under
`_out/<board>/stages/` instead of through the daemon-global
`mos-rootfs-stage:*` tags, which two concurrent worktrees would otherwise
interleave on — producing a complete, plausible root blended from two trees.

### Running the gate

Both sides cold, one board, both cut with `git worktree add --detach`, both on
the `default` buildx builder, and each driven through its own tree's
`os/rootfs/build-v2.sh` rather than a re-typed argument list — a transcribed
argument set is a second variable between two sides whose whole claim is that
there is one.

- **Cut both sides the same way.** `git archive HEAD | tar -x` produces
  `664`/`775` where a checkout under `umask 022` gives `644`/`755`, and the
  overlay is `cp -a`'d from those files into the build context, so a tar
  extraction compared against a checkout reports a mode difference on `/etc`,
  `/usr`, `/usr/lib` and nine overlay files that has nothing to do with the
  change. The content diff cannot see it — `diff -r` compares bytes, not modes —
  and the listing is what catches it. A gate for a refactor has to be cut so
  that the two sides are the same kind of thing.
- **Measure coldness rather than assuming it.** BuildKit prints `CACHED` on
  every step it reuses; in a cold run the only `CACHED` lines are the
  digest-pinned base-image resolves, and not one `RUN` is reused.
- **Compare on two instruments.** `diff -r --no-dereference` over the extracted
  trees for content, and `unsquashfs -lln` over all 9,234 entries for mode,
  uid/gid and path with size and mtime excluded and re-sorted on that triple.
  The count is the x64 figure and it moves whenever a file is added to or
  dropped from the root, so re-derive it rather than trusting this line:
  `unsquashfs -l rootfs-verity.img | wc -l`.
  Every mtime in both listings is the pinned `2020-01-01 00:00`. Content and
  metadata fail in different ways and either instrument alone reads green over
  the other's failure. Drive both from the failing side before believing them:
  one mode bit, one gid and one renamed path each register, and an unmutated
  pair is 0.
- **Check the apt order directly**, from `_out/<board>/pkg-logs/` on each side
  rather than from the extracted root. `dpkg.log` with its timestamps stripped is
  byte-identical over all 694 operations while the ordering the feature stages
  are arranged to preserve is intact — the `apt` transactions run radios,
  containers, `grub-editenv`, kernel. `alternatives.log` and `apt/history.log`
  are identical once `update-alternatives`' own timestamp and
  `Start-Date`/`End-Date` are removed. These are the same bytes the packed root
  used to carry: `stages/90-pack` copies them out of `/var/log` before the purge
  and the purge refuses to run if that copy is missing, so the check cannot be
  silently lost to a later cleanup. Nothing in this repository runs this
  comparison automatically — it is an instrument a person drives across two
  builds, and there is no green run to inherit.
- **Expect the host-key echo in `apt/term.log`.** The RSA/ECDSA/ED25519
  fingerprints `openssh-server`'s postinst prints as it generates them differ on
  every build, three per side, and they appear in the control pairing as well.
  The keys themselves are removed by `stages/10-base` and are not in the image.
- **A seventh control entry could once arrive from outside the tree**, and
  since removed `/var/log/apt` from the packed root it no longer can.
  `/usr/share/factory/var/log/apt/eipp.log.xz` was apt's dump of the problem it
  handed its solver: 1,490 lines, of which 12 differed by `APT-ID:` and nothing
  else, by a constant offset, when `deb.debian.org`'s index gained records
  between the two builds. `APT-ID` indexes apt's in-memory package cache, which
  spans every package the lists offer and not just the ones installed, so it
  said nothing about what is in the image — and `dpkg.log` proves that half
  directly. It belonged to the day rather than to the change: a second cold
  build of the unmodified tree on the same side of the archive move gave the
  six. It is recorded because the `pkg-logs/` export still carries it, so it is
  a difference the log comparison can still see even though the image cannot.
- **Account-family entries mean an account moved.** `/etc/passwd`, `/etc/group`,
  `/etc/gshadow`, `/usr/share/factory/etc/shadow` and the four `-` backups move
  together when a `RUN` that creates an account crosses another one. They are
  semantically inert when the four live files are identical as sets — same uid,
  gid, shell, home and hash, only line position — and the four `-` backups
  differ by exactly one entry, because `useradd` snapshots the file before each
  change. `/etc/passwd` is not order-sensitive, so nothing resolves differently;
  prove it as sets rather than asserting it.
- **`/usr/lib/firmware` does not exist in an x64 packed root**, which is the
  behaviour `firmware-install.sh` is written to keep: a board with no radio gets
  no empty directory standing where firmware would be. `/etc/shadow` is a
  symlink to `/run/mos/shadow`, which is why it is absent from a differing set
  while the factory copy is in it.

The pack tools are pinned for the same reason the base is: the byte layout would
otherwise depend on whichever `squashfs-tools` and `cryptsetup` came out of a
floating `debian:bookworm-slim` in the pack stage. `os/build-env/images.env`
pins that base by digest, so the pack tools are a decision rather than a build
date.
