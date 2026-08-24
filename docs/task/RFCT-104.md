# RFCT-104 A master switch for MQTT, and a broker for the bridge that has only ever retried

- **status**: implementation complete — mosd workspace 578/578 with `hack/check.sh` ALL CHECKS PASSED (fmt, clippy `-D warnings`, nextest, doctests, cargo-deny), `os/ui-location-test.sh` 64/64 cases, `os/health/test.sh` 62/62, `docs-verify` 348/348; **no assembled image was built or booted in this campaign**, so the broker has never been started on a real system and the reconciler has never driven real systemd
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-24 08:04
- **claimedAt**: 2026-08-24 08:04

RFCT-097 wired `mos-mqttd` into the image, enabled unconditionally, with
`localhost:1883` as the address it falls back to when nothing has configured it.
Nothing in the image listens there. The bridge therefore does exactly what it was
built to do — back off, retry, and write one `tracing::warn!` every 30 seconds
into a journal on the STATE partition — against a broker that does not exist.
**No shipped device has ever had a broker, so the bridge has never once
connected. It has only ever retried.**

Two things were wrong and only one of them is the noise. There was no way to turn
MQTT off, and there was nothing for it to talk to. This task adds both: a
`mqtt.enabled` master switch, and `mos-mqtt-broker` in the image behind it.

## The switch is a master switch, and that is the whole of its job

`mqtt.enabled` (bool, default false) decides whether the broker and the bridge
run at all. False means neither: no `mos-mqtt-broker.service`, no
`mos-mqttd.service`. It validates nothing and it depends on nothing below it.

**`mqtt.listen` and `mqtt.auth` are a separate configuration, deliberately not
coupled to it.** No code may refuse to start on any listen/auth combination.
Conflating the two was proposed once and rejected, and the reasoning is worth
keeping because the shape recurs: an operator who widened the bind made a
decision, and a daemon that answers a decision by quietly not starting is a
daemon whose reason for being down cannot be read anywhere.

A broker bound off-host with authentication disabled gets a **WARN** and a notice
on the pane. It does not get a gate. Where that rule lives:

- `MqttSettings`'s doc comment (`mosd/mosd-settings/src/model.rs`) states it as
  the type's contract.
- `MqttReconciler::apply` (`mosd/mosd/src/reconciler/mqtt.rs`) states it at the
  one place a gate would be written, and names the second-order form of the same
  mistake: returning `Err` over `listen` would fail the reconcile of the whole
  `mqtt` subtree, `mqtt.enabled` included, and so would make the master switch
  depend on `listen` being valid — the rejected coupling wearing a different hat.
  This is deliberately a different rule from `SshdReconciler`, which *does* reject
  an unparseable `ListenAddress`: sshd has one key and no separate switch to
  protect.
- `MQTT_SEPARATE_CONFIG_NOTICE` (`mosd/apid/src/routes.rs`) states it to the
  operator on the page where they would otherwise expect the refusal.

### Three cases, not a predicate

`classify_listen_address` returns `Loopback | OffHost | Unparseable` rather than
answering "is this loopback". The two things worth warning about are different
things and their messages contradict each other: an address that does not parse
is not a wide bind, it is not a bind at all, and

> Emitting a true warning and a false warning about one value is worse than
> emitting neither, because it teaches an operator to distrust both.

Matching on a three-case enum makes the two warnings mutually exclusive by
construction rather than by the order two `if`s happen to be written in.

## rumqttd, not mosquitto

Debian's `mosquitto` measures at a **1.7 MB** installed increment, which is not
the reason to decline it. The reason is what those bytes are: four C shared
libraries — `libcjson1`, `libmosquitto1`, `libdlt2`, `libwebsockets19t64` — into
a root with **no package manager** (RFCT-099), two of which a local broker never
uses. `rumqttd` is the same project family as the `rumqttc 0.25` the bridge
already depends on, is pure Rust, and adds no shared object at all.

It is used as a **library** with `default-features = false`
(`mosd/Cargo.toml`), pinned at `0.20` and resolving to 0.20.0 in `Cargo.lock`.
`use-rustls` stays **off**, and that is a hard constraint rather than a
preference: it pulls `rustls 0.22`, which the workspace's advisories check
rejects.

