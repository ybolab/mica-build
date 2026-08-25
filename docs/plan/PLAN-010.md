# PLAN-010 Plan B migration - systemd base + mosd management plane

- **status**: in progress
- **createdAt**: 2026-08-17 20:30
- **approvedAt**: 2026-08-17 20:30 (user decision; see research/init-strategy.md)
- **completedAt**: -
- **relatedTask**: RFCT-008 (M1); further tasks created per-milestone on dispatch

> **On the name `webd` in this file.** The product HTTPS daemon was renamed
> `webd` -> `apid` by campaign `apid` (RFCT-055 code, RFCT-056 docs, RFCT-057
> audit). Every `webd` still written below is a **deliberate retention**: it is
> the name the daemon had while that milestone was executed, and the milestone
> records are history, not current state. The one forward-looking statement in
> this file — the architecture diagram in "Context" — was renamed to `apid`,
> because it describes the target, not the past. Current-state documentation
> lives in `docs/design/`; read `apid` wherever a milestone record says `webd`.

## Context

Decision record: research/init-strategy.md "DECISION 2026-08-17". The Talos
core is replaced by systemd as the OS base; the mos-specific value moves into
a Rust management plane. Everything OS-agnostic survives unchanged: the whole
BSP layer (validated on hardware through the machined bring-up), the
RAUC+Uptane update design (PLAN-006 — RAUC integration actually simplifies,
its native home is systemd/D-Bus), and the model layer of every design doc
(access, provisioning, display, connd, remote-management).

Architecture target (Venus OS + Bottlerocket hybrid, see research docs):

```text
systemd base: PID 1, mounts, networkd (incl. native WireGuard), journald,
              sysext (extension analog), udev
      ^
mosd (Rust): central state/settings tree + persistence + reconcilers
             (applies settings to networkd/systemd/RAUC) + remote bridge
      ^                                        ^
apid + kiosk (one UI, local/remote paths)    RAUC (native) + tough (TUF signing)
```

## Milestones

### M1 - systemd rootfs prototype boots on cx3576

- **Status**: in progress — RFCT-008. Done criteria: image build + verify script green
  locally; hardware boot to sshd over DHCP is the user's manual acceptance (pending
  user validation).
- buildkit-assembled Debian-based (bookworm/trixie slim) arm64 rootfs with
  systemd, systemd-networkd (DHCP default), sshd (dev profile), dropping onto
  the EXISTING boot chain (U-Boot -> extlinux -> BSP kernel + initramfs or
  direct root=; layout per current image pipeline, adapted in the mos repo —
  new `os/` directory, NOT in the talos repo).
- Reuse board/cx3576 artifacts as-is; kernel fragment already carries
  machined-era options (harmless) + WireGuard.
- Acceptance: boots to sshd + networkd DHCP on hardware; journald readable.

### M2 - mosd skeleton (Rust)

- **Status**: implementation complete — RFCT-009. Done criteria met locally
  (2026-08-18): `./mosd/hack/check.sh` green; `make os-image-cx3576` +
  `make os-verify-cx3576` green with mosd included (verify 47/47);
  on-device "settings applied live + survive reboot" remains the user's
  hardware acceptance (pending).
- Workspace per pma-rust baseline; state tree + settings persistence
  (STATE partition), IPC endpoint, first two reconcilers: hostname, network
  (rendering networkd units).
- Open decisions to settle in M2 design: IPC protocol (D-Bus vs varlink vs
  gRPC), settings schema/versioning (adopt Bottlerocket migrator pattern).
- Acceptance: settings write -> networkd unit rendered -> applied live;
  survives reboot.

### M3 - webd on mosd

- **Status**: implementation complete — RFCT-010 (plus RFCT-011 for the
  image-sizing and board hardware-init continuations, and RFCT-012 for
  adopting the hardware-verified Alpine board rootfs and porting its board
  facts into the hwinit layer). Done criteria met locally (2026-08-18): `mosd/hack/check.sh`
  green incl. the webd e2e test; `make os-image-cx3576` +
  `make os-verify-cx3576` green (verify 70/70, image ~427 MiB); on-device
  "browser to `https://<board-ip>/` -> wizard -> applied settings survive"
  remains the user's hardware acceptance (pending).
- Port webd's UI/HTTP layer to the mosd API (drop machined socket client);
  first-run setup + status + network config pane; kiosk deferred to display
  phase.

### M4 - A/B updates (PLAN-006 executed on systemd)

- **Status**: implementation complete — RFCT-020 (layout v2 constants +
  `os/mkimage-v2.sh`), RFCT-013 (squashfs+dm-verity pack + read-only root
  wiring), RFCT-014 (RAUC `system.conf`, bundle build, dev signing keys),
  RFCT-015 (health gate + machine-id oneshot), RFCT-016 (`update/sign` TUF
  skeleton), RFCT-017 (`os/verify-image-v2.sh`), RFCT-018 (U-Boot A/B handshake
  contract) and RFCT-019 (these docs). The on-device A/B switch and rollback
  remain the user's hardware acceptance and are **not** claimed here.
