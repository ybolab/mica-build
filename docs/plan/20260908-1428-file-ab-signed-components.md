# 20260908-1428-file-ab-signed-components File-based A/B and independently signed system components

- **status**: implementing
- **createdAt**: 2026-09-08 14:28
- **approvedAt**: 2026-09-08 17:11
- **relatedTask**: [20260908-1423-file-ab-signed-components](../task/20260908-1423-file-ab-signed-components.md)

## Context

The user requests a complete design before implementation, with these requirements:

1. Development images do not need backward compatibility, an old-layout migration, or old update-package support.
2. Store redundant rootfs images as files in one filesystem instead of separate raw partitions.
3. Build, publish, and update boot firmware, kernel packages, and rootfs independently.
4. Authenticate rootfs through a public key trusted by the kernel.
5. Keep the implementation small while retaining update interruption recovery and automatic fallback.
6. Consolidate persistent state, update metadata, required disk-backed writable paths, and application/user data into one DATA filesystem, using directory mappings instead of separate writable partitions.
7. Keep `/var` itself on the read-only rootfs. Expose only explicitly required writable subdirectories or file paths; do not mount, overlay, or make the whole `/var` tree writable.

This is a full-tier implementation plan, approved on 2026-09-08 at 17:11.
P1 and P2 are complete. P3-P9 are implemented with the software evidence below;
P10 remains open for physical cx3576 acceptance; software measurement and cleanup pass.
The dated investigation describes the starting point, not the current system.

### Investigation snapshot (2026-09-08, before implementation)

| Area | Observed implementation | Consequence |
|---|---|---|
| Image layout | cx3576 has 11 partitions; x64 and virt-arm64 have 9, declared in `boards/*/board.env` | Four partitions implement each board's boot/rootfs pair |
| Root image | `rootfs/scripts/pack-verity.sh` appends a verity tree to SquashFS in `rootfs-verity.img` | The existing image format can be backed by a regular file and a loop device |
| Early boot | `boards/cx3576/boot.cmd` and `boards/{x64,virt-arm64}/grub.cfg` use `dm-mod.create=` on raw PARTUUIDs | A file-backed root needs early userspace to mount the containing filesystem and establish loop devices |
| Root authentication | All three available `_out/boards/<board>/kernel/config` files disable `CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG` and set `CONFIG_SYSTEM_TRUSTED_KEYS=""` | This public-key verification chain is not currently enabled |
| Kernel modules | Board packages install modules into `/usr/lib/modules` inside rootfs | Merely separating the kernel executable would leave kernel updates coupled to rootfs |
| Update payload | `build/src/bundle.ts` requires `rootfs.img` and `boot.vfat`; `pkgs/rauc/render-config.sh` parents boot slots to rootfs slots | The current installer models partition groups, not reusable component files |
| Boot firmware | U-Boot is outside the ordinary RAUC bundle | Its independent update and recovery mechanism must remain separate |
| Update service | `update-server` stores one `.raucb` artifact per release and signs metadata with Ed25519 | Component references, acquisition, publication, and UI need an explicit new contract |
| Device client | `pkgs/rauc-sign` still includes the TUF acquisition path; `mosd` calls RAUC through D-Bus | The server/client protocol mismatch must be resolved in the new acquisition path |
| Health | `rootfs/overlay/usr/lib/mos/mos-health` confirms through `rauc status mark-good` | Confirmation must be redirected to a deployment-aware boot backend |
| Writable directories | `/mos` and `/srv` already bind DATA subdirectories; `/var` is a separate filesystem and persistent subdirectories are bound over it from STATE | Consolidate backing storage into DATA and replace the writable `/var` supertree with selected writable leaves |

The generated kernel configs are local build evidence, not proof that a particular physical device runs those exact binaries. The signing feature must be asserted against both tracked configuration and newly built artifacts.

Related live work includes PLAN-086 runtime composition and PLAN-077/RFCT-305 trust provisioning. At implementation time, reconcile ownership and the latest merged state before editing their shared files. This proposal does not rewrite those records or claim their work.

## Proposal

### 1. Decisions

| Decision | Selected design |
|---|---|
| Root storage | Immutable SquashFS + verity files on a dedicated ext4 SYSTEM filesystem |
| Redundancy | Two retained deployments referencing immutable components; one staged/trial candidate may temporarily require a third generation |
| Update unit | Boot firmware, kernel package, and rootfs are separate artifacts; a release specifies an exact tested kernel/rootfs combination |
| Root trust | Kernel verifies a detached PKCS#7 signature over the verity root hash using an embedded X.509 trust anchor |
| Runtime integrity | dm-verity continues checking blocks on demand; no whole-rootfs scan is added to every boot |
| Early userspace | A purpose-built minimal initramfs shipped with the kernel package |
| cx3576 boot | U-Boot with required signed FIT configurations and redundant environment storage |
| UEFI boot | systemd-boot, signed UKIs, and native boot counting on x64 and virt-arm64 |
| Installation | A component-file installer replaces RAUC's partition installation and boot-state backend |
| Layout | Three GPT partitions per board: FIRMWARE/ESP, SYSTEM, and one writable DATA filesystem |
| Writable paths | Read-only `/var` skeleton with an explicit writable-path allowlist; persistent leaves bind DATA directories, volatile data uses bounded runtime storage |
| Initial deployment | Fresh image/reflash; no compatibility reader, dual installation path, or in-place repartitioning |

Replacing RAUC and replacing GRUB on UEFI are explicit parts of this proposal, not implied prerequisites of signed verity. They remove the old partition model and custom GRUB counter implementation from the target architecture. Alternatives are compared below.

### 2. What public-key verity verification means

The kernel authenticates a small root-hash value, then uses that authenticated hash as the root of the existing Merkle tree:

```text
Embedded public certificate
          |
          v
Verify root-hash PKCS#7 signature at mapping creation
          |
          v
Authenticated root hash -> verity hash tree -> blocks read by SquashFS
```

This removes the need to bake each release's root hash into the kernel or bootloader. It does not remove hashes, the hash tree, or block verification. Download length and digest checks also remain: they bind files to release metadata and detect incomplete downloads before activation.

The initial rootfs artifact consists of:

```text
rootfs.img               SquashFS followed by its verity tree
rootfs.roothash          Lowercase ASCII SHA-256 root hash, exactly 64 bytes
rootfs.roothash.p7s      Detached DER PKCS#7 signature of those 64 bytes
rootfs.json              Image length, verity geometry, algorithm, salt, board/arch and build identity
```

The signed release descriptor authenticates the metadata and the exact artifact digests. Signing only a root hash does not authenticate a release name, board identity, version, or every verity table option. Readers validate these independently and allow only the defined geometry and policy fields. Metadata is parsed as data; it is never sourced as a shell script or imported as unrestricted bootloader environment commands.

Kernel requirements, built in before the real root is available:

```text
CONFIG_BLK_DEV_LOOP=y
CONFIG_BLK_DEV_DM=y
CONFIG_DM_VERITY=y
CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG=y
CONFIG_SYSTEM_TRUSTED_KEYRING=y
CONFIG_SYSTEM_TRUSTED_KEYS="<build-staged-public-certificate-bundle>"
```

Also include the board's storage drivers, ext4, SquashFS/Zstd, device-node support, and the X.509/PKCS#7/asymmetric-crypto dependencies selected by Kconfig. Keep secondary/platform verity trust expansion disabled initially: the accepted anchors are the explicitly embedded content-verification certificates. These are build inputs containing public material only.

Set `dm_verity.require_signatures=1` through the authenticated boot policy and assert the effective value before mounting any system content. Enabling `CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG` alone does not require signatures: upstream permits an unsigned mapping unless this policy is enabled. The boot path must not accept overrides that disable signature enforcement, replace early init, or substitute an unverified root. Prove the policy on the actual vendor and upstream kernel builds rather than assuming their command-line handling is identical.

