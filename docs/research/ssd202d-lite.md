# Research: a lightweight mos for SigmaStar SSD202D — feasibility draft

> **Status and intent.** This is a draft, not a design record and not an
> approved plan. Nothing here is implemented, no branch exists, and no task or
> plan record has been opened. It exists to be argued with: it states what a
> mos-derived system on SSD202D would have to give up, what it can keep, and
> which hardware facts decide it.
>
> **Measurement basis.** Every size in sections 2 and 3 was read off the
> current tree at `5d0dca57` from the `_out/s905x5m-current` and `_out/boards`
> build outputs — the smallest of the four shipped boards, chosen so the
> numbers argue against this document rather than for it. Following this
> repository's documentation discipline, files are named and lines are not
> cited.
>
> **Hardware basis.** None. Section 1 lists the SSD202D facts this document
> assumes; not one of them has been confirmed against a datasheet, the
> SigmaStar SDK, or a board. Everything after section 1 is only as sound as
> section 1.
>
> **Read section 3 first.** The flash part is not a parameter of this design,
> it is the fork that selects which design applies.

## 1. Unverified premises

| # | Premise | Assumed | If false |
|---|---|---|---|
| 1.1 | Core | Dual Cortex-A7, **ARMv7 32-bit** | mos has no 32-bit target; `MOS_ARCH` is `amd64`/`arm64` only |
| 1.2 | DRAM | **128 MB in-package**, minus an MMA/VPU reservation | **At 128 MiB flash this is the decisive premise** — see §3.5 |
| 1.3 | Flash | 16 MiB SPI-NOR **or** 128 MiB SPI-NAND | **Selects the whole programme** — see §3 |
| 1.4 | SDK kernel | 4.9.84 (infinity2m) | Changes the backport in §6.2 |
| 1.5 | ROM download mode survives eFuse secure-boot lockdown, and accepts signed images | **At 16 MiB this is existential** — see §5.1. At 128 MiB it is routine maintenance. |

Which premise is decisive depends on 1.3, and only on 1.3:

| Flash | Decisive premise | Why |
|---|---|---|
| 16 MiB | **1.5** | The kernel cannot be A/B, so a failed kernel update has no rollback and the recovery contract is the only backstop. If the ROM download path closes under eFuse lockdown, there is no backstop. |
| 128 MiB | **1.2** | Flash stops binding. Whether Debian and systemd fit in the DRAM left after the MMA reservation becomes the question that decides whether §3's cheap programme is available at all. |

For the 16 MiB case, the three outcomes of 1.5 and what each forces:

| ROM download mode after eFuse lockdown | Consequence |
|---|---|
| Reachable, accepts only signed images | Recovery path is both usable and safe. §4 holds. |
| Closed entirely | No recovery. Kernel must be A/B; see §5.1 for the cost. |
| Reachable, accepts arbitrary images | Recovery works, but it is also a secure-boot bypass for anyone with physical access. Threat model must accept it explicitly. |

## 2. Why the shipped mos image is not a starting point

Measured, arm64, dev profile:

| Artifact | Size | Against 16 MiB |
|---|---|---|
| `root/rootfs.img` (squashfs + verity) | 76.6 MiB | 4.8× the whole flash |
| `kernel/support.img` (modules, firmware, regdb) | 14.2 MiB | 89% of the whole flash |
| `kernel/boot.itb` (signed FIT) | 63.7 MiB | 4.0× |
| ├ kernel `Image`, uncompressed in the FIT | 31.5 MiB (12.5 MiB gzipped) | |
| └ `initramfs.cpio`, uncompressed | 32.1 MiB | |
| One deployment (`.mosupd`) | 154.5 MiB | 9.7× |

The root is 260 MiB on disk before squashfs. Its three largest contributors are
`mos-podman` at 83.5 MiB — a third of the image — the five mos Rust binaries at
40.1 MiB combined, and the systemd stack (`systemd`, `udev`,
`libsystemd-shared`) at 30.9 MiB.

Two conclusions follow, and only the second is about Debian:

1. **`support.img` and the kernel alone are 26.7 MiB.** Both are BSP output.
   No change to the userspace distribution moves either. A 16 MiB target is
   therefore a kernel-configuration problem first and a rootfs problem second.
