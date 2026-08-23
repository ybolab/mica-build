# PLAN-012 Container engine — a self-built static Podman, off by default, switched from apid

- **status**: proposal
- **createdAt**: 2026-08-23 10:40
- **approvedAt**: -
- **completedAt**: -
- **relatedTask**: -
- **milestones**: M1 the `podman/` build directory and its artifact set; M2 image wiring and the D-Bus/identity surface; M3 the settings key, the reconciler and the apid pane; M4 Quadlet as the container-application interface; M5 supply-chain tracking

## Context

The user's directive, 2026-08-23: a container engine that can be switched on
and off, **off by default**, switched on through apid. Follow-up directives
narrowed it further: build the engine **from source, statically, in a
dedicated `podman/` directory that compiles independently and outputs
binaries, the way `board/cx3576/kernel/` does** — not from distribution
packages.

### Why Podman and not the alternatives

Every number below was measured on 2026-08-23 by downloading the artifact and
unpacking it, not taken from documentation.

| Option | Installed size (arm64) | What it is |
|---|---|---|
| **Podman, static, root-mode set** | **67.8 MB** | daemonless engine + crun + netavark + Quadlet |
| Podman, Debian 12 packages | 46.7 MB | podman 4.3.1 — **no Quadlet** (4.4+) |
| Podman, Debian 13 packages | 61.8 MB | podman 5.4.2, Quadlet, netavark 1.14 |
| balenaEngine v20.10.43 | 55.4 MB | moby fork, one multi-call binary |
| containerd + runc + minimal CNI | 83.7 MB | runtime only, no client, no networking wiring |
| containerd + runc + CNI + `ctr` | 107.6 MB | as above plus a debugging CLI |
| Debian `docker.io` | 349.2 MB | over budget on its own |

**balenaEngine was the first recommendation and was displaced by
measurement.** Its case rested on being the smallest with networking included;
Podman is smaller and also has networking. What balena retains is genuinely
its own — delta pulls (binary diffs, 10–70× less bandwidth), atomic pulls that
survive power loss mid-download, and pull behaviour that does not thrash the
page cache on a low-memory device. Those are field-device properties, not
data-centre ones, and they are the recorded trigger to revisit this decision
(see Decisions → D1).

Against that: balena's last **released** binaries are `v20.10.43`, February
2024. `v20.10.44` was tagged in May 2024 and never released. The default
branch is `release/v25.0`, last commit 2026-08-20, **9846 commits ahead** of
that tag and 1542 behind moby upstream — an active rebase onto a newer moby
that has not produced a release in two years and six months. Adopting a
self-built snapshot of that branch would mean shipping something upstream does
not consider releasable, on a device whose whole trust model is that every
byte is traceable.

**containerd was considered and is more expensive for less.** balenaEngine and
Docker use containerd internally; Podman does not — its dependency chain is
`libc6, libdevmapper, libgpgme, libseccomp, libsubid, conmon,
containers-common, crun|runc`, with no containerd and no dockerd. Podman is
fork-exec: `podman → conmon → crun`, no long-running daemon. Choosing
containerd directly would mean building the client experience and the CNI
networking wiring ourselves, at 83.7–107.6 MB.

**`podman-remote-static` is not an engine and cannot be used as one.** The
20.9 MB tarball upstream publishes for `linux_arm64` is a REST client: its
binary carries `bindings/containers` 663 times and `libpod/oci_conmon` zero
times, and it contains the string `unable to connect to Podman socket`. It
requires a `podman system service` to talk to. Recorded because the name
invites the opposite conclusion.

### Why self-built rather than from Debian

Three reasons, in order of weight.

1. **The distribution's version decides our architecture.** Debian 12 ships
   Podman 4.3.1, which predates Quadlet (4.4). Quadlet turns a container
   definition into a systemd unit — and PLAN-011 D5 has just made
   `/usr/local/lib/systemd/system` a STATE-backed writable unit directory, so
   with Quadlet "install a container application" and "install a mos
   extension" become the same act. Being one distribution release away from
   that capability, with no way to reach it, is the wrong dependency.
2. **A static build decouples the engine from the base entirely.** Measured:
   `podman`, `crun`, `conmon`, `netavark` and `quadlet` all link statically.
   They carry no dependency on the image's libseccomp, libgpgme or
   libdevmapper, so the engine and the base distribution can move
   independently. The Debian 12→13 upgrade (a separate change) stops being a
   container decision.
3. **The version becomes ours to pin, with a hash.** The same discipline
   `update/sign` applies to release artifacts: a version and a `sha256` in one
   file, and an upgrade is a one-line change plus a full image-chain run.

The cost is stated plainly in Risks: six upstreams to track for CVEs, in three
languages, which is work Debian's security team does on the packaged path.

## Decisions

### D1 — Podman, built from source, statically, root-mode

