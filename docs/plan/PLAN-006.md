# PLAN-006 Stage 2.0 (alt) - Embedded ARM A/B upgrade via RAUC dual-partition rootfs (disk-backed, zero RAM residency)

- **status**: draft
- **createdAt**: 2026-08-17 00:00
- **approvedAt**: -
- **completedAt**: -
- **relatedTask**: RFCT-005 (to be created on approval)
- **supersedes**: PLAN-005 (alternative design; approving this plan rejects PLAN-005)

## Context

PLAN-005 proposed a single-FIT A/B scheme where the squashfs rootfs travels inside the
initramfs and stays resident in RAM (~80MB compressed for a slimmed appliance rootfs). That
model is clean but has two costs on embedded targets:

- Permanent RAM residency of the compressed rootfs (excludes 256MB boards, taxes 512MB ones).
- A custom Go updater re-implements slot writing, bootcount handling, and power-safe env
  updates — territory where RAUC (the Yocto-ecosystem A/B updater, used in shipped industrial
  products) has years of field hardening.

This plan replaces the payload/installer layers of PLAN-005:

- rootfs lives on **A/B raw disk partitions** (squashfs + dm-verity), mounted from disk —
  zero RAM residency, page-cache only;
- slot installation, slot status, and bootloader handshake are delegated to **RAUC**
  (upstream project; meta-rauc is merely its Yocto packaging — we build upstream RAUC in our
  buildkit pipeline, no bitbake in the OS build);
- delta updates come free via RAUC **adaptive updates** (`block-hash-index`, block devices
  only — which is exactly our slot type) with HTTP(S) streaming of verity-format bundles.

Unchanged from PLAN-005 (these parts carry over verbatim):

- **Uptane trust layer** (Part A of PLAN-005): go-tuf client, image/director repos, offline
  root keys, rollback/freeze protection, META-persisted metadata counters, phases 1/2.
- Health-gated commit, upgrade policy config, lockbox offline updates, power-cut stress
  acceptance, containerd = workload layer only (never in the update path).
- machined remains the update orchestrator; RAUC is a tool it invokes, not a resident daemon.

## Proposal

### Part A: Trust model