The initramfs uses the existing veritysetup interface with `--root-hash-signature`, supplying a read-only loop device for both data and appended hashes plus explicit geometry. veritysetup transports the signature to the kernel; the kernel decides whether the signing key is trusted. Missing signatures, unknown keys, invalid signatures, and mapping failures are fatal for the selected deployment. No unsigned retry path exists.

### 3. Authentication boundaries and keys

Use three explicit trust domains:

| Domain | Verification anchor | Signed material |
|---|---|---|
| Boot executables | U-Boot control FDT keys, or enrolled UEFI Secure Boot keys | FIT configuration including kernel/DTB/initramfs, or a UKI |
| Immutable system content | X.509 certificates embedded in the kernel | Rootfs and kernel-support-image root hashes |
| Release metadata | Ed25519 public keys in the authenticated initramfs and updater | Release descriptors and acquisition catalogs |

Default content signatures use RSA-2048 with SHA-256 and DER PKCS#7, subject to the first proof confirming the exact encoding on both kernel families. Existing Ed25519 metadata signatures are not a substitute for the kernel's PKCS#7 interface. Do not add a custom in-kernel JSON, Ed25519-envelope, or whole-image signature verifier.

Kernel-support data receives the same integrity treatment as rootfs. Moving modules out of the verified root must not leave executable `.ko` files on an unverified writable directory. The kernel package contains a read-only, verity-protected support image whose expected identity is bound into the authenticated kernel package. The early loader verifies its signed root hash before exposing modules and any kernel-coupled firmware.

Public-key verity authenticates content only under a trusted running kernel and early loader. A replacement kernel could accept another key or skip verification. Required FIT/UKI verification therefore belongs in this plan, while hardware-rooted authentication of U-Boot itself remains a separately evidenced board property. A signed UKI booted with Secure Boot disabled does not establish firmware-enforced authentication. Report these distinct assurance levels accurately.

Development tests use isolated development keys. Production private keys are external signing inputs and never enter image layers, source control, logs, or device filesystems. Do not generate production keys or change device enrollment/fuses as part of preparing this plan.

Key lifecycle:

1. Embed an initial content trust anchor and metadata public-key set in each kernel package.
2. Routine rootfs releases sign with the existing trusted content key; they do not require rebuilding the kernel.
3. For anchor rotation, first deliver and confirm a kernel trusting both old and new anchors, then publish content using the new anchor.
4. Keep the rollback deployment usable during the overlap. Remove an old anchor only when the retained rollback path has also moved to an acceptable kernel/content combination.
5. Treat an embedded-key removal as a kernel update and a boot-key removal as a boot-trust update. Do not promise dynamic revocation without such a mechanism.
6. Catalog expiry gates acquiring updates. An already installed valid deployment must remain bootable offline; do not apply catalog expiry to every boot.
7. Test kernel certificate-chain, expiration, and revocation behavior explicitly. Do not inherit userspace RAUC/OpenSSL certificate-expiry claims for the kernel verifier.

A valid signature does not prevent replay of an older signed image. The updater tracks installed/withdrawn releases and failed candidates for normal update policy. Hardware-backed anti-rollback counters and physical-media replay protection are outside this implementation; they must not be claimed as properties of A/B rollback.

### 4. Component ownership and build separation

| Artifact | Owns | Build must not depend on |
|---|---|---|
| Boot firmware | Board loader stages and boot-executable verification keys/policy | A particular rootfs hash or application version |
| Kernel package | Kernel, board DTB where needed, initramfs, module tree and indexes, kernel-coupled firmware, kernel configuration/build record | A particular rootfs release |
| Rootfs | User-space programs, services, product configuration defaults, architecture-specific user-space libraries | A particular `/usr/lib/modules/<release>` tree or exported kernel binary |
| Release descriptor | Exact kernel/rootfs references, target board/arch, artifact lengths/digests, verity metadata, release identity | Copies of unchanged component payloads |

Kernel packages retain their modules and DTB together even when only the kernel is selected for an update. All in-tree and out-of-tree modules must come from the matching build. This is execution correctness, not a requirement to support old system versions.

The support image exposes a `modules/` tree containing `<kernel-release>/` and its depmod indexes. Mount/bind that tree read-only at the rootfs's pre-created `/usr/lib/modules` mount point before udev or any module-loading service runs. Give kernel-coupled firmware one explicit owner and expose it before probing its driver. Early storage drivers required to open SYSTEM remain built in; they cannot depend on the support image they are needed to reach.

Keep artifact identities immutable and content-addressed. An embedded kernel build ID is derived from its build inputs; the final signed FIT/UKI digest is computed after packaging. Do not try to embed an artifact's own final digest inside itself. A signed release binds the build ID, final boot artifact digest, and support-image identity.

A rootfs-only build must neither rebuild the kernel/U-Boot nor produce changed copies of those artifacts. A kernel-only build must not rebuild rootfs. The final full-disk factory image assembles already built components.

### 5. Three-partition layout and unified writable DATA

| Partition | cx3576 | x64 / virt-arm64 |
|---|---|---|
| 1 | FIRMWARE, raw Linux-reserved GPT region covering loader and both environment copies | ESP, FAT, holding systemd-boot, immutable UKIs and boot entry files |
| 2 | SYSTEM, ext4: kernel FIT/support images, rootfs files and signed deployment descriptors | SYSTEM, ext4: support images, rootfs files and signed deployment descriptors |
| 3 | DATA, ext4, grows on first boot: identity, credentials, update metadata, selected disk-backed writable paths, system/application and user data | Same |

The rootfs A/B files share SYSTEM on every board. UEFI boot executables are stored on the existing ESP because firmware/systemd-boot must read them before Linux can mount ext4; there is no additional pair of boot partitions.

On cx3576, preserve the currently proven loader placement at sector 64 and environment byte offsets at 16 and 17 MiB, each 64 KiB. One reserved GPT partition covers these raw regions through the 18 MiB boundary. These remain two independent environment copies despite having one GPT entry. Firmware updates write only the designated loader range and must never overwrite environment storage. The entire reserved region remains covered by GPT so repart/discard cannot erase it.

STATE, META and EPHEMERAL cease to be partitions. Their distinct retention and ownership rules are represented by directories on DATA. SYSTEM remains separate: large bootable objects should not share their filesystem with ordinary user and runtime writes.

Proposed initial build defaults are SYSTEM 2 GiB and a 512 MiB UEFI ESP. These are sizing proposals, not measured minimums. The assembler must check the measured peak footprint: current deployment + retained rollback + staged replacement + filesystem overhead/reserve. Check ESP and SYSTEM independently. Keep the sizes in `board.env`, with an explicit build-time refusal if the chosen images do not fit. DATA stays last and is the only partition grown automatically. STATE/VAR/META have no GPT size or UUID; runtime capacity policy replaces their former fixed-size partitions.

Normal filesystem mounts are SYSTEM read-only at `/mnt/system`, ESP read-only at `/boot` on UEFI, and DATA read-write at `/mnt/data`. The updater temporarily enables writes on SYSTEM/ESP when needed; it must not remount the entire shared DATA filesystem read-only at transaction completion. The real root remains a read-only dm-verity mapping throughout, including the `/var`, `/var/lib`, `/var/cache`, and `/var/log` parent directories. Existing `/run` and `/tmp` memory-backed behavior remains unchanged.

#### DATA namespaces and bind mounts

