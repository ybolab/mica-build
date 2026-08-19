# RFCT-048 D-Bus policy: com.mos.mosd is root-only, and a live-bus test that proves it

- **status**: implementation complete — `bash mosd/hack/check.sh`,
  `make os-shadow-test`, `make os-dbus-policy-test` and both image builds with
  both profiles and both verifiers all green; no on-device claim is made
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 11:52
- **claimedAt**: 2026-08-19 11:52
- **completedAt**: 2026-08-19 14:40

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/0jb0papo`, merged by
L2 into `bkd/hiu25adw`.

## Description

mosd owns `com.mos.mosd` on the system bus. The policy the image shipped was a
development skeleton:

```xml
<policy user="root">
  <allow own="com.mos.mosd"/>
</policy>
<policy context="default">
  <allow send_destination="com.mos.mosd"/>
  <allow receive_sender="com.mos.mosd"/>
</policy>
```

Any local uid could call `Reboot`, `PowerOff` and `SetSettings`, and could
subscribe to `SettingsChanged`.

### Why this campaign owns it

The gap predates the campaign, but the campaign made it worst. RFCT-033 added
`SetTransientRootPassword`, which writes a root credential straight into
`/etc/shadow`. Under the shipped policy that method was reachable by any
process on the device, so the campaign's own contribution to the interface was
the one that turned an over-broad development posture into a local privilege
escalation. Closing it here rather than filing it forward is the same ownership
rule RFCT-047 applied to the restart-versus-reload question.

The user ruled that the bus name must be reachable only by root and the service
identity.

## The policy

`mosd/dist/com.mos.mosd.conf` now carries an explicit default-context DENY and
a root-only ALLOW:

```xml
<policy context="default">
  <deny send_destination="com.mos.mosd"/>
  <deny receive_sender="com.mos.mosd"/>
</policy>

<policy user="root">
  <allow own="com.mos.mosd"/>
  <allow send_destination="com.mos.mosd"/>
  <allow receive_sender="com.mos.mosd"/>
