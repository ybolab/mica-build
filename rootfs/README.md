# rootfs — locked Debian runtime composition

Builds a Debian trixie + systemd root filesystem for x64 and cx3576
as a squashfs + dm-verity slot image, ready to be written into an A/B rootfs
slot by the assembly step.

The sections up to "The A/B layout" below describe the parts of the build that are
not specific to the packed layout: the package set, the config directories, the
image profile, mosd and the board hardware-init layer.

## Package allowlist

`debian/packages/<name>.json` records one upstream package per file. Its `name`
and `targets.amd64` / `targets.arm64` variants specify exact versions,
architectures, SHA256 checksums, download URLs and local package consumers.
The bootstrap helper has its own `debian/helpers/debootstrap.json` record.
The `base` consumer is the 68-package minimal bootstrap floor.
The resolved local package selection adds only its declared upstream dependency
closures; radio and other optional packages are absent unless selected.

The pins come from the authenticated Debian trixie snapshot at
`20260905T000000Z`. Builds download the named archives directly and verify both
their hashes and control metadata. They do not refresh indexes or resolve newer
versions. Changing a pin or consumer mapping requires reviewing its dependency
closure and rerunning the system acceptance tests.

```bash
MOS_ARCH=amd64 make os-debian-cache
MOS_ARCH=amd64 make os-debian-verify
MOS_ARCH=amd64 MOS_ROOT=/path/to/empty-root make os-debian-install

# Add the upstream dependencies of the common mos package set.
MOS_ARCH=amd64 MOS_DEBIAN_PACKAGES=rootfs/packages/common.pkgs make os-debian-cache

# After editing packages/libc6.json, fetch or verify only its amd64 archive.
bash rootfs/debian/docker.sh cache --arch amd64 --package libc6
bash rootfs/debian/docker.sh verify --arch amd64 --package libc6
```

A single-package operation reads only that package's JSON record and excludes
the bootstrap helper and minimal base. Changing its version, URL and SHA256
downloads only the missing archive; other JSON files and cached archives stay
untouched. A package can point at a newer Debian snapshot independently.
Review any changed dependency requirements and adjust the affected pins and
consumer mappings before rebuilding. `--package` prepares cache inputs; it
cannot install an incomplete dependency set. Full system builds still validate
the complete selected closure and require QEMU/end-to-end acceptance.

These commands run in the existing digest-pinned Bun container. The persistent
host directory `_out/debian-base/debs/` stores archives by SHA256 and is mounted
read-only during installation. `debian/docker.sh` also accepts `--cache-dir`
and `--all`. Installation runs with Docker networking disabled; it requires a
native target architecture and an empty destination.

`install` unpacks the bootstrap floor and stages `.debian-extra/configure.sh`
inside the destination. That script finishes the installation — dpkg
configuration, the remaining archives, the inventory check — and it runs with
the new root as `/`, because maintainer scripts have to. There are two ways in:
`docker.sh install` chroots, which is why it refuses a non-native architecture,
and the composition runs the same script in a build stage whose rootfs IS the
root. The composition cannot chroot: buildkit runs a foreign-architecture step
by prepending its own emulator, that emulator re-executes itself through
`/proc/self/exe` for every child, and a chroot leaves an empty `/proc` under
that path — so every exec inside the new root fails as `No such file or
directory`, naming the binary rather than the interpreter that was missing.

`build.sh` populates the cache for its resolved package set. The composer first
bootstraps the minimal root, then uses dpkg to install selected upstream and
local packages without network access. Bun validates JSON in the build container
and renders temporary installation rows; the target verifies hashes and archive
metadata again without installing a JSON interpreter. Debian's pinned debootstrap helper
handles bootstrap and pre-dependency ordering. All remaining payloads are
unpacked before configuration, so mos service presets precede OpenSSH setup.
The runtime composition never invokes APT. Compiler and packing tool images
remain separate build dependencies.

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

