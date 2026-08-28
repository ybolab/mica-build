# mos System Architecture

> English | [中文](architecture.zh.md)

The top-level map; each section names the record it summarises.

---

## 1. What mos is

An embedded appliance operating system: a read-only Debian root under systemd,
updated whole in A/B slots, managed by a small Rust plane that owns the
device's settings and drives systemd to match them.

| Layer | What it is | Where |
|---|---|---|
| OS core | Debian trixie with systemd as PID 1, packed into a squashfs with a dm-verity hash tree over it | `os/rootfs/` |
| Management plane | `mosd` — a settings tree, reconcilers that drive units, and a D-Bus surface | `os/pkgs/mosd/mosd/`, `docs/design/mosd.md` |
| API | `apid` — the HTTPS daemon; the dashboard is one client of the API it serves | `os/pkgs/mosd/apid/`, `docs/design/api.md` |
| Telemetry | `mos-mqttd` bridges the item tree to MQTT; `mos-mqtt-broker` is the on-device broker | `os/pkgs/mosd/mqttd/`, `os/pkgs/mosd/broker/` |
| A/B installer | RAUC, with a U-Boot `BOOT_ORDER` handshake on cx3576 and GRUB on x64 | `os/pkgs/rauc/`, `docs/design/uboot-ab-handshake.md` |
| Update trust | TUF metadata pinning a CMS-signed RAUC bundle | `os/pkgs/rauc-sign/`, `docs/design/release-signing.md` |
| BSP artifacts | per-board buildkit Dockerfiles producing kernel, device tree and bootloader | `os/boards/`, `docs/design/boards.md` |
| Workloads | podman plus the Quadlet systemd generator, off by default | `os/pkgs/podman/`, `docs/design/containers.md` |

## 2. Component inventory (runtime)

```
                  settings tree (TOML, STATE partition)
                                  |
                     mosd  --  com.mos.mosd, system bus
     _____________________________|______________________________
    |            |             |            |          |         |
  apid      reconcilers   RAUC control  mos-mqttd    sshd     podman
  HTTPS     wifi, sshd,   InstallUpdate  item ->    OpenSSH   Quadlet
  API +     hostname,     GetUpdateState  MQTT      driven    units,
  dashboard network,      MarkUpdate      bridge    by mosd   off by
            mqtt, container                                   default
```

- **systemd** is PID 1. Every piece above is a unit, and mosd starts, stops and
  re-renders those units rather than supervising processes of its own
  (`docs/design/connd.md`).
- **`mosd`** owns the settings tree persisted on STATE, exports it over the
  system bus as `com.mos.mosd`, and runs one reconciler per concern in
  `os/pkgs/mosd/mosd/src/reconciler/`. Its unit is `Type=dbus` (`os/pkgs/mosd/dist/mosd.service`).
- **`apid`** terminates TLS, authenticates the operator, and reads and writes
  device state by calling mosd over that bus; its TLS material, login-backoff
  counters and audit ring live under `/var/lib/mos/apid`
  (`os/pkgs/mosd/dist/apid.service`). The dashboard is one of its clients, and
  `os/pkgs/mosd/apid/openapi.json` is generated from the handlers.
- **Networking** is mosd's `network`, `wifi.client` and `wifi.ap` subtrees,
  reconciled into systemd-networkd, wpa_supplicant and hostapd units. The
  wireless half is recorded under the name `connd`; the concern is a pair of
  reconcilers, not a process (`docs/design/connd.md`).
- **Interface kinds.** A `network` entry declares a **kind** — physical, `vlan`,
  `bridge` or `wireguard` — and the one optional block that belongs to it. The
  block is authoritative and the interface name is not:
  *"`eth0.100` is a convention, not a declaration"*
  (`os/pkgs/mosd/mosd-settings/src/model.rs:499-500`). A physical entry renders
  one `.network` file, as it always did; each of the other three additionally
  renders a `.netdev` that creates the device, and the attachment is a line on
  the *other* interface's unit — `VLAN=` on the parent, `Bridge=` on the port.
  A removed virtual entry is torn down, not just unlinked, and a WireGuard
  tunnel's private key is drawn on the device into a `networkd-secrets/`
  directory beside the settings file, never into the settings tree
  (`docs/design/mosd.md` §5.3a).
- **`mos-mqttd`** publishes the item tree to a broker and applies writes back
  through mosd; `mos-mqtt-broker` is the local broker, built from `rumqttd` as
  a library rather than shipped as a third daemon (`os/pkgs/mosd/Cargo.toml`).
- **Containers** run through podman with the Quadlet generator. While the
  `container.enabled` switch is false — the default — `/etc/containers/systemd`
  is not mounted and no container unit exists (`docs/design/containers.md`).

## 3. Storage and boot

The disk is one GPT; the partition set is declared per board in
`os/boards/<board>/board.env`. On cx3576, where x64 replaces the loader and the
two U-Boot environment partitions with an ESP:

```
loader | uenv-a | uenv-b | boot-a | boot-b | rootfs-a | rootfs-b | meta | state | ephemeral | data
```

- **Root is read-only.** Each `rootfs-` slot holds a squashfs image with its
  dm-verity hash tree appended, assembled by `os/rootfs/build-v2.sh`.
- **No initramfs in the normal boot path.** The verity device is described
  entirely on the kernel command line with `dm-mod.create=`, composed per slot
  from that slot's verity parameters and the board's `BOARD_CMDLINE_ARGS`
  (`os/rootfs/build-v2.sh`, `docs/design/ro-root.md` §2).
