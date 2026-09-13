# rootfs — locked Debian runtime composition

Builds a Debian trixie and systemd userspace root for x64, virt-arm64 and
cx3576 and s905x5m. Root, kernel/support and firmware are independent signed components.
The root contains no board kernel or module payload and no metadata trust anchors.
It is assembled into a current three-partition complete factory image.

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
MICA_ARCH=amd64 make os-debian-cache
MICA_ARCH=amd64 make os-debian-verify
MICA_ARCH=amd64 MICA_ROOT=/path/to/empty-root make os-debian-install

# Add the upstream dependencies of the common mos package set.
MICA_ARCH=amd64 MICA_DEBIAN_PACKAGES=rootfs/packages/common.pkgs make os-debian-cache

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

### Fetching through a mirror

`MIRROR` in `debian/sources.env` is **not** what fetches, and reading it as a
download source is the easy mistake to make here. `run.sh` uses it twice, both
times after every archive is already local: to spell debootstrap's `apt_dest`
index filename, and as debootstrap's own mirror argument on a run whose download
phases are all disabled. What fetches is each record's absolute `url`.

`MICA_DEBIAN_MIRROR` rewrites the prefix of that URL at fetch time. The record is
left alone — it stays the provenance statement, naming which snapshot and which
pool path the pin came from — and the mirror is a property of one build host.
There is none in the committed defaults: unset, a build downloads exactly what
it downloaded before.

| Value | The URL becomes | For |
|---|---|---|
| `<base>` or `pool:<base>` | `<base>/pool/<path>` | a mirror serving Debian's live pool: `https://deb.debian.org/debian`, an `apt-mirror`, a caching proxy |
| `snapshot:<base>` | `<base>/archive/debian/<SNAPSHOT>/pool/<path>` | a mirror of snapshot.debian.org, which keeps each record's own snapshot |

```bash
MICA_DEBIAN_MIRROR=https://deb.debian.org/debian MICA_ARCH=amd64 make os-debian-cache
MICA_DEBIAN_MIRROR=snapshot:https://snapshot-cloudflare.debian.org \
    bash rootfs/debian/docker.sh cache --arch amd64 --package hostname
```

**The mirror is tried first and the record's own URL is the fallback.** The two
shapes fail differently, and that is the reason both exist. A pool mirror
carries the *current* pool while these pins are a *snapshot*, so every pin some
newer upload has superseded is simply not there; a 404 is normal, and the older
the snapshot the more archives take the fallback. A snapshot mirror preserves
each record's snapshot, so nothing is missing — except the bootstrap helper,
whose URL names deb.debian.org and has no snapshot in it to rewrite, so that one
archive always falls back under `snapshot:`.

Because falling back is silent per archive, `cache` reports the split —
`downloaded 69 archives (69 from the mirror, 0 from the pinned URL)` — and warns
when a configured mirror served none of them. Without it, a mirror that is doing
nothing looks exactly like one that works.

**The committed SHA256 is the anchor, not the host.** It is checked at the
download whichever host answered, and `verify.sh` then compares `dpkg-deb -W`'s
name, version and architecture against the record, so a mirror can neither serve
different bytes nor substitute a different package. That is what makes fetching
from anywhere sound — and it is why a mirror whose bytes do not match is a
failure naming that mirror, never a reason to quietly try somewhere else.

`cache` is the only command that reads the variable, and `debian/docker.sh` only
passes it to `cache`; `verify`, `select`, `install` and `configure` run with
`--network none` and stay offline. The mirror base must be `https://` — `fetch.ts`
requires it of the mirror exactly as it does of a pin, including after redirects.

There is no path in this tree that *refreshes* the pins: nothing regenerates
`packages/*.json` for a newer snapshot, so the next base bump is still a hand
edit of 172 records. A mirror does not change that, and the fallback above is
what keeps a live-pool mirror useful as those pins age.

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
unblock in `mica-bt`); with their new dependencies (libglib2.0-0, libdw1,
libelf1) they add about 11 MB of installed size (TOTAL_MB 204, budget 400) —
see `rootfs-report.txt`.