`MOS_PROFILE=dev` by default; `MOS_PROFILE=prod bash rootfs/build.sh`
builds the production image from the same tree. The build rejects anything that
is not exactly `dev` or `prod` in lowercase.

mosd reads this file once, on first boot, to seed `access.ssh.enabled`, and it
**fails closed**: a file that is missing, unreadable, misspelt or carrying an
unrecognised value all resolve to `prod`, which means SSH off. The comparison is
case-sensitive, so `DEV` resolves to prod too. Every one of those mistakes
produces an image where all the checks are green and the dev SSH path has simply
disappeared, which is why the value is validated at build time and asserted
again by the image verifier (`bash verify/run.sh --verify --board <b>`)
against the packed artifact — including that `dev` implies `ssh.service` is enabled in the image
and `prod` implies it is not.

The file lives in `/usr/lib` and not `/etc` because it describes the *image*,
not the device; that also puts it inside the read-only verity root, where a
production device cannot be edited into a development one.

## mosd

The mos management daemon is cross-built on the host
(`pkgs/mosd/hack/build-aarch64.sh`, rust target `aarch64-unknown-linux-gnu` linked
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
their scripts come from `boards/<board>/hwinit/` (six of each on cx3576; x64
has no such directory and stages an empty one), and the board-specific facts
they read — module names, sysfs paths, UART device, CAN defaults, MAC seed,
gadget IDs — come from conf files staged from `BOARD_DIR/init/`, falling back to
the in-repo `boards/<board>/bsp/init/`, into `/etc/mos/`. Both are package
payload now: `mos-board-<board>` installs the programs, the units and the confs
that `BOARD_HWINIT_CONFS` names, and refuses a fact no script reads or a script
with no unit to run it. Every unit is condition-gated on
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

# The A/B layout — squashfs + dm-verity rootfs

`build.sh` / `compose/` / `packages/` / `packages-src/` / `scripts/` /
`overlay/` are the build. The design record is `docs/design/ro-root.md` —
read it before changing anything here.

## The build is a composition: `compose/`

`compose/` holds two Dockerfiles, built in numeric order, the second `FROM` the
local image tag the first was written to:

- **`10-compose.Dockerfile`** — a minimal locked Debian root, followed by
  selected upstream dependencies and the local package pool under
  `_out/debs/<arch>/`. Both installation steps run offline with dpkg.
- **`90-pack.Dockerfile`** — the finalizer: close the root, tree surgery,
  whole-tree assertions, squashfs, dm-verity, and the two export surfaces.

`build.sh` stages the context and computes every argument; sequencing is
`build/run.sh --build-rootfs`, pointed here with `--stages-dir`.

**What used to be a stage is a package now.** The floor, the read-only-root
wiring, the four feature stages and the board are `mos-system`, `mos-ca-trust`,
one of `mos-profile-{dev,prod}`, the three radio packages, `mos-podman`,
`mos-rauc`, `mosd`, `mos-apid`, `mos-mqttd`, `mos-mqtt-broker` and one
`mos-board-<board>`. Debian's bootstrap helper handles `Pre-Depends`, then dpkg
configures the unpacked package set according to `Depends`. A failed install
fails the build; only a fully configured root reaches the finalizer.

**Declining a feature is naming fewer packages.** `MOS_ROOTFS_WITHOUT`, into
which `build.sh` folds the historical `WITH_CONTAINERS=0` and `WITH_MOSD=0`,
reaches the image through `packages/resolve.sh`, which refuses a feature name
that matches nothing rather than silently resolving the full set. The durable
record of what an image is made of is `_out/<board>/rootfs-packages.txt`, one
row per local package with its version, architecture, archive sha256 and owning
producer — read out of the pool index, never from a list kept by hand.

`packages/README.md` covers the manifests and the resolver;
`packages-src/README.md` covers the four producers whose source lives here.

## Where the shell is: `scripts/`

Neither compose file holds much shell. Every `RUN` body longer than one command
is a file in `scripts/`, reached by a bind mount that leaves nothing in the
image:

```dockerfile
RUN --mount=type=bind,source=rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/<name>.sh
```

The bulk of the directory is the finalizer's: the `pack-*` files, the
package-manager capture and purge, and the shadow-date pin. Two files are
reached by a **package producer** instead — `ca-certificates-generate.sh` by
`packages-src/ca-trust` and `rauc-assert-no-tls-stack.sh` by
`pkgs/rauc/deb/rauc` — so that the producer runs this repository's own rule
rather than restating it.

Build arguments arrive through the environment, so the scripts read `MOS_ARCH`,
`RAUC_BOOTLOADER` and the rest. `ARG` is per stage and also per *file*, so an
argument a `RUN` reads must be declared in that file.

`scripts/README.md` has the rest — why a mount and not a `COPY`, why these files
must stay POSIX `sh`, and how to check that a change to one of them is the
refactor it claims to be.

## Build

```sh
# the package pool comes first; the composer installs from it and builds no component:
make os-debs
# needs boards/cx3576/bsp/out/kernel/modules.tar (make -C boards/cx3576/bsp kernel),
# or point BOARD_DIR at prebuilt BSP artifacts:
BOARD_DIR=/srv/ai/mos/boards/cx3576/bsp make os-rootfs-cx3576   # rootfs only
BOARD_DIR=/srv/ai/mos/boards/cx3576/bsp make os-image-cx3576    # rootfs + full mos image
```

`make os-debs` runs the BSP-consuming producer too, so `BOARD_DIR` matters there
as well; `make os-deb-preflight` names every missing producer input at once,
before the first container starts.

Host binfmt is **not** required for a cross build. `build.sh` selects the
`default` (docker-driver) builder when it can reach the target platform and the
`mos-<arch>` docker-container builder when it cannot, the way the RAUC and
podman builds do. On the container builder the link between the two files is an
OCI layout under `_out/<board>/stages/` rather than a tag in the daemon's image
store, because a `docker-container` builder cannot read that store — handed a
tag that is present it answers `pull access denied, repository does not exist`,
about a registry. `docs/design/build.md` §4.1 records both modes.

Outputs to `_out/<board>/`. The first four are consumed by the image assembler
-- `build/src/mkimage-cx3576.ts` and `mkimage-uefi.ts`, entered through
`bash build/run.sh --mkimage-cx3576|--mkimage-uefi --board x64`. The last three are **not**:
they are read by the smoke runner, and nothing copies any of them into the
image.

| File | Read by | Contents |
|---|---|---|
| `rootfs-verity.img` | assembler | squashfs-zstd with the dm-verity hash tree appended, padded to a whole MiB |
| `rootfs-verity.env` | assembler | verity parameters as strict `KEY=value` |
| `boot-cmdline-a.txt` / `-b.txt` | assembler | the full kernel `append` line for each slot |
| `rootfs-report.txt` | a reader | package list, installed size, setuid/setgid inventory, file capabilities |
| `factory-root.oci` | smoke runner | the packed root as an OCI-layout archive; `docker load -i` it |
| `factory-root.txt` | smoke runner | what that archive is: `ref`, `platform`, `target`, `archive`, `bytes`, `sha256`, `source-date-epoch`, TAB-separated |
| `rootfs-stages.txt` | smoke runner | the Dockerfiles as built, in order, each with its content hash. It records which FILES ran, not what the image is made of |
| `rootfs-packages.txt` | a reader | **what the image is made of**: one row per local package with its version, architecture, archive sha256 and owning producer directory, read out of the pool index. Written only after the build succeeded |
| `mosd-build.txt` | smoke runner | **the commit `mosd` and `apid` in this root were built from** |

### `mosd-build.txt`, and why it is a copy

`pkgs/mosd/hack/build-target.sh` writes `_out/mosd-build.txt` on every build --
`target`, `elf-arch` and `commit`, TAB-separated, the same shape
`factory-root.txt` uses so one reader reads both -- and `build.sh` copies it
into `_out/<board>/` beside the factory root. **It is not copied into the
image.**

Copied rather than read from the top-level path, because the top-level one
describes *whatever was compiled most recently*: build cx3576 and then x64 and
`_out/mosd-build.txt` says `aarch64-unknown-linux-gnu` while `_out/x64/` still
holds x86-64 binaries. The per-board copy is what keeps the smoke runner
comparing an image against the build that produced it.

`build.sh` **removes** it when `mosd` is declined, for the same reason it
empties the staged `mosd/` directory: a record left by a previous build would
describe binaries this image does not carry, and the smoke runner would then
assert a commit against an artifact that is not there. Absent is a state it
already handles -- it prints that nothing was asserted, and says so on its own
first lines -- and stale is one nothing could catch.

Every layout constant is read from `boards/cx3576/board.env`; none is duplicated
in `build.sh`, `compose/` or the overlay. The board console/storage
cmdline fragment (`console=ttyFIQ0,… earlycon=… net.ifnames=0`) is a board fact
too and lives there as `BOARD_CMDLINE_ARGS`, moved out of `build.sh` when
x64 became the second board to need a mos image.

### The cmdline files are a contract

The assembler does not re-derive the verity table: it lifts the
`dm-mod.create="..."` and `dm-mod.waitfor=` fragments straight out of these two
files with `sed` and writes them into each boot slot's `mos-verity.env`, next to
the shared `boot.scr`. (The mos slots carry no `extlinux.conf` — U-Boot tries
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
`rootfs-report.txt`.

## Package allowlist

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
- **`curl`** — the health gate's apid probe (`rootfs/overlay/usr/lib/mos/mos-health`) fetches
  `https://127.0.0.1/healthz`. It prefers `curl`, falls back to `wget`, and
  SKIPs when neither is present. `rauc` links libcurl but does not ship the
  binary, so without this package the gate covers two of its three components
  and still reports green — a probe that skips is not a probe that passes. One
  line to revert if the size budget is ever revisited.

Deliberately **not** added: `squashfs-tools` and `cryptsetup-bin`. Packing the
root is a build-stage job (they are installed in `compose/90-pack.Dockerfile`'s
pack stage only), and the kernel opens the verity device straight from `dm-mod.create=`
with no userspace tool involved.

Installed size: **217 MB against the 400 MB budget**. rauc,
rauc-service, libubootenv-tool and curl plus their dependencies account for the
13 MB; the budget is unchanged. `rauc-service` is 47 KB by dpkg Installed-Size,
which is below the megabyte rounding of `TOTAL_MB` — it did not move the number. curl's own chain is about 1 MB of that (`curl` 537 KB,
`libcurl4` 860 KB, `libssh2-1` 345 KB, `libnghttp2-14` 228 KB, `libpsl5` 152 KB,
`librtmp1` 142 KB, per `rootfs-report.txt`).

## Read-only root wiring (`overlay/`)

Staged into the build context by `build.sh`, with `*.in` templates rendered
from the layout env so the shipped image carries no placeholder:

| Path | Purpose |
|---|---|
| `etc/fstab.in` | `/mnt/data` from DATA (`noatime,x-systemd.growfs`), `/mnt/state` from STATE, `/mnt/meta` from META, `/var` from EPHEMERAL (`noatime`, **no** growfs), tmpfs `/tmp` — all keyed on lowercased `PARTUUID=` |
| `usr/lib/mos/mos-data-layout` | validates writable DATA and creates the direct `/mnt/data/mos` and `/mnt/data/srv` namespace roots plus known system subdirectories; no migration or compatibility behavior |
| `etc/systemd/system/mos.mount` | binds `/mnt/data/mos` onto the appliance-owned `/mos` namespace |
| `etc/systemd/system/srv.mount` | binds `/mnt/data/srv` onto the operator-owned `/srv` namespace |
| `etc/fw_env.config.in` | the redundant U-Boot env pair, addressed by partition GUID. The single `fw_env.config` source in the tree; `pkgs/rauc/render-config.sh` asserts its structure rather than shipping a competing file |
| `etc/repart.d/*.conf` | eight definitions in disk order; only `80-data.conf` grows. The two `uenv` placeholders carry `SizeMinBytes=0`: repart will not claim an existing partition below the definition's minimum, which defaults to 10 MiB, and the uenv pair is 64 KiB — without it the whole run aborts with *"Can't fit requested partitions into available free space"* and `/mnt/data` never grows |
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
from `boards/<board>/hwinit/` — staged into `BOARD_HWINIT_DIR` — and derives
the enable list by iterating the board facts that are actually staged:

```
for c in /tmp/board-init/*.conf; do n="$(basename "$c" .conf)"; ... ln -sf ... ; done
```

This is not a style preference. A hardcoded unit list is what installation and
enablement drift apart through: a unit the globs install and the list never
enables costs the image its stable MAC or its USB debug console, with no error
anywhere. Deriving the list keeps them in step, so adding `hwinit-<n>` plus
`mos-<n>.service` under `boards/<board>/hwinit/`, and an `<n>.conf` to the
board, is sufficient.

**Both directions are asserted, and neither is a count.** A conf with no script
is an unread board fact and fails by name; a `/usr/lib/mos/hwinit-<n>` with no
`/etc/mos/<n>.conf` is a unit that can never run and fails by name. What is not
asserted at build time is the third direction — a board that declares
`BOARD_HWINIT_CONFS` and whose `init/` is missing stages no conf, installs no
unit, and the two counts agree at zero. The image verifier (`verify/`) holds
that one at image level: it compares the declared facts against the installed
helpers.

No board fact and no board name is restated in this layer. Module names, sysfs
paths, UART device and speed, CAN bitrate and FD flag, MAC seed and gadget IDs
all live in `BOARD_INIT_DIR` and are staged verbatim into `/etc/mos`, where the
units read them at runtime. The board name appears in exactly one place, the
board's own producer directory: `compose/10-compose.Dockerfile` names no board,
it installs whichever `mos-board-<board>` the resolution selected.

## RAUC system.conf is rendered, not committed

`rootfs/overlay/etc/rauc/system.conf` is **generated** by
`pkgs/rauc/render-config.sh`, which owns the template and its assertions,
and is gitignored. `build.sh` runs the renderer before
staging the overlay, so the template plus `boards/cx3576/board.env` are the
single source of truth and the rendered file cannot drift from them.

The bundle builder, `build/src/bundle.ts`, runs `render-config.sh --check`.
It guards a narrower case — someone hand-editing the generated file after the
last build — rather than committed-copy drift, which the renderer rules out. It
consumes `rootfs-verity.img` too, so `build.sh` has necessarily run first and
the file is present.

## systemd-repart is a package of its own on trixie

trixie splits `systemd-repart` into a package of its own where bookworm shipped
it inside `systemd`, so it is not free with the init system. `mos-system` names
it in `Depends` for that reason — the relationship no ELF metadata could show,
and its absence is silent — and the image verifier (`verify/`) asserts the
enablement symlink.
The failure if it were missing announces nothing — the device boots and DATA
simply never grows past the 64 MiB the assembler creates.

## Storage tiers, and the /var contract

DATA grows to fill the media at `/mnt/data`. The initializer creates two direct
children: `/mnt/data/mos` is bound to the appliance-owned `/mos` namespace and
`/mnt/data/srv` is bound to the operator-owned `/srv` namespace. `/mos` holds
custom UI versions, update downloads, application artifacts, the container
graphroot, and the backing trees for `/home` and `/root`. The development image
has no migration links or compatibility layout.

`/mnt/state` (STATE) holds configuration and identity. `/mnt/meta` (META)
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
`MOS_VAR_MIB`) are **required**: `build.sh` fails if any is missing from
`boards/cx3576/board.env`. There is deliberately no fallback. A build that
quietly emitted the superseded nine-partition arrangement — `/var` growing, no
DATA partition — would pass every downstream check, which is precisely the class of
silent-wrong-artifact this layout work exists to prevent.

