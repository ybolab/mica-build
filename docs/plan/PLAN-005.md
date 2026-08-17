# PLAN-005 Stage 2.0 - Embedded ARM A/B upgrade system (U-Boot dual-slot FIT + Uptane-secured updates)

- **status**: rejected (superseded by PLAN-006)
- **createdAt**: 2026-08-16 00:00
- **approvedAt**: -
- **completedAt**: -
- **relatedTask**: RFCT-005 (to be created on approval)

## Context

The appliance targets embedded ARM boards (U-Boot bootloader, eMMC/SD storage, no UEFI). The
current upgrade path is unusable there:

- `v1alpha1_sequencer_tasks.go` `Upgrade` task calls `install.RunInstallerContainer(...)`: it
  pulls an installer container image and runs the install logic inside containerd. This requires
  a registry, network access, and a multi-hundred-MB image download — none of which hold for
  field devices on cellular links or offline sites.
- The existing bootloader implementations (`grub`, `sdboot`, `dual` under
  `internal/app/machined/pkg/runtime/v1alpha1/bootloader/`) assume BIOS/UEFI. There is no
  U-Boot implementation.

Talos has one structural advantage to exploit: the rootfs (squashfs) travels inside the
initramfs, so a full OS upgrade is the replacement of a single FIT file (kernel + dtb +
initramfs), not the rewrite of a rootfs partition. The at-risk write window is "one file plus
one env update", far smaller than image-based schemes (balenaOS hostapp-update, Venus OS
swupdate) that rewrite a whole rootfs partition.

Reference designs consulted: Victron Venus OS (swupdate, dual rootfs, SD-card offline update,
stable/beta/testing channels), balenaOS (delta downloads, A/B rootfs, boot-partition config),
Torizon OS (OSTree + aktualizr, Uptane, Lockbox offline updates, multi-ECU model).

Decision: update security follows the **Uptane standard** (as deployed by Torizon OS /
aktualizr), not an ad-hoc single-signature scheme. Uptane provides role-separated metadata
signing with offline root keys, rollback/freeze-attack protection, a director for per-device
targeting, and a multi-ECU model that later covers application containers and the bootloader
under the same trust chain. The client is implemented in Go on top of TUF primitives
(`theupdateframework/go-tuf`); aktualizr (C++) is not imported.

This plan replaces the installer-container path with a machined-built-in updater consuming
Uptane-verified update targets, an A/B dual-slot BOOT layout driven by U-Boot
`bootcount`/`altbootcmd` automatic rollback, and a health-gated commit step.

Out of scope for this stage: BSP artifact builds (vendor kernel/U-Boot as OCI images),
application-container updates (modeled as a Uptane secondary ECU in a later stage), U-Boot
self-update (secondary ECU, later stage), full director-based per-device campaign management
(phase 2 below defines the increment actually delivered here).

## Proposal

### Part A: Trust model — Uptane

#### A1. Repositories and roles

Standard Uptane layout with two repositories:

- **Image repository**: holds release artifacts (FIT images, later compose bundles) and TUF
  metadata signed by roles:
  - `root` — trust anchor; keys kept offline (HSM/air-gapped signer); rotation supported
  - `targets` — maps target name -> length + sha256/sha512 + custom metadata (board id,
    version, min-from-version, delta bases)
  - `snapshot` — pins consistent metadata set
  - `timestamp` — short-lived; its expiry lets devices detect freeze attacks (a server that
    silently stops serving new metadata) and rollback attacks
- **Director repository**: signs per-device target assignments (which device gets which
  version — staged rollouts, canary groups, explicit downgrades). Runs online with its own
  key set; compromise of director keys alone cannot forge images (image-repo targets must
  match).

Device verification is full TUF verification against both repositories, with the image-repo
`targets` entry as the authority on content hashes. Compiled-in initial `root.json` ships in
the initramfs (covered by the FIT signature), so the trust anchor is immutable at runtime and
updated only through signed root rotations.

#### A2. ECU model

Uptane terms: the device has one **primary ECU** — machined's updater, owning the OS FIT slot.
Planned secondaries (later stages, same trust chain): application docker-compose bundle,
U-Boot/SPL. Each ECU reports an **ECU version manifest** (installed version, signed) which the
updater aggregates and sends to the director — this doubles as the fleet inventory mechanism.

#### A3. Delivery phases

- **Phase 1 (this plan)**: image repository + full TUF client verification on-device;
  channel selection (`stable`/`beta`/`testing`) implemented as targets naming convention;
  no director (device pulls newest eligible target for its board + channel). Director-format
  metadata is still parsed/verified when present so phase 2 is additive.
