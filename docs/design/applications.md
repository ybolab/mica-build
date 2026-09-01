# Managed applications

This document defines the planned local application product for mos. It is an
approved design boundary, not a statement that application management ships
today. The current OpenAPI has no `/api/v1/apps` or `/api/v1/app-catalog`
routes, and the image has no `mos-appd` implementation.

The first implementation target is a vendor-curated, signed OCI catalog.
Managed native programs are a later phase. A public publisher marketplace,
fleet rollout and arbitrary local root workloads are out of scope.

## 1. Product boundary

Applications and Services are separate product areas:

- **Services** controls mos system capabilities, currently the global
  container runtime and MQTT switches.
- **Applications** inventories products, explains their origin and trust,
  installs catalog releases, and owns their local lifecycle and data-retention
  decisions.

The application inventory contains four source classes:

| Source | Meaning | Manager authority |
|---|---|---|
| System | Native code in the immutable OS image | Observe only; RAUC owns update and rollback |
| Catalog | A release from the vendor-curated signed catalog | Full managed lifecycle |
| Local trusted | A release signed by a device-enrolled integrator key | Full managed lifecycle when this opt-in capability exists |
| External/unmanaged | A discovered service, handwritten Quadlet or unit | Observe only; never adopt, update or remove |

The source class is independent of runtime kind. A managed artifact has kind
`oci` or `native`; neither kind alone proves its source or safety.

## 2. Security posture

The shipped container runtime is rootful, and a systemd unit can request
root-equivalent host access. Artifact signatures authenticate a publisher and
an exact digest; they do not turn unrestricted runtime declarations into a
sandbox.

The managed contract therefore has these non-negotiable rules:

1. Catalog releases are signed and artifacts are pinned by digest. Unqualified
   image names and mutable tags are not admission inputs.
2. The service, UI and public API never accept a raw systemd unit, Quadlet
   file, shell command or arbitrary absolute host path.
3. A native catalog bundle carries a declarative runtime manifest. The manager
   generates a namespaced, hardened `mos-app-<id>.service` from that manifest.
4. Raw signed units remain a trusted-integrator mechanism outside the catalog.
   Their signature proves who supplied the unit, not that its privileges are
   safe.
5. Artifact acquisition runs without activation privilege. Privileged
   activation re-validates the exact digest, signature, manifest and staged
   tree before publishing runtime definitions.
6. Native catalog admission remains disabled until mos provides a non-root
   application identity, a reviewed systemd sandbox profile and boot-time OS
   compatibility enforcement.
7. No UI text claims hostile multi-tenant isolation on the current rootful OCI
   runtime.

## 3. Signed application manifest

One normalized, versioned manifest describes both managed kinds. The signed
payload includes at least:

| Group | Required information |
|---|---|
| Identity | schema version, stable app id, display name, vendor, version, release notes |
| Artifact | kind, exact digest, signature identity, acquisition size |
| Compatibility | architecture, board/profile, mos API/schema range, minimum/maximum system version |
| Interfaces | host ports, networks, device nodes, D-Bus names, MQTT classes/topics and mounts |
| Storage | persistent volume declarations, minimum/reserved size, retention and data schema version |
| Secrets | named secret references and their consumers; never secret values |
| Resources | CPU, memory, PIDs and I/O ceilings plus requested Linux capabilities |
| Runtime | entry point selected from a constrained schema, dependencies, restart policy and health check |
| Update | migration compatibility, code/data rollback promises and last-known-good eligibility |
| Supply chain | license, SBOM/provenance references, support and revocation identity |

The app id is a stable, normalized product identity. It is not an image
reference, unit name or D-Bus service. One application may own multiple
runtime units or `com.mos.*` application services; a discovered service need
not correspond to an installed application.

The manager assigns namespaces and runtime names. It rejects a release before
activation when ports, devices, D-Bus names, MQTT ownership, storage paths or
other exclusive resources conflict.

## 4. Lifecycle and state model

An application exposes three independent state axes:

- **desired:** absent, installed-disabled or installed-enabled;
- **runtime:** stopped, activating, running, failed or blocked;
- **health:** unknown, healthy, degraded or unhealthy.

