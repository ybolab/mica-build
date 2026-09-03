# Design: Security Model — Threat and Physical-Access Boundaries

> What mos defends, against whom, per boundary — stated separately for runtime
> rootfs integrity, update authenticity, boot-chain authenticity, data
> confidentiality, recovery/provisioning and rootful applications, because the
> six have different mechanisms, different maturity, and different honest
> claims. Companion to `docs/design/release-signing.md` (the key ceremonies),
> `docs/design/ro-root.md` (the verity root), `docs/design/access.md` (debug
> access) and `docs/design/security-lifecycle.md` (who runs what, when).

## 0. How to read the status markers

The discipline is `docs/design/access.md` §0's: a security control that exists
only as prose has no mechanism that will ever notice it is absent, so every
mechanism below carries one of:

- **[implemented]** — code exists and is named, by path.
- **[partial]** — some of it exists; what is missing is named.
- **[proposed]** — no code at all; prose only. It is this document's
  equivalent of access.md's `[not implemented]`, chosen because most entries
  here are boundaries a later plan must build, not gaps in shipped features.

Two words are banned from this document except where they are being refuted or
scoped: **"secure boot"** and **"tamper-proof"**. §4 is where both get their
honest treatment.

## 1. The boundary axiom: physical possession is full control

**Physical possession of the boot medium implies full control of the device.**
This is already the stated boundary of the provisioning design
(`docs/design/provisioning.md` §3.4) and the access design
(`docs/design/access.md` §7): the preferred provisioning path is literally
"edit a file on the SD card with any reader", the factory recovery path is a
whole-disk reflash over the SoC loader mode, and anyone holding the medium can
rewrite the rootfs regardless of what it contains.

Every boundary below inherits this axiom. Where a boundary claims protection,
it claims it against the *online* attacker — one who reaches the device over
the network, the management API or the update channel — and against the
*unprivileged local* process, never against the person holding the hardware.
A board that reaches I4 on the ladder in §5 moves this axiom, and only such a
board does; today no board has (§4).

## 2. Boundary (a): runtime rootfs integrity — **[implemented]**

The root filesystem is a squashfs with an appended dm-verity hash tree, opened
by the kernel's dm-init from a `dm-mod.create=` table on the kernel command
line, read-only, no initramfs (`docs/design/ro-root.md` §1–2,
`rootfs/build.sh`). Every read from `/` is verified against the tree whose
root hash is on the command line; a modified block fails the read rather than
returning altered content.

What this defends: a runtime compromise cannot persist itself into the root
filesystem, and a corrupted or tampered slot fails loudly instead of running
altered code. Writes land only on the mutable tiers — STATE, DATA, META,
EPHEMERAL (`docs/design/ro-root.md` §4) — which is where persistence, and
therefore forensics and reset, live.

What this does **not** defend, stated because the rounding-off is the classic
error: the root hash is *chosen by whatever booted the kernel*. dm-verity
proves the root filesystem matches a hash; it proves nothing about who picked
the hash, the kernel or the command line. That is boundary (c), and it is a
different, weaker story (§4). dm-verity also covers only `/`: the mutable
tiers are plain ext4 with no integrity protection **[proposed]** — a
physically present attacker can edit STATE (settings, credentials hashes,
authorized SSH keys) offline, consistent with §1's axiom.

## 3. Boundary (b): update authenticity — **[partial]**

A release is signed twice, by two unrelated hierarchies
(`docs/design/release-signing.md` §0):

- **RAUC CMS** — **[implemented]** on the build/verify side: `rauc bundle`
  signs the bundle payload with an X.509 signer chained to a CA; the device
  verifies against `/etc/rauc/keyring.pem`, staged at build time from the
  repository-root `ca/` seam. A development-grade CA is unmissably marked
  (`ca/GENERATED`, `pkgs/rauc/gen-dev-keys.sh`) and the image verifier fails a
  marked root and names it development-grade in the verdict
  (`verify/src/checks-root.ts`, both directions proven by
  `verify/src/checks-root.test.ts`).