```text
DATA/                         mounted at /mnt/data
  state/                      device identity, credentials and persistent service state
    mos/
    ssh/
    bluetooth/
    timesync/
    network/
    quadlet/
    systemd-units/
  meta/                       update transaction metadata and appliance lifecycle records
  cache/<service>/            only audited caches that need disk backing
  tmp/                        only if a shipped workload requires /var/tmp
  mos/                        existing system/application data and /mos/config
  srv/                        existing user data
```

| Physical source | Runtime path | Mechanism |
|---|---|---|
| `/mnt/data/state/mos` | `/var/lib/mos` | Leaf bind; includes mosd state and apid's existing `StateDirectory=mos/apid` |
| `/mnt/data/state/ssh` | `/etc/ssh` | Directory bind mount |
| `/mnt/data/state/bluetooth` | `/var/lib/bluetooth` where that board provides Bluetooth | Leaf bind; preserves pairing records |
| `/mnt/data/state/timesync` | `/var/lib/systemd/timesync` | Leaf bind; preserves the saved clock |
| `/mnt/data/state/network` | `/var/lib/systemd/network` where networkd persistent storage is enabled | Leaf bind; ready before its `StateDirectory` writer |
| `/mnt/data/cache/<service>` | `/var/cache/<service>` only when the write audit requires it | Leaf bind with an explicit size and cleanup policy |
| `/mnt/data/tmp` | `/var/tmp` only when required by a shipped workload | Leaf bind; retain across reboot with bounded age/size cleanup |
| Other existing persistent state sources | Their existing narrow service paths | Bind mounts using sources under `/mnt/data/state` |
| `/mnt/data/meta` | Installer/appliance metadata path | Direct access by its owner; no extra `/mnt/meta` alias |
| `/mnt/data/mos` | `/mos` | Existing directory bind |
| `/mnt/data/srv` | `/srv` | Existing directory bind |

Update sources and service dependencies to these canonical DATA paths. Do not retain `/mnt/state` and `/mnt/meta` as compatibility-only indirections. Required mount points, static files, symlinks, and ownership are created in the immutable root at build time. Seed only the selected writable backing paths before their writers start. No generic `DATA/var` backing tree is created.

The table is the initial path contract, not proof that every shipped writer has been audited. P1/P5 must record each remaining writer's exact path, owner, persistence need, write/rename behavior, initialization, dependency, capacity limit, and reset treatment. A directory's presence in the factory image is not evidence that it needs to be writable.

Apply these concrete rules during that audit:

- Keep `/var/run -> /run` and `/var/lock -> /run/lock` as image-defined symlinks. Use existing `/run` storage for sockets, locks and per-boot files, with bounded allocation where a service can accumulate data.
- Keep journald's current `Storage=volatile` policy. Do not mount all `/var/log` for journald. Audit any enabled login/accounting or other file-log writers separately; configure an explicit destination or expose only their required paths.
- Podman's graph already uses `/mos/containers/storage` and its runroot uses `/run/containers/storage`. Move its separately configured network definitions from `/var/lib/containers/networks` to `/mos/containers/networks`, with the existing `/mos` dependency and explicit reset retention. This needs no additional `/var/lib/containers` mount.
- Audit the shipped `systemd-random-seed` service's single-file persistence, including atomic replacement and shutdown writes. Select a supported redirection or narrow writable layout in P1; do not expose all `/var/lib/systemd` to accommodate one file. Do not assume a file bind mount supports replacing the mount-point inode.
- Leave static package/build metadata read-only. Do not add writable apt, dpkg, debconf, or ldconfig cache directories merely because packaging left paths or tmpfiles rules behind. Reconcile this with the existing package-manager purge/composition work.
- Prefer a service's configurable DATA or `/run` destination when it avoids a redundant mount. For services requiring canonical `/var` paths, expose the smallest working directory. Do not split an atomic-rename directory into individual file mounts.
- Disk-backed cache paths are optional and must have actual writers. `/var/tmp`, if required, retains its cross-reboot temporary-file behavior; use `/tmp` or `/run` for explicitly volatile workloads. Do not silently turn `/var/tmp` into tmpfs.

No whole-tree bind, tmpfs, or overlay is used for `/var`, and no blanket bind is used for `/var/lib`, `/var/cache`, or `/var/log`. Adding a writable path requires a concrete runtime write requirement; unlisted paths stay read-only.

A symbolic link redirects pathname resolution; it is not a mount and supplies no systemd mount dependency or per-mount policy. Use bind mounts for the system directories above so applications see ordinary directory mount points and service ordering is explicit. Existing individual file symlinks can remain where their semantics are already deliberate, such as a credential file pointing into persistent state; this is not a general prohibition on symlinks.

Bind mounts share the underlying filesystem's space and ownership. They do not create capacity isolation, encrypt state, or provide a separate failure domain. Do not put `noexec` on all DATA blindly: `/srv` and application directories may hold executable payloads. Apply and verify any per-mount restrictions at the appropriate exposed path and retain permissions on the backing directories as well.

#### Startup, permissions and failure behavior

Use this dependency order, represented by systemd mount/service dependencies rather than shell timing:

```text
DATA filesystem mount and first-boot growth
  -> quota and namespace initialization
  -> initialize only approved backing paths without overwriting retained data
  -> /mos, /srv, narrow /etc binds and selected /var leaf binds
  -> service writers and the boot health gate
```

Extend `mos-data-layout` and the persistent-state initializer; avoid a second initializer that creates the same directories. Retire the whole-tree `mos-seed-var` copy, its stamp, and the factory-var redirection once the immutable skeleton and required leaf seeds are in place. Reconcile tmpfiles rules with that skeleton so boot does not attempt to create or change image-owned paths on a read-only filesystem. The initializer runs from the verified root and must not depend on the writable paths it prepares. Preseed the factory DATA image where appropriate, with idempotent recovery after a scoped reset. Order early network/systemd writers and services using `StateDirectory` after their exact backing mounts; verify both host and service mount namespaces.

Restrict `state/` and `meta/` at the namespace boundary, with explicit service ownership and modes for their child directories. Do not expose them through `/srv`, ordinary application mounts, file sharing, or backup/export routes that promise only user data.

If DATA is missing, read-only, corrupt, or fails namespace initialization, refuse normal data-dependent services and report a shared-data failure. Do not fall back to writing into the rootfs, silently create new credentials elsewhere, or repeatedly mark different rootfs deployments bad for the same DATA failure. SYSTEM can still supply the authenticated root, but normal service operation requires DATA. Recovery must distinguish this storage problem from an invalid candidate root.

#### Capacity policy replacing partition limits

The selected implementation includes directory project quotas for large disposable/bulk writers. Use a shared bulk project for `mos/` and `srv/`; if the audit requires disk-backed caches or temporary files, account for those explicitly allowed backing directories in a disposable project. There is no blanket VAR project or automatic carryover of the old partition's budget. Derive byte and inode budgets from actual workloads, leaving a measured state/meta reserve and filesystem overhead. Ensure project inheritance before creating payloads and reapply it when resetting directories. Runtime tmpfs limits are accounted for separately as memory usage. The update workspace remains under `/mos/updates` and may legitimately report insufficient bulk capacity even while the protected state/meta reserve remains available.

Compute these limits after first-boot filesystem growth, using the actual DATA capacity. A device too small for the configured minimum budgets must report the capacity failure instead of applying negative limits or silently disabling enforcement. Do not interpret filesystem or project quotas as preallocated storage.

This is one filesystem and a small fixed policy, not a new storage-pool manager. Keep root-level directory creation restricted so ordinary application writers cannot escape to an unaccounted path. Test the actual writer privileges: reserve blocks available to root or a monitoring threshold alone do not ensure privileged logging/application processes cannot exhaust space. Quotas do not protect against a deliberately privileged administrator changing policy or arbitrary filesystem corruption.

