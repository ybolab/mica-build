# RFCT-224 Decide and settle container.enabled's bus writability, for the class and not one key

- **status**: completed
- **priority**: P2
- **owner**: bkd/2htxp512
- **createdAt**: 2026-08-28
- **plan**: PLAN-012 (D3 divergence, filed by PLAN-024 M2; routed to PLAN-025-class work)

PLAN-012 D3 states that the container switch is a writable bus item and an
MQTT-addressable path "for free". RFCT-221 measured the tree and found it is
not: `container` is absent from mosd's fixed writable-subtree list, so
`/container/enabled` projects read-only and is written only through the
daemon's settings method, which is the path apid uses.
`docs/design/containers.md` states the untrue version to integrators.

This is a decision before it is an edit, which is why PLAN-012's closeout
amendment files it instead of patching it in either direction by default.

## Scope when claimed

Choose one of two, and make the tree say only that:

- **Widen the writable subtrees** to include `container` — with the same care
  the list's own comment demands, since writing that key grants root-capable
  containers to anything that can reach the bus.
- **Correct the documents** — PLAN-012 D3 and `docs/design/containers.md` — to
  say the switch is written through the settings method only, and is not bus-
  writable or MQTT-addressable.

`mqtt` sits in exactly the same position. Whichever way this goes, state the
answer for the class of platform switches rather than for one key, so the next
switch does not re-open the question.

## Acceptance criteria

1. The design document and the daemon agree, proven by a test — not by
   inspection.
2. If the subtree is widened: the live-bus writability test lists
   `/container/enabled` among the writable paths, and the item round-trips.
3. If the document is corrected instead: its claim about bus and MQTT
   reachability matches what the daemon exposes, and a test pins the
   read-only projection.
4. The answer is written down for the class, `mqtt` named alongside
   `container`.

## Files it is expected to touch

`os/pkgs/mosd/mosd/src/tree.rs`, `os/pkgs/mosd/mosd/tests/tree.rs`,
`docs/design/containers.md`, `docs/design/bus.md` if it carries the same
claim. PLAN-012 needs no further edit: its Amendment 1 already records the
divergence and routes it here.

## Dependencies

- **blocked by**: (none — claimable any time)
- **blocks**: any integrator documentation that promises MQTT control of the
  container switch.

## Outcome — the documents were corrected; the subtree was NOT widened

Decided 2026-08-29. Option (b): `container` and `mqtt` stay out of
`WRITABLE_SUBTREES`, the documents were corrected to say so, and the read-only
projection is now pinned by a test.

### What decided it

The premise both options were weighed against turned out to be wrong, and
measuring it is what settled the choice. `WRITABLE_SUBTREES` is **not an access
boundary**. `SetSettings` writes any settings path without consulting it
(`os/pkgs/mosd/mosd/src/bus.rs`), so the framing "widening grants the switch to
anything that can reach the bus" describes what is ALREADY true, not what
widening would change.

What the list actually bounds is `SetValue`, and the bus policy is what makes
that exact rather than incidental: `com.mos.mosd` denies the default context
outright and grants blanket send to **root alone**
(`os/pkgs/mosd/dist/com.mos.mosd.conf`), while `mos-mqttd` — the one non-root
client — holds exactly three members, `GetItems`, `SetValue` and
`ItemsChanged`, and nothing whatever on `com.mos.mosd1`
(`os/pkgs/mosd/dist/mos-mqttd.conf`). So the writable list is the **remote**
write surface and only that.

That inverts the cost/benefit of widening. Adding `container` would grant the
key to remote broker clients and to **nobody else**, root having had it all
along through `SetSettings`. There is no local convenience to buy, only remote
reach to sell. And the brief's condition for widening — argue that the bus's
existing access boundary is sufficient — cannot be met, because the boundary
widening crosses is not the bus's but MQTT's, where `MqttAuthSettings::enabled`
defaults to **false**.

Two further measurements pointed the same way:

- `docs/design/bus.md` §10.1b already stated the correct answer — "`mqtt` is
  **not** in `WRITABLE_SUBTREES`, matching `container`" — and carries the
  `[implemented]` tag. `docs/design/containers.md` was the outlier, not bus.md.
  Widening would have meant reversing a shipped contract statement.
- The list's own comment claimed it was "exactly what a reconciler applies to
  the running system". That was false: there are seven reconcilers (hostname,
  network, wifi_ap, wifi_client, sshd, **mqtt**, **container**) and five
  entries. `git log -L 51,58:os/pkgs/mosd/mosd/src/tree.rs` shows the list was
  written once, in `c3e32ed`, and never revisited; `container` and `mqtt`
  entered the settings model later. The divergence was an omission that the
  comment then mis-described as a rule — which is why the comment was the first
  thing fixed.

### The rule, for the class

Stated once in `docs/design/bus.md` §11.6, in that section's
decision-plus-reason-plus-what-would-change-it shape, with **`mqtt` named
alongside `container`**:

> A platform switch is read-only on the item tree unless a remote broker client
> may flip it.

The test a switch must pass is explicitly **not** "does a reconciler own it" —
that reading would admit both keys — but "may a remote broker client flip
this". `container.enabled` grants root-capable containers; `mqtt` carries the
broker's own bind and auth policy, so a listed `mqtt` would let an
unauthenticated client widen the very listener carrying the request. Both fail.
The burden now sits on any future widening to argue that test, rather than on
an omission to justify itself.

### The enumeration, done rather than assumed

Every settings root checked against the list, not just the two handed over:

| Key | Bus-writable | Consistent with the rule |
|---|---|---|
| `hostname`, `network`, `wifi.client`, `wifi.ap` | yes | yes — device config, no capability grant |
| `access.ssh` | yes | see residue below |
| `schema_version` | no | yes — bookkeeping |
| `provisioning` | no | yes — bookkeeping |
| `access.webAdmin`, `access.device`, `access.apiTokens` | no | yes — credential metadata, and redacted (§8) |
| `access.console` | no | yes — no reconciler, no remote need |
| **`container`** | **no** | **yes — decided here** |
| **`mqtt`** | **no** | **yes — decided here** |

Exactly two keys diverged from what the comment claimed, and they are the two
this task names. Nothing else in the schema is in the same position.

### Residue

`access.ssh` is the one listed entry the rule strains against: it is remotely
writable today and it does grant a remote capability (sshd, `permitRootLogin`,
`listenAddresses`). It is left as it is — narrowing a shipped writable subtree
is a behaviour change well outside this task, and the bridge defaults to
`Mode::ReadOnly` (`os/pkgs/mosd/mqttd/src/config.rs`) so writes require an
explicit operator opt-in. Named here so the next reader does not mistake the
silence for agreement.

### Acceptance

1. Document and daemon agree, proven by a test — not inspection:
   `os/pkgs/mosd/mosd/tests/tree.rs::platform_switches_are_read_only_items_written_only_through_set_settings`
   over a private session bus.
2. Not applicable — the subtree was not widened.
3. The corrected claim matches what the daemon exposes, and the projection is
   pinned: both keys report `writable = false` in `GetItems`, `SetValue` on each
   answers `-2` and changes nothing, and `SetSettings` writes both and they
   round-trip still read-only. A later widening must delete an assertion.
4. The answer is written down for the class, `mqtt` named alongside `container`
   (`docs/design/bus.md` §11.6).

### What would change the answer

A write boundary on the item tree that is not the bridge's — per-client policy
on `SetValue`, or a bridge that may publish a subtree it may not write. The
per-method split is already sketched as a deferred extension point in
`os/pkgs/mosd/dist/com.mos.mosd.conf`. Until one exists, the answer holds.