2. The Debian userland does not shrink to the 16 MiB class. `dpkg`,
   `perl-base`, full `coreutils`, `bash` and `passwd` are ~48 MiB installed
   that busybox replaces with about one. That argues for Buildroot — but
   Buildroot does not touch conclusion 1, and does not by itself put anything
   in 16 MiB.

It does **not** follow that Debian is unusable on this chip. Section 3 measures
where the line actually falls.

## 3. The fork: 16 MiB or 128 MiB

### 3.1 The threshold is whether Debian and systemd survive

Derived from the same size report, using two factors observed in it: dpkg
declares 365.3 MiB of installed size for a tree that measures 260 MiB on disk
(**0.712** — hardlinks, dedup, documentation stripping), and that tree packs to
76.6 MiB of squashfs (**3.39×**).

Removing podman, the netfilter set that exists only for podman and netavark,
and the MQTT pair, while keeping Debian, systemd, mosd and apid:

| Composition | dpkg | on disk | squashfs |
|---|---|---|---|
| No podman / netfilter / MQTT | 245.1 MiB | 174.4 | **51.4 MiB** |
| + Rust `strip` and LTO (~50% off the 27.0 MiB of mosd/apid/deploy) | 231.6 MiB | 164.8 | **48.6 MiB** |
| + armv7 against arm64 (~12% smaller) | | | **~42.7 MiB** |

**A Debian armv7 read-only root carrying systemd, mosd and apid is roughly
43–50 MiB.** Two of those fit in 128 MiB. Not one tenth of one fits in 16 MiB.
That is the threshold, and nothing else in this document moves it.

### 3.2 What the fork actually costs

| | 16 MiB | 128 MiB |
|---|---|---|
| Userspace | Buildroot + musl + busybox | **Debian armhf unchanged** — the deb pool, the resolver and the APT composition all survive |
| Init | finit or s6; the reconciler layer rewritten | **systemd unchanged**; reconcilers as they are |
| mosd / apid / deploy | fused into one multi-call binary | three binaries as today |
| `ServiceManager` seam in mos mainline | mandatory, or the trees diverge permanently | not needed |
| Organisational form | a permanently divergent branch | **`boards/ssd202d/` plus a profile** |
| 179 pinned package descriptions, ~3,900 lines of deb-shaped build code, ~20 producers | discarded | retained |

The 16 MiB path builds a new operating system that borrows mos's contracts.
The 128 MiB path adds a board to mos. The difference is not eight times the
flash; it is an order of magnitude of engineering and the entire long-term
cost of maintaining two trees.

At 128 MiB the work reduces to four items: an armv7 target (`MOS_ARCH=armhf`
plus Rust `armv7-unknown-linux-gnueabihf`), `boards/ssd202d/`, an MTD/UBI
storage layout, and a profile that excludes podman and MQTT.

One thing to confirm rather than assume: armhf is a Debian trixie release
architecture, but its support horizon beyond trixie has been an open question
in Debian. For a product with a long field life that is worth establishing
before the pool is pinned, not after.

### 3.3 128 MiB is SPI-NAND, and that helps

128 MiB is 1 Gbit, the standard SPI-NAND size; NOR at that capacity is not a
sensible BOM. The consequences are mostly favourable:

- UBI becomes mandatory for bad-block management and wear levelling, but
  `ubiblock` exposes a static UBI volume as a read-only block device, and
  squashfs + dm-verity over `ubiblock` is a settled combination.
- UBI volume update is atomic, which is cleaner than A/B over raw NOR offsets.
- DATA runs UBIFS rather than JFFS2 on NOR.
- It is **closer** to mos's model, not further: past `ubiblock` there is a
  block device again, not a raw offset.

New work it brings: NAND ships with bad blocks and grows more, and UBI's
overhead is a few percent of capacity; and the IPL/SPL region must be readable
by the ROM with bad-block skipping, which is a SigmaStar bring-up detail.

If the part is 128 MiB eMMC rather than NAND, GPT applies directly and mos's
partition model transfers almost unchanged — but 128 MiB eMMC is unusual, so
NAND is the assumption here.

### 3.4 Layout at 128 MiB, and what it retires

