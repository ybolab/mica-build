# RFCT-031 — the Rockchip loader area becomes a real GPT partition

Campaign `l1-o7ee8v0o-20260819002321-m5` (PLAN-010 M5). Branch `bkd/2y3696lc`,
merged by L2 into `bkd/tnljob83`.

## The defect

`systemd-repart` discards every region of the disk that no GPT partition entry
covers, and it does so on the first boot while growing the last partition. The
Rockchip idbloader lives at raw LBA 64, which was outside every partition in
both image pipelines. The first-boot growth run therefore TRIMmed it away: the
device booted once and came up in maskrom on the next power-on.

Reproduced against a real image on a loop device before the fix — LBA 64 went
from `524b4e53` (`RKNS`) to `00000000`, and repart's own log says
`Successfully discarded gap at beginning of disk.` The mechanism is not
Rockchip-specific; it applies to any SoC that boots from a raw offset.

A `--discard=no` drop-in on the repart unit would suppress the symptom. The
user ruled for the structural fix instead: there is no fielded fleet and images
are flashed whole-disk, so changing geometry costs nothing today and is
expensive later. **The final state carries no `--discard=no` anywhere**, and
first-boot TRIM stays enabled. Protection comes from the partition entry
existing.

## The partition

One entry covering exactly the raw loader area, following Rockchip's own
convention (their layouts carry `loader1`/`loader2`):

| property | value | why |
| --- | --- | --- |
| label | `loader` | |
| start | LBA 64 | where the RK3576 BootROM looks |
| size | 32704 sectors (16 MiB − 32 KiB) | ends exactly where `uenv-a` / the v1 boot partition begins |
| type | `8DA63339-0007-60C0-C436-083AC8230908` (gdisk 8301, "Linux reserved") | distinct from linux-generic and from the ESP type |
| GUID (v2) | `5AC35760-0002-4000-8000-000000000011` | |
| GUID (v1) | `5AC35760-0001-4000-8000-000000000003` | v1 keeps its own disk-identity family |

Every constant lives in `os/layout/cx3576-v2.env` and every consumer sources it
— including `os/mkimage.sh` and `os/verify-image.sh`, which previously restated
sector 64 and sector 32768 of their own. There is one loader area on this
board, not two.

Two things about the entry are load-bearing and easy to get wrong:

- **The type must be distinct.** repart pairs its definition files with existing
  partitions BY TYPE UUID in disk order. A loader typed linux-generic would
  consume the first definition and shift the grow flag onto the wrong
  partition. With 8301 no definition can match it, and no filesystem-probing or
  auto-mount path (`systemd-gpt-auto-generator`, udev) acts on that type either.
  This is asserted, not assumed: both verifiers COUNT the linux-generic
  partitions in the assembled GPT and require the shipped definition count to
  equal that number, so the loader being invisible to repart is a measured fact.
- **`sgdisk -a 1` is mandatory.** Sector 64 is not 2048-aligned, and without a
  relaxed alignment multiple sgdisk *silently* moves the requested start up to
  sector 2048 — reintroducing exactly the failure the entry exists to prevent,
  with no warning. Both assemblers therefore read the partition back out of the
  ASSEMBLED image and refuse if the start or size is not what was asked for.

## Partition table, before and after

Layout v2 (`os/mkimage-v2.sh`):

| before | after | label |
| --- | --- | --- |
| — | **p1** | **loader** |
| p1 | p2 | uenv-a |
| p2 | p3 | uenv-b |
| p3 | p4 | boot-a |
| p4 | p5 | boot-b |
| p5 | p6 | rootfs-a |
| p6 | p7 | rootfs-b |
| p7 | p8 | meta |
| p8 | p9 | state |
| p9 | p10 | ephemeral |
| p10 | p11 | data |

v1 (`os/mkimage.sh`): p1 `loader` (new), p2 `boot` (was p1), p3 `rootfs` (was
p2).

Image sizes are unchanged in both pipelines: the loader partition covers head
area that was already reserved.

### Partition GUIDs did NOT move

The trailing decimal digits of every partition GUID and fs UUID are an
**identity number**, allocated in the order partitions were added to the layout
and frozen once allocated. Up to and including DATA the identity happened to
equal the partition number; inserting the loader at the head of the table broke
that coincidence, and the loader took the next free identity (11) rather than
displacing anything.

