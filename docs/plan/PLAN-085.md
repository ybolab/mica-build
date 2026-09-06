# PLAN-085 A generic virtual arm64 board, bootable in QEMU

- **status**: draft
- **createdAt**: 2026-09-06 08:20
- **approvedAt**: (pending)
- **relatedTask**: RFCT-335

## Context

### Why a third board

`boards/x64/board.env` states its own purpose in its header: the arm64 build
cannot prove that a container actually starts, or that
`/etc/containers/containers.conf` takes effect, so a layout exists "so both can
be proven in QEMU before hardware". That reasoning is sound and it has a hole:
what gets proven in QEMU is proven **on amd64**. `cx3576` is the arm64 board and
it is a real device — U-Boot, an SPL at sector 64, a vendor BSP — so nothing
arm64 in this tree is ever executed here. Every arm64 claim is either static
(the image contract reads the assembled image) or owed to a bench, which is why
PLAN-071 U10 is blocked.

A generic virtual arm64 board closes that: same architecture as the shipping
device, booting the standard ARM flow under QEMU, in CI and on this host.

### The surface, enumerated by grep rather than from a list

The honest starting point, and the number is re-derivable:

```console
$ grep -rl x64 --exclude-dir=node_modules boards/ rootfs/ build/ verify/ tests/ Makefile | wc -l
166
$ grep -rl x64 --exclude-dir=node_modules boards/ rootfs/ build/ verify/ tests/ Makefile | grep -c '\.test\.ts$'
51
```

**166 files** name `x64` in those six roots; **51** of them are `.test.ts` and
**115** are not. `--exclude-dir=node_modules` is required and is not cosmetic:
`verify/node_modules` is created by any `verify/run.sh` invocation, is gitignored,
and inflates the same command to 186. The comparable figure for the other board
is 193 files (`grep -rl cx3576 …`, excluding `boards/cx3576/bsp/`).

By area: `verify` 64, `build` 41, `boards` 27, `rootfs` 24, `tests` 9,
`Makefile` 1.

Of those 166, only **13 are files named for the board** — the ones a new board
adds rather than edits:

```text
boards/x64/bsp/kernel/config/x64.config        build/src/grub-x64.ts
boards/x64/bsp/kernel/config/x64.fragment      build/src/grub-x64.test.ts
boards/x64/deb/board-x64/control/…control      build/src/layout-x64.ts
boards/x64/deb/kernel-x64/control/…control     build/src/layout-x64.test.ts
rootfs/packages/board-x64.pkgs                 build/src/mkimage-x64.ts
                                               build/src/mkimage-x64.test.ts
                                               build/src/mkimage-x64-cli.ts
                                               build/src/mkimage-x64-cli.test.ts
```

`boards/x64/` itself is 23 files. The remaining ~130 mentions are prose, test
fixtures and comparisons that name the board incidentally.

### What is already board-generic, and what is not

Generic, and this is the good news — most of the tree does **not** need an edit:

- **Board discovery is off the tree.** `verify/src/paths.ts:shippedBoards()`
  reads `boards/*/board.env` and `requireShippedBoards()` refuses an empty
  answer. `build/src/paths.ts` does the same. A board added under `boards/`
  is linted, iterated and reported the day it lands, with no registry edit.
- **The layout schema is role-dispatched.** `verify/src/lint.ts:ROLE_SCHEMA`
  keys off `<NAME>_ROLE`, checks required *and* forbidden keys, and treats
  declared-empty as a statement rather than as absence. A UEFI arm64 board
  reuses `esp` / `verity-slot` / `ext4` unchanged and declares no new role.
- **Dossiers are discovered by their H1.** `docs/bsp/verify-board.sh` validates
  every `docs/bsp/*.md` whose H1 starts `# Board dossier:` against the 13
  headings parsed out of `board-template.md`. No edit there either.
- **The kernel floor is shared and arch-neutral.** `boards/common/mos-required.fragment`
  (256 lines) carries `CONFIG_DM_INIT`, dm-verity, squashfs and the container
  floor; both boards merge it first and assert every `=y` line survived.
- **The arm64 deb route already exists.** `build-env/deb/build.sh --arch arm64`
  routes to the `mos-<arch>` docker-container builder; cx3576's producers use
  it today.