</policy>
```

`own=` was already root-only; it stays there and is now asserted rather than
merely true.

**Nothing that exists is broken by this.** Every client that speaks to mosd runs
as root. `grep -rn '^User=' --include='*.service'` across the repo returns
nothing: `mosd.service` owns the name as root, `webd.service` sets no `User=`,
and `os/rootfs/overlay-v2/usr/lib/systemd/system/mos-health.service` — the unit
whose script calls `busctl --system call com.mos.mosd ...` — sets none either.
No counter-example was found.

### `receive_sender` moves too, and that is deliberate

This was not part of the original ruling and is included on purpose. The
interface emits a broadcast signal `SettingsChanged(path, value_json)` carrying
the settings **value**. Denying send while allowing receive would let any local
uid subscribe and read every settings change as it happens — including
`access.webAdmin.password_hash` the moment an operator sets it. **A caller who
cannot ask can still listen.** Both directions are closed, and the file states
that reasoning where the rules are.

### Why `<deny>` and not just dropping the `<allow>`

Dropping the allow is enough on the send side and NOT enough on the receive
side, and the asymmetry is easy to miss. The standard `system.conf` default
stanza contains both of these:

```xml
<deny send_type="method_call"/>
...
<allow receive_type="signal"/>
```

So with the allow merely removed, method calls would be denied by the base
configuration — but `SettingsChanged` would still be delivered to every uid on
the device, because the base configuration allows receiving signals by default.
The explicit deny is what actually closes the listening side. It also makes the
send side hold on its own rather than depending on what the base configuration
happens to permit.

This is why the requirement "the default block must not ALLOW it" is met by a
block that DENIES it: an allow-shaped hole and a deny-shaped floor are not the
same object.

### The extension point

The file documents, in the comment next to the rules, what to do when webd
gains its own non-root user (an open question in a parallel campaign, not
decided here): **add** a `<policy user="webd">` block granting that identity
what it needs.

The comment names the failure mode explicitly, because it is the easy wrong
move: moving the rules back into `<policy context="default">` reads in a diff
like restoring a line, while it actually re-grants **every** local uid — the
new unprivileged helper included, along with everything else on the device. A
named-user block grants exactly one identity and fails closed for the rest.

### Per-method allowlisting — deferred, with a recommendation

Not implemented. D-Bus policy can split members with `send_interface=` and
`send_member=`, so the read-only members (`GetSettings`, `GetState`) could be
separated from the mutating ones (`SetSettings`, `Reboot`, `PowerOff`,
`SetTransientRootPassword`, `ReportHealth`).

**Recommendation: do the split, but only once a second identity exists.**

Today every caller is root, so a per-method split would partition one identity
against itself: it buys no separation while adding a list that has to be kept in
step with `mosd/mosd/src/bus.rs`. A member added there without a matching rule
here fails at runtime with an `AccessDenied` that looks nothing like "you forgot
the policy file" — a maintenance cost paid immediately for a benefit that
arrives only later.

The split earns that cost the day a non-root webd needs `GetSettings` and
`GetState` and must NOT reach `Reboot` or `SetTransientRootPassword`. That is
the same moment the extension-point block above gets written, so the two should
land together: the new `<policy user="webd">` block should carry `send_member=`
rules rather than a blanket `send_destination=`.

## The live-bus test

`mosd/hack/dbus-policy-test.sh`, wired to `make os-dbus-policy-test`.

Reading the XML back and asserting it says the right thing proves nothing about
what `dbus-daemon` does with it, so the harness stands up a **real**
`dbus-daemon` whose configuration `<include>`s the shipped file verbatim, owns
`com.mos.mosd` from a root connection, and drives root and non-root clients at
it. The non-root side is `setpriv --reuid=65534 --regid=65534 --clear-groups`,
following the unprivileged-user pattern in `os/shadow-reconcile-test.sh`.

### The client

There are no D-Bus bindings on the check host and no new dependency is in scope,
so the harness embeds a ~265-line stdlib-only Python D-Bus client that speaks
just enough of the wire protocol to own a name, make a method call, emit a
signal and subscribe to one — exactly the operations the policy governs.

`dbus-send` cannot stand in for it: it makes method calls only, so it can test
neither `own=` nor `receive_sender=`. `dbus-monitor` cannot either, because
monitoring goes through `BecomeMonitor`/eavesdropping, a **different policy
path** from the ordinary signal delivery that `SettingsChanged` actually uses —
a receive test built on it would be testing the wrong rule.

### Both directions, plus controls

| # | check | expected |
| --- | --- | --- |
| 0 | root owns `com.mos.mosd` | OWNED |
| 0 | root owns the control name | OWNED |
| 0 | nobody owns an unrestricted name | OWNED |
| 0 | nobody calls an unrestricted name | OK |
| 0 | nobody receives a signal from an unrestricted name | GOT |
| 1 | non-root SEND to `com.mos.mosd` | AccessDenied |
| 1 | root SEND to `com.mos.mosd` | OK |
| 2 | non-root RECEIVE of `SettingsChanged` | not delivered |
| 2 | root RECEIVE of `SettingsChanged` | delivered |
| 3 | non-root OWN of `com.mos.mosd` | AccessDenied |

The permitted direction of check 3 is check 0's "root owns `com.mos.mosd`": the
name is owned by a root connection for the whole run, which is the only reason
checks 1 and 2 have anything to talk to.

The check-0 controls exist because **a refusal is ambiguous on its own**.
"Nobody was refused" and "the unprivileged connection never worked" produce
identical output, so the bus configuration adds two names that are pure test
scaffolding — `com.mos.control`, deliberately open, and `com.mos.unprivileged`,
deliberately ownable. Every refusal below them is attributable to the shipped
policy rather than to a broken harness.

`com.mos.control` is owned by a **separate** root connection, not by the same
one that owns `com.mos.mosd`. One connection owning both would destroy the
control outright: `receive_sender=` matches on the sending connection's names,
so the deny on `com.mos.mosd` would suppress the control name's signals too and
the control would "confirm" a refusal that had nothing to do with the policy.

The `<policy context="default">` stanza in the test bus configuration is a
verbatim copy of the one in the standard `system.conf`, so the only thing
separating this bus from a stock system bus is the shipped file it includes.

### What it proves, and what it does not

**Proves**, against a real `dbus-daemon` 1.12.20 enforcing the shipped file:
non-root is refused and root is permitted, for send, for receive and for own.

**Does not prove:**

- **Nothing about a device.** The bus is a temporary `dbus-daemon` on the check
  host, not the system bus on hardware. No boot was performed.
- **Nothing about mosd itself.** The name is owned by the test client, not by
  the real daemon; the method called is a stub that returns `{}`. This is a test
  of the policy, not of the interface behind it.
- **Nothing about the packed image.** It reads `mosd/dist/com.mos.mosd.conf`
  from the repo. That the image ships that same file at the path
  `dbus-daemon` reads is the verifiers' job, and is asserted there.
- **Nothing about uids other than 0 and 65534.** The policy is written in terms
  of `user="root"`, so one non-root uid is representative — but that is an
  argument from the rule's shape, not something the test exercised.
- **Nothing about `at_console`, group rules or `send_interface=` filtering.**
  None of those appear in the shipped file; the harness would not notice if they
  did.

## Verifier assertions

Five, added to both `os/verify-image.sh` and `os/verify-image-v2.sh`. All five
apply to both layouts: v1 and v2 both ship the policy file, `mosd.service` and
`ssh.service`.

| # | assertion | what it protects |
| --- | --- | --- |
| 1 | the policy ships and is readable at `/usr/share/dbus-1/system.d/com.mos.mosd.conf` | a policy at any other path is not a stricter policy, it is NO policy |
| 2 | no `context="default"` policy ALLOWs `send_destination=` or `receive_sender=` for the bus name | the skeleton posture coming back |
| 3 | `allow own=` appears under `<policy user="root">` and nowhere else | an unprivileged process taking the name before mosd does |
| 4 | every `com.mos.*` name the policy mentions equals `BusName=` in the shipped `mosd.service` | a policy for a name nothing owns |
| 5 | `ssh.service` carries `ExecReload=` | RFCT-047's reload silently failing to apply |

### 1 — the path, not just the file

Both verifiers already asserted the file is a regular file at that path. What is
added is that its **contents are readable**, which is what checks 2 to 4 stand
on, and a failure message that says why the directory matters: `dbus-daemon`
reads system-bus policy from `/usr/share/dbus-1/system.d/`, so a policy shipped
anywhere else leaves the daemon taking the name with `system.conf` deciding
alone.

### 2, 3, 4 — parsed the way dbus-daemon groups it

A grep is not sufficient here, for two reasons.

**XML comments.** The shipped file documents its own extension point with
example markup — including a literal `<allow send_destination="com.mos.mosd"/>`
inside the `<policy user="webd">` example, and prose naming
`<policy context="default">`. A check that could not tell an example from a rule
would be worse than no check: it would fail on a correct file, and the obvious
"fix" would be to delete the documentation that stops the next person reopening
the default context.

**Blocks, not lines.** A rule's meaning comes entirely from the block it sits
in. `<allow own="com.mos.mosd"/>` is correct under `<policy user="root">` and a
privilege escalation under `<policy context="default">`; the line is identical.

So both verifiers strip comments with a small state machine, split the document
on `<policy`, classify each block by its attributes, and count allow rules per
block kind. The bus name is READ from `mosd.service`'s `BusName=` rather than
restated, so the policy and the unit cannot drift apart silently.

Check 4 is stricter than "the policy mentions the right name somewhere": the set
of `com.mos.*` names appearing in any `own=`, `send_destination=` or
`receive_sender=` attribute must equal exactly `{BusName}`. That catches the
typo that is invisible by inspection — a `<deny receive_sender="com.mos.mosdx"/>`
denies nothing, and a "no default-context allows" check would still report zero
while the real name sat wide open.

### 5 — `ExecReload`, routed here from RFCT-047

RFCT-047 made `SshdReconciler` RELOAD `ssh.service` on a configuration-only
change instead of restarting it, so an operator who sets a transient root
password over their own SSH session keeps it. That correctness now depends on
the unit shipped by Debian's `openssh-server` carrying an `ExecReload=` — a
property this image **inherits rather than chooses**, exactly like `KillMode`
(RFCT-036 assertion 7). RFCT-047 could not assert it because the verifier is not
its file.

The finding is positive: both images do carry it.

The failure message states the consequence rather than the fact: with no
`ExecReload=`, `systemctl reload ssh.service` fails outright, the reconciler
renders its configuration to disk, and the running sshd never re-reads it. A
change — `PasswordAuthentication` among them — **silently fails to apply**: the
file on disk says one thing and the listener keeps enforcing another until
something else restarts the unit. Nothing crashes and nothing logs a policy
error.

## Verifier check counts

| image | profile | before | after |
| --- | --- | --- | --- |
| v1 | dev | 127 | 132 |
| v1 | prod | 127 | 132 |
| v2 | dev | 299 | 304 |
| v2 | prod | 299 | 304 |

No check was removed; each layout gains the same five. Both "before" figures
were measured on this branch before any edit, against images built from the
campaign head.

## Assertions proven to fail when broken

Each property was broken in a **scratch copy** of the verifier — the breakage is
injected immediately after the image tree is extracted, so the shipped files are
never touched — the specific check confirmed to FAIL, and the scratch copy then
deleted. Both verifiers were confirmed clean afterwards (132/132 and 304/304).

| # | breakage | v1 | v2 |
| --- | --- | --- | --- |
| 1 | policy file removed from the image | FAIL 128/132 | FAIL 299/304 |
| 2 | `<deny send_destination>` -> `<allow send_destination>` in the default block | FAIL 131/132 | FAIL 303/304 |
| 2 | `<deny receive_sender>` -> `<allow receive_sender>` in the default block | FAIL 131/132 | FAIL 303/304 |
| 3 | extra `<policy context="default"><allow own=...></policy>` appended | FAIL 131/132 | FAIL 303/304 |
| 4 | every policy name changed to `com.mos.mosdx` | FAIL 130/132 | FAIL 301/304 |
| 4 | `BusName=` in `mosd.service` changed to `com.mos.other` | FAIL 129/132 | FAIL 301/304 |
| 5 | `ExecReload=` lines deleted from `ssh.service` | FAIL 131/132 | FAIL 303/304 |

The v1 breakages were written into the extracted ext4 with `debugfs -w`; the v2
ones into the unpacked squashfs tree.

Scenario 1 uncovered a real defect in the first draft of these checks: with no
`com.mos.*` name in the policy at all, the name-collecting pipeline's `grep`
exited 1 and `set -euo pipefail` killed the verifier — turning "the policy is
missing" into a crash with no `RESULT:` line instead of three explicit FAILs.
Fixed, and the fix is what the 128/132 and 299/304 rows above measure.

### The live-bus test, proven to fail when the policy is broken

Same discipline, on a scratch copy of the policy, restored byte-identical
afterwards (`cmp` confirmed).

| policy breakage | result |
| --- | --- |
| the OLD dev-skeleton policy this task replaces | 8/10 — non-root SEND and non-root RECEIVE both fail |
| default-context ALLOW `send_destination` | 9/10 — non-root SEND fails |
| default-context ALLOW `receive_sender` | 9/10 — non-root RECEIVE fails |
| default-context ALLOW `own` | 9/10 — non-root OWN fails |
| **root block loses its send/receive allows** | **8/10 — root SEND and root RECEIVE both fail** |

The last row is the one that matters most. A refusal-only suite passes against a
policy that denies everybody, including root — a device on which mosd is
unreachable and nothing works. That row is the proof this suite can tell the
difference.

## Files changed

| file | change |
| --- | --- |
| `mosd/dist/com.mos.mosd.conf` | root-only policy; default-context deny; extension-point and deferred-allowlist comments |
| `mosd/hack/dbus-policy-test.sh` | NEW — live-bus test, 10 checks |
| `Makefile` | NEW target `os-dbus-policy-test`, plus `.PHONY` and help entries |
| `os/verify-image.sh` | five assertions |
| `os/verify-image-v2.sh` | the same five |
| `docs/task/RFCT-048.md` | this record |

`mosd/mosd/**`, `mosd/webd/**`, `mosd/mosd-settings/**`, `os/rootfs/**` and
`docs/task/index.md` are untouched. No `Cargo.toml` gained a dependency.

## Verification (2026-08-19)

All run from the repo root with `BOARD_DIR=/srv/ai/mos/board/cx3576` and
`TMPDIR=$PWD/_out/tmp`.

| command | result |
| --- | --- |
| `bash mosd/hack/check.sh` | ALL CHECKS PASSED, 298 tests |
| `make os-shadow-test` | 220 passed, 0 failed |
| `make os-dbus-policy-test` | 10 passed, 0 failed |
| `make os-image-cx3576` + `bash os/verify-image.sh`, `MOS_PROFILE=dev` | PASS 132/132 |
| `make os-image-cx3576` + `bash os/verify-image.sh`, `MOS_PROFILE=prod` | PASS 132/132 |
| `make os-image-cx3576-v2` + `bash os/verify-image-v2.sh`, `MOS_PROFILE=dev` | PASS 304/304 |
| `make os-image-cx3576-v2` + `bash os/verify-image-v2.sh`, `MOS_PROFILE=prod` | PASS 304/304 |

## What is NOT proven

**No hardware claim is made. Nothing here proves anything about a booted
device.** Every result above is either a statement about bytes in a packed image
or the behaviour of a temporary `dbus-daemon` on the check host. That the image
ships a root-only policy is not proof that a device enforces it; that a test bus
refused uid 65534 is not proof that the system bus on hardware refuses anything.
No boot was performed.

**The live-bus test does not exercise mosd.** The name under test is owned by a
stub client. Nothing here proves that the real daemon takes the name under this
policy — only that a root connection may, which is a claim about the policy.

**`dbus-daemon` version.** Everything was exercised against 1.12.20 on the check
host. The device ships whatever Debian bookworm provides. Policy semantics for
`own`/`send_destination`/`receive_sender` are long-stable, but no cross-version
comparison was made.

**No claim that the deny is complete.** The verifier assertions rule out
default-context allows for the bus name and non-root `own=`. They do not rule
out every conceivable way to reopen the name — a `<policy group="...">` or
`<policy context="mandatory">` block, or a SECOND policy file dropped into
`/etc/dbus-1/system.d/` (which `dbus-daemon` also reads and which would override
this one). No assertion looks for a second file.

**Nothing verifies the reload itself.** Assertion 5 checks that `ssh.service`
carries an `ExecReload=`, not that the reconciler issues a reload, that the
reload succeeds, or that an established session survives it. RFCT-047 owns the
first; the last is observable only on real hardware.

**The `receive_sender` denial is proven for signals only.** The test subscribes
to a `SettingsChanged`-shaped broadcast. `receive_sender=` also governs method
returns and errors from that connection; those were not separately exercised,
and the root-side allow covers them on a device where every caller is root.

**No performance or boot-time claim.** Adding two deny rules to a policy file is
not free of consequence in principle; nothing here measured it.

## ActiveForm

D-Bus policy hardening for the SSH access campaign: `com.mos.mosd` restricted to
root for own, send and receive, with the receive side closed by an explicit deny
because the base configuration allows signal delivery by default; a live-bus
test that proves both directions of all three guards against a real
`dbus-daemon`; five assertions in each verifier, each proven to fail when its
property is broken.

## Dependencies

- RFCT-033 (transient root password; added the method that made the skeleton
  policy a privilege escalation) — merged
- RFCT-036 (verifier integration; established the "prove it fails when broken"
  rule and the `KillMode` inherited-property pattern this task's assertion 5
  follows) — merged
- RFCT-047 (reload rather than restart on a config-only change) — sibling; owns
  the reconciler, and assertion 5 here is the image-side property that change
  depends on
