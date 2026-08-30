# PLAN-036 Compose rootfs from independently built Debian packages

- **status**: implementing
- **createdAt**: 2026-08-30 16:28
- **approvedAt**: 2026-08-30 18:40
- **relatedTask**: [RFCT-270](../task/RFCT-270.md)

## Context

The current rootfs chain uses nine Dockerfiles. Stages `10` through `40`
mutate one preceding image in a fixed order; `90-pack` closes and exports that
tree. Repository-built components are first exported as loose files and then
copied into the chain by rootfs-specific install scripts:

| Current owner | Loose input or action | Installed result |
| --- | --- | --- |
| `10-base` / `20-install` | Debian packages plus `overlay-v2` | common system policy, state mounts, seed tools, SSH/network policy |
| `30-feature-radios` | APT packages plus masks/mounts | Wi-Fi client, Wi-Fi AP and Bluetooth integration |
| `31-feature-containers` | `os/pkgs/podman/out-<arch>/` | seven Podman-family binaries and container policy |
| `32-feature-rauc` | `os/pkgs/rauc/out-<arch>/` | RAUC binary, service and D-Bus activation files |
| `33-feature-mosd` | Cargo release directory | mosd, apid, MQTT bridge/broker and units |
| `34-feature-mqtt` | two account scripts | MQTT static users only |
| `40-board` | modules tar, firmware, hwinit and rendered overlay | board-specific root content |
| `90-pack` | the assembled tree | closed root, squashfs, verity and exports |

The fixed order is compensating for missing package metadata. For example,
RAUC runtime libraries are installed in `10-base`; MQTT binaries are installed
one stage before their users; Podman runtime dependencies and its binaries are
separate instructions; board selection decides which packages and files a
later script must have seen. The stage comments explain these relationships
because no artifact declares them.

Debian packages are a better boundary for `10` through `40`: a package owns its
paths, declares its runtime dependencies, carries maintainer actions such as a
static account, and can be inspected or installed without a rootfs build. APT
still configures dependencies in a valid partial order, but that order is
derived from `Depends` rather than from Dockerfile numbers. Package producers
can build independently and in parallel; the rootfs composer waits only for
the selected package repository.

`90-pack` is intentionally different. Moving `/var` aside, relocating shadow,
removing the build-time package manager, producing squashfs/dm-verity and
exporting factory-root/boot artifacts are transformations of the complete
image, not installable component payloads. They remain finalization steps.

An approved concurrent task, RFCT-272 / PLAN-035, is modifying the present
stage driver and smoke executor. No implementation from this plan starts until
RFCT-272 is completed and committed. At that point this plan is rebased on and
re-investigated against the committed result before approval or implementation.
The final package architecture retires the ordered stage driver, so its
OCI-layout chain support is transitional rather than a second permanent build
path.

## Proposal

### 1. Add one reproducible Debian-package build substrate

Add `mos-build-deb` to `os/build-env`, based on the pinned Debian builder
family and containing `dpkg-dev` plus a small repository-owned packer. The
packer takes a staged filesystem tree and a control template, then:

- fills version and Debian architecture (`amd64`, `arm64` or `all`);
- calculates `Installed-Size`, md5sums and declared shared-library dependencies;
- normalises ownership to root and timestamps to `SOURCE_DATE_EPOCH`;
- runs `dpkg-deb --build --root-owner-group`;
- checks control fields and archive contents by reading the resulting package
  back with `dpkg-deb`.

Dynamic ELF dependencies come from `dpkg-shlibdeps` in the target-architecture
packaging stage. Dependencies invisible to ELF metadata remain explicit: for
example Podman declares `nftables` and `systemd`, and service packages declare
their systemd/D-Bus relationships.

Each output is written below `_out/debs/<arch>/pool/`. A repository builder
generates `Packages`, `SHA256SUMS` and a tabular package manifest from the
archives themselves, never from an independently maintained list.

The common control shape is deliberately ordinary:

```text
Package: mos-mqttd
Version: 0.1.0+git<commit>-1
Architecture: arm64
Depends: mosd (= 0.1.0+git<commit>-1), mos-mqtt-broker (= ...), ${shlibs:Depends}
Description: mos D-Bus to MQTT application bridge
```

No package may depend on installation order without expressing that dependency
in control metadata.