- **Phase 2 (follow-up plan)**: self-hosted director service for per-device targeting,
  campaigns, and ECU manifest collection. Candidate base: ota-community-edition components or
  a minimal Go director; decision deferred.

Rollback protection: TUF metadata version counters + `timestamp` expiry are enforced on
device; the last-accepted metadata version persists in META so power cycles cannot regress it.
Explicit downgrades are legitimate director-signed targets (phase 2) or operator-confirmed
local operations (offline path, Part G).

### Part B: Update payload

The unit of upgrade is one FIT image per slot: `boot.fit` = kernel + dtb(s) + initramfs
(containing the squashfs rootfs and system extensions). FIT content must be bit-identical
across devices for a given release — no device identity, no runtime-variable data inside the
FIT (required for delta upgrades and content-hash verification).

Transport artifacts referenced by `targets` metadata:

- `boot-<version>.fit.zst` — full payload
- `boot-<from>-<to>.fit.patch.zst` — optional delta (`zstd --patch-from`), listed in the same
  targets entry via custom metadata; after patch application the result MUST hash-match the
  full target's sha256. A delta is a transport optimization only; verification is always
  against the full-target hash.

### Part C: Partition layout

```text
raw area (before GPT)   SPL + U-Boot        <- offset provided by board overlay PartitionOptions
 1  BOOT-A    ~128MB    boot.fit
 2  BOOT-B    ~128MB    boot.fit
 3  UENV-A    64KB      U-Boot environment  ┐ redundant pair
 4  UENV-B    64KB      U-Boot environment  ┘
 5  META                upgrade state machine, last-accepted TUF metadata versions
 6  STATE               machine config, cached TUF metadata — untouched by slot writes
 7  EPHEMERAL           /var — untouched by upgrades
```

Two independent BOOT partitions (not two files in one partition): filesystem corruption must
never take out both slots at once.

### Part D: Upgrade state machine

```text
IDLE -> SYNC_METADATA -> DOWNLOADING -> VERIFYING -> STAGED -(reboot)-> PENDING_CONFIRM -> CONFIRMED
              |               |             |                                 |
              +-----> IDLE <--+-------------+                    health gate fail / timeout / power loss
                    (spare slot discarded,                                    |
                     active slot intact)                            ROLLED_BACK <- (U-Boot bootcount)
```

- `SYNC_METADATA`: TUF refresh (timestamp -> snapshot -> targets, director when present);
  any verification failure aborts before a single payload byte is fetched.
- State persists in META (`pkg/machinery/meta/constants.go`, allocate `UserReserved3`), read
  early in boot.
- `PENDING_CONFIRM` is the core of the design: "new firmware boots" is not success. The commit
  condition is business readiness, evaluated by a health gate:

```yaml
healthGate:
  timeout: 10m
  checks:
    - machined            # all system services running
    - webd                # /healthz responds
    - network             # optional; disabled for offline devices
    - custom: /usr/local/bin/app-ready   # application-defined hook
```

Only when all checks pass does machined write `bootcount=0`, `upgrade_available=0`, and META
state `CONFIRMED`, then report the new ECU version manifest upstream (phase 2). Otherwise the
node is left for U-Boot to roll back on the next reboot; the rollback outcome is likewise
reported.

### Part E: U-Boot contract

Environment variables and boot logic:

```sh
talos_slot=a              # slot to boot
talos_slot_prev=b         # rollback target
upgrade_available=0       # 1 = trial-booting new firmware
bootcount=0
bootlimit=3

# bootcmd: load mmc 0:${slot_part} ${loadaddr} boot.fit; bootm ${loadaddr}
# altbootcmd (automatic rollback):
#   setenv talos_slot ${talos_slot_prev}; setenv upgrade_available 0; saveenv; run bootcmd
```

Required U-Boot config: `CONFIG_BOOTCOUNT_LIMIT=y`, `CONFIG_ENV_OFFSET_REDUND` (redundant env
is a power-safety prerequisite, not optional), `CONFIG_FIT`, `CONFIG_FIT_SIGNATURE`,
`CONFIG_SYS_BOOTM_LEN >= 0x8000000` (Talos initramfs is 100MB+, default 8MB fails with
"Image too large").

Env access from Go: new package `internal/pkg/ubootenv` implementing the CRC32 header +
`key=value\0` sequence format with redundant-copy flag byte. No C dependency (libubootenv is
explicitly avoided).