- Partition layout and trust chain per PLAN-006 (refined — see PLAN-006
  "Implementation notes (PLAN-010 M4)"); RAUC with native systemd integration;
  U-Boot BOOT_ORDER handshake; tough-based signing in update/sign; health gate
  = systemd unit states + mosd checks -> rauc mark-good.
- v2 is a sibling of v1 throughout: new files, new Makefile targets, a new
  `...-0002-...` GUID namespace. `os/mkimage.sh` and `os/verify-image.sh` are
  untouched, so a v1 image is still buildable and verifiable. *(True as
  delivered. RFCT-107 / PLAN-014 M1 has since deleted the v1 chain — v1 is no
  longer buildable from the tree, only from git history.)*

#### What was delivered

- **Layout v2**, ten partitions, one source of truth in
  `os/layout/cx3576-v2.env`; every consumer (assembler, verifier, RAUC
  `system.conf` renderer, `fw_env.config` renderer, `boot.cmd` compile) sources
  it rather than restating a constant.
- **Read-only root**: squashfs + appended dm-verity hash tree, assembled from
  the kernel command line alone (`dm-mod.create=` / `dm-mod.waitfor=`), no
  initramfs in the normal boot path. Writable state is split across STATE
  (configuration + identity), DATA (`/srv`, application data, the only growth
  target) and EPHEMERAL (`/var`, disposable). See `docs/design/ro-root.md`.
- **RAUC**: `rauc` + `libubootenv-tool` in the image, a rendered
  `/etc/rauc/system.conf` with two raw rootfs slots and the FAT boot slots as
  children, `statusfile=/mnt/meta/rauc.status`, and `os/bundle.sh` producing a
  CMS-signed verity bundle from gitignored development keys.
- **Boot contract**: `boot.scr` compiled from `os/boot/cx3576-boot.cmd` and
  written byte-identically into both boot slots, with the per-slot
  `mos-verity-<slot>.env` as the only file that differs. No
  `extlinux/extlinux.conf` in a v2 boot slot — see the lesson below.
- **Health gate**: `mos-health` confirms the booted slot with
  `rauc status mark-good` only on a clean probe result, and never performs
  remediation — rollback stays with U-Boot's `BOOT_x_LEFT` counter, which is
  what keeps the power-loss guarantee intact.
- **Signing**: `update/sign` (`mos-sign`) with a TUF repository layout and a
  sign/verify roundtrip, covering PLAN-006 Parts A and L phase 1.

#### Verification (2026-08-18, done criteria met locally)

- `make os-image-cx3576` + `make os-verify-cx3576` (v1 regression) —
  `RESULT: PASS (88/88 checks)`.
- `make os-image-cx3576-v2` — ten-partition image, 1315 MiB apparent / ~161 MiB
  on disk (sparse).
- `make os-verify-cx3576-v2` — `RESULT: PASS (228/228 checks)`.
- `bash os/mkimage-v2-selftest.sh` — `RESULT: PASS`, 137 checks.
- `make os-health-test` — `RESULT: PASS (54/54 checks)`.
- `make os-devkeys` + `make os-bundle-cx3576` — signed verity bundle;
  `rauc info` validates it against the shipped `system.conf`;
  `compatible=mos-cx3576`.
- `bash mosd/hack/check.sh` — `ALL CHECKS PASSED`.

Every number above is a local build/verify result. None of them is a hardware
result.

The 228 checks can actually fail, which was demonstrated rather than assumed.
RFCT-017 ran three negative tests, each against a copy of the image: a single
byte flipped 1 MiB into the ROOTFS-A payload fails dm-verity at exactly that
position; an `extlinux/extlinux.conf` injected into BOOT-A is caught; and the
debug U-Boot blob written over sector 64 trips *both* halves of the pairing
guard (differs-from-`uboot-mos` and identical-to-debug). A corrupted image runs
to completion and ends in `RESULT: FAIL` rather than aborting part-way.

#### One assertion that could not be made: `CONFIG_SQUASHFS_XATTR`

The user applied `CONFIG_SQUASHFS_XATTR` to `board/common/mos-required.fragment`
specifically for M4, so it should be clear that **nothing in this tree proves it
end-to-end.** The rootfs package set installs zero files carrying file
capabilities — `getcap -r` over the packed tree is empty — so there is no
cap-carrying file whose survival through the squashfs could be demonstrated.

RFCT-017 reported that as a gap instead of manufacturing a weaker check, and
rejected two candidates for good reasons worth keeping: asserting the squashfs
`NO_XATTR` superblock flag is clear passes here **only** because this build host
runs SELinux, so it would fail on a non-SELinux builder for a reason unrelated
to correctness, and a host-dependent assertion is worse than none; packing a
throwaway squashfs with a cap-carrying file tests mksquashfs on the verifier's
host, not the shipped artifact. What the verifier does instead is prove the
verification environment can round-trip a `security.capability` xattr — without
which an empty result is indistinguishable from an environment that silently
drops `security.*` — and then assert the packed capability set equals the source
inventory, with the PASS line stating that both are empty rather than claiming
preservation was shown.

It becomes a real tripwire the day a cap-carrying package is added. The proposed
follow-up is on the producer side (`os/rootfs/**`, RFCT-013 scope, **not done**):
give the image one cap-carrying file so the existing check has something to trip
on. A verifier must not edit what it verifies, which is why RFCT-017 recorded it
rather than implementing it.