### 2. Split mosd/apid and MQTT into independent package producers

Use separate Dockerfiles and build targets on the shared pinned Rust builder:

- the mosd producer compiles only `mosd` and `apid`, emitting packages `mosd`
  and `mos-apid`;
- the MQTT producer compiles only `mos-mqttd` and `mos-mqtt-broker`, emitting
  packages `mos-mqttd` and `mos-mqtt-broker`.

The Cargo source workspace may remain shared initially, but each producer has
its own cache key, command, staged root and `.deb` outputs. Building the MQTT
packages must not produce mosd/apid binaries, and vice versa.

Package ownership is strict:

- `mosd`: `/usr/bin/mosd`, `mosd.service`, local root-only D-Bus policy;
- `mos-apid`: `/usr/bin/apid`, `apid.service`, and an exact-version dependency
  on `mosd`;
- `mos-mqttd`: bridge binary/unit, MQTT enrollment directory and the pinned
  bridge account;
- `mos-mqtt-broker`: broker binary/unit and the pinned persistent-state
  account.

The MQTT packages depend on mosd because mosd renders their runtime
configuration and owns their lifecycle. The units remain disabled in the
image. Static-account collision checks and deterministic shadow dates move
into the owning packages' maintainer scripts; package installation is run with
a temporary `policy-rc.d` that forbids starting services inside the build.

### 3. Convert the other component stages

| New package | Replaces | Key dependencies/content |
| --- | --- | --- |
| `mos-system` | `10-base` custom work and `20-install` | common overlay, seed/reconcile tools, system units, operator account; depends on the minimal Debian system/SSH/network floor |
| `mos-ca-trust` | certificate generation/copy stage | generated trust bundle and individual anchors without shipping OpenSSL tooling |
| `mos-profile-dev`, `mos-profile-prod` | `MOS_PROFILE` rendering | one immutable `/usr/lib/mos/profile.conf`; packages conflict and provide `mos-profile` |
| `mos-wifi` | Wi-Fi client half of `30-feature-radios` | depends on `wpasupplicant` and `rfkill`; owns the supplicant masks and `/etc/wpa_supplicant` STATE mount |
| `mos-wifi-ap` | Wi-Fi AP half of `30-feature-radios` | depends on `hostapd` and `rfkill`; owns the hostapd mask and `/etc/hostapd` STATE mount |
| `mos-bluetooth` | Bluetooth half of `30-feature-radios` | depends on `bluez` and `rfkill`; owns `/var/lib/bluetooth` persistence and the conditional HCI attach helper/unit |
| `mos-podman` | `31-feature-containers` | seven binaries, generator link and `/etc/containers`; declares ELF, `nftables`, journald and state-mount dependencies |
| `mos-rauc` | `32-feature-rauc` | binary, unit, service helper and D-Bus files; declares GLib/JSON/fdisk dependencies and retains the no-second-TLS assertion |
| `mos-board-cx3576`, `mos-board-x64` | `40-board` and rendered board overlay | one package per board containing its rendered configuration, hardware init, firmware/modules, boot inputs and board-specific dependencies |

Every board has its own Debian package; the composer does not copy a rendered
board overlay or loose BSP files. For cx3576, `mos-board-cx3576` owns the kernel
modules, selected firmware, hwinit configuration and board services. Its
boot-slot `Image`, DTB and U-Boot inputs are also carried by the package under
a board artifact directory for the finalizer to consume, even though they are
not runtime rootfs files. For x64, `mos-board-x64` depends on Debian's kernel
package and a small `mos-verity-initramfs` payload and owns its GRUB and image
assembly configuration. The finalizer exports the selected board's boot
artifacts before package-management cleanup; it does not source them directly
from `os/boards`.

RAUC's board-specific `system.conf` and bootloader configuration belong to the
board package, while the generic RAUC executable and activation path belong to
`mos-rauc`. Podman's configuration and Quadlet mount belong to `mos-podman`,
not to the common system overlay.

Wi-Fi client, Wi-Fi AP and Bluetooth are three independent package boundaries,
not one `mos-radio` package and not a combined Wi-Fi package. `mos-wifi` masks
`wpa_supplicant.service` and its D-Bus alias while leaving
`wpa_supplicant@.service` installed and unenabled for mosd. `mos-wifi-ap` masks
`hostapd.service` while leaving `hostapd@.service` installed and unenabled.
Neither Wi-Fi package depends on the other. Both and `mos-bluetooth` declare
`rfkill`; APT installs that shared dependency once.