### Part F: Power-loss safety matrix

Write ordering is fixed: write payload -> fsync -> read back and verify sha256 -> atomically
update env (last step). This yields:

| Power cut at | Result |
|---|---|
| During metadata sync / download | Spare slot invalid; `talos_slot` unchanged -> boots active slot |
| Mid-write of spare FIT | Same as above; active slot intact |
| FIT written, env not yet updated | Boots active slot; upgrade restartable |
| Mid-env-write | Redundant env pair guarantees one valid CRC copy |
| Env updated, before reboot | Next boot enters new slot, normal trial flow |
| During new-slot boot | `bootcount` increments; exceeds `bootlimit` -> `altbootcmd` rollback |
| New slot up but unconfirmed | Same as above |

Invariant: at any instant, pulling power leaves the device able to boot into some working slot.
This is the single non-negotiable property of the design.

TUF metadata caching in STATE follows the same rule: verified metadata is written to a temp
file and renamed; the last-accepted version counters in META are updated only after the rename.

### Part G: Offline updates (USB/SD) — Lockbox

Modeled on the Torizon Lockbox / Venus OS SD flow. An offline bundle is not a bare payload: it
carries the full Uptane metadata set so offline installs get identical security guarantees to
online ones.

```text
lockbox/
├── metadata/     root.json, targets.json, snapshot.json, timestamp.json (+ director set, phase 2)
├── payload/      boot-<version>.fit.zst
└── manifest      bundle description (board ids covered, creation time)
```

- Insertion of removable media -> udev rule triggers `services/usbupdate.go` -> full TUF
  verification against the device's trust root -> normal state machine from VERIFYING onward.
- `timestamp` expiry gives lockboxes a natural validity window: stale bundles are rejected,
  which is desired behavior for field media that outlives its release.
- Progress on tty2; LED/beeper feedback for headless operation. Post-update reboot behavior is
  configurable.
- Explicit downgrade via lockbox requires operator confirmation on-device (webd or console),
  and is recorded in the audit log; metadata for the older version must still verify (root of
  trust never bypassed).

### Part H: Update policy configuration

New config document `UpdateConfig` under `pkg/machinery/config/types/update/`:

```yaml
apiVersion: v1alpha1
kind: UpdateConfig
channel: stable                 # stable | beta | testing
imageRepo: https://update.example.com/image/
directorRepo: https://update.example.com/director/   # optional until phase 2
policy:
  mode: notify                  # off | notify | download | auto
  window: "02:00-05:00"
  requireACPower: true          # never upgrade on battery
  minBatteryPercent: 50
  maxRetries: 3
  retryBackoff: 1h
healthGate:
  timeout: 10m
  checks: [machined, webd]
```

`requireACPower` / `minBatteryPercent` are embedded-specific guards; mid-upgrade battery
exhaustion is the canonical bricking scenario for energy/storage products.

### Part I: Upgrade boundaries

| Object | Policy |
|---|---|
| kernel + dtb + rootfs | Inside FIT; upgraded and rolled back as one unit (primary ECU) |
| system extensions | Inside FIT. Keeping them in STATE creates a version matrix and extension/kernel mismatch on rollback |
| U-Boot / SPL | Future Uptane secondary ECU. Independent, rare, explicitly dangerous: raw area, no A/B protection. Separate flow, mandatory AC power, explicit operator confirmation |
| machine config (STATE) | Untouched. Schema changes go through versioned migrations that must also support the rollback direction |
| application containers | Future Uptane secondary ECU (docker-compose bundle as target); independent lifecycle, same trust chain |
| containerd | Workload layer only (extension services, future application containers). Architectural decision: containerd is never part of the OS update path — the updater lives in machined and must function with containerd stopped or broken |

### Part J: Server-side scope (phase 1)

The image repository is static content (TUF metadata + payloads) servable from any HTTP
server/object store. Required tooling, kept out of the device tree:

- release signing pipeline: generates targets/snapshot/timestamp on each release; root key
  ceremony documented and offline
- delta generation per supported `(from -> to)` pair
- lockbox builder producing the Part G bundle

No stateful update service is required for phase 1; this keeps self-hosting trivial (contrast:
Torizon Cloud is closed; running a full director stack is deferred to phase 2).

### Part K: Code touchpoints

