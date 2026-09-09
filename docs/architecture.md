# mos System Architecture

The top-level map; each section names the record it summarises.

---

## 1. What mos is

An embedded appliance operating system: a read-only Debian root under systemd,
updated through signed file deployments, managed by a small Rust plane that owns the
device's settings and drives systemd to match them.

| Layer | What it is | Where |
|---|---|---|
| OS core | Debian trixie with systemd as PID 1, packed into a squashfs with a dm-verity hash tree over it | `rootfs/` |
| Management plane | `mosd` — a settings tree, reconcilers that drive units, and a D-Bus surface | `pkgs/mosd/mosd/`, `docs/design/mosd.md` |
| API | `apid` — the HTTPS daemon; the dashboard is one client of the API it serves | `pkgs/mosd/apid/`, `docs/design/api.md` |
| Application data | `mos-mqttd` bridges only exact package-enrolled `com.mos.<class>[.<suffix>]` application item trees to MQTT; `com.mos.mosd` is forbidden | `pkgs/mosd/mqttd/`, `pkgs/mosd/broker/`, `docs/design/bus.md` |
| A/B installer | Native durable file transactions with UEFI/FIT trial records | `pkgs/mos-deploy/`, `docs/design/uboot-ab-handshake.md` |
| Update trust | Signed deployment/catalog envelopes and kernel-enforced root/support signatures | `pkgs/mos-deploy/`, `docs/design/release-signing.md` |
| BSP artifacts | per-board buildkit Dockerfiles producing kernel, device tree and bootloader | `boards/`, `docs/design/boards.md` |
| Workloads | podman plus the Quadlet systemd generator, off by default | `pkgs/podman/`, `docs/design/containers.md` |

## 2. Component inventory (runtime)

```
                  settings tree (TOML, DATA namespaces)
                                  |
                     mosd  --  com.mos.mosd1, system bus
     _____________________________|_________________________
    |            |             |          |        |
  apid      reconcilers   Deployments    sshd    podman
  HTTPS     wifi, sshd,   InstallUpdate OpenSSH  Quadlet
  API +     hostname,     GetUpdateState driven   units,
  dashboard network,      Confirm/Reject     by mosd   off
            mqtt, container                       by default
                    |
            /run/mos/mqttd-device.env -> mos-mqttd -> MQTT
                                               |
                              exact-enrolled com.mos.* apps
```

- **systemd** is PID 1. Every piece above is a unit, and mosd starts, stops and
  re-renders those units rather than supervising processes of its own
  (`docs/design/connd.md`).
- **`mosd`** owns the settings tree persisted on DATA/state, exports it over the
  system bus as `com.mos.mosd`, and runs one reconciler per concern in
  `pkgs/mosd/mosd/src/reconciler/`. Its unit is `Type=dbus` (`pkgs/mosd/dist/mosd.service`).
- **`apid`** terminates TLS, authenticates the operator, and reads and writes
  device state by calling mosd over that bus; its TLS material, login-backoff
  counters and audit ring live under `/var/lib/mos/apid`
  (`pkgs/mosd/dist/apid.service`). The dashboard is one of its clients, and
  `pkgs/mosd/apid/openapi.json` is generated from the handlers.
- **Networking** is mosd's `network`, `wifi.client` and `wifi.ap` subtrees,
  reconciled into systemd-networkd, wpa_supplicant and hostapd units. The
  wireless half is recorded under the name `connd`; the concern is a pair of
  reconcilers, not a process (`docs/design/connd.md`).
- **Interface kinds.** A `network` entry declares a **kind** — physical, `vlan`,
  `bridge` or `wireguard` — and the one optional block that belongs to it. The
  block is authoritative and the interface name is not:
  *"`eth0.100` is a convention, not a declaration"*
  (`pkgs/mosd/mosd-settings/src/model.rs`). A physical entry renders
  one `.network` file, as it always did; each of the other three additionally
  renders a `.netdev` that creates the device, and the attachment is a line on
  the *other* interface's unit — `VLAN=` on the parent, `Bridge=` on the port.
  A removed virtual entry is torn down, not just unlinked, and a WireGuard
  tunnel's private key is drawn on the device into a `networkd-secrets/`
  directory beside the settings file, never into the settings tree
  (`docs/design/mosd.md` §5.3a).
- **`mos-mqttd`** dynamically publishes only exact package-enrolled
  `com.mos.<class>[.<suffix>]` application item trees and, in full mode,
  applies writes to the exact application service. It has zero D-Bus access to
  `com.mos.mosd`; mosd renders its topic identity as a one-purpose `/run` input.
  SSH, networking, credentials, containers, MQTT
  configuration, health, updates and power stay on the management plane and
  never become MQTT items (`docs/design/bus.md`). `mos-mqtt-broker` is the
  local broker, built from `rumqttd` as a library
  (`pkgs/mosd/Cargo.toml`).
