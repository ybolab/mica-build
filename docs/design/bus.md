# Device bus and MQTT application-data contract

This document describes the shipped boundary between the mos management plane,
application services, and MQTT. The boundary is positive and package-enrolled:

- `com.mos.mosd1` is a local system-management API. APID is its network-facing
  client; the boot-health gate is its other approved local caller.
- `com.mos.<class>[.<suffix>]` is the uniform service-name grammar. `mosd` is
  therefore an application name too; the name alone grants no capability.
- `mos-mqttd` mirrors only exact service names enrolled by their package. It
  never calls or subscribes to `com.mos.mosd`, even if a malformed package
  tries to enroll that name.

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

The bridge makes no mosd call. mosd renders the already-provisioned topic
identity to `/run/mos/mqttd-device.env` before starting the bridge, and systemd
passes it through `--device-id`. The file is a one-purpose runtime input, not a
general settings export.

mosd still has a D-Bus interface because mosd and APID are separate local
processes: APID needs a typed, policy-controlled IPC boundary to request system
operations. That local management interface is not an MQTT source. Keeping IPC
and remote publication as separate decisions is the point of this boundary.

This is a fail-closed boundary. `mos-mqttd` constructs an application identity
only when `/usr/lib/mos/mqtt-applications.d` contains a regular file whose file
name is that exact, valid D-Bus service name. `com.mos.mosd` is rejected
structurally after loading as a second defence. A sibling service, a wildcard,
or a valid but unenrolled `com.mos.*` name cannot enter bridge state or become a
read/write target.

## 2. Application service contract

An MQTT-visible application owns a well-known name with this grammar:

```text
com.mos.<class>[.<suffix>]
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

At startup the bridge loads the exact enrollment set, installs a bus-side
`NameOwnerChanged` match for the `com.mos` namespace, then performs `ListNames`.
The broad signal match is discovery only: each name is checked against the
exact enrollment set before mqttd asks for its owner, creates a proxy, calls a
method, or subscribes to a signal. This ordering covers applications that
appear during the initial sweep. For each admitted name it:

1. reads the initial root `GetItems` snapshot;
2. watches root `ItemsChanged` signals;
3. associates writes with that exact well-known name; and
4. removes its mirror and retained publications when the owner vanishes.

Watcher generations prevent a late signal from an old owner from repopulating
a service after it has disappeared or restarted.

There is no global `own_prefix` grant and no central mqttd policy. Every
MQTT-enabled application package owns both sides of its admission:

1. an empty enrollment file named for the exact service, for example
   `/usr/lib/mos/mqtt-applications.d/com.mos.sensor.example`; and
2. an exact-name D-Bus policy that lets the application own that name and lets
   `mos-mqttd` access only its `com.mos.Item1` surface.

The policy grants the bridge `GetItems` and `ItemsChanged`, and grants
`SetValue` only when remote writes are part of that application's contract.
It also grants root `GetItems`: mosd's registry (section 7) probes the
service with that call, and the stock system bus denies method calls by
default with no exemption for root. For example:

```xml
<policy user="mos-sensor">
  <allow own="com.mos.sensor.example"/>
</policy>
<policy user="mos-mqttd">
  <allow send_destination="com.mos.sensor.example"
         send_interface="com.mos.Item1"
         send_member="GetItems"/>
  <allow receive_sender="com.mos.sensor.example"
         receive_interface="com.mos.Item1"
         receive_member="ItemsChanged"/>
  <allow send_destination="com.mos.sensor.example"
         send_interface="com.mos.Item1"
         send_member="SetValue"/>
</policy>
<policy user="root">
  <allow send_destination="com.mos.sensor.example"
         send_interface="com.mos.Item1"
         send_member="GetItems"/>
</policy>
```

Do not replace exact destinations with a wildcard or an interface-only grant.
That would let the network-facing bridge address unrelated system services.
An application missing either half fails closed: an unenrolled policy target is
never proxied, while an enrollment with no exact policy fails its initial read
with `AccessDenied` and publishes nothing. Image verification requires the
enrollment, the user-scoped ownership grant, the bridge's `GetItems` and
`ItemsChanged` grants and the root `GetItems` grant to name the same exact
service. `com.mos.mosd` is forbidden on both sides.

Every call the bridge makes into an application is bounded by five seconds.
An application that accepts `GetItems` or `SetValue` and never answers is
recorded as unreachable and the bridge carries on with the others. An
application whose activation fails while it still owns its name -- one that
claims the name before it registers `/`, for instance -- is retried by a
sweep of the bus five seconds later, so it needs no restart of either side.

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
request republishes the current retained `N` value; a read of a path the
application does not publish is ignored rather than answered, so a client
cannot mint retained topics under names of its choosing. A write request must carry
`{"value": ...}` and is forwarded to the uniquely addressed application's
`SetValue`. There is no MQTT write-acknowledgement topic; a successful change
is observed through the later `ItemsChanged` notification.

The default `read-only` mode neither subscribes to nor executes `W` requests.
`full` mode enables application writes. This setting does not weaken the
enrollment gate: system services remain unaddressable in both modes.

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

For authenticated MQTT, enroll a broker account in the existing
`/var/lib/mos/mqtt-broker-users.toml` `[users]` table, then provision the same
username and password in `/var/lib/mos/mqttd-credentials.json`:

```json
{"username":"bridge","password":"<the enrolled password>"}
```

The broker account file must remain readable by `mos-mqtt-broker`. Own the
bridge JSON file by `mos-mqttd:mos-mqttd` with mode `0600`, then restart the
bridge after changing it. The bridge reads this optional file at startup;
absence selects anonymous MQTT, while malformed, symlinked, or publicly readable
files refuse startup. Credentials are never passed as process arguments or
published as application items. The CLI accepts `--credentials-file` when a
different private file is required.

## 7. mosd's service registry

The management daemon separately observes every other `com.mos.*` service for
operator diagnostics. This registry is not an MQTT source and does not grant a
service MQTT eligibility. It records only the service name, class, connection
status, instance, collision flag, and conformance gaps; it never
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
drop the registry entry. The probe is a method call made as root, which the
system bus refuses unless the application's policy allows it; the template in
section 3 carries that grant, and a package without it is reported as having
no `Item1`. Disconnected entries remain visible until an operator
calls `ForgetService`. Class/instance collisions are marked on every connected
side.

The registry and MQTT bridge intentionally have different admission rules.
The registry describes every `com.mos.*` service. MQTT admits only exact
package-enrolled application services and independently fails closed on
collisions.

## 8. Sparkplug B

Sparkplug B is not implemented by `mos-mqttd`. Its birth/death certificates,
sequence numbers, metric aliases, and host coordination are a different wire
contract. A future Sparkplug publisher should sit beside this bridge and reuse
the same exact-enrollment boundary and structural mosd exclusion; it must not
reintroduce the system management tree as telemetry.
