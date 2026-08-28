# RFCT-210 PLAN-023 M1: the write-surface design (USER-GATED)

- **status**: completed — 41-row inventory re-measured at 6950f69 (13 rows section 2.3 lacks), writes classified into 3 shapes with 3 exceptions, the collection shape's 404-vs-422 error contract settled and swept, and an M4-M8 split, token-revocation conflict resolved as keep-3.2-plus-a-pane-sentence, key-custody memo written as 4 options for the user
- **completedAt**: 2026-08-28
- **priority**: P1
- **owner**: bkd/o79zdry0
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (M1)

PLAN-023 M1 is design and a decision memo. Nothing here is implemented by this
task: M4+ implements whatever the user ratifies. Four parts, in the order
PLAN-023 asks for them — the operation inventory re-measured, the write routes
classified into the shapes `docs/design/api.md` section 2.3 proposes, the
token-revocation-on-password-change conflict resolved, and the key-custody
options written up for the user to choose between.

Every line number below was read at `6950f69`, this branch's HEAD, by opening
the router rather than by copying section 2.3's table forward. Where a number
differs from section 2.3's, both are given.

## 1. The operation inventory, re-measured at `6950f69`

### 1.1 How this was measured, and why the old table could not be trusted

Section 2.3's table (`docs/design/api.md:1348`) states its own provenance:
*"Input is section 1.2's route table, re-measured at `f7cb5ba`. One row per
method+path that exists today; the line numbers in the first column are this
commit's."* (`docs/design/api.md:1367-1369`) Two things have happened to it since.

**It went stale.** Its first column cites lines in the bare form
`routes.rs:947`, with no directory segment. That form is outside
`docs/verify-citations.sh`'s scope by construction — the checker's own header
records it, of exactly that shorthand: *"is shorthand for a path named earlier
in the prose and has no base to resolve against"*
(`docs/verify-citations.sh:40-41`). So no
gate has ever checked those twenty numbers, and they have drifted by as much as
1078 lines. `POST /setup` is cited at `routes.rs:947`; its handler is at
`os/pkgs/mosd/apid/src/routes.rs:3844`. `POST /ssh/password` is cited at
`routes.rs:2515`; it is at `os/pkgs/mosd/apid/src/routes.rs:6701`.

**It was never complete, and not only because the surface grew.** PLAN-021 added
the password pane and `POST /api/v1/actions/change-password`; PLAN-022 added the
typed interface kinds and the WireGuard rotate route. But seven handler routes
that section 2.3 has no row for existed *at `f7cb5ba` itself* — the built-in-UI
escape (three), the containers pane (two) and the MQTT pane (two). Measured
directly: `git show f7cb5ba:mosd/apid/src/routes.rs` declares `/containers`,
`/containers/enable`, `/mqtt`, `/mqtt/enable`, `/builtin` (nested),
`/builtin/`, and `/builtin/deactivate` at that commit's lines 168, 169, 170,
171, 138-146, 148 and 145. So the table's "one row per method+path that exists
today" claim was false when written, and the correction below is not purely a
consequence of six months of growth.

The measurement method used here: read the HTTPS router at
`os/pkgs/mosd/apid/src/routes.rs:139-230`, the API sub-router at
`os/pkgs/mosd/apid/src/routes.rs:414-497` and the HTTP-listener router
(`os/pkgs/mosd/apid/src/routes.rs:3211-3214`); resolve every path constant
(`os/pkgs/mosd/apid/src/routes.rs:253-320`, `:2442-2451`); one row per
method+path the router actually declares, with both the declaration line and the
handler line, because the old table mixed the two silently.

A hard negative that shapes everything in part 2: **`use axum::routing::{any,
get, post};` (`os/pkgs/mosd/apid/src/routes.rs:32`) is the whole verb import.**
There is no `put(`, no `delete(` and no `patch(` anywhere in the router. Every
write proposal below is a route that does not exist, in a verb apid has never
served.

### 1.2 The inventory

`D` is the `.route`/`.nest` declaration line in
`os/pkgs/mosd/apid/src/routes.rs`; `H` is the handler. **new** marks a
method+path that did not exist at `f7cb5ba`; **missing** marks one that existed
at `f7cb5ba` and has no row in section 2.3's table.