#### What remains the user's hardware acceptance

Not claimed, not testable in this repository:

- A/B switch on device: install a bundle, reboot, land on the other slot.
- Rollback on device: a slot that fails to boot or fails the health gate
  exhausts `BOOT_x_LEFT` and U-Boot falls back to the previous slot.
- `rauc status` / `rauc install` against a provisioned keyring on real hardware.
- The dm-verity root actually mounting from `/dev/dm-0` at boot.
- The `mos-machine-id` oneshot writing a `machine_id` that the next boot picks
  up (inert until the custom U-Boot is flashed).
- The `docs/design/uboot-ab-handshake.md` §8 bring-up checklist.

#### `board/` dependency — resolved, with one gap

The v2 image must be paired with the **`uboot-mos`** U-Boot variant
(`make -C board/cx3576 uboot-mos`, `board/cx3576/out/uboot-mos/`), which the
user landed as commit `8b24f9d`. Escalation items 1-3 of
`docs/design/uboot-ab-handshake.md` §10 — the three marked as blocking M4
entirely — are resolved by that commit. The earlier framing that "the v2 image
cannot boot until the user applies a U-Boot change" is obsolete.

The two variants are not interchangeable and neither mistake announces itself:
`uboot-mos` in a v1 image corrupts the boot FAT partition on the first
`saveenv` (v1's boot partition starts at 16 MiB, exactly the mos env copy A
offset), and the debug variant in a v2 image has no persistent environment, so
it boots, looks healthy, and silently never runs the A/B handshake. The v2
assembler asserts both directions: the raw blob at sector 64 must equal
`out/uboot-mos/u-boot-rockchip.bin` and must differ from
`out/uboot/u-boot-rockchip.bin`.

Still escalated, unchanged: `board/**` is user-owned, so any further
defconfig or kernel-fragment change proposed by
`docs/design/uboot-ab-handshake.md` is applied by the user, never by this
repository's OS-side tasks.

#### The three integration defects, and why they are one class

Three defects were found **after** the branch had passed seven green gates.
They are recorded together because they are the same defect, and because each
one alone was enough to break every update:

| Defect | Shape |
|---|---|
| `rauc.slot=` missing from the kernel command line | config present, value inert |
| `mos-health` parsed `RAUC_SYSTEM_BOOTED_SLOT`, which rauc 1.8 never emits (it emits `RAUC_SYSTEM_BOOTED_BOOTNAME`) | script present, parse never matches |
| `rauc-service` absent from the image | binary present, daemon absent |

- **`rauc.slot=`.** The v2 root is `/dev/dm-0`, a device-mapper node. rauc can
  never match that against a slot's `bootname`, its slot name, or
  `realpath(device)` — the identification simply has no input, so it must be
  told the slot explicitly on the command line. Fixed in
  `os/boot/cx3576-boot.cmd` (RFCT-020); the reasoning and the rauc 1.8 evidence
  are in RFCT-017.
- **`RAUC_SYSTEM_BOOTED_SLOT`.** The gate parsed a variable name that does not
  exist in rauc's output under any configuration. Fixed in `os/health/`
  (RFCT-015).
- **`rauc-service`.** Debian splits `rauc` (CLI) from `rauc-service` (D-Bus
  daemon), and builds the CLI *with* service support, so it proxies every call
  over D-Bus and cannot work alone. Fixed in the v2 package allowlist
  (RFCT-013); PLAN-006 Part E is amended accordingly.

Together they meant **every update would silently roll back**: the health gate
read an empty slot, exited 0, never ran `mark-good`, and U-Boot reverted when
the credits ran out. The device boots, looks healthy, and stays on the old
version — no error anywhere.

**One wrong lesson to refuse.** `--no-install-recommends` was *not* the cause of
the missing `rauc-service`, and "drop `--no-install-recommends`" must not be
recorded as the fix. `rauc` 1.8-2 has **no `Recommends` line at all**, and the
dependency runs the other way — `rauc-service` `Depends: rauc` — so a
recommends-enabled build would not have installed it either (RFCT-013). The
actual lesson is the one below.

#### Lesson carried out of M4

The same failure class occurred eight times: extlinux silently winning over
`boot.scr`; hwinit units installed but not enabled; the debug U-Boot blob in a
v2 image; the unsuffixed `mos-verity.env` making every update roll back; a
missing `DATA_GUID` silently producing a nine-partition layout; and the three
RAUC integration defects above. In every case the full gate was green and the
gate was right — the checks were consistent with the artifact, they simply were
not checking the thing that was wrong. Each was found by reading or by an
explicit cross-check, never by a failing test.

The sharper form the last three give it: **asserting that a thing exists is not
asserting that it works.** A config file with an inert value, a script whose
parse never matches, and a binary whose daemon is missing all pass an
existence check and all fail in production. The check has to follow the value
through to whatever consumes it — which is why `os/verify-image-v2.sh` now
asserts the runtime machinery behind each component rather than its presence.

