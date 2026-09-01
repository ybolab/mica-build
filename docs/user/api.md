# API reference

The mos management API is specified by one machine-readable contract:
**`pkgs/mosd/apid/openapi.json`**. It is generated from the same code that
serves the routes, and CI holds it equal to what the shipped binary reports —
so it cannot drift from the device the way a hand-written endpoint list
would. This page deliberately does not duplicate the endpoint inventory; it
tells you where the contract is and states the facts the schema itself cannot.

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`

## 1. The surface in one paragraph

apid serves HTTPS on port 443 (port 80 redirects) and `/api` is the complete
management protocol: versioned settings and state reads, typed writes, queued
task records, setup and session lifecycle, UI selection, live network
observation, update state and system actions. Errors are JSON envelopes.
`/healthz` is the one operational exception outside `/api`, and it proves
only that the apid process is listening — not that mosd or anything else is
healthy. The built-in browser UI at `/ui` is an ordinary client of the same
API, with no privileged side channel.

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/remote-management.md`

## 2. Authentication

Two credential shapes, both defined in the contract:

- **Browser session** — password login at the session route creates a signed
  `HttpOnly; Secure` cookie plus a per-session CSRF token; session-based
  mutations must send the token in `X-CSRF-Token`.
- **Bearer token** — for automation; stored tokens authenticate API calls
  without CSRF. Setup returns the one-time token for API-only clients.

Setup discovery and session state (`GET /api/v1/session`) are the narrow
unauthenticated operations; everything that reads or changes appliance state
requires one of the credentials above. Login attempts are rate-limited with
persistent backoff and audited ([security.md](security.md)).

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/access.md`

## 3. Versioning

The API is versioned in the path (`/api/v1/...`), and the OpenAPI document in
the repository is diffed in CI against the base branch so a breaking change
is a visible act rather than an accident. Consume the contract from the
release you target; the document is versioned with the tree, like every other
artifact ([doc-contract.md](doc-contract.md)).

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/api.md`

## 4. What is not a public API

- **The D-Bus interface `com.mos.mosd1`** is the local IPC boundary between
  apid and mosd (and the boot health gate). It is root-only by policy on the
  device and is not a supported integration surface; integrate over HTTPS.
- **MQTT** is the application-data plane, not a management channel: only
  package-enrolled application services are bridged, and management state and
  actions are structurally excluded. The grammar and enrollment contract are
  [../design/bus.md](../design/bus.md).
- **`/ui` and custom UI assets** are static content, not contract; a custom
  bundle cannot shadow `/api` routes.

> status: shipped — evidence: `docs/design/bus.md`, `pkgs/mosd/dist/`

## 5. Trying it

The API acceptance suite boots the x64 image in QEMU and drives every phase
of the contract over a real socket — it is also the reference for how the
surface behaves end to end, including TLS, redirects and auth gating:

```sh
bash pkgs/mosd/tests/apid-api/run.sh
```

> status: shipped — evidence: `pkgs/mosd/tests/apid-api/run.sh`
