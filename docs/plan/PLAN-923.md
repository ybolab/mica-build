# PLAN-923 Adapt the local MOS initialization helper to the JSON API

- **status**: completed
- **createdAt**: 2026-09-08 08:04 UTC
- **approvedAt**: 2026-09-08 08:04 UTC
- **completedAt**: 2026-09-08 08:18 UTC
- **relatedTask**: RFCT-943

## Context

The existing helper is `/workspace/miehq/.local/mos-setup.sh`, outside the MOS
Git checkout. Its SHA-256 before changes is
`2a23b97bd77d342788153f8984a9dee3cbcbff7f4fb01140df3ed0242895a27e`.
It accepts an IP address, an optional administrator password and an optional
SSH public-key file. It claims a fresh device, enables SSH and MQTT, adds the
public key, and checks root SSH access.

The helper detects state through redirects to `/setup` or `/login`, posts
URL-encoded forms to those paths, then uses `/ssh/enable`, `/mqtt/enable` and
`/ssh/keys/add`. The captured mainline now redirects `/` to `/_ui/`; a read-only
probe of `/setup` on the reported board returned 404. The helper therefore
stops at state detection before any initialization on this image.

The current contracts are implemented by `pkgs/mosd/apid/src/routes.rs`,
`pkgs/mosd/apid/openapi.json`, and the built-in UI's access and task components:

| Operation | Current contract |
| --- | --- |
| Detect initialization | `GET /api/v1/session`, inspect `state` |
| Claim fresh device | `POST /api/v1/setup` with `{ "password": "..." }`; 201 returns token, CSRF token and a session cookie |
| Sign in to existing device | `POST /api/v1/session` with the existing password; 201 returns CSRF token and a session cookie |
| List/add SSH keys | `GET`/`POST /api/v1/ssh/authorized-keys`; add body is `{ "key": "..." }` |
| Enable SSH | `PUT /api/v1/settings/access.ssh.enabled` with bare JSON `true` |
| Enable MQTT | `PUT /api/v1/settings/mqtt.enabled` with bare JSON `true` |
| Confirm settings apply | 202 returns `taskId`; poll `/api/v1/tasks/{id}` until `status=finished`, then require `outcome=succeeded` |

Cookie-authenticated writes require `X-CSRF-Token`. HTTP acceptance alone does
not prove the daemon applied the setting. Duplicate SSH keys are identified
by key material, with `key_exists` distinct from other 409 errors.

The reported endpoint `192.168.27.71` currently answers HTTPS health and
session reads, reports `setup`, and refuses TCP port 22. The serial console
shows `mos-89dea6b4` at a Linux login prompt. Root authentication, eMMC boot
source, and runtime health remain unverified. No device mutations were made
during investigation.

## Proposal

1. Adapt the existing local Bash helper in place, using curl and jq for the
   documented JSON routes. Preserve its initialization, SSH-key access and
   MQTT behavior, with an explicit option to leave MQTT unchanged.
2. Detect fresh versus configured devices through the session API. Generate
   a password only for a fresh device; require an existing credential on a
   configured device. Do not silently reset the administrator password.
3. Support password-file input and retain the existing positional invocation.
   Store generated credentials and the one-time setup token in a private
   local file before continuing. Never print secrets in progress or error
   output, and avoid placing request secrets in subprocess arguments.
4. Carry the session cookie and CSRF token through authenticated writes.
   Validate the public key with OpenSSH, add it without replacing existing
   keys, and verify a duplicate by reading the collection back.
5. Wait for each settings task, fail on an unsuccessful terminal outcome or
   timeout, and read back the requested settings and key before SSH testing.
6. Replace unconditional known-host deletion and disabled host-key checking
   with normal first-use acceptance. A changed existing key must be reported
   explicitly, with an opt-in replacement only for a confirmed reflash.
7. After the approved helper changes pass focused tests, initialize the
   reported device, establish key-based SSH, verify the observed hostname,
   and continue the requested read-only eMMC runtime inspection.

## Verification

- Bash syntax validation and isolated HTTP/SSH fixtures covering fresh setup,
  existing-device login, CSRF, duplicate-key handling, failed/unfinished tasks,
  missing credentials, and SSH failure.
- Verify non-success responses stop dependent writes and credentials never
  appear in captured stdout/stderr or fixture process arguments.
- On the target device, verify the expected hostname, requested settings and
  installed key; then inspect the running kernel/root hashes, eMMC partitions,
  persistent mounts, RAUC/U-Boot state, failed services and current boot logs.
- Reboot, slot changes, flashing and peripheral connection tests are outside
  this initialization and read-only inspection scope.

## Risks

First-run setup establishes the device administrator credential. A later step
can fail after setup has succeeded, so the script must preserve the credential
and support an authenticated retry. Enabling SSH grants root access to the
selected key. Enabling MQTT retains the old helper's behavior and should be
shown in the action summary. Self-signed HTTPS handling remains explicit in
the local bench invocation; secrets must not be sent across HTTP redirects.

## Scope

The existing local helper, a focused local test helper, and these tracking
records. No firmware rebuild, server API change or image change is required.
The local helper is outside MOS Git and must be identified separately from
the already committed board adaptation.

## Alternatives

The built-in web interface can perform setup and install the key manually.
Using the local helper preserves the repeatable post-flash workflow requested
for this bench. Restoring retired form endpoints would unnecessarily change
the device API and require another image deployment.

## Annotations

Implementation approved with `proceed` on 2026-09-08. A fresh read immediately
after approval returned `unauthenticated`, indicating that an operator has
already initialized the device. Live validation must use the existing
administrator credential and must not claim or reset it again.

The user subsequently selected the SD-booted `192.168.27.72` and requested
initialization plus functional inspection. The serial hostname is
`mos-490fab24`; this fresh SD installation reports `setup`, so the helper may
generate its initial credential. The earlier eMMC endpoint is no longer the
target. Read-only checks must first establish actual block-device identities;
the older runtime verifier's fixed `mmcblk0` assumptions do not establish that
an SD installation uses the same device numbering as eMMC.

## Delivery

The local Bash helper now uses the JSON setup/session/key/settings APIs,
CSRF, private credential files, asynchronous task polling and readback, and
normal SSH host-key checks. Fifteen isolated HTTPS/SSH tests passed. Fresh
setup and an authenticated second run on `192.168.27.72` both passed.

The requested SD runtime inspection is complete. Storage and image identity,
Ethernet, NTP, API reads, MQTT message flow, container execution/networking,
radio discovery, HDMI PCM access and USB enumeration were measured. The
front-panel scripts are non-executable in the image, causing both their unit
and mos-health to fail. These findings are recorded in RFCT-943 and the
pending RFCT-944 follow-up; the image is not fully qualified.
