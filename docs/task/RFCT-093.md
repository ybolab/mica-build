# RFCT-093 PLAN-011 M5: extension enablement — writable unit directory, the com.mos.ext namespace, and the bus scan

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent (BKD campaign 2, dispatched by L1 0yncfnol)
- **createdAt**: 2026-08-22 09:40
- **claimedAt**: 2026-08-22 09:40

PLAN-011 milestone M5, per the revised D5 (PLAN-011 §Proposal D5, revised
2026-08-22). Third-party services run as plain systemd units the integrator
installs; mos neither registers nor supervises them. mos contributes three
things: a writable, persistent unit directory; a policy grant for the
`com.mos.ext.*` namespace; and a bus scan that makes what is running visible
and publishable.

Deliverables:

1. **Measure `own_prefix` semantics first.** In `mosd/hack/dbus-policy-test.sh`
   (RFCT-048's live-bus harness), establish empirically that
   `own_prefix="com.mos.ext"` matches `com.mos.ext.foo` and does **not** match
   `com.mos.mosd`. The whole namespace decision rests on this and it was not
   verified when PLAN-011 recorded it. Policy is written after the measurement.
2. **Policy and the writable unit directory.** A policy file granting
   `own_prefix="com.mos.ext"` in the default context — no deny list, because
   system names fall outside the prefix and D-Bus's default `deny own="*"`
   already closes them. `/etc/systemd/system` becomes a STATE bind mount, the
   seventh, following the pattern `/etc/ssh` and `/etc/hostname` already use
   (`docs/design/ro-root.md` §4). Image verifier assertions for both.
3. **Scan and registry.** mosd watches `NameOwnerChanged` (arg0namespace
   `com.mos`) and publishes into live state: bus name, `Connected`, a
   conformance field naming what the service is missing, and `/DeviceInstance`
   collisions between services of one class. Disconnected services are retained
   under their cached name with an explicit remove action. Non-conforming
   services are warned about and published best-effort, never refused;
   `/DeviceInstance` absent falls back to `0`.
4. **Bridge class derivation.** An extension's `<class>` is the fourth dotted
   component (`com.mos.ext.<class>`), a system service's is the third. The
   policy and `mosd/mqttd/src/topic.rs` must agree on one rule; publishing an
   extension under the wrong class is the defect to test for.

Verify: `bash mosd/hack/check.sh` green with 0 skipped; `make docs-verify`;
the policy test asserts both that a user identity CAN own an extension name and
CANNOT own a system name; the scan is tested against a fake service appearing
and vanishing; `docs/design/bus.md` §5/§6 markers flipped per statement on what
actually landed.

Out of scope: M6 (udev device attach), `os/` image wiring for
`mos-mqttd.service`, the on-device broker smoke test, RFCT-092. No settings
schema change is required anywhere — D4 and D5's `extensions.*` subtree are both
withdrawn.

## Outcome

Filled in at completion.
