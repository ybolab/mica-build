# Boot assurance ladder (I1–I4)

The assurance ladder is how mos reports what a board's boot path actually
verifies — four additive levels, each naming a concrete mechanism, so a
per-board claim is a checkable statement instead of the phrase "secure
boot". The canonical definition of the I1–I4 ladder lives in
`docs/design/security-model.md` (trust workstream); this page presents the
ladder for qualification purposes — what a dossier may claim and with what
evidence — and does not redefine it. Each board's evidenced level lives in
its dossier's Assurance level section
([board-template.md](board-template.md)), tied to the design records that
implement or propose each level.

The canonical definition of the ladder is section 5 of
[security-model.md](../design/security-model.md); this page applies it and
does not restate it.

**Additive** means each level presumes the ones below it. **Honest** means a
level is claimed only with the mechanism in place on that board and the
evidence named — and that a chain running through a binary-only stage says
so ([intake.md](intake.md) section 5): an opaque stage caps auditability
regardless of configuration.

Policy for what a dossier may claim: **I1 is the common target for every
board; I2 gates authenticated updates; I3 and I4 are board-specific best
effort** — they depend on vendor silicon capability and are never promised
universally. The ladder is qualification vocabulary; which level a board has
reached is stated, with evidence, in that board's dossier.

> status: shipped — evidence: `docs/bsp/board-template.md`

## I1 — verity-protected root

**Claim.** The root filesystem is a read-only squashfs under a dm-verity
hash tree; any offline modification of the root is detected at read time.
The mechanism is the verity boot path in
[docs/design/ro-root.md](../design/ro-root.md): one `dm-mod.create=` table,
written once by the rootfs build, read by the kernel's dm-init on boards
whose kernel has it built in and by the initramfs script on boards whose
kernel does not.

**What it does not claim.** Nothing verifies the kernel, the DTB, the verity
parameters or the bootloader itself: a writer who can change the boot slot
can change the root hash they carry. That is I3's subject.

Both shipped boards implement I1.

> status: shipped — evidence: `rootfs/build.sh`

> status: shipped — evidence: `rootfs/initramfs/scripts/mos-verity`

## I2 — authenticated normal system update

**Claim.** A device installs only update bundles it can authenticate: RAUC
verifies the bundle's CMS signature against the keyring in the signed root,
and TUF metadata pins which bundle is current (sha256, length, verity root
hash), with rollback publication gated. The two chains are deliberately
separate — see [docs/design/release-signing.md](../design/release-signing.md).

**What it does not claim.** I2 covers the *normal update path* only. It does
not authenticate what the factory or a physical attacker writes to storage
directly, and it is only as strong as I1 below it plus the key custody
around it: with development keys, I2 is a tested mechanism, not a production
promise.

The tooling ships and is exercised in the build, and so does the delivery half
it used to be waiting on: the image carries a client that walks signed release
metadata from a pinned root, downloads with resume, and refuses anything the
metadata does not cover.

> status: shipped — evidence: `build/src/bundle.ts`

> status: shipped — evidence: `pkgs/rauc-sign/README.md`, `docs/design/updates.md`

What remains is operational rather than mechanical, and it is what keeps I2
from being a production claim: owning production keys is an act written down
as a runbook and not yet performed, and no image provisions the pinned root
anchor the client verifies against.

> status: unsupported

## I3 — authenticated kernel, FIT, DTB and verity parameters

**Claim.** The bootloader authenticates what it boots: kernel, device tree
and the verity parameters (the root hash the I1 chain anchors to) are
signature-checked before use — on a U-Boot board, a signed FIT with
`CONFIG_FIT_SIGNATURE` and enrolled keys, per the U-Boot requirements in
[docs/design/boards.md](../design/boards.md).

**Where it stands.** No shipped board implements I3: the BSP contract
records that `CONFIG_FIT_SIGNATURE` is configured nowhere in the tree, and
the x64 boot path (one static ESP, stock GRUB) verifies nothing either. I3
also needs a board boot key to sign with, and that lifecycle is written down
and unbuilt (`docs/design/security-lifecycle.md` section 1.5). I3 is
board-specific best effort and nothing in the tree pursues it.

> status: unsupported

## I4 — hardware-rooted boot plus production debug policy

**Claim.** The chain is anchored in hardware — the boot ROM verifies the
first mutable stage against a key fused into the SoC — and the production
debug policy (JTAG, serial console, recovery modes such as maskrom/rockusb)
is deliberately decided, so the verified chain cannot be bypassed by a debug
path left open. The two halves are one level because either without the
other is theater: fused verified boot with an open rockusb loader path
authenticates nothing an attacker cares about.

**Where it stands.** No shipped board implements or configures I4. Fusing is
irreversible and can remove recovery, so it belongs to the manufacturing
lifecycle design (`docs/design/manufacturing.md` section 7, which records it
as prose with no tooling) and not to a board port's defaults. Nothing in this
tree fuses anything.

> status: unsupported

## Claiming a level

In a dossier, each level gets one line — met with evidence, or not met —
using the truth-status grammar; see
[cx3576-example.md](cx3576-example.md) for the filled instance. Rules:

- A level is claimed per board **and revision**, never for mos as a whole.
- A claim above the evidence is a release blocker, not a marketing choice:
  release notes and the website inherit their permitted language from the
  dossier via [support-tiers.md](support-tiers.md).
- A chain containing a binary-only stage must name it next to any I3/I4
  claim (Known limitations carries the entry; the Assurance level section
  points at it).
