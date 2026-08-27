# RFCT-014 RAUC integration: system.conf, bundle build, dev signing keys

- **status**: completed — implementation complete, pending hardware acceptance
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

### Slot status goes on META, never on /var

`statusfile=/mnt/meta/rauc.status`. /var is DISCARDABLE by user decision — a
small fixed-size partition whose contract is that wiping it costs nothing,
with disk growth moved to a DATA partition at /srv. RAUC's status file is
update state (which slot was installed, at what version, whether it has been
marked good), and losing that mid-update is exactly the failure the A/B design
exists to prevent. The standing rule: identity, credentials, pairings and
update state never live on /var.

META over STATE, both of which satisfy that rule: META is the partition for
update metadata, while STATE holds machine identity and configuration (ssh host
keys, hostname, `/var/lib/mos`). Keeping update bookkeeping out of STATE leaves
a factory reset of identity separable from a reset of update history and keeps
each partition's writer set small. Nothing boot-critical rides on the choice
either way — the authority for which slot boots is `BOOT_ORDER` in the
redundant U-Boot environment, not this file, so a lost status file costs
history, not a boot.

The mount point is not hardcoded: `render-config.sh` reads it out of
`overlay-v2/etc/fstab.in` by matching the META partition GUID, and refuses
outright if that mount point is ever under /var. If RFCT-013's mount rework
moves META, the status file follows it.

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
marked it for RFCT-014 to replace. It is **kept as the single source and
adopted**: its header now records RFCT-014 as owner and states that no
`os/rauc/fw_env.config.in` exists to drift from it. Keeping RFCT-013's file
rather than moving it is what avoids two copies — it is rendered by
`os/rootfs/build-v2.sh` in the same pass as the rest of the overlay, and it
already had RFCT-018's two-line redundant structure and `0x10000` size while
addressing the pair as `/dev/disk/by-partuuid/<guid>` at offset 0, which is
better than RFCT-018's `/dev/mmcblk0p1`/`p2` — the GUIDs are layout constants,
the disk node name is not. `os/rauc/render-config.sh` renders it the same way
`os/rootfs/build-v2.sh` does and asserts the contract:

- exactly two device lines (this is what marks the environment redundant to
  libubootenv; configure only one side and every read from the other fails its
  CRC check);
- each line addresses the matching UENV partition GUID, case-insensitively,
  at offset 0 with size `UENV_SIZE_BYTES`;
- `UENV_{A,B}_OFFSET_BYTES` equals both the partition's start sector and its
  start MiB, so the partition-relative offset 0 provably denotes the same bytes
  as U-Boot's absolute `ENV_OFFSET`/`ENV_OFFSET_REDUND`.

The environment these lines address is **live on a v2 device**. The image
carries the `uboot-mos` variant (`UBOOT_VARIANT_DIR`), which provides the
redundant pair at `UENV_A/B_OFFSET_BYTES`, `setexpr`, and a bootmeth order
pinned to script; `os/mkimage-v2.sh` refuses to assemble a v2 image around the
debug variant (`CONFIG_ENV_IS_NOWHERE`, pairs with v1). Escalation items 1-3 of
`docs/design/uboot-ab-handshake.md` section 10 are resolved on main by 8b24f9d,
so `fw_printenv`/`fw_setenv` have a real environment to read and RAUC's `uboot`
backend can mark a slot good or bad.

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
- [x] Status file on META, off /var, with a renderer guard against /var
- [x] `/etc/fw_env.config` reconciled to one owned file + contract assertions
- [x] Gitignored dev PKI generator, idempotent, `--force`, loud banner
- [x] `os/bundle.sh` with container fallback, version from argument/environment
- [x] `rauc info --output-format=json` validation wired into every bundle build
- [x] `.gitignore` covers key material; no key or certificate in `git ls-files`
- [x] Task record

## Escalations

1. **`os/boot/cx3576-boot.cmd` (RFCT-018/RFCT-020 territory, not edited here)**
   — IN PROGRESS with RFCT-020. A slot installed from a bundle is not bootable
   until `boot.scr` loads the per-slot verity env:

   ```
   if load mmc 0:${bootpart} ${verityaddr} mos-verity-${bootslot}.env; then
   ```

   RFCT-020 is making that change and having the assembler emit the per-slot
   names too, so a factory slot and an installed slot end up with identical
   layout — better than the fallback-on-the-unsuffixed-name shape proposed
   here. Until it lands, an installed slot rolls back cleanly instead of
   booting. Mark this resolved once it does.

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
- On-device `rauc status` / `rauc install` is **not** claimed: it needs a
  provisioned keyring and the per-slot verity env of Escalation 1, and it is
  the user's hardware acceptance.