As PLAN-005 Part A (Uptane), with one composition change: the update target referenced by
`targets` metadata is a **RAUC bundle in verity format**. A verity bundle is authenticated by
its dm-verity root hash; that root hash (and the bundle's sha256) is pinned in the Uptane
`targets` custom metadata. Verification chain on device:

1. go-tuf client verifies the full TUF metadata set (timestamp -> snapshot -> targets).
2. The bundle's verity root hash from targets metadata is passed to RAUC; RAUC's own CMS
   signature check runs in addition (keys from the same PKI, distinct from TUF online keys).
3. RAUC install verifies every block it writes against the bundle hash tree — streaming
   installs are verified piecewise by construction.

### Part B: Update payload — RAUC bundle

Bundle content (one bundle per release per board family):

```text
update-<version>.raucb  (verity format)
├── manifest.raucm      slots, versions, board compatible string, hooks
├── boot.fit            kernel + dtb (+ optional micro-initramfs), FIT-signed
└── rootfs.img          squashfs + appended dm-verity hash tree (raw slot image)
```

**Rootfs provenance — architectural decision**: `rootfs.img` is the Talos rootfs, byte-for-byte
the same squashfs the buildkit pipeline produces today (machined userland, COSI runtime,
system extensions, SELinux labels), with a dm-verity hash tree appended. Yocto plays no role
in rootfs construction (its only permitted role remains BSP artifacts — kernel/U-Boot — per
the BSP plan). RAUC's scope is strictly transport and slot installation: it writes images and
flips boot order, it never composes, modifies, or owns rootfs content. The runtime mount model
is likewise unchanged Talos: read-only squashfs root + tmpfs runtime overlays + selective
writable files; the only delta vs. today is the squashfs source (verity block device instead
of initramfs loop).

- `compatible` string in the manifest enforces board family match (RAUC-native check,
  complements the Uptane board check).
- FIT content remains bit-identical per release (no device identity inside), as in PLAN-005.
- The rootfs verity **root hash is embedded in the FIT's kernel cmdline**, so the signed FIT
  transitively authenticates the rootfs partition at every boot, not only at install time.

### Part C: Partition layout

```text
raw area (before GPT)   SPL + U-Boot        <- offset provided by board overlay PartitionOptions
 1  BOOT-A     64MB     boot.fit (raw or FAT)
 2  BOOT-B     64MB     boot.fit
 3  ROOTFS-A   ~512MB   squashfs + dm-verity hash tree (raw image)
 4  ROOTFS-B   ~512MB
 5  UENV-A     64KB     U-Boot environment  ┐ redundant pair (holds RAUC BOOT_ORDER state)
 6  UENV-B     64KB     U-Boot environment  ┘
 7  META                Uptane metadata counters, appliance state
 8  STATE               machine config, cached TUF metadata
 9  EPHEMERAL           /var
```

Slot pairing in RAUC `system.conf`: `slot.rootfs.0/1` (raw block device targets) with
`slot.boot.0/1` as children (`parent=rootfs.N`) — a bundle installs kernel and rootfs to the
same slot group atomically from RAUC's perspective.

### Part D: Boot path (zero RAM residency)

1. U-Boot: RAUC-standard env handshake — `BOOT_ORDER="A B"`, `BOOT_A_LEFT`/`BOOT_B_LEFT`
   attempt counters; script decrements the counter, skips exhausted slots, loads that slot's
   `boot.fit`, verifies the FIT signature, boots.
2. Kernel: verity device assembled **without userspace** via `dm-mod.create=` on the signed
   cmdline (verity target support; root hash comes from the cmdline), then
   `root=/dev/dm-0 rootfstype=squashfs ro init=/usr/bin/init`. No initramfs in the normal
   boot path. A micro-initramfs (a few MB) is kept as a fallback profile for kernels/boards
   where `dm-mod.create=` is unavailable.
3. machined starts from the disk-backed rootfs. RAM cost of the OS image: page cache only
   (reclaimable). Works on 256MB boards.

Kernel prerequisites (BSP config fragment, asserted in CI — vendor defconfigs routinely ship
these as `=m`, which does not work without an initramfs): kernel >= 5.1 with
`CONFIG_DM_INIT=y`, `CONFIG_DM_VERITY=y`, `CONFIG_BLK_DEV_DM=y`, `CONFIG_SQUASHFS=y` plus the
chosen decompressor, and the board's storage controller driver built-in; cmdline includes
`rootwait` (async MMC probe).

machined early-boot change: with no initramfs there is no switch_root phase — the kernel
mounts the verity-backed squashfs directly and executes machined as PID 1 from it. The logic
currently living in the initramfs init stage (earliest mount orchestration) folds into
machined's first phase.

Talos mount pipeline changes: the "squashfs from initramfs via loop" step becomes "squashfs
from /dev/dm-0"; tmpfs overlays and STATE/EPHEMERAL mounts are unchanged.

**Rescue boot entry (last-resort recovery)**: `boot.fit` carries a third FIT configuration,
`rescue`, pairing the kernel with a micro-initramfs (~5MB: busybox, e2fsprogs/xfsprogs, RAUC
CLI, verity tools). It is NOT loaded during normal boot and costs zero RAM in operation.
U-Boot selects it only when both slot groups' `BOOT_x_LEFT` counters are exhausted (all
ROOTFS slots unbootable — e.g. verity rejects every block source) or when explicitly chosen
via `talos.rescue=1`. From the rescue environment an operator can reflash slots from a
lockbox on USB/SD. This preserves the existing rescue-extension flow for "rootfs mounts but
system is sick" cases, and adds a path for "no rootfs slot is mountable" cases that would
otherwise mean RMA.

### Part E: Update flow and state machine

```text
IDLE -> SYNC_METADATA -> INSTALLING (RAUC) -> STAGED -(reboot)-> PENDING_CONFIRM -> CONFIRMED
              |                  |                                     |
              +-----> IDLE <-----+                        health gate fail / timeout / power loss
                    (inactive slots discarded,                         |
                     active slots intact)                    ROLLED_BACK <- (BOOT_x_LEFT exhausted)
```

- `INSTALLING`: machined invokes `rauc install <bundle>` (local file for lockbox/full
  download; `https://` URL for streaming/adaptive installs). RAUC writes the inactive slot
  group, verifies blocks against the bundle hash tree, then flips `BOOT_ORDER` and resets the
  attempt counter via the U-Boot backend (fw_setenv, redundant env).
- `PENDING_CONFIRM`: identical health gate to PLAN-005 (machined services, webd healthz,
  optional custom app-ready hook). On success machined runs `rauc status mark-good`
  (resets attempt counter, confirms slot); on failure it does nothing and the exhausted
  counter makes U-Boot fall back on next reboot. ECU version manifest reporting as PLAN-005.
- RAUC is built CLI-only (`-Dservice=false`): no D-Bus, no resident daemon; invoked as a
  short-lived process by machined's updater, output parsed as JSON (`--output-format=json`).

### Part F: Power-loss safety

The invariant is unchanged: at any instant, pulling power leaves the device able to boot into
some working slot. Enforcement is now split:

| Power cut at | Guarantor | Result |
|---|---|---|
| Metadata sync / bundle download | machined | Nothing written; active slots boot |
| RAUC writing inactive slots | RAUC (writes only inactive group) | Active slots intact |
| Slots written, env not flipped | RAUC ordering (env flip is last) | Active slots boot; install restartable |
| Mid-env-write | redundant UENV pair | One valid CRC copy always exists |
| Env flipped, before reboot | - | Next boot tries new slot, trial flow |
| New-slot boot attempts | U-Boot `BOOT_x_LEFT` | Counter exhausts -> next slot in `BOOT_ORDER` |
| New slot up, unconfirmed | health gate + counters | Falls back on next reboot unless mark-good |

The power-cut stress rig and 100% pass criterion from PLAN-005 apply unchanged, now also
serving as acceptance for the RAUC/U-Boot backend configuration on each board.

### Part G: Delta updates — RAUC adaptive

- Bundles are verity-format; server side is still **static HTTP content** (phase 1 property
  preserved — no stateful delta service, no per-version-pair patch generation).
- Client-side `rauc install https://...` with adaptive `block-hash-index`: RAUC hashes the
  blocks of the currently installed slot, then fetches over HTTP ranges only the blocks that
  differ. Adjacent releases download MBs, not hundreds of MBs.
- Requires slot targets to be block devices — satisfied by Part C raw partitions.
- Full-bundle download remains the fallback (and the lockbox path).

### Part H: Offline updates (USB/SD) — Lockbox

As PLAN-005 Part G, with payload = the `.raucb` bundle. TUF metadata set verified first;
then `rauc install <mounted-bundle-path>`. Expired timestamp metadata still invalidates stale
field media; downgrades still require on-device operator confirmation.

### Part I: Update policy configuration

`UpdateConfig` document identical to PLAN-005 Part H (channel, repos, window, AC-power and
battery guards, health gate).

### Part J: Upgrade boundaries

| Object | Policy |
|---|---|
| kernel + dtb | BOOT slot, member of the RAUC slot group (child of rootfs slot) |
| rootfs (squashfs+verity) | ROOTFS slot, same group — upgraded and rolled back as one unit |
| system extensions | Inside the rootfs image (unchanged rationale from PLAN-005) |
| U-Boot / SPL | Future Uptane secondary ECU; separate flow, mandatory AC power, operator confirmation |
| machine config (STATE) | Untouched; versioned migrations must support rollback direction |
| application containers | Future Uptane secondary ECU; independent lifecycle |
| containerd | Workload layer only — never part of the OS update path; updater and RAUC must function with containerd stopped or broken |

### Part K: New C components in rootfs

Accepted cost of adopting RAUC (kept minimal, all built as buildkit pkg stages, no Yocto in
the OS build):

- `rauc` (CLI-only build) + GLib + libcurl (streaming) — ~6-10MB
- `libubootenv` (`fw_printenv`/`fw_setenv`) — RAUC's U-Boot backend requires it; it becomes
  the single owner of env writes. The PLAN-005 Go `ubootenv` package shrinks to a read-only
  helper for status display (env writes from Go are dropped to keep one writer).
- `squashfs-tools` is NOT needed at runtime (RAUC mounts bundles via kernel squashfs).

### Part L: Server-side scope (phase 1)

As PLAN-005 Part J plus: release pipeline produces the RAUC bundle (`rauc bundle` with CMS
signing key), embeds the rootfs verity root hash into the FIT cmdline before FIT signing, and
publishes bundle + TUF metadata as static content. Lockbox builder wraps the same bundle.

### Part M: Code touchpoints

| Path | Action |
|---|---|
| `internal/app/machined/pkg/runtime/v1alpha1/bootloader/uboot/` | New, slimmer than PLAN-005: `GenerateAssets` (dual BOOT+ROOTFS slots, RAUC system.conf, U-Boot boot script), `Install`; `Upgrade`/`Revert` delegate to RAUC CLI |
| `internal/pkg/update/uptane/` | Unchanged from PLAN-005 (go-tuf client) |
| `internal/pkg/update/` | Orchestrator: policy, state machine, RAUC CLI invocation + JSON parsing, ECU manifest |
| `internal/pkg/update/healthgate/` | Unchanged; success path calls `rauc status mark-good` |
| `internal/pkg/ubootenv/` | Reduced to read-only (status display) |
| `internal/app/machined/.../mount` pipeline | rootfs source: verity device instead of initramfs loop; fallback micro-initramfs profile |
| `Dockerfile` | New pkg stages: rauc (CLI-only), glib, libubootenv; rootfs no longer embedded in initramfs for this profile |
| `pkg/machinery/meta/constants.go` | Uptane metadata counters only (slot state now owned by RAUC/env) |
| `pkg/machinery/config/types/update/` | `UpdateConfig` document (as PLAN-005) |
| `internal/pkg/webd/` | Upgrade UI unchanged; reads slot status via `rauc status` JSON |
| udev rule + `services/usbupdate.go` | Lockbox discovery (as PLAN-005) |
| `hack/` (or separate repo) | Release pipeline: verity rootfs build, FIT signing with embedded root hash, `rauc bundle`, TUF signing, lockbox builder |