### The measured cost

Cross-built on rustc 1.96.0 with `--no-default-features`:

| | unstripped | stripped |
|---|---|---|
| `mos-mqtt-broker` aarch64 | 7,128,720 B (6.80 MiB) | 5,070,056 B (4.84 MiB) |
| `mos-mqtt-broker` x86_64 | 7,361,560 B (7.02 MiB) | 5,650,552 B (5.39 MiB) |

For scale, on the same toolchain: `mos-mqttd` is 6,200,256 B unstripped and
`mosd` is 8,068,048 B. **The repository does not strip**, so the rootfs increment
is the unstripped number — about 7 MB, in the same class as the two Rust binaries
the image already carries and not a new one.

Against the budgets: `os/layout/cx3576-v2.env` sets `BOARD_SIZE_BUDGET_MB=400`
with the root near it, and `os/layout/x64-v2.env` sets 520 with the root at
424 MB. Neither is comfortable and neither is breached; cx3576 is the one to
watch, and it is the reason the mosquitto increment was measured rather than
assumed.

`mosd/hack/build-target.sh` builds `-p mos-mqtt-broker` alongside the other three
and checks its ELF architecture the same way, so a broker that is not a target
binary fails the cross-build rather than the image.

## The supply chain: CC0-1.0, and the consideration that actually applies

`cargo deny check licenses` fails on **`tiny-keccak 2.0.2`**, licensed `CC0-1.0`,
reached through:

```
rumqttd -> config -> rust-ini -> ordered-multimap -> dlv-list
        -> const-random -> const-random-macro -> tiny-keccak
```

`config` is a **mandatory** (non-optional) dependency of rumqttd, so no feature
flag removes the chain. `"CC0-1.0"` was added to `mosd/deny.toml`'s allow list,
which before this campaign was exactly `Apache-2.0, MIT, BSD-2-Clause,
BSD-3-Clause, ISC, Unicode-3.0, Zlib`.

**The consideration is not that CC0-1.0 is permissive.** That is the flattering
framing and it omits the only part that matters here: **CC0-1.0 is a
public-domain dedication that explicitly does not grant patent rights.** For a
device shipped to customers, that carve-out is the whole question — it is what
distinguishes CC0 from the Apache-2.0 grant sitting above it in the same list.

What makes it acceptable *in this instance*: the crate is `tiny-keccak`, and it is
reached only through a **proc macro's build-time dependency**, not through
anything linked into a shipped binary. That is a statement about this chain, and
it is why the allowance is written as one crate and not one licence.

"CC0 is permissive" is the sentence that would let the next person skip the
question entirely, which is precisely how an eighth entry becomes a ninth.

### Status: in the tree, without a decision

Two facts, and only one of them is a decision. They are kept apart deliberately,
because collapsing them is how a record ends up reading as approval.

**Fact 1: the allowance is in the allow list and no decision has been made about
it.** Not approved. Not accepted. The question is open.

L1 put it to the user **four times** across the campaign, and the user has never
answered it. They **answered every other question in the same messages** — so
this is silence on one item, not an unread thread, and that distinction is the
whole reason it is recorded as a fact rather than as a shrug. On the fourth ask
L1 said plainly that T2 was landing the line and that not answering would let it
ship, explicitly because L1 **did not want it to pass by silence**. It takes the
allow list from seven entries to eight, and that is policy, not a build fix.

**Fact 2: it shipped on L1's call.** That is a real decision and belongs here as
one, distinct from the approval that was never given. The reasoning: blocking the
DAG on it would have cost more than the line is worth, and it is one revertible
line.

**The fallback is planned, so reversing this is a task and not a
re-investigation.** Attack the chain — `config -> rust-ini -> ordered-multimap ->
dlv-list -> const-random -> const-random-macro -> tiny-keccak` — most likely by
asking whether rumqttd can be driven without its `config`-based loader. `config`
is a mandatory (non-optional) dependency of rumqttd, so no feature flag drops it,
**which is why the alternative is upstream work rather than a manifest edit**.
That is the shape of the work if the answer, when it comes, is no.

