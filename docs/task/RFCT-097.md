# RFCT-097 Wire mos-mqttd into the image, which is where three of its defects were

- **status**: completed — implementation complete, `bash mosd/hack/check.sh`, `bash os/ui-location-test.sh`, `bash mosd/hack/dbus-policy-test.sh` and the full image chain green; on-device behaviour is the user's acceptance
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-23 02:40
- **claimedAt**: 2026-08-23 02:40

PLAN-011 M3 shipped `mos-mqttd` — the crate, `dist/mos-mqttd.service`, and
fourteen protocol tests against an in-memory transport double — and shipped it
nowhere. Nothing in `os/rootfs/build-v2.sh`, `os/rootfs/Dockerfile.v2` or
`mosd/hack/build-aarch64.sh` referenced it, so the MQTT data publishing D6
specifies did not exist on the device. RFCT-091 recorded the image wiring as
deferred; this is that follow-up.

The wiring is the small part. Three defects only became visible once the
bridge had to run somewhere, and each of them is silent.

## What was wrong, measured

**1. The D-Bus grant could not have existed.** `mos-mqttd.service` ran under
`DynamicUser=yes`. `com.mos.mosd` is a root-only bus name (RFCT-048): its
default context denies both `send_destination` and `receive_sender`. A
non-root bridge therefore needs an explicit grant — and `<policy user=>`
resolves its user when dbus-daemon reads the file at startup, before any
dynamic user for the unit exists. The rule would have parsed, loaded, and
matched nothing. The observable result on the device is a unit that is
`active`, a broker that shows a connected client, and no data, ever.

**2. The broker address was baked into a read-only filesystem.** `ExecStart`
carried `--broker-host localhost`. The root is an immutable dm-verity
squashfs, so that is the same address on every device flashed with the image,
and `systemctl edit` has nowhere to write. There was no way to point a flashed
device at a broker short of rebuilding.

**3. The event loop was a spin loop.** `runtime.rs` polled rumqttc and, on
error, `continue`d immediately. Measured against rumqttc 0.25.1: `poll()`
begins `if self.network.is_none() { connect(...) }` with no delay
(`eventloop.rs:150`), and its `connection_timeout` bounds a connect that
*hangs*, not one that is *refused*. A refused connection returns in
microseconds — which is the default case, since (2)'s fallback is
`localhost:1883` with nothing listening — so the loop ran as fast as the
kernel could return ECONNREFUSED, pegging a core and writing one
`tracing::warn!` per iteration into a journal on the STATE partition.

None of the three is visible from the code side, and the crate's fourteen
protocol tests were green throughout: the transport double they run against
has no image, no bus policy and no socket.

## What shipped

**The wiring.** `mosd/hack/build-aarch64.sh` cross-builds `-p mos-mqttd` and
checks its ELF like the others; `os/rootfs/build-v2.sh` stages the binary, the
unit and the grant; `os/rootfs/Dockerfile.v2` installs them, creates the
service account, and enables the unit. Enabled, not left disabled: the root is
read-only, so a unit that ships disabled ships permanently disabled.

**A static identity.** `User=mos-mqttd`, a system account with uid/gid pinned
to 990. Pinned for a reason distinct from the `mos` account's: the D-Bus
policy names the account BY NAME and dbus-daemon resolves that name to a
number at startup, so an allocator-chosen uid would make the shipped grant a
rule matching a uid the unit does not run as. `chage -d 2020-01-01` keeps the
packed rootfs — and therefore its verity root hash — independent of the build
date, as the `mos` account already does. Everything `DynamicUser` was
providing implicitly (`RemoveIPC`, `UMask`) is now stated explicitly.

**A per-member grant, `mosd/dist/mos-mqttd.conf`.** `GetItems` and `SetValue`
sent on `com.mos.Item1`, `ItemsChanged` received, nothing else. This is the
split `com.mos.mosd.conf` recorded as deferred "the day a non-root client
needs GetSettings and GetState and must NOT reach Reboot or
SetTransientRootPassword" — that day, because the bridge is the only daemon in
the image with a network socket and a blanket `send_destination` would hand a
compromise of it `Reboot`, `PowerOff`, `SetSettings` and
`SetTransientRootPassword`. The three members are the bridge's entire bus
surface, read out of `mosd/mqttd/src/source.rs` rather than guessed: it calls
no `GetValue` at all, which is narrower than the obvious assumption.