Current kernel quota configurations differ: the tracked cx3576 config disables `CONFIG_QUOTA`, while x64/virt-arm64 do not provide the same quota configuration. P1/P5 must verify the resolved kernel configs, ext4 project-quota feature/mount setup, userspace control interface and supported tool versions. Do not claim quota enforcement from a mount option or directory name alone.

Keep journald's existing volatile-storage policy and bounded cleanup of disposable files. Report DATA physical capacity once, plus directory usage/quota information; `df` on bind mounts must not be summed as if it represented independent partitions. Namespace readiness checks validate each allowed path's backing directory and mount location, since device numbers alone no longer distinguish persistent state from disposable paths.

#### Reset and cleanup boundaries

Never format or recursively clear the entire DATA filesystem for ordinary cache/temp cleanup or a factory-reset tier. Preserve the existing reset-tier decisions for identity, credentials, configuration, application data, and appliance metadata, translating each into an explicit directory/record allowlist. Physical co-location does not change which records a reset may remove. Serialize reset against installation and GC, and preserve transaction/one-way lifecycle metadata where the existing reset contract requires it.

Clear only allowlisted physical cache/temp backing directories after stopping their writers; there is no universal var tree to wipe or reseed. Never recursively clean the exposed `/var` tree, which contains persistent bind mounts. A same-filesystem traversal guard is insufficient because multiple backing directories share DATA's device number. Use bounded directory traversal that rejects symlinks and unexpected mount points, and test that SSH keys, credentials, update metadata, persistent service state, `/mos` and `/srv` survive disposable-data cleanup.

The previous partition-based reset assumptions in `pkgs/mosd/mosd/src/reset.rs`, seeding, mount checks, storage status and verification are all in scope. Reset recovery must remain idempotent after interruption, including restored quota inheritance and directory ownership.

### 6. Deployment records and boot selection

The device retains a current deployment and a rollback deployment. A candidate is written under a fresh immutable deployment ID. Logical A/B labels may be presented in diagnostics, but filenames are not overwritten in place merely because a label is reused.

The factory image includes two valid deployment records that may share the same initial kernel and rootfs objects; it never ships an empty fallback image. After a successful update, retain exactly the confirmed deployment and its predecessor. During a trial, the previous retained pair may remain until the candidate is confirmed; storage and boot-entry enumeration must account for this bounded third generation.

```text
SYSTEM/
  kernels/<kernel-id>/support.img, support.roothash, support.roothash.p7s
  kernels/<kernel-id>/boot.itb              # cx3576 only
  roots/<root-id>/rootfs.img, rootfs.roothash, rootfs.roothash.p7s
  deployments/<deployment-id>.json
  deployments/<deployment-id>.sig
  staging/<transaction-id>/

ESP/                                      # UEFI only
  EFI/mos/kernels/<kernel-id>.efi
  loader/entries/mos-<deployment-id>+3.conf
```

The signed descriptor specifies board, architecture, kernel build ID and component digests, rootfs identity, verity geometry, and a monotonically ordered release/deployment generation. Existing metadata envelope code can be reused, with a dedicated payload schema and bounded strict parsing. Object IDs and filenames use a restricted character set; no URLs, traversal, arbitrary scripts, or free-form verity flags are accepted in boot references.

Example transitions, each starting from K1/R1:

| Request | Candidate | New bytes |
|---|---|---|
| Rootfs only | K1/R2 | R2 and its metadata/signature |
| Kernel only | K2/R1 | K2 boot and support artifacts |
| Both | K2/R2 | Both sets |
| Boot firmware | Separate maintenance operation | Firmware artifact only |

Boot selection, tries, confirmation, and fallback apply to the deployment combination. They are not three independently advancing A/B state machines. Releases name tested combinations; the installer does not construct arbitrary combinations or maintain a historical compatibility matrix.

#### cx3576 backend

Use the redundant U-Boot environment as the authoritative selection/attempt store, with both copies inside FIRMWARE. Store current, candidate, candidate tries and last-attempt deployment IDs. Update related fields in one environment save. Consume and persist a candidate attempt before handing over control; a failure to persist must refuse that candidate rather than retry forever.

The selected kernel is a required-signature FIT covering the kernel, DTB and initramfs. The installed U-Boot policy must enforce required configuration keys and the normal path must have no unsigned raw `booti` fallback. Mutable selection metadata may select an already authenticated component; it may not supply executable boot policy. The initramfs independently verifies the deployment descriptor and checks it against the selected kernel build ID.

#### UEFI backend

Replace GRUB with systemd-boot. Publish Type #1 entries with per-deployment boot counting, each referring to a reusable signed UKI stored outside the automatically discovered `EFI/Linux` location. Two rootfs deployments may therefore reference the same UKI without duplicating or re-signing it.

The selected Type #1 entry identifies the deployment through `LoaderEntrySelected`. The initramfs validates this hint and loads the corresponding signed descriptor; it does not take a root hash from unsigned entry options. The UKI contains a fixed authenticated command line with signature enforcement and the generic early loader. Under Secure Boot, do not depend on overriding an embedded UKI command line to select rootfs.

Use native entry boot counting with three trials and newest-eligible-deployment selection. Persistent default/one-shot overrides must not accidentally force an exhausted entry. The selected-entry identifier and count suffix normalization are part of the UEFI prototype tests. Disable automatic UKI entries or fallback paths that would bypass deployment selection.

Health controls blessing: ensure the stock generator/service cannot mark an entry good before the MOS health gate. The backend's `confirm` operation blesses only the currently running deployment. Require explicit negative tests for failed health checks and exhausted entries.

The normal firmware/kernel authenticity claim on UEFI requires enrolled keys and Secure Boot enabled. QEMU can prove this with disposable variable storage and test keys. Physical-device enrollment is a separate, explicit provisioning operation; a development machine with Secure Boot off is reported accordingly.

### 7. Minimal initramfs

Implement a small early-init program and include only its required runtime plus veritysetup and its measured library closure. Prefer existing Rust build infrastructure for the early-init program and shared strict descriptor parsing. Do not reintroduce distribution-wide initramfs generation, package-manager hooks, a networking stack, or a new general-purpose init system.

Boot order:

1. Establish `/dev`, `/proc`, `/sys`, bounded storage discovery, and the board's watchdog handoff where supported.
2. Read the boot backend's selected-deployment hint and verify the effective signature-enforcement policy.
3. Inspect SYSTEM before mounting it; perform only bounded journal/filesystem recovery allowed by the boot policy. Include the measured e2fsck runtime closure if offline repair is required, and never run it against a mounted filesystem. Journal replay can require writes even when the eventual mount is read-only. Keep SYSTEM read-only after recovery. A missing/corrupt shared filesystem is not solved by choosing a different file on it.
4. Verify the signed deployment descriptor using the embedded metadata anchor, and check board/arch/kernel build ID and supported format fields.
5. Attach read-only loop devices, establish signed verity mappings for rootfs and kernel support, and mount both read-only. A signature accepted by userspace alone is insufficient; the kernel mapping must report signature verification.
6. Bind the verified module/firmware trees into prepared mount points before any driver userspace is started.
7. Preserve SYSTEM and support mounts under the new root's runtime mount tree, move pseudo-filesystems, and switch to the real root. Keep the loop backing files mounted for the lifetime of the root.
8. Publish the running deployment identity and verification result for the health/updater services. They must not infer it from `/dev/dm-0` or a version string alone.

Failure paths are bounded: signature/metadata/mount failures mark or consume the candidate appropriately, report a concise console reason, and reboot into the known-good deployment. A kernel panic uses an explicit restart policy; a pre-userspace hang requires a hardware/firmware watchdog proven on that board. Trial counting alone cannot restart a hung kernel. After both deployments are unusable, enter a defined recovery outcome and do not silently reset both counters into an infinite loop.

