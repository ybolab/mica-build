# Management API and UI hosting

`apid` owns HTTPS, authentication, the JSON management API and static UI
hosting. `mosd` owns settings, reconciliation and system actions over D-Bus.
The generated [OpenAPI document](../../pkgs/mosd/apid/openapi.json) is the
operation and schema contract. This page explains ownership and behavior;
it does not duplicate the route inventory.

## 1. Runtime boundary

The appliance runs separate `mosd` and `apid` systemd services. API handlers
use the typed settings/bus client for management operations. MQTT carries only
package-enrolled application item trees and cannot invoke this management API
through the bus. See [management](mosd.md) and [bus](bus.md).

`/api` owns management operations, discovery, authentication and API errors.
`/healthz` only checks the listener; it is not the appliance health verdict.
`/_ui/` always serves the embedded dashboard. `/` serves a valid selected
custom UI or redirects to the built-in dashboard.

## 2. Resources and actions

### 2.1 Settings, observations and tasks

Configuration describes requested state. Observations describe what the device
currently reports. Network observations combine configured interfaces with
`systemd-networkd` state; observation failure remains explicit while readable
configuration is retained. Top-level interface fields are normalized; nested
address, DNS and route arrays retain networkd's vocabulary.

Accepted settings mutations return an apply task. Clients observe its ID and
terminal outcome rather than treating HTTP acceptance as successful application.
The bounded apply queue can fold related writes into a broader task; the
returned ID, outcome and task metadata describe that admission. Task history
is bounded, and an interrupted task is not silently reported as successful.

Power, update, reset and credential operations have their own typed routes and
policy checks. Native deployment state and rollback refusals are specified in
[updates](updates.md). Firmware maintenance is a separate operation described
in [release signing](release-signing.md).

Power actions return 202 only after mosd admits the request. A policy or permission
refusal returns 409 `power_refused` with its reason; dispatch failure, unavailable
mosd and timeout return 500, 503 and 504 respectively. Acceptance does not prove
that reboot completed. The dashboard closes confirmation to expose this result
and does not retry power mutations automatically.

### 2.2 Errors and redaction

API errors use the published JSON envelope, including unmatched API paths and
unsupported methods. Missing data, a failed bus observation and an unsupported
capability are distinct outcomes. Responses do not fabricate healthy defaults
when their source is unavailable.

Settings reads and diagnostics redact secrets at the management boundary.
Passwords, password hashes, private keys and token material are not returned
through general settings or diagnostic responses. Dedicated write operations
validate the supported path and shape before forwarding a mutation.

## 3. Authentication

`GET /api/v1/session` reports session/setup state. Password login creates a
signed session cookie; browser mutations also require the per-session
`X-CSRF-Token`. Stored bearer tokens support automation and do not use CSRF.
Credential and token operations follow the generated schema and
[access policy](access.md).

The built-in SPA uses root-relative `/api/...` requests and stores no session
or bearer credential in browser storage. Persistent login backoff and a bounded
audit trail survive service restart. Recovery rotates a credential under the
[presence gate](recovery.md#4-physical-presence); it never reveals one.

The TLS certificate and private key are published together as one private
`identity.pem`. File and directory synchronization complete before publication
is reported successful. The cookie signing key is also persisted durably.
First-boot interruption must not leave a certificate paired with a missing or
partially written key.

## 4. Static hosting

API, built-in and custom resource roots are isolated. A miss in one root never
falls through to another. Logical paths are decoded once and validated before
lookup; traversal, encoded separators, control characters and reserved-root
aliases are refused. SPA fallback remains inside the selected resource root.

`apid/build.rs` embeds the complete frontend build supplied by the package
producer. `index.html` is the stable entry; content-hashed route, locale and
vendor chunks remain separately addressable and cacheable. The frontend build
and its dependency lock are under `pkgs/mosd/apid/ui/`.

## 5. Custom UI lifecycle

Authenticated upload streams a bounded raw ZIP into `/mos/ui`, validates its
manifest and paths, and atomically installs a retained generation. Installation
does not activate it. Activation rechecks and selects the exact requested
generation; removing the selection returns to the built-in UI. Only inactive
generations may be deleted. Retention is explicit.

Custom UI installation does not replace the root filesystem or enroll OS trust
keys. A UI archive is distinct from a signed OS `.mosupd` archive. Packaging
instructions are in the [application guide](../user/applications.md).

## 6. Built-in recovery and verification

`/_ui/` stays reachable even when a custom UI is missing, invalid or broken.
Custom content cannot shadow that prefix or the API. The fallback's assets live
inside the authenticated immutable root, independent of DATA UI selection.

Rust route and bus tests verify authentication, path isolation, validation and
task behavior. The OpenAPI generation gate checks the committed schema against
the binary. The [API harness](../../pkgs/mosd/tests/apid-api/README.md) exercises
the full service stack on a fresh current QEMU image. The harness writes its result to
`_out/<board>/apid-api/result.json`.
