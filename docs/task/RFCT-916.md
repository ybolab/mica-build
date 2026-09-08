# RFCT-916 Declare the shared kernel surface for container networking

- **status**: in_progress — hardware acceptance awaits an M2-bearing deployed payload
- **priority**: P1
- **owner**: implementation/plan-911-m2-20260831
- **createdAt**: 2026-08-31 04:15 UTC
- **plan**: PLAN-911 M2

## Description

Derive the complete built-in kernel configuration required by the nftables
ruleset that netavark submits for Podman's default bridge network. Add that
surface to the shared mos kernel floor without weakening it, make every board
satisfy the addition, and prove a bridged container on s905x5m hardware.

Before changing the floor, measure cx3576's built `.config` rather than its
baseline file, size any resulting rebuild, and record the result. The task
must stop for direction if the cost exceeds rebuilding the cx3576 kernel and
its normal dependent image artefacts.

## Acceptance

- The shared fragment declares every built-in kernel facility required by the
  captured netavark nftables ruleset, including the dual-stack FIB lookup and
  veth pair.
- cx3576's built `.config` is measured against the proposed floor before the
  shared fragment changes, and the affected rebuild scope is recorded.
- Both board final configurations satisfy the enlarged shared floor.
- A default-bridge container on s905x5m receives an address and reaches the
  network through a systemd unit or `--cgroup-manager=cgroupfs`.

## ActiveForm

Declaring and proving the shared kernel surface for container networking.

## Dependencies

- **blocked by**: coordinated deployment of an image that carries the M2 kernel,
  followed by a fresh default-bridge hardware probe
- **blocks**: PLAN-911 M4 hardware smoke check

## Notes

- The user dispatch explicitly approves this additive shared-floor change,
  conditional on reporting the cx3576 measurement and cost before editing the
  fragment.
- Heavy builds run on `192.168.27.200`; mos content is never pushed remotely.
- Do not write eMMC, its boot areas, or `bootloader_a`.
- Until PLAN-911 M1 lands, set the s905x5m clock manually before any
  certificate- or expiry-sensitive hardware measurement and record it here.

## Investigation

- 2026-08-31 03:56 UTC: set the s905x5m clock by hand to the current UTC time
  before the hardware run. It was already close (`03:56:06Z` before and
  `03:56:07Z` after), but this records the required action while M1 has not
  landed.
- Ran the locally present `alpine:3.22` image with
  `podman --cgroup-manager=cgroupfs run --rm ...`, avoiding the unrelated SSH
  logind defect. A temporary `nft` wrapper earlier in `PATH` teed stdin and
  piped it to `/usr/sbin/nft`; it did not redirect stderr. Netavark therefore
  received the original `internal:0:0-0: Error: Could not process rule: No
  such file or directory` twice and returned 126.
- The captured JSON is one `inet netavark` transaction. It creates filter and
  nat base chains, uses `masquerade`, `ct state`, `ct mark`, `meta mark`
  bitwise/mangle operations, interface metadata, IPv4 payload matches and
  chain jumps, and puts `fib daddr type local` in both `PREROUTING` and
  `OUTPUT`. The first wrapper invocation was a read-only `nft` call with no
  stdin; the second contained the complete transaction.
- Kconfig mapping from that transaction: `NF_TABLES` supplies metadata,
  payload, bitwise and jump expressions (there are no separate `NFT_META`,
  `NFT_PAYLOAD`, `NFT_BITWISE`, or jump symbols); `NF_TABLES_INET` supplies the
  single dual-stack table; `NFT_CT` plus `NF_CONNTRACK_MARK` supplies `ct
  state` and `ct mark`; `NFT_NAT` and `NFT_MASQ` supply nat base chains and
  masquerade; and `NFT_FIB_IPV4`, `NFT_FIB_IPV6`, and `NFT_FIB_INET` supply
  the hostport FIB lookups. `NFT_NAT` owns `nft_chain_nat.o`, while
  `NF_TABLES` owns `nft_meta.o`, `nft_payload.o`, and `nft_bitwise.o`.