The `deny.toml` comment carries all three — the chain, the patent carve-out, and
the upstream-first fallback — because `deny.toml` is where the next engineer
actually lands when they hit the allow list, and a reader stops at the first
place that answers their question. A comment reading "public-domain, no
obligations" without the carve-out invites the next person to wave through a
second CC0 crate on a worse chain. A comment whose only stated alternative was
"give up the broker" did something quieter and just as bad: nothing in it was
false, but someone judging that price too high would never have learned there is
a cheaper question to ask first. **A record that is merely coarser than the truth
still misleads.**

## No credential in the settings tree, and the rule behind it

`MqttAuthSettings` carries `enabled: bool` and nothing else. There is no username
and no password anywhere under `mqtt`.

**The rule, for the next person adding a settings key:** mosd publishes the
settings tree over `com.mos.Item1`, so anything placed in it is published to every
client that can call `GetItems`. A password under `mqtt.auth` would be a published
password. Carrying it safely would require new redaction in
`mosd/mosd/src/tree.rs` — and that is the **bus contract**, which this campaign
treats as an escalation trigger rather than something to amend in passing.

The conclusion reached instead was to keep credentials out of the settings tree
entirely: the broker reads its accounts from
`/var/lib/mos/mqtt-broker-users.toml` on STATE, which is how the device password
is already handled. **The tree carries the policy; the STATE file carries the
secret.** A settings key is a published key until `tree.rs` says otherwise; if a
new one holds a secret, the choice is to redact it in the bus contract or to keep
it out, and the second is much cheaper.

Two supporting facts, both asserted rather than assumed: `mqtt` is deliberately
absent from `WRITABLE_SUBTREES` in `mosd/mosd/src/tree.rs` (which holds exactly
`hostname`, `network`, `wifi.client`, `wifi.ap`, `access.ssh`), matching
`container`, which is also absent — so the switch is reachable from apid's pane
and not over the item tree, and bus writability is unchanged by this work. And
`mosd/mosd-settings/src/model.rs`'s own test serialises `MqttSettings` and asserts
the text contains neither `"password"` nor `"username"`.

## Default false, and the behaviour change that is

The default is `false` and the v5 → v6 migration seeds `false`
(`mosd/mosd-settings/src/migration.rs`). Fielded cx3576 devices stop running the
bridge until the switch is turned on. **The user accepted this explicitly as a
behaviour change.**

It is acceptable for one reason, and the reason is the same fact the whole task
starts from: no shipped device has a broker, so nothing that worked has stopped
working. Defaulting to true would ship the existing retry loop under a new name.
The pane says this to the operator in those terms rather than as a generic
release note — `MQTT_UPDATE_NOTICE` in `mosd/apid/src/routes.rs` names
`mos-mqttd`, says it ran on every earlier image and does not run here while MQTT
is off, and then says why that costs them nothing.

`down` (v6 → v5) discards the whole `mqtt` subtree, `enabled = true` included: v5
has no `MqttReconciler` to honour it, and v5's `deny_unknown_fields` would refuse
the document outright over a leftover table.

## Inventory

**Settings (T1)**
- `mosd/mosd-settings/src/model.rs` — `MqttSettings`, `MqttListenSettings`,
  `MqttAuthSettings`; `SCHEMA_VERSION` 5 → 6; `Settings::mqtt`. Defaults:
  `enabled = false`, `127.0.0.1`, `1883`, `auth.enabled = false`.
- `mosd/mosd-settings/src/migration.rs` — `MigrateV5ToV6`. `up` seeds
  `mqtt.enabled = false` and **nothing else** (a test asserts `mqtt.len() == 1`,
  so no dead `listen`/`auth` tables are written); a non-boolean `mqtt.enabled`
  is an error naming the key; `down` removes the subtree.
- `mosd/mosd-settings/src/lib.rs` — re-exports.
- `mosd/mosd-settings/tests/settings.rs` — and the stale-fixture fix below.

**Broker (T2, T7)**
- `mosd/broker/Cargo.toml`, `mosd/broker/src/main.rs`,
  `mosd/broker/src/config.rs` — new crate `mos-mqtt-broker`.
- `mosd/broker/dist/mos-mqtt-broker.service` — the unit.
- `mosd/Cargo.toml`, `mosd/Cargo.lock` — `rumqttd 0.20` with default features
  off; workspace member.