The Bluetooth package owns the generic `hwinit-bt` program and
`mos-bt.service`; the unit remains conditional on `/etc/mos/bt.conf`. The
cx3576 board package owns that hardware-specific UART/protocol configuration,
the radio modules and firmware. This keeps board facts out of the Bluetooth
application package without leaving a Bluetooth service in the board package.
The cx3576 package manifest selects all three radio packages explicitly; the
x64 manifest selects none. A future board can therefore choose client, AP and
Bluetooth independently without changing package payloads.

Every custom package carries its copyright/license material below
`/usr/share/doc/<package>/`; this closes the current loose-binary delivery gap.

### 4. Replace the rootfs chain with package-set composition

Add explicit package manifests under `os/rootfs/packages/`. A resolved build
contains common product packages, one profile package and one board package,
for example:

```text
mos-system
mos-ca-trust
mos-profile-dev
mos-board-cx3576
mos-wifi
mos-wifi-ap
mos-bluetooth
mosd
mos-apid
mos-mqttd
mos-mqtt-broker
mos-podman
mos-rauc
```

The package repository contains both architectures, but the package metadata
and board manifest select only the target-compatible set. The rootfs build has
one composition Dockerfile: start from the digest-pinned Debian base, copy the
local repository and manifest, add a temporary trusted `file:` source, then
ask APT to install the named packages. APT resolves Debian and local
dependencies and configures them; `apt-get check` and `dpkg --audit` must be
clean before closing begins.

The build records installed local package name, version, architecture, archive
SHA256 and owning source directory in
`_out/<board>/rootfs-packages.txt`. This replaces `rootfs-stages.txt` as the
durable composition record.

Package producers are exposed as independent Make targets and an aggregate
`os-debs` target. The aggregate may execute producers concurrently; rootfs
composition does not compile a component and refuses a missing or stale
package repository with the exact target that produces it.

### 5. Keep only true whole-image operations in the finalizer

Migrate the valid `90-pack` operations to the composition Dockerfile's final
stages:

1. capture package inventory/logs and close package management;
2. perform `/var`, machine-id, resolver and shadow tree surgery;
3. assert state mounts, privileged-file ownership, capabilities and runtime
   dependencies against the complete tree;
4. build squashfs and append dm-verity;
5. export assembler artifacts and the factory-root OCI image.

These steps retain their current order because each transforms or validates
the complete root. They do not become Debian packages and do not impose an
order on component production.

Once composition passes the migration gates, remove `os/rootfs/stages/`, the
rootfs stage-selection/chain driver and component install scripts whose work
is now performed by packages. Keep pack helpers under a clearly named finalizer
directory.

### 6. Package and image verification

Add package-level gates before the full image build:

- unique file ownership across all local packages, with no undeclared
  `Replaces` escape;
- package name/version/architecture and `Depends` closure read from the `.deb`;
- install `mos-wifi`, `mos-wifi-ap` and `mos-bluetooth` separately and assert
  that their payloads are disjoint, none pulls another radio package, and
  `rfkill` is resolved as their shared dependency;
- install the board manifest into a clean pinned Debian base, then run
  `apt-get check`, `dpkg --audit`, service/account/path assertions and `ldd`;
- execute component version commands inside that installed root;
- rebuild representative packages twice under one `SOURCE_DATE_EPOCH` and
  require identical archives;
- retain the existing final image verifier, smoke register, negative smoke
  cases and factory-root equivalence gate.

Before deleting the old chain, build x64 through both paths and compare their
unpacked trees. Expected additions are package documentation and the package
composition record; every other difference requires an explicit explanation.
Then build and verify cx3576 through the new composer.

### 7. Reduce comments as part of the replacement

Deleting the stage chain removes most of the repeated narrative naturally.
New package Dockerfiles, control templates and maintainer scripts keep only:

- non-obvious security, boot, reproducibility or shell-semantics invariants;
- short package-boundary explanations that are not expressible as `Depends`,
  paths or tests;
- actionable failure messages.