That is also why M4 ends with assertions at build time rather than verification
alone: the setuid/setgid inventory diff, the precious-data bind checks, the
U-Boot variant pairing guard, the required-layout-constants check, and the
`boot.cmd` / bundle-filename drift guards. A verifier can only check what it
was told to look for; a build-time assertion fails at the moment the
assumption stops holding.

### M5 - access + provisioning + connd on the new base

- **Status**: implementation complete — RFCT-021 (settings schema v3), RFCT-022
  (on-device identity and per-device secrets), RFCT-023 (sshd reconciler),
  RFCT-024 (first-boot self-provisioning), RFCT-025 (WiFi station reconciler),
  RFCT-026 (WiFi access-point reconciler), RFCT-027 (image + verifier
  integration), RFCT-029 (`/etc/shadow` on STATE), RFCT-030 (power actions),
  RFCT-031 (the loader partition) and RFCT-028 (these docs). Done criteria met
  locally 2026-08-19. **Every on-device behaviour — an SSH login, an
  association, an AP a client can join, a first boot on real flash — remains
  the user's hardware acceptance and is not claimed here.**
- access.md phase 1 (per-device password, gated sshd), provisioning.md Layer 1
  (first-boot self-provisioning in mosd), connd reconcilers over
  wpa_supplicant/hostapd (much thinner: systemd owns lifecycles).

#### What was delivered

- **Settings schema v3** — `access.ssh` / `access.console` / `access.device`,
  `provisioning`, `wifi.client` and `wifi.ap`, with `MigrateV2ToV3` in both
  directions. `access.webAdmin` is byte-identical through the upgrade. See
  `docs/design/mosd.md` §5.1–5.2.
- **On-device identity and per-device secrets** — `deviceId`, the device
  password and the AP PSK, all independent CSPRNG draws, minted on the device at
  first boot and persisted to STATE at 0600 inside a 0700 directory. Nothing
  secret enters the signed rootfs. See `docs/design/provisioning.md` §3.
- **First-boot self-provisioning** — provisioning.md Layer 1, running with no
  network of any kind: hostname derived from the device identity, SSH default
  taken from the image profile, `network` seeded empty, one atomic settings save
  as the commit point.
- **The sshd reconciler** — renders `/etc/ssh/sshd_config.d/10-mos.conf`, writes
  the device password into the root shadow entry, and drives `ssh.service`, in
  that order.
- **`/etc/shadow` on STATE** — a symlink into the STATE-backed tree, seeded from
  a factory copy and reconciled on every boot. This is what makes per-device
  password auth possible at all on the read-only root. See
  `docs/design/ro-root.md` §4.
- **connd, as two mosd reconcilers** — `wifi.client` over wpa_supplicant and
  `wifi.ap` over hostapd, with systemd owning the unit lifecycles and networkd's
  built-in `DHCPServer=yes` serving the AP (no dnsmasq). The single-radio
  conflict is **reported, not arbitrated**. See `docs/design/connd.md`, which is
  new and supersedes PLAN-008's Talos/COSI mechanism.
- **Image integration** — `wpasupplicant` and `hostapd` in both pipelines'
  allowlists, STATE-backed `/etc/wpa_supplicant` and `/etc/hostapd`, a
  `dev`/`prod` image profile at `/usr/lib/mos/profile.conf`, and the verifier
  assertions that prove the image and mosd agree.
- **Power actions** — `Reboot` and `PowerOff` on `com.mos.mosd1`, forwarded to
  systemd, exposed by webd as authenticated POST-only routes behind an explicit
  confirmation. Until this, nothing in mos could get from "update installed" to
  "update running" other than a shell.
- **The loader partition** — the Rockchip idbloader area became a real GPT
  partition, fixing a defect that wiped the bootloader on first boot. See below.
- **The v2 repart definitions actually grow now.** `uenv-a`/`uenv-b` are 64 KiB
  and repart will not claim an existing partition smaller than a definition's
  minimum size (default 10 MiB), so it concluded it had to create two new
  partitions, could not place them, and **aborted the whole run before touching
  anything**. v2's `/srv` therefore never grew on a real device, and the refusal
  looked exactly like a clean exit. Fixed with `SizeMinBytes=0` in both
  placeholder definitions.

#### Verification (2026-08-19, done criteria met locally)

Every number below was measured by running the command on the merged tree, not
copied from a task record:

- `make os-image-cx3576` + `bash os/verify-image.sh` — `RESULT: PASS (126/126 checks)`.
- `make os-image-cx3576-v2` + `bash os/verify-image-v2.sh` — `RESULT: PASS (293/293 checks)`.
- `make os-health-test` — `RESULT: PASS (54/54 checks)`.
- `make os-repart-test` — `RESULT: PASS (18/18 checks)`.
- `bash mosd/hack/check.sh` — `ALL CHECKS PASSED`, `203 tests run: 203 passed, 0 skipped`.
- v1 image 381 MiB apparent / 374 MiB on disk; v2 image 1315 MiB apparent /
  165 MiB on disk (sparse).

The verifier counts grew from M4's 88/88 and 228/228 through three independent
task branches: the shadow work added +1 / +19, the loader partition +10 / +17,
and the image integration +28 / +30 with 1 removed in each (the unconditional
"ssh.service is enabled" check, replaced by the profile-conditional pair that
covers both directions). 88+1+10+28−1 = 126 and 228+19+17+30−1 = 293, which is
what the two runs above report.

