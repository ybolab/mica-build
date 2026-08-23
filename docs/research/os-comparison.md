# Research: OS Landscape Comparison (decision basis)

> English | [中文](os-comparison.zh.md)
>
> Condensed from the 2026-08 evaluation of balenaOS, Talos, Torizon OS, Venus
> OS, and Yocto-from-scratch. Records what was chosen from whom and what was
> rejected — so future contributors don't re-litigate settled trade-offs.

## 1. Comparison matrix

| Dimension | balenaOS | Torizon OS | Talos | Yocto DIY | **mos choice** |
|---|---|---|---|---|---|
| Build | Yocto (Poky+BSP+meta-balena) | Yocto (meta-toradex) | buildkit + Go pkgs | Yocto | **buildkit** (Yocto only inside board dirs when unavoidable) |
| Rootfs immutability | RO partition A/B | OSTree hardlink trees | squashfs (in-initramfs) | assemble yourself | **Talos squashfs, disk-backed + dm-verity** (PLAN-006) |
| OS update | HUP full-partition A/B | OSTree commits + aktualizr | full-image A/B | RAUC/swupdate layers | **RAUC slots + Uptane client in machined** |
| Update security | TLS + proprietary | **Uptane** | image signature | assemble yourself | **Uptane** (Torizon-validated) |
| Delta updates | binary deltas (10-70x) | OSTree object pull | none | casync options | **RAUC adaptive block-hash over static HTTP** |
| App delivery | supervisor + docker-compose | compose as Uptane secondary | Kubernetes | assemble yourself | future: **compose bundle as Uptane secondary ECU** |
| Declarative runtime config | none (target state = apps only) | none (/etc + scripts) | **COSI machine config** | none | **COSI** — the reason Talos is the core |
| Field provisioning | boot-partition config.json, AP tools | Toradex tooling | none (push config first) | none | **balena patterns**: BOOT file, USB, AP portal (access.md §7) |
| Remote reach (NAT) | VPN dial-back + cloud | Torizon Cloud | SideroLink (Omni) | none | **SideroLink** (planned) |
| Shell/SSH | yes (dev open, prod keyed) | yes (normal Linux) | none | yes | **gated + variant-split** (access.md) |
| Hardware reach | 90+ device types via Yocto BSPs | Toradex SoMs first | UEFI-centric + overlays | anything, at cost | per-board artifact dirs (boards.md) |
| License | OS Apache-2 / openBalena AGPL / cloud closed | OS open / cloud closed | MPL-2.0 | n/a | MPL-2.0 (talos fork) + Apache-2 tooling |

## 2. What was taken from whom

- **Talos**: the core. COSI declarative convergence, machined supervision,
  immutable squashfs rootfs, single-image mindset, machine-config model,
  upstream-maintained apid/talosctl. Kept by riding upstream k8s-less gating
  (PLAN-007) instead of forking by deletion.
- **Torizon**: the update trust architecture (Uptane, lockbox-style offline
  bundles, multi-ECU model for future app/bootloader updates). Its OSTree was
  rejected: content-addressed rootfs would replace Talos's squashfs identity
  model and widen the runtime attack surface.
- **RAUC** (Yocto ecosystem): the slot installer. Chosen over reimplementing
  slot writing/bootcount/power-safety in Go (PLAN-005, superseded) once the
  disk-backed rootfs removed the "single FIT file" elegance argument.
  Integrated CLI-only, no D-Bus, machined stays the only orchestrator.
- **balenaOS / Venus OS**: field engineering patterns — offline provisioning
  media, SD/USB update UX, dev/prod image variants, "config file on the boot
  partition" as the zero-network bootstrap. Their cloud-centric device
  supervisors were not adopted (webd + updater fill the role locally).
- **Yocto**: only as a caged BSP tool inside board directories; its package
  ecosystem/licensing tooling is the one real loss, compensated by SBOM
  scanning in CI (tracked as an open obligation).

## 3. Rejected alternatives (with the killing argument)

| Option | Why rejected |
|---|---|
| Whole-OS Yocto (build a mini-Torizon) | runtime control plane would be empty: no COSI equivalent, config drift returns; build times and specialist skill cost. **Re-raised 2026-08-23 on a different argument — package selection and distro independence — and re-rejected with measurement; see §3.1** |
| `debootstrap --variant=minbase` instead of `debian:*-slim` | **measured 2026-08-23: identical package set, strictly worse on disk**; see §3.1 |
| Photon OS as a base | it is a distribution, not an escape from one: VMware maintains ~1000 RPM specs in `vmware/photon/SPECS`, and the last GA is 5.0 (2023-04). Adopting it trades a Debian dependency for a smaller, slower-moving one under Broadcom |
| balenaOS as base | supervisor/cloud coupling; no declarative machine config; AGPL/closed pieces in the management plane |
| Torizon as base | Toradex SoM gravity; OSTree vs our verity/squashfs identity model; cloud closed |
| PLAN-005 (FIT-in-RAM single file + custom Go updater) | ~130MB RAM residency; re-implements RAUC's hardened territory; per-pair delta server needed. Superseded by PLAN-006 |
| OCI/registry as update transport | second transport beside static HTTP + lockbox must exist anyway; registry adds a stateful service for zero gain |
| Keeping the deletion-based fork | 401-commit drift proved unmergeable; upstream k8s-less gating (9ffa772ba) made it obsolete |