| Option | Composition | DATA |
|---|---|---|
| A — mos's native three components | boot 1.5 + FIT 2×3 + support 2×8 + root 2×48 = 119.5 | **8.5 MiB** |
| B — modules built in, no support image | boot 1.5 + FIT 2×5 + root 2×48 = 107.5 | **20.5 MiB** |
| C — B with a trimmed root (no bluez/alsa, dropbear for OpenSSH) | boot 1.5 + FIT 2×5 + root 2×40 = 91.5 | **36.5 MiB** |

Option A's DATA is unusable, so **§6.4's built-in modules survive the move to
128 MiB**: dropping the support image buys 12 MiB here too.

A second FIT costs about 5 MiB, or **3.9% of the part**. Buying full kernel
rollback for 3.9% is not a close decision, and it retires most of the 16 MiB
design:

| Retired at 128 MiB | Was |
|---|---|
| One kernel, no kernel rollback | §4 |
| The per-slot signed `mos_rootfs_desc` and U-Boot's extra `rsa_verify()` | §6.3 |
| Offline reflash as the recovery contract | §4, §7.3 |
| **The untested-pair fallback hazard** | §7.2 — it cannot arise when the kernel is A/B |

The roothash returns to the signed FIT cmdline, which is the simplest form: one
signature authenticating kernel, dtb and roothash together.

### 3.5 What survives at 128 MiB

- **Premise 1.2 becomes the decisive one.** systemd, journald, udev, dbus,
  mosd and apid together are a rough 60–80 MiB resident. With a 32 MiB MMA
  reservation, 96 MiB remains and it is tight but plausible; with 64 MiB
  reserved, 64 MiB remains and it is probably not. Flash stops binding and
  DRAM starts.
- **Modules built in** (§6.4), for the budget reason above.
- **Streaming installation.** mos's native acquisition stages a whole
  deployment in DATA under `/mos/updates/{staging,downloads,verified}`. Here
  one deployment is FIT 5 + root 48 = **53 MiB**, against a DATA of 20–36 MiB.
  It does not fit. The install path must stream into the inactive slot and
  verify in place, with the kernel staged in RAM — §7.3's ordering is not a
  16 MiB expedient, it is a constraint at both capacities.

Sections 4 through 10 describe the **16 MiB programme**. Where a section also
governs the 128 MiB case, it says so.

## 4. The 16 MiB model

One kernel, two roots, and one kind of update that is allowed to be
irreversible.

| | Userspace update | Kernel update |
|---|---|---|
| Writes | inactive rootfs slot | kernel region **and** a rootfs slot |
| Rollback | yes — three trials, retained fallback | **no** |
| On failure | automatic fallback to the other slot | **offline reflash** |
| Frequency | routine | rare, staged rollout |

This is a deliberate departure from
[the deployment lifecycle](../design/updates.md), which publishes root-only,
kernel-only and combined updates over independently signed kernel/support/root
components. Here there are no independent components and no object reuse: a
kernel change is a whole-system change. The benefit is not simplicity for its
own sake — it is 2.5 MiB of a 16 MiB part, and the deletion of the hardest
block in `deployments.rs`, the one that decides which objects a retiring
deployment still shares with the incoming one.

At 128 MiB none of this applies; see §3.4.

### 4.1 What this costs that mos does not currently pay

- Every kernel update is a full-image download, because there is nothing to
  reuse. Differential transport can recover the bandwidth; it cannot recover
  the flash write, which is always a whole slot.
- After a kernel update and before the next userspace update, the device runs
  **single-slot with no fallback at all** (§7.2 invalidates the other slot).
  §7.4 proposes closing that window cheaply.
- A failed kernel update is a truck roll. This is only acceptable if kernel
  updates are canaried, never fleet-wide.

## 5. Flash layout, 16 MiB

| Region | Size | Notes |
|---|---|---|
| IPL | 64 KiB | mask-ROM loaded |
| IPL_CUST | 64 KiB | signed |
| U-Boot | 384 KiB | signed; carries the FIT and descriptor public keys |
| uenv A/B | 2 × 64 KiB | redundant boot records, CRC-checked |
| rootfs descriptor A/B | 2 × 4 KiB | signed; see §6.3 |
| FIT | 2,560 KiB | **single**: kernel + dtb, RSA-2048 |
| rootfs A | 5,120 KiB | squashfs-xz + verity hash tree |
| rootfs B | 5,120 KiB | |
| DATA | 2,936 KiB | UBIFS or JFFS2 |
| | **16,384 KiB** | |

