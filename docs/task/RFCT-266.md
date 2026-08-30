# RFCT-266 Separate MQTT application data from system management

- **status**: completed
- **priority**: P1
- **owner**: codex/root-mqtt-separation-20260830
- **createdAt**: 2026-08-30
- **plan**: [PLAN-031](../plan/PLAN-031.md) — approved for implementation

## Description

`mos-mqttd` currently mirrors `com.mos.mosd`'s complete `com.mos.Item1`
projection. That turns every projected system setting, live-state value, and
power action into an MQTT read/publication surface and, in full mode, turns
writable system items into an MQTT control surface. SSH is one example, not
the boundary: hostname, networking, Wi-Fi, provisioning, container and MQTT
configuration, service health, update state, and power actions are all system
management concerns and must not be exported through the application data
plane.

Replace the system-tree bridge with an extension-only bridge. Keep device
identity available through one narrow read-only management method, route APID
power operations through the dedicated management methods, and make the
D-Bus policy deny MQTT access to every other system member.

## Acceptance

- `mos-mqttd` discovers and mirrors only class-bearing
  `com.mos.ext.<class>[.<suffix>]` services.
- A system bus name, including `com.mos.mosd`, cannot be inserted into the
  MQTT bridge state or addressed by an MQTT `R` or `W` request.
- MQTT publishes no system settings, state, SSH configuration, or power
  actions; application items and protocol heartbeat/full-publish metadata
  retain their documented behavior.
- The bridge obtains the device identifier through one read-only
  `com.mos.mosd1.GetDeviceId` method that is not projected as an item.
- The `mos-mqttd` D-Bus grant permits only `GetDeviceId` on
  `com.mos.mosd`; application packages must grant their exact extension bus
  name's `Item1` members to the bridge.
- APID invokes `com.mos.mosd1.Reboot` and `PowerOff`, not `/Actions/*` item
  writes.
- The obsolete `com.mos.mosd` Item1 projection and action-item code/tests are
  removed, and a negative contract test pins their absence.
- Retained `N/<device>/mosd/#` migration is documented, including the need to
  purge old broker state because MQTT has no retained wildcard delete.
- Focused tests, the mosd workspace suite, formatting, clippy, policy tests,
  documentation checks, and applicable image verification pass.

## ActiveForm

Separating MQTT application data from the system-management plane.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

The repository-wide audit found that removing only `access.ssh` from
`WRITABLE_SUBTREES` would stop one write path but would leave SSH and every
other system item readable and retained on the broker. The safe boundary is a
positive application namespace allowlist, not a growing system-path denylist.

- complete: Application-only MQTT boundary implemented; Rust workspace, D-Bus policy, docs, APID contract and 1,100 image-verifier tests passed.