Resyncing the identities to the new positions would have rewritten every
PARTUUID that the dm-verity kernel cmdline, `/etc/fstab`, `/etc/fw_env.config`
and the RAUC slot devices are pinned to — the identifiers whose entire job is to
be independent of position. The mapping is written out in
`os/layout/cx3576-v2.env` next to `DATA_PARTNUM`.

## Consumers of a partition NUMBER, and what was done

Enumerated by grepping the whole tree for `mmcblk0p`, `mmc 0:`, `bootpart`,
`rootpart`, `PARTNUM` and bare `pN`, not by working from a list.

1. **`os/boot/cx3576-boot.cmd`** — `setenv bootpart 3|4`, `setenv rootpart 5|6`.
   Renumbered to 4|5 and 6|7. These are literal numbers because hush cannot read
   the layout file, so `os/mkimage-v2.sh` now REFUSES TO COMPILE the script if
   any of the four disagrees with `BOOT_A_PARTNUM` / `BOOT_B_PARTNUM` /
   `ROOTFS_A_PARTNUM` / `ROOTFS_B_PARTNUM`. `os/verify-image-v2.sh` re-reads the
   same four numbers out of the COMPILED `boot.scr` in the assembled image, so a
   script built from a stale source is caught too.
2. **RAUC `system.conf`** — nothing to fix: slots are already addressed as
   `/dev/disk/by-partuuid/<guid>`, so renumbering cannot reach them. That is now
   enforced rather than observed: `os/rauc/render-config.sh` refuses to render a
   template whose `device=` is anything other than a by-partuuid path, and
   `os/verify-image-v2.sh` asserts the same shape on the shipped file. A
   `/dev/mmcblk0pN` path would make RAUC install an update over the RUNNING slot
   after a renumbering, silently.
3. **Both verifiers and the selftest** — every GPT assertion renumbered; the
   "data is the last partition" pairing still holds (data is p11 and still ends
   one `IMAGE_TAIL_SLACK_MIB` short of the image end). v1's `p1`/`p2` blocks
   became `p2`/`p3` and a `p1` loader block was added.
4. **repart definitions** — count unchanged at 8, because the loader's type
   keeps it out of the matching. Demonstrated by counting linux-generic
   partitions in the assembled GPT (see above), not assumed.

Nothing else in the tree consumes a partition number. `board/**` is the user's
area and was not touched; the only `mmcblk0pN` literals there are in the
unrelated alpine bring-up rootfs.

## What must NOT have moved, asserted

- **U-Boot `ENV_OFFSET` / `ENV_OFFSET_REDUND`** (`0x1000000` / `0x1100000`, set
  in `board/cx3576/uboot/Dockerfile`) are absolute byte offsets compiled into
  the bootloader. `uenv-a` and `uenv-b` keep their start sectors (32768 /
  34816), so the offsets are unchanged. `os/mkimage-v2-selftest.sh` now asserts
  `UENV_A_OFFSET_BYTES == 0x1000000` and `UENV_B_OFFSET_BYTES == 0x1100000`
  against those literals — deliberately restated from the U-Boot config, because
  deriving both sides from the same file would assert nothing. A shifted env
  offset strands the A/B boot-order handshake on any flashed device and fails
  silently.
- **dm-verity kernel cmdline and `/etc/fstab`** are PARTUUID/GUID based and the
  GUIDs did not change, so they are byte-identical before and after. The
  existing verifier checks over them continue to pass unchanged.

## Tests

`os/repart-loader-test.sh` (`make os-repart-test`) proves the STRUCTURAL
property against both pipelines, with a real `systemd-repart` on a real image on
a loop device and **discard enabled** (no `--discard` flag is passed at all):

- positive — the image as built: LBA 64 survives.
- "not a no-op" — the run must actually have modified the disk, or the positive
  result would be vacuous (a repart that refused to run would also leave LBA 64
  alone; that is not hypothetical, see the finding below).
- negative — the SAME image with ONLY the loader partition entry deleted
  (`sgdisk -d 1`): the same stock repart destroys LBA 64. Not a different layout
  and not a different flag — one GPT entry, which is exactly what this task
  changed.

The test also asserts that no `--discard=no` override is staged into any image.

`os/mkimage-v2-selftest.sh` adds the numbering negative tests, which are the
highest-value tests here because renumbering bugs do not announce themselves:

- four cases, one per literal in `boot.cmd`, each rewriting exactly that number
  to the value the pre-loader layout used; the fixture is compared against the
  real file first so the case cannot pass vacuously. Each must fail the build
  and name both the stale value and the layout's value.
- a `system.conf.in` doctored to address a slot as `/dev/mmcblk0p6` must be
  refused by the renderer, with the positive direction (the shipped template
  renders, and every rendered device is a by-partuuid path) checked alongside.
- a U-Boot blob without the `RKNS` magic must be refused, so the loader
  partition cannot end up covering something the BootROM will not load.

Both assemblers assert, against the assembled image, that the first byte of the
loader partition is the idbloader magic and that the blob fits inside the
partition with room to spare (v1: 9393152 of 16744448 bytes, 7351296 spare;
v2: 9400320 of 16744448, 7344128 spare).

### Counts

| check | before | after |
| --- | --- | --- |
| `os/verify-image.sh` | 88/88 | 98/98 |
| `os/verify-image-v2.sh` | 228/228 | 245/245 |
| `os/repart-loader-test.sh` | (new) | 11/11 |
| `os/mkimage-v2-selftest.sh` | PASS | PASS |
| `make os-health-test` | 54/54 | 54/54 |

The campaign brief quoted 89/89 and 247/247 as the starting counts and said a
sibling L3's shadow checks were already in the merge base. They are not: base
`bea0b25` contains no `shadow` assertion in either verifier, and the measured
baseline is 88/88 and 228/228 (measured by stashing this branch's changes and
rebuilding). Nothing here renumbers, reorders or disturbs those checks, because
there is nothing here to disturb; when L2 merges the shadow branch its checks
add on top.

## Finding, NOT fixed here: v2 first-boot growth currently refuses to run

While building the repart test it turned out that the SHIPPED v2 repart
definitions cannot drive a successful repart run at all. This is pre-existing
and independent of this task — it reproduces identically on a v2 image built
from the merge base, with no loader partition:

```
Can't fit requested partitions into available free space (6.7G), refusing.
Automatically determined minimal disk image size as 1.2G, current image size is 8.0G.
```

Cause: `systemd-repart` will not claim an EXISTING partition that is smaller
than the definition's minimum size, and that minimum defaults to 10 MiB.
`uenv-a` and `uenv-b` are 64 KiB `linux-generic` partitions, so
`10-uenv-a.conf` and `20-uenv-b.conf` cannot claim them. repart concludes it
must CREATE two new partitions, cannot place them, and aborts — before doing
anything, including before discarding. Narrowed to a two-partition synthetic
image: a 64 MiB first partition is claimed, a 64 KiB one is not, and adding
`SizeMinBytes=0` to the definition makes the 64 KiB case claim cleanly.

Consequences:

- v2 first-boot growth of `/srv` does not happen today. DATA stays at its
  built 64 MiB on a real eMMC.
- the loader-wipe hazard is currently *masked* on v2 by this second defect
  (repart never reaches the discard), but is fully live on v1, which is what
  bring-up flashes. Fixing the definitions without the loader partition would
  have un-masked it.

The one-line fix is `SizeMinBytes=0` in
`os/rootfs/overlay-v2/etc/repart.d/10-uenv-a.conf` and `20-uenv-b.conf`. It is
NOT applied here: it is outside this task's scope and belongs with whoever owns
the v2 overlay. `os/repart-loader-test.sh` synthesises its definition sets with
`SizeMinBytes=0` for this reason, documented at the call site, so it exercises a
real discarding repart run on the real GPT rather than a refusal.

## Consequence for boards already flashed

**Any board flashed with an image built before this change has already lost its
loader** — the first boot's growth run discarded it — and cannot be recovered by
writing a new image over eMMC from the running system. It must be re-flashed in
maskrom, which rewrites the idbloader at LBA 64.

Boards flashed with an image built from this branch onwards are unaffected:
the loader area is covered by a partition entry and repart leaves it alone.

The flashing procedure itself is documented in
**`docs/design/uboot-ab-handshake.md`** (and historically in
`docs/task/RFCT-007.md`), both owned by the docs L3 of this campaign. That
document needs this consequence recorded next to the flashing steps; it is not
edited here because `docs/design` is not this task's area.