Not generic, and each is a named edit:

- `rootfs/build.sh:58-70` — a hardcoded `case "$MOS_BOARD"` mapping board to
  arch, whose error message spells the board list out (`known boards are cx3576
  and x64`). It sets `MOS_ARCH`, and then line 160 sources `board.env`, which
  sets `MOS_ARCH` again to the same value. One fact, two statements.
- `rootfs/build.sh:875` — `if [ "$MOS_ARCH" = "amd64" ]` decides whether
  `fw_env.config` is rendered. Correct today by accident: it means "not U-Boot",
  and on a UEFI arm64 board it would render a U-Boot environment config naming
  partitions that do not exist.
- `build/src/{layout,mkimage,grub}-x64.ts` — the UEFI+GRUB assembler, named for
  a board rather than for what it is. See *The one real design fork* below.
- `build/src/toolsets.ts:72` — `grub-efi-amd64-bin` in the `x64-assembly`
  package list, and `mkimage-x64.ts:436` — `--format=x86_64-efi`.
- `build/run.sh` — `--mkimage-x64` is a top-level MODE, not a `--board` flag.
- `Makefile:4` — `BOARDS := cx3576 x64`, plus the `x64-%` BSP delegation.
  There is **no `os-image-x64` / `os-verify-x64` target**: x64 is driven by
  `bash build/run.sh --mkimage-x64` and `bash verify/run.sh --verify --board x64`.
  The `os-image-<b>` / `os-verify-<b>` shape is cx3576's, not the UEFI board's.
- `rootfs/debian/packages/*.json` — 172 package pins, each with per-arch
  `targets` and a per-arch `consumers` list. **10** name `mos-board-x64` under
  `amd64` (grub-editenv's closure: `libc6`, `libdevmapper1.02.1`, `dmsetup`,
  `libselinux1`, `libpcre2-8-0`, `libudev1`, `libcap2`, `liblzma5`,
  `libgcc-s1`, `gcc-14-base`). The arm64 board package must join the same 10
  under `arm64`.
- `pkgs/mosd/tests/apid-api/` — the boot harness, hardcoded to x86_64. See
  *The harness* below.
- `verify/src/checks-kernel.ts:424,480` — two checks gated `boards: ['x64']`
  that are really "boards that ship a kernel this repo built". They apply to
  the new board too.
- `tests/dual-build-sanctions.md`, `tests/rootfs-manifest-test.sh:147-188`,
  `tests/netavark-kernel-config-test.sh:44-45`, `tests/factory-root-gate/gate.sh:35`.

### Measurements taken for this plan

Everything below was run on this host, in the digest-pinned
`IMAGE_DEBIAN_TRIXIE` base (`debian:trixie-slim@sha256:d7e1218…`), 2026-09-06:

| Question | Answer |
| --- | --- |
| Is AAVMF installable on amd64? | **Yes.** `qemu-efi-aarch64` 2025.02-8+deb13u1, `Architecture: all`. Gives `/usr/share/AAVMF/AAVMF_CODE.fd` (a symlink to `AAVMF_CODE.no-secboot.fd`) and `AAVMF_VARS.fd`, **67108864 bytes each** — 64 MiB, not OVMF's 4 MiB. |
| Is `qemu-system-aarch64` available? | **Yes.** `qemu-system-arm` 1:10.0.11+ds-0+deb13u1, `Architecture: amd64`. `qemu-system-aarch64 --version` → QEMU 10.0.11. `-machine help` lists `virt` as an alias of `virt-10.0`. |
| Did it need binfmt or a buildx builder? | **No.** It ran in a plain `docker run` on this host, with no builder selected and no interpreter registered. |
| Can BOOTAA64.EFI be built on amd64? | **Yes.** `grub-efi-arm64-bin` is not in the amd64 index (it is `Architecture: arm64`), but `dpkg --add-architecture arm64` + `apt-get install grub-efi-arm64-bin:arm64` installs it — it is data only, 234 modules under `/usr/lib/grub/arm64-efi/`. `grub-mkstandalone --format=arm64-efi` then runs from the amd64 `grub-common` (both 2.12-9+deb13u2) and produces a valid PE (`MZ`, 6041600 bytes). |
| Is that output reproducible? | **Yes.** Built twice in the same container, `cmp` reports byte-identical. |
| Is `grub-editenv` in the same container? | **Yes**, 2.12-9+deb13u2. |
| Layout lint baseline | `bash verify/run.sh --lint` → `RESULT: PASS (28/28 checks)` over 2 boards. |

