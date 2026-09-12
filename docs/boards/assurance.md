# Boot assurance and qualification

The I1–I4 ladder in [the security model](../design/security-model.md) separates
content integrity, authenticated updates, authenticated boot executables and
hardware-rooted boot. A board's dossier records the actual evidence and its
limits. A software mechanism and a qualified physical device are separate facts.

## I1 — verified content reads

Root and kernel support are read-only SquashFS images under dm-verity. The kernel
checks detached root-hash signatures using embedded content anchors, then checks
blocks on demand. Corrupt unread content is detected when accessed; boot does not
scan the complete root image. Native init authenticates the selected deployment
and geometry before creating the mappings.

> status: shipped — evidence: `pkgs/mos-deploy/src/bin/mos-init.rs`, `tests/signed-boot-lab/init-matrix.sh`

## I2 — authenticated normal updates

Native installation authenticates release metadata and component bytes before
publishing immutable files and the boot-visible candidate. Acquisition verifies
the signed catalog, expiry, board and replay policy, with bounded download/import.
Current and retained fallback objects remain protected during staging and GC.
No loader firmware is installed through the ordinary OS update action.

> status: shipped — evidence: `pkgs/mos-deploy/src/deployments.rs`, `pkgs/mos-deploy/src/acquisition.rs`, `tests/file-ab-faults/run.sh`

## I3 — authenticated boot executables and policy

UEFI verifies the signed boot manager and UKI under the enrolled anchor. cx3576
Mica OS U-Boot requires signed FIT configurations covering kernel, device tree and
initramfs. Signed policy pins metadata keys, content identity and storage
selection. Command-line substitutions and unsigned retry paths are refused.
Boot, content and metadata are three independent signing domains.

UEFI enforcement is exercised with disposable OVMF/AAVMF enrollment. cx3576 FIT
signature and native policy tests run against its built firmware. These software
results do not establish enforcement on an untested physical board.

> status: board-dependent — evidence: `tests/file-ab-fit/signatures.sh`, `tests/signed-boot-lab/uefi-uki.sh`, `docs/design/release-signing.md`

## I4 — hardware root and debug policy

No OTP/fuse programming or hardware-rooted qualification is claimed. Vendor
loader stages, platform firmware, JTAG and recovery transports must be identified
and qualified for a named physical board before that claim can be made.

> status: unsupported

## Recording a claim

A dossier names the board revision, exact firmware/kernel/root identities,
trusted public-key set and evidence. Development keys and disposable enrollment
remain labelled as such. A physical cx3576 result requires its actual storage,
serial trace, watchdog/reset cause and power-cut observations. Sandbox execution
and process-kill tests cannot be relabelled as eMMC power-loss results.

Use the [board template](board-template.md), the [qualification matrix](qualification.md)
and the [current board status](support-tiers.md#current-boards).

> status: shipped — evidence: `docs/boards/board-template.md`, `tools/docs/verify-board.sh`
