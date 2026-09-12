# Built-in management dashboard

The dashboard is the React/Vite SPA embedded in `apid` and served at `/_ui/`.
It is a client of the [management API](api.md), with no private management
protocol. Its source is `pkgs/mosd/apid/ui/`; the generated OpenAPI document
defines the backend contract.

## Navigation and ownership

| Area | Purpose |
|---|---|
| Overview | Device identity, health and bounded runtime summaries |
| Network | Configured interfaces, observed links and supported interface settings |
| Services | MQTT, containers and other exposed service settings |
| Applications | Application availability and the supported delivery boundary |
| Access | Operator credentials, SSH and authentication settings |
| System | Signed deployments, firmware publication, storage, diagnostics and power |
| System / UI versions | Upload, retain, activate and remove custom UI generations |

File routes live under `src/app/routes/`. TanStack Query owns fetched server
state; forms distinguish edited values, accepted writes and completed apply
tasks. Capability and unavailable responses control what an operator can use.
The UI must not present a proposed backend feature as an executable action.

## State and interaction

Pages distinguish initial loading, empty data, refresh with retained data and
failed observation. A previous snapshot is not evidence of current health.
Polling is bounded; actions invalidate the relevant queries rather than
assuming a successful write has already converged on the device.

Update screens display authenticated deployment/component identities,
acquisition progress, remaining trials, confirmation and backend rollback
eligibility. They do not infer boot state from version labels. Firmware has a
separate signed maintenance flow and explicit readback/recovery requirements.
See [updates](updates.md) and [release signing](release-signing.md).

Session mutations send the API's CSRF token. Authentication secrets are not
persisted in browser storage. Refusals and task failures remain visible; a
rebooting or disconnected device is not reported as a completed update merely
because installation was accepted.

## Customization

The built-in UI remains available at `/_ui/` when an operator selects a custom
UI at `/`. UI archive installation and activation are separate actions, and
inactive versions can be removed explicitly. See [API hosting](api.md#5-custom-ui-lifecycle).

The [product design brief](../zh/design/built-in-ui-design.md) records broader
interaction ideas with maturity markers. It does not define shipped capability.
Superseded HTML exports and the old server-rendered dashboard proposal have
been removed; Git history retains them.

## Development and acceptance

The UI uses the repository's pinned Bun build, React, TanStack Router/Query,
Tailwind and shadcn components. Locale resources own user-facing copy.
Run `bash pkgs/mosd/apid/ui/build.sh --check` for the frontend gate. Build output
is supplied to the Rust/package producer; it is not checked into the source.

Component tests cover state and action behavior. Browser acceptance checks the
rendered flows, and full-image API acceptance checks the real service contract.
Keep hardware behavior separate from browser and mock evidence.