- **TUF metadata** — **[partial]**: `rauc-sign` maintains the four-role
  repository pinning each bundle's sha256, length and verity root hash, and
  `rauc-verify` performs the device-side walk with persistent rollback
  protection (`pkgs/rauc-sign/README.md`). Both are exercised offline by the
  test suite; **no shipped mechanism delivers the trust anchor to a device,
  and no transport fetches metadata onto one** — the provisioning candidates
  and their tradeoffs are recorded in `pkgs/rauc-sign/README.md` and
  `docs/design/release-signing.md` §2.3, all **[proposed]**.

The honest claim today: production-grade update authenticity is *buildable* —
the tooling accepts real keys, the ceremonies are written — and *not fielded*.
A device built from an empty `ca/` trusts a development CA and says so; a
device has no TUF anchor at all. Until the anchor provisioning channel ships,
boundary (b) protects the release pipeline's outputs, not a fielded device's
inputs.

## 4. Boundary (c): boot-chain authenticity — per board, and honest

**dm-verity is not secure boot.** When an earlier boot stage is untrusted, it
picks the kernel, the command line and the verity root hash, and §2's
integrity guarantee then attests a root filesystem *of the attacker's
choosing*. Boot-chain authenticity is the property that each stage verifies
the next before running it, anchored somewhere an attacker cannot rewrite —
and it is per-board, because the early stages belong to the SoC vendor.

Per board today:

- **cx3576 (RK3576)** — **[proposed]** beyond integrity. The mask ROM and the
  Rockchip loader stages in partition p1 are binary, vendor-supplied and
  opaque; U-Boot itself is built from pinned mainline source
  (`boards/cx3576/bsp/uboot/Dockerfile`), but `CONFIG_FIT_SIGNATURE` is
  configured nowhere in the tree (`docs/design/boards.md` §8), so U-Boot
  verifies nothing it boots, and nothing verifies U-Boot. The chain is:
  opaque ROM → opaque loader → unauthenticated U-Boot → unauthenticated
  kernel/dtb/cmdline → verity root. Every link left of the verity root is
  unverified.
- **x64 (generic UEFI)** — **[proposed]**. The firmware is the machine
  owner's; mos configures no UEFI Secure Boot signing, GRUB and the kernel
  are unsigned by mos, and whatever verification the platform performs is the
  platform's own claim, not this project's.

This is the deliberate posture, not an oversight: customer-selected boards
routinely ship binary-only early stages, and the project's position is
best-effort trusted boot with the evidence level stated per board rather than
a universal promise. No mos release material may describe any current board
as having secure boot; a claim above a board's evidenced ladder level (§5)
must fail release publication — that gate is **[implemented]**
(`checkBoardEvidence`, `build/src/release-manifest.ts`; rules in
`docs/design/release-artifacts.md` §4), with the policy stated in
`docs/design/security-lifecycle.md` §2.

**A guard built on a board-specific mechanism is a per-board claim, not a
system property.** This generalises beyond the boot chain and has decided two
designs already: a rollback guard keyed on the bootloader environment would
have read per-slot flags that x64's grubenv carries and cx3576's U-Boot
environment does not, and a physical-presence assertion keyed on a recovery
button would exist on cx3576 and nowhere on x64 (`docs/design/recovery.md`
§4.4, §8). Both were rejected for the same reason, and it is not
effort: a mechanism that is present on one board and absent on another
produces a protection that is strong where it was written and *silently*
absent everywhere else, while every gate stays green. That is worse than
having no guard at all, because a documented gap is visible to the operator
planning around it and a board-dependent one is not. Either the guard is
board-neutral, or the capability is declared per board and the flows that
depend on it refuse — visibly — where it is absent.

## 5. The I1–I4 boot-assurance ladder

Defined here, minimally, because no shipped document defines it and the board
qualification and release-publication work both need to cite it. Levels are
**additive** — each presumes the ones below — and are claimed **per board and
revision**, with dated evidence, never for "mos" as a whole:

- **I1 — verity-protected root.** The running root filesystem is dm-verity
  verified (§2), and A/B update, recovery and negative update tests pass on
  the board. Binary-only boot stages are acceptable at this level. This is
  the common target for every supported board.
- **I2 — authenticated normal system update.** The device verifies update
  authenticity end to end against production trust anchors (§3): RAUC CMS
  against a provisioned production keyring, TUF walk from a provisioned
  anchor, with negative tests (tampered bundle, rollback) on the board.
