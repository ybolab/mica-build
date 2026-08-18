# RFCT-014 RAUC integration: system.conf, bundle build, dev signing keys

- **status**: implementation complete — pending U-Boot dependency and hardware acceptance
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: -

## Description

PLAN-010 M4 (= PLAN-006 A/B updates on systemd): make the device able to
describe its own slot layout to RAUC, and make the release side able to produce
a signed bundle for it. `rauc` and `libubootenv-tool` are already in the v2
rootfs (RFCT-013); this task adds the configuration they read and the bundle
they consume.

Scope / deliverables:

1. `os/rauc/system.conf.in` + `os/rauc/render-config.sh` — the RAUC slot model,
   rendered from `os/layout/cx3576-v2.env` into
   `os/rootfs/overlay-v2/etc/rauc/system.conf` (shipped at `/etc/rauc/system.conf`
   by RFCT-013's overlay mechanism). Two rootfs slots (`type=raw`,
   `bootname=A`/`B`) with the FAT32 boot slots as children (`parent=rootfs.N`),
   addressed by `/dev/disk/by-partuuid/<guid>`, status file on the STATE
   partition, `bundle-formats=verity`.
2. `os/rauc/gen-dev-keys.sh` — development CA + code-signing key/cert into the
   gitignored `os/rauc/.devkeys/`, idempotent, `--force` to replace, loud
   DEVELOPMENT ONLY banner.
3. `os/rauc/manifest.raucm.in` + `os/bundle.sh` — the signed
   `_out/cx3576/mos-cx3576-<epoch>.raucb` (+ `-latest` symlink) with the
   embedded `rauc info --output-format=json` validation, built in a container
   when the host has no `rauc`.

## Key decisions

### Boot payload is one image for two slots — and deliberately fail-safe

The bundle carries one image per *slot class*, but this layout's boot slots are
not interchangeable: `mos-verity.env` names that slot's own rootfs partition in
the dm-verity table. A single boot payload therefore cannot carry the
unsuffixed `mos-verity.env` that today's `boot.scr` loads.