| # | Method + path | D | H | In §2.3's table? | Status |
|---|---|---|---|---|---|
| 1 | `GET /` | 137 | `serve.rs:57` | yes | excluded — a rendering, not data |
| 2 | `GET /builtin` | 158 | 1979 | **missing** | excluded — the §6.3 escape, browser-only |
| 3 | `POST /builtin/deactivate` | 162 | 2028 | **missing** | **proposed**: `POST /api/v1/actions/deactivate-bundle` |
| 4 | `GET /builtin/*` (nest fallback) | 163 | 2092 | **missing** | excluded — a 404 handler |
| 5 | `GET /builtin/` | 165 | 1979 | **missing** | excluded — spelling alias of row 2 |
| 6 | `GET /setup` | 166 | 1334 | yes | excluded — a form |
| 7 | `POST /setup` | 166 | 1376 | yes (cited `routes.rs:947`) | **proposed**: `POST /api/v1/setup` |
| 8 | `GET /login` | 167 | 1509 | yes | excluded — a form |
| 9 | `POST /login` | 167 | 1528 | yes (cited `:1560`) | excluded — sessions are a browser mechanism |
| 10 | `POST /logout` | 168 | 1596 | yes (cited `:1628`) | excluded — no session to drop |
| 11 | `GET /password` | 169 | 1736 | prose only, no row | excluded — a form |
| 12 | `POST /password` | 169 | 1740 | prose only, no row | **shipped**: `POST /api/v1/actions/change-password` |
| 13 | `GET /network` | 170 | 2483 | yes (cited `:1968`) | **shipped**: `GET /api/v1/settings/network` |
| 14 | `POST /network` | 170 | 2493 | yes (cited `:1978`) | **proposed**: `PUT /api/v1/settings/network.<iface>` — but see 2.3 |
| 15 | `POST /network/peers/add` | 174 | 2532 | **new** | **proposed**: collection route |
| 16 | `POST /network/peers/remove` | 175 | 2570 | **new** | **proposed**: collection route |
| 17 | `GET /hostname` | 176 | 2634 | yes (cited `:2025`) | **shipped**: `GET /api/v1/settings/hostname` |
| 18 | `POST /hostname` | 176 | 2799 | yes (cited `:2190`) | **proposed**: `PUT /api/v1/settings/hostname` |
| 19 | `GET /power` | 177 | 2728 | yes (cited `:2119`) | excluded — a confirmation form |
| 20 | `POST /power/reboot` | 181 | 2781 | yes (cited `:2172`) | **proposed**: `POST /api/v1/actions/reboot`, 202 |
| 21 | `POST /power/poweroff` | 182 | 2789 | yes (cited `:2180`) | **proposed**: `POST /api/v1/actions/poweroff`, 202 |
| 22 | `GET /ssh` | 183 | 3089 | yes (cited `:2494`) | **shipped**, as two reads |
| 23 | `POST /ssh/enable` | 187 | 3105 | yes (cited `:2510`) | **proposed**: `PUT /api/v1/settings/access.ssh.enabled` |
| 24 | `POST /ssh/password` | 188 | 3593 | yes (cited `:3227`) | **proposed**: `POST /api/v1/actions/transient-root-password` |
| 25 | `POST /ssh/keys/add` | 189 | 3623 | yes (cited `:3257`) | **proposed**: `POST /api/v1/ssh/authorized-keys` |
| 26 | `POST /ssh/keys/remove` | 190 | 3656 | yes (cited `:3290`) | **proposed**: `DELETE /api/v1/ssh/authorized-keys/{fingerprint}` |
| 27 | `GET /containers` | 191 | 3243 | **missing** | **shipped**: `GET /api/v1/settings/container` |
| 28 | `POST /containers/enable` | 192 | 3259 | **missing** | **proposed**: `PUT /api/v1/settings/container.enabled` |
| 29 | `GET /mqtt` | 193 | 3529 | **missing** | **shipped**: `GET /api/v1/settings/mqtt` |
| 30 | `POST /mqtt/enable` | 194 | 3545 | **missing** | **proposed**: `PUT /api/v1/settings/mqtt.enabled` |
| 31 | `GET /healthz` | 195 | 877 | yes (cited `:189`, `:768`) | excluded and frozen — the boot gate's probe |
| 32 | `GET /api/versions` | 309 | 481 | preamble prose | **shipped** |
| 33 | `GET /api/v1/meta` | 310 | 506 | preamble prose | **shipped** |
| 34 | `GET /api/v1/settings/{*path}` | 311 | 554 | preamble prose | **shipped** |
| 35 | `GET /api/v1/state/{*path}` | 312 | 581 | preamble prose | **shipped** |
| 36 | `POST /api/v1/actions/change-password` | 313 | 1811 | **new**, in the §2.3 bullet | **shipped** |
| 37 | `POST /api/v1/actions/wireguard/{iface}/rotate-key` | 317 | 632 | **new**, no row and no bullet | **shipped** |
| 38 | `ANY /api/` | 207 | 219 | no | excluded — the reserved-prefix 404 |
| 39 | `ANY /api/**` (nest fallback) | 318 | 219 | no | excluded — the reserved-prefix 404 |
| 40 | `ANY /**` (asset fallback) | 209 | `serve.rs` | no | excluded — §4.2's SPA fallback |
| 41 | every path on the HTTP listener | 758 | 762 | yes | excluded — 308 to the HTTPS origin |

The published document agrees with rows 32-37 and with nothing else: reading
`os/pkgs/mosd/apid/openapi.json` at HEAD yields exactly six operations, one
`POST` each on `"/api/v1/actions/change-password"`
(`os/pkgs/mosd/apid/openapi.json:9`) and
`"/api/v1/actions/wireguard/{iface}/rotate-key"`
(`os/pkgs/mosd/apid/openapi.json:256`), and one `GET` each on
`"/api/v1/meta"` (`os/pkgs/mosd/apid/openapi.json:391`),
`"/api/v1/settings/{path}"` (`os/pkgs/mosd/apid/openapi.json:1015`),
`"/api/v1/state/{path}"` (`os/pkgs/mosd/apid/openapi.json:1561`) and
`"/api/versions"` (`os/pkgs/mosd/apid/openapi.json:2144`).

### 1.3 Every row section 2.3 does not currently have, named

Thirteen rows, in three groups.

**Group A — existed at `f7cb5ba`, omitted from the measurement (7).** Rows 2, 3,
4, 5, 27, 28, 29, 30 above minus the alias row 5 and the fallback row 4, which
are addressing artefacts rather than operations: `GET /builtin`,
`POST /builtin/deactivate`, `GET /containers`, `POST /containers/enable`,
`GET /mqtt`, `POST /mqtt/enable`, and (counted here) `GET /builtin/`. Two of
these are **writes with no API equivalent proposed anywhere in the document**:
`POST /containers/enable` and `POST /mqtt/enable`. One,
`POST /builtin/deactivate`, is the §6.3 escape and is discussed in section 6 of
`docs/design/api.md` without ever appearing in the operation inventory, so a
reader building the API surface from section 2.3 would not know it exists.

**Group B — added since `f7cb5ba` (6).** `GET /password` and `POST /password`
(covered by a section 2.3 bullet but with no table row);
`POST /network/peers/add`; `POST /network/peers/remove`;
`POST /api/v1/actions/change-password` (in the bullet);
`POST /api/v1/actions/wireguard/{iface}/rotate-key` (**in neither the table nor
any section 2.3 bullet** — the only shipped API operation section 2.3 does not
mention at all).

**Group C — routing artefacts with no row (3).** `ANY /api/`, the `/api/**`
nest fallback, and the asset fallback. These are deliberately not operations,
but the table claims to be exhaustive over the router and they are declared
there, so they are named rather than left as a silent gap.

**Two stale prose citations in section 2.3, for the record.** The bullet on
`POST /setup` cites the gate's setup-mode exemption as `routes.rs:701-706`; at
HEAD it is `os/pkgs/mosd/apid/src/routes.rs:3310-3315`. The confirmation-token
paragraph cites `os/pkgs/mosd/apid/src/routes.rs:5771`, which at HEAD is inside
`power_form`, not the confirmation check. Both are section 2.3's to fix, and
`docs/design/api.md` is out of this task's write scope; they are recorded here
so the M4+ author does not re-derive them.

## 2. Classifying the write routes

### 2.1 The three shapes and the one test that separates them

