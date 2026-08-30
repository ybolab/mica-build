# Device bus and MQTT application-data contract

This document describes the shipped boundary between the mos management plane,
application services, and MQTT. The boundary is positive and namespace-based:

- `com.mos.mosd1` is the system-management API. APID is its client.
- `com.mos.ext.<class>[.<suffix>]` names application services that may expose
  `com.mos.Item1`.
- `mos-mqttd` discovers and mirrors only the second group. A system service is
  not an MQTT application even if it implements an interface with the same
  member names.

The old `com.mos.Item1` projection on `com.mos.mosd` has been removed. It was
unsafe as an MQTT source because it combined system settings, runtime state,
and actions into the application data plane.

## 1. The management/application boundary

System functions stay on `com.mos.mosd1` and APID. In particular, MQTT does
not publish or control:

- SSH enablement, ports, login policy, passwords, or authorized keys;
- hostname, Ethernet, Wi-Fi client/AP, DNS, or other network configuration;
- provisioning and device credentials;
- console access and web-administration credentials;
- container enablement or container runtime management;
- MQTT broker/bridge configuration or credentials;
- health, reconciler results, service status, or error state;
- software-update state or update actions; or
- reboot, power-off, or any other system action.

APID calls the dedicated management members such as `GetSettings`,
`SetSettings`, `GetState`, `Reboot`, and `PowerOff`. It never routes management
operations through MQTT or application items.

The bridge makes one narrowly scoped management call:
`com.mos.mosd1.GetDeviceId` on `com.mos.mosd`. The returned identifier is used
only as an MQTT topic-address segment. It is not exposed as an item, and the
bridge's D-Bus policy grants no other mosd member.

This is a fail-closed boundary. `mos-mqttd` constructs an application identity
only when the shared bus-name parser reports both:

1. extension origin; and
2. a non-empty application class.

Consequently `com.mos.mosd`, all other `com.mos.<system>` names, names outside
the mos namespace, and the classless name `com.mos.ext` cannot enter bridge
state or become read/write targets.

## 2. Application service contract

An MQTT-visible application owns a well-known name with this grammar:

```text
com.mos.ext.<class>[.<suffix>]
```

The `<class>` segment becomes the MQTT class. The optional suffix distinguishes
several D-Bus services but is not an MQTT address by itself. Each application
publishes `/DeviceInstance`; the numeric value and class form the application
address. A missing or invalid `/DeviceInstance` falls back to `0` so the
service remains diagnosable.

Applications expose `com.mos.Item1`:

```xml
<interface name="com.mos.Item1">
  <method name="GetValue">
    <arg direction="out" type="v"/>
  </method>
  <method name="SetValue">
    <arg direction="in" type="v"/>
    <arg direction="out" type="i"/>
  </method>
  <method name="GetItems">
    <arg direction="out" type="a{sa{sv}}"/>
  </method>
  <signal name="ItemsChanged">
    <arg type="a{sa{sv}}"/>
  </signal>
</interface>
```

`GetItems` and `ItemsChanged` are served at `/`. `SetValue` is called on the
addressed item object path. Each item dictionary carries `value`, `writable`,
and optional `min`/`max`. `SetValue` returns `0` when accepted and a non-zero
application-defined refusal otherwise.

An empty-array value is the D-Bus invalid/removal sentinel. It becomes JSON
`null` on MQTT. That differs from a zero-length retained MQTT payload, which
deletes the retained record.

The application owns its schema, access rules, and source-side redaction. It
must not expose credentials as items. The bridge additionally masks the known
secret-shaped keys `password_hash`, `passwordHash`, `psk`, and `hash`, including
nested object and array values. That mask is defence in depth, not permission
to publish secrets from an application.

## 3. Discovery and D-Bus policy

At startup the bridge installs a bus-side `NameOwnerChanged` match restricted
to the `com.mos.ext` namespace, then performs `ListNames`. This ordering covers
applications that appear during the initial sweep. For each admitted name it:

1. reads the initial root `GetItems` snapshot;
2. watches root `ItemsChanged` signals;
3. associates writes with that exact well-known name; and
4. removes its mirror and retained publications when the owner vanishes.

Watcher generations prevent a late signal from an old owner from repopulating
a service after it has disappeared or restarted.

`os/pkgs/mosd/dist/com.mos.ext.conf` grants extension processes ownership of
the extension namespace only. It does not grant clients access to every
extension. Debian's shipped dbus-daemon 1.12 supports `own_prefix` but cannot
express a safe `send_destination_prefix` client rule.

Every MQTT-enabled application package must therefore ship an exact-name,
user-scoped policy for `mos-mqttd`. It grants `GetItems`, and grants `SetValue`
only when remote writes are part of that application's contract. For example:

```xml
<policy user="mos-mqttd">
  <allow send_destination="com.mos.ext.sensor.example"
         send_interface="com.mos.Item1"
         send_member="GetItems"/>
  <allow send_destination="com.mos.ext.sensor.example"
         send_interface="com.mos.Item1"
         send_member="SetValue"/>
</policy>
```