**The artifact set** (measured against a reference static bundle for
`v5.8.4/arm64`; our own build will differ in detail, not in shape):

| Binary | Size | Why |
|---|---|---|
| `podman` | 41.7 MB | the engine |
| `netavark` | 14.1 MB | networking (Rust; replaces the CNI plugin set) |
| `crun` | 4.3 MB | OCI runtime — chosen over `runc` (10.8 MB static) |
| `aardvark-dns` | 3.7 MB | container-to-container name resolution |
| `quadlet` | 2.4 MB | container definitions as systemd units |
| `conmon` | 1.3 MB | per-container monitor |
| `catatonit` | 0.4 MB | container init (reaps zombies for `--init`) |
| **total** | **67.8 MB** | |

**Deliberately NOT built**, and each for a stated reason rather than by
omission: `runc` (crun is the runtime, 6.5 MB smaller), and `rootlessport`,
`pasta`, `fuse-overlayfs`, `fusermount3` — 4.9 MB of rootless-only support
that root mode does not use. See D5 for the rootless decision itself.

**Budget.** The rootfs is 203 MB after RFCT-099 removed package management,
against a 400 MB budget. The engine takes it to ~271 MB, leaving ~129 MB.

**REVISIT TRIGGER — recorded so this is a decision and not a default.** Adopt
balenaEngine instead, or in addition, if field measurement shows update
bandwidth or power-loss-during-pull to be a real constraint: those are the
three things balena has that Podman does not, and no amount of size advantage
substitutes for them. Revisit also if balena cuts a release from
`release/v25.0`.

### D2 — `podman/` is a self-contained build directory, like `board/cx3576/kernel/`

The kernel directory is the pattern: a `Dockerfile` whose final stage is
`FROM scratch AS artifact`, invoked with `-o out/`, exporting binaries that
later stages consume as a build context. Podman follows it exactly.

```
podman/
  Dockerfile            multi-stage: go / rust / c builders → scratch artifact
  Dockerfile.dockerignore
  versions.env          pinned tag + sha256 per upstream, the single edit point
  README.md             what is built, how to bump a version, how to verify
  out/                  build output (gitignored), consumed by os/rootfs/build-v2.sh
```

`make podman` at the top level, beside `make cx3576-kernel`. The build is
`docker buildx build -f podman/Dockerfile -o podman/out podman`, cross-building
to `linux/arm64` with the same buildx machinery that already cross-builds mosd
and the rootfs. **No new toolchain is introduced** — Go and Rust builders come
from images, and the C components are built in the same stage as their
dependencies.

`versions.env` is the whole upgrade interface: bump a tag and a hash, run the
image chain, read the verifier. That is the same shape as `os/layout/*.env`
and it is what makes "which Podman is on this device" answerable from the
tree.

### D3 — One switch, `container.enabled`, default `false`

The settings key is named for the capability, not the implementation:
`container.enabled`, not `podman.enabled`. If D1's revisit trigger ever fires,
the switch, the reconciler surface, the bus item and the apid pane are
unchanged and only the units and binaries move.