- `mosd/deny.toml` — the `CC0-1.0` allowance and its comment.
- `mosd/hack/build-target.sh` — cross-build and ELF check for the fourth binary.

**Reconciler (T3, T9)**
- `mosd/mosd/src/reconciler/mqtt.rs` — `MqttReconciler`; `name()`/`subtree()`
  both `"mqtt"`; `render_config`; `classify_listen_address`; `turn_broker_on`,
  `turn_bridge_on`, `turn_unit_off`; the published live state.
- `mosd/mosd/src/reconciler/mod.rs` — `mod mqtt;` and the entry in `all()`.
- `mosd/mosd/src/reconciler/systemd.rs` — `reset_failed` on `UnitControl` and on
  `MockUnitControl`, plus the mock's `refuse_start`.

**apid (T4, T8)**
- `mosd/apid/src/routes.rs` — `GET /mqtt`, `POST /mqtt/enable`, the nav entry,
  `MqttView` and the five notice constants.
- `mosd/apid/src/tests.rs` — the pane's tests and the golden published-state
  fixture.

**Image (T5)**
- `os/rootfs/build-v2.sh` — stages the binary and the unit.
- `os/rootfs/Dockerfile.v2` — installs both, creates uid/gid 969, and removes
  and then asserts the absence of the `multi-user.target.wants` symlink.
- `os/verify-image-v2.sh` — `check_mqtt_broker`, above the fixture boundary.
- `os/ui-location-test.sh` — fixture cases 5j–5m and the `BROKER_*` paths.

**Docs (T6)**
- `docs/design/bus.md` — §10.1a's broker-address bullet corrected, §10.1b added.
- `docs/task/RFCT-104.md`, `docs/task/index.md`, `docs/plan/PLAN-011.md`.

## How the defects were found

This campaign produced findings more reusable than the feature. They are recorded
here because the next campaign should copy them; the headline is still the switch
and the broker.

### Three ways to tell a real green from a decorative one

**(a) Two subtasks, the same out-of-scope files.** Two L3 subtasks, dispatched
independently with disjoint file scopes — `mosd/mosd-settings/**` and
`mosd/broker/**` — both showed the *same three* files modified outside their
scope: `mosd/mosd/src/fswrite.rs`, `mosd/mosd/src/main.rs`,
`mosd/mosd/src/reconciler/mod.rs`.

Two agents working on unrelated tasks do not independently choose the same three
unrelated files. Coincidence does not produce that. So the cause was not two
subtasks misbehaving; it was something in the shared baseline both were reacting
to — and it was. `mosd/hack/check.sh` opens with `cargo fmt --all --check`, and
that was failing on `main`: `write_in_place`'s signature in `fswrite.rs`, and
`mod fswrite;` sorted after `mod rauc;` in `main.rs`, both left by `8acea70`.
Each agent had run `cargo fmt` to get past the mandated gate, and rustfmt is
deterministic, so both produced byte-identical changes. That byte-identity was
confirmed by diffing the two working trees against the fix before deciding not to
interrupt either agent. Fixed on `main` as `699a704`.

> Out-of-scope files in **one** subtask's diff is a subtask problem. The **same**
> out-of-scope files in **two** independent subtasks' diffs is a baseline problem.

The second reading is cheap to test and points at the shared thing — the base
commit, the gate, the toolchain — rather than at the agents.

**(b) Repeat a nondeterministic check until it disagrees with itself.** The
broker's `AddrInUse` defect was run **five times on five unused ports**, not once.
rumqttd's `v4` and `v5` maps are two independent servers that each call `bind()`;
given the same address and port one loses with `EADDRINUSE`, rumqttd swallows that
into an `error!` and keeps running, and *which* one loses is a thread race that
differs from boot to boot. A single run shows "v5 won" or "v4 won" and reads as a
fact. Five runs showed a race — **and the race was the defect.**

Why the distinction matters to a fielded device: "MQTT is broken" is far better to
ship than "MQTT works sometimes", because the second cannot be reproduced by the
person reporting it. v4 is the half that has to survive, since the only client in
the image is `mos-mqttd` through rumqttc's top-level `AsyncClient`; on a boot
where v5 won, the bridge could not reach the broker at all.