### 3.1 Addendum: "build our own userland" re-examined (measured 2026-08-23)

The Yocto rejection above was written about the **management plane** — a
from-scratch OS would have no COSI equivalent. It did not answer the two
arguments it was re-raised on: that building our own lets us pick exactly the
packages we need, and that it frees us from a distribution. Both are answered
here with numbers so the question does not come back a third time.

**The distro tax is real and was measured.** `debian:trixie-slim` arrives with
**78 packages / 117 MB that nobody chose**; mos names 15 packages and ends up
with 161 packages / 199 MB installed. So the premise is sound: most of the
image is not a mos decision.

**But almost none of it is reclaimable, and the reclaimable part was already
reclaimed.** RFCT-099 removed the package manager — apt, dpkg, perl-base,
debconf, gpgv — for 24 MB. What remains of the 78 is the floor of a glibc
userland: `coreutils` 17.6 MB, `libc6` 12.7 MB, `bash` 7.0 MB, `util-linux`
4.9 MB, `libssl3` 5.9 MB. Keeping them is not a Debian decision; replacing
them means musl + busybox, which is changing the base rather than trimming it.
The dependency closure is not dominated by systemd either — measured, systemd
+ udev + dbus pull 25 packages while the feature set (openssh, bluez,
wpasupplicant, hostapd, curl, rauc) pulls 88.

Optimistically, a from-scratch userland saves **40–60 MB**. The rootfs is
210 MB against a 400 MB budget. **The space buys nothing.**

**`debootstrap --variant=minbase` was measured directly and is strictly
worse.** It produces the *same 78 packages* — `comm` between the two package
lists shows minbase has nothing slim lacks — because the official `-slim`
images are built by debuerreotype, which *is* minbase plus a documentation and
locale strip. The difference is on disk: minbase carries 33 MB of
`/usr/share/locale`, 8 MB of `/usr/share/doc` and 5 MB of `/usr/share/man`
against slim's 1 + 2 + 1. Switching would mean adopting 42 MB of extra content
and then writing the code to delete it again, to arrive back where we started.

**What Photon OS actually is, since it was raised as the model.** Its
architecture is ~1000 RPM spec files maintained in-tree (`vmware/photon`,
branch `5.0`, `SPECS/`) with `tdnf` as the package manager. That is the shape
of "build your own userland" done seriously, and the maintenance cost shows in
the release cadence: 5.0-GA is dated 2023-04-28. Bottlerocket (§4) is the same
pattern executed better, and was already evaluated.

**The conclusion that holds, and the principle behind it.** Independence is
bought per-component, not per-distribution, and mos has already bought it
where it matters: the kernel and U-Boot are built from pinned sources in
`board/cx3576/`, the management plane is our own Rust, and PLAN-012's
container engine is statically linked and therefore base-independent by
construction. What remains on Debian — glibc, coreutils, systemd, bluez,
wpa_supplicant, openssh — is precisely the set with the least differentiation
value and the highest need for someone else's security response.

## 4. Addendum: Bottlerocket (evaluated 2026-08-17)

AWS's from-scratch immutable OS: upstream LTS kernel + glibc + **systemd** +
patched GRUB (GPT-priority A/B via signpost), all management userland in Rust
(apiserver, updog/TUF, migrator), host access via admin/control containers,
dm-verity rootfs, SELinux enforcing. Build system: Rust `buildsys` driving
internal RPM specs (no runtime package manager).

Verdict: **same architectural pattern mos converged on independently**
(immutable + verity + A/B + TUF + gated access + image variants); not adopted
as a base because signpost speaks no U-Boot, its settings tree has no
reconciliation loop (too weak for connd-class networking), and the
AWS-coupled build system plus thin non-AWS community make derivation more
expensive than the Talos path. Its init choice (boring systemd, Rust only at
the edges) is recorded as Plan B in research/init-strategy.md.

Adopted from it regardless: **tough** (Rust TUF library) for `update/sign`,
the **migrator** pattern for config schema migrations, the **admin container**
pattern as a `sealed`-profile access option, **waves** for fleet rollout.

## 5. Positioning

balenaOS wins at cloud-managed container fleets; Torizon wins at industrial
SoM + update standards; Talos wins at immutability and declarative purity. mos
takes Talos's architecture as the differentiator and back-fills the field
engineering the data-center heritage lacks — while keeping every borrowed
mechanism (Uptane, RAUC, SideroLink) in its upstream-maintained form rather
than absorbing forks.