| Path | Action |
|---|---|
| `internal/pkg/ubootenv/` | New: U-Boot env read/write (CRC32, redundant slots) |
| `internal/app/machined/pkg/runtime/v1alpha1/bootloader/uboot/` | New: `Bootloader` implementation (`GenerateAssets`/`Install`/`Upgrade`/`Revert`/`KexecLoad`) |
| `internal/pkg/update/uptane/` | New: TUF/Uptane client (go-tuf based): metadata verification, rollback/freeze protection, target selection, ECU manifest |
| `internal/pkg/update/` | New: download, delta apply, slot write, state machine |
| `internal/pkg/update/healthgate/` | New: commit gate |
| `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer_tasks.go` | `Upgrade` task calls local updater; remove `RunInstallerContainer` path for appliance |
| `pkg/machinery/meta/constants.go` | Allocate `UserReserved3` as upgrade state + last-accepted metadata versions |
| `pkg/machinery/config/types/update/` | New `UpdateConfig` document |
| `internal/pkg/webd/` | Upgrade UI: current version, check/apply, progress, rollback button, downgrade confirmation |
| udev rule + `internal/app/machined/pkg/system/services/usbupdate.go` | Lockbox discovery |
| `hack/` (or separate repo) | Release signing pipeline, delta generator, lockbox builder |

## Implementation stages

Each step has a verification gate; do not proceed on a red gate.

1. `ubootenv` Go implementation
   -> verify: unit tests cover CRC and redundant-slot switching; on hardware `fw_printenv`
   reads values written by the Go side.
2. `bootloader/uboot` wired into imager; dual-slot image produced
   -> verify: manually toggling `talos_slot` boots either slot.
3. Uptane client (`internal/pkg/update/uptane/`) + release signing pipeline
   -> verify: TUF conformance tests pass; tampered metadata of every role rejected; expired
   `timestamp` rejected; metadata version regression rejected across a device reboot
   (META-persisted counters); wrong board id rejected.
4. Full-package upgrade path (metadata sync -> download -> spare slot -> env -> reboot)
   -> verify: version changes; STATE preserved.
5. `bootcount` automatic rollback
   -> verify: deliberately corrupt spare-slot FIT; after 3 boot attempts device returns to the
   active slot unassisted.
6. Health gate + PENDING_CONFIRM
   -> verify: force webd healthcheck failure; device rolls back to the previous version
   unassisted.
7. Delta upgrade
   -> verify: post-apply sha256 matches the full-target hash from targets metadata; wrong base
   version rejected.
8. Lockbox offline update
   -> verify: insertion auto-detected; bundle with tampered payload or metadata rejected;
   expired lockbox rejected; downgrade requires on-device confirmation.
9. Power-cut stress test
   -> verify: >= 200 random power cuts across the whole upgrade flow; device boots into a
   working slot 100% of the time; every row of the Part F matrix exercised.
   A relay-controlled automated rig is recommended as permanent CI infrastructure.
10. Policy gates
    -> verify: no upgrade outside the window or on battery power.

## Acceptance criteria

1. An Uptane-verified update applied over the network or from a lockbox moves the device to
   the new version with STATE and EPHEMERAL intact.
2. A broken or unhealthy new version rolls back automatically with no operator action
   (bootcount path and health-gate path both demonstrated).
3. The power-cut stress test (step 9) passes at 100%.
4. Attack coverage demonstrated on-device: tampered payload, tampered metadata (each role),
   rollback (older metadata version), freeze (expired timestamp), wrong-board target, wrong
   delta base — all rejected before any write to the spare slot.
5. The OS upgrade path functions with containerd stopped or broken (containerd remains on the
   system for extension services and future application workloads — the updater just must not
   sit behind it), and requires neither a registry nor network availability; phase-1 server
   side is static content only.
6. Root key rotation exercised end-to-end on a test device (old root signs new root; device
   follows the rotation).

## Risks

- U-Boot env redundancy misconfiguration silently degrades power safety; mitigated by making
  step 1 hardware verification mandatory per board.
- `CONFIG_SYS_BOOTM_LEN` and RAM headroom vary per board; initramfs decompression peak must be
  validated on the smallest-RAM target early (blocks Part C sizing).
- Delta patching against a non-bit-identical base breaks the delta channel (sha256 gate
  prevents damage); CI must assert FIT reproducibility per release.
- go-tuf API coverage vs. Uptane director extensions: phase 1 uses plain TUF verification and
  isolates director parsing behind an interface so a library gap does not block delivery.
- Root key ceremony is an organizational dependency (offline signer, custody); must be in
  place before the first production release, not before development.
- `timestamp` role requires periodic re-signing (short expiry); the signing pipeline must be
  automated and monitored, or the fleet degrades to freeze-attack alarms.
