# PLAN-031 Separate MQTT application data from system management

- **status**: completed
- **createdAt**: 2026-08-30
- **approvedAt**: 2026-08-30
- **relatedTask**: [RFCT-266](../task/RFCT-266.md)

## Context

The current runtime hard-codes `com.mos.mosd`, calls `GetItems` on its root
`com.mos.Item1`, subscribes to its `ItemsChanged`, and forwards full-mode `W`
requests to its per-item `SetValue`. The projection contains the complete
non-secret settings and live-state trees plus `/Actions/reboot` and
`/Actions/poweroff`. Consequently read-only mode still publishes and retains
system management data, while full mode also controls every projected
writable subtree, including `access.ssh`.

The shared bus-name parser already distinguishes system names from extension
names: only `com.mos.ext.<class>[.<suffix>]` has `Origin::Extension` and a
usable class. mosd's registry already watches those names, but it records only
metadata and does not proxy their item values. The MQTT runtime therefore
needs its own extension-only discovery and signal bookkeeping.

The MQTT bridge currently obtains its topic device identifier from the system
item tree. Removing that tree requires a private identity source. The existing
`com.mos.mosd1` management interface can expose one read-only `GetDeviceId`
member, and D-Bus policy can grant exactly that member without exposing
settings, state, power, updates, credentials, or the obsolete item façade.

APID currently uses `/Actions/*` solely for reboot and power-off. The same
management interface already exports dedicated `Reboot` and `PowerOff`
methods with the same logging and audit behavior, so APID can stop depending
on the system item façade before that façade is removed.

Debian's shipped dbus-daemon 1.12 policy language has `own_prefix` but no
destination-prefix rule. A generic policy therefore cannot safely grant
`mos-mqttd` access to every present and future extension while denying every
system service. Each application package must grant the exact extension bus
name and the required `Item1` members; absent policy remains a fail-closed
`AccessDenied` that the bridge logs.

## Proposal

1. Add a typed application identity accepted only when `mos-busname` reports
   `Origin::Extension` and a non-empty class. Make the MQTT state machine take
   that type, so no caller can add `com.mos.mosd` or another system service.
2. Refactor the bridge into a device-wide coordinator over multiple
   application mirrors. Keep one heartbeat, one keepalive window, one
   subscription set, and one full-publish completion marker. Route `R` and
   `W` by class and `/DeviceInstance`; fail closed on address collisions.
3. Discover extension names with a bus-filtered `NameOwnerChanged` stream and
   an initial `ListNames` sweep. Seed each application from `GetItems`, watch
   its `ItemsChanged`, clear its retained topics when it disappears, and
   associate every `SetValue` effect with the exact application bus name.
4. Add `GetDeviceId` to `com.mos.mosd1`, grant only that member to the static
   `mos-mqttd` user, and remove the bridge's `GetItems`, `ItemsChanged`, and
   `SetValue` grants on `com.mos.mosd`.
5. Change APID power calls and their private-bus contract tests to use
   `Reboot` and `PowerOff` methods.
6. Remove mosd's system `com.mos.Item1` projection, action items, watcher, and
   obsolete tests. Add a negative introspection assertion proving the root
   object no longer exports `com.mos.Item1`.
7. Update the English architecture/design documents, the corresponding
   Chinese architecture/design documents needed to avoid a contradictory
   shipped contract, unit/policy comments, verifier expectations, and the
   changelog. Document exact-name D-Bus grants for applications and retained
   system-topic cleanup during upgrades.
8. Establish RED with protocol, APID power, and D-Bus-policy assertions;
   implement to GREEN; then run focused suites, workspace gates, repository
   document checks, and applicable image verifier tests.

## Risks

- Multi-service liveness must not emit duplicate heartbeat or completion
  markers; coordination belongs at device scope.
- Two applications can claim the same class and instance. Routing a write to
  either would be ambiguous, so both addresses must be withheld until the
  collision clears, and previously retained topics must be deleted.
- Service appearance, disappearance, and `ItemsChanged` signals race. Watchers
  need generation/owner tracking so stale signals cannot repopulate a vanished
  application.
- Existing brokers may retain old `N/<device>/mosd/#` values after the new
  bridge no longer knows those topics. The upgrade cannot wildcard-delete
  MQTT retained records and must state an explicit broker cleanup step.
- An application without an exact D-Bus client grant will be discovered but
  cannot be read. This is intentionally fail-closed and must be surfaced in
  logs and application-integration documentation.

## Scope

Expected implementation changes span `mqttd` protocol/runtime/source tests,
the mosd management interface and startup wiring, APID's bus client and power
contract tests, D-Bus policy and its live-bus test, image verifier fixtures and
expectations, systemd comments, architecture/design documentation, and the
changelog. No MQTT broker ACL feature, TLS feature, APID HTTP schema change,
or application supervision mechanism is introduced.

## Alternatives

### Remove only `access.ssh` from the writable list

Rejected because read-only MQTT would still publish SSH, and every other
system function would remain bridged. Future system settings would also be
exported by default.

### Keep `com.mos.mosd` bridged and filter system paths

Rejected because the safe list would have to classify every current and
future system path, and one missed path would fail open. Namespace-level
application admission is smaller and fail-closed.

### Run one configured bridge process per application

Rejected because it duplicates device heartbeat/keepalive semantics, requires
manual unit instantiation, and does not follow application name ownership on
the bus.

### Grant `com.mos.Item1` members for every D-Bus destination

Rejected because dbus-daemon 1.12 cannot constrain that grant by destination
prefix. A wildcard member grant would let a compromised network-facing bridge
call system services that happen to implement `Item1`.

## Annotations

- The user approved implementation on 2026-08-30 after directing that SSH and
  every other system function be strictly separated from MQTT application
  publication and control.
- Completed on 2026-08-30. Verification passed the 829-test Rust workspace
  nextest suite, clippy with warnings denied, doctests, dependency policy,
  46 live D-Bus policy checks, 48 documentation-index checks and four negative
  cases, 1,100 image-verifier tests, 47 APID harness self-checks, 38 API spec
  pins, and the 31-file shell pipeline lint.
