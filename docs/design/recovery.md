# Recovery and reset

Recovery starts with diagnosis and the retained signed deployment. Reset
changes writable namespaces; it does not repair SYSTEM, replace a kernel or
undo arbitrary application-data changes. All development acceptance starts
from a complete current image.

## 1. Failure boundary

Native UEFI/FIT boot records bound candidate attempts and retain a usable
confirmed fallback. Exhausted or failed deployments are not silently retried
with replenished counters. Shared SYSTEM or DATA failure requires explicit
recovery; switching roots cannot repair a shared filesystem.

See [updates](updates.md), [storage](storage.md) and the
[boot contract](uboot-ab-handshake.md). Firmware replacement is an independent
[maintenance operation](release-signing.md).

## 2. Reset tiers

### 2.1 Scope and survivors

The API and `mosd_settings::ResetTier` expose exactly three tiers. The executor
is `pkgs/mosd/mosd/src/reset.rs`.

| Tier | Removed or reseeded | Preserved |
|---|---|---|
| `configuration` | `/mos/config`; modeled settings return through first-boot provisioning | Device identity and secrets, management credential/claim/API tokens, applications and operator data |
| `application-data` | `/mos/apps`, `/mos/containers`, `/srv`, DATA/state Quadlet and local-unit enrollments | Settings, identity, credentials, custom UI, update workspace and other system namespaces |
| `full-factory` | Managed `/mos` contents, `/srv`, application enrollments and management settings/credentials | Device identity and per-device secrets; persistent service files outside the removal allowlist |

Every tier preserves SYSTEM, boot records and DATA/meta lifecycle/deployment
state. Calibration outside the removal allowlist remains untouched. TLS identity,
machine ID and other preserved service files are not recreated as new identities.
Full factory reset is not media sanitization and does not mean every DATA byte
is erased.

Configuration reset clears the whole public configuration directory, including
documents not represented as modeled settings. Application reset removes unit
enrollments together with their payloads. Configuration and full-factory reset
mark provisioning pending so the normal initializer reestablishes defaults from
the preserved device identity and immutable image profile.

### 2.2 Intent, execution and interruption

`apid` authorizes the requested tier and stages one durable reset intent in the
settings tree. The next `mosd` startup applies that tier before normal
reconciliation. The executor validates the physical DATA/state paths, rejects
symlinked roots and nested mounts, and takes the same transaction lock used by
installation. Traversal is bounded in depth, entries and elapsed time.

Deletion uses the tier's allowlist and synchronizes changed directories. The
settings save that clears the intent occurs last. A failed or interrupted apply
retains its intent and retries the same scope; it never escalates to a broader
tier. Successful repeated boots are idempotent.

Configuration and application-data reset require authenticated management
authority. Full factory reset also requires the physical-presence gate below.
Direct execution in a test fixture does not prove that a board has a qualified
physical entry mechanism.

## 3. Operator sequence

1. Capture console logs and authenticated deployment state. If the API runs,
   collect its bounded diagnostic snapshot and storage observations.
2. Allow native trial exhaustion to select a usable fallback, or request an
   eligible rollback through the API and reboot separately.
3. Correct configuration or install a newly signed higher-generation deployment
   when the running system and storage support the operation.
4. Use a reset only when its documented data scope addresses the fault. Preserve
   needed operator data before an authorized destructive operation.
5. For an unbootable shared store or exhausted deployments, diagnose on an
   external service host or flash the complete current image. A complete reflash
   replaces media contents and is not a data-preserving repair.

## 4. Physical presence

The board declaration `BOARD_RECOVERY_ACTIONS` describes available mechanisms.
The runtime presence gate requires a supported, bounded assertion and consumes
it for the authorized operation. It is separate from ordinary authentication
and never inferred from an API caller's claim to be standing near the device.

Current boards declare no qualified OS recovery action. Presence-gated full
factory reset and credential recovery therefore refuse through the normal
field API. An available firmware console or RockUSB loader transport does not
by itself create an OS presence assertion. Board qualification must establish
the physical action, handoff, expiry and single-use behavior before advertising
that capability.

## 5. Credential recovery

Recovery replaces a credential under the presence gate; it never reads back a
password or a private key. Credential rotation and reset are distinct actions.
Audit records capture the outcome without exposing secret material. Ordinary
login failures cannot clear persistent brute-force counters by rebooting.
The recovery-specific counter behavior is tested with the credential route.

See [access](access.md) and [provisioning](provisioning.md) for authentication,
claiming and first-device identity ownership.

## 6. Unbootable systems

### 6.1 Exhausted deployments

UEFI and cx3576 stop when no usable authenticated boot record remains. Capture
the native entries or redundant FIT records together with the console log.
There is no unsigned escape path or counter refill to conceal the failure.

### 6.2 Shared-store repair

Bounded journal replay during startup is not a general filesystem repair
service. MOS ships no separate rescue OS or automatic data-preserving repair
operation. External diagnosis and a complete current reflash remain explicit
service operations; neither inherits a data-preservation guarantee from A/B.

### 6.3 Emergency shell utility

The emergency BusyBox executable is inside the same authenticated root. It is
a diagnostic utility when that root can be mounted, not an independent recovery
environment for a damaged root or unavailable SYSTEM.

## 7. Sanitization

There is no secure-wipe reset tier. File deletion does not establish removal
from flash remapping, spare blocks or external backups. No board-level erase
qualification is implied by reset or by complete-image flashing.

## 8. Acceptance evidence

x64 and virt-arm64 QEMU cover signed startup, health confirmation, exhausted
trials, panic/watchdog fallback and complete shutdown. Interrupted-reset tests
kill the real reset applier after a successful deletion, then verify retry,
scope preservation and a further idempotent boot for each tier.

cx3576 has offline image/FIT verification and firmware-policy tests. Its
physical startup, watchdog handoff, recovery and power-cut behavior require the
[bench runbook](../bsp/cx3576-bench.md). Boot assurance and recovery capability
are separate claims. Exact artifacts, results and pending checks live in the
[delivery record](../task/20260908-2229-file-ab-delivery-x64-first.md).