## CJK guard

The pack stage runs a CJK check over the mos-owned paths — the overlay's mount
units, seed scripts, `repart.d` definitions, `fstab` and `fw_env.config`.
Vendor packages ship translations and are deliberately not scanned.

## Dev root access on mos

There is **no baked root credential on mos, ever** — not for the dev profile
either. A mos rootfs is byte-identical on every device that flashes it, so any
usable hash in the image is a fleet-wide shared secret; the pack stage asserts
the factory shadow carries only locked markers and **fails the build**
otherwise, which is why `build.sh` has no `ROOT_PASSWORD` plumbing at all.

What a developer actually gets on mos:

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

The measurements below record the earlier APT-based composer. The current
composer uses locked archives and dpkg; its package order is recorded in
`dpkg.log`, and it produces no APT transaction logs.

Two cache-hot `make os-rootfs-cx3576` runs produce a byte-identical
`rootfs-verity.img`. sshd host keys are **not** baked into the image — they
would be a private key shared by every device and would change the verity root
hash on every cold build; `mos-seed-state` generates them per device on first
boot instead.

**A cold x64 build reproduces itself.** Two cold builds of one unmodified tree,
at one commit, each on a `docker-container` builder created for it so that
neither could replay the other's cache, produced the same `rootfs-verity.img` —
`6ca98787…` on both sides — and the same `/boot/initrd.img`, `01e29d26…`.
Measured 2026-08-31, when this board still had an initrd. Since PLAN-074 it has
none; what replaced it as a boot-partition payload is `mos-kernel-x64`'s
bzImage, which is reproducible for a different reason — the source is pinned by
tag and content hash, the builder by digest, and `KBUILD_BUILD_TIMESTAMP`,
`_USER` and `_HOST` are pinned to the same 1577836800, so the kernel does not
stamp the wall clock and the builder's hostname into its own image.

