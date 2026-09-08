# RFCT-355 Triage the first cx3576 hardware boot: ramoops, wireless-regdb, autofs, the USB gadget

- **status**: completed
- **priority**: P1
- **owner**: bkd/b27ca6la
- **createdAt**: 2026-09-08 12:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

The cx3576 booted to a healthy multi-user system for the first time on
2026-09-08, after RFCT-351's flash defect was corrected. `_out/cx3576/a.txt` is
that boot: 1009 lines, no monitor attached and the Ethernet cable in `eth1`, so
the display and `eth0` findings in it are conditions rather than defects.

Four things in that log are ours. In the order their evidence is strongest:

1. **ramoops writes into memory the kernel was never given, and it is the
   console.** `ramoops: using 0xe0000@0x40110000` against
   `node 0: [mem 0x40200000-0x23fffffff]`.
2. **`wireless-regdb` is not installed** — and the log line that says so does
   not prove it, because the load was attempted 13 ms before the root mounted.
3. **autofs is not built and systemd asks for it.** A decision, not
   automatically a fix.
4. **The USB gadget serial fails to start** with `-22` from the UDC bind, on a
   board that ships `mos-gadget.service` and a `ttyGS0` getty.

Plus one decision to record and no code: OP-TEE does not probe, and that mos's
trust chain is `meta/` keys and RAUC signature verification rather than a TEE
was an assumption nobody had written down.

## ActiveForm

Triaging the first cx3576 hardware boot: moving ramoops into DRAM, packaging
the regulatory database with the one mechanism that can load it, deciding
autofs, fixing the gadget configfs bind, and recording the TEE assumption

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- Items 1–3 fixed or decided, each with an assertion in the image contract or
  the config checks, and the count cx3576 moved to.
- Item 4 fixed with evidence, or posed as a question with discriminating tests
  and bench rows.
- The OP-TEE decision recorded in `docs/design/security-model.md`.
- Bench rows in `docs/bsp/cx3576-bench.md` for everything only hardware can
  confirm.
- `verify/run.sh --verify --board cx3576` green on an image built here.
- `make docs-verify` green from a `git archive` into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched;
  `boards/cx3576/boot.cmd`, `build/src/mkimage-cx3576.ts`,
  `boards/cx3576/bsp/Makefile` and everything display-related untouched.

## Notes

### 1. ramoops was inside the firmware's 2 MiB, and it is not luck-shaped

The vendor `rk3576-linux.dtsi` declares `ramoops@40110000`, `0xe0000` at
`0x40110000`. RK3576 DRAM starts at `0x40000000` and TF-A/BL31 keeps the first
2 MiB, so the memory node U-Boot hands over starts at `0x40200000` and the
**whole** ramoops region is below it. pstore registered it and took the
console, so every printk on every boot was written into firmware memory.

**What was actually at risk, named.** The FIT this repository builds —
`_out/boards/cx3576/uboot-mos/u-boot.itb`, read with a device-tree parser —
loads three ARM Trusted Firmware segments at `0x3fe70000` (SRAM), `0x40060000`
and **`0x400f0000`**. The last is `0x20000` below the vendor ramoops base. The
board runs, so nothing fatal is being overwritten; the distance is two
128 KiB pages, and nothing in the tree was holding it there.

**Where it went, and why that address.** The region has to be inside the bank
the kernel was given *and* outside everything the boot chain writes — a warm
reset re-runs the boot chain before the kernel reads the previous boot's bytes,
so a region the loader scribbles on is a pstore that is empty exactly when it
matters. The boot chain's own addresses, from that same FIT and from
`boards/cx3576/boot.cmd`:

| address | what |
| --- | --- |
| `0x40060000`, `0x400f0000` | BL31 segments (inside the 2 MiB carve-out) |
| `0x40800000` | U-Boot proper — `TEXT_BASE`; it relocates *up* |
| `0x40c00000` / `0x40c00800` | `scriptaddr` / `loadaddr` |
| `0x40e00000` | `pxefile_addr_r` |
| `0x40f00000` | `verityaddr` (boot.cmd) |
| `0x42000000` | `kernel_addr_r` |
| `0x52000000` / `0x52180000` | `fdt_addr_r` / `ramdisk_addr_r` |

`[0x40200000, 0x40800000)` is above the carve-out and below every address the
loader writes. **0x40400000**: 2 MiB of clearance from the carve-out, 4 MiB
from `TEXT_BASE`, and — being 4 MiB from the base of DRAM — inside the bank on
every memory SKU, which a high address chosen against this 8 GiB unit would not
be. Nothing off-board can prove the loader leaves it alone, so
`docs/bsp/cx3576-bench.md` carries the probe that does (`pstore-survives`).

