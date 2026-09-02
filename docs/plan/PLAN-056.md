# PLAN-056 Design a managed application catalog and lifecycle

- **status**: completed
- **createdAt**: 2026-09-01 21:30
- **approvedAt**: 2026-09-01 21:38
- **relatedTask**: [UI-002](../task/UI-002.md)

> Approved default on 2026-09-01: vendor-curated signed catalog, OCI-first
> delivery, and declarative managed native applications as a later phase.
> A later user direction replaced HTML/prototype delivery with one
> designer-facing Markdown guide. Production backend and installer
> implementation remain separate follow-up work.

## Context

mos has enough execution seams to run third-party workloads, but no managed
application product. Containers run through rootful Podman and persistent
Quadlet files when the global container switch is enabled. The shipped
container policy accepts unsigned images, and there is no protected admission,
secret store, automatic update, health-gated rollback or mandatory resource
ceiling. Native code belongs in the immutable image as a build-time `.deb` and
therefore updates atomically with RAUC.

The STATE-backed `/usr/local/lib/systemd/system` bind lets a trusted root
integrator add persistent units, and `/srv` can hold native programs and app
data. Those facts make a local native app technically possible, but not a safe
marketplace contract: an arbitrary unit can request root-equivalent privileges,
and both the unit and binary survive an OS slot rollback that may no longer be
compatible with them.

`mosd` separately discovers `com.mos.*` services and exposes a best-effort
registry through live state. That registry is useful runtime evidence, not an
installed-app database. A single application may own several services, a
service may be unmanaged, and applications are not required to implement the
Item1/MQTT contract. APID currently exposes no application or catalog route.

PLAN-051 intentionally covers the trusted-integrator documentation baseline
and excludes an app marketplace. It explicitly asks for a separate plan if mos
later promises managed or untrusted applications. The built-in UI guide also
reflects the old decision by keeping five primary destinations and stating that
Services does not become a marketplace. The user's new direction therefore
requires a new product/security boundary rather than a UI-only amendment.

## Proposal

### Product boundary

Add a sixth top-level **Applications** destination. Keep **Services** for mos
system capabilities such as the global container runtime and MQTT; do not mix
those appliance controls with third-party application lifecycle.

Applications has three source classes:

1. **System:** immutable native applications from the OS image. Read-only in
   this module, updated/rolled back only with RAUC.
2. **Catalog:** separately managed, vendor-curated and signed applications.
   OCI images are addressed by digest; native bundles carry a signed manifest
   and self-contained program payload.
3. **Local trusted:** an optional expert path for artifacts signed by a device-
   enrolled developer/integrator key. It is disabled by default and never
   relabelled as marketplace-verified.

An arbitrary discovered service, handwritten Quadlet file or handwritten
systemd unit is shown as **External/unmanaged** diagnostic evidence. It is not
adopted, updated or removed by the application manager.

### Common application contract

Define one signed manifest for both managed artifact kinds:

- stable app id, display name, vendor, version and release notes;
- kind (`oci` or `native`), artifact digest and signature identity;
- architecture, board/profile, mos API/schema and minimum system-version
  compatibility;
- declared host ports, networks, device nodes, D-Bus/MQTT names, mounts,
  persistent storage and secret references;
- CPU, memory, PIDs and I/O limits plus requested Linux capabilities;
- generated runtime entrypoint, dependencies, restart policy and health check;
- data-schema version, update/rollback compatibility and retention policy;
- license, SBOM/provenance references and support identity.

Marketplace native bundles do **not** carry an arbitrary systemd unit or shell
startup script. They carry a declarative runtime manifest from which the
manager generates a namespaced, hardened `mos-app-<id>.service`. Raw signed
units remain a trusted-integrator/local mode because signing an unrestricted
unit proves publisher identity but does not make its root privileges safe.

### Management architecture

Introduce a dedicated `mos-appd` lifecycle service behind mosd. It owns bounded
staging, signature and compatibility verification, the installed-app registry,
version activation, generated systemd/Quadlet definitions, systemd operations,
health gates, rollback and garbage collection. Its exact-policy local IPC must
sit outside the `com.mos.*` application-data namespace. Network acquisition
runs in a sandboxed unprivileged worker; the privileged activator re-verifies
the exact digest before changing runtime state.

APID continues to use only the `com.mos.mosd1` management boundary. `mosd`
calls the exact local manager interface, publishes typed application state and
tasks, and audits every lifecycle action. Application
`com.mos.Item1` trees remain application data and diagnostics; they never
become the install/control channel.

Use the existing persistence tiers deliberately:

- `/mnt/state/mos/apps/` for small registry/activation metadata;
- `/mos/apps/.staging/` and content-addressed releases/images for large
  artifacts;
- `/mos/apps/<id>/data/` for retained application data;
- STATE-backed namespaced Quadlet and systemd definitions generated only by
  `mos-appd`;
- a new per-app secret store under the existing protected mos state, exposed to
  apps as credential files rather than environment values;
- bounded journal reads for current logs; logs remain EPHEMERAL by default.

Container applications bind managed data paths instead of opaque unmanaged
volumes where quota/backup ownership matters. Native applications require a
real non-root identity and sandbox contract before catalog admission; running
marketplace native code as root is not an acceptable default.

### Lifecycle and API