**Every number above is a local build/verify result. None of them is a hardware
result.** No agent in this campaign has booted anything.

The checks can actually fail, which was demonstrated rather than assumed.
Negative testing used three mechanisms chosen per guard: **source-of-truth
drift** (mutate one mosd constant, run both verifiers against the *unchanged*
images — the failure mode the extraction exists to catch, and it fires on both
pipelines at once); **image mutation** (a copy of the assembled image, mutated
with `debugfs -w` and written back); and **a deliberately broken build** from a
mutated Dockerfile, on which fourteen distinct guards fired, one per broken
property, and nothing else. A `prod` build of *both* pipelines was also verified
end to end at 126/126 and 293/293 — a guard that fails on a healthy image is as
bad as one that never fires.

#### Three places where an approved design doc contradicted the shipped code

This is the documentation form of the defect class the campaign exists to
prevent. A design document that says the opposite of the code makes a reader
confident about something false, exactly as a passing test that proves nothing
does. All three are now corrected in the documents themselves:

| Document | Said | Ships | Resolution |
|---|---|---|---|
| `access.md` §3 | `listenAddresses: []` — "empty = none" | empty = **listen on ALL**; no `ListenAddress` directive is emitted | **Doc amended to match the code.** The "none" reading would give an operator who enables SSH without naming an address a running-but-unreachable sshd, and closure is already expressed by `enabled: false` |
| `ro-root.md` §4 | `/etc/shadow` is read-only, on the verity squashfs | symlink into STATE, seeded from a factory copy, reconciled every boot | **Doc amended.** The contract genuinely changed; per-device password auth on v2 works *only* because of it |
| `provisioning.md` §2 | Layer 1 in machined under COSI, generating per-device **PKI** | Layer 1 in mosd on systemd; no PKI is generated, because nothing consumes one | **Doc rewritten** to what ships, with the dropped PKI claim called out |

A fourth, found while editing: `ro-root.md`'s partition numbers (META p7, STATE
p8, EPHEMERAL p9, DATA p10) predate the loader partition and were off by one
throughout. Corrected against `os/layout/cx3576-v2.env`.

And one **deliberate deviation from an approved plan**, recorded rather than
quietly taken: PLAN-008 Part D says the AP PSK "defaults to the per-device
provisioning PIN". It does not — it is a second, independent CSPRNG draw.
Reusing one string couples two very differently exposed credentials: the WPA2
PSK is broadcast-adjacent and offline-crackable from a captured handshake, and if
it is also the device password then recovering the WiFi key hands over the root
shell. A test asserts the two differ, so a future "simplification" fails the
build. See `docs/design/provisioning.md` §3.2.

#### What could NOT be proven, stated as plainly as M4's `CONFIG_SQUASHFS_XATTR`

M4's section here recorded an assertion that could not be made. M5 has four.

- **That the device's PAM stack accepts the hash mosd writes.** The image
  verifier proves the libcrypt packed in the image implements `$2b$` — measured
  on the arm64 object itself, zero `argon2` strings against
  `$1$ $2a$ $2b$ $2x$ $2y$ $3$ $5$ $6$ $7$ $gy$ $sha1$ $y$` — and the Rust tests
  prove the value written is well-formed bcrypt at the shipped cost that the
  device password round-trips through `bcrypt::verify`. **Neither proves a login
  succeeds.** No test here can: the test host is x86 and the library is an arm64
  object inside an image. This is the one property whose failure is most
  expensive, because it looks green from every angle — and it already went wrong
  once, when the first version wrote Argon2id into a field libcrypt cannot parse.
- **That first boot actually seeds `access.ssh.enabled` from the profile file.**
  The verifiers prove the image and mosd agree about the path, the key, the value
  and the matching static enablement. The seeding itself is `provisioning.rs`'s
  unit tests plus a real boot.
- **That `/etc/wpa_supplicant` and `/etc/hostapd` are writable at runtime** —
  only that each is a STATE-backed bind that is enabled and whose source the seed
  script creates. Whether the mount comes up is a boot-time fact. (v1 cannot
  assert STATE backing at all; it has no STATE partition, so it asserts what is
  true there instead.)
- **That `provisioning.rs` issues no network syscall.** The claim rests on the
  module's import list and a mechanical grep over its non-comment lines. A unit
  test cannot establish it, and claiming otherwise would be the M4 mistake.

One guard was **not** negative-tested: the build-time gate that rejects a
statically enabled unit template. The broken v2 build removed that gate along
with the masking block it lives in, so the run demonstrated the *verifier*
catching the problem rather than the build. The verifier is the guard that
ships.

#### Debian's packaging actively fights the reconcilers

Recorded here because it is the kind of interaction that looks like nothing in
review and costs a day on hardware, and because the fix is **masking, not
disabling**:

- `wpasupplicant` ships an **enabled** `wpa_supplicant.service` with **no
  condition gating it**, so it *does* start. Worse, its
  `RuntimeDirectory=wpa_supplicant` makes systemd **delete `/run/wpa_supplicant`
  when it stops**, taking the control socket of the templated instance mosd
  started with it.
