# Signed component trust and rotation

The current contract authenticates three independent surfaces. An authenticated
bootloader accepts the UKI/FIT; that kernel carries content and metadata anchors;
`mos-init` authenticates deployment metadata and opens signed root/support
mappings. No earlier update format or mutable command-line trust input is read.

## Artifacts and signing owners

| Artifact | Signed binding | Consumer |
|---|---|---|
| UKI/FIT | Kernel, initramfs, fixed policy, and DTB where applicable | UEFI or the required-signature U-Boot control FDT |
| Root/support image | PKCS#7 signature over the root hash; signed metadata binds full geometry, hash, length and signature bytes | Kernel dm-verity and native metadata verifier |
| Deployment | `mos/deployment/v1`, board/arch/generation/version and complete kernel/root identities | Factory assembler, early init and installer |
| Catalog | `mos/catalog/v1`, revision, validity interval and deployment associations | Acquisition client |
| Firmware | `mos/firmware/v1`, board/arch/generation/artifact and fixed write destination | Separate firmware publisher, offline maintainer and native readback |

The Ed25519 envelope format is shared by Rust and Bun. Parsing rejects unknown
fields, ambiguous/noncanonical content, mismatched component IDs, unexpected
paths and invalid bounds. Offline `MOSUPD01` archives reuse the deployment
signature and carry only bounded digest/length-addressed objects.

Metadata trust resides in authenticated kernel policy. Public factory update
settings select a source/channel and policy; they cannot replace anchors.
Installed boot does not depend on downloading an unexpired catalog. Catalog
freshness and monotonic revision checks apply when acquiring a new release.

## Content verification

The kernel requires a signed root hash for both root and support mappings. The
support image owns modules for exactly its kernel release, firmware and the
wireless regulatory database where required. Root owns userspace and empty
support mountpoints. The early loader verifies selected descriptor associations
before binding support and starting systemd.

Signature verification authenticates the verity root, and subsequent reads are
verified per block. It does not pre-read every image block at boot. Installation
and offline verification additionally hash complete artifacts against signed
length/digest declarations. Latent corruption is detected when the affected
block is read; no claim is made that an unread block was checked during boot.

Measured kernel integration accepts the compiled content certificate outside
its X.509 validity window and refuses root's attempt to revoke the built-in
anchor. Time expiry and runtime revocation are therefore not withdrawal
procedures. Replace the accepting kernel to remove a content key.

## Rotation

1. Introduce boot/content/metadata overlap in the relevant accepting artifact.
2. Verify intended old and new signatures, including a retained bootable record.
3. Publish new components and observe boot and health confirmation.
4. Remove the old anchor in a subsequent accepting artifact and verify refusal
   of its signatures with a working fallback.

The update server authenticates its persisted catalog and published deployment
and firmware manifests at startup. It refuses metadata-key removal while
published artifacts still depend on that key. Withdrawal and a newly signed
catalog precede removal.

Firmware publication is separate from the normal OS catalog. Offline EFI
maintenance saves the authenticated previous loader outside the ESP, writes and
syncs the replacement and verifies readback. RockUSB maintenance saves and
compares the entire reserved partition, writes only the fixed loader range and
never resets the device. Neither OS root nor kernel installation writes loader
bytes or enrolls platform keys.

## Evidence limits

Actual QEMU Secure Boot proves UKI enforcement, EFI loader replacement,
restoration and key removal. Production U-Boot control FDT extraction and FIT
signature tests prove its configured signer policy. Native readback and IO
fault tests cover software transactions. Board dossiers record per-board results
([support tiers](../boards/support-tiers.md#current-boards)). Physical cx3576 ROM/SPL trust, watchdog
handoff, USB maintenance and storage power-cut durability remain separate bench
acceptance gates. Development keys are explicitly development grade.