Default `false`, and false means **nothing runs**: the unit is installed and
not enabled, exactly as `hostapd@`/`wpa_supplicant@` are today
(`os/rootfs/Dockerfile.v2` records that pattern: *"mosd enables and starts
exactly the instance the settings tree asks for"*). PLAN-011 M2 made the
platform-config subtrees writable through `com.mos.Item1`, so the switch is a
bus item and an MQTT-addressable path for free.

`ContainerReconciler` in `mosd/mosd/src/reconciler/` owns the transition, on
the `SshdReconciler` model: enable+start on true, stop+disable on false,
report into live state.

### D4 — Quadlet is the container-application interface

An operator installs a container application by dropping a `.container` file
into `/usr/local/lib/systemd/system` — the STATE-backed writable unit
directory PLAN-011 D5 shipped — and Quadlet's generator turns it into a
service. **This is the same act as installing a mos extension**, which is why
it is a decision rather than a detail: it means mos does not need a container
manifest format, an orchestrator, or an app lifecycle of its own.

**Open, and it needs the user's answer before M4 is scoped:** does mos manage
container applications beyond providing the engine — compose files, automatic
restart policy, image update? Everything above assumes **no**: systemd owns
lifecycle, Quadlet is the interface, and the operator owns their units. That
is the smaller and more defensible scope, and it is consistent with how mos
treats every other unit on the device.

### D5 — Root mode first, rootless recorded as the harder, better answer

Podman's engine runs as the invoking user; in root mode the containers it
starts are root-capable, and that is a real widening of the device's attack
surface the moment `container.enabled` becomes true.

Rootless would remove it and is Podman's genuine advantage over balenaEngine's
root socket. It is not taken in M1–M4 because it needs a subuid/subgid range
for a service account, `fuse-overlayfs` or kernel-side idmapped mounts,
`pasta`, and 4.9 MB of support binaries — and because it should be designed
against `docs/design/access.md`'s account model rather than bolted on.

**Recorded as the intended end state, with the risk of not being there stated
in the apid pane**: turning the engine on grants root-equivalent capability to
whoever can reach it.

### D6 — The update-state shape is shared, not duplicated

RFCT-084 shipped `InstallUpdate` / `GetUpdateState` / `MarkUpdate` on
`com.mos.mosd1` with a live-state shape under `update`. A container-delivered
application update must read the same shape rather than inventing a second
representation of "something is installing". Reviewed before the reconciler's
bus surface is designed.

## Milestones

| # | Deliverable | Verification |
|---|---|---|
| M1 | `podman/` builds the seven binaries for arm64, statically, from pinned sources; `make podman`; `versions.env`; README | every binary is an aarch64 static ELF and matches its pinned hash — asserted in the build, not by eye; `make podman` from a clean tree |
| M2 | Image wiring: staged by `build-v2.sh`, installed by `Dockerfile.v2`, unit installed and **not** enabled, storage root on DATA | verifier assertions above the fixture boundary + negative controls in `os/ui-location-test.sh`: binaries present, unit **not** enabled, storage root on a growable partition, no engine socket without the switch |
| M3 | `container.enabled` in the settings schema, `ContainerReconciler`, apid pane | reconciler unit tests against a mock unit driver; apid route tests; live-bus test that the item is writable |
| M4 | Quadlet wired to `/usr/local/lib/systemd/system`; documented operator path | an offline test that a `.container` file in the STATE-backed directory produces a service |
| M5 | `versions.env` + a scheduled upstream-tag check in the privileged CI lane | the check fails loudly when an upstream tag moves ahead of the pin |

## Risks

**Six upstreams to track, in three languages** — `podman` (Go, plus its
vendored `containers/image` and `containers/storage`), `netavark` and
`aardvark-dns` (Rust), `crun`, `conmon`, `catatonit` (C). On the packaged path
Debian's security team does this. On this path we do. M5 is the mitigation and
it is not optional: a pinned version with nothing watching it is a version
that silently rots. `docs/research/os-comparison.md` already records SBOM
scanning as an open obligation; this makes that obligation heavier.

**`CGO_ENABLED=1` is required.** Podman's own Makefile states it (*"Podman does
not work w/o CGO_ENABLED, except in some very specific cases"*), so the static
build needs static C libraries, not a pure-Go build. `LDFLAGS_PODMAN_STATIC`
exists upstream and the build tags that shrink the dependency surface —
`containers_image_openpgp` (drops libgpgme), `exclude_graphdriver_btrfs`,
`exclude_graphdriver_devicemapper` — are the supported path. Expect M1 to be
the milestone that takes the longest.

**Storage on DATA, and the growth interaction.** Container images must not
live on `/var`: EPHEMERAL is wipeable. DATA is the only growth target
(`systemd-repart` extends it to the end of the disk on first boot), so the
storage root belongs there. That makes container images share a partition with
customer UI bundles and application data — a filling-up interaction that needs
a stated policy, not silence.

**Rootfs slot geometry.** ~68 MB more payload moves the squashfs, and
`os/layout/cx3576-v2.env`'s `MOS_ROOTFS_SLOT_MIB=256` floor with 125% headroom
is where that bites first. At 203 MB installed the current payload is ~57 MiB
compressed and the floor dominates; the engine will not by itself cross it,
but the calculation belongs in M2's evidence rather than in an assumption.

**The kernel is not a risk, and this was checked first.** All twenty container
options are already `=y` in `board/cx3576/kernel/config/kernel-cx3576z.config`
— `OVERLAY_FS`, `USER_NS`, `NET_NS`, `PID_NS`, `IPC_NS`, `UTS_NS`, `CGROUPS`,
`MEMCG`, `CPUSETS`, `BRIDGE`, `VETH`, `BRIDGE_NETFILTER`, `NF_NAT`,
`IP_NF_NAT`, `IP_NF_TARGET_MASQUERADE`, `NF_CONNTRACK`,
`NETFILTER_XT_MATCH_ADDRTYPE`, `SECCOMP`, `KEYS`, `NAMESPACES`. Measured
2026-08-23. Recorded because a vendor kernel missing any of them would have
reshaped this whole plan, and because the next person should not have to
re-measure it.

## What this plan does not do

**No orchestration.** No compose, no application manifest, no update
supervisor. D4 says why, and the question is open for the user rather than
decided here.

**No registry.** `docs/research/os-comparison.md` rejected OCI-as-update-
transport for the OS itself (*"registry adds a stateful service for zero
gain"*), and nothing here revisits that. Container images are pulled by the
operator's own configuration, over their own network.

**No rootless in M1–M4.** D5.

**No claim about hardware.** Every number in this plan is from an artifact on
a build host. Whether the engine runs on the cx3576 is the first flash.
