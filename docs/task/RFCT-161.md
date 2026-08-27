# RFCT-161 PLAN-018 M2: board.yaml retired into board.env comments

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-018 (M2)

`board.yaml` is deleted, on both boards. Its own header said what it was --
"Not consumed by any build today" -- and a grep confirms the header rather than
trusting it: outside `docs/` and the two files themselves, nothing in the tree
names `board.yaml`.

What it carried fell into two piles. Most of it was a second copy of a fact
`board.env` already owns as a value, and a second copy is exactly what this
milestone exists to remove. The rest were human facts with no key anywhere --
the SoC name, the kernel's provenance, the Wi-Fi SKUs -- which would have been
lost with the file. Those are now comments in `board.env`, each placed against
the value it explains rather than dumped in a block at the top.

No board.env value changed. That was the hard constraint and it is checked
rather than asserted:

```
$ git diff d74de24..HEAD -- os/boards/cx3576/board.env os/boards/x64/board.env \
    | grep -E '^[+-][A-Z_]+='
$ echo $?
1
```

## Scope

| file | change |
| --- | --- |
| `os/boards/cx3576/bsp/board.yaml` | deleted, 39 lines |
| `board/x64/board.yaml` | deleted, 15 lines |
| `os/boards/cx3576/board.env` | +22 comment lines, no value touched |
| `os/boards/x64/board.env` | +11 comment lines, no value touched |
| `docs/design/uboot-ab-handshake.md` | 4 `path:line` citation tokens repointed |
| `docs/design/dashboard.md` | 1 `path:line` citation token repointed |
| `docs/design/api.md` | 1 `path:line` citation token repointed |
| `docs/task/RFCT-161.md` | this file, new |
| `docs/task/index.md` | one row appended |

`board/x64/README.md` and the `board/x64/` directory are untouched: RFCT-162
owns them. `docs/design/boards.md` prose is untouched: a sibling workstream
owns that text, so none of the folded facts were written there.

## Upstream sync

The branch was cut from `main` and did not contain RFCT-160's move. Merged
first, as instructed:

```
$ git merge bkd/py5rki1z
$ git rev-parse HEAD
d74de242286b1d133664b86fa72fe4686c4a8f8a
$ test -f os/boards/cx3576/bsp/board.yaml && test ! -d board/cx3576 && echo ok
ok
```

`d74de24` is the merge base every measurement below is taken against.

## What was folded, and what was dropped

Dropped as already-a-value, with the key that owns it:

| yaml key | the value that already says it |
| --- | --- |
| `storage.ubootOffsetSectors: 64` | `LOADER_START_SECTOR=64`, `UBOOT_SEEK_SECTOR=64` |
| `console`, `earlycon` | `BOARD_CMDLINE_ARGS` |
| `artifacts.uboot.binary` / `.binaryMos` | `UBOOT_DEBUG_VARIANT_DIR`, `UBOOT_VARIANT_DIR`, `UBOOT_BIN_NAME` |
| `arch` | `MOS_ARCH` |
| `name` | `LAYOUT_BOARD` |
| `features` | derivable from `BOARD_RADIOS` and `BOARD_HWINIT_CONFS` |
| `artifacts.kernel.*` | the BSP Makefile's `out/` layout |

Folded as comments, cx3576, each next to the value it explains:

- SoC `rk3576` and boot chain `uboot-rockchip` (SPL+U-Boot at eMMC sector 64,
  FIT boot), plus storage media `emmc` on `/dev/mmcblk0` -- against the
  `LOADER_*` block.
- Kernel provenance -- `armbian/linux-rockchip`, branch `rk-6.1-rkr5.1`,
  version `6.1.115` -- against `BOOT_SLOT_REQUIRED_FILES`, together with the
  reason that list names `rk3576-src.dtb` and not the board.
- Wi-Fi as a dual SKU, `AP6275S-bcmdhd-sdio` and `AIC8800D80`, with the blobs
  shipping from the BSP firmware tree -- against `BOARD_FIRMWARE_FILES`.
- Display defaults, output `hdmi` and rotation `0` -- after
  `BOARD_HAS_STATUS_LED`, the last board-hardware declaration in the file.

Folded as comments, x64:

- No BSP build and no vendor kernel tree, because a UEFI machine boots from
  firmware -- against `RAUC_BOOTLOADER=grub`.