### 8. File installation and RAUC removal

Replace the RAUC installation/boot-state boundary with a small component installer and explicit boot backend operations: `status`, `activate`, `confirm`, `reject`, and `rollback`. Reuse existing download resumption, workspace readiness, catalog verification, policy scheduling, and health logic where their semantics still apply. Rename RAUC-specific package/API internals when converting them; do not retain a parallel compatibility backend.

The reason for this selection is broader than filenames. RAUC 1.13's `src/dm.c` creates its verity bundle mapping without a root-hash-signature parameter. The kernel's global `dm_verity.require_signatures=1` policy rejects that mapping even if RAUC already authenticated its CMS bundle in userspace. Retaining it would require a changed bundle/mapping path or weaker global enforcement, plus adaptations for shared file objects. The selected architecture removes that interaction entirely.

Online delivery uses a signed release descriptor and immutable component objects. The update server extends its single-artifact model with release/component associations and serves objects by digest. Catalogs retain acquisition freshness checks. Offline import accepts the same signed descriptor and required objects in one bounded archive, with strict extraction rules; it does not require an on-device RAUC verity bundle mount. Import and online download converge on the same installer transaction.

The current server/client catalog mismatch is resolved as part of this work: implement the server's Ed25519 envelope protocol in the device acquisition client and remove the superseded TUF-only route from the final product. Do not introduce a third catalog protocol.

Update transaction, serialized against another install, GC, reset, and firmware maintenance:

1. Read the actual running deployment and authoritative boot state; refuse a new activation while another candidate is unconfirmed.
2. Authenticate the release, determine missing component objects, and reserve DATA workspace, SYSTEM, and ESP capacity separately.
3. Download/resume into `/mos/updates/downloads`; check length and digest before promoting into the verified workspace.
4. Stage missing objects on their destination filesystem under non-boot-visible names. Never write a currently referenced object, truncate a mounted image, or modify an existing object in place.
5. Verify all artifact metadata/signatures and read back newly written data. Installation may perform a complete verification pass; boot does not require one.
6. Fsync each new file, publish immutable object names, and fsync the affected directories. Write and persist the signed deployment descriptor only after all referenced objects are durable.
7. Publish the candidate through the boot backend last: one redundant-environment update on cx3576, or the final boot-visible counted entry on UEFI. For UEFI, SYSTEM and UKI contents must be durable before the ESP entry can be published.
8. Flush/check write results and return writable mounts to the expected state. Record `reboot-required` only after activation has been verified from the authoritative backend.
9. On restart, trial the candidate. The health gate confirms that exact deployment after existing essential services and verified support mounts pass.
10. After confirmation, retain the previous known-good deployment and collect only objects referenced by neither retained deployment nor an active transaction. Never garbage-collect the running kernel/rootfs/support set.

The transaction journal under `/mnt/data/meta` aids diagnosis and resumption; boot-visible backend state is authoritative for activation. Recovery reconciles the two after a reset, without reporting a half-published candidate as committed. DATA directory publication can use same-filesystem rename, but SYSTEM/ESP/DATA still require the explicit cross-filesystem commit order above.

Cross-filesystem rename is not atomic. File fsync/rename is also not a blanket guarantee against shared-filesystem or storage-controller failure. Persistence order, mount recovery, and real power-cut tests are required acceptance evidence.

### 9. Rootfs rollback and writable state

Boot rollback restores kernel/rootfs/support references. It does not undo writes to the shared DATA filesystem, including persistent service state, metadata and application data. To make a candidate's rollback meaningful, the trial boot must not perform irreversible settings/schema changes before confirmation. For a release requiring such a change, declare it in the release contract and either provide a scoped rollback snapshot/restore transaction or require an explicit reset/reflash deployment. Do not silently advertise automatic rollback for that release.

The initial file-A/B implementation supports trial boots with unchanged persistent schemas and defers destructive migrations. This does not require supporting every historical schema; it protects the one explicitly retained fallback deployment.

Update status and UI expose current/candidate/fallback deployment IDs, kernel/rootfs component versions, signature verification, boot-executable verification state, remaining attempts, and the last failure. Rootfs-only and kernel-only actions identify which component bytes will change. Successful download, activation, trial boot, and confirmation remain distinct states.

### 10. Independent boot-firmware maintenance

Build and publish boot firmware independently, using a signed manifest with exact board and write-range constraints. Its device action is separate from ordinary rootfs/kernel activation, serialized with them, and never automatically included in a rootfs-only or kernel-only operation.

For cx3576, the initial supported recovery route remains the established loader/maskrom reflash procedure with read-back verification. A two-copy U-Boot environment is not a two-copy bootloader. Do not claim ordinary A/B can recover a loader interrupted before U-Boot runs. Add an online firmware-write operation only after BootROM/SPL redundancy or another interruption-safe update mechanism is demonstrated; otherwise report online firmware update as unsupported and expose the maintenance artifact/procedure.

For UEFI, manage the systemd-boot executable as the separate boot-firmware artifact. The platform's own UEFI firmware is outside the OS updater. Prove any systemd-boot executable replacement and fallback path separately from entry publication.

### 11. Shared-filesystem recovery and storage limits

SYSTEM being shared means damage to its filesystem metadata can affect both deployments. Signed verity detects invalid image data but cannot repair the outer ext4 filesystem or locate an image whose directory entry is lost. Keep SYSTEM isolated from user workloads; allow writes only through serialized maintenance.

First-stage firmware must still find a kernel before Linux can replay an ext4 journal. On cx3576, test U-Boot reading the actual ext4 feature set after interrupted installs, including an unclean journal. Do not assume Linux's successful journal recovery proves U-Boot can read the same state. If the shared SYSTEM cannot meet the power-cut acceptance requirement, the documented fallback is one small separate boot-files partition; that raises cx3576 to four partitions and requires a plan amendment rather than a silent safety claim.

Use the same tests for interrupted ESP updates on UEFI. Both A/B entries share FAT metadata and this design does not promise recovery from arbitrary ESP corruption. Full shared-media failure uses removable/reflash recovery; no new recovery partition or always-resident rescue kernel is added in the initial scope.

## Implementation sequence and verification

Execute sequentially unless the user later requests parallel work. Amended 2026-09-08 17:19 by user direction: phases with disjoint files run in parallel, and each phase completes and is verified on x64 under QEMU before the same layout is applied to cx3576 and the other boards. Each phase begins with the smallest failing behavioral test available in the existing test setup, then implementation and relevant-suite verification. Do not build new test infrastructure solely for planning.