Model desired state, runtime state and health separately. The lifecycle covers
catalog available, downloading, verifying, installing, stopped, starting,
running, degraded, update available, updating, rollback available, rolling
back, failed, removing and removed. Every long operation returns a task id;
install/update activation is transactional and retains the last compatible
version until its health gate succeeds.

Design typed APID resources under `/api/v1/apps` and `/api/v1/app-catalog` for:

- installed list/detail and catalog list/detail;
- compatibility, permission and storage preflight;
- install, start, stop, restart, update and rollback;
- remove while retaining data, plus a separately challenged purge;
- bounded logs, version history, health and lifecycle task status;
- optional local signed-bundle upload/import in a later slice.

The API never accepts a raw systemd unit, arbitrary shell command, unqualified
container tag or client-supplied absolute host path.

### Built-in UI

Use the shipped SPA's current tokens/components and add:

```text
/ui/apps                    Installed applications
├── catalog                 Curated catalog
├── activity                Install/update/rollback tasks
└── :appId                  Detail
    ├── overview            desired/runtime/health/version
    ├── configuration       app-declared non-secret settings
    ├── permissions         granted ports/devices/mounts/resources
    ├── logs                bounded current journal
    └── versions            update and rollback eligibility
```

The catalog install flow is Review compatibility -> Review permissions and
storage -> Confirm -> Download/verify/install -> Health gate -> Running or
rolled back. Application cards always show artifact kind and trust source.
Container apps display a blocked reason when the global container capability is
off; installation must not silently enable it. Remove defaults to retaining
data, while purge is a distinct high-risk action.

### Delivery order

1. Read-only inventory that joins managed registry, runtime/systemd state and
   external `com.mos.*` diagnostics without claiming install support.
2. Curated, signed OCI applications with digest pinning, generated Quadlet,
   resource/permission admission and rollback.
3. Managed native bundles only after non-root identity, generated hardened
   units, secret delivery and OS-compatibility enforcement are real.
4. Local signed import with explicit developer trust enrollment.
5. A public third-party marketplace only after security review, key revocation,
   vulnerability response, quotas and support policy are operational.

The first approved delivery for this plan updates the Chinese UI development
guide, defines the backend/API contract, and contributes the Applications
screen/flow contract to the Markdown-only designer guide in PLAN-057.
Production backend/UI implementation remains a separately estimated and
approved execution slice.

## Risks

- Rootful containers and arbitrary systemd units can become root-equivalent
  code execution. A polished marketplace UI must not imply a sandbox that the
  device does not enforce.
- Native releases and persistent units can survive an incompatible A/B system
  rollback. Compatibility checks and safe-disable behavior are mandatory at
  every boot, not only at install time.
- Rolling back code may corrupt data after an irreversible schema migration.
  The manifest and UI must distinguish code rollback from data rollback.
- Application images, staging and data share DATA with custom UI bundles and
  update workspace. Reservation, quota and low-space behavior depend on
  PLAN-049.
- Ports, devices, bus names, classes/instances and storage paths can conflict
  across applications. Admission must fail before activation and name the
  conflict.
- Catalog signing keys, developer trust roots, revocation, provenance and
  vulnerability response create a continuing operations obligation, not only
  an install-time feature.
- A privileged application daemon parsing hostile bundles widens the attack
  surface. Acquisition and activation must be separated and every boundary
  re-validate size, paths, digests and signatures.
- App auto-update and OS update can race. Both need one maintenance/interlock
  model and explicit safe-to-reboot ownership.

## Scope

In scope for the design: common manifest and state model, catalog/trust tiers,
managed runtime architecture, persistence ownership, typed API shape, built-in
UI information architecture, staged delivery and security acceptance gates for
OCI and native applications.

Out of scope without separate approval: production implementation, a public
open marketplace, arbitrary unsigned registry pulls, raw unit/script upload,
on-device APT, replacing RAUC for system applications, fleet-wide application
rollout, billing/reviews, and claiming hostile multi-tenant isolation on the
current rootful runtime.

## Alternatives

1. **Inventory only.** Add an Applications page over service/systemd state but
   no install/update/remove. Safest and quickest, but does not meet the catalog
   goal; retained as delivery step 1.
2. **Containers only.** Build the signed curated catalog over OCI/Quadlet and
   keep all native apps in RAUC. This is the safest first writable lifecycle
   and the recommended initial implementation, but the common model preserves
   a later native kind.
3. **Extend Services instead of adding Applications.** Rejected because mos
   system capabilities and third-party app lifecycle have different trust,
   navigation and failure semantics.
4. **Accept program plus arbitrary systemd unit from the marketplace.**
   Rejected for managed apps: a unit can grant broad host privilege and evade
   a declarative permission review. Retain only as clearly unmanaged,
   integrator-controlled local installation.
5. **Let APID call Podman/systemd directly.** Rejected because APID is the HTTP
   boundary, not a process supervisor or artifact installer; lifecycle stays
   behind mosd's audited management boundary.

## Annotations

- 2026-09-01: Created after the user requested an application module covering
  catalog installation, local management, OCI images and native programs with
  systemd startup.
- 2026-09-01: The initial proposal awaited choices on catalog trust,
  native-unit policy and prototype format; the following annotation records
  the selected direction.
- 2026-09-01: User approved the default trust/runtime proposal, then replaced
  the HTML prototype with the Markdown-only designer guide in PLAN-057.
- 2026-09-01: Delivered the authoritative application design and Chinese
  counterpart, updated both built-in UI guides, and verified the documentation
  index 54/54. No production lifecycle code was implemented.
