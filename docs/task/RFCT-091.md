# RFCT-091 PLAN-011 M3: mos-mqttd, the MQTT data-publishing bridge

- **status**: completed — `mos-mqttd` ships the mos-native grammar over the
  M1/M2 item tree; the protocol is a pure state machine tested against an
  in-memory transport double, and four limits are recorded rather than hidden
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-21 14:58
- **claimedAt**: 2026-08-21 14:58
- **completedAt**: 2026-08-21 21:23

PLAN-011 milestone M3, depends on M1+M2 (RFCT-089/090). Deliverable: the
`mos-mqttd` crate — topic grammar `N|R|W/<deviceId>/<class>/<instance>/<path>`
with `{"value": ...}` payloads, 60 s keepalive triggering a rate-limited
full republish, 3 s heartbeat, secret masking at publish, read-only vs full
mode. Protocol choice per the M1-recorded Sparkplug B evaluation. Verify:
protocol tests against a local broker (N/R/W, keepalive republish, masking,
read-only mode); workspace checks green.

## Outcome

M3 is complete. One commit carries it — `26d97cd` — merged onto the campaign
branch as `8bd5ce6`.

**The crate.** `mosd/mqttd` is a new workspace member (`mosd/Cargo.toml`)
producing the `mos-mqttd` binary, with `dist/mos-mqttd.service` beside it.
Eight modules: `bridge`, `config`, `item`, `payload`, `runtime`, `source`,
`topic`, `transport`. It is a **pure bus client** — `GetItems`,
`ItemsChanged`, `SetValue` and nothing else about mosd — which is the property
`docs/design/bus.md` §1 exists to give it, and the reason a PLAN-011 D5
extension service will need no bridge-side work when it arrives.

**The protocol is a pure state machine.** `bridge::Bridge` is the whole
protocol: events in, `Effects` out, and no clock, socket or bus handle
anywhere inside. Time arrives as an explicit monotonic `now`, which is what
makes the rate-limit and expiry tests *exact* rather than timing-dependent —
the protocol decisions are pure functions of state and `now`. Around it sit
two traits, `transport::Transport` (the broker) and `source::ItemSource` (the
bus), joined by `runtime::apply`, the one place an effect becomes I/O. The
bridge mirrors the tree itself — seeded by `GetItems`, maintained by
`ItemsChanged` — so a full republish is served from memory and a keepalive
storm cannot become a `GetItems` storm against mosd.

**What it speaks.** The grammar §10's OUTCOME chose and only that:
`N|R|W/<deviceId>/<class>/<instance>/<path>` with `{"value": ...}` payloads.
A keepalive always renews the 60 s window, but the full republish it asks for
coalesces behind a 5 s floor — at most one immediate plus one deferred — and
each republish is terminated by exactly one `full_publish_completed` carrying
the item count. The heartbeat is 3 s and carries the bridge's monotonic
uptime. QoS 0 throughout, deliberately: the protocol's recovery mechanism
**is** the keepalive-triggered full republish, so a delivery guarantee
underneath it would be paying twice for the same property. **Sparkplug B is
not implemented**, per §10's recorded outcome, and nothing in the crate was
generalised in anticipation of it.

**The alive gate is a publishing gate.** An `N`, an answer to an `R`, the
heartbeat, a republish and a vanished device's clears are all silent outside
the window; a `W` is not, because it is control rather than publication and a
broker entitled to write is entitled to write whether or not anyone is
listening. A vanished device publishes a **zero-length retained** payload per
known topic — deleting the retained message — which is deliberately a
different thing from `{"value": null}`, the payload that means *item present,
currently invalid*. Clears owed while the bridge is silent survive until it is
alive again.

**Masking, and what it is for.** `payload` mirrors `tree::redact` exactly —
`password_hash`, `passwordHash`, `psk`, `hash` at any depth including inside
arrays — and a secret-*named* path publishes as `{"value": null}`. Recorded as
defence in depth, not the primary control: §8 redacts structurally at the
source, so the bridge should never see a secret and this mask should find
nothing to do.