Section 2.3 proposes settings writes (`PUT /api/v1/settings/<dot-path>`),
collection resources, and actions (`POST /api/v1/actions/<verb>`). Section 2.2
already gives the rule that separates the first two: *"Identity is never a list
index."* (`docs/design/api.md:1254`) — a collection is needed exactly when an
item's identity is not a path position. And it gives the rule that separates
actions from both: an action is a verb *"with no state to `GET` and no
idempotency to promise"* (`docs/design/api.md:1394-1395`).

That is enough to classify most rows, and it is **not** enough for the network
tree. The measurement that decides that case is in section 2.3 below.

### 2.2 Row-by-row

**Actions (`POST /api/v1/actions/<verb>`), 6.** Rows 20, 21, 24, 3, 12 and 37.
`reboot` and `poweroff` because the machine goes down before the response could
describe a result; `transient-root-password` because the value is never written
into the settings tree at all — mosd's own words:
*"Deliberately not a setting. Nothing is written into the settings tree"*
(`os/pkgs/mosd/mosd/src/bus.rs:818-819`), and the password *"lives until the
next boot"* (`os/pkgs/mosd/mosd/src/bus.rs:814-815`). `deactivate-bundle`
because it renames a directory on DATA, not a settings node.
`change-password` and `wireguard/{iface}/rotate-key` are already shipped in this
shape, and the second states the test explicitly:
*"An action and not a settings write, because there is no setting to write: the
key lives in a mode-0640 file on STATE that the settings tree does not
describe."* (`os/pkgs/mosd/apid/src/routes.rs:1291-1294`)

**Collection resources, 3.** SSH authorized keys (rows 25, 26), backed by
`authorized_keys` (`os/pkgs/mosd/mosd-settings/src/model.rs:224`); WiFi client
networks, backed by `networks` (`os/pkgs/mosd/mosd-settings/src/model.rs:378`);
and — new, section 2.3 predates it — **WireGuard peers** (rows 15, 16), backed
by `peers` (`os/pkgs/mosd/mosd-settings/src/model.rs:621`). All three are
`Vec<T>` in a tree whose dot-path syntax cannot index an array, and all three
have a natural identity that is not a position: fingerprint, `ssid`, and the
peer's `public_key` respectively. The peer routes are the strongest case of the
three, because the code already refuses index identity on the same reasoning
apid applied to keys: `network_peer_remove` matches on `public_key`
(`os/pkgs/mosd/apid/src/routes.rs:5596-5623`) and answers
*"No peer of this tunnel has that public key; the list may have changed since the page was loaded."*
(`os/pkgs/mosd/apid/src/routes.rs:5611`) rather than succeeding silently.

**Raw dot-path `PUT`, 4 rows and no more.** Rows 18 (`hostname`), 23
(`access.ssh.enabled`), 28 (`container.enabled`) and 30 (`mqtt.enabled`). These
are the safe cases and they share one property: **the value being written is a
scalar whose validity depends on nothing else in the tree.** `hostname` is
checked by `valid_hostname` on apid's write path and again by the reconciler;
the three booleans cannot be invalid at all. For these, `PUT` is not merely
adequate, it is better than a typed route: there is nothing a typed route would
add but a second name for the same write.

### 2.3 The operations that fit none of the three cleanly

Three, and they are what the milestone plan has to be built around.

**(i) `POST /network` — a raw dot-path `PUT` is unsafe here, and this is
measurable.** The pane's handler validates the whole candidate tree before it
writes: it builds `candidate` from the loaded view plus the one edited entry and
runs `validate_entries(&candidate)`
(`os/pkgs/mosd/apid/src/routes.rs:5540-5544`), rejecting the submission with a
readable error. The comment says why it must be the tree and not the entry:
*"The candidate tree, not the one entry: every relational rule below is about
two entries at once."* (`os/pkgs/mosd/apid/src/routes.rs:5538-5539`) The rules
`validate_entries` enforces (`os/pkgs/mosd/apid/src/routes.rs:3699-3737`) are a
VLAN's parent naming a declared entry, a bridge port naming a declared entry, a
bridge port carrying no addressing of its own, and no port claimed by two
bridges.