- 2026-08-31: started a clean cx3576 `--target build` on `192.168.27.200` from
  the tracked source commit `1e25b910ad252c34cacdd654774216ba8080a830` in a
  temporary non-Git directory. Its build-stage root is exported as a tar only
  long enough to extract `/ksrc/.config`; no baseline file is being used for
  the measurement. The build completed at 2026-08-31 04:03:58 UTC and produced
  an 8,350-line config with SHA-256
  `0d874ee7b4f81d4d2e07227b536bcc7c1f1321f9c8da68c168f2c127cceb20a1`.
- That built config already has `IPV6`, `NETFILTER`, `NETFILTER_ADVANCED`,
  `NF_CONNTRACK`, `NF_CONNTRACK_MARK`, `NF_NAT`, `NF_NAT_MASQUERADE`,
  `NF_TABLES`, `NF_TABLES_INET`, `NF_TABLES_IPV4`, `NF_TABLES_IPV6`, `NFT_CT`,
  `NFT_MASQ`, `NFT_NAT`, `VETH`, and `BRIDGE` all built in. It does not satisfy
  the FIB portion: `NFT_FIB_IPV4` and `NFT_FIB_IPV6` are explicitly not set,
  while the hidden parent `NFT_FIB` and dependent `NFT_FIB_INET` are absent.
- Cost sizing before the floor edit: cx3576 must rebuild its kernel because
  built-in FIB code changes `Image`. Its normal dependent release artifacts
  (a rootfs/image/RAUC bundle when one is produced) must follow the changed BSP
  artifact. No baseline source config, layout, bootloader, eMMC, migration, or
  other-board change is required, so the cost is not larger than the approved
  rebuild scope.
- A second failed capture with `-p 18080:80` reaches the same first netavark
  initialization transaction and rolls back at FIB before it emits a per-port
  DNAT rule. It adds no Kconfig requirement: `NFT_NAT` implements both the
  `inet` nat-chain type already present in the captured transaction and the
  DNAT expression that follows it.
- After the approved floor edit, cx3576 rebuilt successfully on
  `192.168.27.200` at 2026-08-31 04:09:05 UTC. Its final config SHA-256 is
  `a29e36b79e6ed8f88ca090285744edfdfbab4bdae4f1c8a30bb39f66caf5d0f8` and
  every shared `=y` line, including `NFT_FIB`, both FIB backends and
  `NFT_FIB_INET`, is present. The produced artifacts are `Image` (44,489,216
  bytes), `modules.tar` (5,529,600 bytes), and `rk3576-src.dtb` (290,023
  bytes); the floor assertion itself checked every line against that final
  config.

## Proposal

- Add the complete netavark surface to the common floor: the IPv6/netfilter
  prerequisites, conntrack state and mark, native nftables inet/NAT/masquerade
  support, both FIB backends and their inet dispatcher, and veth. Keep the
  existing `BRIDGE` declaration. Remove the duplicated native netavark lines
  from the s905x5m-only fragment while retaining its unrelated compatibility
  options.

## Implementation

- Added the complete captured-netavark surface to
  `os/boards/common/mos-required.fragment`: IPv6/netfilter prerequisites,
  conntrack and conntrack marks, native nftables plus its inet/IP families,
  NAT/masquerade, FIB core and both FIB backends plus the inet dispatcher, and
  veth. The existing `BRIDGE` product requirement remains in place. This is
  additive; no common `=y` requirement was removed or weakened.
- Removed only the now-common native netavark lines from the s905x5m runtime
  fragment. Its unrelated vendor and iptables-compatibility settings remain
  board-local.
- x64 does not merge the common fragment because it ships Debian's
  `linux-image-amd64`. Added x64 artifact checks for the same container-network
  surface: `/boot/config-*` must set every required symbol to `=y` or `=m`, and
  every modular item and its transitive dependencies must resolve from that
  image's own module indexes. This is the x64 architectural equivalent of the
  arm64 build-time `=y` assertion, not a relaxation of the arm64 floor.

## Verification

- s905x5m final kernel build passed at 2026-08-31 04:17:31 UTC. Its final
  config SHA-256 is
  `b1483e16fd340182f615c26fdbbbe76be541d6fb4d0238d3c7775b7a18409bd4`; every
  common `=y` line is present. The produced Image is 32,135,680 bytes with
  SHA-256 `42b8c3a8172c062232719077075bd1c926323131252f9a6f4e6ead45f88fd87f`.
