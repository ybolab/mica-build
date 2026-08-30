# PLAN-032 Decouple MQTT eligibility from D-Bus service names

- **status**: completed
- **createdAt**: 2026-08-30 02:04
- **approvedAt**: 2026-08-30 02:13
- **relatedTask**: [RFCT-267](../task/RFCT-267.md)

## Context

RFCT-266 correctly removed mosd's generic `com.mos.Item1` projection and
stopped publishing system settings, state, and actions through MQTT. Its
namespace model was too strong, however: it made `com.mos.ext.*` mean both
"application" and "MQTT eligible." A D-Bus name identifies a service; it
does not classify every function inside that service or authorize a remote
transport. mosd itself is an application/service, while its current
`com.mos.mosd1` members are system-management functions.

The correct separation already has an important foundation. mosd exports no
root `com.mos.Item1`. APID uses explicit `com.mos.mosd1` methods such as
`GetSettings`, `SetSettings`, `GetState`, `Reboot`, and `PowerOff`. The settings
and live-state trees cross D-Bus only as results of those authorized local RPC
calls; mosd's arbitrary internal objects are not generically projected.

D-Bus remains useful for that narrow path because APID and mosd are separate
processes. APID owns HTTP/TLS/authentication and mosd owns privileged state and
reconciliation, so some local IPC is required. mosd also already consumes
systemd, RAUC, network, and other system D-Bus APIs. Replacing its APID-facing
interface with a private Unix protocol would reproduce request routing,
typing, caller identity, and signals without removing the need for IPC.

Two current details still violate the refined boundary:

1. `mos-mqttd` calls `com.mos.mosd1.GetDeviceId`, and its policy grants that
   method. It is read-only, but it still makes MQTT infrastructure a mosd
   management client.
2. MQTT admission is inferred from `Origin::Extension` and a
   `com.mos.ext.<class>[.<suffix>]` name. Removing that namespace and probing
   every `com.mos.*` name would be unsafe: the bridge would still attempt a
   call to mosd and other non-enrolled services merely to discover whether
   they expose Item1.

The mosd MQTT reconciler already has the validated provisioning device ID and
starts the broker and bridge after rendering `/run/mos/mqtt-broker.toml`.
Therefore it can render a dedicated runtime identity input before the bridge
starts. The bridge must not read `/var/lib/mos/settings.toml`: that file is the
complete management document, not an MQTT configuration surface.

There is also a distinction to settle in "only APID may operate mosd D-Bus."
Today `apid.service` and the boot health gate run as root, and
`com.mos.mosd.conf` grants all root processes. The health gate directly calls
`ReportHealth`; dbus-daemon therefore cannot currently prove APID process
exclusivity. The minimal boundary can make APID the only network-facing
management entry while retaining the narrow local health reporter. Literal
process-level exclusivity requires a dedicated APID user and rerouting the
health report, which is a larger security change.

## Proposal

1. Replace the special extension grammar with one uniform service grammar,
   `com.mos.<class>[.<suffix>]`. The third component is the class for every
   service. Remove `Origin::Extension`, `EXTENSION_PREFIX`,
   `EXTENSION_NAMESPACE`, and `com.mos.ext.conf`; require each package to ship
   an exact ownership policy for its own service name.
2. Make MQTT enrollment explicit and package-owned. Add an immutable
   application manifest directory (proposed:
   `/usr/lib/mos/mqtt-applications.d/`) whose entries name exact D-Bus
   services. `mos-mqttd` watches and activates only those names; it does not
   probe arbitrary `com.mos.*` services. An application package installs both
   its enrollment entry and exact, user-scoped D-Bus grants for
   `com.mos.Item1.GetItems`/`ItemsChanged`; it adds `SetValue` only when remote
   writes are part of its contract.
3. Define `com.mos.Item1` as the MQTT application-data interface, independent
   of process identity. Its owning application must expose only values and
   controls deliberately intended for remote publication. System management
   members remain on explicit local interfaces such as `com.mos.mosd1` and
   never become Item1 merely because mosd is also an application.
4. Remove all bridge-to-mosd D-Bus traffic. Extend the MQTT reconciler to
   render a dedicated `/run/mos/mqttd-device.env` from the validated
   provisioning device ID before starting `mos-mqttd.service`. Make the unit
   require that runtime file and pass `--device-id` to the bridge. Keep broker
   connection/operator settings in `/var/lib/mos/mqttd.env`; do not expose the
   full settings document to the bridge.
5. Remove `GetDeviceId` from `com.mos.mosd1`, delete `IdentityProxy` and the
   bridge's system policy file/exception, and add negative policy and
   introspection tests proving `mos-mqttd` has no access to any mosd member or
   signal across all installed policy fragments.
6. Update discovery, protocol, bus-name, registry, live-bus, systemd, installer,
   verifier, API notice, architecture/design, and bilingual contract tests.
   Test names should use direct examples such as `com.mos.sensor.abc123`.
   MQTT topics retain `<class>` and therefore do not need a wire migration for
   this rename; the existing one-time purge of legacy `mosd` retained topics
   remains required.
