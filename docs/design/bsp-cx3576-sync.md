# Design: cx3576 Upstream BSP Sync Record

> Not a design in the usual sense: a **sync record** for a vendored tree.
> `board/cx3576/` is derived from an upstream BSP repository, not authored
> here, so it needs a place that names where it came from, which upstream
> commit it is level with, and where we deliberately differ.

## 0. Why this is its own file, and not a section in `boards.md`

Two reasons, both structural.

`docs/design/boards.md` is a **cross-board BSP contract** — the artifact
interface, the kernel-config assertions, the checklist for adding a new board.
It is about what any board must provide. A per-board record of which upstream
commit one board is synced to is a different kind of document, and it would sit
oddly inside a contract. Measured at `b4b7c72`, `boards.md` does not mention the
upstream repository at all; `grep -rl 'cx3576-alpine' docs/` returned nothing in
the whole tree, which is the gap this file closes. (Re-run today that grep
matches this file, and should match only this file.)

More importantly, `docs/verify-index.sh` asserts `docs/design/*.md` against
`docs/README.md` **in both directions** — every design document is indexed, and
every index row resolves to a document. A *file* therefore gets its own standing
assertion that it still exists and is still reachable from the index. A
*section* inside an already-indexed file gets none, which is exactly the rot
this record exists to prevent.

## 1. Upstream source

| | |
|---|---|
| Repository | `ssh://git@git.ds.cc:33/miehq/cx3576-alpine.git` |
| Relationship | `board/cx3576/` is **derived from** that tree, not authored in this repository |

`board/cx3576/` is a drifted derivative, not a mirror. Measured at `b4b7c72`
against upstream `b210e2b^`, `kernel/config/kernel-cx3576z.config` and
`kernel/dts/rk3576-cx3576z.dts` were byte-identical, while `Makefile`,
`kernel/Dockerfile`, `rootfs/alpine/Dockerfile` and `uboot/Dockerfile` had
diverged. It is not a subtree or a submodule, so nothing enforces
the relationship mechanically — this record is the only thing that carries it.

## 2. Synced-to commit

| | |
|---|---|
| Commit | `b210e2b82f629e21ee826234008f9bd619ba7472` (`b210e2b`) |
| Subject | *"feat: add rescue boot paths and status LEDs"* |

The next sync is `git log b210e2b..` against that repository — a listing, not a
rediscovery. Do not re-derive the shared point by diffing trees.

**How this line is maintained:** whoever performs the next sync updates the
commit and subject above to the new upstream point, as part of that sync. A
stale value here is worse than none, because it makes the next sync replay work
that was already ported.

## 3. Deviation register

This is a **register, not a changelog**. It lists only places where mos
deliberately differs from upstream, so that a future sync knows what it must not
silently revert. Anything ported as-is does not belong here; the git history
already records that.

One entry today.

### D-1 — boot device order: eMMC before SD

| | |
|---|---|
| **Where** | `board/cx3576/uboot/patches/0006-rk3576-generic-cx3576z-usb-host-led-boot-order.patch`, the `bootstd` node in the `arch/arm/dts/rk3576-generic.dts` hunk |
| **Upstream has** | `bootdev-order = "mmc1", "mmc0", "usb";` — SD first, so an inserted SD card overrides eMMC |
| **We have** | `bootdev-order = "mmc0", "mmc1", "usb";` — eMMC first, SD second, USB last |
| **Reason** | The user decided it, 2026-08-20. |
| **Guard** | `board/cx3576/uboot/Dockerfile` asserts `test "$(fdtget u-boot.dtb /bootstd bootdev-order)" = "mmc0 mmc1 usb"` on the compiled device tree |

SD is retained as a fallback, not removed: a rescue SD still boots when eMMC is
unbootable, but it cannot override an eMMC that boots.

This is recorded as a **decision**, not as a conclusion derived from a threat
model or a security argument — it was not derived from either. Recording it as a
decision is what keeps it reversible by the person entitled to reverse it.

The guard runs on the compiled device tree, so a future sync that silently
restores upstream's order fails at build time rather than at first boot on a
customer's desk.
