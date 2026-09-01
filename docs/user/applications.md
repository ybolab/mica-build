# Applications

mos supports two application delivery paths, and they differ by who releases
them and when:

1. **Native applications** are composed into the signed system image as
   build-time Debian packages. They update and roll back with the OS, inside
   the same signed A/B bundle, and they are an integrator capability — there
   is no on-device package installation, no `apt` on the device, ever.
2. **Containers** are the independently released path: pinned OCI images run
   by podman through systemd's Quadlet generator, delivered and updated on the
   integrator's own schedule, surviving OS updates untouched.

The default customer for both is a trusted product integrator, not an
untrusted marketplace — the security consequences of that are stated plainly
below.

## 1. Native applications: packages in the image

The root filesystem is composed from a local Debian package pool in one APT
transaction onto a pinned base. An integrator's native service is one more
producer in that pool: a `.deb` carrying the binary, its hardened systemd
unit, and its own enablement symlinks. Dependency ordering is `Depends`;
adding a component is adding a producer, not editing a build stage. The result
ships inside the verity-sealed root and is updated only by shipping a new
signed image.

> status: shipped — evidence: `docs/design/build.md`, `build-env/deb/`, `rootfs/packages/`

A concise, tested integrator guide for this path — packaging conventions,
dedicated users, writable-path selection, device access, resource limits — is
planned and not yet written; until it lands, the build design record above and
the existing producers under `rootfs/packages-src/` are the working examples.

> status: proposed — evidence: `docs/plan/PLAN-051.md`

TODO(PLAN-051): revisit after this plan merges

## 2. Containers: podman and Quadlet

The image ships the engine (podman, crun, conmon, netavark, aardvark-dns, the
Quadlet generator), built from pinned upstream source. mos does not
orchestrate containers: you describe workloads in systemd's terms —
`.container`, `.network`, `.volume` files — and Quadlet turns them into units.
The integrator's guide with tested examples is
[../design/containers.md](../design/containers.md); every example in it is fed
through the shipped generator by the test suite (`make os-quadlet-doc-test`),
so an example that stopped working fails the build rather than lingering in
the documentation.

The operating facts an operator needs:

- **One switch.** `container.enabled` in the settings tree, `false` by
  default. While it is false, nothing runs and no container unit exists.
  It is set through the authenticated API or the Services page of the UI.
- **Where definitions go.** `/etc/containers/systemd`, which is a bind of a
  STATE-backed directory — definitions survive reboots and A/B updates. After
  adding or changing a file: `systemctl daemon-reload`, then start the unit.
- **Where data goes.** Named volumes land under `/srv/containers/storage` on
  DATA; bind-mount host paths under `/srv`. Never `/var` — it is small,
  disposable, and wiped by design ([storage.md](storage.md)).
- **Logs** go to the journal (`journalctl -u <name>.service`), which is
  volatile.
- **No automatic image updates.** There is no auto-update timer; pulling a
  new image and deciding when a restart is safe is the integrator's, for the
  same reason OS updates are A/B and deliberate.

> status: shipped — evidence: `docs/design/containers.md`, `make os-quadlet-doc-test`, `pkgs/podman/versions.env`

Two security truths, stated as the design record states them:

- **Containers run as root.** Rootless mode is not built. Anything that can
  write a Quadlet file can run code with root's capabilities; that is what the
  switch gates and why it defaults to off.
- **Image signatures are not verified.** The shipped policy accepts anything;
  what protects a pull is registry TLS and a digest reference. Deployments
  that can distribute a key can tighten the policy — the containers guide
  names the mechanism.

> status: shipped — evidence: `docs/design/containers.md`

## 3. Applications on the bus, and MQTT

The management plane and application data are separated by contract.
Applications that want to publish live data expose the `com.mos.Item1`
interface under a well-known name `com.mos.<class>[.<suffix>]`, and the
`mos-mqttd` bridge mirrors **only** services enrolled by their package, by
exact name, onto the local MQTT broker using the
`N/R/W/<deviceId>/<class>/<instance>/<path>` grammar. Management concerns —
network, SSH, credentials, updates, power, container enablement — are never
MQTT items, and the bridge structurally cannot address the management daemon.
The full contract, including enrollment, D-Bus policy, collision handling and
the default read-only bridge mode, is
[../design/bus.md](../design/bus.md).

> status: shipped — evidence: `docs/design/bus.md`, `pkgs/mosd/mqttd/`

## 4. Application UI

apid can serve an integrator's web UI in place of the built-in one: a custom
bundle installed under `/srv/ui` on DATA is served at `/`, while the built-in
UI remains reachable at `/ui` regardless of custom-bundle state — a broken
custom UI can never lock you out of management. Selection is an API action;
see [api.md](api.md).

> status: shipped — evidence: `docs/design/api.md`, `pkgs/mosd/apid/openapi.json`

A dedicated HDMI kiosk rendering the same UI on an attached screen is a
design with no shipped implementation in this repository.

> status: unsupported
