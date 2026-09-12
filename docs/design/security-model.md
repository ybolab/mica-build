# Design: Security Model — Threat and Physical-Access Boundaries

> What Mica OS defends, against whom, per boundary — stated separately for runtime
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

## 1. Physical-access boundary

Current qualification uses development images and explicit test keys. No
hardware-rooted boot, fused key state or closed debug policy is claimed. A person
with storage access can read or destroy unencrypted DATA and use available
reflash/recovery transports. UEFI/FIT signatures still reject unauthorized boot
objects when their enforcing boot stage and enrolled anchors remain trusted;
those software checks do not authenticate an unqualified first mutable stage.

Offline provisioning is authorized by physical possession of its medium and is
bounded by the already-claimed device policy. It is distinct from a signed OS
update. Each physical board must record recovery and debug exposure explicitly.

## 2. Boundary (a): runtime content integrity — **[implemented]**

Authenticated native init verifies the selected deployment, board/kernel
association and geometry. The kernel requires detached root-hash signatures
under embedded content anchors before creating read-only dm-verity mappings for
root and support. Blocks are verified on demand; a corrupted unread block is
detected on access. There is no compulsory complete-image hash scan at boot.

Support owns matching modules and board firmware and is mounted before udev.
Root owns userspace and an immutable `/var` skeleton. Selected persistent leaves
bind DATA namespaces; volatile paths have explicit memory or disposable quotas.
No unverified writable module directory or whole-tree writable `/var` is used.

This protects verified content under the authenticated running kernel. It does
not encrypt DATA or confine a deliberately privileged administrator. See
[read-only root](ro-root.md) and [writable storage](storage.md).

## 3. Boundary (b): update authenticity — **[implemented]**

Three separate signing domains authenticate boot executables, immutable content
and release metadata. Native installation verifies strict signed deployments and
exact object lengths/digests before durable publication. Catalog expiry and
monotonic acquisition policy apply to downloading new releases. An installed
valid deployment remains bootable offline after catalog expiry or without
network time.

Installation, confirmation, GC and reset share a DATA transaction lock. Current,
fallback and staged references protect their immutable objects; failed/partial
publication cannot expose an incomplete candidate. A staged release has unchanged
persistent schemas. Rollback switches component references and does not restore
DATA writes. Hardware monotonic counters and physical-media replay protection
are not claimed.

Development key creation is explicit and requires a new output directory.
Private inputs are external to images; metadata anchors come from authenticated
kernel policy, not editable userspace defaults. The system-info marker reports
development provenance, not measured firmware enforcement. See
[release signing](release-signing.md) and [updates](updates.md).

## 4. Boundary (c): boot-chain authenticity — board-specific evidence

On x64 and virt-arm64, the signed systemd-boot manager chooses counted entries
and firmware authenticates UKIs under enrolled Secure Boot anchors. Failure to
persist an attempt refuses launch. On cx3576, fixed C firmware policy requires
signed FIT configurations, disables persistent command import, arms its watchdog
before eMMC access and flushes/read-backs the attempt update before FIT loading.

The health gate alone confirms a deployment. Three failed trials exhaust without
refill. Unusable shared storage and exhausted deployments reach explicit recovery
outcomes. Kernel panic uses a restart policy; hangs require independently proven
watchdog coverage. QEMU and sandbox results cannot establish physical eMMC
power-loss behavior or a board's full firmware-to-health watchdog handoff.

Boot-key, content-key and metadata-key overlap/removal are separate operations.
Firmware maintenance is an authenticated offline workflow with a recovery artifact
and readback. Ordinary root/kernel updates do not write loader firmware. No OTP
or fuse change is part of current acceptance. Per-board evidence and limitations are in
[support tiers](../boards/support-tiers.md#current-boards).

## 5. The I1–I4 boot-assurance ladder

These additive qualification levels are recorded per board/revision with dated
physical evidence. Mechanism-level software proofs are listed separately:

- **I1:** verified read-only content, update/fallback and recovery evidence.
- **I2:** authenticated normal deployment acquisition/installation with the
  intended trust inputs and meaningful negative cases.
- **I3:** authenticated kernel, DTB/initramfs and boot policy under an enforcing
  boot stage, with board-specific substitution/signature refusal evidence.
- **I4:** hardware-authenticated first mutable stages and a validated debug and
  recovery policy that preserves that chain.

The current code implements the I1–I3 mechanisms and tests them in development
QEMU/sandbox environments. Board evidence remains conservative; physical cx3576
qualification is pending. No I4 claim is made. The [BSP assurance page](../boards/assurance.md)
applies this distinction to dossiers and release wording.

## 6. Boundary (d): data confidentiality at rest — **[proposed]**

**Nothing on a Mica OS device is encrypted at rest today.** Stated as the current
limit, explicitly:

- DATA and its state/meta namespaces are plain ext4. Settings, the apid admin password
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

Native trial fallback and guarded manual rollback restore a retained component
association. Directory-scoped reset preserves identity, credentials and lifecycle
records according to the selected tier, under the shared transaction lock. A
complete-image reflash replaces the system and DATA, including identity.

Offline provisioning stages a fixed document from the UEFI ESP or removable
media read-only. cx3576 has raw FIRMWARE and uses removable media. mosd validates
the entire document and the already-claimed policy before applying it. It leaves
credential-bearing media unchanged. This transport does not authenticate a
signature and must not be confused with the signed deployment importer.

Current boards declare no OS physical-presence recovery action. cx3576's loader
button opens rockusb; it does not authorize credential recovery through apid.
Those presence-gated requests remain refused. Captive/serial provisioning wizards
and a device secure-erase primitive are not implemented. See
[provisioning](provisioning.md) and [recovery](recovery.md).

## 8. Boundary (f): rootful applications and containers — **[implemented]**, with stated limits

The container capability's own document says it plainly and this one must not
be softer: **containers on this device run as root**
(`docs/design/containers.md`). Rootless mode is not built; anything that can
write a `.container` file into the DATA-backed Quadlet directory runs code
with root's authority. Likewise `/usr/local/lib/systemd/system` is a
root-writable unit directory on DATA (`docs/design/ro-root.md` §4), so the
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