| Phase | Changes | Required evidence before proceeding |
|---|---|---|
| P1: prove signing, boot and writable-path primitives | Isolated test keys; build signed-verity-capable x64 and cx3576 kernels; exercise veritysetup; prototype shared-UKI Type #1 entries and cx3576 signed FIT; audit enabled writers and resolve the random-seed path | Real kernel accepts valid signature and rejects absent/wrong/modified signatures; unsigned mapping rejected under global policy; reused kernel boots two signed roots; metadata hint reaches early init correctly; writable-path contract records persistence and rename/boot/shutdown requirements |
| P2: freeze artifact/descriptor contracts | Strict schemas, content identities, kernel-support ownership, metadata/signing tooling and development trust inputs | Cross-language golden fixtures; malformed geometry, wrong board/arch, substitution and path traversal fail; no private material in outputs |
| P3: split producers | Separate rootfs, kernel/support, and firmware packaging; remove module/kernel/root-hash coupling | Rootfs-only build leaves kernel and firmware digests unchanged; kernel-only build leaves rootfs unchanged; support modules match the built kernel |
| P4: build minimal early init | File discovery, signed descriptor verification, loop/verity mounts, support binds, root switch and failure handling | QEMU boots signed file root; selected support tree is present before udev; wrong kernel/support/root combinations fail; no whole-image boot scan |
| P5: implement disk assemblers and writable layout | New three-partition board geometry, firmware-region protection, ESP object storage, unified DATA namespaces, read-only var skeleton, audited leaf binds and seeds, tmpfiles rules, quotas, storage status and directory-scoped reset rules | GPT/offset/size checks; loader/env bytes protected; DATA-only growth; exact mount sources and writer ordering; unlisted var paths reject writes; quota/space/inode containment; reset preservation; both boot records exist on factory image |
| P6: boot backends | cx3576 redundant environment and signed FIT; UEFI systemd-boot/UKI/native trials; health-owned blessing | Persist-before-boot and write-failure tests; three failed trials fall back; valid current deployment remains untouched; early automatic blessing is impossible |
| P7: installer and acquisition | Replace RAUC integration with file transactions, server envelope client, online/offline import, capacity accounting, GC | Rootfs-only/kernel-only/combined updates; interruption at every publication boundary; low-space failure preserves current and fallback; unchanged objects reused |
| P8: server and product integration | Multi-component releases and publication validation; mosd/apid update state/actions, health, suppression, UI | New API/schema tests and UI flows; duplicate/partial uploads refused; authorization preserved; current/candidate/confirmed states match backend |
| P9: firmware maintenance and key lifecycle | Separate artifact publishing/read-back workflow; overlap rotation; explicit unsupported online-loader cases | Rootfs/kernel update never writes firmware ranges; rotation retains a bootable fallback; development trust grade reported; no unproven online-loader capability |
| P10: fault acceptance and removal | Run the full fault matrix, remove superseded RAUC/GRUB/raw-slot code and packaging, update active design/user docs | All applicable automated checks pass; board-specific physical evidence recorded; unsupported claims removed; no compatibility code or stale mandatory raw-slot checks remain |

P1 is a feasibility gate before committing to the new assembler/updater. A failed proof changes this draft's concrete decisions; it must not be hidden by lowering signature or rollback requirements.

New packages/tools must use the existing pinned build containers and package-manifest mechanism. Verify supported stable versions when adding dependencies; keep systemd-boot/stub matched to the shipped systemd release unless a recorded reason requires a coordinated update. Do not upgrade kernel versions merely to obtain a feature already present; inspect the exact vendor source and resolved build first. Existing Rust/Bun/frontend acceptance packs apply when those modules are implemented.

### Fault and acceptance matrix

| Case | Expected result | Verification level |
|---|---|---|
| Valid signed root/support images | Kernel mappings created; correct deployment reaches health confirmation | QEMU and cx3576 |
| Missing, truncated, unrelated-key or modified root signature | Candidate refused; no unsigned retry | Kernel integration and QEMU |
| Valid signature with modified root hash | Kernel refuses mapping | Kernel integration |
| Modified rootfs or hash-tree block | Affected read fails according to corruption policy; corruption observed during trial prevents confirmation; unread latent damage is detected when accessed | Kernel integration; read a deliberately corrupted previously uncached block |
| Modified module/support image | Verification failure before affected module is loaded | Kernel integration and QEMU |
| Modified kernel, DTB or initramfs | FIT/UEFI authentication refuses it where the boot anchor is provisioned | U-Boot sandbox, QEMU Secure Boot, cx3576 |
| Signature enforcement override or alternate early-init/root | Normal boot path refuses it | Negative boot tests on each backend |
| Valid but wrong-board descriptor; kernel/support mismatch | Early init refuses it | Unit tests and QEMU |
| Rootfs-only or kernel-only update | Unchanged component bytes/digests stay unchanged, new combination confirmed | Build tests and QEMU E2E |
| Partial download/import; bad digest; destination ENOSPC | No boot-visible candidate; current/fallback remain bootable | Installer integration |
| Reset after each file write/fsync/rename/activation operation | Either previous committed deployment or fully staged candidate is selected | Deterministic fault injection and VM abrupt stop |
| Failure to persist attempt state | Candidate is not launched with an unrecorded trial | Backend tests |
| Kernel panic, pre-userspace hang, failed health gate | Bounded retries and fallback; hangs require proven watchdog reset | QEMU plus physical cx3576 watchdog test |
| Both candidates exhausted or shared filesystem corrupt | Defined recovery result, no silent counter refill | QEMU and physical recovery test |
| Restart during confirmation or GC | Running and retained fallback objects remain intact | Transaction integration |
| Offline boot after catalog expiry or with unset network time | Previously installed authenticated deployment still boots | Clock-controlled QEMU |
| Trust-anchor overlap/removal | Intended old/new acceptance and fallback availability | Disposable-key integration |
| Firmware artifact applied as ordinary OS update | Rejected; no loader/env write | Installer integration |
| DATA missing, read-only or corrupt | Explicit shared-data failure; no default credentials or writes on the immutable root; no repeated rootfs blame | Mount/service integration and QEMU |
| Allowed disk-backed cache/temp or bulk directory reaches byte/inode quota | That writer is limited; essential state/meta writes remain possible within the measured reserve | Real ext4 project-quota integration using production writer privileges |
| Disposable-path cleanup with persistent bind mounts present | Only allowlisted physical cache/temp contents are removed; state, metadata, user data and identity survive | Reset integration with multiple bind mounts backed by the same filesystem |
| Interrupted directory reset/reseed | Retained records survive; ownership, quotas and source directories recover idempotently before writers start | Fault-injected reset and QEMU |
| First boot with empty DATA namespaces | Required leaf binds precede writers; tmpfiles and StateDirectory setup succeed without mutating the immutable parent skeleton | Systemd/QEMU integration |
| Write to an unlisted var path or parent directory | Rejected with EROFS; no whole-var, var/lib, var/cache or var/log writable mount or overlay exists | Host and service mount-namespace checks plus negative write tests |
| Reboot, shutdown and normal service operations | Audited writers succeed; required state survives; volatile data expires; random-seed replacement, network creation and log handling work without broad writable parents | QEMU lifecycle tests and board-specific service tests |
| Storage status on all bind paths | One DATA capacity total, accurate directory/project accounting, no duplicated disk capacity | Storage/API tests |

VM stops do not establish eMMC power-loss behavior. Physical tests must cut storage/device power at download, destination write, filesystem sync, candidate activation, attempt decrement, and confirmation; record the exact board, image IDs and observed recovery. Only the local bench device is involved. Ordinary boot must not write the large system images.

Measure boot time, peak early-init memory, bytes written/downloaded by each update type, and peak SYSTEM/ESP usage against the current baseline. Report measured results rather than promising a numerical performance gain. Include a large-root test proving that boot does not scale with a compulsory full-image hash scan.

Run applicable existing gates after the affected phases: `make os-build-test`, `make os-verify-test`, `make os-health-test`, the replacement/updated boot-handshake tests, Rust workspace quality gates, update-server/frontend checks, QEMU API E2E, and `make docs-verify`. Update tests whose contract changes; preserve meaningful negative tests instead of deleting failures to make the suite pass.

## Scope

### P2 implementation detail

Resume sequentially on x64 using the existing Rust signing workspace and Bun
build suite. Share golden inputs between the two readers. Reuse the server's
`mos/update-envelope/v1` envelope and Ed25519 signing bytes; introduce a distinct
`mos/deployment/v1` payload, with no legacy reader. Payload JSON is compact,
recursively key-sorted UTF-8 with safe unsigned integers and a 16 KiB limit.
Reject duplicate/unknown fields, unsafe identifiers, unsupported algorithms,
invalid geometry, component identity substitution and mismatched boot identity.

