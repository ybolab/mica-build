# PLAN-038 Bound, scope and queue the settings-write path

- **status**: implementing
- **createdAt**: 2026-08-31 12:27
- **approvedAt**: 2026-08-31 13:57 UTC
- **relatedTask**: [RFCT-274](../task/RFCT-274.md)

## Context

Measured from the tree on 2026-08-31. Modules and function names are named
rather than line numbers, per the convention `docs/design/dashboard.md` states.

### The path a settings write takes

`browser -> apid handler -> zbus call to mosd -> mosd's global mutex ->
reconciler -> systemd D-Bus`. Every hop below is on that path.

### Nothing on the path carries a timeout

`apid::routes::router` installs exactly one layer, the auth gate; there is no
`TimeoutLayer`. `grep timeout` over apid's non-test sources returns nothing.
zbus's `call_method` applies no default reply timeout. The UI is server-rendered
`maud` with a form-POST-then-302 flow and no JavaScript, so a request that never
answers is literally a blank page with a spinner and nothing that will end it.

mosd already knows this shape: `mosd::scan` bounds its registry probe with
`PROBE_TIMEOUT`, and `mosd::bus` bounds its RAUC slot query with
`SLOT_QUERY_TIMEOUT`. Neither pattern was carried to the `apid -> mosd` hop or
to the `reconciler -> systemd` hop.

### One mutex covers both the data and its reconcile

`MosdService`'s `Inner` (settings + live state) sits behind one
`tokio::sync::Mutex`. `write_setting` holds it across the whole reconcile loop,
and `get_settings` / `get_state` take the same lock. While any reconcile runs,
every pane that reads mosd blocks — the freeze is system-wide, not confined to
the pane that caused it.

The auth gate short-circuits on a valid session cookie before its bus read, so
an authenticated page load blocks only on its own handler's calls. `/healthz`
is released ahead of the gate and touches no bus, which makes it the
discriminator when triaging a live device.

### The transient-password path re-applies the world

`ssh_password` -> `SetTransientRootPassword` -> bcrypt (cost 12, in
`spawn_blocking`) -> **`apply_all`**, which runs *every* reconciler, not just
sshd. That reaches:

- `ContainerReconciler`, whose `turn_on` and `turn_off` both call
  `daemon_reload` unconditionally — a full systemd `daemon-reload` runs even
  when the container switch is off. On the device that re-runs every generator,
  Quadlet included.
- `NetworkReconciler`, which reloads networkd, and the two Wi-Fi reconcilers,
  which restart `wpa_supplicant` / `hostapd` when their rendered config changed.
  If the browser reached apid over that link, the connection dies mid-request —
  and with no timeout anywhere, the page waits forever.

`ContainerReconciler`'s own comments record that a reconciler blocking here has
happened before and left no journal evidence, which is why each of its steps now
logs before it runs.

The documented reason for that `apply_all` is narrow and verifiable: mosd's own
comment says the reconcilers are re-run "so the sshd drop-in re-renders against
a device that now has a password to offer". `transient::transient_password_active`
has exactly one non-test caller in the daemon — `SshdReconciler::apply`. No
other reconciler observes the marker, so no other reconciler has a reason to
run. `rotate_wireguard_key` carries the same `apply_all` with the same shape of
reason, naming only the network reconciler.

### The enable path is lighter but not clean

`ssh_enable` writes `access.ssh.enabled`, which by `paths_overlap` reaches only
`SshdReconciler`. But `Systemd::manager_call` builds a **new system-bus
connection on every call**, and `active_state` builds two (`LoadUnit`, then a
property `Get`). One "Enable SSH" is roughly seven to nine fresh connections,
each with a full auth handshake.

`SshdReconciler::apply_unit` is already correctly conservative: it enables only
when not enabled, starts only when not active, and reloads only when the
rendered config changed — never restarts. `reapplying_the_same_settings_changes_nothing`
tests exactly that. So a repeated click today converges to the right state; what
it costs is a second serialized reconcile, not a wrong result.