## Proposal

### 1. The board is named `virt-arm64`

Not `arm64`. The x64 layout says the architecture is "declared here rather than
derived from the board name … so the board -> arch mapping exists once"; a board
literally named `arm64` re-fuses the two, makes every `MOS_BOARD` message
ambiguous with `MOS_ARCH`, and puts `_out/arm64` next to this tree's existing
`pkgs/podman/out-arm64` and `out-arm64` rauc artefacts. `virt-arm64` names what
the board is: QEMU's aarch64 `virt` machine with UEFI.

Hyphens are safe: `build-env/deb/pack.sh:131` accepts `^[a-z0-9][a-z0-9+.-]+$`,
so `mos-board-virt-arm64` and `mos-kernel-virt-arm64` are valid Debian names,
and no board-name regex exists anywhere else — the board is its directory name.

### 2. The QEMU machine and the firmware

```text
qemu-system-aarch64 -machine virt -cpu max
  -drive if=pflash,unit=0,readonly=on,file=<copy of /usr/share/AAVMF/AAVMF_CODE.fd>
  -drive if=pflash,unit=1,file=<copy of /usr/share/AAVMF/AAVMF_VARS.fd>
  -device virtio-blk-pci -device virtio-net-pci -serial mon:stdio
```

Pinned exactly as x64's firmware is pinned, and the plan should be honest that
this is not a strong pin: `src/qemu.ts` resolves the digest-pinned
`IMAGE_DEBIAN_TRIXIE` and then `apt-get install`s `qemu-system-x86 ovmf socat`
inside it at run time. The arm64 twin installs `qemu-system-arm qemu-efi-aarch64
socat` from the same digest-pinned base. Same discipline, same weakness, no new
one — tightening it is out of scope and would apply to x64 first.

Two things that are **not** copies of the x64 script:

- The pflash images are **64 MiB**, not 4 MiB. A `-drive if=pflash` whose file
  is not the flash device's size does not boot, and AAVMF ships 64 MiB files.
- `AAVMF_CODE.fd` is a symlink to `AAVMF_CODE.no-secboot.fd`. Copy through the
  symlink deliberately: the secure-boot variants would require an enrolled key
  this project does not have, and `docs/design/security-model.md` §4 already
  says firmware verification is the platform owner's claim, not this project's.

`virt` is left as the bare alias, matching x64's bare `q35`. Pinning
`virt-10.0` would pin the machine model to a QEMU version that the apt line does
not pin, which is a half-pin that reads stronger than it is.

### 3. The kernel is built in tree, and that is forced

Not a preference. The boot contract is `dm-mod.create=` on the command line with
**no initrd**, which needs `CONFIG_DM_INIT`. That is the exact symbol PLAN-074
moved x64 off Debian's `linux-image-amd64` for; Debian's `linux-image-arm64`
comes from the same config policy and has the same gap. Taking it would
re-introduce an initramfs re-parsing the command line GRUB just wrote — a second
implementation of the one boot contract — on the board whose entire purpose is
to exercise the real one.

So `boards/virt-arm64/bsp/kernel`, in x64's shape and cx3576's mechanics:

- mainline pinned by tag plus a `git archive` sha256, in a `versions.env` that
  documents the PENDING-hash bump ritual;
- **`KERNEL_VERSION=v6.12.107`, the same tag x64 pins**, for that file's own
  stated reason: moving one thing at a time. A different tag would make a boot
  failure ambiguous between the port and the version;