Content IDs are SHA-256 over canonical component metadata excluding its own ID;
the deployment ID hashes its complete payload. Boot artifact digests are measured
after signing. The authenticated kernel build identity binds `supportId`, the
hash of the complete support metadata (including its verity root hash, geometry
and signatures), and the kernel release. The early reader checks both before
selecting modules. Binding only the claimed image digest would let a signed
descriptor substitute another root hash while retaining that digest.
Rootfs owns no modules; support owns `modules/<release>` and kernel-coupled
firmware. Fixed paths are derived from validated IDs, never supplied in metadata.

Keep verity version 1, SHA-256, 4096-byte blocks, a 32-byte salt, an appended
tree with no superblock and exact image length. Sign precisely the 64 lowercase
ASCII root-hash bytes with RSA-2048/SHA-256 detached DER PKCS#7, without embedded
certificates or signed attributes. Use the existing pinned OpenSSL container.

Replace implicit BSP key generation with an explicit public certificate input
and a public-only staged context. Record the certificate bytes' digest so the
same distributed input can be used on every builder; private keys stay external.
Measure x64 expiry and anchor-removal behavior in the existing QEMU proof lab;
do not infer kernel policy from userspace certificate verification. Runtime
revocation permission is measured; kernel replacement and overlap rotation
remain P9 acceptance work.

Verification order: shared negative fixtures (RED), minimal readers/signers
(GREEN), focused Rust/Bun tests, actual signing and QEMU lifecycle experiments,
then the affected existing quality gates and documentation checks. Later phases
retain their existing acceptance gates.

Expected implementation areas:

- `boards/*/board.env`, kernel configs/producers, cx3576 U-Boot producer and boot policy, and UEFI boot asset packaging.
- `rootfs/scripts/pack-verity.sh`, boot export/composition, module/firmware ownership, fstab/repart/systemd leaf binds, immutable var skeleton, selected-path seeding and tmpfiles rules, container network destination, quota policy, health and directory-scoped reset integration.
- `build/src/bundle.ts`, image assemblers, artifact/release manifests, signing wrappers and their tests; raw-slot image generation is retired.
- `pkgs/rauc-sign` acquisition/signing code, RAUC integration in `pkgs/mosd/mosd`, early-init and component-installer packaging.
- `update-server` component metadata/storage/publication/API plus its existing UI; apid, update status/actions and the device UI.
- `verify/src` bootchain, slots, kernel, root, signature, mount, storage and update checks; boot/QEMU/fault harnesses.
- Active design/user documentation describing updates, rootfs, storage, release signing/artifacts, recovery and board assurance. Follow the repository's required locale coverage when those docs are updated.

The current server schema starts from a fresh database. No upgrade migration or earlier protocol reader is retained. The user authorized implementation, commits and full-image development-device tests; public publication and push are not requested.

Excluded: old-layout migration, old `.raucb` support, compatibility shims, delta updates, a general package manager, arbitrary component combination support, whole-tree writable mounts or overlays for `/var`, disk encryption, physical anti-rollback fuses, and guaranteed online U-Boot replacement without hardware evidence.

## Risks

1. **Shared filesystem failure.** File A/B reduces partition-level fault isolation. Consolidated DATA also places credentials, metadata, selected disk-backed writable paths and user data in one filesystem failure domain; bind mounts and quotas do not restore physical isolation. Journal/ESP behavior and board power-loss tests are release gates.
2. **Broader integration work.** RAUC and GRUB replacement affects server, client, health, UI, and verification. It removes ongoing adapter complexity but is more work than changing partition labels.
3. **Incomplete trust chain.** Signed root content alone cannot authenticate a replaced kernel/U-Boot; assurance reporting must distinguish development verification from an anchored boot chain.
4. **Module and firmware ownership mistakes.** A successful root mount can still produce a broken device if the wrong support image is mounted or mounted too late.
5. **Persistent-state changes.** Filesystem rollback does not restore database/configuration contents. Trial-boot write policy is required for the retained fallback to work.
6. **Space and garbage collection.** Shared unchanged objects reduce copies, but safe staging may need three generations temporarily. Deleting a shared running object is never an acceptable way to make room.
7. **Trust rotation and expiry.** A kernel with old anchors may reject a new rootfs; a mistaken expiry policy can make offline installed systems unbootable. These require separate tests from download authentication.
8. **Watchdog coverage.** A boot-attempt counter cannot reset a hung board. Automatic recovery claims depend on actual reset coverage from firmware through the health gate.
9. **Writable namespace coverage, cleanup and pressure.** Missing a real writer can break startup or shutdown when var parents become read-only. Cleanup can cross into persistent binds if it traverses runtime paths, and a bulk writer can consume essential capacity if project limits are absent or bypassed. Writer discovery, same-device assumptions, quota inheritance, privileged writers and reset scope need explicit tests.

## Alternatives

| Alternative | Benefit | Cost / decision |
|---|---|---|
| Keep raw rootfs A/B partitions | Existing no-initramfs path and strong separation of slot writes | Does not meet the requested file-storage simplification; rejected as the target |
| File A/B with existing RAUC and GRUB | Less immediate integration churn | Requires custom file/object installation, a root-signature-aware bundle mapping or weaker enforcement, and durable GRUB state work; retained only as a fallback proposal if P1 disproves the selected primitives |
| Verify a whole-image signature once, then mount an unverified loop | Small conceptual installer | Requires a full-image read and does not preserve runtime block integrity; rejected |
| fs-verity on outer files | File-native integrity mechanism | Requires a different boot/trust/metadata design and does not directly reuse the current appended dm-verity image; no reason to switch both mechanisms together |
| Unified DATA with selected writable-path bind mounts | Three total partitions, pooled free space and explicit service mount ordering; var parents stay immutable | Selected; requires writer audit and quota/cleanup changes, and accepts one writable-filesystem failure domain |
| Symbolic links for all writable system directories | Fewer mount units | No mount dependencies or per-mount policy, different pathname semantics and some service restrictions; use binds for the major system directories |
| Put SYSTEM images on the writable DATA filesystem as well | Two total partitions | Couples bootable objects to all user/runtime filesystem writes; outside the requested writable-partition consolidation |
| Static rescue kernel plus kexec into a selected kernel | Centralizes early storage recovery | Adds another maintained kernel and boot handoff; deferred |
| Make all `/var` writable through DATA, tmpfs or overlay | Reduces the need to enumerate individual writers | Exposes unnecessary writable paths and obscures persistence requirements; rejected in favor of an immutable skeleton and explicit writable leaves |

## Evidence and remaining proof

P3-P9 implementation and current artifacts are recorded in the
[active delivery task](../task/20260908-2229-file-ab-delivery-x64-first.md).
x64 and virt-arm64 pass signed full-system boot, root/kernel/combined updates,
health fallback, actual kernel panic/watchdog resets, pre-SYSTEM hangs after
watchdog arming, all three interrupted-reset tiers and complete shutdown.
The TLS durability defect found by panic injection is fixed and those matrices
pass on rebuilt roots. Latest pure factory API acceptance passes 153 checks on
x64 and 151 on virt-arm64. HTTP object acquisition and offline boot with 1970
and 2040 clocks pass. cx3576 passes signed FIT/firmware/image assembly, 123 offline
checks, DATA-only growth and the 14-artifact release gate.

P10 also removes obsolete operating procedures, engineering translations,
exported prototypes and unconsumed raw-layout code. Current documentation has a
task-oriented portal and separate contract/evidence ownership. The complete
documentation and negative-fixture gates pass. Live installation-space sampling
also passes on a fresh x64 image: root/kernel/combined installs retain 51/42/73
samples per partition and complete authenticated reboot/shutdown. Final source
checks and measurement limits are recorded in the delivery task.

