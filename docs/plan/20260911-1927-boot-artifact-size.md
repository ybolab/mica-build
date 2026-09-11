# 20260911-1927-boot-artifact-size Shrink the signed boot artifact: compression and early-userspace closure

- **status**: draft
- **createdAt**: 2026-09-11 19:27
- **revisedAt**: 2026-09-11 20:10
- **approvedAt**: (pending)
- **relatedTask**: [20260911-1925-boot-artifact-size](../task/20260911-1925-boot-artifact-size.md)

## Context

The initramfs is embedded uncompressed in every signed kernel component
(`pkgs/mos-boot/fit.sh`, `compression = "none"` on all three FIT nodes):

| Board | FIT bytes | initramfs bytes | Share |
|---|---|---|---|
| s905x5m | 66,765,710 | 33,615,872 | **50.3%** |
| cx3576 | 78,798,326 | 33,615,360 | **42.7%** |

That is flash per deployment on SYSTEM, bytes per kernel update download, and
bytes hashed at boot under the FIT signature. It is **not** boot-peak RAM: the
startup half is released at `switch_root`. The resident cost is the exitrd and
belongs to [20260910-0341-minimal-boot-shutdown](20260910-0341-minimal-boot-shutdown.md);
the two records do not overlap.

### Decisions taken before this revision

The user settled three questions on 2026-09-11; they are recorded here so the
plan is read as a decided route rather than a survey.

1. **Replace `veritysetup` and `dmsetup` with Rust directly** (Phase 2 below).
   The intermediate step of rebuilding cryptsetup against the kernel crypto
   backend is **not** taken — see *Alternatives*.
2. **Add `CONFIG_ZSTD` to cx3576's U-Boot**, so the kernel node can be
   compressed too rather than only the ramdisk (Phase 5).
3. **Remove cryptsetup from the early userspace entirely.** After Phase 2 the
   initramfs contains no cryptsetup binary and no cryptsetup library.

### Measured: the startup closure

Transitive `DT_NEEDED` walk over the built s905x5m ARM64 archive:

| Set | Files | Bytes | MiB |
|---|---|---|---|
| Current: `mos-init` + 6 tools | 26 | 16,149,328 | 15.40 |
| Libraries | — | 14,116,944 | 13.46 (86.3%) |
| Programs | — | 2,234,917 | 2.13 (13.7%) |

`mos-init` itself needs only `libc.so.6` and `libgcc_s.so.1`. Every other
library belongs to the five util-linux/cryptsetup helpers it `exec`s. **Static
linking `mos-init` alone saves nothing** while any dynamically linked C program
remains in the archive, because `libc` and the loader stay for those.

The cost is concentrated in one helper. `veritysetup` is 73,672 bytes and
exclusively pulls 8,567,640 bytes:

| File | Bytes |
|---|---|
| `libcrypto.so.3` | 6,302,952 |
| `libzstd.so.1` (via `libcrypto`) | 723,048 |
| `libcryptsetup.so.12` | 603,376 |
| `libblkid.so.1` | 461,856 |
| `libz.so.1` (via `libcrypto`) | 133,600 |
| `libjson-c.so.5` | 133,368 |
| `veritysetup` | 73,672 |
| `libpopt.so.0` | 68,032 |
| `libuuid.so.1` | 67,736 |

Measured endpoints of the phases below:

| After | Files | Bytes |
|---|---|---|
| Today | 26 | 16,149,328 |
| Phase 2 (no veritysetup, no dmsetup) | 13 | **6,319,808** |
| Phase 3 (no util-linux helpers) | 4 | **3,413,472** |
| Phase 4 (static) | **1** | to be measured |

### Measured: decompressor support

| Consumer | cx3576 | s905x5m | x64 | virt-arm64 |
|---|---|---|---|---|
| Kernel `CONFIG_RD_ZSTD` (unpacks the cpio) | y | y | y | y |
| U-Boot `CONFIG_ZSTD` (decompresses FIT nodes) | **absent** (`LZ4`, `GZIP` only) | y | n/a (UKI) | n/a (UKI) |