- **I3 — authenticated kernel, DTB and verity parameters.** The boot stage
  verifies a signed FIT (or the board's equivalent) covering kernel, DTB and
  the command line that carries the verity root hash, with a negative
  signature test on the board. Requires actual bootloader capability;
  binary-only U-Boot qualifies only if the capability is real and testable.
- **I4 — hardware-rooted boot plus production debug policy.** The chain is
  anchored in ROM/fused state the attacker cannot rewrite, and the board's
  production debug policy (`docs/design/manufacturing.md` §6–7) is applied
  and validated. Only at I4 does §1's possession axiom weaken.

Today: **cx3576 and x64 stand at I1** (with I1's own on-hardware evidence
rows owed to the board qualification record, not granted by this document);
I2 is blocked on trust-anchor provisioning; I3/I4 are board-specific best
effort and are **never promised universally**.

## 6. Boundary (d): data confidentiality at rest — **[proposed]**

**Nothing on a mos device is encrypted at rest today.** Stated as the current
limit, explicitly:

- STATE, DATA and META are plain ext4. Settings, the apid admin password
  hash, sshd host keys, authorized SSH keys, WiFi credentials, Bluetooth
  pairing keys and the two per-device plaintext secrets
  (`/var/lib/mos/secrets/`, `docs/design/provisioning.md` §3.4) are readable
  by anyone holding the medium.
- The confidentiality that does exist is against the *online* and
  *unprivileged local* attacker: hashes rather than plaintexts in the
  settings tree, 0600/0700 file modes asserted by tests, and the redaction
  rules of the management API.
- A reflash does not erase: blocks beyond the flashed extent remain on the
  medium, unreferenced (`docs/design/access.md` §9.2). Disposal or handover
  of a device requires wiping the medium.

This is consistent with §1's axiom rather than a contradiction of it.
At-rest encryption (and the key-storage story it requires) proceeds only
through its own approved plan; this document records the limit so no release
material overstates it.

## 7. Boundary (e): recovery and provisioning — **[partial]**

- **Recovery** — what exists is the board's SoC loader mode (cx3576:
  rockusb), a physical-access whole-disk reflash that replaces every
  partition including STATE/META/DATA (`docs/design/access.md` §9.2)
  **[implemented]**, and U-Boot's A/B attempt-counter fallback
  (`docs/design/uboot-ab-handshake.md`) **[implemented]**. The rescue FIT
  entry and factory reset are **[proposed]** (`docs/design/access.md` §2,
  §5.2). There is deliberately no software path back in for an operator who
  loses every credential (`docs/design/access.md` §9.1).
- **Provisioning** — first-boot self-provisioning mints per-device identity
  and secrets on the device, never in the image
  (`docs/design/provisioning.md` §2–3) **[implemented]**. Every offline
  provisioning channel (BOOT-partition file, signed USB drop, captive
  portal, serial wizard) is **[proposed]**; the only configuration path is
  apid over an existing network.

The threat statement for this boundary: recovery *is* the physical-access
capability of §1, so any future I4 board must redesign it deliberately —
closing rockusb-class access without a validated alternative recovery path
bricks the device class, which is why `docs/design/manufacturing.md` §7
requires board-specific validation before any irreversible policy is fused.

## 8. Boundary (f): rootful applications and containers — **[implemented]**, with stated limits

The container capability's own document says it plainly and this one must not
be softer: **containers on this device run as root**
(`docs/design/containers.md`). Rootless mode is not built; anything that can
write a `.container` file into the STATE-backed Quadlet directory runs code
with root's authority. Likewise `/usr/local/lib/systemd/system` is a
root-writable unit directory on STATE (`docs/design/ro-root.md` §4), so the
set of things that start at boot is not determined by the image hash.

The current containment is honesty, not isolation: the capability is off by
default (`container.enabled = false`), the writable surfaces are root-only —
so they grant nothing that root SSH did not already grant — and modification
is observable (mosd's diagnostic bus registry; the verity root itself stays
sealed). There is **no application sandboxing or managed-application
enforcement** today; a compromised or malicious rootful workload owns the
mutable half of the device. Application isolation proceeds only through its
own approved plan, and until it lands no release material may imply that
containers are confined.