- Storage media is generic (nvme / sata / virtio) rather than a fixed device
  node, which is why x64 carries no `LOADER_*` block -- ahead of
  `LAYOUT_PARTITIONS`.

### The dtb name, corrected against the source

The yaml recorded `kernel.dtb: rk3576-cx3576z.dtb`. The BSP builds from a
`.dts` and renames the result, which the folded comment now says in full
(`os/boards/cx3576/bsp/kernel/Dockerfile:125-130`):

```
COPY kernel/dts/rk3576-cx3576z.dts /ksrc/arch/arm64/boot/dts/rockchip/
    make ... rockchip/rk3576-cx3576z.dtb && \
    cp arch/arm64/boot/dts/rockchip/rk3576-cx3576z.dtb /rk3576-src.dtb && \
```

So `rk3576-cx3576z.dts` is the maintained source, `rk3576-cx3576z.dtb` the
compiler's output, and `rk3576-src.dtb` the name a boot slot carries. Three
names for one artifact was the reason to write the chain down rather than
restate one link of it.

## MEASURED DRIFT: cmdlineExtra disagrees with BOARD_CMDLINE_ARGS

Recorded, not acted on. `board/cx3576/board.yaml` declared

```
cmdlineExtra: "storagemedia=emmc net.ifnames=0 rootwait"
```

while `os/boards/cx3576/board.env:349` declares

```
BOARD_CMDLINE_ARGS="console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 net.ifnames=0"
```

They disagree. The yaml carried `storagemedia=emmc` and `rootwait`; the env
does not. `board.env` is the consumed source of truth and the yaml was consumed
by nothing, so the running system uses the env's list. This is a documentation
drift, not a live bug, and `BOARD_CMDLINE_ARGS` was deliberately left alone --
changing a board definition value is outside this milestone. Whether the two
dropped arguments should be added to the env is a user decision, escalated with
this task.

## Citations

Deleting the yaml broke one citation, and inserting comment lines shifted five
more. Only the `path:line` token was edited in each; no surrounding prose was
touched.

| document | was | now |
| --- | --- | --- |
| `uboot-ab-handshake.md:210` | `os/boards/cx3576/bsp/board.yaml:6-7` | `os/boards/cx3576/board.env:349` |
| `uboot-ab-handshake.md:181` | `os/boards/cx3576/board.env:344` | `:349` |
| `uboot-ab-handshake.md:163` | `os/boards/cx3576/board.env:87` | `:92` |
| `uboot-ab-handshake.md:176` | `os/boards/cx3576/board.env:88` | `:93` |
| `dashboard.md:316` | `os/boards/cx3576/board.env:209-219` | `:214-224` |
| `api.md:3494` | `os/boards/cx3576/board.env:260` | `:265` |

The first was a deletion; the other five are the +5-line shift my comment
insertion put ahead of them. Only `uboot-ab-handshake.md:181` actually failed
the checker -- it quotes `BOARD_CMDLINE_ARGS` and the content check caught the
move. The other four resolved either way and would have gone on pointing at the
wrong lines silently, which is why they were repointed too.

Not repointed, because they are outside both this task's scope and the
checker's: `docs/research/mos-ui-inventory.md` (three `board.env:NNN` tokens)
and `docs/task/RFCT-152.md` (three more). The task file records a historical
measurement and must not be rewritten; the research document belongs to the
docs path sweep in M4.

## Checks

```
$ git ls-files | grep board.yaml          -> no output, rc=1
$ bash docs/verify-index.sh               -> rc=0
$ bash docs/verify-citations.sh           -> rc=0, 642/642 PASS
$ MOS_VERIFY_CONTAINER=1 make os-verify-test -> rc=0
$ MOS_BUILD_CONTAINER=1 make os-build-test   -> rc=0
```

No image or rootfs build was attempted. RFCT-160 measured that this host offers
no `linux/arm64` buildx platform and registers no binfmt, so those targets fail
for a pre-existing reason unrelated to this migration.

## Known-stale, not fixed here

`README.md:33` still says "Each board directory carries a `board.yaml`
metadata file describing the board". It is now false. `README.md` is not in
this task's file scope and is not in the citation checker's scope; the sentence
belongs to PLAN-018 M4's docs path sweep. Same for the `board.yaml` prose in
`docs/design/boards.md`, `docs/design/display.md` and the `*.zh.md` siblings.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