### One connect can serialize all of apid

`BusSettings::proxy` holds its `proxy` mutex across
`zbus::Connection::system().await`. A slow or stuck connect there does not fail
one request — it queues every apid request behind it.

### What a record exists today, and what does not

`apid::audit` is a bounded persistent JSONL ring on STATE (two files, ~512 KiB
total) carrying timestamp, event, outcome and source, and it already records
logins, power actions and `transient-password/set`. It does **not** record
settings writes or reconcile outcomes. `MosdService`'s `record` writes each
reconciler's last result into the live-state tree, but it is overwriting — there
is no history, no timing, and no notion of a request having been folded into an
earlier one.

### The contract a queue would change, and how far it reaches

`POST /api/v1/settings/{path}` answers **204**, documented as "mosd has
persisted it *and re-applied the reconcilers whose subtree overlaps the path*" —
an explicit promise that return means applied. `openapi.json` is generated by
`apid --openapi` and asserted by a test, and `tests/apid-api/src/spec-pins.ts`
pins literals across the phase files and that document.

**The blast radius is provably one process.** `SetSettings` has exactly one
caller outside mosd itself: apid, through `bus_client.rs` / `settings_api.rs`
and their tests. `mqttd` names `com.mos.mosd` only in `enrollment.rs`, and only
to state that it is *structurally excluded from MQTT* — the system-management
item tree was removed from the broker by RFCT-266. So no third party observes
the current return shape, and there is nothing to keep compatible with.

The codebase already has the asynchronous-dispatch pattern and a status code
for it: `power_accepted` spawns the mosd call and answers **202**, with the
reasoning written out — "204 would claim the action had finished, which this
route cannot know". Generalizing that is a smaller conceptual step than
inventing one.

### The notification machinery already exists

apid already runs exactly the pump this plan needs for task notifications.
`bus_client::watch_settings_changed`, spawned once from `main`, holds its own
dedicated connection, subscribes to mosd's `SettingsChanged`, marks an
`AccessCache` synchronised while the stream is live, and on any lapse drops
back to direct reads and redials after `RESUBSCRIBE_DELAY`. `AccessCache`
carries the discipline that makes an in-memory mirror of daemon state safe:
`subscribed` / `lapsed` gating, a `generation` counter so a fill whose read
began before an invalidation is discarded, and a documented rule that it
**never serves unless provably fresh**. A task registry is the same problem
with a different payload, and it should reuse that shape rather than invent a
second one.

### Conflict survey (2026-08-31)

Run because this plan has to land beside work already in flight.

- **No branch conflict.** `git log --all --not main` over
  `apid/src`, `mosd/src/bus.rs`, `mosd/src/reconciler/systemd.rs`,
  `mosd/src/transient.rs` and `apid/openapi.json` returns nothing. The 47 BKD
  worktrees are historical or merged with respect to every file this plan
  touches.
- **PLAN-036** (implementing) covers `os/build-env/deb`, package metadata and
  Dockerfiles under `os/pkgs`, `os/boards`, `os/rootfs`, `os/verify` and
  Make/CI. It packages the mosd workspace; it does not edit its Rust sources.
  The one shared file is `docs/changelog.md`.
- **PLAN-037** (draft; RFCT-273 in progress) creates `docs/user/` and
  `docs/zh/user/`, keeps `docs/design/` authoritative, and reserves the right
  to make "small corrections to existing design summaries when executable
  contracts prove them stale". It also builds a capability register stating what
  the API answers. Both of those collide with this plan's design-doc edits and
  with the 204 -> 202 change.
- **RFCT-260** (pending) touches `reconciler/wifi_ap.rs` and `mosd-settings`.
  No file this plan touches. Stage B does change *when* the AP reconciler runs —
  it stops running on a transient-password set — which is a behavioural note for
  whoever claims RFCT-260, not a conflict.