- **`wpasupplicant`** — the WiFi station role. micad's `wifi_client` reconciler
  renders `/etc/wpa_supplicant/wpa_supplicant-<iface>.conf` and drives
  `wpa_supplicant@<iface>.service`. Both are the package's own contract, not a
  preference: the template's `ExecStart` has
  `-c/etc/wpa_supplicant/wpa_supplicant-%I.conf` baked in, so the file name and
  the unit name have to agree with micad's or the supplicant starts against a
  configuration that is not there. Without this package `wifi.client` renders a
  file nothing reads and enables a unit that does not exist — which systemd
  reports on the device and nowhere else.
- **`hostapd`** — the provisioning access point. micad's `wifi_ap` reconciler
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
| `wpa_supplicant@.service` | yes, `-c/etc/wpa_supplicant/wpa_supplicant-%I.conf` | no | left installed and unenabled — micad owns it |
| `hostapd@.service` | yes, `… /etc/hostapd/%i.conf`, `ConditionFileNotEmpty=/etc/hostapd/%i.conf` | no | left installed and unenabled — micad owns it |
| `hostapd.service` | yes, non-templated, reads `/etc/hostapd/hostapd.conf` | **yes** | **masked** |
| `wpa_supplicant.service` | yes, D-Bus mode, no condition | **yes** | **masked** |
| `dbus-fi.w1.wpa_supplicant1.service` | `Alias=` link created by the postinst | — | **masked** (same unit under another name) |

`hostapd.service` is condition-gated on `/etc/hostapd/hostapd.conf` being
non-empty, so today it does not actually start — but that is one operator `cp`
away from a second hostapd fighting the reconciler for the radio while
`hostapd@wlan0.service` still reports healthy. `wpa_supplicant.service` has no
condition and does start; it also carries `RuntimeDirectory=wpa_supplicant`, so
systemd deletes `/run/wpa_supplicant` when it stops — taking the control socket
of the templated instance micad started with it.

Masked rather than disabled because `wpasupplicant` ships
`/usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service`: a plain
`systemctl disable` leaves the D-Bus activation path open, and masking does not.

### Config directories

`/etc/wpa_supplicant` and `/etc/hostapd` are both mode **0700** — once a device
is configured they hold pre-shared keys in the clear. The root is a read-only
dm-verity squashfs, so each is a STATE-backed bind
(`etc-wpa_supplicant.mount`, `etc-hostapd.mount`) exactly as `/etc/ssh` is; a
reconciler rendering into a read-only path fails on device and nowhere else.

## Image profile (`/usr/lib/mica/profile.conf`)

The product's `PROFILE` (`products/<name>/product.env`), `dev` or `prod`;
`tools/product.sh` rejects anything else. A production image is a product
with `PROFILE=prod`, composed from the same tree.

Both profiles disable SSH by default. The immutable profile identifies the
built userspace policy; it is not an administrator credential or a signing grade.
The image verifier checks the packed profile and access defaults.

## micad

`build-env/deb/build.sh --producer micad --arch amd64|arm64` builds the management
packages in the pinned Rust toolchain. Composition installs them from the local
package pool. The producer supplies the binaries, systemd units and exact D-Bus
policies; the runtime needs no package manager or compiler.

`/var/lib/mica` binds DATA/state/mos. Persistent credentials retain restricted
subdirectory/file ownership. The outer directory allows traversal for the
explicitly group-readable WireGuard key store used by systemd-network.
MQTT application enrollment remains package-specific; mqttd has no management
D-Bus grant. Optional feature selection is resolved before root composition.

## Board hardware init