The install/update operation progresses through explicit durable phases:

```text
absent -> staging -> verifying -> installed -> activating -> running
             |           |            |             |
             +-----------+------------+-------------+-> failed

updating -> verifying -> activating -> health-gate
                                      |          |
                                      |          +-> running (new revision)
                                      +-> rolling-back -> running (last known good)
                                                        or blocked
```

Every operation has a stable task id. A lost HTTP response does not authorize
the client to repeat an install, update, remove or purge; the client reads the
task and application resource to determine the result.

`blocked` is an observed safe-disable result with a machine-readable reason,
such as `containers-disabled`, `os-incompatible`, `signature-revoked`,
`resource-conflict`, `device-unavailable` or `insufficient-space`. Compatibility
is re-checked at every boot and after an OS rollback, not only at install.

An update keeps the last-known-good artifact until the new revision passes its
bounded health gate. Code rollback and data rollback are separate promises. If
the release performed an irreversible data migration, the manager must not
present code rollback as data recovery.

## 5. Manager architecture

`mos-appd` is the proposed lifecycle owner behind mosd:

```text
Browser / kiosk -> APID -> mosd -> mos-appd -> OCI/native adapter -> systemd
                         |          |              |
                         |          |              +-> generated runtime definitions
                         |          +-> registry, verification, health gate, rollback, GC
                         +-> typed state, tasks and audit projection
```

APID continues to expose only the versioned mos management API. mosd calls the
manager and projects application state and tasks. It does not call Podman or
write systemd definitions from HTTP handlers.

The manager's private IPC name must not occupy the package-enrolled
`com.mos.*` application-data namespace. The Item1/MQTT contract remains an
optional application data/diagnostic surface and never carries install,
update, start, stop, rollback or removal control.

The manager owns:

- bounded acquisition and staging;
- signature, digest, manifest, path and size verification at each privilege
  boundary;
- the installed registry and active revision pointer;
- generated, namespaced Quadlet/systemd definitions;
- systemd operation and normalized runtime/health observations;
- update health gates, last-known-good rollback and garbage collection;
- resource-conflict admission, maintenance interlock and an audit projection.

## 6. Storage, secrets and logs

| Data | Planned location/owner | Durability |
|---|---|---|
| Registry, active revision, small activation metadata | `/mnt/state/mos/apps/` | STATE; survives reboot and A/B |
| Download staging and artifact cache | `/srv/mos/apps/.staging/` and manager-owned cache | DATA; bounded and garbage-collected |
| Per-app persistent data | `/srv/mos/apps/<app-id>/data/` | DATA; retained by default on remove |
| Generated runtime definitions | manager-owned STATE-backed directories | STATE; atomically published |
| Secrets | new protected per-app secret store | write-only through API; delivered as credential files |
| Runtime logs | bounded journal query/export | EPHEMERAL; not a permanent audit trail |

Large images and bundles never go to STATE, and persistent app data never goes
to `/var`. Preflight accounts separately for download staging, retained
last-known-good artifacts, requested persistent reservation and free-space
headroom. These allocations share DATA with retained UI bundles and system
update workspace and therefore depend on the storage-reservation contract.

Secrets are named references in manifests and write-only values in the API.
They are delivered as files/systemd credentials rather than environment
variables. Lists, logs, task messages and support bundles expose only
configured/missing status.

## 7. Planned HTTP contract

This section is the design input for a future OpenAPI change. None of these
routes is current until it appears in `pkgs/mosd/apid/openapi.json` and the
binary contract gate passes.

### 7.1 Read surfaces

| Method and path | Result |
|---|---|
| `GET /api/v1/apps/capabilities` | manager/catalog availability, supported kinds, local-import gate and unavailable reasons |
| `GET /api/v1/apps` | paged/filtered inventory across all source classes |
| `GET /api/v1/apps/{appId}` | identity, source, desired/runtime/health, active revision, storage and allowed actions |
| `GET /api/v1/app-catalog` | cursor/filter catalog results plus freshness and compatibility summary |
| `GET /api/v1/app-catalog/{appId}` | exact releases, digests, publisher, notes, permission/storage summary |
| `GET /api/v1/apps/{appId}/versions` | current, last-known-good and compatible available releases |
| `GET /api/v1/apps/{appId}/logs` | redacted, bounded log page using time/cursor/limit parameters |
| `GET /api/v1/apps/activity` | bounded application task and audit projection |

