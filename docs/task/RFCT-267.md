# RFCT-267 Decouple MQTT eligibility from D-Bus service names

- **status**: completed
- **priority**: P1
- **owner**: codex/root-mqtt-boundary-20260830
- **createdAt**: 2026-08-30 02:04
- **plan**: [PLAN-032](../plan/PLAN-032.md) — approved for implementation

## Description

The `com.mos.ext.*` namespace introduced by RFCT-266 incorrectly makes a
service name decide whether a service is an application and whether its data
may enter MQTT. All mos processes are applications/services and should use the
uniform `com.mos.<class>[.<suffix>]` grammar. MQTT eligibility is a separate,
explicit application-data contract: a package enrolls its exact service name,
exports only its MQTT-safe `com.mos.Item1` surface, and grants `mos-mqttd` only
the exact members that surface needs.

Remove every MQTT dependency on `com.mos.mosd`. Device identity must be passed
to the bridge as local runtime configuration rendered by mosd, not fetched by
calling the mosd management interface. mosd continues to expose an explicit
local management RPC surface for APID because they are separate processes, but
it must not expose a generic item tree or any MQTT-readable/writable system
state.

## Acceptance

- Application services use `com.mos.<class>[.<suffix>]`; no code, policy,
  package, test, or current contract requires `com.mos.ext.*`.
- A service name alone never grants MQTT eligibility. Each MQTT-visible
  application is explicitly enrolled by exact bus name and exposes a
  deliberately MQTT-safe `com.mos.Item1` tree.
- `mos-mqttd` never calls, subscribes to, or receives a policy grant for
  `com.mos.mosd` or `com.mos.mosd1`.
- mosd renders a validated device identifier into a root-generated runtime
  input that systemd makes readable by `mos-mqttd`; the bridge validates the
  input before it forms MQTT topics.
- `GetDeviceId`, `IdentityProxy`, the global extension ownership policy, and
  the bridge's mosd policy exception are removed.
- mosd exports no `com.mos.Item1`; its settings, live state, SSH, networking,
  provisioning, credentials, containers, MQTT management, health, update,
  and power functions remain outside MQTT in every bridge mode.
- D-Bus policy and image verification prove that the network-facing MQTT
  bridge has zero access to mosd, that application ownership/access grants are
  exact-name rules, and that wildcard or prefix-wide client grants fail.
- The local-management policy states whether the boot health gate is an
  approved narrow exception to APID-only mosd access or is rerouted through an
  APID-owned local endpoint; the implementation matches the approved choice.
- Focused tests, the Rust workspace gates, D-Bus policy tests, documentation
  checks, and applicable image verification pass.

## ActiveForm

Separating MQTT enrollment from D-Bus service identity.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

This task corrects the namespace-based admission model introduced by
RFCT-266. The system/application boundary belongs to interfaces, explicit
enrollment, and exact authorization—not to the spelling of a process name.

- complete: Implemented direct-name exact MQTT enrollment with zero mosd D-Bus access; Rust, live-policy, image verifier/build, API spec, docs, shell, and supply-chain gates pass.