## Implementation stages

1. Rootfs-on-verity boot path (no RAUC yet): imager produces dual-slot layout; `dm-mod.create=`
   cmdline assembles verity; machined boots from disk
   -> verify: boots on hardware with < 40MB non-reclaimable OS RAM (vs ~130MB in PLAN-005
   profile); tampering any rootfs block causes boot failure (verity), and the FIT cmdline
   root hash is the only trust input.
2. RAUC CLI-only build + system.conf + U-Boot BOOT_ORDER script
   -> verify: `rauc status` reports both slot groups; manual `rauc install` of a local bundle
   flips slots; `BOOT_x_LEFT` exhaustion falls back automatically after 3 failed boots; with
   BOTH ROOTFS slots deliberately corrupted, U-Boot selects the rescue FIT configuration and
   the rescue environment can reflash a slot from a lockbox on USB/SD.
3. Uptane client integration (carryover from PLAN-005 stage 3)
   -> verify: same gates — tampered/expired/regressed metadata rejected before any RAUC
   invocation; bundle hash pinned by targets metadata must match or install refused.
4. machined updater orchestration (policy -> sync -> install -> reboot)
   -> verify: end-to-end version change; STATE preserved; containerd stopped during the whole
   flow.
5. Health gate + mark-good
   -> verify: forced webd failure -> no mark-good -> automatic fallback to previous slot group.
6. Adaptive (delta) streaming install
   -> verify: adjacent-release update transfers < 10% of full bundle size; blocks verified
   piecewise; interrupted stream resumes.
7. Lockbox offline update
   -> verify: as PLAN-005 stage 8 (tampered/expired rejected; downgrade needs confirmation).
8. Power-cut stress test
   -> verify: >= 200 random power cuts across the whole flow; 100% boot to a working slot;
   every row of the Part F matrix exercised. Relay rig as permanent CI infrastructure.
9. Policy gates
   -> verify: no upgrade outside window or on battery.

## Acceptance criteria

1. An Uptane-verified RAUC bundle applied over network (full or adaptive) or from a lockbox
   moves the device to the new version with STATE and EPHEMERAL intact.
2. Broken or unhealthy new versions roll back automatically (BOOT_x_LEFT path and health-gate
   path both demonstrated).
3. Power-cut stress test passes at 100%.
4. Attack coverage on-device: tampered bundle blocks (verity), tampered TUF metadata per role,
   rollback, freeze, wrong-board bundle, all rejected; runtime rootfs block tampering detected
   by dm-verity at read time.
5. OS non-reclaimable RAM cost < 40MB on the reference 512MB board; system boots and updates
   on a 256MB profile.
6. The OS upgrade path functions with containerd stopped or broken; phase-1 server side is
   static content only.
7. Root key rotation exercised end-to-end (as PLAN-005).

## Risks

- RAUC + GLib is the first substantial C userland dependency in the appliance rootfs; version
  bumps and CVE tracking for it must enter the SBOM/scan pipeline (Yocto users get this from
  meta-rauc; we own it).
- `dm-mod.create=` verity support must be confirmed per BSP kernel; the micro-initramfs
  fallback covers gaps but doubles the boot-path test matrix — pick one per board, not both.
  (The rescue FIT configuration's micro-initramfs is exempt from this rule: it exists on all
  boards, is exercised only in recovery, and must be covered by a dedicated test that
  deliberately corrupts both ROOTFS slots and verifies the rescue entry boots and can reflash
  from a lockbox.)
- Two signing systems coexist (TUF roles + RAUC CMS). Key custody documentation must cover
  both; the CMS key is deliberately NOT a TUF online key so a server compromise cannot sign
  bundles.
- Runtime now depends on eMMC health for rootfs reads (PLAN-005's run-from-RAM tolerance is
  given up — accepted, since the appliance's purpose is storage anyway).
- RAUC adaptive requires verity-format bundles and block-device slots; any future move away
  from raw slot images silently loses delta efficiency — record as a constraint in the release
  pipeline.
- U-Boot boot script and RAUC `system.conf` must stay in lockstep per board (slot naming,
  BOOT_ORDER semantics); both are generated by `GenerateAssets` from one source of truth to
  prevent drift.