**(c) Mutation-testing your own tests — T3's, unasked.** The `MqttReconciler`
task did this twice without being asked, including on an amendment: it forced the
`is_active` guard false, reversed the start/stop ordering, made the `Unparseable`
arm return `Err`, and folded `Err(_)` back into `OffHost`, confirming in each case
that the relevant test **failed**, then reverted and diff-confirmed the committed
file. A test that has never been seen to fail is indistinguishable from one that
cannot. This is the behaviour the next campaign's subtasks should copy.

### A fixture is only evidence if something ties it to the thing it claims to represent

Two instances, and the distinction between them is the interesting part.

**The settings fixture** (`mosd/mosd-settings/tests/settings.rs`,
`newer_additive_document`) carried a literal `schema_version = 6` whose *purpose*
was to be `SCHEMA_VERSION + 1` — the A/B rollback path, a document from a build
one schema ahead. It **started true** and went stale the moment `SCHEMA_VERSION`
reached 6: at that point it stopped being "newer", the tolerant-load strip path
silently stopped being exercised, and the test went on passing while asserting
nothing about rollback. T1 caught it and tied it back with
`assert_eq!(SCHEMA_VERSION + 1, 7, "the fixture stamp must stay ahead")`, so the
next bump fails loudly instead of quietly retiring the path.

**The apid live-state fixture** (`mosd/apid/src/tests.rs`) was **never true**. T4
was not told what shape `MqttReconciler` publishes, chose one, and wrote a fixture
matching its own choice — which is a test of the pane against itself. A
hand-written fixture cannot detect that it disagrees with the producer, so both
crates stayed green while the pane read four keys that were never emitted, and the
off-host-without-auth warning — the UI surface for the design constraint the user
singled out — could never fire at all. **A pane that renders "unknown" and stays
quiet is the worst possible failure for a warning: it is indistinguishable from
"nothing to warn about".**

The cause, recorded honestly: L2's T3 spec pinned the published shape and L2's T4
spec never named one. **This was a specification gap, not a subtask error**, and
T4 flagged the risk in its own report before anyone asked.

The fix is about the rule and not about four accessors. A published-key-set test
in `mosd/mosd/src/reconciler/mqtt.rs` —
`the_published_shape_is_the_contract_with_the_apid_pane` — asserts the exact
top-level key set and names `mosd/apid/src/routes.rs` as its consumer, so drift is
loud from the **producing** side. The apid fixture is now
`MQTT_PUBLISHED_STATE`, a golden JSON copied verbatim with its source file and
test named in the comment above it. Plainly: this is still two copies in two
crates talking over a bus with no shared type. The point is that **a named source
is auditable and an invented one is not**.

### A test that omits the operation it names

A different rule, and three instances.

- **This campaign.** Every broker unit test passed while the feature could not
  work, because every test avoided binding a socket — **on L2's explicit
  instruction**. The one operation that would have exposed the `AddrInUse` race
  was the one the spec forbade. The crate now carries a connect test that starts
  the broker on a real ephemeral port and speaks MQTT to it with the same rumqttc
  the bridge uses, so it fails for exactly the reason the bridge would have failed.
- **`os/health/test.sh`** stubbed `is-system-running` to `running`, so the health
  gate's real state was never tested.
- **T5's verifier assertion** used `test ! -e` on a wants-symlink. In an unpacked
  root a symlink whose absolute target does not resolve reads as *absent* under
  `-e`, so the assertion **passed on exactly the image that should have failed
  it**. This one is the counter-example that shows the discipline works: **the
  negative fixture case caught it, not inspection** — `os/ui-location-test.sh`
  case 5k creates the symlink and requires `broker-not-enabled=FAIL`. The fix is
  `[ ! -e ] && [ ! -L ]`, which is the idiom `check_dev_keyring` already used in
  the same file.

### The best test in this campaign

`a_failed_broker_is_named_on_the_pane_with_somewhere_to_look`
(`mosd/apid/src/tests.rs`). It asserts what the page must **not** say.

