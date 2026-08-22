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

## Investigation — `own_prefix` semantics (measured 2026-08-22)

Deliverable 1 is done. The measurement ran against **dbus-daemon 1.12.20** on a
bus stood up for the purpose, whose base configuration is the stock system.conf
`<policy context="default">` stanza — `<deny own="*"/>` included — plus exactly
one scaffolding rule, `<allow own_prefix="com.mos.ext"/>`. That grant is the only
thing on the bus that can hand out any name, so every result below is attributable
to `own_prefix` and to nothing else. The scaffolding fragment is written into a
temporary directory at run time; `mosd/dist/com.mos.ext.conf` does not exist yet
and was deliberately not created, because the sequencing — measure first, write
the policy against the measurement — is the point of the task. Each name was
requested by an unprivileged identity (uid 65534) via `RequestName`.

| Bus name | Observed |
| --- | --- |
| `com.mos.ext.foo` | `OWNED` |
| `com.mos.ext.sensor.abc123` | `OWNED` |
| `com.mos.mosd` | `ERROR org.freedesktop.DBus.Error.AccessDenied` |
| `com.mos.extra` | `ERROR org.freedesktop.DBus.Error.AccessDenied` |
| `com.mos.ext` | `OWNED` |
| `com.mos.other` | `ERROR org.freedesktop.DBus.Error.AccessDenied` |
| `org.example.thing` (control) | `ERROR org.freedesktop.DBus.Error.AccessDenied` |

**PLAN-011 D5's assumption holds:** `own_prefix="com.mos.ext"` grants
`com.mos.ext.foo` and does not reach `com.mos.mosd`, so the namespace decision
stands as written and the grant needs no accompanying deny list.

Two details the plan did not state. `com.mos.extra` is refused, which confirms the
mechanism the `com.mos.mosd` result rests on: `own_prefix` is not a string-prefix
match, it requires the next character after the prefix to be `.`. And the bare
prefix `com.mos.ext` is itself `OWNED` — `own_prefix` matches the prefix with no
suffix at all. That name is inside the namespace extensions were given, so it
gives away nothing the decision did not intend to, but it is a name the
`com.mos.ext.<class>[.<suffix>]` grammar never contemplated: it has no fourth
dotted component for deliverable 4's class derivation to read. Deliverable 4 has
to decide what the bridge does with it rather than assume it cannot occur.

All seven names are now asserted with explicit expected values in
`mosd/hack/dbus-policy-test.sh` (section 4), so a dbus-daemon upgrade that changed
any of these semantics would fail the suite rather than silently invalidate D5.
The stage was mutation-checked: widening the scaffolding grant to
`own_prefix="com.mos"` turns the `com.mos.mosd` case into
`FAIL ... expected [ERROR org.freedesktop.DBus.Error.AccessDenied], got [OWNED]`,
while the `org.example.thing` control stays refused — the section fails for the
reason it claims to test, not because the bus broke.

## Outcome

Filled in at completion.