- **Each boot slot carries** `Image`, the device tree, the shared `boot.scr` and
  a per-slot `mos-verity-<slot>.env` holding that slot's verity arguments
  (`os/build/src/mkimage-v2.ts`). Deliberately no `extlinux/extlinux.conf`:
  U-Boot tries extlinux first, so one there would bypass the handshake.
- **The handshake** is `BOOT_ORDER` plus a per-slot attempt counter in the
  redundant U-Boot environment at `uenv-a` / `uenv-b`. A slot that fails to boot
  burns its credits and the next reset moves on
  (`docs/design/uboot-ab-handshake.md`).
- **Four storage tiers** answer "what happens if this is lost?" — STATE
  (`/mnt/state`, configuration and identity), DATA (`/srv`, application data
  and homes), META (`/mnt/meta`, update metadata), EPHEMERAL (`/var`,
  disposable residue). The table is `docs/design/ro-root.md` §4.

## 4. Trust chain

```
dm-verity root hash on the kernel cmdline -> root filesystem verified per block at runtime
RAUC bundle -> CMS signature, verified against /etc/rauc/keyring.pem
TUF metadata -> four ed25519 role keys, root offline; pins the bundle's sha256,
                its length and its verity root hash
```

A release is signed twice by two unrelated hierarchies, and the separation is
the point: a TUF online key cannot sign a bundle and the bundle key cannot sign
metadata. Ceremonies, key custody and rotation are
`docs/design/release-signing.md`; `rauc-sign` signs and `rauc-verify`
verifies, both in `os/pkgs/rauc-sign/`.

Two gaps are recorded rather than assumed: nothing in the build signs SPL or
U-Boot, and no production keyring ships in the image
(`docs/design/uboot-ab-handshake.md` §9, `os/pkgs/rauc/system.conf.in`).

## 5. Access model

Provisioning and debugging are different problems, and mos does not answer both
with one shell (`docs/design/access.md`). Three ways in exist today:

1. **The API**, over HTTPS, authenticated by an argon2id password hash held in
   the settings tree, with persistent login-backoff counters and an audit ring.
2. **SSH** — OpenSSH, with mosd rendering the only file that configures it.
   Shipped on both profiles, off by default on both; persistent access is by
   public key and a root password is the transient exception.
3. **Physical recovery** — the RockUSB loader path and a whole-disk reflash,
   below the OS and reachable when nothing else is.

Disablement is layered, and two layers ship: the runtime switch, where
`enabled: false` stops and disables `ssh.service`, and the build-time image
profile — `dev` or `prod`, written into `/usr/lib` inside the verity root, so a
production device cannot be edited into a development one
(`os/rootfs/stages/10-base.Dockerfile`). The one-way META lockdown between them
is designed, and marked not implemented (`docs/design/access.md` §5.2).

## 6. Repository map

```
mos/
├── docs/          plans (docs/plan/), tasks (docs/task/), design records (docs/design/)
├── os/            the OS build
│   ├── boards/    one board.env per board — the partition geometry and every layout
│   │              constant — plus that board's BSP: kernel, U-Boot and firmware
│   ├── build/     TypeScript: the image assemblers, the bundle builder, the toolset wrappers
│   ├── build-env/ the pinned builder images every component build is FROM
│   ├── pkgs/      source this repository compiles into a shipped artefact:
│   │              podman/ (the container engine), rauc/ (the RAUC binary, its slot
│   │              config and the manifest templates), rauc-sign/ (TUF release trust
│   │              tooling, its own cargo workspace) and mosd/ — the Rust workspace:
│   │              mosd, apid, mos-mqttd, mos-mqtt-broker, mosd-settings
│   ├── rootfs/    the root filesystem: stage Dockerfiles under stages/, plus build-v2.sh
│   ├── tests/     shell suites over the built image
│   ├── tools/     three QEMU helper scripts
│   └── verify/    TypeScript: the board model, and the checks an assembled image must pass
├── extensions/    reserved for optional sysext layers; nothing is built from it
├── test/          the apid API suite, run against a booted image in QEMU
└── Makefile       top-level routing; `make help` lists every target
```

The rootfs is a chain of numbered Dockerfiles — base, install, one per optional
feature, board, pack — each built `FROM` the tag the previous one wrote. The
stage list is the directory, so adding a stage is adding a file
(`os/rootfs/stages/README.md`).

## 7. Boards

- **`cx3576`** — CX3576-Z, Rockchip RK3576, arm64. Vendor kernel tree, mainline
  U-Boot built in `os/boards/cx3576/bsp/uboot/`, WiFi and Bluetooth. Its RAUC bootloader
  backend is `uboot`, so this is the board the `BOOT_ORDER` handshake is for.
- **`x64`** — generic UEFI x86_64, the QEMU and CI baseline. No BSP build:
  firmware boots it, so there is nothing to compile. Its bootloader backend is
  `grub` and its assembler is `os/build/src/mkimage-x64.ts`.

A board produces artifacts and the OS build consumes artifacts; neither side
reaches into the other's build. Kernel configs must satisfy the shared
assertion set in `os/boards/common/mos-required.fragment` (`docs/design/boards.md`).

## 8. Where to read next

| Question | Document |
|---|---|
| What does mosd own, and what is in the settings tree? | `docs/design/mosd.md` |
| What is on the bus, and what are the item conventions? | `docs/design/bus.md` |
| What does the HTTPS API serve? | `docs/design/api.md`, `docs/design/dashboard.md` |
| Why is the root read-only, and where do writes go? | `docs/design/ro-root.md` |
| How does an update reach the other slot and commit? | `docs/design/uboot-ab-handshake.md` |
| How is a release signed, and by whom? | `docs/design/release-signing.md` |
| How does a device get its first credentials? | `docs/design/provisioning.md` |
| How do I run a container here? | `docs/design/containers.md` |