- **RFCT-253** (closed, superseded by RFCT-266) leaves one inherited fact worth
  carrying: `WRITABLE_SUBTREES` is not an access boundary, because `SetSettings`
  writes any settings path without consulting it. It bounds the remote write
  surface only, and after RFCT-266 that surface no longer includes mosd at all.

## Proposal

Four stages, all approved for delivery. A and B are independently shippable and
fix the reported symptom on their own; C is what makes D worth doing; D is the
queue. Each stage leaves the tree working, and the order is a delivery order,
not a set of optional gates.

**No compatibility layer is built anywhere in this plan.** The newest design is
the only design: no dual-mode `SetSettings`, no deprecation window, no shim that
keeps the 204 alive. This is affordable because the blast radius is one process
(see *Context*), and it is the user's recorded decision.

### Stage A — bound every cross-process wait

The bound here is a **floor against hanging**, not the mechanism that decides
what the operator sees; Stage D is what makes the write call short by
construction. A exists so that a stall anywhere is survivable before D lands,
and stays afterwards for calls that are not queued (`GetSettings`, `GetState`,
`GetTask`).

1. `apid/src/bus_client.rs`: wrap each `MosdProxy` call in
   `tokio::time::timeout(MOSD_CALL_TIMEOUT)`. An elapsed bound drops the cached
   proxy exactly as an error does and returns a distinct error kind.
2. Map that kind to **504** for HTML and to a `mosd_timeout` code in the
   `docs/design/api.md` §2.4 envelope for the API. The message states that the
   operation may still be running — see *Risks*.
3. `apid/src/bus_client.rs`: stop holding the proxy mutex across
   `Connection::system().await`. Take the lock, observe `None`, release,
   connect, re-take and store. A duplicate connection built under a race is
   dropped; that is cheaper than serializing every request behind one connect.
4. `mosd/src/reconciler/systemd.rs`: bound `manager_call` with a timeout, and
   build the system-bus connection once for the `Systemd` executor instead of
   once per call.

### Stage B — re-apply only what the change can affect

1. `mosd/src/bus.rs`: extract the reconcile loop from `write_setting` into one
   `apply_subtree(path)` helper, so the overlap rule has a single
   implementation.
2. `set_transient_root_password` calls `apply_subtree("access.ssh")` instead of
   `apply_all`. Justified by `transient_password_active` having exactly one
   reconciler caller.
3. `rotate_wireguard_key` calls `apply_subtree("network")` instead of
   `apply_all`, on its own documented reason. Included rather than left beside
   the fix because it is the same defect in the same file.
4. `apply_all` survives for its remaining legitimate caller: the startup
   converge in `main`.

RED first: extend the existing `service_with_mock` harness with a recording
reconciler set and assert `set_transient_root_password` invokes sshd and
nothing else.

### Stage C — separate the data lock from the apply lock

`Inner` becomes an `RwLock` guarding settings and live state, plus a separate
`Mutex<()>` that serializes reconcile execution.

- `write_setting`: take the apply lock; take the data write lock briefly to
  validate, persist, swap and clone; release it; run the reconcilers; re-take
  it briefly for each `record`.
- `get_settings` / `get_state`: data read lock only. They no longer queue
  behind a running reconcile.
- `set_transient_root_password` and `rotate_wireguard_key` must take the
  **apply lock**. Their current serialization — the shadow file's
  read-modify-write through one fixed temp name, and a key rotation that
  deletes and rebuilds a device — depends on the lock they take today, and
  moving them onto the data lock would silently drop it. This is the subtle
  part of the stage and gets its own test.

### Stage D — queue in mosd, notification-fed registry in apid

Two queues, and they are not the same object. mosd owns the **work** queue that
executes reconciles; apid owns an in-memory **task registry** that mirrors their
state so the UI never polls across the bus.