Alongside the positive assertions — the unit state renders as
`Broker unit: <b>failed</b>`, there is a plain statement that the broker is not
running, and the page points at `journalctl -u mos-mqtt-broker` — it asserts the
body does **not** contain a guessed cause (`"is not an IP address"`). The pane has
a unit state and not the journal. Naming the listen address as the reason would be
a diagnosis it has not made, and would be wrong for every other way a broker
fails: a port already in use, an unreadable credentials file, and so on.

The value is in the *direction* of the assertion. A future edit that "helpfully"
hardcodes the commonest cause makes the page more confident and less correct, and
that edit now fails the suite instead of passing review. Most tests defend a
behaviour; this one defends a silence.

### A shape that makes a question unnecessary beats a shape that answers it

T4 raised a real question and asked that it not be closed without confirmation: is
the published `activeState` the broker's or the bridge's, and does reporting both
need two keys?

Under a flat shape that question can only be settled by convention — someone
decides, and everyone downstream has to know what was decided. Under the nested
`units` array **the question stops existing**: every entry carries its own `unit`,
`activeState` and `unitFileState`, so the broker is found by
`unit == "mos-mqtt-broker.service"` and the bridge by its own name. It becomes a
lookup rather than a convention, and a lookup cannot be misremembered.

That is a better argument for the nested live state than any of the three reasons
originally given for it — and it was found by a subtask asking a question rather
than guessing.

### The StartLimit chain: correct at one layer, wrong at the seam below it

> A record that says "L2 added StartLimit and it had a bug" teaches less than one
> that says **an architectural argument can be correct at one layer and wrong at
> the seam below it.**

In order:

1. The broker's unit shipped `Restart=on-failure` / `RestartSec=5` with no
   `StartLimit*`. systemd's defaults are `DefaultStartLimitIntervalSec=10s` and
   `DefaultStartLimitBurst=5`, and at a 5-second interval only about two starts
   ever land inside a 10-second window — so the limiter is **unreachable** and a
   persistently failing broker restarts every five seconds forever, writing to a
   journal on STATE. Shipping a five-second loop as the fix for a thirty-second
   warning would have been worse than the defect. **L2 found this by measuring the
   restart policy after T3's unparseable-address work; it was not in the campaign
   brief**, and it is separable from the rest of this task.
2. L2 asked for the bound. **L1 endorsed it in writing**, including the argument
   that made it look settled: *"the unit's job is to stop hammering; the
   reconciler's job is to try again when something has actually changed."* That
   argument is why `failed` being distinct from `active` matters —
   `MqttReconciler` re-arms the broker at boot and on any settings write, which is
   what makes giving up locally safe **here** and would not make it safe in a unit
   with nothing above it.
3. **That argument was right about the unit and wrong about the seam.** When a
   unit hits its start limit systemd refuses further start jobs, and
   `MqttReconciler::turn_broker_on` ended with
   `self.control.start(BROKER_UNIT).await?`. The `?` propagates, `apply` returns
   `Err`, and the reconcile of the whole `mqtt` subtree — `mqtt.enabled` included
   — fails **because of a listener address**. That is the coupling design
   constraint 2 rejected, reintroduced one layer down by the fix for a different
   problem. Reconcilers run together, so an unrelated hostname or WiFi edit could
   fail for the same reason.
4. **T7 found it by reading the code**, flagged it, and correctly declined to fix
   it as outside its scope. Neither L1 nor L2 saw it.
5. The fix (T9) needs **two** halves, and the easy one to omit is the first.
   `reset_failed` before starting a `failed` unit: without it the operator's
   correction does not take effect until the start-limit window expires *and*
   something else triggers an apply — they save, nothing happens, and nothing
   tells them they have to save twice and wait. And a refused `start` must **warn**
   rather than fail `apply` (`start_or_warn`), while **stop and disable keep
   propagating their errors** (`turn_unit_off`). That asymmetry has a reason: a
   start can be refused for a transient reason the reconciler will retry past, but
   a failed stop means the thing is still running when the switch says it should
   not be.

`reset_failed` is guarded on the state rather than issued unconditionally. It
would be harmless either way — `reset-failed` on a healthy unit does nothing — but
a call log that shows it on every apply stops distinguishing the broker that
needed rescuing from the one that did not.