**`no-map`, not `reusable`, and the caching consequence stated.** `reusable`
hands a region to the allocator on the understanding that a driver can claim it
back; pstore has no such handshake and needs the bytes to survive a reset
*unread*, so a reusable ramoops is one the kernel may overwrite. Plain
reservation — neither property — keeps it out of the allocator but leaves it in
the arm64 linear map as Normal cacheable, while `fs/pstore/ram_core.c` maps it
write-combine (`persistent_ram_vmap`, `MEM_TYPE_WCOMBINE` is `mem_type` 0):
two live mappings of one physical range with mismatched memory types. `no-map`
removes the linear-map alias so pstore's is the only mapping. It does **not**
change which of `ram_core.c`'s two mapping paths is taken — arm64's
`pfn_valid()` answers from `memblock_is_memory()` and `memblock_mark_nomap()`
leaves the range in `memblock.memory`, so the `vmap` path is taken either way.
What changes is that there is no second, cached view.

**Moving it discards what is stored today.** Records at `0x40110000` are not
migrated and are unreadable afterwards; the first boot on the new address
starts with an empty pstore. Accepted: nothing has ever consumed those records.

**The assertion.** `boards/cx3576/board.env` gains
`BOARD_DRAM_USABLE_BASE=0x40200000` — declared empty on the two UEFI boards,
which is a statement and is linted as one — and
`verify/src/checks-bootchain.ts` reads **the shipped device tree out of the
boot slot** for two conclusions per slot: every `/reserved-memory` region with
a non-zero extent lies at or above that base, and the ramoops region is one
region carrying `no-map`. Nothing there names an address: the regions are
enumerated with `fdtget -l` and the window comes from the board file, so the
check is a property over whatever the tree contains rather than a second copy
of the `.dts`. Zero-extent regions (the vendor's `drm-logo@0`,
`drm-cubic-lut@0`, which the kernel itself refuses at boot) are named in the
pass message as not compared, and an empty subject set is a **fail** — the
shape in which this check would otherwise go quiet.

No upper bound is declared, and the omission is deliberate: DRAM size is
discovered by the vendor DDR initialiser at run time and this board ships in
more than one memory configuration, so a ceiling would be this bench unit's
8 GiB pretending to be a property of the board. The bound that was broken is
the bound that is stated.

### 2. The regulatory database, and the mechanism L1's brief assumed does not exist

**Both halves of the original finding hold.** `regulatory.db` is absent from
the packed root — `/usr/lib/firmware/` carries only the five AIC8800D80 blobs
`BOARD_FIRMWARE_FILES` names — and the load was attempted at 7.668 s against a
root mounted at 7.681 s, so the message would have appeared either way.

**The third fact is new, and it changes the repair.** The brief expected
cfg80211 to re-read the database when a wiphy registers. Against the pinned
kernel (armbian/linux-rockchip `c6157104`, `net/wireless/reg.c`) it does not:

- `regulatory_init_db()` is a `late_initcall` when cfg80211 is not a module,
  and it is what issues the request.
- `regdb_fw_cb()` with `fw == NULL` writes `regdb = ERR_PTR(-ENODATA)`.
- `query_regdb_file()` opens with `if (regdb) return query_regdb(alpha2);` and
  `query_regdb()` opens with `if (IS_ERR(regdb)) return PTR_ERR(regdb);`. The
  firmware loader is never asked again.
- `wiphy_regulatory_register()` re-applies the domain cfg80211 already has and
  touches `regdb` not at all.

The only path in the subsystem that clears that pointer is
`reg_reload_regdb()`, reachable through nl80211's `NL80211_CMD_RELOAD_REGDB`.
So on a board with a built-in cfg80211 and no initramfs — which is every board
this tree builds — **packaging the database alone ships a file the kernel will
not look at again**, and that is indistinguishable, from the file's side, from
a root where it works.

**What was done.** `mos-wifi` and `mos-wifi-ap` gain
`Depends: wireless-regdb, iw` (new pins in `rootfs/debian/packages/`, from the
snapshot `sources.env` already pins), and `mos-wifi` ships
`mos-regdb-reload.service` — a `Type=oneshot` running `iw reg reload`, ordered
`Before=network-pre.target`, with a package-owned `multi-user.target.wants`
link because the root is an immutable dm-verity squashfs and nothing runs
`systemctl enable` on it. The unit is in one package because a path has one
owner; `rootfs/packages/radio-wifi.pkgs` names both packages for every board
that declares the `wifi` radio, so no resolution has one without the other.