`SetValue` is granted even though the unit ships `read-only`, deliberately:
the mode is an operator setting on STATE and the root is immutable, so a
policy that had to change with the mode would make `full` unreachable without
reflashing. The mode gate stays in the bridge; the policy bounds what the
process could reach if that gate were defeated.

**A configurable broker.** `EnvironmentFile=-/var/lib/mos/mqttd.env` over
`Environment=` defaults, with `ExecStart` parameterised. `/var/lib/mos` is a
STATE-backed bind (`var-lib-mos.mount`, `What=/mnt/state/mos`), so a broker
configured on the device survives a reboot and an A/B update. The leading `-`
makes an unconfigured device run on defaults rather than fail to start.

**Backoff.** `ReconnectBackoff` in `mosd/mqttd/src/runtime.rs`: 1s doubling to
a 30s ceiling, reset by any successful poll.

## Verification

**The policy is measured on a real bus, not read back.**
`mosd/hack/dbus-policy-test.sh` gained §6: a third dbus-daemon loading BOTH
shipped files — unlike §5, which keeps files apart, because the question here
is whether an allow survives the deny it is layered over in the combination
the device actually loads. Fourteen checks, both directions: the granted uid
CAN call `GetItems` and `SetValue` and CAN receive `ItemsChanged`; it CANNOT
call `Reboot`, `PowerOff`, `SetTransientRootPassword`, `SetSettings`, or
`GetValue` (an ungranted member on the granted interface, which is what proves
the rule discriminates on `send_member=`); it CANNOT receive
`SettingsChanged`, which carries the web admin password hash. A second
unprivileged uid can do none of it, which is what makes the grant
user-scoped rather than a reopening. Suite: 42/42.

*The username is substituted* — `mos-mqttd` does not exist on a build host, and
a rule naming an unresolvable user matches nothing and would pass a refusal
suite for the wrong reason. The copy under test substitutes one token, the
substitution is asserted to have changed exactly one line, and the shipped
file's own username is asserted separately. That the IMAGE creates the account
is `os/verify-image-v2.sh`'s half of the pair.

**Two defects the suite found while being written, both would have shipped.**
The first draft of `mos-mqttd.conf` contained `--` inside an XML comment.
dbus-daemon refuses to start when an included file is malformed, so that file
would have taken the system bus down on every boot — `mosd` unable to own its
name, `apid` unable to reach it. Caught because §6 stands up a real daemon
rather than reading the XML back. The second: the control uid was 65533, which
has no passwd entry, so dbus answered `REJECTED EXTERNAL` and the case
"failed to call GetItems" for a reason that was not the policy at all. The
connectivity check now classifies auth-refused, policy-refused and connected
as three distinct outcomes, so that confusion cannot recur silently.

**Eleven image assertions, each observed failing.** `check_mqttd` in
`os/verify-image-v2.sh`, written ABOVE the fixture boundary so
`os/ui-location-test.sh` can drive it: the three files present, the unit
enabled, a static identity, the grant naming the same user, that user present
in `/etc/passwd`, every `com.mos.mosd` grant naming a member, no dangerous
member granted, `ExecStart` parameterised, and the `EnvironmentFile` under a
path a `.mount` unit actually backs. Nine new cases in
`os/ui-location-test.sh` drive them — including *the bridge absent from the
image*, which is the state main was in, and *back to DynamicUser*, which is
the unit's own prior state.

**Rust.** Three tests in `mosd/mqttd/tests/protocol.rs`: the backoff schedule,
the first delay separately (a floor that drifted to zero passes every other
assertion), and the upstream premise — five refused reconnects through
rumqttc's own event loop must take under a second, so the day rumqttc grows a
backoff this fails and says the workaround can go. Mutation-checked: setting
the floor to zero turns both schedule tests red.

## What is NOT claimed

**The backoff's WIRING into the event loop is not covered by a test.** The
schedule is; that `runtime::run`'s spawned task actually calls it is not,
because reaching that loop needs a bus and a broker. This is the same gap
RFCT-091 recorded for `runtime::run` generally, unchanged and not widened.

**No on-device claim.** Nothing here says the bridge publishes to a real
broker on real hardware. The image asserts installation, identity, grant and
configurability; the live-bus suite asserts the policy; neither is a device.
The first flash is the acceptance.

**The uid 990 pin is asserted at build time only.** `os/rootfs/Dockerfile.v2`
refuses to build if 990 or the name is already taken in the base image, and
the verifier reports the uid it finds without asserting the number — the
property that matters is that the policy's name resolves to the account the
unit runs as, and both sides of that are checked.