A 5.0 MiB rootfs is the figure the rest of this section has to live inside.
The estimate for a minimum viable root is 4.0–4.5 MiB, leaving roughly 0.5 MiB
of margin, and it depends on one decision: **mosd, apid and the deploy agent
must be built as a single multi-call binary.** Three separate Rust binaries
each carry their own copy of std and the shared dependency graph; the five
binaries shipped today total 40.1 MiB installed for that reason. One binary
with subcommands, cross-compiled to armv7 against musl with `lto = "fat"`,
`opt-level = "z"`, `panic = "abort"` and `strip = true`, is estimated at
2.0–2.5 MiB in squashfs.

That estimate is the weakest number in this document and should be the first
thing P1 replaces with a measurement.

Two facts about the current tree bear on it: `pkgs/mosd/Cargo.toml` declares no
`[profile.release]`, and the deb producer runs a plain `cargo build --release`
with no strip step, so the shipped binaries carry their symbol tables — `mosd`
for x86_64 measures 8.93 MB and 6.77 MB after `strip`. None of that size
reduction requires this project; it is available to mos mainline today, and
§3.1 already counts it.

### 5.1 If premise 1.5 fails

The kernel returns to A/B. The second FIT costs 2,560 KiB, which comes out of
the two rootfs slots and DATA: rootfs falls to 4,096 KiB each and DATA to
2,432 KiB. A 4.0 MiB rootfs against a 4.0–4.5 MiB estimate is not a budget, it
is a coin flip, and 128 MiB SPI-NAND stops being a preference and becomes the
answer — which is §3's argument arriving by a second route.

## 6. Boot chain

```
IPL (mask ROM)
 └─ IPL_CUST                     signed; key hash in eFuse            [premise 1.5]
     └─ U-Boot                   signed; embeds FIT + descriptor public keys
         ├─ read redundant uenv records, select rootfs slot
         ├─ decrement and persist the trial count before loading
         ├─ verify the slot's rootfs descriptor, take its roothash
         └─ verify and boot the single FIT
             └─ bootargs = static + dm-mod.create=<verity table from descriptor>
                 └─ root=/dev/dm-0, squashfs, read-only
                     └─ single multi-call Rust binary under finit or s6
```

No initramfs, no support partition, no `/lib/modules`, no systemd.

At 128 MiB the last two lines change — systemd and three binaries return — and
§6.3 drops out, but §6.1, §6.2 and §6.4 hold at both capacities.

### 6.1 No initramfs

`dm-mod.create=` builds the verity mapping in the kernel and boots
`root=/dev/dm-0` directly. This removes the 32.1 MiB initramfs, the early
userspace ELF closure that `pkgs/mos-boot/initramfs.sh` assembles, and
`mos-init` itself. On a 128 MB part that is not an optimization, it is what
makes the boot path fit.

### 6.2 One kernel backport, not two

`dm-init.c` is Linux 5.1 and is one self-contained file. Backporting it to 4.9
is small.

The alternative — authenticating the roothash inside the kernel with
`DM_VERITY_VERIFY_ROOTHASH_SIG` — is Linux 5.4 and pulls in keyring and PKCS#7
plumbing. §6.3 makes it unnecessary at 16 MiB, and putting the roothash back in
the signed FIT cmdline makes it unnecessary at 128 MiB.

### 6.3 Where the roothash comes from — 16 MiB only

One kernel and two roots means one FIT cmdline and two roothashes, so the
roothash cannot be signed into the FIT. It travels in a separate per-slot
descriptor that U-Boot verifies before it constructs bootargs:

```c
struct mos_rootfs_desc {
    u32  magic, version;
    char id[65];          /* rootfs content ID */
    char roothash[65];
    u64  generation;      /* rollback floor */
    u32  data_blocks, hash_offset;
    u8   signature[256];  /* RSA-2048 over everything above */
};
```

`rsa_verify()` is already linked in by `CONFIG_FIT_SIGNATURE`, so this adds a
structure and a call, not a cryptographic implementation. The authentication
point stays where mos puts it: before Linux, in code the firmware already
authenticated.

At 128 MiB this whole mechanism is unnecessary: the kernel is A/B, each FIT
pairs with one root, and the roothash is signed into that FIT's cmdline.