**The consumer this serves is already documented.** `docs/design/connd.md` §9:
"Whether the resulting channel and transmit power are legal where a device is
deployed depends on the regulatory database in the image, the driver, and the
operator setting the right code." mosd renders `country_code` and
`ieee80211d=1` into the hostapd instance it starts.

**And one honest qualification, which the bench row carries.** On the SKU that
booted, the regulatory database governs nothing. `aic8800_fdrv`'s `custregd`
module parameter defaults **true** (`COMMON_PARAM(custregd, true, true)` in
`rwnx_mod_params.c`; the `modinfo` text saying "Default: 0" is stale), so
`rwnx_custregd()` sets `REGULATORY_WIPHY_SELF_MANAGED` on `phy0` and installs
the driver's own table — and the log's
`CAUTION: USING PERMISSIVE CUSTOM REGULATORY RULES` banner is that call's
**success** branch, not a warning about a failure. A self-managed wiphy does
not take the core regulatory domain. The database is still the right thing to
ship: the board is a dual Wi-Fi SKU, `iw reg get` and `iw phy phy0 reg get` can
disagree, and which one a rendered `country_code` reaches is precisely what the
bench row is there to answer.

**The assertion.** Three conclusions in `verify/src/checks-connd.ts`, scoped by
the existing `wifi` radio predicate, because the three fail for unrelated
reasons and each is a green run for the other two: the database is at the path
the kernel searches (`/lib/firmware/regulatory.db` and its `.p7s`, spelled the
way `fw_path[]` spells it, so the merged-usr symlink is part of what is
asserted); the unit is in the image and enabled at `multi-user.target`; and the
program its `ExecStart` names is in the image. All three are driven from the
failing side in `checks-connd.test.ts`.

### 3. autofs: the boards disagree, and making them agree is not free

`# CONFIG_AUTOFS_FS is not set` and `# CONFIG_AUTOFS4_FS is not set` in
cx3576's resolved config — genuinely absent. **x64 and virt-arm64 both build
`CONFIG_AUTOFS_FS=y`**, because their configs derive from a mainline defconfig
that sets it and cx3576's derives from a Rockchip vendor tree that does not.
The difference was invisible until the board booted.

**The systemd line is not evidence of a need.** `kmod_setup()` asks for
`autofs4` on every boot whatever the unit set is.

**What the units actually are.** The packed root contains exactly two
`.automount` subjects, and neither is a reason to build autofs:

- `proc-sys-fs-binfmt_misc.automount`, which the log shows skipped on its own
  `ConditionPathExists=/proc/sys/fs/binfmt_misc` — `CONFIG_BINFMT_MISC` is not
  set either.
- `efi.automount`, which **nothing in this tree wrote**.
  `systemd-gpt-auto-generator` generates it because cx3576's boot slots are
  typed ESP and appear in no fstab. x64 and virt-arm64 mount their ESP from
  fstab, which is what makes the generator skip it there. On the hardware it is
  inert and systemd says why: `Starting of efi.automount - EFI System Partition
  Automount unsupported.` (`automount_supported()` is `access("/dev/autofs")`).

So building autofs into this kernel would not add a capability nothing uses; it
would **arm a read-write automount of a RAUC-owned boot partition**, chosen by
disk order rather than by which slot is running, on a device where `/boot` is
deliberately not a mountpoint. That is a decision about the generator and it is
not this one.

**Decision: the symbols stay out, and automount units are unsupported on
cx3576.** The `Failed to find module 'autofs4'` line is expected and is not a
defect.

**The assertion.** `verify/src/checks-kernel.ts` gains `EXCLUDED_BY_BOARD` and
a `kernel-config-excluded` conclusion in the opposite direction from the
existing floor: symbols this board's kernel must **not** build, read off the
shipped `/boot/config-*`, with a paired skip so every board reaches exactly one
of the two and a board that stopped naming any prints the skip rather than
nothing. Tests drive both spellings on, the no-config case (the shape in which
an absence check silently stops asserting), and the non-emptiness of the list.

**Named for L1 and deliberately not fixed here:** that
`systemd-gpt-auto-generator` generates `efi.automount` for BOOT-A at all is the
deeper item. It is inert today only because a kernel symbol is off, which is a
thin thing for it to depend on. Masking the generator, or naming the boot slots
in fstab, is its own change on three boards.

### 4. The USB gadget: determinable from the log, and closed

The log carries the cause one line above the error, and it is not the UDC:

```
Config c/1 of cx3576_serial needs at least one function.
udc 23000000.usb: failed to start cx3576_serial: -22
```

That first line is `drivers/usb/gadget/configfs.c`, the
`list_empty(&cfg->func_list)` arm of `configfs_composite_bind()`, whose `ret`
is `-EINVAL`. The configuration was handed to the UDC **with no function linked
into it**, and `-22` is that refusal.

**Why the link was not there.** `hwinit-gadget` created it with a relative
target:

```sh
ln -s ../../functions/acm.usb0 "$g/configs/c.1/acm.usb0" 2>/dev/null || true
```

configfs does not store a symlink and resolve it on use. `configfs_symlink()`
resolves the target **string** at creation time with `kern_path()`
(`fs/configfs/symlink.c`, `get_target()`), and `kern_path()` resolves a
relative path against the **calling process's working directory** — not against
the directory the link is created in. The idiom in
`Documentation/usb/gadget_configfs.rst` is relative precisely because it is
written to be run after `cd` into the gadget directory. `mos-gadget.service` is
a `Type=oneshot` with no `WorkingDirectory=`, so its cwd is `/`, the target
resolved as `/functions/acm.usb0`, `symlink(2)` returned `ENOENT`,
`2>/dev/null || true` swallowed it, and the script went on to bind the UDC.

Everything the chain needs is confirmed rather than assumed:
`CONFIG_USB_CONFIGFS_ACM=y` and `CONFIG_USB_F_ACM=y`, so
`mkdir functions/acm.usb0` succeeded — which the log proves independently,
because the script exits before binding if that `mkdir` fails and the bind was
attempted.

**`rockchip-usb2phy … error -ENXIO: IRQ index 0 not found` is not implicated.**
The UDC `23000000.usb` was found and the bind was attempted on it; the error
came from the composite bind, after the UDC lookup. `usb2-phy@0: Same as
current mode` at 11.465 s shows the OTG role write took effect.

**The fix** is a target that no working directory can reinterpret —
`ln -s "$g/functions/acm.usb0" …` — plus a refusal to hand the UDC a
configuration with no function, so the failure names itself instead of arriving
as `couldn't find an available UDC or it's busy`.

**The test drives the property, not the string.** A temp directory cannot
reproduce this: on any ordinary filesystem `../../functions/acm.usb0` from
`configs/c.1/` resolves correctly wherever the process stands, which is exactly
why the defect survived review. So `tests/gadget-configfs-test.sh` runs the
real script from cwd `/` against a fake configfs and asserts the property
configfs applies — the stored target must name the function directory when
resolved from the process's own cwd — and forces the second direction by making
`configs/c.1` a regular file, so `ln -s` fails with `ENOTDIR` for root as well.
Both mutations were driven: restoring the relative target reddens case 1,
deleting the guard reddens case 3. `make os-gadget-test`, and a CI step beside
the other bash-only gates.

What remains bench-only is whether the gadget then **enumerates on a host PC**,
which is the `gadget-bound` probe in stage 5.

### 5. OP-TEE: a decision, recorded

```
optee: api uid mismatch
optee: probe of firmware:optee failed with error -22
```

The Rockchip BL31 answers the SMC with a UID that is not OP-TEE's, because no
OP-TEE OS is loaded on this board. `docs/design/security-model.md` §4 now
states that no TEE is part of any mos trust chain on any board, that the chain
is `meta/` key material plus RAUC CMS verification over dm-verity, and — the
part worth writing down — that the probe failing **costs the device nothing**,
so neither the device-tree node nor the log line is evidence that a TEE is
holding up a corner of the design. Introducing one would be an I3/I4 claim with
its own evidence rows, not a side effect of a vendor blob beginning to answer.

### Vendor BSP noise, examined and left alone

`rkcif` ×47, `mpp_rkvdec2`/`rkvenc2` ×28, `mali` ×22, `cacheinfo` ×9,
`debugfs: Directory ... already present` ×6, SCMI 17/22, `fiq_debugger`,
`remotectl-pwm`, `rkvpss_hw`, `mtd_vendor_storage`. None of them is ours and
none is touched. Two are worth one sentence each so the next reader does not
re-derive them: `fiq_debugger ... nmi irq handler` is the *registration* of the
console this board's `BOARD_CMDLINE_ARGS` boots on and `ttyFIQ0` works; and the
`drm-logo@0` / `drm-cubic-lut@0` reserved-memory failures are the vendor's
zero-size placeholders, which is why the new reserved-memory check compares
regions with a non-zero extent and names the ones it skipped.
