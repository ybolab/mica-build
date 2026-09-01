# Recovery

This page is ordered from the recovery that happens by itself to the one that
costs the most, and it is blunt about the gaps: several recovery flows an
appliance eventually needs are designed but not built, and pretending
otherwise would be worse than the gap.

## 1. Automatic: a bad slot rolls back

A failed update never needs an operator. A slot that cannot boot, or cannot
pass the boot health gate, exhausts its boot credits and the bootloader
returns to the previous slot — that is the normal, tested path and it is
described in [update-rollback.md](update-rollback.md).

> status: shipped — evidence: `docs/design/uboot-ab-handshake.md`, `rootfs/overlay/usr/lib/mos/mos-health`

## 2. Both slots failing: the device keeps cycling

When neither slot has credits left, the cx3576 boot script refills all
counters and resets, so the device reboots repeatedly rather than halting
dead. The operator-visible symptom of a device with two bad slots is exactly
that reboot loop, and it means: go to the physical recovery path below.

> status: board-dependent — evidence: `boards/cx3576/boot.cmd`

## 3. Physical: whole-disk reflash

The last resort sits below the OS and is reachable when nothing else is. On
cx3576 that is the Rockchip loader path (rockusb) — recovery button at power
on, or the automatic fallthrough when boot fails — followed by writing the
full disk image over USB, as in [install.md](install.md). On x64, boot any
live medium and rewrite the disk.

What a reflash costs, stated precisely:

- **STATE is replaced** — settings, the administrator credential, SSH host
  keys, device identity and secrets. The device returns to first boot and
  mints a new identity ([first-run.md](first-run.md)).
- **DATA is replaced** — application data and home directories.
- **META is replaced** — update bookkeeping.
- **Grown DATA blocks are unreachable, not erased.** The flashed image is
  smaller than the disk; a reflash writes only the image's own extent, so
  blocks beyond it keep their old contents with nothing referencing them.
  A device being disposed of or handed to another party needs a media wipe,
  not a reflash.

> status: board-dependent — evidence: `docs/design/access.md`, `boards/cx3576/board.env`

## 4. Lost credentials: there is no software path back in

An operator who loses the administrator (web) credential **and** every
authorized SSH key cannot get back into the appliance by software. The API is
the only thing that can re-enable access and it requires the credential; SSH
is off or keyless; the serial console shows a login prompt with no account
that accepts a password. This is a deliberate property of the credential
model — credentials survive updates, so an update is not a back door — and its
price is that the recovery from total credential loss is the whole-disk
reflash above, with everything that costs.

Administrator credential recovery with physical presence — a designed flow
that rotates rather than discloses — is planned, not built.

> status: shipped — evidence: `docs/design/access.md`

## 5. Factory reset: not implemented

There is no factory-reset operation today — no button, no API action, no
console incantation. Wiping STATE would return the device to first boot (that
is how the provisioning design is written), but nothing in the shipped system
performs that wipe. The nearest real operation is the whole-disk reflash of
section 3, which is strictly more destructive.

The planned recovery work defines the missing tiers explicitly — manual slot
rollback as a guarded operator action, a per-board recovery runbook with
minimal failure-record collection, credential recovery, configuration reset,
application-data reset, full factory reset and secure wipe, each naming its
exact effects — and makes interrupted recovery replayable.

> status: proposed — evidence: `docs/plan/PLAN-048.md`

TODO(PLAN-048): revisit after this plan merges

## 6. Before you recover: collect the evidence

If the device still boots into either slot, capture what
[troubleshooting.md](troubleshooting.md) lists (journal, update state, the
device identity from `/usr/share/mos/manifest.tsv`) before reflashing —
a reflash destroys the evidence with the fault.