Do not replace exact destinations with a wildcard or an interface-only grant.
That would let the network-facing bridge address unrelated system services.
An application without its exact grant is discovered but its initial read
fails with `AccessDenied`; nothing is published for it.

## 4. MQTT grammar

The bridge uses one mos-native grammar:

```text
N/<deviceId>/<class>/<instance>/<path>  device -> broker notification
R/<deviceId>/<class>/<instance>/<path>  broker -> device read request
W/<deviceId>/<class>/<instance>/<path>  broker -> device write request
```

Item payloads are JSON objects:

```json
{"value": 42, "min": 0, "max": 100}
```

`min` and `max` are present only when the application supplied them. A read
request republishes the current retained `N` value. A write request must carry
`{"value": ...}` and is forwarded to the uniquely addressed application's
`SetValue`. There is no MQTT write-acknowledgement topic; a successful change
is observed through the later `ItemsChanged` notification.

The default `read-only` mode neither subscribes to nor executes `W` requests.
`full` mode enables application writes. This setting does not weaken the
namespace gate: system services remain unaddressable in both modes.

Device-wide protocol topics have no class or instance:

```text
R/<deviceId>/keepalive
N/<deviceId>/heartbeat
N/<deviceId>/full_publish_completed
```

A keepalive opens a 60-second publication window and requests a full
application republish. Heartbeats are emitted every 3 seconds while the window
is open. Full republishes are limited to one every 5 seconds; repeated
keepalives coalesce. One bridge coordinates all applications, so it emits one
heartbeat and one completion marker per device, not one per application.

Item notifications are retained. Heartbeats and completion markers are not.
When an application disappears, changes instance, or enters an address
collision, the bridge sends zero-length retained publications for topics it
previously owned.

## 5. Address collisions

`<class>/<instance>` must identify exactly one live application. If two
services claim the same address, the bridge fails closed:

- neither service is published at that address;
- reads have no target;
- writes reach neither service; and
- previously retained records for the address are deleted while the device is
  in its live publication window.

When one side disappears or moves to another instance, the remaining unique
application becomes publishable again on the next full publication.

## 6. Broker and lifecycle

`mos-mqtt-broker` is the local `rumqttd`-based broker. `mosd`'s MQTT reconciler
renders broker configuration and starts or stops both MQTT units according to
the management setting `mqtt.enabled`. This lifecycle relationship does not
make the setting itself application data: the bridge cannot read or write the
`mqtt` management subtree.

`mos-mqttd` is disabled in the immutable image and runs as the static,
unprivileged `mos-mqttd` account. Broker connection settings come from the
optional STATE-backed `/var/lib/mos/mqttd.env`; the default bridge mode is
`read-only`.

## 7. Upgrade cleanup for the removed system projection

Older releases may have retained system records under:

```text
N/<deviceId>/mosd/#
```

The new bridge cannot discover those old topics because the system projection
no longer exists, and MQTT has no wildcard retained-delete operation. Upgrading
the device therefore cannot remove unknown retained records automatically.

Before treating an upgraded broker as clean, an operator must enumerate every
retained topic under the exact `N/<deviceId>/mosd/` prefix and delete each one
using a zero-length retained publication or the broker's administrative purge
facility. Back up broker state first when using a broker-wide maintenance
operation. Do not purge `N/<deviceId>/<application-class>/...` topics.

This is a one-time migration for brokers that were connected to a release that
published the mosd system tree. Fresh installations have no `mosd` class
publication path.

## 8. mosd's service registry

The management daemon separately observes every other `com.mos.*` service for
operator diagnostics. This registry is not an MQTT source and does not grant a
service MQTT eligibility. It records only the service name, origin, class,
connection status, instance, collision flag, and conformance gaps; it never
copies the service's arbitrary item values into system state.

A conforming service exposes `com.mos.Item1.GetItems` at `/` and includes these
seven paths from the moment it claims its name:

```text
/Mgmt/ProcessName
/Mgmt/ProcessVersion
/Mgmt/Connection
/DeviceInstance
/ProductId
/ProductName
/Connected
```

The scan is best-effort. Missing Item1 support, mandatory paths, class, or a
usable device instance is reported under `conformance`; it does not make mosd
drop the registry entry. Disconnected entries remain visible until an operator
calls `ForgetService`. Class/instance collisions are marked on every connected
side.

The registry and MQTT bridge intentionally have different admission rules.
The registry describes system and extension services. MQTT admits only
class-bearing extension services and independently fails closed on collisions.

## 9. Sparkplug B

Sparkplug B is not implemented by `mos-mqttd`. Its birth/death certificates,
sequence numbers, metric aliases, and host coordination are a different wire
contract. A future Sparkplug publisher should sit beside this bridge and reuse
the same extension-only admission boundary; it must not reintroduce the system
management tree as telemetry.
