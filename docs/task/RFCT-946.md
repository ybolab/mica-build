# RFCT-946 Permit the built-in Wi-Fi client switch through the settings API

- **status**: completed
- **priority**: P1
- **owner**: miehq
- **createdAt**: 2026-09-08 09:42 UTC
- **relatedPlan**: PLAN-925

## Finding

The built-in network page addresses `wifi.client.enabled`, but mos-apid's
scalar settings allowlist omits it. A valid authenticated request receives
409 `settings_read_only` before reaching mosd. The inherited mainline
baseline contains the same mismatch. RFCT-945 demonstrated that managed
Wi-Fi association, DHCP, DNS and HTTPS work through native settings control.

## Acceptance

- Enable and disable return 202 with an observable settings task.
- Invalid bodies remain 422; adjacent Wi-Fi paths remain 409.
- Browser sessions retain authentication and CSRF enforcement.
- Generated OpenAPI documents the supported switch.
- Source checks do not restart packaging or deploy to the device.

## Evidence

The allowlist now admits the intended boolean leaf, and OpenAPI plus the
resource inventory describe it. The source repair passed formatting,
warning-free clippy, 325 apid binary tests and the generated-document check.
The test matrix covers both switch states and returned tasks, the browser's
session/CSRF contract, five invalid JSON shapes and adjacent read-only paths.
See [PLAN-925](../plan/PLAN-925.md) for the test scope and the two process-level
tests whose separate mosd binary prerequisite was unavailable.

Source delivery is complete. The running device still carries the old
mos-apid, so its browser switch remains refused until that service is
updated. Packaging and device deployment were explicitly excluded after
the user's disk-space stop instruction.