- `hostapd` likewise ships an enabled `hostapd.service`, inert today *only*
  because its `ConditionFileNotEmpty` is unsatisfied — one operator `cp` away
  from a second hostapd on the same radio while mosd's instance reports healthy.
- All three units, plus the D-Bus alias `dbus-fi.w1.wpa_supplicant1.service`, are
  **masked rather than disabled**, because `wpasupplicant` ships a D-Bus
  activation file that a plain `disable` leaves open.

The reconciler-facing detail — `network.rs` deletes every `*-mos-*.network` it
did not render, so reconciler-rendered units must use prefixes outside that
pattern — is in `docs/design/connd.md` §6. It bit an L3 during this campaign.

#### The loader partition, and its consequence for already-flashed boards

`systemd-repart` discards every region no GPT partition entry covers, on the
first boot, while growing the last partition. The Rockchip idbloader at raw
LBA 64 was outside every partition, so the first-boot growth run TRIMmed it away:
the device booted once and came up in maskrom on the next power-on. Reproduced on
a real image on a loop device — LBA 64 went from `524b4e53` (`RKNS`) to
`00000000`.

**This generalises to any SoC that boots from a raw offset**, not just Rockchip.
The fix is structural rather than a `--discard=no` flag: the loader area is now a
real GPT partition, first-boot TRIM stays enabled, and protection comes from the
entry existing. The geometry was revised **before any fielded flash**, which is
the only reason it was cheap.

Two defects interacted and must not be separated: while the repart definitions
were broken they *masked* the loader-wipe hazard on v2, because repart aborted
before reaching the discard. **Fixing the definitions on a layout without the
loader partition would have un-masked a bootloader wipe.** The two changes travel
together or not at all; a note to that effect is in both `.conf` files.

**Consequence: a board already flashed with an earlier image has had its loader
discarded and must be re-flashed in maskrom.** Writing a new image over eMMC from
the running system does not recover it. This is recorded next to the bring-up
steps in `docs/design/uboot-ab-handshake.md` §8.0.

#### What remains the user's hardware acceptance

Not claimed, not testable in this repository. Nothing in M5 has been near a
radio, a real boot or a real flash:

- **SSH gating on real hardware** — that `access.ssh.enabled` opens and closes a
  reachable sshd, and that the per-device password actually logs in through PAM.
- **AP mode on a real radio** — that hostapd beacons, that a client associates,
  and that networkd's DHCP server hands out a usable address. Whether the AP6275S
  vendor driver supports AP mode at all is the known hardware risk (PLAN-008
  Risks) and only a radio can settle it.
- **Station mode on a real radio** — association and a DHCP lease.
- **First-boot behaviour on a device** — that an unboxed board with no network
  seeds itself, mints its secrets on real flash, and comes up named and
  credentialled.
- **The A/B switch and rollback**, carried forward unchanged from M4.
- **That `Reboot`/`PowerOff` actually power the appliance.**
- **That first-boot growth grows `/srv` on real eMMC**, and that the loader
  survives it there. Both are proven on a loop device with a real
  `systemd-repart`; neither is proven on the board.

#### Recorded follow-ups (not implemented)

- **No credential-rotation path.** Nothing can change a device password or an AP
  PSK after first boot. A STATE wipe is the only way to get new ones. This is a
  gap, not a design position, and is the first thing a later phase should close.
- **A STATE directory added after devices exist will not be seeded.**
  `mos-seed-state` is gated by `ConditionPathExists=!/mnt/state/.mos-state-seeded`,
  so on an already-seeded device the whole oneshot is skipped and a newly added
  bind mount has no source. Pre-existing shape, harmless today because nothing is
  field-seeded — but **any future image that adds a STATE directory needs a
  seed-generation bump**. See `docs/design/ro-root.md` §4.
- **Rebooting a PENDING_CONFIRM slot burns a boot attempt**, and the power pane
  has no update-state awareness and does not warn.
- **No auto-reboot after `rauc install`** — a decision, not a gap. The user
  decides when the appliance goes down.
- **Automatic STA/AP arbitration is not implemented.** `holdDownSeconds` and
  `graceSeconds` are in the schema and deliberately consumed by nothing;
  `mode: provisioning` currently behaves exactly like `always`.
- **WPA3-SAE is not expressible** in the settings schema, on either the station
  or the AP side. A schema change, not a renderer change.
- **Station passphrase length is unvalidated.** wpa_supplicant requires 8–63
  characters and rejects the *entire file* on a shorter one, taking every network
  down. Validation belongs in `mosd-settings`.
- **`write_atomically` is duplicated across three reconcilers** (`sshd.rs`,
  `wifi_client.rs`, `wifi_ap.rs`); each task was forbidden to edit the others'
  files. Now that they have all landed, lifting it into a shared helper is worth
  doing.
- **`access.console.shellEnabled` has no consumer**, and neither META lockdown
  nor the brute-force counters nor the audit trail of access.md §5.2/§6 exist.
- **The `.zh.md` translations are stale.** `access.zh.md`, `provisioning.zh.md`
  and `mosd.zh.md` still describe the Talos/COSI mechanism and the pre-M5
  contracts. They were deliberately not touched; whoever owns translations owns
  refreshing them.