### 6.4 Modules must be built in

Not a recommendation, and not specific to 16 MiB. In the single-kernel model
the rootfs and the kernel are no longer version-locked to each other — §7.2
exists precisely because a fallback can pair a new kernel with an older root —
so a rootfs carrying `/lib/modules/<release>` is a fault waiting for that
pairing. At 128 MiB the version-locking returns, but dropping the support image
still buys 12 MiB (§3.4), and building the driver set in also deletes kmod,
modprobe and depmod from either budget.

## 7. Hazards

### 7.1 The key set is frozen at the factory

Both public keys live in U-Boot's control DTB, and U-Boot is only rewritten
through the maintenance path. A single burned key means the signing key for
this product line can never be rotated without recalling every unit.

**Provision 2–3 keys as an overlap set before the first unit ships.** mos
already holds this shape for metadata anchors in
[the security lifecycle](../design/security-lifecycle.md), where the publisher
refuses to remove an anchor while a published artifact still depends on it.
This cannot be added later, and it applies at both capacities.

### 7.2 The fallback that boots an untested pair — 16 MiB only

The failure the single-kernel model invites, in order:

1. Running kernel K1 with rootfs A, both v1.
2. Kernel update writes K2 over the single kernel region and v2 into rootfs B.
   K1 no longer exists anywhere.
3. rootfs B fails health confirmation three times.
4. The A/B machinery does its job and falls back to rootfs A.
5. The device is now running **K2 with a v1 root built for K1** — a pair that
   was never built, never tested and never published.

It may well work; Linux userspace is usually forward-compatible. That is not
the point. The point is that nobody knows, and it is discovered in the field.

**The kernel-update transaction must therefore invalidate the other slot in the
same durable write that activates the new one.** The record format needs no
change: `tries = 0` already means "not selectable" in
`boards/common/mos-records.h`. Omitting this step does not fail loudly — it
produces a device that silently boots a combination that was never tested.

At 128 MiB the hazard cannot arise: kernel and root are replaced as a pair and
both halves roll back together.

### 7.3 The brick window — 16 MiB only, but the ordering is universal

The single kernel region cannot stage itself. While it is being erased and
rewritten there is no bootable kernel. This is real, it cannot be removed, and
it can only be narrowed and isolated:

1. **Rootfs first.** Stream the new root into the inactive slot and verify it
   fully. This is the long write, and an interruption here is harmless.
2. **Kernel staged in RAM.** Download the FIT into tmpfs, verify signature and
   digest completely, and only then erase. Not in DATA: DATA is 2,936 KiB and
   the FIT is 2,560 KiB, so staging there would require DATA to be nearly empty
   at every kernel update, which is not a constraint that survives the field.
3. **Erase and write the kernel region.** This interval is the brick window.
4. **One durable record write** that activates the new slot and invalidates the
   other.

A power loss in step 3 is unrecoverable by design and goes to premise 1.5.
Steps 1, 2 and 4 are all recoverable. The window must be measured on the real
part, not estimated — NOR erase and program times decide how wide it is.

**Steps 1 and 2 survive at 128 MiB** for the capacity reason in §3.5: DATA is
20–36 MiB against a 53 MiB deployment, so streaming into the inactive slot is
the install path at both capacities. Only step 3's brick window is specific to
the single kernel.

### 7.4 Restoring dual-slot after a kernel update — 16 MiB only

After step 4 the device is single-slot with no fallback until the next
userspace update. Once the new kernel is confirmed healthy, copy the running
rootfs into the invalidated slot and mark it usable. Both slots then hold the
same version, so a rollback is only a reboot — but a corrupted slot is
survivable again. It is a flash-to-flash copy of one slot, done asynchronously
after confirmation, and its failure changes nothing.

## 8. Inheritance

What transfers from mos, and in what form. The 16 MiB column is the demanding
one; at 128 MiB most rows become "unchanged".

