# Key delivery

Mica OS uses three independent signing domains. Development inputs are explicit;
private signing material never belongs in a root filesystem, kernel archive,
container image layer, firmware package, deployment archive or release directory.

| Domain | Private holder | Public delivery | Enforcement |
|---|---|---|---|
| Boot | Kernel/FIT/EFI signing host | Disposable UEFI db or U-Boot control FDT | Firmware authenticates the UKI/FIT |
| Content | Root and support signing host | Built into each accepting kernel | Kernel authenticates PKCS#7 root hashes before dm-verity mappings |
| Metadata | Deployment/catalog/firmware publisher | Embedded in authenticated kernel policy | `mos-init` and `mos-deploy` authenticate strict Ed25519 envelopes |

The content certificate is a trust anchor, not a confidentiality mechanism.
Public certificates and Ed25519 public keys may be distributed to builders.
Private keys are passed only to the command that signs that artifact. The root
composer receives public factory defaults through `MOS_META_DIR`; it receives
no metadata trust override. The update server receives an explicit metadata
signing key and optional overlap public keys.

## Development material

Run `make os-keys-init` to create or validate the ignored local `meta/` directory.
The initializer preserves valid existing identities and refuses partial or
mismatched inputs. `MOS_SIGNING_OUTPUT` overrides the directory. Key generation
and verification run in the pinned OpenSSL container, not the host toolchain.

```sh
bash pkgs/mos-boot/dev-keys.sh --out /path/to/new-development-inputs
```

The directory must not exist. The generator creates separate RSA boot/content
keys, an Ed25519 metadata key, public counterparts and a `GENERATED` marker.
Private files are mode 0600. The marker records development grade; generating
keys does not enroll a physical platform or establish a hardware root of trust.
There is no conversion of an existing key directory or configuration.

The output includes public update defaults. A distributed root-build directory
contains only `updates/manifest.json` and the public marker; signing subdirectories
stay on their owners' signing hosts. Kernel build contexts receive public
content certificates only. Component signing commands require explicit key and
certificate paths; no missing-key fallback creates a signer.

## Handover and replacement

Identify the domain, artifact, public-key fingerprint, board and generation in
the handover. Verify the received public key out of band before trusting it.
Keep recovery signing inputs and signed retained artifacts available to the
operator performing offline firmware maintenance.

Rotate by introducing an accepting overlap kernel/firmware, proving old and new
acceptance, publishing newly signed components, then removing the old anchor
while preserving a usable retained deployment. Content certificate validity
windows and runtime revocation do not withdraw a compiled trust anchor; measured
kernel behavior and the replacement-kernel procedure are documented in
[release signing](release-signing.md).

Physical ROM/SPL authentication and irreversible platform enrollment are outside
the current development acceptance. QEMU key enrollment is disposable evidence;
it does not establish cx3576 fuse provisioning.