### M5 addendum - key-based SSH access (campaign `sshweb`, 2026-08-19)

- **Status**: implementation complete — RFCT-032 (settings schema v4 and the key
  parser), RFCT-033 (transient root password), RFCT-034 (sshd reconciler: keys,
  `AuthorizedKeysFile`, password gating), RFCT-035 (webd SSH pane), RFCT-036
  (image and verifier integration), RFCT-038 (`mos-shadow-reconcile`
  newline-safe append), RFCT-039 (`/home` on DATA and the `mos` account),
  RFCT-047 (reload, not restart), RFCT-048 (D-Bus policy), RFCT-053 (a key file
  per managed account), RFCT-054 (`/root` on DATA) and RFCT-037 (these docs).
  Done criteria met locally 2026-08-19. **Nothing in this campaign booted a
  device; every on-device behaviour below is the user's hardware acceptance and
  is not claimed here.**
- This supersedes M5's phase-1 credential model. M5 shipped a per-device
  password in `/etc/shadow`; this addendum replaces it with keys, and records
  the old model as superseded rather than deleting it (`access.md` §4.2).

#### What was delivered

- **Settings schema v4** — `access.ssh.authorizedKeys`, an array of tables with
  a canonical key text and an optional comment, validated by
  `mosd-settings::validate_authorized_keys` before anything is rendered.
  `MigrateV3ToV4` inserts the empty array; `down` discards the list, because a
  v3 device has no code that renders keys and would promise an access path it
  cannot serve.
- **SSH off, root passwordless, on BOTH profiles.** Neither profile seeds
  `access.ssh.enabled` true (`Profile::ssh_enabled_default` returns `false` for
  both), and neither image ships `ssh.service` statically enabled. Getting in
  requires an authenticated admin action through webd.
- **Persistent access by public key.** The sshd reconciler renders one
  authorized-keys file **per managed login account** — `root` and `mos` — into
  `/etc/ssh/authorized_keys.d/<account>`, 0600, and a static image drop-in
  (`05-mos-authorized-keys.conf`) points sshd at
  `AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u`. Numbered 05 so it sorts
  before mosd's `10-mos.conf`, which sshd's first-value-wins rule then makes
  unoverridable.
- **Every authorized key is a root key**, and both webd and `access.md` say so.
  One shared list per account means a key added for a colleague grants root.
- **A transient root password**, set through webd, hashed with bcrypt into the
  STATE-backed shadow file together with a marker recording that hash.
  `mos-shadow-reconcile` compares on every boot and, when root's hash still
  equals the marker, rewrites the field to a locked marker and deletes the
  record. A dev image's `ROOT_PASSWORD` hash never matches a marker and
  therefore survives — which is why the design uses a marker rather than
  "lock root on every boot".
- **Password authentication is gated on the transient password actually being
  active**, so a device that has never had one set never offers a prompt that
  cannot be satisfied.
- **`/home` and `/root` on DATA** — two bind mounts from `/srv/home` and
  `/srv/root`, sourced by `mos-seed-home` and `mos-seed-root` and ordered
  `Before=` their mounts, plus the `mos` account that owns `/home/mos`. Eight
  binds now ship in total.
- **`com.mos.mosd` is root-only on the system bus**, with a live-bus test that
  proves it, and the default context carries an explicit **deny** rather than a
  removed allow — the standard `system.conf` stanza allows
  `receive_type="signal"`, so removing the allow alone would have left
  `SettingsChanged`, which carries settings values, deliverable to every uid.
- **Documentation caught up with the code** (RFCT-037): `access.md` rewritten to
  the shipped model with per-section implementation-status markers, a recovery
  section, the model-A persistence rules with a survives-what table, and two
  Venus OS divergences; `mosd.md`, `provisioning.md` and `ro-root.md` corrected
  where they contradicted the code.

#### Two design sections that describe controls which do not exist

Recorded here as plainly as M4 recorded `CONFIG_SQUASHFS_XATTR`:

- **The META lockdown** (`access.md` §5.2). `grep -i lockdown` across every
  `.rs`, `.sh` and `.conf` returns nothing outside `docs/`. No one-way bit, no
  daemon that reads one, no reset that preserves one.
- **Factory reset.** Nothing performs one. The only mention in code is a doc
  comment in `mosd/mosd/src/provisioning.rs`. So the reset that "deliberately
  does not clear" the lockdown is a reset nobody can invoke, preserving a bit
  nobody can set.

Neither was implemented in this campaign. Whether the lockdown is built at all
is a product decision for the user. The class matters: **dead code has a
compiler, a test run and a grep-for-callers that can surface it; a security
control that exists only as prose has no mechanism that will ever notice it is
absent.**

#### Verification (2026-08-19, done criteria met locally)

- `bash mosd/hack/check.sh` — `ALL CHECKS PASSED`, `305 tests run: 305 passed,
  0 skipped`.
- `bash docs/verify-index.sh` — `130/130 PASS`.
- `make os-shadow-test`, `make os-dbus-policy-test`, `make os-health-test`,
  `make os-repart-test` and both image builds with both profiles and both
  verifiers were run green by the tasks that changed image content
  (RFCT-036, RFCT-039, RFCT-048, RFCT-054); RFCT-037 changed no image content
  and did not re-run them.