### Two serious defects lived only at seams

Both of this campaign's most serious defects existed **only at seams between
subtasks**, invisible from inside either one:

- the `AddrInUse` race lived between T2's broker and T3's renderer;
- the restart loop lived between T3's failure mode and T2's unit file.

A DAG that dispatches correctly still hides its seams, and someone has to go and
test them on purpose.

### `origin/main`: a silent no-op that happened to be harmless

Every L3 spec in this campaign said `git merge origin/main`. `origin/main` is ten
commits behind local `main` — nothing has been pushed since `8acea70`, including
this campaign's own baseline — so that line reported "Already up to date" and
brought nothing, every time.

**No wrong outcome resulted.** BKD cuts L3 worktrees from local `main` and L2's
merges used local `main`, so every branch had the right code. It is recorded
anyway:

> A silent no-op that happens to be harmless is the kind of thing that is harmful
> the next time.

The correction is to use local `main` for every worktree and every merge. Pushing
is a separate unresolved question, escalated to the user: nothing in this
campaign, or in the concurrent x64/QEMU line, exists on `origin`.

### Run the repository's gate, not a subset of it

`8acea70` was verified with `cargo test --workspace` and called green.
`mosd/hack/check.sh` runs five things: `cargo fmt --all --check`, clippy with
`-D warnings`, nextest, doctests and cargo-deny. `cargo test` is one of the five.
Verifying with less than the project's own gate and reporting it as the project's
standard is what let the defect land, and what two subtasks then spent effort
reacting to. This is a process finding, not a blame note; the useful content is
**run the repository's gate, not a subset of it**.

### The coordinator's verification is not exempt from the rule it is enforcing

This one is **L2's**, this campaign's dispatch issue, and it closes the section
rather than sitting in the middle of it — because it was found by the tier
enforcing the rule, in its own tooling, while enforcing it.

While auditing subtasks all afternoon for tests that pass without asserting
anything, L2 shipped one. Returning T7 for the missing `StartLimit`, it reported
having *"diffed T7's branch against my pre-merge state"*. The command it ran was
`git diff <pre-merge>..HEAD` **on its own branch**, which measures *what the merge
brought*, not *what the subtask's branch contains*. The two agreed by timing, not
by construction. Had T7 committed in the gap, L2 would have returned a task for
work already done, with complete confidence.

That makes **five** instances of the same family in one afternoon: the invented
live-state fixture, the stubbed `is-system-running`, the stale
`schema_version = 6` literal, `test ! -e` on a dangling symlink, and the
coordinator's own diff. All five are **a check that does not measure what it
claims to measure.**

For accuracy: the finding itself was correct. Authoring timestamps put the
unit-file commit `0ef7a1b` at 12:18:32, six minutes after the merge at 12:12:43
that measured its absence. What is recorded here is a **method** defect, not a
retracted finding.

The corrected command is `git diff <coordinator-tip>..<subtask-tip>`, against the
subtask's tip fetched at the moment of checking. But the half that actually
prevents recurrence is a reporting rule:

> State in the report **which** refs you diffed and **when**, not just the
> conclusion. A diff is only auditable if the refs are in the record.

The failure was not only the wrong command; it was that the report described *the
check L2 meant to run* rather than the one it ran, and **no reader could have
caught the difference**, because no refs were quoted. The rule: a verification
claim names its inputs — the two SHAs and the timestamp — or it is not a
verification claim, it is an assertion. L2 adopted this mid-campaign; the T9 merge
was reported as
`68a6e250… (bkd/uph7rqhm tip) .. a7d4c088… (bkd/jcpfyf7m tip) at 2026-08-24T12:32:01Z`,
and that is the form.

And the half that is easiest to skip, aimed at exactly the claim that started the
T7 exchange:

> **State the refs even when the answer is "no delta". A verified absence is a
> claim too.**

What caused the dispute was an *unverified absence* — "it never touched the unit
file". A claim that something is **not** present needs its inputs named just as
much as a claim that something is, and it is the harder case to remember, because
an empty diff feels like it has nothing to cite. It has two refs and a time, same
as any other. **An absence reported without refs is the easiest kind of false
confidence to publish**: there is no output for a reader to check, so the claim
rests entirely on a command nobody can see.