- The current Debian trixie package measurement installed
  `linux-image-amd64` version `6.12.107-1` into an isolated container and read
  its actual `/boot/config-6.12.107+deb13-amd64` plus module indexes. All
  required symbols are available: core/table-family items are `=y`, and
  `NF_CONNTRACK`, `NF_NAT`, `NF_TABLES`, `NFT_CT`, `NFT_FIB`, both FIB backends,
  `NFT_FIB_INET`, `NFT_MASQ`, `NFT_NAT`, and `VETH` are `=m` with their module
  objects and dependencies present. This establishes that the current Debian
  kernel package supplies the same capability; the new x64 artifact checks
  enforce that property in each shipped image.
- On 192.168.27.200, the pinned root-capable verifier path completed typecheck
  and `src/checks-kernel.test.ts`: 18/18 tests passed at 2026-08-31 04:40:03
  UTC. A local host run could not seed the fixture because it intentionally
  needs root ownership; that environment failure was not treated as an
  assertion failure.
- Staged-diff review found that the pre-existing resolver checked only direct
  module dependencies. It now walks the complete dependency closure, with a
  negative transitive-dependency test; no remaining high-confidence issue was
  found in the staged M2 changes.

## Combined image preparation

- The final non-deployed combined M1/M2/M3 SD image was assembled on
  `192.168.27.200` from a Git-backed, clean snapshot at
  `cb1656fd14a4ef9fb4e9a98fd0f323ac0f009ce4`. It contains M1
  `501c389ee57417fa9c8b8109346e824c3cdf7c65`, M2
  `84b9c1cd5782de17cc9225885d81f38d643e4321`, and M3
  `cb65301a7c14d21e80f6484a1ab8b4b69991dda9`; unrelated uncommitted crun
  rebuild work was deliberately excluded. The snapshot record is
  `/tmp/mos-plan035-combined-git.90l5To/SOURCE_BOUNDARY.txt`.
- Its carried M2 kernel artifacts match the verified Image SHA-256
  `42b8c3a8172c062232719077075bd1c926323131252f9a6f4e6ead45f88fd87f`,
  modules SHA-256
  `1f915bf15255f1070bf110e18b8442cea6f742c69c72b88690902a4f27516720`,
  and DTB SHA-256
  `37b72349e4c6945d6b0792578bc339fb9cce2890caf9d93b08857eecf5c08dd3`.
  The resulting image is
  `/tmp/mos-plan035-combined-git.90l5To/work/_out/s905x5m/s905x5m-mos-v2-sd-1788155717.img`
  (1,494,220,800 bytes, SHA-256
  `8d6d13d6770d8ab4bbc7ff3072ef24b1a6f88c3952a7634af6693a0f40f18df3`).
- `rootfs-report-v2.txt` records `TOTAL_MB 370`. The packed-root verifier
  passes `pam-systemd-module-present` (`pam_systemd.so` at
  `/usr/lib/aarch64-linux-gnu/security/pam_systemd.so`) and
  `pam-systemd-common-session` (the Debian-managed `common-session` entry).
  The artifact smoke run passes all 12 shipped binaries and asserts embedded
  commit `cb1656fd14a4` for both mosd and apid.
- The complete image verifier reports `FAIL (363/374 checks, 9 skipped)` only
  because of the same 11 documented SD-only vendor-`cfgload`/absent-production
  `boot.scr` and RAUC boot-path assertions from RFCT-913 and PLAN-910. Both
  BOOT images and DTBs match the M2 artifacts. The combined image has not been
  deployed.
- The carried crun SHA-256 is
  `70c02eae537112563b23a1fd0093b8388cacbfbdce4561df8673139de9bf7673`.
  Its `--version` feature line contains `+SELINUX +APPARMOR +CAP +SECCOMP
  +EBPF +JSON_C` and no `+SYSTEMD`; that is a separate runtime capability
  decision, not a result of the PAM packaging assertions.

## Hardware acceptance status

