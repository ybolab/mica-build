# PLAN-039 Serve a built-in SPA and put management behind `/api`

- **status**: completed
- **createdAt**: 2026-08-31
- **approvedAt**: 2026-08-31 18:07 UTC
- **completedAt**: 2026-08-31 20:17 UTC
- **relatedTask**: [RFCT-275](../task/RFCT-275.md)

## Context

Measured from the tree on 2026-08-31, after PLAN-038 completed.

### The current "built-in UI" is not an application

apid currently owns three concerns in one `routes.rs`:

1. server-rendered `maud` pages and form handlers;
2. the versioned JSON API under `/api`;
3. static hosting for an active custom bundle under `/srv/ui`.

The route table consequently exposes appliance mutations outside the API:
`POST /setup`, `/login`, `/logout`, `/password`, `/network`,
`/network/peers/*`, `/hostname`, `/power/*`, `/ssh/*`,
`/containers/enable`, `/mqtt/enable` and `/builtin/*`. The reported
`POST /containers/enable` is therefore not an isolated stray route; it is one
member of a second management protocol made out of HTML forms.

`/` is conditional today, but its no-custom-bundle branch calls the Rust
`home` handler and renders HTML in the daemon. `/builtin/` is another
server-rendered pane. There is no shipped JavaScript, application source,
frontend build or embedded static asset directory.

This violates the boundary requested for RFCT-275: a UI is a client of the
management API, not a second implementation of it.

### Authentication is the dependency that prevents a mechanical move

The existing browser pages use an HMAC-signed, in-memory session cookie.
Every `/api/v1/*` resource and action, however, uses `ApiBearer` and explicitly
rejects that cookie. The only exceptions are unauthenticated
`POST /api/v1/setup` and API discovery. A browser that needs its first bearer
token currently uses session-authenticated, non-API HTML handlers at
`POST /builtin/tokens` and `/builtin/tokens/revoke`.

A static SPA cannot retain that split without either:

- continuing to call management handlers outside `/api`; or
- storing a permanent bearer token in browser-readable storage.

Both are the wrong boundary. The API therefore needs a first-class browser
session contract. Cookie-authenticated writes also need a CSRF proof; merely
moving the existing form actions under `/api` would move their exposure rather
than close it.

### Static UI files must not depend on DATA

The custom UI store is correctly rooted at `/srv/ui` on DATA. The recovery UI
must not be placed there: absence, corruption or operator damage under the
custom bundle store is exactly when the built-in UI is needed. The built-in
application will remain verity-covered as bytes compiled into `apid`.

The current Rust checks run without Bun and compile `apid` directly. The
firmware build also invokes Cargo inside the pinned Rust builder and has no
frontend step. A shipped SPA therefore needs both a deterministic Bun gate and
committed build output that a direct Cargo invocation can embed. A source-only
frontend whose assets appear only after an unrecorded local `bun run build`
would make the binary depend on an unstated precondition.

### The network state is currently configured intent, not observation

`NetworkReconciler::apply` records, for every configured entry, the generated
unit filename, configured DHCP flag and configured kind. A WireGuard entry also
gets the public key derived from its key file. It does not enumerate kernel
links or read carrier, operational state, addresses, routes, leases or DNS.

The target rootfs is Debian trixie with systemd 257. Its
`org.freedesktop.network1.Manager` interface exposes `Describe`, returning a
JSON document whose `Interfaces` entries carry link identity,
`AdministrativeState`, `OperationalState`, `CarrierState`, address-family
state, addresses, routes, DNS and DHCP details. The method is marked
unprivileged by systemd; mosd already connects to this same object for
`Manager.Reload`.

That makes networkd the narrowest source of truth. Reading it in mosd preserves
the existing rule that apid never talks to system services or spawns a process.

### Surface and capability inventory

Most legacy pane operations already have an API equivalent:

- generic settings reads/writes cover hostname, SSH enablement, containers
  and MQTT;
- typed collections cover SSH keys, Wi-Fi networks and WireGuard peers;
- typed actions cover password change, transient root password, WireGuard key
  rotation, reboot and poweroff;
- PLAN-038's task routes describe asynchronous apply progress.