Board-agnostic mechanism, and the content is filed per board: the units and
their scripts come from `mica-boards:<board>/hwinit/` (six of each on cx3576; x64
has no such directory and stages an empty one), and the board-specific facts
they read — module names, sysfs paths, UART device, CAN defaults, MAC seed,
gadget IDs — come from conf files staged from `BOARD_DIR/init/`, falling back to
the board's `bsp/init/`, into `/etc/mica/`. Both are package
payload now: `mos-board-<board>` installs the programs, the units and the confs
that `BOARD_HWINIT_CONFS` names, and refuses a fact no script reads or a script
with no unit to run it. Every unit is condition-gated on
its conf file and never blocks, delays, or fails the boot; WiFi association / BT
pairing stay with connd. The units are enabled via `multi-user.target.wants`
symlinks like micad.

| Unit | Conf | Does |
|---|---|---|
| `mica-modules` | `modules.conf` | `modprobe -q` the board's hardware modules; a module for an absent SKU is skipped |
| `mica-otg` | `otg.conf` | write the USB OTG role to its syscon node (`/etc/mica/otg-mode` overrides) |
| `mica-can` | `can.conf` | set bitrate / restart-ms / CAN FD and bring the interface up |
| `mica-bt` | `bt.conf` | rfkill unblock + `btattach` on the configured UART (ordered after `mica-modules`) |
| `mica-mac` | `mac.conf` | give every `eth*` with a kernel-random MAC a stable address derived from the eMMC CID and the port's place in the bus topology |
| `mica-gadget` | `gadget.conf` | build the CDC ACM debug console gadget and bind it to the UDC |

`mica-mac` exists because neither cx3576 NIC has a MAC in hardware, so the
kernel invents a random one on every boot: gmac0/eth0's dts node carries
neither `mac-address` nor `nvmem-cells`, and the PCIe RTL8168 has no EEPROM and
takes `eth_hw_addr_random()`.

The address is `02:` + `md5(seed + topology)`. The seed is the eMMC CID — a
read-only chip register unaffected by reflashing the media. **The topology is
the port's own path under `/sys/devices`**, which
`/sys/class/net/<iface>/device` resolves to: `platform/2a220000.ethernet` for
the on-board GMAC, `platform/…/0000:01:00.0` for the part behind PCIe. It is the
identity udev's `ID_PATH` names, and it is where the silicon is attached rather
than when it was found. Both halves are hardware, so a board keeps its MACs —
and its DHCP reservations — across image updates and across a change in probe
order. Interfaces whose `addr_assign_type` is not `NET_ADDR_RANDOM` are left
alone. `make os-mac-test` drives the derivation, including the red direction.

The assignment ships as **three** files, and any one of them missing makes the
other two a no-op:

- `mica-mac.service` — the cold-plug sweep, ordered before `network-pre.target`.
  A one-shot pass cannot reach a port that registers later, and on cx3576 both
  NICs appear at 11.67 s, which may be after this unit has already run.
- `60-mica-mac-stable.rules` — the mechanism: `hwinit-mac %k` on each net `add`
  event. udev writes the device database and broadcasts the event to libudev
  listeners only after a `RUN+=` program returns, so networkd cannot configure a
  link before the address is on it.
- `60-mica-mac-stable.link` — `MACAddressPolicy=none` for `eth*`. Without it
  systemd's own `99-default.link` (`MACAddressPolicy=persistent`) assigns these
  ports an address first — keyed on the machine id and, when the port has no
  `ID_NET_NAME_*` property, on the interface name — and the kernel then records
  `NET_ADDR_SET`, which `hwinit-mac` reads as “somebody else owns this”. No rule
  number fixes that: `net_setup_link` is a builtin evaluated inline while the
  rules are matched, and `RUN+=` is deferred until they all have been.

The SoC OTP CPUID would be a deeper root of identity than the eMMC CID but has
no dts node in this tree and no hardware validation.

`mica-gadget` gives the board an out-of-band console: with the OTG port in `otg`
role the PHY enumerates as a device when a host PC is plugged in, and a udev
rule (`60-mica-gadget-getty.rules`) pulls in `serial-getty@ttyGS0` when the port
appears. The gadget serial number reuses the `mac.conf` seed, so USB identity
is stable too.

