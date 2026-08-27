# RFCT-157 PLAN-017 M3: boards.md and display.md re-measured against os/build and os/boards

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 22:05
- **claimedAt**: 2026-08-27 08:38
- **completedAt**: 2026-08-27 08:41
- **plan**: PLAN-017 (M3)

PLAN-017 M3, run after PLAN-018 reached `main` as the plan's Ordering section
requires. One commit, `8ce55da`, merged at `a8f13c9`: 67 insertions, 36
deletions across `docs/design/boards.md` (92 lines) and
`docs/design/display.md` (11 lines).

## Staleness guard, passed on the absence test

PLAN-018 moved the board tree and deleted `board.yaml`. This subtask verified
it was measuring the post-PLAN-018 tree by checking what is **gone**, not only
what is present:

- `board/cx3576`, `board/x64` and `board/common` do not exist; `board/` itself
  does not exist.
- `os/boards/` holds `common`, `cx3576`, `x64`.
- `os/boards/cx3576/` = `board.env`, `boot.cmd`, `bsp`, `hwinit`, `overlay`.
- `os/boards/x64/` has **no** `bsp` — correctly, since x64 builds no boot
  chain of its own.

Checking for absence is the half that matters: a branch cut before PLAN-018
would still have shown `os/boards/` had the sweep only looked forward.

## What landed

- **§2** — the layout block is rewritten to the tree under
  `os/boards/<name>/`, with `bsp/` present only where the board builds its own
  boot chain. The UEFI sentence names the surviving location and cites x64's
  own `board.env` for why that board has no `bsp/`.
- **§3** — producer cells resolved to `os/boards/<name>/bsp/...`; the
  `board.yaml` row replaced by `board.env`, which is what every consumer
  actually reads. Each producer/consumer claim carries a quoted fragment.
- **§5** — the boot-script / `system.conf` generator named a Talos-era symbol
  that exists nowhere in the tree; see the judgement call below.
- **§6** — see correction 1.
- **§7** — every step re-measured; the board-definition schema lint added to
  step 1, and the image-assembly step now names the two real `run.sh` modes.
- **§8** — x64 keeps its row: losing `board/x64` confirms the
  upstream-boot-chain rule rather than retiring the board.
- **`display.md` §5** — `board.env` carries no display capability key and no
  `display:` section. Both sentences now state that and cite the `board.env`
  comment where the defaults are recorded.

The citation gate went 886/886 -> **902/902**, with quote-carrying citations
341 -> **355**.

## Three corrections — claims the old document got wrong

Each was verified against the tree by L2 before the merge, and each reproduces
on the merged tree.

1. **§6 claimed the root is opened *"by dm-init with no initramfs in front of
   it"* as a universal. That is FALSE for x64**, which loads `initrd.img`
   (`os/boards/x64/grub.cfg:99`, `:117`). The corrected sentence keeps the
   argument and names the shared contract instead: one `dm-mod.create=` command
   line, read by the kernel's dm-init on cx3576 and by an initramfs local-top
   script on x64 (`os/rootfs/initramfs/scripts/mos-verity:5-8`). x64 takes
   Debian's `linux-image-amd64`, whose kernel does not have dm-init.
2. **§8 said cx3576's boot chain was "FIT". It is not.** The tree does `booti`
   on `Image` + `rk3576-src.dtb`
   (`os/boards/cx3576/boot.cmd:127-129`). No FIT is used anywhere in that
   chain.
3. **§8's *"gaps tracked in the board README"* was untrue** — that README
   tracks no gaps. Two of the three gaps are in fact **CLOSED** (the verity
   kconfig, the RAUC env handshake). The one still open is
   `CONFIG_FIT_SIGNATURE`, and §8 now states it as such: it is **configured
   nowhere in the tree** — the only occurrences are prose in
   `docs/plan/PLAN-005.md`, `docs/design/boards.md` and `boards.zh.md`, no
   kconfig fragment anywhere.

## The §5 `GenerateAssets` judgement call — approved

§5's boot-script / `system.conf` generator was cited as `GenerateAssets`, a
Talos-era symbol. Measured: `GenerateAssets` **appears in no source file in
this repository** — the only occurrences are `docs/plan/PLAN-005.md`,
`docs/plan/PLAN-006.md` and `docs/design/boards.zh.md:73`. This subtask
replaced the symbol with the board definition the two real generators read,
and left §5's argument untouched.

L2 endorsed this as within scope rather than as a scope overrun: leaving a dead
symbol in a design document is exactly the residue class PLAN-017 exists to
remove, and replacing only the symbol is the narrowest change that removes it.

## What this subtask did not settle, and deliberately left

- `board/` path tokens outside `docs/design/` that PLAN-018's sweep did not
  reach, and that no gate reaches either. Inventoried in
  `docs/task/RFCT-159.md`; out of this workstream's scope.
- 13 line citations into `boards.md` / `display.md` in `docs/task/**` and
  `docs/research/**` were left **on purpose**, not missed. They are **dated
  records** of what was measured at a past commit, not live cross-references.
  Re-pointing a dated worklist would falsify the record of what was measured.
  The reasoning and the full inventory are in `docs/task/RFCT-159.md`.