The missing API pieces are browser session setup/login/logout, custom UI status
and deactivation, and an observed network inventory. These are the backend
work required before deleting the HTML handlers; the appliance does not need a
second set of feature-specific mutations.

### Conflict survey

`git log --all --not main` shows no off-main commit touching apid, mosd's bus or
network reconciler. PLAN-036 has two off-main changes in the wider package
area: one changes `os/pkgs/mosd/deb/README.md`, and one changes
`deb/mosd/control/mosd.control`; neither overlaps the proposed SPA source,
Rust code or build gate. This plan will not edit those files.

PLAN-037 remains draft and describes the current bearer-only and
server-rendered contracts in user-delivery documentation. PLAN-039 owns the
executable API/UI change and the directly affected design sections; PLAN-037
must consume the shipped OpenAPI and route contract after this plan rather than
copying the pre-change behavior.

## Proposal

Five stages. Each stage lands with focused tests and leaves the Rust workspace
green. There is no legacy HTML compatibility layer: once the SPA has feature
parity, the old handlers and their routes are removed.

### Stage A — make routing express one UI boundary and one API boundary

The HTTPS router will have four classes only:

1. `/api` and everything under it: JSON API routing, including its own JSON
   404/405 handlers;
2. `/ui` and everything under it: the embedded built-in SPA, never custom
   bundle content;
3. `/`: serve a readable active custom bundle index, otherwise redirect to
   `/ui`;
4. every other GET/HEAD: custom-bundle asset lookup and custom-SPA fallback
   when a readable active bundle exists, otherwise 404.

`/healthz` remains the one non-API operational exception. It is not appliance
state or a management operation: the boot health gate uses it to prove only
that apid's TLS listener answers. Moving or authenticating it would break the
slot-confirmation gate while adding no management protection.

`/ui`, `/ui/` and client routes below `/ui/` return the built-in index;
`/ui/assets/*` returns only embedded built-in assets. The prefix is claimed by
declared axum routes before the custom fallback, so a custom bundle cannot
shadow it. The SPA is served regardless of setup/login state; it discovers
that state through the session API rather than being redirected by middleware.

All old page and form routes, including `/builtin` and
`/containers/enable`, are removed. A route-table test enumerates every
non-GET method and proves that no appliance mutation exists outside `/api`.

### Stage B — give browsers a JSON session contract with CSRF protection

Add these v1 routes:

- `GET /api/v1/session` — unauthenticated bootstrap status:
  `setup`, `unauthenticated` or `authenticated`; an authenticated response
  also carries the current session's CSRF token;
- `POST /api/v1/session` — JSON password login, the existing persisted
  exponential backoff and audit events, an `HttpOnly; Secure; SameSite=Lax`
  session cookie, and the CSRF token in the JSON response;
- `DELETE /api/v1/session` — revoke the current browser session and clear its
  cookie;
- `GET /api/v1/ui` — active custom bundle status;
- `DELETE /api/v1/ui/active` — deactivate the active custom UI without
  deleting its installed files.

`POST /api/v1/setup` keeps its existing one-time bearer token result and also
establishes a browser session, returning its CSRF token as an additive member.
The first-run SPA can therefore continue immediately, while an API-only setup
client still receives the long-lived token it requested.

Replace `ApiBearer` with one API credential extractor:

- a stored bearer token is accepted as today and never requires CSRF;
- a valid browser session cookie is accepted on the same routes;
- a cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE` requires the
  session's random token in `X-CSRF-Token`;
- a missing/invalid credential remains the standard 401 JSON envelope, while
  a missing/invalid CSRF proof is a 403 `csrf_invalid` envelope.

The session table stores expiry and a random CSRF secret per session. Token
mint/revoke routes accept either API credential, which replaces the removed
`/builtin/tokens*` bootstrap without weakening it: the browser route now has a
CSRF proof the HTML form did not.

No CORS headers are introduced. Custom and built-in SPAs are same-origin API
clients, and opening the API cross-origin would be a separate security
decision.

### Stage C — expose an honest, current network inventory

Add a `NetworkObserver` port in mosd. Production calls
`org.freedesktop.network1.Manager.Describe` over the system bus under a short
timeout; tests use a fixture observer and never inspect the host network.

The systemd JSON is parsed and reduced inside mosd to a stable, non-secret
shape. Per observed interface it includes:

- index, name, observed kind/type and driver when present;
- administrative, operational, carrier, online, aggregate-address, IPv4 and
  IPv6 states;
- MTU and hardware address;
- addresses with family, prefix length, scope and configuration source;
- DNS servers;
- routes, including default-route gateway and configuration source.

Raw DHCP identifiers, vendor options and other upstream fields are not
forwarded. A new `GetNetworkState` bus method queries on demand and returns the
normalized JSON; it does not reuse the reconciler's last configured echo.

`GET /api/v1/network` is added beside its existing `PUT`. It reads configured
entries and observed links concurrently, then returns their union keyed by
interface name. Its response carries:

- `count`: the number of interfaces currently observed by networkd;
- `configuredCount`;
- one row per configured or observed name, with separate `configured` and
  `observed` members;
- observation availability, so a networkd failure is shown as unavailable and
  never converted into configured values that look observed.

An observed-but-unconfigured link (including loopback when networkd reports
it) remains visible. A configured interface absent from the running kernel is
also visible, with `observed: null`. Those two cases are operationally useful
and must not be merged into one count.

### Stage D — build the shipped UI as a React SPA

Create `os/pkgs/mosd/apid/ui` as one Bun-managed application following the
repository's web baseline:

- React 19, TypeScript, Vite 8;
- TanStack Router with generated, type-safe file routes;
- TanStack Query for every API read, mutation invalidation and PLAN-038 task
  polling;
- Tailwind CSS 4 and shadcn/ui's `base-nova` style on Base UI primitives;
- Vitest and Testing Library for behavior tests.

Package versions are pinned in `package.json` and `bun.lock` from the registry
versions verified during this investigation; no floating `latest` specifier is
committed.

The SPA is built with base `/ui/` and calls root-relative `/api/...` URLs, so
it has no device hostname, scheme or port compiled into it. Its bootstrap is:

1. fetch `/api/v1/session`;
2. route to setup or login when required;
3. hold the returned CSRF token in memory and attach it only to mutating
   cookie-authenticated calls;
4. refetch session state after setup, login and logout.

The built-in SPA replaces every capability being removed with the HTML panes:

- overview/health and queued task outcomes;
- network inventory and configuration, clearly separating configured and
  observed values;
- hostname and password;
- SSH enablement, keys and transient password;
- container and MQTT switches;
- power actions with explicit confirmation;
- API token lifecycle;
- custom UI status and deactivation.

The network page leads with the observed interface count. Each interface card
shows operational/carrier/address state, addresses and configuration source,
then its configured kind/method separately. Missing observation and a
configured-but-absent interface are explicit states, never empty boxes.

Mutations that return a PLAN-038 task id transition to a progress state and
poll `/api/v1/tasks/{id}` through TanStack Query until terminal. A lost network
connection during a network change is shown as an unconfirmed outcome rather
than a false failure.

The implementation includes keyboard operation, visible focus, labelled form
controls, semantic status announcements, confirmation dialogs for power and
destructive actions, responsive layouts and no browser storage of passwords,
session cookies, CSRF tokens or minted bearer secrets.

### Stage E — embed, verify and delete the duplicate control plane

Vite emits deterministic fixed paths (`index.html`, `assets/app.js` and
`assets/app.css`) under `ui/dist`. Those verity-covered files are committed and
embedded with `include_bytes!`, so `cargo test`, `cargo run -- --openapi` and
the cross build do not secretly require Bun first. Source maps are not shipped.

`ui/run.sh` provides the one frontend gate. It uses a host Bun when available
and otherwise the digest-pinned `IMAGE_BUN_1` container already used by this
repository. It runs, under `bun install --frozen-lockfile`:

- ESLint;
- TypeScript checking;
- Vitest with a non-zero-test assertion;
- the production Vite build into a temporary directory;
- a byte comparison against committed `ui/dist`.

CI runs that gate in its own job. The firmware Cargo build embeds only the
already-proven bytes, keeping the Rust builder single-purpose and allowing an
offline build from a complete checkout.

After the SPA and API tests are green, remove all `maud`, `Form` and HTML
business handlers from apid, remove the `maud` dependency, and reduce the asset
module to the embedded `/ui` server plus the existing guarded custom-bundle
server.

Regenerate `openapi.json`; update the e2e spec pins and transport/setup/login,
read-only, mutation and custom-bundle phases. Add black-box assertions that:

- no custom bundle means `/` redirects to `/ui`;
- an active valid bundle owns `/` but never `/ui` or `/api`;
- setup/login/logout and a cookie-authenticated mutation are JSON-only and the
  mutation fails without CSRF;
- `/containers/enable` and every other retired form path no longer invoke a
  handler;
- the network response distinguishes configured from observed interfaces.

Update the route/auth/static-hosting sections of `docs/design/api.md`, the
browser-session sections of `docs/design/access.md`, the technology and network
sections of `docs/design/dashboard.md`, their maintained Chinese counterparts,
and append one changelog entry.

## Delivery order and commits

After approval:

1. API session/CSRF contract and custom-UI API;
2. root and `/ui` static-routing boundary;
3. mosd network observation and bus contract;
4. typed HTTP network inventory;
5. SPA scaffold, session shell and network view;
6. remaining pane feature parity and task progress;
7. embedded production assets, removal of the HTML handlers and dependency;
8. OpenAPI, e2e, design documentation and closure.

Each commit runs the relevant focused tests. The final acceptance run includes
the frontend gate, `os/pkgs/mosd/hack/check.sh`, OpenAPI regeneration/diff,
spec pins and the feasible black-box suite preparation checks.

## Implementation

- `apid` now serves a verity-covered React SPA at `/ui`; `/` serves a valid
  active custom bundle and otherwise redirects to `/ui`. Custom assets cannot
  shadow `/ui` or `/api`.
- Setup, login, logout, UI selection and all appliance reads, writes and
  actions use JSON routes under `/api`. Browser sessions carry a per-session
  CSRF token, while bearer-token clients keep their existing semantics. The
  legacy server-rendered pages, form mutations and `maud` dependency were
  removed.
- mosd observes systemd-networkd through `Manager.Describe` and exposes a
  normalized snapshot over D-Bus. `GET /api/v1/network` keeps configured and
  observed state separate, including explicit observation availability; the
  SPA forms the configured/observed union for display. This preserves the
  established configured-map API shape while retaining both missing-link
  cases described in Stage C.
- The network screen shows the observed interface count, configured count,
  operational/carrier/address states, addresses and configured kind. The
  remaining console panes use the same API client and poll accepted settings
  tasks to terminal state.
- The QEMU contract suite was reduced to one non-destructive boot and rewritten
  around the SPA/API boundary, browser session/CSRF behavior, management
  mutations and observed network state. Rust temporary-directory tests cover
  custom-bundle selection and reserved prefixes without an injected fixture.

## Verification

- `os/pkgs/mosd/apid/ui/run.sh`: ESLint, TypeScript, 4 Vitest tests,
  deterministic production build comparison passed.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` passed.
