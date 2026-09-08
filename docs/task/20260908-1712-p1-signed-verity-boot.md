# 20260908-1712-p1-signed-verity-boot P1-A: signed verity, cx3576 signed FIT and UEFI shared-UKI entries

- **status**: completed
- **priority**: P1
- **owner**: l3/ew42ee3o
- **createdAt**: 2026-09-08 17:12
- **relatedPlan**: [20260908-1428-file-ab-signed-components](../plan/20260908-1428-file-ab-signed-components.md)

## Description

The boot and trust half of the plan's P1 feasibility gate. Five proofs, each
with the evidence the plan's implementation-sequence P1 row requires:

1. Signed verity on both kernel families (upstream stable and the cx3576
   vendor tree): valid signature accepted; absent, wrong-key and modified
   signatures rejected; an unsigned mapping rejected under
   `dm_verity.require_signatures=1`.
2. One reused kernel boots two different signed roots.
3. `veritysetup --root-hash-signature` over a read-only loop device with
   explicit geometry.
4. A cx3576 required-signature FIT prototype (kernel + DTB + initramfs) with
   control-FDT keys and no unsigned raw `booti` fallback on the normal path.
5. systemd-boot Type #1 entries with boot counting, two entries referencing one
   signed UKI, and `LoaderEntrySelected` reaching early init.

Acceptance: each proof reported with the target it was measured on, or a stated
failure with what it changes in the plan. Kernel config deltas asserted in the
shared floor or a board fragment and read back by the image contract. Dev keys
only, under `meta/`; nothing private in the branch.

## ActiveForm

P1-A proofs complete; the plan's boot/trust half is feasible as drafted.

## Dependencies

- **blocked by**: [20260908-1423-file-ab-signed-components](20260908-1423-file-ab-signed-components.md)
- **blocks**: (none)

## Notes

- P1-B (writable-path writer audit, random-seed path) is a sibling task and is
  not touched here.

### What changed in the tree

- `boards/common/mos-required.fragment` gains four lines: `BLK_DEV_LOOP=y`,
  `DM_VERITY_VERIFY_ROOTHASH_SIG=y`, `SYSTEM_TRUSTED_KEYRING=y` and the string
  `SYSTEM_TRUSTED_KEYS="certs/mos-verity-anchor.pem"`. On all three boards the
  resolved delta is exactly two lines: the other two were already `=y` by
  inheritance. `boards/x64/bsp/kernel/config/x64.config` and
  `boards/virt-arm64/bsp/kernel/config/virt-arm64.config` are re-recorded with
  those two lines and nothing else.
- Each board's kernel build takes the certificate through a new named build
  context `mos-trust` and asserts the string by name, the way it already
  asserts `CONFIG_LSM`: x64/virt-arm64 in `kernel/Dockerfile`, cx3576 in
  `kernel/configure.sh`. A missing or non-PEM context file fails before the
  compile rather than at `extract-cert` inside it.
- `pkgs/rauc/gen-dev-keys.sh` gains a third domain, `verity`, minting
  `meta/verity/signer.{key,cert}.pem` (rsa-2048, CA:FALSE +
  keyUsage=digitalSignature, the shape `certs/default_x509.genkey` uses in the
  kernel tree). `pkgs/rauc/key-algorithms.env` declares `MOS_KEY_ALG_VERITY`.
  The board Makefiles call it `--if-absent` before the kernel build.
- The image contract reads the delta back: `verify/src/checks-kernel.ts` adds
  the three `=y` symbols to `REQUIRED` and one new check,
  `kernel-verity-trust-anchor`, for the string the `=y` list cannot express.
  `tests/trust-domain-hygiene-test.sh` probes the new private key path.
- `boards/cx3576/bsp/uboot/build-mos.sh` asserts the FIT signature symbols the
  defconfig already provides, plus `LEGACY_IMAGE_FORMAT=y`, by name.

### Proof 1 -- signed verity on both kernel families

Measured starting point (all three built configs, before this change):
`DM_VERITY_VERIFY_ROOTHASH_SIG` not set, `SYSTEM_TRUSTED_KEYS=""`,
`BLK_DEV_LOOP=y`. After the change each kernel logs
`Loaded X.509 cert 'mos development verity content anchor: 0a1debd9...'`.

Driven from the failing side in QEMU against a real `rootfs-verity.img` built
by `rootfs/scripts/pack-verity.sh`, with `veritysetup open` given explicit
geometry (`--no-superblock`, `--hash-offset`, `--data-blocks`, salt, block
sizes) over a read-only loop device -- which is proof 3 as well.