**A raw `PUT /api/v1/settings/network.<iface>` runs none of them.** The write
path is `SetSettings` → `Settings::set` → `Store::save`, and the setter at
`os/pkgs/mosd/mosd-settings/src/model.rs:721-754` validates exactly three
things: that the tree still deserializes, that `schema_version` is unchanged,
and that a newly-introduced `network` key is a legal interface name. The model
says so in its own doc comment — cross-field consistency *"is enforced in the
network reconciler"* (`os/pkgs/mosd/mosd-settings/src/model.rs:556-557`) — and
the reconciler's `validate_network`
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:454-495`) is where those four
rules actually live on the mosd side. But the reconciler runs *after* the save,
and its verdict is not propagated: `write_setting` records each reconciler
result and returns `Ok(())` regardless
(`os/pkgs/mosd/mosd/src/bus.rs:469-478`), because *"a failure is logged and
recorded as `{"error": "..."}`"* (`os/pkgs/mosd/mosd/src/bus.rs:495-496`).

So the concrete failure a bare passthrough produces: a client `PUT`s
`{"kind":"bridge","bridge":{"ports":["eth9"]}}` to
`/api/v1/settings/network.br0`, gets **204**, and the device's networking is
now broken with the only evidence in a later `GET /api/v1/state/network`. The
HTML pane refuses the same edit at the form with a sentence naming the port.
That is a **regression through the API relative to the pane**, and section 2.2's
"the difference is the quality of the error message, not whether a bad list can
be written" does not cover it, because here the difference is *when the operator
finds out* and *whether the box is still reachable*.

**Decision proposed: `network` gets a typed route, and the settings passthrough
under `network` is write-refused.** `PUT /api/v1/network/{iface}` and
`DELETE /api/v1/network/{iface}`, both running `validate_entries` against the
candidate tree exactly as the pane does, answering 422 with mosd's own message.
`PUT /api/v1/settings/network...` answers 409 `settings_read_only` and names the
typed route. This is the one place this design departs from section 2.2's
"the passthrough route must **not** be removed" rule
(`docs/design/api.md:1273-1275`), and the departure is argued, not assumed:
section 2.2's reason for keeping the passthrough is atomic whole-list
replacement, and `PUT /api/v1/network` (the whole map, validated) provides that
atomicity while the passthrough does not provide the validation. The cost is
named: a client that wants to flip one boolean on one interface now sends the
whole entry.

**(ii) `POST /setup` — an unauthenticated write that is not a settings write.**
It writes three subtrees in one request — `access.webAdmin`, then optionally
the hostname and one interface entry, at
`os/pkgs/mosd/apid/src/routes.rs:3912-3951` — and it is the only route the
gate lets through in setup mode
(`os/pkgs/mosd/apid/src/routes.rs:3310-3315`). It is not a settings write (three
paths), not a collection, and calling it an action understates that it is the
device's one unauthenticated write. It also has a partial-failure mode that is
already live: the password is written and the audit event recorded before the
hostname and network writes are attempted
(`os/pkgs/mosd/apid/src/routes.rs:3915-3951`), so a mosd failure halfway leaves
the device out of setup mode with no hostname. Proposal: its own route,
`POST /api/v1/setup`, `201` with the minted credential, `409` when already
configured, and the partial-failure behaviour **documented rather than fixed**
in M4 — fixing it means a transactional multi-path write on the bus, which is a
mosd change and belongs in its own milestone if it is wanted at all.

**(iii) `POST /builtin/deactivate` — an action whose object has no API resource
at all.** The bundle store is complete and route-less by decision
(`os/pkgs/mosd/apid/src/bundle.rs`), and section 2.3 records the two blockers.
Deactivation is the half that needs neither: it takes no upload, no archive
format, and no new authorisation beyond what `POST /api/v1/actions/poweroff`
already needs. But shipping deactivate without install gives the API a verb that
can turn a custom UI off and no verb that can turn it back on, which is a
worse asymmetry than not shipping it. Proposal: **defer, explicitly**, and
record the deferral where a reader of the inventory will see it — which is the
row this design adds, not the section 6 prose where it lives today.

### 2.4 "Identifier matches nothing": the collection shape's error contract

Folded in from a sibling workstream's measurement. The paragraph it comes from
is `docs/design/api.md`'s section 2.3 closing note, re-anchored at this HEAD to
`docs/design/api.md:1489-1493`: it records that `ssh_key_remove` answers 422
when the identifier matches nothing and argues that for a `DELETE` on a
collection resource *"that is a **404** — the identified item does not exist."*
(`docs/design/api.md:1492-1493`) That paragraph's own two citations are accurate
at this HEAD and were not re-anchored. This belongs here rather than in part
(a), because it is the collection shape's error contract and SSH keys are the
precedent every other collection route in section 2.4 below is modelled on.

**Measured at `6950f69`.** Every identifier-keyed operation in part 1's
inventory, and what it answers when the identifier names nothing:

| Operation | Identifier | Answer today | Produced at |
|---|---|---|---|
| `POST /ssh/keys/remove` | fingerprint **or** exact canonical key text | 422, HTML pane | `os/pkgs/mosd/apid/src/routes.rs:6861-6866` |
| `POST /network/peers/remove` | peer public key | 422, HTML pane | `os/pkgs/mosd/apid/src/routes.rs:5608-5614` |
| `POST /api/v1/actions/wireguard/{iface}/rotate-key` | `iface`, a path segment | **422 `settings_rejected`**, API envelope | `os/pkgs/mosd/mosd/src/bus.rs:884-888` → `os/pkgs/mosd/apid/src/routes.rs:3054-3057` |
| `POST /network/peers/add` | `iface` | **neither — it succeeds**; see below | `os/pkgs/mosd/apid/src/routes.rs:5319-5323` |
| `GET /api/v1/settings/{path}` | the dot-path | **404 `settings_not_found`** | `os/pkgs/mosd/apid/src/routes.rs:3046-3049` |
| `GET /api/v1/state/{path}` | the dot-path | **404 `settings_not_found`** | `os/pkgs/mosd/apid/src/routes.rs:3046-3049` |

Two things fall out of that table that the routed item does not anticipate.

**First: the 422 on the HTML rows is not a decision about not-found at all.** It
is the pane's single error shape for every cause. `network_error`'s whole
contract is *"Re-render the pane with `message` in an error box, at 422."*
(`os/pkgs/mosd/apid/src/routes.rs:5326`), and `ssh_error`
(`os/pkgs/mosd/apid/src/routes.rs:6079-6088`) is the same function for the SSH
pane. A malformed key, a duplicate peer and a missing identifier all reach it
and all come back 422. No code on either pane distinguishes them, so "the HTML
path answers 422 for not-found" is true only in the sense that it answers 422
for everything.

**Second, and this is the finding: the shipped API already answers both ways for
the same class of condition.** A settings read whose dot-path does not resolve
is a 404; a rotate-key whose interface is not a declared entry is a 422. Both
are "the thing you named does not exist", both are on `/api/v1/`, and they
disagree today. The cause is in mosd, not apid: `rotate_wireguard_key` collapses
two genuinely different conditions into one fdo error — *"network.{iface} is not
a WireGuard interface"* (`os/pkgs/mosd/mosd/src/bus.rs:871-873`), where the entry
exists and has the wrong kind, which really is a 422; and *"network.{iface} is
not a declared network entry"* (`os/pkgs/mosd/mosd/src/bus.rs:885-887`), which is
a 404. Both are `InvalidArgs`, and apid maps `InvalidArgs` onto
`StatusCode::UNPROCESSABLE_ENTITY` (`os/pkgs/mosd/apid/src/routes.rs:3054-3057`)
with no way to tell them apart. The published document does not declare 404 for
that route at all — its response set is 200, 401, 422, 500 and 503
(`os/pkgs/mosd/apid/openapi.json:256-348`). So the 422-where-404-is-meant pattern
is already **on the shipped API surface**, not only on the HTML forms.

### The rule, stated once

> **On any API collection or item route, an identifier that matches no item is
> 404**, in section 2.4's envelope with a `settings_not_found`-class code.
> **422 is reserved for an identifier that is malformed** — a fingerprint that
> is not a fingerprint, a public key that is not 32 bytes of base64. "Well-formed
> but absent" and "not well-formed" are different answers and must not share a
> status.

Every route it binds:

- `DELETE /api/v1/ssh/authorized-keys/{fingerprint}` — M5.
- `DELETE /api/v1/wifi/client/networks/{ssid}` — M5.
- `DELETE /api/v1/network/{iface}` — M6.
- `DELETE /api/v1/network/{iface}/peers/{publicKey}` — M6, and its `POST`
  sibling, whose `{iface}` is an identifier too.
- `POST /api/v1/actions/wireguard/{iface}/rotate-key` — **a correction to a
  shipped route, not a new one.** Discharging the rule here means splitting
  mosd's single `InvalidArgs` into a `NotFound` for the undeclared entry and an
  `InvalidArgs` for the wrong kind, which apid already maps to 404 and 422
  respectively (`os/pkgs/mosd/apid/src/routes.rs:3046-3057`) with no apid change
  at all. It is a mosd change plus an OpenAPI response addition, and it is
  additive to the document. Sequence it with M6, which is the milestone that
  already touches the network cluster.

### Does the HTML form path change? No — and here is the cost of that

**Recommendation: the HTML form path stays at 422; only the API answers 404.**
The design document already says *"The HTML path is not changed by this
document."* (`docs/design/api.md:1493`) This ratifies that, for three reasons it
does not give:

1. **The HTML path has no way to express 404 usefully.** Its response body is
   the re-rendered pane with an error box; a browser handed a 404 carrying a
   full HTML page renders it identically to a 422 carrying the same page. No
   consumer on that path reads the status — there is no client but a browser.
   Changing it buys a more correct number that nothing observes.
2. **The HTML condition really is different.** `ssh_key_remove` accepts a
   fingerprint **or** the exact canonical key text as its identifier
   (`os/pkgs/mosd/apid/src/routes.rs:6857-6860`), so a submitted string that
   matches nothing is as likely to be mistyped as absent — and the message says
   exactly that: *"The list may have changed since this page was loaded; reload
   it and try again."* (`os/pkgs/mosd/apid/src/routes.rs:6864`) That is a
   re-submit-the-form condition, which is what 422 means on a form post. On the
   API the identifier is a path segment with one interpretation: this URL names
   no resource.
3. **It is a shipped response on the surface that has the actual users.**

**The cost, named, because it is the real one and it is not small.** Two
behaviours for one underlying condition, in one file — and it is
`os/pkgs/mosd/apid/src/routes.rs`, where both surfaces' handlers live a few
hundred lines apart. The concrete failure mode is not that the split is wrong;
it is that the next collection route added copies whichever neighbour its author
happened to read first, and nothing catches it. Two mitigations, both cheap,
both in M5's scope, and both are the price of this recommendation rather than
optional polish:

1. **One helper, not per-handler.** The API's not-found answer is produced by a
   single shared function taking the resource path and the identifier, used by
   every item route. A new route then gets the rule by reaching for the shared
   function, not by remembering a decision.
2. **Two tests that name each other.** The HTML test asserts 422 and the API
   test asserts 404 **on the same condition**, and each carries a comment naming
   the other test and this section. The split is then documented at the two
   places somebody editing either surface would already be looking.

Weighed against the alternative — changing the shipped HTML status — this is the
cheaper side. The alternative costs a behaviour change on the surface with real
users to correct a number no consumer on that surface reads.

### The sweep over part 1's inventory

Asked for explicitly: does the same 422-where-404-is-meant pattern appear on any
other identifier-keyed operation? The table above is the complete sweep of the
41 rows — there are six identifier-keyed operations and no others. Three carry
the pattern (`POST /ssh/keys/remove`, `POST /network/peers/remove`,
`POST /api/v1/actions/wireguard/{iface}/rotate-key`), and two answer correctly
already (the settings and state reads). `POST /ssh/keys/add` and
`POST /network` take no identifier that can be absent — the first appends, the
second upserts.

The sixth is not the routed pattern and is worse, so it is reported here rather
than folded in silently.

**`POST /network/peers/add` naming an interface that does not exist answers
neither 422 nor 404. It succeeds, and it creates a broken entry.** The chain,
step by step: `stored_peers` returns an empty list rather than an error for an
unknown interface (`unwrap_or_default()`,
`os/pkgs/mosd/apid/src/routes.rs:5319-5323`); `write_peers` then validates and
writes straight to the peer list's own dot-path
(`os/pkgs/mosd/apid/src/routes.rs:5629-5632`); and the settings setter creates
missing intermediates by documented and tested behaviour — its own contract says
*"Missing intermediate map entries are created (e.g. setting
`network.eth1.dhcp` creates `eth1`)"*
(`os/pkgs/mosd/mosd-settings/src/model.rs:710-711`), and the committed test
`set_scalar_and_create_intermediate_entries`
(`os/pkgs/mosd/mosd-settings/tests/settings.rs:128-141`) proves that step on a
`network` key specifically. `validate_peers`
(`os/pkgs/mosd/apid/src/routes.rs:3690-3713`) checks each peer's public key,
allowed IPs and endpoint syntax, and never looks at the interface. So adding a
peer to `wg9` on a device that has no `wg9` writes a `network.wg9` entry of the
**default** kind — physical — carrying a WireGuard block, which the reconciler
rejects on the next apply with the failure recorded and not propagated, by
section 2.3's mechanism.

Stated honestly: that is a reading of the write path anchored on a committed
test of its one non-obvious step, not an observed run — no test exercises this
route with an undeclared interface today, which is itself the point. M6's
acceptance must add one. The typed route fixes it structurally rather than by a
guard: `POST /api/v1/network/{iface}/peers` on an undeclared interface is a 404
by the rule above, decided before anything is written.

### 2.5 The milestone split for M4+

One milestone per resource cluster, ordered so each is additive and independently
revertible. M2 (bearer tokens) and M3 (health, 405) are already fixed by
PLAN-023 and are not re-planned here.

**M4 — the scalar settings writes.** `PUT /api/v1/settings/<dot-path>` for
`hostname`, `access.ssh.enabled`, `container.enabled`, `mqtt.enabled`, plus the
`"<redacted>"`-body 422 rule section 2.2 requires
(`docs/design/api.md:1291-1294`) and a write-refusal list. Acceptance: a `PUT`
of a bare JSON string to `/api/v1/settings/hostname` returns 204 and
`GET /api/v1/state/hostname` shows the applied result; a `PUT` to
`/api/v1/settings/schema_version` returns 409 `settings_read_only`; a `PUT`
whose body contains `"<redacted>"` returns 422 and the stored value is
unchanged; a `PUT` under `network` returns 409 naming the M6 route; oasdiff
reports the change as additive.

**M5 — the two array collections that exist in the tree today.**
`GET`/`POST /api/v1/ssh/authorized-keys`,
`DELETE /api/v1/ssh/authorized-keys/{fingerprint}`;
`GET`/`POST /api/v1/wifi/client/networks`,
`DELETE /api/v1/wifi/client/networks/{ssid}`. Acceptance: section 2.4's rule holds on
both — a `DELETE` on an identifier that matches nothing returns **404**, not the
422 the HTML path gives (`os/pkgs/mosd/apid/src/routes.rs:6861-6866`), a
malformed identifier still returns 422, the not-found answer comes from the one
shared helper section 2.4 requires, and the paired HTML/API tests that name each
other both exist; every `POST` runs the same validator mosd runs; the
`notice` field carrying *"Every authorized key is a root key."*
(`os/pkgs/mosd/apid/src/routes.rs:5941`) is present on both the `GET` and the
`POST` response; a psk written through `POST /api/v1/wifi/client/networks` is
redacted on the next `GET`.

**M6 — the network cluster, typed.** `PUT`/`DELETE /api/v1/network/{iface}`,
`PUT /api/v1/network` (whole map), and the WireGuard peer collection
`GET`/`POST /api/v1/network/{iface}/peers`,
`DELETE /api/v1/network/{iface}/peers/{publicKey}`. Acceptance: the four
relational rules in `validate_entries` each have a route-level test that gets a
422 with mosd's message and leaves the stored tree unchanged; a `PUT` under
`/api/v1/settings/network` returns 409; a peer `DELETE` on an unknown public
key returns 404 and a `POST`/`DELETE` naming an undeclared interface returns 404
before anything is written (section 2.4's sweep); mosd's rotate-key
`InvalidArgs` is split so an undeclared entry becomes a `NotFound` and the
route's 404 is added to the published document; an interface name containing a
`.` round-trips through the quoted
path segment (`os/pkgs/mosd/apid/src/routes.rs:3492-3494`).

**M7 — the actions.** `POST /api/v1/actions/reboot`, `.../poweroff`,
`.../transient-root-password`. Acceptance: reboot and poweroff answer **202**
before the bus call completes, matching the form path
(`os/pkgs/mosd/apid/src/routes.rs:5820-5905`); no `GET` handler is declared for
any of the three; the transient-password route enforces the same byte bounds as the form path's validator at
`os/pkgs/mosd/apid/src/routes.rs:6680-6695`, and
its rejection message never echoes the password; the constant confirmation token
is **not** required, per section 2.3's decision.

**M8 — `POST /api/v1/setup`.** Last, because it is the only unauthenticated
write and it depends on M2 having decided what a minted credential looks like.
Acceptance: 201 carrying the credential; 409 when `access.webAdmin` already has
a hash; 422 on a hostname or interface the wizard's own validators reject, with
**nothing written** — which is a real change from the form path, and is the one
behaviour this milestone is allowed to fix rather than document.

**Scheduled but not owned by the API milestones alone:** the rotate-key 404
correction in section 2.4 needs a one-error-name change in mosd. It is named in
M6 rather than left implicit, because an apid-only milestone cannot discharge
it.

**Not planned, deliberately:** `POST /builtin/deactivate` (2.3 item iii),
`mqtt.listen` and `mqtt.auth` (in the model at
`os/pkgs/mosd/mosd-settings/src/model.rs:100-102` with no pane and no route on
either surface — an API write there would be the first, and it opens a broker
to a network), and `access.device` / `provisioning`, which are written by
first-boot provisioning and not by an operator.

## 3. Token revocation on password change

### 3.1 The three statements, measured at `6950f69`

**(1) Section 2.3 parks the question.** Its password bullet ends:
*"The token question this bullet parked is still §3.2's: no tokens ship yet, so
there is nothing to revoke."* (`docs/design/api.md:1466-1467`)

**(2) Section 3.2 decides it, the other way, as a property with an
obligation.** *"**Changing the admin password does not revoke any token.** That
is deliberate"* (`docs/design/api.md:2132-2133`), with the reason
*"a human rotating their own password must not break every script"*
(`docs/design/api.md:2133-2134`) and the obligation
*"The UI's password pane has to say so."* (`docs/design/api.md:2134-2135`) Section 9
treats it as settled and reasons from it
(`docs/design/api.md:4489`).

**(3) The shipped code already revokes the adjacent thing.** The
`change_password` helper ends with
`.remove_all_except(acting_session.unwrap_or(""));`
(`os/pkgs/mosd/apid/src/routes.rs:4491`), and `SessionStore` documents the
rule: *"Drop every session except the one named by `value`."*
(`os/pkgs/mosd/apid/src/session.rs:90`) with the reason
*"every other session was minted under the old credential"*
(`os/pkgs/mosd/apid/src/session.rs:92-93`). The pane already states it:
*"Changing the admin password signs every other session out."*
(`os/pkgs/mosd/apid/src/routes.rs:4514`)

### 3.2 The conflict, stated precisely

It is not (2) versus (3) — sessions and tokens are different credentials and
nothing forces them to share a lifecycle. The conflict is **(1) versus (2)**:
one section of the design of record says the question is open and the other says
it is decided, and PLAN-023 M2 is scheduled to implement section 3.2 as
written. An implementer reading 3.2 will ship "no revocation"; a reviewer
reading 2.3 will ask why an open question was closed without a decision. Left
alone, the document decides by whichever section the implementer reads first.

There is also a second-order inconsistency that (3) creates for (2)'s stated
reason. Section 3.2's justification is *"a human rotating their own password
must not break every script"*. But the shipped behaviour **already breaks every
other browser** on the same event, on the reasoning that a credential minted
under the old password proves nothing now. The two credentials are given
opposite treatment from arguments that would each apply to the other: a script
is as inconvenienced by a dead token as a second browser tab is by a dead
session, and a stolen session is exactly as dangerous as a stolen token
(section 3.2: *"A token can do everything the operator can do over the API."*,
`docs/design/api.md:2130-2131`). Whichever way this resolves, the asymmetry has
to be argued rather than inherited.

### 3.3 Recommendation

**Keep section 3.2's semantics — a password change does not revoke tokens — and
close section 2.3's open question by pointing at it. Add one thing section 3.2
does not have: the password pane must say it, in the pane, and PLAN-023 M2's
acceptance must include that sentence.**

The reason to keep it is not the convenience argument, which is weak; it is that
the alternative is a **silent, unbounded** action. Revoking on password change
would destroy N credentials the operator cannot see at the moment they act — the
password pane does not list tokens and cannot, since it is a different resource
— with no confirmation, no count, and no undo, because tokens are shown once at
mint and never again (section 3.2: *"never the hash, never the plaintext"*,
`docs/design/api.md:2083`). An operator doing routine hygiene would silently
kill production automation. Sessions are different in exactly the way that
matters: a dead session costs a re-login, and the operator holds the credential
that fixes it.

The cost of keeping it, stated plainly: **"I changed my password" is not a
containment action**, and that is section 3.2's own wording
(`docs/design/api.md:2134-2135`).

**What an operator who believes a password change contains a breach actually has
to do.** Six steps, in this order, and every one of them is a separate
operation:

1. Change the admin password. This drops every other **session**
   (`os/pkgs/mosd/apid/src/routes.rs:4489-4491`) and no token.
2. `GET /api/v1/tokens`, then `DELETE /api/v1/tokens/{id}` **for every id
   returned** — including ones they do not recognise, which is the point.
   Revocation takes effect on the next request (`docs/design/api.md:2084-2086`).
   Neither route exists yet; M2 ships them.
3. `GET /api/v1/settings/access.ssh` and remove every authorized key that is not
   theirs. Every key is a root key
   (`os/pkgs/mosd/apid/src/routes.rs:5941`), so a password rotation that skips
   this step contains nothing.
4. Reboot, or otherwise clear a transient root password. It is not in the
   settings tree and no read will show it; it *"lives until the next boot"*
   (`os/pkgs/mosd/mosd/src/bus.rs:814-815`).
5. Check `/srv/ui/current`. Section 7.4 already requires this of any revocation
   runbook, because a bundle installed with a stolen credential survives the
   credential's revocation and survives an A/B update
   (`docs/design/api.md:3681-3689`).
6. Accept that step 2's list is the only inventory that exists. Nothing on the
   device records which credential served which request — section 3.3 records
   that absence — so "was this token used?" is unanswerable.

**What the password pane must therefore say.** The pane today says one sentence
(`os/pkgs/mosd/apid/src/routes.rs:4514`). It needs a second, and this is the
proposed text for M2 to ship and for M2's acceptance to assert verbatim:

> API tokens are not affected. Changing this password signs other browsers out,
> but every API token keeps working. If you are changing this password because
> you think someone else has access, revoke your API tokens as well, and check
> the SSH authorized keys — every one of them is a root key.

That sentence is the whole obligation section 3.2 states and never assigns to a
milestone. Assigning it here is the substantive part of this decision; the
"do not revoke" half is a ratification of what is already written.

## 4. Key custody — a decision memo for the user

`docs/task/RFCT-139.md` closed by recording this as unresolved:
*"The key-custody and rotation decision — who signs, who holds the CA, which
channel delivers the keyring — is recorded as the user's open product decision,
not resolved here."* (`docs/task/RFCT-139.md:36-38`) This section presents the
options. It does not pick one, and where a reader might mistake an engineering
constraint for a recommendation, the constraint is labelled.

### 4.1 What the tree actually has

**Two key hierarchies, both build-host only, neither trusted by any shipped
device.**

*RAUC's CMS bundle signature.* Material is generated by
`os/pkgs/rauc/gen-dev-keys.sh`, which is explicit about what it is:
*"Generates the DEVELOPMENT-ONLY CMS signing material RAUC bundles are signed
with"* (`os/pkgs/rauc/gen-dev-keys.sh:2-3`), into a gitignored directory,
because *"A committed signing key would make every device in the fleet trust
anything anyone builds."* (`os/pkgs/rauc/gen-dev-keys.sh:9-10`) On device,
verification reads `path=/etc/rauc/keyring.pem`
(`os/pkgs/rauc/system.conf.in:102`), and that file is deliberately absent:
*"until one is installed, `rauc install` on device fails closed."*
(`os/pkgs/rauc/system.conf.in:82-83`)

*The TUF repository (`os/pkgs/rauc-sign`).* Four ed25519 roles
(`os/pkgs/rauc-sign/src/keys.rs:18`), stored as PKCS#8 files mode 0600
(`os/pkgs/rauc-sign/src/keys.rs:34-35`), with `root` held offline —
*"the root key is an offline key and is only needed by `init`"*
(`os/pkgs/rauc-sign/src/keys.rs:22-23`). The device-side verifier now exists:
*"It exists and is exercised offline by the test suite; nothing ships it to a
device yet"* (`os/pkgs/rauc-sign/README.md:11-12`).

**What is already decided and is not the user's to re-open.** The ceremony and
the expiry horizons are written down and are engineering, not product:
`root` 1 year, `targets` 6 months, `snapshot` 3 months, `timestamp` 2 weeks
(`docs/design/release-signing.md:104-109`); the root key goes to
*"**two or more** offline media"* in *"separate physical locations"*
(`docs/design/release-signing.md:126-129`); the online keys live on the release
host at mode 0600 (`docs/design/release-signing.md:136-138`).

**What is missing and constrains every option below.** Root rotation is not
implemented: *"`rauc-sign` has no command that produces such a file"*
(`docs/design/release-signing.md:149-150`), and the consequence is stated
without hedging — *"a compromised online key ends the repository's lineage"*
(`docs/design/release-signing.md:154-155`). The annual root refresh is blocked on
the same absence, and *"the 1-year horizon in §1.4 is the deadline for building
it"* (`docs/design/release-signing.md:167-168`). Separately, there is no channel
that puts any anchor on a device: *"No such bind exists yet,
deliberately"* (`docs/design/release-signing.md:291-292`).

**One thing that is not in scope of this memo, and should not be confused with
it.** `docs/design/api.md` section 7.4 already recommends **not** signing UI
bundles in phase 1 (`docs/design/api.md:3644-3647`), and this memo does not
reopen that. What follows is about the **release** signing keys — the ones that
authorise a kernel and rootfs replacement.

### 4.2 The options

Each is stated as: who holds the private root, where it physically lives, the
rotation cadence, the cost, what it forecloses, and what happens if the key is
lost.

**Option A — vendor-held, offline, single root.** The project (or the
appliance's vendor) generates the TUF root and the RAUC CA once, per
`docs/design/release-signing.md` sections 1.1-1.5, and holds both. Devices ship
with the anchor baked in at factory provisioning.

- *Where it lives:* two or more sealed offline media in separate physical
  locations, with the written custody record section 1.5 requires.
- *Cadence:* root re-signed annually at expiry; online keys rotated on the
  release host at each release.
- *Cost:* one ceremony, then a recurring annual event that **currently has no
  tooling** — the annual refresh is blocked on the missing rotation command.
  Someone must build that command before the first anniversary of the ceremony,
  or the repository expires.
- *Forecloses:* customers signing their own images. Any customer who wants to
  ship modified firmware has to route it through the vendor, which makes the
  vendor an approval bottleneck and a release dependency for every customer.
- *If lost:* every fielded device is permanently un-updatable by any
  mechanism this repository has. Recovery is physical: a factory re-flash, or a
  new anchor delivered by whatever out-of-band channel exists — and none does.
  This is the option where key loss is a fleet-wide, unrecoverable event.

**Option B — per-customer roots, vendor holds none.** Each customer runs the
ceremony for their own fleet. The vendor ships an unanchored image and a
documented provisioning step; the customer's anchor is installed at their
factory step or first-boot enrolment.

- *Where it lives:* the customer's premises, to the customer's standard. The
  vendor cannot enforce section 1.5's two-media rule and should not claim to.
- *Cadence:* the customer's; the vendor publishes the horizons as a
  recommendation.
- *Cost:* the provisioning channel must be built and must be customer-operable,
  which is strictly more work than option A's factory step. The vendor also
  loses the ability to ship a fleet-wide security update, because it cannot sign
  for anyone.
- *Forecloses:* vendor-pushed updates entirely, and with them any support model
  that promises them. It also forecloses a shared update mirror, since each
  customer's metadata is signed by a different root.
- *If lost:* one customer's fleet is un-updatable. Blast radius is bounded,
  which is this option's real argument, and the vendor cannot help them recover
  because the vendor never had the key.

**Option C — vendor root, delegated per-customer targets.** TUF's delegation
model: the vendor holds the root and delegates a targets role per customer, so
customers sign their own images against a chain that ends at the vendor's
anchor.

- *Where it lives:* vendor root offline as in A; per-customer delegated keys with
  the customer.
- *Cadence:* as A for the root; per-customer keys rotate independently, which is
  the point of delegation.
- *Cost:* **not implementable today.** `os/pkgs/rauc-sign` names delegated
  targets roles in the same out-of-scope list as root rotation
  (`os/pkgs/rauc-sign/README.md:43-46`), and *"the signer cannot yet produce a
  rotation, so the chain is depth one in practice"*
  (`os/pkgs/rauc-sign/README.md:46-47`). Choosing C is choosing to fund that
  work first. This is an engineering constraint, stated as one: it is not an
  argument against C, it is a schedule fact about C.
- *Forecloses:* the least of the three. It preserves both vendor-pushed updates
  and customer self-signing.
- *If lost:* losing the vendor root is option A's outcome. Losing one delegated
  key affects one customer and **is** recoverable — the vendor re-delegates —
  which is the property neither A nor B has.

**Option D — hardware-backed root (HSM or smartcard), under A or C.** An
orthogonal choice about storage, not about who holds the key.

- *Where it lives:* a token in a safe, rather than PKCS#8 files on offline media.
- *Cost:* hardware, a second unit for backup, and a code change:
  `os/pkgs/rauc-sign/src/keys.rs` reads and writes raw PKCS#8 files
  (`os/pkgs/rauc-sign/src/keys.rs:3-5`), and hardware-backed key stores are named
  out of scope alongside rotation (`os/pkgs/rauc-sign/README.md:43-46`).
- *Forecloses:* the paper backup section 1.5 currently allows —
  *"paper backup of the base64 PKCS#8 is a legitimate third copy"*
  (`docs/design/release-signing.md:126-127`) — which is the cheapest disaster
  recovery the current design has.
- *If lost:* the same as whichever of A or C it sits under, except that a
  destroyed token with no backup token is unrecoverable in a way a wiped disk
  with a paper backup is not. Hardware backing reduces theft risk and increases
  loss risk; that trade is the whole decision.

### 4.3 What the project cannot decide for itself

Three things, and they are not engineering questions with hidden right answers:

1. **Who the signer is.** This follows from the business model — vendor-operated
   fleet, customer-operated fleet, or both — and nothing in this repository
   determines it. Options A, B and C are that choice.
2. **What physical custody standard applies.** Section 1.5 specifies a procedure;
   whether the organisation executing it has a safe, a second site, and a person
   accountable for the custody record is a fact about the organisation.
3. **What loss is acceptable.** Every option's failure mode is "some set of
   devices can never be updated again". Which set, and whether that is survivable,
   is a risk the device's owner accepts and the repository cannot.

### 4.4 What the project can and should decide, whichever option is chosen

Independent of the choice above, and stated separately so it is not read as
part of it: **root rotation tooling must be built before the first ceremony's
one-year expiry.** Every option needs it — A and B for the annual refresh, C for
delegation, D for token replacement — and the design document already identifies
the deadline (`docs/design/release-signing.md:167-168`). Deciding custody without
scheduling that work produces a key that cannot be rotated, which turns option
A's fleet-wide failure mode into a certainty on a one-year timer rather than a
risk.

## 5. Scope and gates

Section 2.4 was folded in after the first pass, routed from a sibling
workstream; its citations were measured at the same HEAD as everything else and
the `docs/design/api.md:1489-1493` anchor was re-derived rather than trusted.

This task wrote `docs/task/RFCT-210.md`, one row in `docs/task/index.md`, and
one ceiling row in `docs/verify-citations-unquoted-baseline.txt` (the update
procedure the checker's header states: *"when a new unquoted citation is
genuinely wanted, raising the row in the same commit is the explicit, reviewable
override"*, `docs/verify-citations.sh:109-111`). Nothing under `os/`,
`docs/design/`, `docs/plan/`, `test/` or `.github/` was touched: this milestone
is design, and two sibling tasks are editing `os/pkgs/mosd/**` concurrently.

No Rust gate applies — no Rust changed. The two docs gates were run at HEAD and
their output is recorded in this task's completion report.