- `defconfig` (arm64's) as the base, `boards/common/mos-required.fragment`
  merged first, `config/virt-arm64.fragment` second, every `=y` asserted after
  `olddefconfig`, resolved config recorded as `config/virt-arm64.config`;
- cross-compiled `ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu-` from
  `FROM --platform=$BUILDPLATFORM`, exactly as `boards/cx3576/bsp/kernel/Dockerfile`
  does — this is a native amd64 build producing arm64 output, so it needs no
  emulation;
- artifact is `arch/arm64/boot/Image`, not `bzImage`.

The board fragment is the arm64 counterpart of `x64.fragment`, and the deltas
are:

- `CONFIG_SERIAL_AMBA_PL011` + `CONFIG_SERIAL_AMBA_PL011_CONSOLE` instead of the
  8250 block. Note that cx3576 gives **no precedent** here — its config carries
  `# CONFIG_SERIAL_AMBA_PL011 is not set`, because a Rockchip board consoles
  through a vendor 8250 variant at `ttyFIQ0`. The PL011 is new to this tree.
- `CONFIG_CRYPTO_AES_ARM64_CE_BLK` instead of `CONFIG_CRYPTO_AES_NI_INTEL` —
  the pair `x64.fragment` already names as existing "on no other architecture",
  and confirmed present as a standalone `=y` in cx3576's 6.12 config. **Not**
  `CONFIG_ARM64_CRYPTO`: that umbrella symbol is gone from this kernel
  generation (it appears nowhere in cx3576's resolved config), so asking for it
  would fail the fragment's own `=y` assertion.
- virtio and PCI kept; the Intel and Realtek NIC families dropped (a `virt`
  machine has none); the x86 framebuffer block dropped along with `tty0`.
- `CONFIG_NETFILTER_ADVANCED` kept and re-checked — it is set in `x64.fragment`
  because `x86_64_defconfig` leaves it off, and whether arm64's `defconfig` does
  the same is a build-time answer, not one to guess here.

### 4. It is a test target, not a product target

Explicitly, and stated in its own `board.env` and `evidence.json`:

- no `os-release-virt-arm64`, no bundle gate, no SBOM, no release notes;
- `evidence.json` claims only what a suite in this tree actually runs;
- `tests/dual-build-sanctions.md` and `os-release-gate` are told this board is
  outside their set — otherwise the first goes red on an unaccounted difference
  and the second goes vacuous.

Reason: x64 already holds the "QEMU and CI baseline" role for the product and
cx3576 is the shipping device. A third *product* target buys a third release, a
third evidence claim and a third ledger column, for no customer. What this board
buys is the ability to run arm64 code, and that is bought by being a test target.

If it is later promoted, the promotion is a plan of its own with a release gate
in it; nothing here forecloses that.

### 5. What stays identical to x64, byte for byte

Because divergence here is what the x64 header warns about, and because a diff
of the two `board.env` files should show only real differences:

the GUID scheme and its `5AC35760-…` shape; every filesystem label
(`esp`/`boot-a`/`boot-b`/`rootfs-a`/`rootfs-b`/`meta`/`state`/`ephemeral`/`data`);
the DATA/STATE/EPHEMERAL split and their sizes; `MOS_VAR_MIB=512`;
the `systemd-repart` growth rules and the derived definition count;
the ESP-is-not-a-slot rule and its one-ESP-plus-a-boot-pair consequence;
`ESP_SIZE_MIB=64`, `BOOT_SIZE_MIB=96` and every start offset derived from them;
`BOOT_A/B_TYPECODE` = Microsoft basic data, for both of the reasons the x64 file
gives; `SLOT_KERNEL_NAME=vmlinuz` and `SLOT_CMDLINE_NAME=cmdline.cfg`;
`BOOT_SLOT_REQUIRED_FILES="vmlinuz cmdline.cfg"`;
`RAUC_BOOTLOADER=grub`, `RAUC_GRUBENV`, and the deliberate absence of
`BOOT_ATTEMPTS_*`; the reproducibility block; `LAYOUT_PARTITIONS` and every
`_ROLE`; `BOARD_HAS_STATUS_LED=0`; `BOARD_FIRMWARE_FILES`/`BOARD_HWINIT_CONFS`/
`BOARD_RADIOS`/`BOARD_RECOVERY_ACTIONS` all declared empty.

`ESP_SIZE_MIB=64` is kept as the *same number* rather than re-derived. Its
justification is a FAT32 cluster-count floor plus a measured OVMF refusal, and
AAVMF is different firmware — so the number is carried over unchanged and the
assumption is **tested** in slice 4, not re-argued in this document.

### 6. What differs, and every difference is visible in `board.env`

| Key | Value | Why |
| --- | --- | --- |
| `LAYOUT_BOARD` | `virt-arm64` | identity |
| `MOS_ARCH` | `arm64` | the whole point |
| `DISK_GUID` / partition GUIDs | a third `5AC35760-00xx-…` series | so an image is identifiable |
| `IMAGE_NAME_PREFIX` / `_LATEST_NAME` | `virt-arm64-mos-…` | `_out/virt-arm64/` |
| `ESP_REQUIRED_FILES` | `EFI/BOOT/BOOTAA64.EFI EFI/mos/grub.cfg EFI/mos/grubenv` | the removable-media path UEFI looks for on aarch64 |
| `BOARD_CMDLINE_ARGS` | `console=ttyAMA0,115200 net.ifnames=0` | see below |
| `BOARD_SIZE_BUDGET_MB` | set from the slice-4 measurement | not copied from x64's 520, which is a ceiling chosen against an amd64 row |

`console=` deserves the x64 file's treatment as an absence with a reason: the
aarch64 `virt` machine has no VGA and no `tty0`, its console is the PL011 at
`ttyAMA0`, and x64's ordering rule (with several `console=` arguments,
`/dev/console` is the **last** one) applies identically — which is why there is
exactly one here and why it is the serial line.

### 7. The one real design fork: the assembler

`build/src/layout-x64.ts` opens with an argument for its own existence: it sits
"beside src/layout-cx3576.ts, not a `case` inside it", because the two boards
"agree on the idea … and on almost nothing about the arithmetic". That argument
is about **cx3576 vs x64** and it is correct. It is not an argument about x64 vs
a second UEFI board, which shares the arithmetic exactly.

Measured, the trio is already board-parameterised in everything except its name
and three literals:

- `mkimage-x64.ts:436` `--format=x86_64-efi`
- `mkimage-x64.ts:437,460` `BOOTX64.EFI` — already declared in `board.env` as
  `ESP_REQUIRED_FILES`, so this one is read from the board, not from a table
- `toolsets.ts:72` `grub-efi-amd64-bin`

**Recommendation: rename, do not branch.** `layout-x64.ts` → `layout-uefi.ts`,
`mkimage-x64.ts` → `mkimage-uefi.ts`, `grub-x64.ts` → `grub-uefi.ts`, plus their
CLIs and tests; the two remaining literals become a two-row map beside the
existing one in `toolsets.ts` (`amd64 → x86_64-efi / grub-efi-amd64-bin`,
`arm64 → arm64-efi / grub-efi-arm64-bin`). The files then say what they are: the
UEFI+GRUB assembler, as against cx3576's U-Boot one.

This is the highest-blast-radius item in the plan — it renames 8 of the 13
board-named files and moves imports in the `.test.ts` files beside them — so it
is called out for approval on its own, and slice 2 does it with **no behaviour
change**, gated on the x64 image being byte-identical before and after.

Consequence, and it is a deliberate break rather than an oversight: `build/run.sh`
loses `--mkimage-x64` and gains `--mkimage-uefi --board <name>`. This project is
in system development and does not keep compatibility shims; a mode flag that
names one board would have to grow a third arm for every UEFI board.

### 8. The harness

`pkgs/mosd/tests/apid-api/` is where most of the value is, and it is hardcoded:
`run.sh:22` sources `boards/x64/board.env`, `run.sh:24` builds `_out/x64`,
`src/qemu.ts:164` hardcodes `_out/x64`, and `INNER_RUN_SH` spells
`qemu-system-x86_64`, `-machine q35` and `/usr/share/OVMF/OVMF_CODE_4M.fd`.
`src/config.ts` takes no board at all — it is the *client* config (host, ports,
credentials) and correctly does not need one.

Parameterise it, in slice 5, by `MOS_BOARD`:

- `run.sh` sources `boards/${MOS_BOARD}/board.env` and derives `OUT_DIR`,
  `IMG`, `RUN_DIR`, `ART_DIR` and `ART_IN_CONTAINER` from it — all five already
  derive from `_out/x64` textually, so this is one variable.
- `src/qemu.ts` takes the board the same way, and its firmware/machine/binary
  triple becomes a two-row table keyed on `MOS_ARCH` — the same table slice 2
  adds to `toolsets.ts`, or a second one local to the harness if importing
  across packages is unwelcome (`build/` and `verify/` deliberately do not
  import each other's `paths.ts`; the same rule plausibly applies here).
- `espOffsetBytes()`, `readBoardEnv()`, `applyAppendToDisk()` and the linux-line
  rewrite are already board-generic and need nothing. `LINUX_LINE` matches
  leading whitespace, and the arm64 `grub.cfg` is a copy of x64's, so both
  menuentries are matched on both boards.

**The cost, stated rather than predicted.** x64's harness allows
`APID_LISTENING` 900 s and 2400 s of run time, against a README-recorded 60–66 s
on a host with `/dev/kvm`. There is no KVM for arm64 on any host here — it is
TCG always, and aarch64-on-x86 TCG is slower than x86-on-x86 TCG. I decline to
guess a multiplier. The first harness gate is therefore a **measurement**: boot
once, record wall-clock to `APID_LISTENING`, and set this board's timeouts from
that number with the measurement recorded beside them. If the honest number
makes the suite unaffordable in CI, that is a finding worth having, and the
fallback (a phase subset via the existing `APID_PHASES`) already exists.

### 9. The two constraints, addressed explicitly

**arm64 compose is broken; RFCT-334 owns it and is now approved.** This plan is
written against the tree as it will be once that lands, and nothing here
attempts to fix it or work around it. The backlog is ordered so that every slice
which does *not* need an arm64 root comes first; slices 4 and 5 are gated on
RFCT-334 landing and say so.

The approved fix is worth naming, because its shape decides how much this board
inherits. Today `rootfs/debian/run.sh:264` runs `debootstrap --second-stage`
through `chroot "$ROOT"`. Under an emulated arm64 buildx stage, buildkit injects
its interpreter at `/dev/.buildkit_qemu_emulator` — a path *outside* the root
about to be chrooted — so the chroot cannot find it and dies as
`chroot: failed to run command '/debootstrap/debootstrap': No such file or
directory`, a message about the binary rather than about the interpreter. Main's
last five commits (`544a1f38`…`0332da84`) are the record of trying to stage that
interpreter, and then its shared libraries, into the root. RFCT-334 is approved
to stop doing that and **restructure the second stage onto a Docker stage
boundary** instead — the root becomes a stage and the work becomes a `RUN`, so
buildkit's emulation applies natively and there is no chroot to smuggle an
interpreter into.

Two consequences for this plan, both good:

- **`virt-arm64` inherits the fix with no board-specific work.** Once the second
  stage is a stage boundary, composing an arm64 root is the same mechanism as
  composing an amd64 one, and this board's slice 4 is an ordinary
  `MOS_BOARD=virt-arm64 bash rootfs/build.sh`. Nothing in slices 1–3 or 6
  touches that path at all.
- **Slice 4 is an independent check on RFCT-334.** `virt-arm64` would be the
  first arm64 root composed for a board other than cx3576, so it exercises the
  restructured stage against a different board definition rather than against
  the one it was debugged on.

And it changes nothing about the boot. The chroot/binfmt problem is entirely on
the **build-time, user-mode** side of the distinction drawn immediately below;
the guest boot is system emulation and never touched `binfmt_misc` to begin
with. RFCT-334 therefore has no bearing on slice 5's boot path — only on
slice 4 producing a root for it to boot.

**This host cannot exec arm64 outside buildx** — `docker run --platform
linux/arm64` answers `exec format error`. That constraint does **not** apply to
the QEMU guest, and the distinction is mechanical rather than a hope:

- `docker run --platform linux/arm64` is **user-mode** emulation. It needs an
  aarch64 interpreter registered in the host's `binfmt_misc` so the kernel can
  exec an aarch64 ELF. This host has none, which is the error.
- `qemu-system-aarch64` is **system** emulation. It is an ordinary amd64 ELF
  that emulates an aarch64 machine in userspace. The host kernel never execs
  aarch64 code, so `binfmt_misc` is not consulted and the `mos-arm64` builder is
  not involved. Verified for this plan: it ran in a plain `docker run` here.

Where the arm64 builder *is* still needed is the two deb producers —
`boards/x64/deb/board-x64/Dockerfile`'s `grub` stage runs `apt-get download`,
`ldd` and `grub-editenv --help`, which are native-arch executions. Those go
through `build-env/deb/build.sh --arch arm64`, which already selects the
`mos-<arch>` docker-container builder, exactly as cx3576's producers do. No new
machinery, and nothing in this plan creates, deletes or reconfigures that
builder.

And the EFI binary needs neither: `grub-mkstandalone --format=arm64-efi` is an
amd64 binary reading arm64 data, measured above as working and reproducible.

## Risks

- **The assembler rename is wide.** Mitigated by making slice 2 behaviour-free
  and gating it on x64 image byte-identity: if a single byte of
  `x64-mos-latest.img` moves, the rename is wrong.
- **`ESP_SIZE_MIB=64` is carried on x64's reasoning, and AAVMF is not OVMF.**
  Carried deliberately so the two files diff cleanly; the risk is a boot that
  drops to the UEFI shell, which is a loud failure with a known repair
  (the x64 header records the identical OVMF symptom and its fix).
- **TCG cost may make the harness uneconomic in CI.** Cannot be sized before it
  is measured; slice 5's first gate is the measurement, and the phase-subset
  escape hatch already exists.
- **`virt` is an unpinned machine alias.** A QEMU minor bump could move the
  machine model under the board. Same exposure x64 already has with `q35`; if
  it bites, it bites both and is fixed for both.
- **Debian arm64 `defconfig` may not carry the parents the shared floor needs.**
  x64 hit exactly this with `CONFIG_NETFILTER_ADVANCED` gating
  `CONFIG_BRIDGE_NETFILTER`. The fragment build already fails loudly on a
  dropped `=y`, so this is a build-time answer, not a latent defect.
- **The board could rot.** A test board nothing runs is worse than no board.
  Mitigated by slice 5 putting it on the same footing as x64's suite; if slice 5
  is deferred, the board is a build target only and the plan should say so
  rather than imply coverage.
- **Pool contention.** `make os-debs` empties a producer's archives mid-run;
  the package and closure gates must not run concurrently, and no commit may
  land between building the pool and verifying it.
- **Slice 4 is the first non-cx3576 consumer of RFCT-334's restructured second
  stage.** If it surfaces a defect there, that defect is RFCT-334's to fix and
  not this plan's — slice 4 reports it and waits rather than patching around it.
  The reverse is the more likely outcome and is a benefit, not a risk: a second
  board is a better test of that restructuring than the board it was debugged
  against.

## Scope

Six slices, each with the gate that decides it. Slices 1–3 and 6 are unblocked
today; 4 and 5 wait for RFCT-334 to land — approved, mechanism known (§9), but
not yet in the tree.

| # | Slice | Gate |
| --- | --- | --- |
| 1 | `boards/virt-arm64/board.env`, `grub.cfg`, `evidence.json`, `overlay/` | `bash verify/run.sh --lint` → 3 boards, PASS, and the new board's line count matches x64's role-by-role |
| 2 | Rename the assembler trio to `*-uefi`, arch table in `toolsets.ts`, `build/run.sh --mkimage-uefi --board` | `bash build/run.sh --build-test` green **and** `x64-mos-latest.img` byte-identical to its pre-rename build |
| 3 | `boards/virt-arm64/bsp/kernel` (+ fragment, recorded config), the two deb producers, `rootfs/packages/board-virt-arm64.pkgs`, the 10 pool `consumers` entries, `rootfs/build.sh` dispatch | `make virt-arm64-kernel`; `make os-netavark-kernel-test`; `make os-rootfs-manifest-test`; `build-env/deb/build.sh --producer board-virt-arm64 --arch arm64` |
| 4 | Compose the root, assemble the image, verify it **(waits for RFCT-334 to land)** | `MOS_BOARD=virt-arm64 bash rootfs/build.sh`; `bash build/run.sh --mkimage-uefi --board virt-arm64`; `bash verify/run.sh --verify --board virt-arm64` |
| 5 | Board-parameterise `pkgs/mosd/tests/apid-api/` **(needs slice 4's image; not otherwise coupled to RFCT-334)** | x64 suite still green through the parameterised path, **then** one measured arm64 boot to `APID_LISTENING`, with the number recorded and the timeouts set from it |
| 6 | `docs/bsp/virt-arm64.md` dossier; `Makefile` `BOARDS` and BSP delegation | `make docs-verify` — `verify-board.sh` reports 2 dossiers and all 13 headings in order, with honest qualification rows |

Slice 6's dossier makes this board the **second** dossier in the tree and the
first non-example one: `docs/bsp/cx3576-example.md` is currently the only file
whose H1 matches, so **x64 has no dossier today**. That is a pre-existing gap,
it is noted here, and this plan does not close it — writing x64's dossier is
someone's task, not a rider on this one.

Explicitly **out of scope**: fixing arm64 compose (RFCT-334); writing x64's
missing dossier; promoting `virt-arm64` to a product/release target; tightening
the firmware pin from apt to a digest (an x64 problem first); U-Boot or
non-UEFI arm64 boot; secure boot and key enrolment; `docs/plan/index.md`,
`docs/task/index.md` and `docs/CHANGELOG.md`, which L1 owns.

## Alternatives

**Board name.** `arm64` — rejected, it collapses `MOS_BOARD` and `MOS_ARCH` into
one token against the x64 layout's explicit design and collides with existing
`out-arm64` artifact paths. `qemu-arm64` — defensible; `virt-arm64` was chosen
because `virt` is the QEMU machine's actual name, so the board name and the
`-machine` argument agree.

**Kernel from Debian.** Rejected on the boot contract, not on taste: no
`CONFIG_DM_INIT` means the `dm-mod.create=` table is silently ignored and an
initramfs has to re-implement it. This is the defect PLAN-074 removed; a new
board must not re-introduce it.

**A third assembler pair rather than the rename.** Cheaper to review and it
touches no existing file. Rejected because it duplicates arithmetic that is
provably identical and gives the tree two files that must be kept in step by
hand — the exact failure mode `board.env` calls out for the three-literal
`ESP_START_*` spelling. Available as a fallback if the rename's blast radius is
judged too wide at approval; say so and slice 2 becomes an addition instead.

**Leave the harness for a follow-up.** Cheaper, and it makes the board a build
target only. Rejected as the *default* because the task's premise is that a
board nothing boots does not unblock PLAN-071 U10 — but it is a legitimate
approval-time cut, and slices 1–4 and 6 stand on their own if slice 5 is
deferred. If it is cut, the board's `evidence.json` and dossier must say the
board is unbooted, so no reader infers runtime coverage from its existence.

**`rootfs/build.sh`'s board→arch `case`.** Adding a third arm is three lines.
The alternative is to delete the table and read `MOS_ARCH` from the board file,
which already declares it — the `case` sets `MOS_ARCH` at line 64 and
`board.env` sets it again at line 160 to the same value, so the two statements
are self-consistent today and only one of them is the board's. Recommendation:
delete the table in slice 3, since adding a third row to a redundant list is
worse than removing it. Flagged rather than assumed; it is a behaviour-adjacent
change to a shared script and approval should see it.

## Annotations

- 2026-09-06: Drafted. Awaiting approval; no implementation has been written.
- 2026-09-06 (L1): RFCT-334 is approved to fix the arm64 compose by moving
  `debootstrap --second-stage` off `chroot` and onto a Docker stage boundary.
  §9 now names that mechanism and this plan is written against the tree it
  produces; §Scope and §Risks updated. Implementation still waits for it to
  land, and this task does not attempt it.
- Disclosure: producing this plan created `verify/node_modules/` (gitignored, a
  side effect of `bash verify/run.sh --lint`) and ran four throwaway
  `ai-agent-y6gfy207-*` containers, all `--rm`. No tracked file outside
  `docs/plan/PLAN-085.md` and `docs/task/RFCT-335.md` was touched.