This section used to say the opposite, and it was right to: seven cold builds
of one tree gave seven different hashes. Three separate surfaces carried
build-host state into the packed root. Each has been removed rather than
tolerated, because a floating root is a floating dm-verity root hash, and
`SQUASHFS_TIME` and `VERITY_SALT` are pinned precisely to stop that.

| Surface | What it carried | What was done |
|---|---|---|
| `/boot/initrd.img-*` | build-host inode numbers on 182 of 183 cpio entries, and the wall clock in 71 mtimes | `compose/10-compose` declared `SOURCE_DATE_EPOCH` in the environment, because `update-initramfs` read it from there and it was the kernel package's own postinst that ran it. **The surface is gone rather than pinned**: PLAN-074 replaced Debian's kernel with one that has `CONFIG_DM_INIT`, so there is no initramfs on this board and nothing builds one. The successor payload, the bzImage, is pinned by `KBUILD_BUILD_TIMESTAMP`/`_USER`/`_HOST` in the BSP build |
| `/usr/share/factory/var/cache/ldconfig/aux-cache` | glibc's `{dev, ino, ctime, size}` for every shared library, as the BUILD host saw them | dropped in `pack-tree-surgery.sh`. A regenerable cache, already wrong for the device the moment it ships, and `ldconfig` rebuilds it anyway |
| `/usr/share/factory/etc/shadow` and `/etc/shadow-` | the shadow last-change DAY for the accounts Debian's postinsts create: `systemd-network`, `messagebus`, `systemd-resolve`, `sshd` | `account-pin-shadow-dates.sh`, in `compose/90-pack`'s `closed` stage, pins every account to day 18262 — the same `2020-01-01` the three mos accounts already carried. On the composed path `useradd` writes that day itself, because the whole apt transaction runs under `SOURCE_DATE_EPOCH`; the pin is what makes the field a function of the tree either way |

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
  `_out/<board>/pkg-logs/` with its timestamps stripped is byte-identical, over
  an operation count both sides print, when both sides took the same package
  set. Re-derive that count from the logs of the run in front of you; it moves
  with the package set.