- **Containers** run through podman with the Quadlet generator. While the
  `container.enabled` switch is false — the default — `/etc/containers/systemd`
  is not mounted and no container unit exists (`docs/design/containers.md`).

## 3. Storage and boot

Current images contain ESP/SYSTEM/DATA on x64 and virt-arm64, or
FIRMWARE/SYSTEM/DATA on cx3576. SYSTEM owns immutable root/support objects and
signed deployment records. DATA owns persistent state, metadata, applications,
user data and bounded disposable namespaces. Only DATA grows.

The signed UKI/FIT starts `mos-init`. It authenticates the selected descriptor,
opens signed root/support verity mappings, establishes persistent identity and
binds modules and firmware before systemd. Native trial records are decremented
before launch and confirmed only by the health path. Shutdown uses a bounded
exitramfs to release loops/mappings before their backing filesystem.

Selected DATA leaves are bound into service paths. The var parent skeleton
remains immutable; project byte/inode quotas contain bulk and disposable writers.
See [storage](design/storage.md) and [read-only root](design/ro-root.md).

## 4. Trust chain

Boot, content and metadata signing use independent keys. Firmware authenticates
the UKI/FIT; the kernel authenticates signed verity roots; native tools authenticate
strict component/deployment/catalog metadata against embedded public policy.
Normal updates never write firmware. Firmware publication and offline maintenance
have a separate signed receipt and mandatory readback.

See [release signing](design/release-signing.md) for overlap/removal and measured
limits. Development signing does not establish physical ROM/SPL provisioning.
QEMU evidence and pending cx3576 bench evidence are tracked separately.

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
production device cannot be edited into a development one. The profile is a
package — `mos-profile-dev` or `mos-profile-prod`, whose whole payload is that
one immutable file (`rootfs/packages-src/profile`) — and they `Conflict` by
name, so an image carries exactly one. The one-way DATA/meta lockdown between them
is designed, and marked not implemented (`docs/design/access.md` §5.2).

## 6. Repository map

```
mos/
├── docs/          plans (docs/plan/), tasks (docs/task/), design records (docs/design/)
├── boards/    one board.env per board — the partition geometry and every layout
│              constant — plus that board's BSP: kernel, U-Boot and firmware
├── build/     TypeScript: the image assemblers, the component and archive producers, the toolset wrappers
├── build-env/ the pinned builder images every component build is FROM
├── pkgs/      source this repository compiles into a shipped artefact:
│              podman/, mos-boot/, mos-deploy/ and the mosd Rust workspace
│              (mosd, apid, mos-mqttd, mos-mqtt-broker, mosd-settings); shared
│              black-box harnesses are kept together under mosd/tests/
├── rootfs/    the root filesystem: compose/ (the two composition Dockerfiles),
│              packages/ (the manifests and the resolver), packages-src/ (the
│              system, profile, radio and CA-trust producers), plus build.sh
├── tests/     shell suites over the built image
├── tools/     QEMU and development helpers
├── verify/    TypeScript: the board model, and the checks an assembled image must pass
└── Makefile       top-level routing; `make help` lists every target
```

The rootfs is **composed**: one APT transaction installs a resolved set of mos
`.deb` packages out of the local pool at `_out/debs/<arch>/` onto a
digest-pinned Debian base, and one finalizer closes and packs the result
(`rootfs/compose/`, two files). What is in an image is a package list, and
what orders the configuration is `Depends` — adding a component is adding a
producer, not a stage. `docs/design/build.md` §1.1 has the whole model.

## 7. Boards

- **`x64`** — generic UEFI x86_64, signed UKI and patched systemd-boot;
  the QEMU baseline.
- **`virt-arm64`** — ARM64 UEFI/QEMU using the same signed-file contracts.
- **`cx3576`** — CX3576-Z, Rockchip RK3576, vendor kernel, signed-policy U-Boot
  and FIT, Wi-Fi and Bluetooth. Physical acceptance remains a separate gate.
- **`s905x5m`** — independent BSP retained; no current MOS system-image target.

A board produces artifacts and the OS build consumes artifacts; neither side
reaches into the other's build. Kernel configs must satisfy the shared
assertion set in `boards/common/mos-required.fragment` (`docs/design/boards.md`).

## 8. Where to read next

| Question | Document |
|---|---|
| What does mosd own, and what is in the settings tree? | `docs/design/mosd.md` |
| What is on the bus, and what are the item conventions? | `docs/design/bus.md` |
| What does the HTTPS API serve? | `docs/design/api.md`, `docs/design/dashboard.md` |
| Why is the root read-only, and where do writes go? | `docs/design/ro-root.md` |
| How is a deployment installed and confirmed? | `docs/design/updates.md` |
| How is a release signed, and by whom? | `docs/design/release-signing.md` |
| How does a device get its first credentials? | `docs/design/provisioning.md` |
| How do I run a container here? | `docs/design/containers.md` |