The payload ships **both** `mos-verity-a.env` and `mos-verity-b.env` and no
unsuffixed file. The consequence is explicit: a slot installed from a bundle
has no `mos-verity.env`, so `boot.scr` takes its existing else-branch, zeroes
that slot's credits and rolls back cleanly. That is the correct failure mode —
the alternative (shipping the other slot's table) would build a dm-verity
device over the wrong partition. Making an updated slot actually bootable needs
a one-line change in `os/boot/cx3576-boot.cmd` (load
`mos-verity-${bootslot}.env`), which belongs to RFCT-018's boot contract; see
Escalations.

The payload's FAT volume label is the neutral `BOOT` rather than the
assembler's per-slot `BOOT-A`/`BOOT-B`, for the same reason: one image, two
possible destinations. Nothing reads the label — `boot.scr` addresses its slot
as `mmc 0:${bootpart}` and no fstab entry mounts a boot slot.

### `boot-attempts` is bounded by the layout file, not by taste

`boot-attempts` and `boot-attempts-primary` both come from
`BOOT_ATTEMPTS_DEFAULT` and are asserted against
`BOOT_ATTEMPTS_MIN`/`BOOT_ATTEMPTS_MAX` in `os/layout/cx3576-v2.env`. RAUC
writes `BOOT_x_LEFT` with `%x` and reads it base 16
(`rauc/src/bootloaders/uboot.c:213,152`); U-Boot's `setexpr` is hexadecimal
(`cmd/setexpr.c:119,439`) but `test -gt` parses decimal
(`cmd/test.c:168-173`). They agree only for single digits, so a later "let's
allow 16 attempts" edit would decrement correctly and compare wrongly, silently
disabling rollback. Both the renderer and `os/bundle.sh` fail the build instead.

### Adaptive / delta updates: DEFERRED

`adaptive=block-hash-index` (PLAN-006 Part G) is left as a commented line in
`os/rauc/manifest.raucm.in` and in both rootfs slot sections. Turning it on
costs a per-bundle block hash index and a streaming install path that nothing
on the device drives yet — mosd invokes `rauc install` on a local file. It
should be enabled together with the streaming updater so the bundle format and
the client that consumes it change in one step, not before.

### `/etc/fw_env.config`: RFCT-013's file kept, no competing copy

RFCT-013 shipped `os/rootfs/overlay-v2/etc/fw_env.config.in` as provisional and
marked it for RFCT-014 to replace. It is **kept as the single source**, and
this task deliberately creates no `os/rauc/fw_env.config.in`: it already has
RFCT-018's two-line redundant structure and `0x10000` size, and it addresses
the pair as `/dev/disk/by-partuuid/<guid>` at offset 0, which is better than
RFCT-018's `/dev/mmcblk0p1`/`p2` — the GUIDs are layout constants, the disk
node name is not. Instead of duplicating the file, `os/rauc/render-config.sh`
renders it the same way `os/rootfs/build-v2.sh` does and asserts the contract:

- exactly two device lines (this is what marks the environment redundant to
  libubootenv; configure only one side and every read from the other fails its
  CRC check);
- each line addresses the matching UENV partition GUID, case-insensitively,
  at offset 0 with size `UENV_SIZE_BYTES`;
- `UENV_{A,B}_OFFSET_BYTES` equals both the partition's start sector and its
  start MiB, so the partition-relative offset 0 provably denotes the same bytes
  as U-Boot's absolute `ENV_OFFSET`/`ENV_OFFSET_REDUND`.

The leftover "PROVISIONAL" paragraph in that file's header is now stale and
should be dropped by whoever next edits it; it was left alone here to avoid a
pointless cross-branch conflict over a comment.

**This file is INERT until the user applies RFCT-018's U-Boot change.** Today's
U-Boot has no persistent environment at `UENV_A_OFFSET_BYTES`, so
`fw_printenv`/`fw_setenv` have nothing valid to read and RAUC's `uboot` backend
cannot mark a slot good or bad. Nothing in this task works around that.

### The keyring is not shipped

`[keyring] path=/etc/rauc/keyring.pem` is configured, but no keyring file is
committed or installed: a development CA baked into a signed image would be a
trusted signer on every device. Until a keyring is provisioned, `rauc install`
fails closed on device. `os/rootfs/overlay-v2/etc/rauc/keyring.pem` is
gitignored so a developer can drop `os/rauc/.devkeys/ca.cert.pem` there for
local end-to-end testing without risking a commit.

### Signing determinism

CMS bundle signatures are **not** byte-reproducible: the signature carries a
`signingTime` attribute and RAUC salts the bundle's own verity hash tree at
random, so the bytes after the payload differ between two builds of the same
version. The signing key is RSA rather than an EC curve so that at least the
signature primitive is deterministic (ECDSA would add a random nonce for no
benefit). What is asserted instead is payload determinism: `os/bundle.sh`
prints the size and SHA-256 of the squashfs payload at the head of the bundle
on every build, and two builds of the same version from the same inputs print
the same digest.

### Toolchain notes

- rauc 1.8 (Debian bookworm) has no `--bundle-format` flag; the format is
  declared as `[bundle] format=verity` in the input manifest. `os/bundle.sh`
  asserts that line is present so a template edit cannot silently downgrade
  every release to the `plain` format `system.conf` refuses to install.
- The development signer certificate carries **no** `extendedKeyUsage`. RAUC
  verifies the CMS signature through OpenSSL's S/MIME-signing purpose check,
  which accepts a certificate with no EKU but rejects `codeSigning` without
  `emailProtection` ("unsuitable certificate purpose"). Constraining it
  properly needs `[keyring] check-purpose=`, which is a production-PKI
  decision.
- The rendered `system.conf` is committed under `overlay-v2/` rather than
  rendered during the image build, because the overlay renderer lives in
  `os/rootfs/build-v2.sh` (RFCT-013's file, not editable from this task).
  `bash os/rauc/render-config.sh --check` is run by `os/bundle.sh` and fails on
  drift. See Escalations for the follow-up that removes the committed copy.

## Work checklist

- [x] `system.conf` rendered from the layout constants, slot groups + keyring
- [x] `boot-attempts` bounded by `BOOT_ATTEMPTS_MIN`/`MAX`, with the radix
      rationale recorded in the file itself
- [x] `/etc/fw_env.config` reconciled to one file + contract assertions
- [x] Gitignored dev PKI generator, idempotent, `--force`, loud banner
- [x] `os/bundle.sh` with container fallback, version from argument/environment
- [x] `rauc info --output-format=json` validation wired into every bundle build
- [x] `.gitignore` covers key material; no key or certificate in `git ls-files`
- [x] Task record

## Escalations

1. **`os/boot/cx3576-boot.cmd` (RFCT-018/RFCT-012 territory, not edited here)**
   — a slot installed from a bundle is not bootable until `boot.scr` loads the
   per-slot verity env:

   ```
   if load mmc 0:${bootpart} ${verityaddr} mos-verity-${bootslot}.env; then
   ```

   with the existing unsuffixed name kept as a fallback for slots written by
   the image assembler. Until then an installed slot rolls back cleanly instead
   of booting.

2. **`os/rootfs/build-v2.sh` (RFCT-013's file)** — add
   `os/rootfs/overlay-v2/etc/rauc/system.conf` to the rendered set (or call
   `bash os/rauc/render-config.sh` before staging the overlay) so the rendered
   file no longer needs to be committed.

## Acceptance

- `make os-devkeys` then `make os-bundle-cx3576` produces a signed verity
  bundle whose embedded `rauc info` validation passes with the shipped
  `system.conf` loaded.
- Two bundle builds of the same version print the same payload digest.
- No key, certificate, `.pem`, `.der`, `.key` or `.p12` in `git ls-files`.
- v1 (`make os-image-cx3576` + `make os-verify-cx3576`) unaffected; v2 image
  still assembles.
- On-device `rauc status` / `rauc install` is **not** claimed: it depends on the
  U-Boot environment change (RFCT-018) and on a provisioned keyring, and is the
  user's hardware acceptance.

## Verification (2026-08-18)

Inputs: prebuilt BSP artifacts (`BOARD_DIR=/srv/ai/mos/board/cx3576`), rauc 1.8
from Debian bookworm in the container the scripts launch.

- `make os-image-cx3576` + `make os-verify-cx3576` (v1 regression) —
  `RESULT: PASS (71/71 checks)`, unchanged by this task.
- `make os-rootfs-cx3576-v2` — `rootfs-verity.img` 55574528 bytes (53 MiB),
  verity root hash `bef4c602f7324c9347bc91439271497304b9e7d3961b87398994f0e66d5495d5`.
- `make os-devkeys` — writes the four files into `os/rauc/.devkeys/`; a second
  run is a no-op with the key byte-identical; `--force` replaces it.
- `make os-bundle-cx3576` — 72497462-byte verity bundle, signature verified
  inline against the dev CA, `rauc info` reporting both slot images:

  ```json
  {"compatible":"mos-cx3576","version":"0.0.0-dev","description":"mos A/B update bundle for mos-cx3576","build":null,"hooks":[],"images":[{"rootfs":{"variant":null,"filename":"rootfs.img","checksum":"fd1fb729a12ab6790f5bc407124c322d34128be131e47a2d93dcd7e701eef428","size":55574528,"hooks":[],"adaptive":[]}},{"boot":{"variant":null,"filename":"boot.vfat","checksum":"d80cb06bfc47e2c18ddd07c4b99eb40c03d484e5b919cad9c74f94de595e2612","size":67108864,"hooks":[],"adaptive":[]}}]}
  ```

- Determinism: two builds of version `0.0.0-dev` from identical inputs both
  report `payload: 71917568 bytes, sha256 e45b5cde4719a923e98f5b4e921bd41b28d09f25b4d3d72b4764435b02d30969`.
  The full files differ, and `cmp` puts the first differing byte at 71917569 —
  exactly payload+1, i.e. every non-reproducible byte is in the verity hash
  tree and the CMS signature, none in the payload.
- `make os-image-cx3576-v2` — assembles, `sgdisk --verify`: `No problems found`.
  `unsquashfs -l` on the packed root shows `/etc/rauc/system.conf`,
  `/etc/fw_env.config`, `/usr/bin/rauc` and `/usr/bin/fw_{printenv,setenv}`.
- Guard rails exercised by tampering with a scratch copy: `BOOT_ATTEMPTS_DEFAULT=16`,
  a one-line `fw_env.config`, a `UENV_B_OFFSET_BYTES` that no longer matches the
  partition start, and a hand-edited `system.conf` are each rejected with the
  reason.
- `git ls-files` contains no `.pem`, `.der`, `.key`, `.p12`, certificate or key
  of any kind; `os/rauc/.devkeys/` is gitignored.
- On-device `rauc status` / `rauc install` is NOT verified and not claimed —
  see the U-Boot dependency above.

## ActiveForm

Wiring RAUC configuration and signed bundle production for the cx3576 A/B layout.

## Dependencies

- **blocked by**: RFCT-012 (layout v2 + assembler), RFCT-013 (v2 rootfs with
  rauc/libubootenv), RFCT-018 (U-Boot A/B handshake contract)
- **blocks**: RFCT-015 (mosd updater invoking `rauc install`)