- **When it does differ, attribute before concluding.** A whole-file sha256
  cannot tell a working fix from a broken one. Unpack the cpio and charge each
  difference to exactly one category — content first, then mtime, then inode —
  because a fix that pins every mtime and leaves inode numbers floating still
  fails a byte comparison and is not a failed fix.

`build/run.sh --build-rootfs --no-cache` exists so the subject side can be
cold without pruning the daemon's cache out from under every other build on the
machine. A `docker-container` builder created for the run is emptier still, and
buys a second thing: the driver then links the two files by OCI layout under
`_out/<board>/stages/` instead of through the daemon-global
`mos-rootfs-stage:*` tags, which two concurrent worktrees would otherwise
interleave on — producing a complete, plausible root blended from two trees.
Give that builder a name unique to the run: the isolation is the name, and
sweeping by it afterwards is the only way to see a removal that failed.

### Running the gate

Both sides cold, one board, both cut with `git worktree add --detach`, both on
the `default` buildx builder, and each driven through its own tree's
`rootfs/build.sh` rather than a re-typed argument list — a transcribed
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
  trees for content, and `unsquashfs -lln` over **every** entry for mode,
  uid/gid and path with size and mtime excluded and re-sorted on that triple.
  **Print the entry count beside the verdict and refuse a zero** — a listing
  that failed to materialise compares clean against another empty one, and the
  denominator is the only thing that separates "identical" from "nothing was
  examined". Derive it from the run in front of you rather than from any number
  written down here: `unsquashfs -l rootfs-verity.img | wc -l`. It moves
  whenever a file enters or leaves the root, and it moved when the stage chain
  was replaced by the composition.
  Every mtime in both listings is the pinned `2020-01-01 00:00`. Content and
  metadata fail in different ways and either instrument alone reads green over
  the other's failure. Drive both from the failing side before believing them:
  one mode bit, one gid and one renamed path each register, and an unmutated
  pair is 0.