#### D1. mosd: the work queue

1. An in-memory apply queue drained by one worker task. `SetSettings` becomes:
   validate, persist, enqueue, return a task id. The worker holds the apply
   lock from Stage C; the enqueue does not.
2. **Coalescing, which is the part that answers repeated clicks.** A queued job
   whose subtree a newly enqueued job subsumes is folded into it, and the fold
   is counted on the surviving record. A plain FIFO would serialize two
   identical clicks rather than collapse them, which is not the requested
   behaviour. Folding is by subtree subsumption only — never "a job is already
   queued".
3. Task record: id, operation, dot-path, source, enqueued/started/finished
   timestamps, outcome, folded count. Published as a bounded list in the
   live-state tree, readable through the existing state route and through a new
   `GetTask`.
4. A new `TaskChanged` signal on `com.mos.mosd1`, emitted on every task state
   transition, carrying the record. It sits beside `SettingsChanged`, which
   keeps its current meaning: `SettingsChanged` says the tree changed,
   `TaskChanged` says the work about that change moved.

#### D2. apid: the registry that waits for the notification

1. A `TaskRegistry` modelled on `AccessCache`, fed by a `watch_tasks` pump
   modelled on `watch_settings_changed` — its own dedicated connection,
   `subscribed` / `lapsed` gating, `generation`-checked fills, redial after
   `RESUBSCRIBE_DELAY`. Spawned once from `main` beside the existing pump.
2. The freshness rule is inherited verbatim: **serve from memory only while the
   subscription is provably live**; on any lapse fall back to a direct `GetTask`
   read. A stale "still running" shown for a task that finished is a worse
   failure here than a bus round trip, for the reason `AccessCache` already
   states about a stale setup-mode decision.
3. Task status is therefore answered out of apid's own memory. The UI's polling
   costs no bus traffic, and a task that finishes is visible on the next poll
   because the signal already delivered it — apid waits for the notification
   rather than asking repeatedly.

#### D3. The HTTP and UI surface

1. `POST /api/v1/settings/{path}` answers **202** with the task id;
   `GET /api/v1/tasks/{id}` reports the record; the collection route follows the
   shape the existing collection routes use. Regenerate `openapi.json`, update
   `spec-pins.ts` and the affected phase files in the same commit — a partial
   update fails the checkout gate rather than shipping quietly.
2. **No plaintext password is ever enqueued.** bcrypt runs at the request
   boundary as it does today; only the resulting shadow write and the
   `access.ssh` re-apply job enter the queue. A test asserts the queue entry
   carries no password material.
3. UI, zero-JavaScript preserved: the POST redirects to `/ssh?task=<id>`, the
   pane renders an "applying" banner, and a `<meta http-equiv="refresh">` polls
   until the record is terminal. No script tag and no external asset is
   introduced, so the property `docs/design/dashboard.md` measured stays true.

### Deliberately out of scope

`ContainerReconciler`'s unconditional `daemon_reload` in both branches. Once
Stage B lands, the only callers that reach it are the containers pane's own
button — where a reload is what the operator asked for — and the startup
converge, which runs once before mosd takes its bus name. Making it conditional
would need a changed-file-set comparison and would stop a `.container` file
dropped onto STATE from being noticed without a toggle. Recorded here so it is
not mistaken for an oversight; it wants its own task if it is wanted at all.

## Conflicts and coordination

Derived from the survey in *Context*. These are commitments this plan makes to
work already in flight, not observations.

1. **`docs/changelog.md` is shared with PLAN-036.** Append only, one entry, at
   the point of landing. Do not reflow or re-order neighbouring entries.