## Verification (2026-08-18)

Run on the task branch with `bkd/n98jlna1` (421e73c) merged in, against prebuilt
BSP artifacts (`BOARD_DIR=/srv/ai/mos/board/cx3576`, which carries both U-Boot
variants). rauc 1.8 from Debian bookworm, in the container the scripts launch.

- `make os-image-cx3576` + `make os-verify-cx3576` (v1 regression) —
  `RESULT: PASS (88/88 checks)`, the current baseline, unchanged by this task.
- `make os-image-cx3576-v2` — rootfs 53 MiB (installed size 216 MB of the 400 MB
  budget), verity root hash
  `403306acf78415ee228d741575323a4ea70909cc328fcf73cdb3dbe9e6b006ba`, image
  803 MiB, `sgdisk --verify`: `No problems found`.
- `unsquashfs -cat` on the packed root confirms what ships:
  `statusfile=/mnt/meta/rauc.status`, `compatible=mos-cx3576`, `bootname=A`/`B`,
  `boot-attempts=3`/`boot-attempts-primary=3`, and an `/etc/fw_env.config`
  headed `OWNER: RFCT-014` whose two payload lines are
  `/dev/disk/by-partuuid/5ac35760-0002-4000-8000-00000000000{1,2}  0x0  0x10000`.
- `make os-devkeys` — writes the four files into `os/rauc/.devkeys/`; a second
  run is a no-op with the key byte-identical; `--force` replaces it.
- `make os-bundle-cx3576` — 72501558-byte verity bundle, signature verified
  inline against the dev CA, `rauc info` run with the shipped `system.conf`
  loaded (`rauc --conf=...`, which is also the only build-time parse of that
  file) reporting both slot images:

  ```json
  {"compatible":"mos-cx3576","version":"0.0.0-dev","description":"mos A/B update bundle for mos-cx3576","build":null,"hooks":[],"images":[{"rootfs":{"variant":null,"filename":"rootfs.img","checksum":"1176677020a79fb0538a1b383bf5aae4388485839931746e7a4c5db13aa5214b","size":55574528,"hooks":[],"adaptive":[]}},{"boot":{"variant":null,"filename":"boot.vfat","checksum":"a2c18234002be6a01213a41214fcb2e5c7f2262fb6a742c45798bceac8980243","size":67108864,"hooks":[],"adaptive":[]}}]}
  ```

- Determinism: two builds of version `0.0.0-dev` from identical inputs both
  report `payload: 71921664 bytes, sha256 eb566df2f37e5f72910eed4881f0c0532f0707e3911df442e83bd029604df25c`.
  In the pre-merge run, where the same comparison was made on the whole files,
  `cmp` put the first differing byte at payload+1 — every non-reproducible byte
  is in the verity hash tree and the CMS signature, none in the payload.
- Guard rails exercised by tampering with a scratch copy: `BOOT_ATTEMPTS_DEFAULT=16`,
  a one-line `fw_env.config`, a `UENV_B_OFFSET_BYTES` that no longer matches the
  partition start, a hand-edited `system.conf`, and an fstab that mounts META
  somewhere under `/var` are each rejected with the reason.
- `git ls-files` contains no `.pem`, `.der`, `.key`, `.p12`, certificate or key
  of any kind; `os/rauc/.devkeys/` is gitignored.
- `make os-verify-cx3576-v2` not run: `os/verify-image-v2.sh` (RFCT-017) has not
  landed yet.
- On-device `rauc status` / `rauc install` is NOT verified and not claimed — it
  needs a provisioned keyring and Escalation 1.

## ActiveForm

Wiring RAUC configuration and signed bundle production for the cx3576 A/B layout.

## Dependencies

- **blocked by**: RFCT-020 (layout v2 + assembler), RFCT-013 (v2 rootfs with
  rauc/libubootenv, and the mount layout the status file location follows),
  RFCT-018 (U-Boot A/B handshake contract — satisfied by the `uboot-mos`
  variant, main 8b24f9d)
- **blocks**: RFCT-015 (mosd updater invoking `rauc install`)