7. For local mosd management, implement one approved policy variant:
   - Recommended minimal boundary: APID is the sole network-facing management
     path; retain and document the boot health gate as one local,
     `ReportHealth`-only system exception. Moving APID off root can then be a
     separate hardening task.
   - Literal APID-only boundary: run APID under a dedicated static identity,
     grant that identity the required `com.mos.mosd1` members, replace its
     privileged-port need with `CAP_NET_BIND_SERVICE` or socket activation,
     and route the boot health result through an APID-owned, local-only IPC
     endpoint so the health gate has no mosd D-Bus access.
8. Establish RED with direct-name admission, explicit-enrollment, runtime
   identity, and zero-mosd-access assertions; implement to GREEN; then run the
   focused suites, full mosd workspace gates, D-Bus live policy test,
   documentation checks, and applicable image verifier suites.

## Risks

- A global `own_prefix="com.mos"` or interface-only client grant would let an
  unprivileged or network-facing process address unrelated system services.
  Exact ownership, exact enrollment, and exact destination/member grants must
  be verified across every installed policy fragment.
- The enrollment manifest and D-Bus policy describe the same application from
  two sides. Packaging validation must fail if one exists without the other,
  instead of leaving a silently undiscoverable or over-authorized service.
- Runtime identity rendering must validate shell/environment escaping, file
  mode, ownership, startup ordering, and stale-file behavior. The bridge must
  still validate the final topic segment itself.
- Direct names remove a structural namespace gate. The explicit enrollment
  type must be the only constructor for an MQTT application so a raw bus name
  cannot be inserted into bridge state or used as a write target.
- Literal APID-only enforcement changes APID privileges and the boot health
  path, both of which participate in update confirmation. A mistake could make
  the dashboard unavailable or cause healthy updates to roll back, so this
  variant needs broader image/boot verification.

## Scope

The namespace and bridge correction spans `mos-busname`, `mos-mqttd`, mosd's
MQTT reconciler and bus interface, systemd units, D-Bus policy, install/image
verification, integration tests, architecture/design documentation, API
notices, and the changelog. The recommended local-policy variant is already a
broad cross-module refactor. Literal APID process isolation additionally spans
APID state ownership and port binding plus the rootfs boot health gate.

No MQTT wire grammar, broker authentication/TLS feature, application runtime
installer, or generic remote system-management channel is introduced.

## Alternatives

### Discover every `com.mos.*` service and try `GetItems`

Rejected because a name does not authorize MQTT. It would make the
network-facing bridge call non-enrolled services—including mosd—to learn that
it should not call them, and would turn D-Bus denial into noisy runtime
discovery rather than a positive application contract.

### Use the presence of `com.mos.Item1` as the only enrollment marker

Rejected as insufficient on its own. Discovering an interface requires a call
or introspection, and an accidental Item1 implementation would become remotely
visible. An explicit package manifest plus exact policy keeps admission
reviewable and fail-closed.

### Let `mos-mqttd` read `/var/lib/mos/settings.toml`

Rejected because it would give the network-facing bridge read access to the
complete management document and couple it to schema and persistence details.
A one-purpose runtime identity file exposes less authority.

### Keep `GetDeviceId` as a narrow D-Bus exception

Rejected because it contradicts the requested zero MQTT-to-mosd dependency and
is unnecessary when mosd already controls bridge lifecycle.

### Merge APID into mosd

Rejected because it would put HTTP/TLS/authentication and network parsing in
the privileged state/reconciliation process. A narrow local RPC interface
preserves failure and privilege separation.

## Annotations

- On 2026-08-30 the user corrected RFCT-266: `com.mos.ext` is unnecessary;
  applications, including mosd, may use direct `com.mos.*` names. System
  operations and readable/writable system state must remain absent from MQTT,
  and MQTT must not operate mosd's D-Bus interface.
- The earlier approval question was resolved in favor of the recommended
  network-boundary interpretation with a narrow boot-health exception.
- On 2026-08-30 the user approved the recommended boundary. "mosd should not
  publish any D-Bus" is implemented as a transport boundary: no mosd D-Bus
  member, signal, item, or value may enter MQTT and `mos-mqttd` has zero mosd
  D-Bus access. The explicit local management interface remains for APID and
  the approved `ReportHealth`-only boot-health exception.
- Implemented exact package enrollment, direct service names, runtime identity
  delivery, structural `com.mos.mosd` exclusion, and user-scoped exact D-Bus
  ownership/Item1 policy verification. Removed the legacy namespace and mqttd
  policy files plus the `GetDeviceId` bridge dependency.
- Verification passed 830 Rust tests plus doctests and strict Clippy, 36 live
  D-Bus policy checks, 1,063 image-verifier tests, 689 image-build tests, 38
  APID schema-pin checks, 48 documentation-index checks, four negative
  documentation cases, and the 31-file shell pipefail audit. `cargo deny`
  passed advisories, bans, and licenses.