| case | x64 6.12.107 (q35) | virt-arm64 6.12.107 (virt) | cx3576 6.1.115 vendor (virt) |
|---|---|---|---|
| valid signature | accepted, mounted | accepted, mounted | accepted, mounted |
| no signature | `-ENOKEY` | `-ENOKEY` | `-ENOKEY` |
| unrelated key | `-ENOKEY` | `-ENOKEY` | `-ENOKEY` |
| modified signature (1 bit) | `-EKEYREJECTED` | `-EKEYREJECTED` | `-EKEYREJECTED` |
| truncated signature | `-EBADMSG` | `-EBADMSG` | `-EBADMSG` |
| valid signature over another root's hash | `-EKEYREJECTED` | `-EKEYREJECTED` | `-EKEYREJECTED` |
| modified data block, valid signature | mapping created, that block reads `EIO` ("data block 9741 is corrupted"), an untouched block still reads | same | same |

The accepted mapping carries the signature in its table:
`... sha256 477acd64... 0000...0001 2 root_hash_sig_key_desc cryptsetup:va`.

The plan's warning holds and is measured: with
`dm_verity.require_signatures=0` the same kernels create the unsigned mapping
(`no-signature ACCEPTED rc=0`). The symbol is capability; the boot parameter is
policy, and the boot path has to carry it.

The vendor tree therefore handles the parameter exactly as the upstream one
does -- same acceptance, same five errno values -- which is what the plan asked
not to assume.

### Proof 2 -- one kernel, two signed roots

Two different real roots, each with its own hash and its own detached PKCS#7
signature by the same anchor: cx3576's `rootfs-verity.img` (root hash
`477acd64...`) and virt-arm64's (`86f63a29...`).

- Mapping level, all three kernels: both roots opened and mounted in one boot.
- Boot level, both arm64 kernels (upstream 6.12.107 and the cx3576 vendor
  6.1.115): the initramfs opens the signed mapping and `switch_root`s onto it,
  and the shell that then runs is out of that image --
  `/dev/mapper/vroot / squashfs ro`, hostname `mos`, `/bin/sh -> dash`. Run once
  per root per kernel; the kernel is byte-identical across the pair.
- On x64 this is reported at the mapping/mount level only: the two roots that
  exist in this tree are arm64, so a `switch_root` there could map and mount
  them but not execute from them.

### Proof 3 -- veritysetup path

Every open above is `veritysetup open <loop> <name> <loop> <hash>` with
`--root-hash-signature` and the full geometry, over `losetup --read-only`
(`read-only=1` asserted in the run). `cryptsetup-bin` 2:2.7.5-2 comes from the
snapshot `rootfs/debian/sources.env` already pins
(`20260905T000000Z`, trixie); nothing was added to the shipped package set.

### Proof 4 -- cx3576 signed FIT

Starting point, measured on the mos U-Boot build (upstream U-Boot
`ece349ade297`, `generic-rk3576_defconfig` chain): `FIT`, `FIT_SIGNATURE`,
`FIT_FULL_CHECK`, `IMAGE_SIGN_INFO`, `RSA`, `RSA_VERIFY`, `SPL_FIT_SIGNATURE`
and `SPL_RSA_VERIFY` are already `=y` although `build-mos.sh` enables none of
them -- the SPL loads `u-boot.itb` as a FIT. The four signature strings in the
shipped `u-boot-rockchip.bin` are that code's messages. What is missing is the
anchor: `u-boot.dtb` has no `/signature` node at all, so no key is required and
an unsigned FIT would boot.

Enforcement is proven in the U-Boot **sandbox** built from the same commit
(the board's own binary cannot be executed anywhere here -- there is no
silicon and QEMU has no rk3576 machine). One FIT over kernel + DTB + initramfs,
one `configurations` signature, the public key written into the control FDT
with `required = "conf"`:

| case | U-Boot |
|---|---|
| valid | `Verifying Hash Integrity ... sha256,rsa2048:mosdev+ OK` for the configuration and each image |
| unsigned FIT | `Failed to verify required signature 'key-mosdev'` -> `can't get kernel image!` |
| signed by an untrusted key | `sha256,rsa2048:other- error!` + the same required-signature refusal |
| modified kernel | `Bad hash value for 'hash-1' hash node in 'kernel' image node` -> refused |
| modified DTB | same on `fdt` -> `Could not find a valid device tree` |
| modified initramfs | same on `ramdisk` -> `Ramdisk image is corrupt or invalid` |