Historical incident timelines, repeated measurements and prose describing an
obvious `COPY`/`RUN` move to neither the new code nor a replacement document;
Git retains them. Consolidate rootfs documentation around package production,
the package manifest and finalization. Acceptance requires at least a 60%
reduction from the current 2,548 comment lines under executable/configuration
files in `os/rootfs`, and a substantial reduction in the component build
drivers touched by the migration.

## Risks

- A Debian package still has an order when its declared dependencies are
  configured. The goal is to remove manual global stage order, not to pretend
  dependencies do not exist. Missing `Depends` fields are treated as package
  defects and caught in clean-root installation tests.
- Maintainer scripts can accidentally start services during image assembly.
  The composer installs under `policy-rc.d`, packages do not generate automatic
  start hooks, and enablement is represented by owned symlinks or explicit
  image presets.
- `dpkg-shlibdeps` cannot see programs execed by name or libraries opened with
  `dlopen`. Podman's `nftables` and `libsystemd` remain explicit dependencies,
  and the final assembled-root exercise remains mandatory.
- Board packages are generated artifacts. Their renderer must read
  `board.env` as the single source of truth and the package-content test must
  compare installed paths against the same board model used by verification.
- The running image still removes APT/dpkg. These `.deb` files are build and
  composition artifacts, not an on-device update mechanism; RAUC remains the
  device update boundary.
- Building standard packages exposes license/documentation obligations that
  loose binary copies currently obscure. Each package must ship the relevant
  copyright material before the old path is removed.
- RFCT-272 currently modifies files this plan eventually retires. Per the
  explicit coordination gate, all implementation waits for RFCT-272 to finish
  and commit. The investigation is refreshed from that commit before files are
  claimed so no active or newly committed work is overwritten.

## Scope

New package infrastructure under `os/build-env/deb`, package metadata and
Dockerfiles under `os/pkgs`, board package generation under `os/boards`, rootfs
package manifests and a replacement composition Dockerfile under `os/rootfs`.
The completed migration removes the numbered component Dockerfiles and the
stage-chain portions of `os/build`; updates smoke/package records in
`os/verify`; and revises Make targets, CI, rootfs/build documentation, the
changelog and PMA records.

This is a staged migration rather than one unreviewable cut: package substrate,
mosd/MQTT, RAUC/Podman, system/board packages, composer, then old-chain removal
and comment cleanup. Each milestone leaves independently inspectable `.deb`
artifacts and does not switch the shipping path until the dual-build comparison
passes.

## Alternatives

### Install `.deb` packages in the existing numbered stages

This improves file ownership but retains the global order and one rootfs image
as the build transport. It does not meet the requested independent-delivery
model.

### Use full Debian source packages and debhelper for every upstream build

This is attractive for archive publication, but Podman is already a pinned
multi-language, multi-upstream build and RAUC deliberately differs from
Debian's feature set. Re-running those builds through `debian/rules` would
duplicate the existing pinned builders. The proposed binary-package stage uses
standard Debian metadata/tools around their verified staged output; a later
public archive can add source-package policy without coupling rootfs
composition to it.

### Install local `.deb` paths directly with `dpkg -i`

`dpkg` does not resolve dependencies and would reintroduce handwritten order
or a repair pass. A local APT repository lets the manifest name packages while
APT resolves both local and Debian dependencies in one transaction.

### Package squashfs and dm-verity output as a `.deb`

Rejected because the output is the complete filesystem image, not a component
installed into it. Doing so would create a package whose payload contains the
package database and filesystem that produced the package.

## Annotations

- 2026-08-30: PLAN-034 was rejected. The user directed that mosd, MQTT and
  other eligible stages be compiled independently into Debian packages and
  that rootfs be recomposed from those package artifacts.
- 2026-08-30: The user required Wi-Fi client, Wi-Fi AP and Bluetooth to be
  delivered as three separate packages.
- 2026-08-30: Board-specific content is also delivered as one Debian package
  per board, including staged boot inputs. Implementation is paused until
  RFCT-272 is completed and committed to avoid conflicting edits.
- 2026-08-30 18:40: approved by the user ("do") and handed to a BKD three-tier campaign run from the L1 session issue 6rjx4wrt; four L2 workstreams (substrate+mosd/MQTT producers, RAUC+podman producers, system/profile/CA/radio/board packages, composer+finalizer+switch-over) with L1-ordered merges. RFCT-272 is committed (502b572), which satisfies the coordination gate above.