| Asset | Form it transfers in |
|---|---|
| `boards/common/mos-records.h` | Near-verbatim. Pure ANSI C over `stdio.h`/`string.h`, no U-Boot headers. At 16 MiB it drops `kernel[65]`: with no independent kernel component there is no second identity to bind. At 128 MiB the field stays. |
| `mos-file-boot.c` (cx3576) | Shape, 205 lines. Block reads become MTD or `ubiblock` reads; the FIT path lookup becomes a fixed offset or a UBI volume. Redundant-copy selection, CRC, trial decrement-before-load and refuse-on-persistence-failure all carry over. |
| `deployments.rs` | The transaction discipline — generation floor, failed-ID suppression, durable ordering. At 16 MiB object reuse is deleted, not ported; at 128 MiB it returns with the components. |
| `mosd-settings` model | Directly. |
| Reconciler config rendering | At 16 MiB only the `wpa_supplicant.conf`, `hostapd.conf` and `sshd_config` rendering transfers; unit rendering and service control do not. At 128 MiB the whole layer transfers. |
| Design contracts | [updates](../design/updates.md), [the boot handshake](../design/uboot-ab-handshake.md), [read-only root](../design/ro-root.md), [storage](../design/storage.md), [security lifecycle](../design/security-lifecycle.md) — inherited as specifications, then amended where §4 departs from them. |

Dropped at either capacity: podman and Quadlet, `mos-mqttd` and the broker, and
the React console. Dropped only at 16 MiB: systemd, journald, udev, OpenSSH,
and the Debian and APT build model — 179 pinned package descriptions, roughly
3,900 lines of deb-shaped build code, and about 20 producers.

The largest thing that does **not** transfer at 16 MiB is the reconciler
layer's relationship to systemd. Ten thousand lines under
`pkgs/mosd/mosd/src/reconciler/` are written against systemd units; the adapter
itself is concentrated in one file, but `network.rs`, `wifi_ap.rs`,
`wifi_client.rs` and `sshd.rs` each render unit files alongside the daemon
configuration that does transfer. Sharing that layer between mos and a 16 MiB
variant requires a `ServiceManager` seam in mos mainline. Without one, the two
diverge permanently on first commit. **At 128 MiB the seam is not needed at
all**, which is most of §3.2's argument.

## 9. Phases

Each phase ends in a check, not a status.

| Phase | Work | Verified by |
|---|---|---|
| **P0** | Answer §1: the flash part first, then eFuse and ROM download behaviour, DRAM left after the MMA reservation, whether the 4.9 SDK is mandatory, how many public keys to provision, and armhf's Debian support horizon | All answered in writing. 1.3 selects the programme; the rest gate what follows. |
| **P1** | Buildroot tree or Debian armhf pool, U-Boot, read-only squashfs + dm-verity root, unsigned | Board reaches a shell; `/` is read-only; the verity target reports a valid mapping; the real rootfs size replaces the §3.1 or §5 estimate |
| **P2** | `dm-init` backport, signed FIT, records, trial counting, and at 16 MiB the signed rootfs descriptor | Corrupt slot B deliberately: three failed attempts fall back to A, and the record is not replenished |
| **P3** | The management binary or binaries: settings tree, reconcilers, deploy agent, API; health confirmation | One full userspace A/B update with rollback; interrupt it at each step of §7.3 and recover |
| **P4** | Security: IPL_CUST signing, eFuse, anti-rollback, and at 16 MiB the offline reflash path | A lower-generation image is refused; at 16 MiB the offline path recovers a deliberately bricked unit |

At 16 MiB, P3 is also where §7.2 is proven: perform a kernel update, force the
new root to fail health, and assert the device does **not** boot the old root.

## 10. Open

Blocking, in order:

1. **Premise 1.3 — the flash part.** It is not a sizing detail; it selects
   between adding a board to mos and building a new operating system (§3.2).
   Nothing else should be committed to before it is answered, and if the answer
   is 128 MiB, whether it is SPI-NAND or eMMC follows immediately (§3.3).
2. **Premise 1.2 — DRAM left after the MMA reservation.** At 128 MiB this
   decides whether Debian and systemd are actually available, and therefore
   whether the cheap programme is real (§3.5).
3. **Premise 1.5 — ROM download mode after eFuse lockdown.** Existential at
   16 MiB, routine at 128 MiB.
4. **§7.1 — how many public keys to provision.** Not blocking the design;
   blocking the first production burn, permanently, at either capacity.

Not blocking, but worth settling before P1: whether mos mainline grows a
`ServiceManager` seam (§8). It is cheap now and expensive after both trees have
moved — and it is only needed if 1.3 answers 16 MiB.