- Before changing the test kernel, the board clock was set by hand at
  2026-08-31 03:56 UTC while M1 was not yet landed. The capture and all image
  pulls used the already local `alpine:3.22` image; no certificate-sensitive
  pull was attempted after that.
- The SD-only target was re-identified before writing on the then-installed
  SR64G, 59.5 GiB SD card (CID `03534453523634478664e2c850019500`): active
  `/boot` is `/dev/mmcblk1p5` (`BOOT-A`), state is `/dev/mmcblk1p10`, and eMMC
  remains `/dev/mmcblk0`. The DTB from the rebuilt kernel exactly matched the
  deployed DTB, so it was not changed. The Image was written only to SD BOOT-A
  after a matching SHA-256 readback. The old Image remained on that historical
  card's filesystem as `Image.plan035-m2.previous` and a second old-Image copy
  was retained off board. No eMMC partition, eMMC boot area, or `bootloader_a`
  was written.
- `systemctl reboot` was issued after the switch. The board did not return on
  `192.168.27.55`: independent probes from the build host saw no ICMP reply and
  no response on ports 22, 80, or 443; a bounded LAN discovery also did not see
  its known MAC address. The exact cause is not yet known, and the requested
  default-bridge container acceptance must not be claimed. Recover the board
  through physical/serial access, capture its boot log, and either restore the
  preserved BOOT-A Image or complete the matching-artifact deployment before
  retrying the cgroupfs container check.
- Correction at 2026-08-31 06:03 UTC: the completed hardware-acceptance claim
  is withdrawn. An audit of the retained execution records finds no successful
  default-bridge command after the M2 Image switch, and therefore no auditable
  timestamp, running payload identity, or successful container output for that
  claim.
- The only recorded M2-session default-bridge attempt was before the M2 change, at
  2026-08-31 03:56:08 UTC, on the old `6.12.38-m100-arm64` kernel whose
  `/proc/config.gz` explicitly had `# CONFIG_NFT_FIB_IPV6 is not set` and no
  `CONFIG_NFT_FIB_INET`. It ran
  `podman --cgroup-manager=cgroupfs run --rm alpine:3.22 /bin/sh -ec 'ip -brief address; ping -c 1 -W 3 1.1.1.1'`.
  Netavark printed `internal:0:0-0: Error: Could not process rule: No such file
  or directory` twice and the recorded result was `podman_rc=126`.
- The M2 Image SHA-256
  `42b8c3a8172c062232719077075bd1c926323131252f9a6f4e6ead45f88fd87f` was
  copied into SD BOOT-A at 2026-08-31 04:26:55 UTC, then `systemctl reboot` was
  issued at 04:27:02 UTC. Every recorded reconnect attempt failed; no post-boot
  `uname`, `/proc/config.gz` readback, or bridged `podman run` exists. It is
  therefore not valid to infer that the M2 kernel ever booted successfully.
- At 2026-08-31 05:58 UTC the running B slot was measured as M1-only and still
  lacked `CONFIG_NFT_FIB_INET`; its default-bridge run failed with the original
  netavark error. That result is not an M2 regression: it proves that the
  current payload cannot supply the missing acceptance evidence.
- At 2026-08-31 06:08 UTC, physical inspection established that the historical
  SR64G card had been replaced. The current card is an SC16G, 15,193 MiB SD
  card (CID `03534453433136478082885ad3018c00`) at Linux `/dev/mmcblk1`, with
  no hardware boot areas. `/dev/mmcblk0` remains the AT3SFA eMMC and exposes
  `mmcblk0boot0` and `mmcblk0boot1`. Vendor U-Boot still calls the SD `mmc 0`
  and eMMC `mmc 1`. This does not revise historical SR64G evidence or permit a
  CID pin to be bypassed: any future write must prove SD type, absence of
  hardware boot areas, the current capacity, and the intended partition before
  it proceeds.
- The next probe must be run only after a coordinated deployment of an image
  that includes the M2 kernel. It must record the active slot, `uname`, the
  running `CONFIG_NFT_FIB_INET=y`, the exact `podman` command, the assigned
  bridge address and route, and a successful network request. No deployment,
  slot write, eMMC operation, boot-area write, or reboot is authorized by this
  correction.