Read from the resolved configs under `_out/boards/*/`, not the committed
fragments, because `configure.sh` changes symbols before `olddefconfig`.

**The kernel side is already enabled on every board.** The only missing symbol
is cx3576's U-Boot, and Phase 5 adds it.

### Measured: compression ratios

`zstd` is not installed on the analysis host, so `gzip -9` is recorded as a
measured **floor**; zstd on ELF-dominated input normally does better and must be
measured before any claim is made.

| Object | Original | `gzip -9` | Ratio | Saves |
|---|---|---|---|---|
| `initramfs.cpio` | 33,615,872 | 13,806,185 | 2.43× | 19,809,687 (58.9%) |
| Kernel `Image` (s905x5m) | 33,065,472 | 13,111,167 | 2.52× | 19,954,305 |

The device tree is 82,203 bytes; compressing the `fdt` node is not worth a
change and is excluded.

### Where veritysetup is used

Two places, and only one ships:

- **Build time** — `veritysetup format` / `verify` in `build/src/component-build.ts`
  and `build/src/tools/veritysetup.ts`, inside build containers. Not on the
  device; out of scope, and **retained deliberately** because Phase 2's
  differential test needs it as the reference implementation.
- **The initramfs** — the copy `mos-init` invokes. This is what Phase 2 removes.

The shipped image carries neither `cryptsetup` nor `dmsetup` (absent from
`_out/cx3576/release/package-manifest.tsv`, 187 packages). So the device holds
exactly one copy and it is the one in the initramfs.

### Why the verity call is a translation, not a parse

`verity_args()` in `pkgs/mos-deploy/src/boot.rs` passes `--no-superblock` with
fully explicit geometry: format 1, sha256, 4096/4096 block sizes, data blocks,
hash offset, salt, root hash, root-hash signature, panic-on-corruption.
No-superblock means **there is no on-disk verity header to read**, which
`docs/design/ro-root.md` already states as the design. Every field of the kernel
table line

```
<version> <data_dev> <hash_dev> <data_bs> <hash_bs> <num_data_blocks>
<hash_start_block> <algo> <digest> <salt> [<#opt> <opt>...]
```

is already in hand; the only arithmetic is `hash_start_block = hash_offset /
hash_block_size`. `veritysetup`'s maturity lives in LUKS, superblock parsing and
algorithm breadth — none of which this path uses. That is what makes replacing
it a bounded job rather than a reimplementation of cryptsetup.

### Crates

| Crate | Version | Downloads | Licence | Nature |
|---|---|---|---|---|
| `devicemapper` | 0.34.8 | 903,898 | **MPL-2.0** | raw DM ioctls; README: "does not use libdm" |
| `devicemapper-sys` | 0.3.3 | 537,556 | **MPL-2.0** | `bindgen` + `pkg-config` as **build** deps only |
| `linux-keyutils` | 0.2.5 | 12,804,004 | Apache-2.0 OR MIT | `add_key(2)` |

`devicemapper::DM::table_load` takes `&[(u64, u64, String, String)]` —
`(sector_start, sector_length, type, params)` — so `"verity"` with an arbitrary
parameter string is expressible.

`pkgs/mos-deploy/deny.toml` currently allows only `Apache-2.0`, `MIT`, `ISC`,
`Unicode-3.0`, `Zlib`, and its comment states the list is deliberately minimal —
an allowance matching no real chain "reads as an approved risk rather than as
dead configuration". **Adding `MPL-2.0` is a review decision, not a formality**,
and it is the one approval gate Phase 2 carries.

Primary references:

- [dm-verity](https://docs.kernel.org/admin-guide/device-mapper/verity.html):
  table format and the `root_hash_sig_key_desc` optional parameter.
- [devicemapper-rs](https://github.com/stratis-storage/devicemapper-rs): wraps
  the devicemapper ioctls, does not use libdm.

## Proposal

Five phases. Phases 1 and 2 are independent and may run in parallel. Phase 3
depends on 2, Phase 4 depends on 3. Phase 5 is independent of all of them.

### Phase 1 — compress the ramdisk, no board change

Compress `initramfs.cpio` with zstd and leave the FIT ramdisk node at
`compression = "none"`. U-Boot then passes the blob through untouched and the
**kernel** decompresses it by magic, which every board already supports
(`CONFIG_RD_ZSTD=y` ×4). The same compressed cpio serves the UKI boards
unchanged, since the kernel unpacks it there too.

This phase is deliberately independent of Phase 5: it needs no U-Boot change, so
it can land before the cx3576 U-Boot work and on every board at once.

Decide and record what `pkgs/mos-boot/fit.sh`'s 64 MiB assertion
(`test "$(stat -c%s /output/initramfs.cpio)" -le 67108864`) should bound after
this change — the compressed bytes, the uncompressed bytes, or both. Leaving it
undecided silently weakens an existing bound.

### Phase 2 — replace veritysetup and dmsetup with Rust

Take `devicemapper` and `linux-keyutils` into `pkgs/mos-deploy`. In `mos-init`:
load the PKCS#7 signature with `add_key(2)`, build the verity table line from
the values `verity_args()` already computes, then `device_create` →
`table_load` → `device_suspend`. Read the table back with `table_status` in
place of the current `dmsetup table` shell-out.

Delete `veritysetup` and `dmsetup` from the initramfs closure
(`pkgs/mos-boot/initramfs.sh`) in the same change. Endpoint: 16,149,328 →
**6,319,808** bytes across 13 files, **9,829,520 saved (61%)**. After this phase
the early userspace contains no cryptsetup binary and no cryptsetup library.

Retire `verity_args()` or narrow it to the table-line builder; do not leave a
second argument-formatting path that nothing calls.

**Licence route: (a) — add `MPL-2.0` to `pkgs/mos-deploy/deny.toml` after
review.** File-level copyleft over unmodified upstream crates; the obligation is
source availability for those files, satisfied by the upstream reference. If
that review is declined, the recorded fallback is **(b)**: hand-write the four
ioctls (`DM_DEV_CREATE`, `DM_TABLE_LOAD`, `DM_DEV_SUSPEND`, `DM_TABLE_STATUS`)
against `dm-ioctl.h` — roughly one to two hundred lines — and keep
`linux-keyutils`, which is Apache-2.0 OR MIT and needs no allowance. Record
which route was taken and why. Do not ship both.

### Phase 3 — internalise the remaining helpers

Replace `/bin/mount`, `/sbin/losetup`, `/sbin/blkid` and `/sbin/switch_root`
with direct syscalls in `mos-init`: `mount(2)`; `LOOP_CTL_GET_FREE` +
`LOOP_SET_FD` + `LOOP_SET_STATUS64`; a PARTUUID lookup restricted to GPT; and
`MS_MOVE` + `chroot` + `exec` with the old-root removal. `rustix` is already a
dependency. Endpoint: 6,319,808 → 3,413,472 bytes across 4 files.

BusyBox was considered for this phase and rejected — see *Alternatives*.

### Phase 4 — static-link mos-init

With no dynamically linked C program left, link `mos-init` statically so the
startup half is one file. The mechanism (musl target, or glibc `+crt-static`) is
an implementation decision; record which and why. **This phase is worth nothing
before Phase 3** and must not be scheduled earlier.

### Phase 5 — U-Boot `CONFIG_ZSTD`, then compress the kernel node

Add `CONFIG_ZSTD` to cx3576's U-Boot and set the FIT kernel node to zstd.

`boards/cx3576/bsp/uboot/build.sh` configures over the upstream
`${BOARD}_defconfig` with a `scripts/config --enable ...` chain followed by
`make olddefconfig`, so the symbol goes into that chain. **Assert `CONFIG_ZSTD=y`
in the resolved `.config`** using the assertion helper already in that script
(the `grep -q "$1" .config` guard); an `--enable` line is a request, and
`olddefconfig` is what decides. s905x5m already has `CONFIG_ZSTD=y` and needs no
change. Not applicable to the UKI boards, whose kernel is the signed PE itself.

## Verification

No phase is complete until the archive and FIT bytes are re-measured against the
baselines in *Context*, and **no size claim is made before measurement** — the
`gzip -9` figures above are a floor, not a prediction.

### Phase 1

- Confirm the compressed cpio is detected and unpacked on all four boards,
  including the two UKI boards, from a cold boot.
- Measure real zstd output and record it; compare against the `gzip -9` floor.
- Verify the rebuilt `fit.sh` assertion fails on an oversized payload, under
  whichever quantity it was decided to bound.

### Phase 2 — the security-critical phase

This phase moves a signature-enforcement boundary from validated upstream code
into this repository. The failure mode to exclude is **not** a boot failure; it
is a mapping that looks correct but does not enforce the signature. Verification
is therefore differential, negative and mutation-based, in that order.

**Differential, before the switch.** `veritysetup` still exists in the build
containers. For the same inputs, produce the table line both ways — the current
`veritysetup open` path and the new Rust path — and require
`dmsetup table` / `table_status` output to match **exactly**. A golden test over
the built s905x5m and x64 images makes the translation claim checkable instead
of asserted. This test must exist and pass before `veritysetup` leaves the
initramfs.

**Keep and strengthen the existing read-back guard.** `verified_mount()` already
requires `root_hash_sig_key_desc` in the table and the mapping to be read-only
after creation. It tests kernel state rather than a tool's exit code, which is
what makes it survive the implementation swap. Keep both assertions and add a
third: the mapping's target type is `verity`.

**Negative cases, each required to refuse rather than degrade:**

- a tampered data block faults on read (the mapping exists and the read fails —
  this is the property `docs/design/ro-root.md` claims);
- a wrong root hash refuses the mapping;
- an absent signature file refuses, and does not create an unverified mapping;
- a corrupt signature refuses;
- a signature made by a key outside the kernel's trusted keyring refuses. This
  one is the whole point of `CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG` and cannot be
  inferred from the others passing.

**Mutation tests, each required to turn a green run red:**

- omit `root_hash_sig_key_desc` from the table line → the read-back guard fails;
- omit the read-only assertion and load a writable mapping → caught;
- skip the `add_key(2)` call → the kernel refuses the table load, and the
  refusal is reported rather than swallowed.

A guard whose removal changes no result is not binding the behaviour it names;
each mutation above must be shown to fail, not assumed to.

**Also:** run `cargo deny` for `pkgs/mos-deploy` and show it fails before the
`MPL-2.0` allowance and passes after — the allowance must be demonstrated to be
load-bearing rather than added speculatively.

### Phases 3 and 4

- Verify the PARTUUID lookup against a GPT disk and confirm it **refuses** a
  non-GPT table rather than guessing; the library it replaces handles more cases
  than mos needs.
- Verify `switch_root` equivalence: `/dev`, `/proc`, `/sys` and `/run` survive
  the transition, and the old root is actually removed rather than leaked.
- After Phase 4, assert the startup manifest lists exactly one regular file.

### Phase 5

- Assert `CONFIG_ZSTD=y` in the **resolved** cx3576 U-Boot `.config`, not the
  enable line.
- Phase 5 cannot be accepted without a cx3576 **cold boot** on the local board.
  QEMU and image inspection do not count as physical acceptance.

### Every phase touching the initramfs

- x64 and virtual ARM64 signed boot, signature and corruption refusal,
  deployment selection, component upgrades, three-trial fallback, normal
  shutdown and actual reboot.
- A newly signed CX3576 FIT/image: offline signature, layout and growth checks,
  then cold boot, apid reboot, poweroff and watchdog behaviour on the local
  board when it is available.
- The relevant Rust, packaging, shell and documentation gates.
- Record delivered bytes per phase in the related task.

## Risks

Phase 2 reimplements a security boundary, which is why its verification is
differential against the tool it replaces rather than self-referential. The
residual risk after the differential test is a case the golden inputs do not
cover; the negative and mutation lists above exist to bound that, and the
trusted-keyring case in particular cannot be reached by any positive test.

Phase 1 changes what the FIT signature covers (compressed bytes), which is
sound, but it also changes what the size assertion measures; leaving that
undecided would silently weaken a bound. Phase 5 touches a board whose console
and boot path are under concurrent repair, and a U-Boot that cannot decompress
what the FIT declares is an unbootable image rather than a degraded one — which
is why the resolved-config assertion is mandatory and why Phase 1 was kept
independent of it.

Compression saves flash, download and hashed bytes; it does **not** reduce boot
RAM, since the kernel still expands the archive. Do not let the two axes be
conflated when reporting results.

## Scope

`pkgs/mos-boot/` (FIT/UKI packaging, initramfs construction),
`pkgs/mos-deploy/` (`mos-init`, `verity_args`, `deny.toml`),
`boards/cx3576/bsp/uboot/build.sh`, and the relevant build and boot tests.
Record the delivered measurements in the related task.

Out of scope: the resident exitrd (owned by
[20260910-0341-minimal-boot-shutdown](20260910-0341-minimal-boot-shutdown.md)),
build-time `veritysetup` use in `build/` (retained as Phase 2's reference
implementation), board driver cleanup, main-system init replacement, partition
changes, compatibility layers and migrations.

## Alternatives

- **Rebuilding cryptsetup with `--with-crypto_backend=kernel` — declined
  2026-09-11.** It drops `libcrypto.so.3` and its `libz`/`libzstd` dependants
  (7,159,600 bytes) while keeping upstream's validated code, and was scheduled
  in the previous revision of this record as a low-risk early landing and as
  Phase 2's fallback. It was removed on the user's decision to remove cryptsetup
  from the early userspace outright. The reasoning that supports that decision:
  it saves 7,159,600 against Phase 2's 9,829,520; it leaves `dmsetup` in place;
  it requires a new cross-compiled from-source stage in
  `pkgs/mos-boot/Dockerfile`, which is more packaging work than Phase 2 is Rust
  work; it is retired by Phase 2 the moment that lands; and it can never reach
  Phases 3–4, because any dynamically linked C program in the archive keeps
  `libc` and the loader. Recorded rather than deleted so the option is not
  rediscovered as new.
- **BusyBox for the startup helpers — measured and rejected.** Replacing
  `mount`, `losetup`, `blkid` and `switch_root` frees only 1,522,104 bytes,
  because just two libraries are exclusive to them (`libmount.so.1` 527,152 and
  `libsmartcols.so.1` 395,432); the rest are shared with the verity/DM chain and
  stay. Against a static BusyBox of roughly 1,038,696 bytes (local 1.37.0 build,
  indicative) the net is about 0.46 MiB, versus 1,522,104 for Phase 3. It also
  reintroduces a recorded argument-contract risk: BusyBox's `blkid` lacks
  `-t PARTUUID=... -o device` and its `losetup` options differ. Less saving and
  more risk than doing the syscalls directly.
- **fs-verity instead of dm-verity** removes the cryptsetup chain outright, but
  changes the install path rather than only boot, and `docs/design/ro-root.md`
  specifies a no-superblock dm-verity tree with geometry bound by the deployment
  envelope. A redesign, not a size optimisation.
- **Dropping the initramfs entirely** is only available if the root stops being
  file-backed: the kernel cannot mount ext4 and attach a loop device to a file
  inside it before root, and `dm-mod.create=` takes block devices.
  `CONFIG_DM_INIT=y` is already set on all four boards, so the kernel side would
  be ready, but it requires abandoning LAYOUT_VERSION 3 signed file deployments.
  A product-level decision, recorded here so this plan is not read as having
  rejected it on size.

## Annotations

Measurements were read off already-built artifacts under `_out/` on 2026-09-11;
no build was run. The three route decisions above are settled; **implementation
approval is still pending** and no code has been changed. All tests use newly
built complete system images; no compatibility is required.