Inventory and detail resources include normalized source/kind/trust labels,
desired/runtime/health, a structured block reason, current and target revision,
freshness, active task reference and a server-computed `allowedActions` set.
Clients do not infer authority from source strings.

### 7.2 Mutations

| Method and path | Input and behavior |
|---|---|
| `POST /api/v1/app-catalog/{appId}/preflight` | exact release/digest and intended action; side-effect free compatibility, conflict, permissions, storage and rollback result |
| `POST /api/v1/apps` | catalog id, exact release/digest and fresh preflight token; returns `202 TaskAccepted` |
| `POST /api/v1/apps/{appId}/actions/start` | starts an installed allowed revision; returns 202 |
| `POST /api/v1/apps/{appId}/actions/stop` | stops the managed app; returns 202 |
| `POST /api/v1/apps/{appId}/actions/restart` | available only when returned in allowed actions; returns 202 |
| `POST /api/v1/apps/{appId}/actions/update` | exact target revision and fresh preflight token; returns 202 |
| `POST /api/v1/apps/{appId}/actions/rollback` | exact eligible last-known-good revision; returns 202 |
| `PATCH /api/v1/apps/{appId}/configuration` | fields admitted by the signed configuration schema; returns 202 |
| `PUT /api/v1/apps/{appId}/secrets/{name}` | replaces one declared write-only secret; never echoes the value |
| `DELETE /api/v1/apps/{appId}?retainData=true` | removes managed runtime/artifacts; data retention defaults to true |
| `POST /api/v1/apps/{appId}/actions/purge-data` | separate irreversible challenge; never implied by remove |

Preflight returns an expiring token bound to app id, action, exact digest,
manifest digest, device compatibility snapshot, permissions and reservation.
Activation re-validates those inputs; the token is not an authorization bypass.

The API never accepts raw units, commands, unqualified image tags, arbitrary
host paths or client-authored trust decisions. System and External/unmanaged
resources return no mutating allowed actions. Conflicts use structured error
codes and source paths; signature/revocation failure has no bypass flag.

## 8. Built-in UI contract

Applications is the sixth primary destination after Services and before
Access. The route tree is:

```text
/ui/apps                    Installed
├── catalog                 Curated catalog
├── activity                App operations
└── :appId                  App detail / Overview
    ├── configuration
    ├── permissions
    ├── logs
    └── versions
```

The module stays absent from production navigation until capabilities report a
usable manager and the corresponding API is current. Once shipped, manager
failure is a degraded state that keeps the route and cached inventory visible;
it is not treated as unsupported.

Install and update use four steps: compatibility, access/storage, exact
confirmation, and task progress. OCI entries show `containers-disabled` and a
link to Services when the global runtime is off; installation never silently
enables it. Removal keeps data by default. Purge is a separate challenged
action. Detailed interaction and state requirements live in the Chinese
built-in UI development guide.

## 9. Delivery stages and acceptance gates

1. **Inventory:** stable registry model, System/managed/external separation,
   read-only UI and boot-time compatibility checks.
2. **Curated OCI:** signing/revocation, digest admission, mandatory resource
   ceilings, protected secrets, storage reservation, health-gated rollback,
   typed API and full local UI lifecycle.
3. **Managed native:** non-root identity, declarative unit generator, reviewed
   sandbox profile and OS/data migration compatibility.
4. **Local trusted import:** developer-key enrollment, removal and revocation;
   disabled by default and visibly distinct from catalog trust.
5. **Public marketplace:** conditional future product only after publisher
   operations, vulnerability response, policy, support and isolation are
   designed. It is not implied by stages 1–4.

The first production slice is not accepted merely because an image starts. It
must prove hostile bundle parsing is bounded, exact-digest verification occurs
at both staging and activation, resource conflicts fail before activation,
tasks survive client disconnect, OS rollback safe-disables incompatible apps,
secrets never enter logs, data retention is explicit, and failed update health
checks restore the last-known-good revision or produce a stable blocked state.