The Bluetooth adapter name needs no unit of its own: bluez's hostname plugin
is loaded by default and overrides `Name`, so the adapter follows the system
hostname as long as `/etc/bluetooth/main.conf` does not pin one.

---

## Root composition and signing

The package pool is built and indexed first. `rootfs/packages/resolve.sh` selects
exact current producers, board, profile and enabled features. Upstream Debian
pins add their recorded consumer closure. No compilation or dependency discovery
occurs inside the offline installation step.

`rootfs/compose/*.Dockerfile` contains the ordered composition stages;
`build/src/stages.ts` validates their arguments and records the chain. Scripts
under `rootfs/scripts/` implement reusable package, filesystem and artifact checks.
The output includes rootfs.squashfs, rootfs-verity.img, explicit verity geometry,
package/build reports and the factory root export.

```bash
make os-deb-preflight
bash build-env/deb/build.sh --producer micad --arch amd64
bash build-env/deb/repo.sh --arch amd64
MICA_PRODUCT=x64-dev bash rootfs/build.sh     # the product's meta/ is its public manifest
```

This example builds one producer; prepare the complete selected pool through the
build guide before composition. `MICA_BOARD=virt-arm64` and `MICA_BOARD=cx3576` use
the corresponding ARM64 pool. All signing inputs are explicit in the component
producer, separate from public factory defaults. Follow
[the complete build guide](../docs/design/build.md) to package root, kernel/support,
firmware and signed deployment records, then assemble a fresh complete image.

The root verity object contains its hash tree. The detached PKCS#7 root-hash
signature is made by the content signer. A root update does not regenerate the
kernel package; kernel/support changes do not regenerate the userspace root.
The image assembler verifies every named component before writing the factory
image. There is no raw rootfs-slot installer or old image conversion.

## Writable namespace and boot ordering

Only DATA grows. SYSTEM stores authenticated deployment files; UEFI uses a
separate ESP and cx3576 a fixed firmware partition. Physical DATA namespaces
include state, meta, system/user application data and bounded disposable paths.
The native loader establishes machine identity on DATA before starting PID 1.

The root remains read-only; DATA/var is bound over the whole `/var` tree.
`mica-data-layout` establishes directories and byte/inode project limits before
`mica-seed-var` copies the initial template and `var.mount` exposes it. Protected
identity and management credentials remain on DATA/state, outside the general
var quota. New services can use `StateDirectory=` without another bind mount.
Persistent extension units are separate from the immutable boot chain.

DATA/containers is independently mounted at `/mos/containers`. Container and
system/user projects retain separate accounting without byte/inode limits; only
variable data has a bounded project limit. Service bounding
sets remove CAP_SYS_RESOURCE so ordinary root services cannot bypass those quotas.
Unbounded writers can fill DATA, including space needed by state/meta. Directory reset
uses allowlisted physical DATA paths and preserves identity and deployment records;
it does not restore arbitrary application writes during OS rollback.

Logs use volatile storage. Capture journal and boot evidence before stopping a
test. The exitrd shutdown path releases DATA/SYSTEM, verity mappings and loop
backing files cleanly. See [readonly root](../docs/design/ro-root.md) and
[storage](../docs/design/storage.md) for the exact mount policy.

## Verification and reproducibility

`make os-rootfs-manifest-test`, `make os-deb-preflight-test` and
`make os-install-closure-gate` check selected producer coverage, archive freshness,
installed ELF/unit/account closure and reduced feature selections.
`verify/run.sh --verify` checks the complete current image and its packed root.
Runtime acceptance additionally exercises leaf binds, identity, quotas, health,
component updates and shutdown on x64 and virt-arm64.

Seed timestamps, machine identity placeholders, shadow dates, ext4 checksums and
squashfs ordering are controlled by the packing scripts. Build reports state the
source and package identities. `build/run.sh --compare-roots` attributes differences;
never describe a dirty source stamp as a reproducible clean commit.