#### What remains the user's hardware acceptance

Not claimed, not testable in this repository. **Nothing in this campaign booted
a device**, so all of the following are claimed by nobody:

- **SSH reachable with a webd-set password** — that enabling SSH and setting a
  transient password actually produces a login through PAM.
- **A key login surviving a reboot** — that a key added through webd still logs
  in after a power cycle.
- **A password NOT surviving a reboot** — that `mos-shadow-reconcile` really
  clears the transient password on real hardware, and that a dev image's
  `ROOT_PASSWORD` really survives it.
- **`/home` and `/root` persisting** across both a reboot and an A/B update.
- **The D-Bus policy being enforced by a real system bus** — the policy test
  runs against a bus this repository starts, not against the appliance's.
- Everything M5 already listed: AP and station mode on a real radio, first boot
  on real flash, the A/B switch and rollback, `Reboot`/`PowerOff`, and DATA
  growth on real eMMC.

#### Recorded follow-ups (not implemented)

- **`mos-seed-home` and `mos-seed-root` have no test.** They are the two
  executables in the image nothing drives, unlike `mos-shadow-reconcile`
  (`os/shadow-reconcile-test.sh`). One `os/seed-test.sh` closes both.
- **Only `access.md` carries implementation-status markers.** Every other design
  document still lacks them: `provisioning.md`, `ro-root.md`, `mosd.md`,
  `connd.md`, `boards.md`, `display.md`, `remote-management.md`, `dashboard.md`,
  `uboot-ab-handshake.md`.
- **RFCT-038**: a shadow file containing CRLF, a NUL byte or an incomplete UTF-8
  sequence is untested; CRLF would leave a stray `\r` at the end of a field,
  which that fix neither creates nor repairs.
- **RFCT-035**: the 72-byte transient-password cap is documented reasoning, not
  a measurement (no test shows bcrypt ignoring the 73rd byte); "never logged" is
  asserted by construction rather than by capturing tracing output; the key-list
  read-modify-write is not atomic, which is a property of `SetSettings` rather
  than of the pane.
- **RFCT-048**: per-method allowlisting is deferred and should land in the
  **same change** that adds a `<policy user="apid">` block, not before. (That
  daemon was called `webd` when RFCT-048 wrote this; renamed by campaign `apid`,
  RFCT-055/RFCT-056.)
- **RFCT-048** also left one reopening path unasserted until RFCT-039 closed it:
  a second policy file for the same bus name.
- **The device credential is now inert.** `access.device.passwordHash` and the
  plaintext on STATE are still minted at first boot and verified by nothing
  (`provisioning.md` §3.6). Either wire them to a purpose or remove them and
  their migration.
- **The `.zh.md` translations are further behind than they were.**
  `access.zh.md`, `provisioning.zh.md` and `mosd.zh.md` now describe two
  superseded models rather than one. Untouched deliberately; whoever owns
  translations owns refreshing them.

### M6 - workload layer: balena-engine

**Decision (2026-08-17, user): the container engine is balena-engine**
(balena-os/balena-engine, Apache-2.0 Moby fork), not containerd/docker.
Rationale — it is engineered for exactly our field constraints:

- **container deltas** (10-70x bandwidth reduction) — the app-layer answer to
  PLAN-006's delta story;
- **atomic, durable image pulls** — power-cut-safe by design (same invariant
  class as our A/B updates);
- single static binary, ~3.5x smaller than docker, conservative RAM/storage;
- Docker-API compatible: compose-based app delivery works unchanged, and mosd
  drives it from Rust via the mature `bollard` client crate.

Scope: balena-engine as a systemd unit with its data-root pinned to exactly
**`/srv/balena-engine`** (user decision); app delivery = compose bundle managed
by mosd, versioned as the Uptane secondary ECU per PLAN-006 Part I. The
data-root is on DATA, not on EPHEMERAL: under the layout-v2 storage tiers
`/var` is a fixed-size, disposable partition and container layers are
application data that must survive a log cleanup and grow with the disk. No
engine bits are implemented in M4. Integration notes: engine tracks Moby with version
lag (acceptable for an appliance); balena's delta *generation* is server-side
infra — phase 1 uses plain pulls, delta serving evaluated with the fleet
phase (openBalena delta service vs registry-native alternatives).

## Out of scope / retired

- talos repo: reference-only, archived at its final commit; no further fixes.
- PLAN-009's Talos image pipeline (hack/cx3576 in the talos repo): superseded
  by the M1 pipeline in the mos repo.

## Risks

- Debian base pulls in more userland than Talos's rootfs did — counter with a
  strict package allowlist and image-size budget in M1 acceptance.
- mosd is new code on the critical path — mitigated by scope (reconciler over
  systemd, not PID 1), pma-rust quality gates, and keeping apid/RAUC
  independent of mosd internals (narrow API only).
- systemd version vs old kernels: pin a systemd version compatible with the
  oldest supported kernel tier (boards.md §6 revisit: floors relax under
  systemd — update that section in M1).