- `cargo nextest run --workspace --locked`: 718 tests passed.
- `cargo test --doc --workspace --locked` passed.
- `cargo deny check licenses bans advisories` passed with only the repository's
  existing unmatched-allowance and duplicate-version warnings.
- `cargo fmt -p apid -p mosd -- --check` passed. The aggregate
  `hack/check.sh` remains blocked at its first step by committed formatting
  differences in `mqttd/src/runtime.rs` and `mqttd/tests/protocol.rs`, which
  are outside this plan and unchanged in this working diff; its later commands
  are the separately passing checks listed above.
- The apid real-process/D-Bus end-to-end test passed; the QEMU TypeScript
  typecheck and 47 self-tests passed; all 23 OpenAPI spec pins passed. A live
  firmware-image QEMU boot was not run because this checkout did not provide a
  freshly built image for the rewritten suite.

## Risks

- **Session-authenticated API writes create CSRF exposure if even one handler
  bypasses the extractor.** Mitigated by putting the method/CSRF check in the
  single credential extractor, route-table tests over every mutating API
  method, and a black-box missing-token refusal.
- **An unauthenticated static UI reveals its own code.** This is intentional:
  neither built-in nor custom assets are credentials or appliance state. The
  API remains the access boundary, which also lets setup and login be SPA
  states rather than server pages.