- **Check the apt order directly**, from `_out/<board>/pkg-logs/` on each side
  rather than from the extracted root. `dpkg.log` with its timestamps stripped
  is byte-identical over every operation both sides logged — print that count
  too — which is the check that the configuration order was the same on both
  sides. Under composition that order is APT's own, derived from the packages'
  `Depends`, so what this compares is whether one dependency graph produced one
  sequence twice. `alternatives.log` and `apt/history.log` are identical once
  `update-alternatives`' own timestamp and `Start-Date`/`End-Date` are removed.
  These are the same bytes the packed root used to carry: `compose/90-pack`
  copies them out of `/var/log` before the purge and the purge refuses to run
  if that copy is missing, so the check cannot be silently lost to a later
  cleanup. Nothing in this repository runs this comparison automatically — it
  is an instrument a person drives across two builds, and there is no green run
  to inherit.
- **Expect the host-key echo in `apt/term.log`.** The RSA/ECDSA/ED25519
  fingerprints `openssh-server`'s postinst prints as it generates them differ on
  every build, three per side, and they appear in the control pairing as well.
  The keys themselves are removed by `scripts/pack-strip-build-residue.sh`,
  which counts what it removed and refuses to leave one behind, and are not in
  the image.
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
floating `debian:bookworm-slim` in the pack stage. `build-env/images.env`
pins that base by digest, so the pack tools are a decision rather than a build
date.