The board's own control FDT takes the key: `mkimage -K u-boot.dtb -r` over the
real cx3576 `u-boot.dtb` produces `/signature/key-mosdev` with
`required = conf`, `algo = sha256,rsa2048`, growing the DTB 173600 -> 175008
bytes.

**Not proven, and it is a scope statement rather than a failure**: the shipped
normal path still has an unsigned fallback. `boot.scr` is a legacy uImage
(`build/src/tools/mkimage.ts`: `mkimage -T script -C none`), so
`CONFIG_LEGACY_IMAGE_FORMAT=y` is load-bearing today and `booti` is what
`boot.cmd` runs. Removing the unsigned path means replacing `boot.scr` with a
signed FIT and repacking `u-boot-rockchip.bin` around a control FDT that
carries the key -- P6 work, not P1. Nothing here weakened it: the symbols are
now asserted by name so the capability cannot be dropped silently.

### Proof 5 -- UEFI shared-UKI Type #1 entries

systemd-boot and `ukify` 257.13-1~deb13u1 from the same snapshot (matched to
the shipped systemd 257.13). Development PK/KEK/db enrolled with `virt-fw-vars`
into a disposable variable store; `AAVMF_CODE.secboot.fd` / OVMF secboot code.
One signed UKI at `EFI/mos/kernels/k1.efi` -- outside `EFI/Linux`, with
`auto-entries no` -- and two Type #1 entries referencing it.

Measured on virt-arm64 (the plan's target) and on x64, identically:

- Secure Boot is on and enforcing: the stub prints `UEFI Secure Boot is
  enabled` and `SecureBoot=1` is read from efivarfs in early init.
- `LoaderEntrySelected` reaches early init and is the deployment hint:
  `mos-depA.conf` on boots 1-3, `mos-depB.conf` on boot 4.
- Boot counting is the loader's: the ESP entry is renamed
  `mos-depA+3.conf` -> `+2-1` -> `+1-2` -> `+0-3`, and with depA exhausted the
  next boot selects depB (`mos-depB+3.conf` -> `+2-1`) with nothing else
  changed. Two entries, one UKI, no re-signing.
- The suffix is normalized out of the identifier: the variable never reads
  `mos-depA+2-1.conf`.
- The entry's own `options mos.deployment=...` never reached `/proc/cmdline`:
  the guest saw exactly the UKI's embedded, signed command line. The plan's
  "do not depend on overriding an embedded UKI command line to select rootfs"
  is measured, not assumed -- the hint must come from `LoaderEntrySelected`.
- One bit flipped in the UKI on the ESP, same enrolled keys:
  `Error loading \EFI\mos\kernels\k1.efi: Access denied`, then
  `No bootable option or device was found`.

### What this cost, and what it did not

- Two lines of resolved config per board, and the kernel image now depends on
  the anchor certificate's bytes: two trees with different `meta/verity/`
  produce different kernels from identical source. The RFCT-343 byte-identical
  rebuild property holds within a tree and across a shared anchor.
- The image contract moves from 454 to 455 checks on cx3576, +1, and the one
  added check is `kernel-verity-trust-anchor`. The three `=y` symbols added to
  `REQUIRED` add no verdict: the floor check is one verdict over the whole
  list. `RESULT: PASS (455/455 checks, 3 skipped)` on
  `_out/cx3576/cx3576-mos-1788894465.img`, `RESULT: PASS (325/325 checks,
  26 skipped)` on `_out/virt-arm64/virt-arm64-mos-1788894890.img`, both built
  from this branch with the rebuilt kernels.
- Not measured, and stated rather than implied: the kernel's PKCS#7 verifier
  and certificate expiry/revocation (plan section 3 item 7) -- that needs a
  kernel built with an expired or revoked anchor, i.e. a second anchor in the
  build, which P2 can carry cheaply. ECDSA content signatures were not
  measured either; `MOS_KEY_ALG_VERITY=rsa-2048` is what the proofs used.
- cx3576 silicon is not here. Everything above for that board is its real
  kernel binary running under QEMU, which needs two things the board does not:
  a PL011 console (a test-only copy of the fragment; the board has an 8250) and
  `initcall_blacklist=rockchip_drm_init`, because that initcall makes a
  Rockchip SiP SMC QEMU does not implement and PID 1 takes an undefined-
  instruction Oops without it. Neither touches dm-verity, the keyring or
  PKCS#7. The FIT half for that board is sandbox and artefact evidence only.