- **A custom UI is same-origin code.** That is already true today. It can call
  the API with the browser's cookie, so activation remains an administrative
  trust decision. `HttpOnly` protects cookie extraction; CSRF does not and is
  not meant to protect a user from code they deliberately installed on the
  management origin.
- **systemd's `Describe` document is an upstream shape.** The target image pins
  systemd 257, mosd selects a small optional-field subset, fixtures cover
  missing/extra fields, and the HTTP API exposes mos's normalized schema rather
  than forwarding the upstream document.
- **Observation can fail while configuration remains readable.** The combined
  network response carries an explicit unavailable state and still returns the
  configured rows. The SPA must render that degradation and must never relabel
  configuration as observation.
- **A network write may remove the connection carrying the request.** The
  queued task contract prevents apid from claiming completion. The SPA treats a
  transport loss as unconfirmed and offers reconnection, not an automatic
  replay of a mutation.
- **Committed build output can drift from source.** The frontend gate rebuilds
  to a temporary directory and compares bytes; direct Cargo builds consume the
  checked artifact rather than silently regenerating it with a different Bun.
- **Deleting the HTML surface can temporarily remove capability.** Deletion is
  last, after route-by-route SPA feature parity tests. No partial state lands in
  which `/containers/enable` is gone but the SPA has no container switch.

## Scope

- `os/pkgs/mosd/apid/src/{routes,session,bundle,assets,openapi,settings_api,bus_client}.rs`,
  tests and `openapi.json`;
- `os/pkgs/mosd/apid/ui/` and its deterministic build/check entry point;
- `os/pkgs/mosd/{Cargo.toml,Cargo.lock}` and `apid/Cargo.toml` to remove maud;
- `os/pkgs/mosd/mosd/src/{bus,main}.rs` and network observation code/tests;
- `.github/workflows/check.yml` for the frontend gate;
- affected `os/pkgs/mosd/tests/apid-api` phases and spec pins;
- the directly affected English and maintained Chinese design sections,
  `docs/CHANGELOG.md`, and RFCT-275/PLAN-039 tracking.

Explicitly outside scope: custom UI upload/activation transport, a redesign of
the bundle on-disk store, live push/WebSocket updates, non-network dashboard
mechanism gaps, container workload management beyond its existing switch, and
changes to PLAN-036 package control/README files.

## Alternatives

### Move the current maud pages to `/ui`

Rejected. It removes one surprising path but keeps a second management
protocol, server-side form actions and duplicated feature implementation. It
does not make `/ui` a pure SPA.

### Put a built-in bundle under `/srv/ui/builtin`

Rejected. It makes the recovery UI depend on the DATA store whose absence or
damage it must survive. Embedded assets keep the fallback inside the signed,
verity-covered `apid` binary.

### Keep the API bearer-only and have the SPA mint/store a token

Rejected. It requires a non-API bootstrap or leaves a permanent credential in
browser-readable storage. A short-lived, in-memory server session is already
implemented and is the correct browser credential.

### Accept the session cookie on writes without CSRF

Rejected. SameSite is defense in depth, not an API mutation proof; it also does
not cover every browser evolution or same-site sibling. A per-session header
token is explicit and testable.

### Read `ip -j` from apid

Rejected. apid would violate its system-action/data-source boundary and add a
subprocess parser beside the networkd service that already owns the state.
systemd 257's `Manager.Describe` provides the required facts over the bus mosd
already uses.

### Record observation only when settings reconcile

Rejected. Carrier, DHCP lease, address and route state change without a settings
write. A snapshot taken only after `Reload` would become stale precisely when
the operator opens the network page to diagnose a fault.

### Show only configured interfaces

Rejected. It cannot answer how many interfaces currently exist, hides an
unconfigured physical link, and makes a configured-but-missing device
indistinguishable from a working one.

## Approval gate

Implementation starts only after explicit approval of this proposal. A reply
of `proceed`, `approved` or `开始实现 PLAN-039` is sufficient.