Physical cx3576 boot, watchdog handoff, USB maintenance, recovery and power-cut
evidence remain pending bench access. The matrix above is still the acceptance
contract; QEMU reset and deterministic software I/O faults cannot close those
physical rows. P10 and the overall plan are not declared complete.

Planning validation passed: `make docs-verify` (index, links, status, locale coverage and board dossier checks), `git diff --check`, and a separate check of this plan/task's required sections, local links, unique index entries, code fences, and draft/pending states. The repository's general documentation checks exclude plan/task files, so their separate validation is necessary.

Primary references checked during design:

- [Linux dm-verity documentation](https://docs.kernel.org/admin-guide/device-mapper/verity.html): root-hash PKCS#7 verification and on-demand data verification.
- [Linux v6.12 verity signature implementation](https://github.com/torvalds/linux/blob/v6.12/drivers/md/dm-verity-verify-sig.c): signature requirement policy and trusted-keyring selection.
- [Linux v6.12 device-mapper Kconfig](https://github.com/torvalds/linux/blob/v6.12/drivers/md/Kconfig): signature verification configuration and dependencies.
- [Cryptsetup veritysetup manual source](https://gitlab.com/cryptsetup/cryptsetup/-/blob/main/man/veritysetup.8.adoc): signed-root activation interface; validate against the selected packaged version in P1.
- [Linux kernel module documentation](https://docs.kernel.org/kbuild/modules.html): matching module build and installation layout.
- [RAUC v1.13 mapping implementation](https://github.com/rauc/rauc/blob/v1.13/src/dm.c): bundle verity table currently carries no root-hash signature.
- [U-Boot FIT signatures](https://docs.u-boot.org/en/stable/usage/fit/signature.html): required configuration signatures and control-FDT trust keys.
- [Unified Kernel Image specification](https://uapi-group.org/specifications/specs/unified_kernel_image/): kernel/initramfs/command-line packaging.
- [systemd v257 automatic boot assessment](https://github.com/systemd/systemd/blob/v257/docs/AUTOMATIC_BOOT_ASSESSMENT.md): per-entry trials and health-controlled blessing.
- [systemd v257 boot selection](https://github.com/systemd/systemd/blob/v257/src/boot/boot.c): selected-entry handoff through `LoaderEntrySelected`.
- [systemd v257 stub](https://github.com/systemd/systemd/blob/v257/man/systemd-stub.xml): embedded command line and Secure Boot behavior.
- [systemd v257 mount units](https://github.com/systemd/systemd/blob/v257/man/systemd.mount.xml): explicit mount dependencies and source/target constraints.
- [util-linux mount documentation](https://github.com/util-linux/util-linux/blob/master/sys-utils/mount.8.adoc): bind-mount behavior and shared filesystem semantics.
- [Linux ext4 documentation](https://www.kernel.org/doc/html/latest/admin-guide/ext4.html): journal recovery and filesystem mount behavior; project-quota setup remains an implementation proof requirement.

## Annotations

- User requirement: no backward compatibility during development unless explicitly requested.
- User requirement: minimize partitions by keeping A/B rootfs images as files on one filesystem.
- User requirement: separate boot firmware, kernel and rootfs update cadence.
- User request: evaluate kernel public-key verity verification and write a complete plan.
- Scope correction: signatures authenticate the root hash; data hashes remain necessary. No per-rootfs kernel rebuild or per-boot whole-image hash scan is required by the selected design.
- Initial draft proposed five partitions with separate STATE and EPHEMERAL. The user's subsequent request consolidates writable state/meta/var into DATA; section 5 now replaces that layout with three partitions and bind-mounted directories.
- User requirement: writable state, metadata and var should share DATA rather than require additional partitions. This amendment uses bind mounts for major system directories and updates quota, reset, startup and fault-isolation requirements accordingly.
- User correction: do not mount all of `/var`; only required paths should be writable. Section 5 now keeps its parent skeleton immutable, lists initial persistent leaves, requires an enabled-writer audit, and scopes volatile storage, quotas, seeding and cleanup to explicit paths. The previous whole-var DATA bind and VAR budget are superseded.
- Approval: granted on 2026-09-08 at 17:11 and reaffirmed at 22:29 for P3-P10,
  including commit, x64-first boot acceptance and subsequent ARM64/cx3576 work.
  The user subsequently authorized the documentation and dead-code cleanup.
- 2026-09-08 17:11: **Approved by the user for implementation** ("按这个来执行"). Execution
  follows the plan's own sequence: P1 is the feasibility gate and is dispatched
  first; P2 and later wait on P1's evidence. P1 is run as two parallel L3
  tasks with disjoint files — the boot/trust proofs (signed verity on both
  kernel families, cx3576 signed FIT, UEFI shared-UKI Type #1 entries) and
  the writable-path writer audit — because their evidence rows are separate
  and a combined task would serialise ~4 h of builds behind a document audit.
- 2026-09-08 17:19: **User direction: parallel, x64 first.** Parallel
  execution is confirmed. x64 completes each phase first and is verified
  under QEMU (the existing OVMF harness); the same layout is then applied to
  cx3576 and the other boards. P1-A is re-ordered accordingly: stage 1 is
  x64 only (signed verity, two signed roots, veritysetup, systemd-boot/UKI
  Type #1 entries on OVMF) and is reported on its own; stage 2 is the cx3576
  kernel, the cx3576 signed FIT and virt-arm64. P2 for x64 opens on the
  stage-1 report. P1-B proves its runtime claims on x64 under QEMU and lists
  board differences separately.
- 2026-09-08 21:06: **P1 complete, feasible as drafted.** Both P1 tasks merged after
  L1 acceptance by content; no signature or rollback requirement was lowered.
  Facts P2+ inherit: the vendor cx3576 kernel answers the signature policy
  exactly as upstream; policy is the boot parameter, not the symbol; the
  anchor certificate must become a distributed build input or cross-machine
  kernel reproducibility is lost; systemd-random-seed writes through the
  inode, so a file bind serves it; `/var/lib/systemd/{linger,timers}` are
  writers the initial table lacked. P2 dispatched for x64 (`ofu05clu`).
- 2026-09-08 21:50: **P2 complete locally after the user's resumption.**
  `20260908-2115-p2-descriptor-contracts-x64` records the strict shared
  contracts, complete support-metadata binding, signing and explicit public
  trust inputs. x64 QEMU accepts the content certificate before `notBefore`
  and after `notAfter`; root cannot revoke the built-in anchor (`EACCES`).
  Do not use expiry or runtime revocation as a withdrawal mechanism. P9 must
  prove replacement-kernel overlap/removal with a usable fallback. Build
  tests (1,028), focused contracts/signing (42), Rust (68), server (36),
  compiled server, docs and relevant lints passed. P3 producer separation is
  next; P3-P10 remain incomplete.
- 2026-09-08 22:29: The user authorized committing P2 and completing P3-P10.
  P2 is committed as `f22e6cd8`. Complete and boot-test x64 first, then handle
  virt-arm64 and cx3576. Local sequential execution is tracked in
  `20260908-2229-file-ab-delivery-x64-first`; no push or physical key enrollment
  is requested. This supersedes the earlier planning-only scope note.

- 2026-09-09: Full SquashFS runtime testing refines P1's random-seed result.
  `systemd-random-seed` calls `fsync_full`, which syncs both the file and its
  visible parent. The file bind exposes a SquashFS parent whose fsync returns
  EINVAL; P1 used a read-only ext4 parent. Use a fixed file symlink to
  `/mnt/data/state/random-seed`, with explicit Requires/After ordering on
  `mos-seed-state.service`. This preserves the narrow writable file while both
  syncs reach DATA. Startup, shutdown and reboot acceptance remain required.