2. **PLAN-038 owns the write-path contract; PLAN-037 consumes it.** PLAN-037's
   capability register and any API-facing user page must state the 202 +
   task-id shape, not the 204. Two orderings are safe and one is not:
   - PLAN-038 lands first — PLAN-037 reads the shipped `openapi.json`. Preferred.
   - PLAN-037 lands first — its settings-write entry must be written against
     this plan and carry a pointer to RFCT-274, so it does not have to be found
     and corrected later.
   - PLAN-037 documents the current 204 as settled truth. Not acceptable; it
     would publish a contract that is being removed in the same release.
3. **Design-doc edits are partitioned by section, not by file.** This plan edits
   only the write-path/API-contract sections of `docs/design/{api,mosd,access}.md`
   and their `docs/zh/` counterparts. PLAN-037's "small corrections to existing
   design summaries" must not enter those sections while RFCT-274 is open; any
   staleness found there gets reported to RFCT-274 instead of fixed in passing.
4. **RFCT-260 gets a note, not a dependency.** Whoever claims it should know
   that after Stage B the AP reconciler no longer runs on a transient-password
   set. Nothing in RFCT-260's scope changes, and neither task blocks the other.
5. **Land the stages as separate commits on one branch.** A, B, C, D1, D2, D3.
   Stage D3 is the only one that moves `openapi.json`, `spec-pins.ts` and the
   phase files, and it moves all three together.
6. **Re-run the survey before implementing.** The branch check was clean at
   `9acd48f`; the BKD campaign is active, so it is evidence about a moment, not
   a standing guarantee.

## Risks

- **A timeout on a write that is still running reports something untrue.** mosd
  does not abandon a reconcile because apid stopped waiting, so a 504 means
  "not confirmed", not "did not happen". Settings writes are declarative and
  idempotent, so a retry is safe, but the message must say so; a message that
  says "failed" would push an operator into re-submitting a change that already
  landed. Stage D shrinks this to the non-queued reads, where the call is short
  and a timeout really is a fault.
- **The registry can serve a stale task state.** This is the failure
  `AccessCache`'s lockout rule exists to prevent, transplanted: an operator
  watching "applying" forever because the completion signal was missed is a
  support call. Mitigated by inheriting the same `subscribed` / `lapsed` /
  `generation` discipline and by falling back to `GetTask`, and it must be
  tested by dropping the subscription mid-task.
- **204 -> 202 breaks a published contract, deliberately and with no shim.**
  Every client that read "return means applied" is wrong afterwards. The e2e
  phases, the spec pins and `openapi.json` have to move together. The blast
  radius is bounded to apid by measurement, not by assumption.
- **Splitting the lock lets a reader observe a persisted-but-unreconciled
  value.** That is already the truth — the device converges after the write, not
  during it — and the live-state tree is what reports applied state. But it
  becomes observable, and the panes that render settings next to live state
  should say which is which. With Stage D the task record is what closes the
  gap, which is an argument for not shipping C without D.
- **Losing the serialization Stage C moves.** If `set_transient_root_password`
  ends up on the data lock rather than the apply lock, two concurrent writes can
  interleave through one fixed temp filename. Tested explicitly.
- **The queue must not be persisted.** A mosd restart re-runs `apply_all` from
  persisted settings and converges anyway; a persisted queue would replay
  operations the tree already reflects, and would be one more place a password
  could be written to disk.
- **Two signals can drift.** `SettingsChanged` and `TaskChanged` describe the
  same event from two angles, and a subscriber that acts on both must not
  double-handle. apid's access cache consumes only the first; the registry
  consumes only the second.
- **A `<meta refresh>` poll loop with no terminal state spins forever.** Every
  task record must reach a terminal outcome, including the mosd-restarted case,
  or the pane refreshes until the operator gives up.

## Scope

`os/pkgs/mosd/apid/src/{bus_client,routes,settings_api,audit,main}.rs` plus a
new task-registry module,
`os/pkgs/mosd/mosd/src/{bus,main}.rs` plus a new queue module,
`os/pkgs/mosd/mosd/src/reconciler/systemd.rs`, their tests,
`os/pkgs/mosd/apid/openapi.json`,
`os/pkgs/mosd/tests/apid-api/src/spec-pins.ts` and the affected phase files,
the write-path sections of `docs/design/{api,mosd,access}.md` and their
`docs/zh/` counterparts, `docs/changelog.md` and these records.