**No result codes cross the bridge.** The grammar has no acknowledgement topic
and none was invented. A successful settings write is observed as the `N` its
`ItemsChanged` produces and a successful action as the forced re-zero of §7,
so a refusal is precisely the absence of that. The one distinction a remote
client genuinely needs — a write that did not persist is safe to retry, a
dispatched action is not (§1.1's `-4`/`-5`) — **is** drawn, but from the
**path** rather than from the code number (`source::retry_note`), so it stays
correct whatever the negative vocabulary settles on later.

**Dependency.** `rumqttc 0.25` with `default-features = false` — TCP only, no
TLS, so `rustls` stays unused — verified at add time as the latest stable and
pure Rust: no C/C++ sources and no `build.rs` anywhere in what it pulls in.
`futures-util` likewise with default features off.

**The recorded test decision: an in-memory transport double, not a broker in
CI.** The protocol tests drive the **production** path — the real `Bridge`,
the real payload encoder and masker, the real `runtime::apply` — against an
in-memory `transport::Transport` implementation. The seam sits deliberately
*below* everything this crate owns: topic grammar, payload shape, masking,
alive gating, rate limiting and mode enforcement are all above it and all
covered. The rationale is the one this repository keeps arriving at: standing
up a broker in CI would test rumqttc's TCP client, which upstream already
tests, at the price of a test that **skips** — and so reports green while
asserting nothing — on every machine without a broker. None of the seven tests
can skip. The decision is recorded in the crate docs and in `transport.rs`.
What the double does not cover is the rumqttc/zbus wiring in `runtime::run`,
which is kept correspondingly thin for exactly that reason.

**Evidence the tests mean something.** Six mutation checks were run against
the suite and every one was caught. The same discipline found two **real**
defects the passing suite had hidden: a test helper taking a reentrant lock,
so every failure **deadlocked** instead of failing — it would have hung CI on
the first genuine regression rather than reporting it — and
`on_device_vanished` dropping the device id, leaving the bridge unable to
parse even a keepalive addressed to itself and stranding owed clears forever.
Both are fixed and covered.

**Contract markers.** In `docs/design/bus.md`, `[proposed]` → `[implemented]`
on §10.1 only, each statement naming its path into `mosd/mqttd/src/`: the
topic grammar (`topic.rs`), the payload shape and the zero-length-versus-null
distinction (`payload.rs`), liveness with its 60 s window, 5 s republish floor,
3 s heartbeat and QoS 0 (`bridge.rs`, `config.rs`), the publishing-only nature
of the alive gate (`bridge.rs`), the two modes (`config.rs`), and the absence
of an acknowledgement topic (`source.rs`). §10 as a whole stays what it is — an
evaluation and decision record — and §0's marker exemption now says so
precisely: §10.1 outgrew it because the grammar it describes is code. §8's
statement that the bridge's publish-side masking is defence in depth was
already `[implemented]`; it gained the path now that the code exists. §5, §6
and D5's registry stay `[proposed]`: they need services that do not exist yet.
§1.1's result-code table and §11's known limits are earlier subtasks' and are
cited, not touched.

**Four limits, recorded rather than omitted.**

1. **`os/` image wiring is deferred to a follow-up.** Only the unit file
   ships. It is `DynamicUser=yes` with an empty `CapabilityBoundingSet` — the
   bridge owns no state, writes no files and needs no capability — and the
   image task should confirm that shape against how mos actually installs
   units.
2. **`runtime::run` is not covered by the double** and deserves an on-device
   smoke test against a real broker when the image wiring lands. It is thin
   by design, but thin is not tested.
3. **Multi-service support is not implemented.** The bridge publishes for
   `com.mos.mosd` only; `config::SERVICE` is the single point of change, and
   PLAN-011 D5's registry is what turns it into a set. `/DeviceInstance`
   defaults to `0` because `docs/design/bus.md` §6 is still `[proposed]` and
   mosd publishes no such item.
4. **TLS to the broker is not implemented.** `rumqttc` is built TCP-only,
   deliberately, and adding TLS is a dependency decision to make when a
   deployment needs it rather than a feature to carry untested.

**Verification.** `make docs-verify` green (306/306) at this close-out. The
code gate is the implementing subtask's and is theirs to claim:
`bash mosd/hack/check.sh` reported **ALL CHECKS PASSED, 431/431, 0 skipped**
on the campaign branch, with all seven `mosd/mqttd/tests/protocol.rs` protocol
tests executing — the verbs, the rate-limited keepalive republish, masking,
read-only refusal, the silence of a refused write, a vanished device's
retained clears, and clears owed while silent being paid at the next
keepalive. This docs-only close-out ran `make docs-verify` and claims nothing
beyond it.