## Known limitation: MQTT 5.0

Nothing in the image speaks MQTT 5.0, and that is a deferral with a route out
rather than an open question.

`mos-mqttd` uses rumqttc's top-level v4 surface, so 3.1.1 is what the only client
in the image speaks. The broker serves exactly one listener and it is the v4 one
(`mosd/broker/src/main.rs`), for the `AddrInUse` reason above. There is also
nowhere to put a second listener: `mqtt.listen` carries one address and one port
**by design**, so serving 5.0 as well means a settings-schema change, which was
out of this campaign's scope.

If a client ever needs 5.0, it wants either a second port or a `protocol` key
under `mqtt.listen`. That is the shape of the change, and it is a settings-schema
decision — not something to reach by handing rumqttd a `v5` map it will race
against itself.

## Outcome

**Verified.**

- `mosd/hack/check.sh` green: fmt, clippy `-D warnings`, nextest, doctests,
  cargo-deny.
- `MqttReconciler` unit tests against the existing `MockUnitControl`, covering
  both transitions and their orderings, the config-changed restart, the
  off-host-without-auth path *starting anyway*, the failed-broker reset, the
  refused start on both units, that turning the switch **off** still propagates a
  failure, and the published key set.
- apid route tests for the `/mqtt` pane, the `POST /mqtt/enable` write, and
  authentication.
- The v5 → v6 migration in both directions, including a non-boolean switch and an
  existing `enabled = true` surviving `up`.
- `os/ui-location-test.sh` drives `check_mqtt_broker` offline against fixtures,
  each of the five assertions observed failing on a fixture built to break it.
- `docs/verify-index.sh` (`make docs-verify`).

**About apid, precisely.** The verified statement is that **every existing
route's semantics, status codes, headers and redirects are unchanged**. An
earlier acceptance criterion said "byte-for-byte unchanged", which cannot hold
alongside "add MQTT to the nav list" — `shell()` emits the nav bar into every
authenticated pane. T4 flagged the contradiction rather than silently picking one.
The byte-for-byte claim was never achievable and is not made.

**Not verified, and this is the boundary.** **No assembled image was built or
booted in this campaign.** Therefore:

- `mos-mqtt-broker` has **never been started on a real system**. The connect test
  runs it on the build host; a device is a different thing.
- `MqttReconciler` has **never driven real systemd**. Every unit-control assertion
  is against `MockUnitControl`. `reset_failed`, the start-limit interaction and
  the `enabled-runtime` unit-file state are all mock-side claims.
- The image assertions are fixture-driven. `os/ui-location-test.sh` proves
  `check_mqtt_broker` can fail and on what; it does not prove the Dockerfile
  produces a root that passes it.

That is the outstanding verification, and it is the first flash's job — as it was
for RFCT-097, unchanged and not widened.

**Also outstanding.** The `CC0-1.0` allowance is **in `mosd/deny.toml` without a
decision having been made** — asked four times, never answered, shipped on L1's
call so the DAG could move. It is not approved and the question is open; the
history and the planned fallback are above. `origin` is ten commits behind local
`main` and pushing is with the user.

**Closed during the campaign, for accuracy:** both apid test flakes are **fixed**,
not outstanding — `0ed5cc7` (`mosd/apid/src/auth.rs`,
`a_restart_does_not_reset_the_armed_window`) and `821a63a` (`mosd/apid/tests/e2e.rs`,
`web_flow_end_to_end`), each verified 3/3. The second's cause was not only the
1-second constant: a full HTTPS round trip with an **argon2** verification inside
it sat between arming the window and asserting the 429, and argon2 is expensive on
purpose.

**No `docs/design/bus.zh.md` was created.** `bus.md` has no Chinese counterpart
and neither do `connd.md`, `containers.md`, `ro-root.md`, `release-signing.md`,
`uboot-ab-handshake.md` or `bsp-cx3576-sync.md`. `docs/verify-index.sh` excludes
`*.zh.md` **deliberately** — whether the existing translations are kept current is
a decision parked with the user and unresolved (`docs/README.md`). Creating one
would take on an obligation the repository has explicitly declined, which is worse
than the gap it would close.