Stages A and B are small and self-contained. C is a contained refactor of one
file with a named hazard. D is the largest: a new bus signal, a new mosd module,
a new apid module, and the only change to a published contract.

## Alternatives

### Keep `SetSettings` synchronous and queue underneath it

**Rejected by the user on 2026-08-31**, together with any other compatibility-
preserving shape: the instruction was to follow the newest design and not
consider compatibility. It would have kept the 204, still collapsed repeated
clicks and still produced the record, at the cost of the request continuing to
block for the duration of the reconcile. Recorded because it was offered at the
approval gate and declined, not because it remains open.

### Poll mosd for task state instead of subscribing

Rejected on the user's direction that apid should hold a queue and wait for a
notification. It is also the worse engineering: a `<meta refresh>` pane would
turn every open browser tab into a periodic bus round trip against the same
mutex this plan exists to stop contending with, and apid already runs a signal
pump whose lapse discipline is written and tested.

### Put the work queue in apid

Rejected. apid is not the serialization point — mosd's lock is — so a queue
there would not stop concurrent reconciles, and it would be lost on an apid
restart while the work it describes is mosd's. What apid holds instead is a
*mirror* of mosd's queue, which is what D2 builds.

### Plain FIFO without coalescing

Rejected. It serializes duplicate clicks instead of collapsing them, so the
reported behaviour — clicking twice costs twice — survives.

### Disable the submit button in the browser

Rejected. The repository is deliberately zero-JavaScript, confirmed by several
probes recorded in `docs/design/dashboard.md`, and this would trade that
property for a fix that only hides duplicate submits from a cooperating client.

### Timeouts only

Rejected as an end state, adopted as Stage A's floor. It converts an unbounded
hang into a bounded error, which is strictly better and shippable on its own,
but it leaves every pane blocked for the duration of a reconcile and adds no
record.

## Annotations

- 2026-08-31 12:27 — Raised from a user report that the SSH pane freezes the
  page, and a follow-up user proposal to run the switch and password operations
  through a queue so repeated clicks do not execute repeatedly and execution has
  a clearer record. The staging is a response to that proposal: the queue is
  Stage D, and Stages A-C are what has to be true for it to deliver the effect
  asked for — a queue on top of the current lock would move the hang rather
  than remove it.
- 2026-08-31 12:40 — User decisions at the approval gate, three questions
  answered:
  1. Take the newest design and do not consider compatibility. The 204 -> 202
     change is made outright; every compatibility-preserving alternative is
     closed. Recorded in *Proposal* and in *Alternatives*.
  2. All four stages are in scope. A-D are a delivery order, not optional
     gates.
  3. apid may hold a queue that waits for a notification. This replaced the
     open question about picking `MOSD_CALL_TIMEOUT` as the mechanism the
     operator experiences: Stage D2 now specifies a `TaskChanged` signal and an
     apid-side `TaskRegistry` fed by it, modelled on the existing
     `watch_settings_changed` pump and `AccessCache` freshness rule. The
     timeout survives only as a floor against hanging.
- 2026-08-31 12:40 — Implementation explicitly deferred by the user ("先不实施"),
  so the record stays `draft` and `approvedAt` stays pending. Scope and design
  are settled; the plan is ready to move to `implementing` on `proceed`. A
  conflict survey was run at `9acd48f` and its commitments are recorded in
  *Conflicts and coordination*; it is evidence about a moment and is to be
  re-run before implementing.
- 2026-08-31 13:57 — The user approved implementation ("开始实现"). The
  conflict survey was repeated at `792d206`; the worktree is clean and no
  off-main commit touches the implementation paths owned by this plan.
