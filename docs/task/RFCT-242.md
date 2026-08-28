# RFCT-242 PLAN-023 M6: the network cluster typed, WireGuard peers, rotate-key 404

- **status**: completed — the six network routes ship with a route-level test per relational rule, the RFCT-210 peer-add finding is confirmed by a run and fixed with a 404 before any write, mosd's rotate-key error is split so an undeclared entry is 404 with no apid change, the WiFi psk bound is lifted into `mosd-settings`, and the ruled duplicate-409 clause is applied to all three collections; 812/812, 1559/1559 citations, 780/780 index, oasdiff RC=0 against both bases
- **completedAt**: 2026-08-28
- **priority**: P1
- **owner**: bkd/36tblhgs
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (M6)

The network cluster, given typed routes rather than a raw dot-path passthrough.
`docs/task/RFCT-210.md` section 2.3 item (i) is the design of record and its M6
acceptance is what this discharges; section 2.4's collection error contract is
inherited through the shared helper rather than restated.

Three items were routed into this milestone and none was optional: the
rotate-key 404 correction, which is a **mosd** change; the peer-add finding,
which is settled here by running it; and the WiFi pre-shared-key bounds, lifted
out of a private rendering function. A fourth arrived mid-review: the
duplicate-status question this task was told to flag was **ruled**, and the
ruling is applied here across every collection rather than deferred. All four
are below.

Nothing else moves. The actions are M7, `POST /api/v1/setup` is M8, the cookie
cutover is M9.

## 1. What ships

Six operations on the network cluster, plus one corrected answer on a shipped
route.

| Route | Answers |
|---|---|
| `PUT /api/v1/network` | 204 the whole map replaced; 422 a key that is not an interface name, a body that is not a map of interfaces, or a relational rule |
| `PUT /api/v1/network/{iface}` | 204 declared or replaced; 422 a bad name, a bad body, or a relational rule. **No 404** — this route creates the entry it names |
| `DELETE /api/v1/network/{iface}` | 204; **404** unmatched; 422 a bad name, or a relational rule the removal would break |
| `GET /api/v1/network/{iface}/peers` | 200 the stored peers; **404** an undeclared interface; 422 an entry that is not a tunnel |
| `POST /api/v1/network/{iface}/peers` | 201 the peer; **404** an undeclared interface, before anything is written; **409** a duplicate public key; 422 a peer the reconciler would refuse |
| `DELETE /api/v1/network/{iface}/peers/{publicKey}` | 204; **404** an unmatched key or an undeclared interface; 422 a key that is not a WireGuard key |
| `POST /api/v1/actions/wireguard/{iface}/rotate-key` | **404** added: an undeclared entry. 422 now means only "exists and is not a tunnel" |

All take `ApiSession` — bearer **or** cookie. PLAN-023 Amendment 1's bearer-only
ruling is about the token routes specifically, the credential factory, and not
about new routes in general, so these are dual-credential exactly as M5's
collections and the shipped reads are.

There is no `GET` on the map or on one interface. The read already exists at
`GET /api/v1/settings/network`, and a documented route nothing serves is a
contract with no implementation; `the_openapi_document_covers_the_network_cluster`
asserts both absences.

## 2. Why this cluster is typed rather than a dot-path write

Re-measured at this HEAD rather than relayed. Four facts, and together they are
the whole argument:

1. **The rules are relational.** `validate_entries`
   (`os/pkgs/mosd/apid/src/routes.rs:3727-3767`) enforces four: a VLAN's parent
   must name a declared entry, a bridge port must name a declared entry, a
   bridge port must carry no addressing of its own, and no port may be claimed
   by two bridges. Its own comment says why it must run over the tree and not
   the entry — *"every rule here is about two entries at once"*
   (`os/pkgs/mosd/apid/src/routes.rs:3723-3726`). The pane already runs it over
   *"The candidate tree, not the one entry"*
   (`os/pkgs/mosd/apid/src/routes.rs:5538-5544`).
2. **mosd's own copy is in the reconciler**, `validate_network`
   (`os/pkgs/mosd/mosd/src/reconciler/network.rs:454-499`), which is the
   boundary for a settings file anything with STATE write access can edit.
3. **The settings setter runs none of them.** `Settings::set` validates by
   deserializing the candidate tree and nothing more —
   `serde_json::from_value(root)`
   (`os/pkgs/mosd/mosd-settings/src/model.rs:732-736`), and the model says so in
   its own words: cross-field consistency *"is enforced in the network
   reconciler"* (`os/pkgs/mosd/mosd-settings/src/model.rs:556-557`).
4. **The reconciler's verdict does not reach the caller.** `write_setting`
   returns `Ok(())` whatever the reconcilers said, having only recorded them:
   `record(&mut inner.state, reconciler.name(), result);`
   (`os/pkgs/mosd/mosd/src/bus.rs:469-478`).

So a bare passthrough answers **204** to a bridge naming a port that does not
exist and leaves the device's networking broken with the only evidence in a
later state read. That is the failure section 2.3 names, and it is why this is
the one place the design departs from section 2.2's "the passthrough must not be
removed" rule. The departure is paid for rather than assumed: section 2.2 kept
the passthrough for atomic whole-list replacement, and `PUT /api/v1/network`
provides that atomicity **and** the validation the passthrough does not.
`the_whole_map_put_replaces_atomically_and_validates_relationally` drives both
halves, including the case the item route cannot express at all — a bridge and
its port declared in one body, where sending the bridge first is refused.

**The cost, named.** A `PUT` replaces the entry entirely, including a tunnel's
peer list. The pane carries stored peers across a save because a form posts the
fields it renders; a client that built a JSON body said exactly what it meant.
That is section 2.3's *"a client that wants to flip one boolean on one interface
now sends the whole entry"*, and the peer collection is what keeps the common
edit off that path.

### The four rules, one route-level test each

Acceptance asked for one test per rule, each getting a 422 carrying mosd's own
message and each leaving the stored tree unchanged. Four tests, and every one of
them asserts all three:

| Test | Rule | Message asserted |
|---|---|---|
| `a_vlan_parent_that_is_not_declared_is_422_and_writes_nothing` | VLAN parent | *"has VLAN parent \"eth9\", which is not a declared network entry"* |
| `a_bridge_port_that_is_not_declared_is_422_and_writes_nothing` | bridge port declared | *"has bridge port \"eth9\", which is not a declared network entry"* |
| `a_bridge_port_that_carries_addressing_is_422_and_writes_nothing` | port carries no addressing | *"network.eth1 is a port of bridge br0 and must not carry addressing of its own"* |
| `a_port_claimed_by_two_bridges_is_422_and_writes_nothing` | one claim per port | *"is claimed as a port by both bridge"* |

The third is the one no entry-scoped check could ever produce: what is refused
is an edit to `eth1`, and what refuses it is `br0`, a different entry.

A fifth, `removing_a_port_a_bridge_still_lists_is_refused`, holds the other
direction — the `DELETE` re-validates the map it leaves behind, so removing a
port a bridge still names is refused with the rule's own sentence and nothing is
written. It then removes the bridge first and shows the port becomes removable,
which is the order the message asks for.

### The 409 refusal, verified and not duplicated

M4 already refuses `PUT /api/v1/settings/network...` at 409 `settings_read_only`.
This milestone did not re-implement it;
`the_settings_passthrough_under_network_is_409_and_names_the_typed_route` drives
three spellings of the path and asserts the message names `/api/v1/network`.
The refusal's sentence was updated in place — it previously ended *"which this
build does not serve yet"*, which this build no longer makes true — and it still
carries the exact substring M4's own test pins,
`PUT /api/v1/network/{iface}`.

## 3. (a) The rotate-key 422 → 404 correction, in mosd

**The whole change is in mosd, and no apid logic moved.** `rotate_wireguard_key`
collapsed two genuinely different conditions into one `InvalidArgs`: an entry
that exists with the wrong kind, which really is a 422, and a name that is not a
declared `network` entry, which is a 404 everywhere else on this API. It now
raises `SettingsFault::NotFound` for
*"network.{iface} is not a declared network entry"*
(`os/pkgs/mosd/mosd/src/bus.rs:884-888`) and keeps `InvalidArgs` for
*"network.{iface} is not a WireGuard interface"*
(`os/pkgs/mosd/mosd/src/bus.rs:871-873`), which meant changing its return type
from `fdo::Result<String>` to `Result<String, SettingsFault>` — the same error
type `GetSettings` and `SetSettings` already return.

apid's classifier already mapped both names — `com.mos.mosd1.Error.NotFound` to
404 `settings_not_found` and `InvalidArgs` to
`ApiError::mosd("settings_rejected", message)`
(`os/pkgs/mosd/apid/src/routes.rs:3046-3057`) — and had only ever been handed
one of them. Two tests prove each half separately, which is what makes "no apid
change" a measurement rather than a claim:

- `a_rotation_refuses_an_interface_that_is_not_a_tunnel` (mosd) asserts the
  **error name** each refusal travels under, not only its text.
- `the_rotate_routes_failures_take_the_shared_envelope` (apid) gained one row —
  `com.mos.mosd1.Error.NotFound` → 404 `settings_not_found` — and needed no
  production change to pass it.

The published document gained the 404 and its 422 description narrowed to the
one condition it now means. Both are additive; oasdiff rates the whole change
non-breaking against both bases.

## 4. (b) The peer-add finding: **confirmed**, by running it

`docs/task/RFCT-210.md` section 2.4 recorded, explicitly as a reading of the
write path and **not** as an observed run, that `POST /network/peers/add` naming
an interface that does not exist succeeds and writes a broken entry. Amendment 1
routed the test that settles it into this milestone. The test was written first,
before any route was added, and run on its own.

**The reading was right.** `the_pane_peer_add_writes_a_broken_entry_for_an_undeclared_interface`
posts a peer to `wg9` on a tree that has no `wg9` and asserts what actually
happens:

- the status is **303**, the redirect a successful save gives — not 422, not 404;
- the write goes to `network.wg9.wireguard.peers`;
- the resulting `network.wg9` has **no `kind`**, so it is physical by default,
  and carries a WireGuard block.

Run alone at the commit that introduced it, before any other M6 code existed:

```
    Starting 1 test across 2 binaries (302 tests skipped)
        PASS [   1.135s] (1/1) apid::bin/apid tests::the_pane_peer_add_writes_a_broken_entry_for_an_undeclared_interface
     Summary [   1.136s] 1 test run: 1 passed, 302 skipped
```

Every step of the chain the design named is therefore real: `stored_peers`
answers an empty list rather than an error for an unknown interface, by
`unwrap_or_default()` (`os/pkgs/mosd/apid/src/routes.rs:5316-5323`);
`write_peers` writes straight to the peer list's own dot-path,
`.set_settings(&peers_settings_path(iface), &value)`
(`os/pkgs/mosd/apid/src/routes.rs:5629-5632`); `validate_peers` never looks at
the interface, only at
`for (index, peer) in peers.iter().enumerate()`
(`os/pkgs/mosd/apid/src/routes.rs:3690-3713`); and the setter creates them by
documented contract — *"Missing intermediate map entries are created"*
(`os/pkgs/mosd/mosd-settings/src/model.rs:710-712`).

**The pane is left as it is, and the typed route fixes it structurally.**
`the_api_peer_add_refuses_an_undeclared_interface_where_the_pane_writes_one` is
the pair: the API answers **404 before anything is written**, `set_paths()` is
empty, and no `network.wg9` appears. The two tests name each other, so the split
cannot be read as drift. It is a guard by construction and not by inspection —
the interface has to be read anyway, to know whether it is a tunnel and what
peers it already has, so there is no branch that could forget it.

The same read gives the collection its three answers about `{iface}`, and none
is interchangeable: **404** when no entry has the name, **422** when the entry
exists and is not of kind `wireguard`
(`peers_on_an_interface_that_is_not_a_tunnel_are_422`), and **422** when the
name is not an interface name at all. The middle one is the same split the
rotate-key correction above makes, applied to the same question.

## 5. (c) The WiFi psk bounds, lifted

M5 shipped `POST /api/v1/wifi/client/networks` unable to validate the
passphrase: the 8..63-character bound lived inside `encode_psk`, a private
function of the `mosd` binary crate's station reconciler, and apid depends on
`mosd-settings`. A key outside the range was accepted, stored, and refused later
by the renderer with the error visible only in live state.

**The fix is the lift, not a second copy.** The rule now lives beside the typed
model as `pub fn validate_wifi_psk(psk: &str) -> Result<(), String> {`
(`os/pkgs/mosd/mosd-settings/src/model.rs:449-460`), the
reconciler calls it rather than restating it —
`mosd_settings::validate_wifi_psk(psk).map_err(|message| anyhow!(message))?;`
(`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:238-247`) — and the WiFi route
runs the same function at the place it already produces its 422,
`ApiError::apid("validation_failed", message).at(WIFI_NETWORKS_PATH)`
(`os/pkgs/mosd/apid/src/routes.rs:2226-2233`). The three local constants were
deleted from the reconciler; there is exactly one rule.

**It is deliberately not enforced in `WifiNetwork`'s `Deserialize`**, and that is
a measurement rather than a shortcut. `Settings::set` validates by deserializing
the whole candidate tree and `Store::load` loads by deserializing it, so a bound
enforced there would turn one out-of-range key already on disk — which M5's
shipped route accepts today — into a device whose **every unrelated settings
write fails** and whose settings file may not load at all. The bound is a rule
about a value being written, and it is checked where a write is decided. The
function's own doc comment records this.

**Behaviour-preservation is held by the golden-file tests that were already
there**, untouched: `multi_network_render_matches_the_golden_file` and
`apply_writes_the_golden_config_at_0600_creating_its_directory` still compare the
rendered bytes against `GOLDEN_MULTI`, so a lift that changed what an admissible
key renders to would fail them. One test was added for the half a golden file
cannot state — that no input exists for which the two sides disagree:
`the_lifted_psk_bound_is_the_one_the_renderer_enforces` walks a table of eight
keys asserting `encode_psk(psk).is_ok() == validate_wifi_psk(psk).is_ok()`, then
asserts the sentence is byte-identical from either side and still never names
the length observed. `a_passphrase_outside_wpa2_bounds_is_rejected` was left
exactly as M5 shipped it.

`a_psk_outside_the_lifted_bounds_is_refused_by_the_wifi_route` is the route-level
half: 422 for seven characters and for sixty-four non-hex ones, nothing written,
the message never echoing the key, and 201 for both admissible shapes — a
passphrase in range and a 64-digit hex PMK, which the bound does not apply to.

**What the lift does not close, named.** `is_quotable` stays in the renderer: it
is a rule about what a wpa_supplicant configuration string can carry, not about
what the model admits, so a `psk` containing a quote or a backslash is still
accepted by the route and refused at render time. Lifting it too would have been
a second, unasked-for change to the same crate; it is recorded here rather than
done quietly.

## 6. The duplicate clause, ruled and applied everywhere

The question this milestone was told to flag rather than settle **was ruled
while the work was in review**, and the ruling is applied here rather than
deferred to a follow-up. The ratified collection error contract now has three
clauses, not two:

> An identifier that names **no item** is **404**; a **malformed** identifier is
> **422**; and an identifier that **duplicates** one the collection already
> holds is **409**, with a per-collection code.

The reasoning, so the clause can be applied rather than pattern-matched: a
duplicate is a conflict with the collection's **current state**, and that is
what 409 means. The body is well formed and nothing about it is wrong. It is the
same condition `settings_read_only` already spends 409 on.

The clause is recorded in `docs/design/api.md` section 2.4's code table,
alongside the two clauses that were already there and the codes M3 added. It is
**not** written into `docs/task/RFCT-210.md`: that is a completed record and
`docs/task` is history.

### What the ruling changed in this milestone

**The peer collection was already right.** It shipped 409 `peer_exists` before
the ruling arrived, argued from the WiFi precedent; the argument is now the rule,
and the route's comment says so instead of weighing two precedents.

**M5's SSH route was harmonised: duplicate 422 → 409 `key_exists`.** This was
routed here rather than reopening M5, for the reason the serial chain exists: a
concurrent fix would have put two tasks in `routes.rs` at once, and this task
would have inherited the merge anyway.

M5 answered 422 because the duplicate check lives inside
`validate_authorized_keys` and the two ways out were exporting a private
constant or matching the validator's words. The ruling picks the export.
`MAX_KEYS` is now `pub`
(`os/pkgs/mosd/mosd-settings/src/authorized_key.rs:46`), joining `MAX_TOKENS`,
and **the route decides both of its 409s itself, before the shared validator
runs**:

- a duplicate is compared structurally against the stored list, on the canonical
  `key` text and not the submitted line — the identity `validate_authorized_keys`
  itself uses, and the identity the model's own doc comment defends: *"the
  canonical key text is what duplicate detection runs on"*
  (`os/pkgs/mosd/mosd-settings/src/model.rs:242-245`);
- the 32-key cap is read from the exported bound, exactly as the token mint
  reads `MAX_TOKENS`, and answers 409 `key_limit_reached`.

**No message is string-matched to infer a duplicate**, which the ruling forbids
and which would in any case be a parser for prose:
`validate_authorized_keys` raises a duplicate, an over-long list and a malformed
entry as one `Validation` error, the condition its own doc comment lists in one
breath — *"the list is too long, an entry does not re-parse"*
(`os/pkgs/mosd/mosd-settings/src/authorized_key.rs:126-166`). It still runs on
the rewritten list and still refuses all three — it has to, because the settings
file is writable without apid and the reconciler is the boundary. What changed
is which of the two answers *first*, not whether the rule exists in one place.

### The amended assertion, named so nobody reads it as a weakening

`a_duplicate_key_is_refused_by_the_shared_validator` asserted 422. It is now
`a_duplicate_key_is_409_and_the_stored_list_is_unchanged` and asserts 409
`key_exists`. **That is a correction, and the assertion is stronger than the one
it replaces, not looser.** Under M5 one status covered two conditions — a
malformed key and a duplicate were both 422, and no client could tell them
apart. The amended test asserts both halves in one body: 409 `key_exists` for
the duplicate **and** 422 `validation_failed` for a malformed key, which is the
distinction the third clause buys. It also asserts the message is not the
validator's, so the answer cannot silently regress to being recovered from
prose.

Two tests were added beside it: `a_full_key_list_is_409_and_names_the_bound` for
the exported cap, and `every_collection_answers_409_for_a_duplicate`, which
drives all three collections in one router and asserts 409 with a distinct
per-collection code on each. That last one is the mechanism that keeps the
clause: three separate tests would each keep passing while the collections
drifted apart, which is exactly how the two answers diverged in the first place.

### No wire cost, confirmed rather than assumed

Nothing has merged to main, so main's base spec has none of these routes — and
that was measured here rather than taken on trust: main's `openapi.json` carries
six paths, and `/api/v1/ssh/authorized-keys` is not among them. oasdiff stays
**RC=0 against both bases**. Against this branch's pre-M6 spec, which does carry
the route, the delta is `New response: 409` plus a narrowed 422 description —
additive, with the 422 still present because malformed keys still use it.

## 7. Two other decisions worth stating

**The API's read of `network` is strict where the pane's is not.**
`api_network_entries` answers **500 `settings_invalid`** naming every entry it
could not parse, rather than dropping them the way `parse_network` does for the
pane. The pane can afford to skip one and name it in the page because a human
reads the result; these routes cannot. Two of them rewrite the whole map, so a
dropped entry is a deleted interface, and all of them validate relationally, so
an invisible entry turns a legal bridge port into a 422. It is the posture
`api_stored_keys` and `stored_networks` already take.
`an_unreadable_network_entry_stops_every_route_in_the_cluster` holds it — and
holds the one exception, `PUT /api/v1/network`, which does not read the stored
map at all because the map it sends is the map that ends up stored, and is
therefore also the only way out of that state through the API.

**The gate predicate applies both existing precedents rather than inventing a
third.** `is_network_route` releases exactly what the router serves under the
prefix: a **trailing** `{iface}` or `{publicKey}` must be non-empty, the rule
`collection_item` states, so `/api/v1/network/` is the collection path with a
trailing slash and reaches the reserved subtree's not-found; a `{iface}` in the
**middle** may be empty, the rule `rotate_key_iface` states, because axum matches
zero characters there. `the_network_paths_the_router_does_not_serve_reach_the_reservation`
asserts five paths reaching the reservation and one — `/api/v1/network//peers` —
answering section 2.4's 401 envelope rather than the gate's redirect.

## 8. Read-modify-write, recorded and not fixed

The peer collection and the interface `DELETE` are read-modify-write of a whole
value, because the dot-path syntax has no array indexing and no delete. **Two
concurrent writes lose one**, silently. It is recorded and not fixed, for the
reason `write_tokens` and both M5 collections already give: the alternative is a
locking scheme this codebase does not have. `PUT /api/v1/network` is the
exception and is the escape hatch — it reads nothing and replaces everything.

## 9. Tests

Twenty-six, all asserted by name against the run log rather than inferred from a
matching total.

| Test | What it holds |
|---|---|
| `a_vlan_parent_that_is_not_declared_is_422_and_writes_nothing` | relational rule 1, with the message and the unchanged tree |
| `a_bridge_port_that_is_not_declared_is_422_and_writes_nothing` | rule 2 — the exact submission section 2.3 says a passthrough answers 204 to |
| `a_bridge_port_that_carries_addressing_is_422_and_writes_nothing` | rule 3, refused by a *different* entry than the one edited |
| `a_port_claimed_by_two_bridges_is_422_and_writes_nothing` | rule 4 |
| `the_interface_route_declares_replaces_and_removes` | the item route end to end, including that a `PUT` replaces and does not patch |
| `removing_a_port_a_bridge_still_lists_is_refused` | the `DELETE` re-validates the map it leaves behind |
| `an_absent_interface_is_404_and_a_malformed_name_is_422` | section 2.4's two halves, and that the `PUT` has no 404 |
| `the_whole_map_put_replaces_atomically_and_validates_relationally` | the atomicity the passthrough had, plus the validation it did not |
| `a_dotted_interface_name_round_trips_through_the_quoted_path_segment` | `network."eth0.100"` on the write and in the envelope |
| `the_settings_passthrough_under_network_is_409_and_names_the_typed_route` | M4's refusal, verified rather than duplicated |
| `the_peer_collection_lists_adds_and_removes` | the collection end to end, writing only the peer list |
| `the_api_peer_add_refuses_an_undeclared_interface_where_the_pane_writes_one` | 404 before anything is written, on all three operations |
| `the_pane_peer_add_writes_a_broken_entry_for_an_undeclared_interface` | the finding, **run**: 303, the write, and the broken entry |
| `peers_on_an_interface_that_is_not_a_tunnel_are_422` | wrong kind is 422 and not 404, the rotate-key split applied |
| `a_duplicate_peer_is_409_and_writes_nothing` | `peer_exists`, and the precedent followed |
| `an_absent_peer_key_is_404_and_a_malformed_one_is_422` | both halves live on the peer item route |
| `the_network_pane_answers_422_where_the_peer_route_answers_404` | the HTML half, on the same condition |
| `a_peer_key_carrying_a_slash_is_addressable_percent_encoded` | `%2F` round-trips; unencoded reaches the reservation |
| `the_peer_add_runs_the_same_validator_the_reconciler_runs` | three refusals, none echoing the value |
| `an_unreadable_network_entry_stops_every_route_in_the_cluster` | strict reads, and the one route that is exempt |
| `the_network_cluster_takes_a_cookie_or_a_bearer_and_401_without_either` | Amendment 1's reading, and 401 rather than a redirect on six routes |
| `the_network_paths_the_router_does_not_serve_reach_the_reservation` | the gate releases exactly what the router serves |
| `the_openapi_document_covers_the_network_cluster` | every operation, every documented status, the two absent `GET`s, and the rotate route's new 404 |
| `the_network_schema_matches_the_settings_model` | six documented schemas against the settings model, field for field |
| `a_psk_outside_the_lifted_bounds_is_refused_by_the_wifi_route` | the lifted bound, at the route, in both directions |
| `the_lifted_psk_bound_is_the_one_the_renderer_enforces` | renderer and lifted rule agree on every input, with one message |
| `a_duplicate_key_is_409_and_the_stored_list_is_unchanged` | M5's amended assertion: 409 `key_exists` for the duplicate **and** 422 for a malformed key, in one body |
| `a_full_key_list_is_409_and_names_the_bound` | the exported `MAX_KEYS`, answered before the write |
| `every_collection_answers_409_for_a_duplicate` | the third clause across all three collections in one router, each with its own code |

**The arithmetic: 784 + 28 = 812.** Twenty-eight added, **none removed**.
`git diff` over `os/pkgs/mosd/**/*.rs` from the L2 merge counts 25 added
`#[tokio::test]` and 3 added `#[test]`, and zero removed of either. Both
spellings were counted: a naive `#[tokio::test]` census under-counts this tree
by the tests written `#[tokio::test(flavor = "multi_thread")]`, and none was
added or removed here.

Twenty-six of the twenty-eight are the network cluster, the peer collection and
the psk lift; the other two are the duplicate clause's — the exported cap and
the cross-collection test. **One test was renamed, not removed**:
`a_duplicate_key_is_refused_by_the_shared_validator` is now
`a_duplicate_key_is_409_and_the_stored_list_is_unchanged`, which is why the
attribute census shows an addition with no matching deletion while the total
moved by two and not three.

Two existing tests changed, both because the behaviour they assert changed:
`the_rotate_routes_failures_take_the_shared_envelope` gained the not-found row,
and `the_openapi_document_covers_the_rotate_route` gained `404`. Two more in
mosd changed how they read an error rather than what they assert about it:
`a_rotation_refuses_an_interface_that_is_not_a_tunnel` and
`a_daemon_with_no_key_store_rotates_nothing` now go through `zbus::DBusError`,
because `SettingsFault` carries a name and a description rather than a `Display`
— and the first of them gained the name assertions that are the point of the
correction.

## 10. Citations

`routes.rs`, `tests.rs`, `openapi.rs`, `openapi.json`, `model.rs`, `lib.rs`,
`bus.rs` and `wifi_client.rs` all moved, so the citations into them were
re-anchored in a commit of its own that changes numbers and nothing else.

**The pre-image was verified gate-green first.** `bash docs/verify-citations.sh`
was run at the merge commit, before any code edit, and reported
`1539/1539 PASS`. Only then was each citation classified against it — a
re-anchor is valid only if the old line was right.

**Both forms, with counts per form.**

- **Full form** (`` `path:line` ``), the form the gate checks. **533** of them
  named one of the eight files this milestone moved. **368** were rewritten
  mechanically, **145** were already correct because they sat above every
  insertion, and **20** were refused by the mechanical rule; of those 20, **10**
  needed a new value and were resolved by hand and the other 10 were checked by
  hand and left alone. By form: 190 single-line and 178 range citations
  rewritten, 61 single-line and 84 range citations unchanged. The whole document
  set is 1557 in-scope citations across 202 scanned documents.
- **Bare continuation form** (`` `:NNN` ``): **1142** in the scanned documents,
  of which **155** have `os/pkgs/mosd/apid/src/routes.rs` as their exact
  antecedent. **All 155 were left alone.** They are RFCT-214's by census, the
  gate does not check them, and none of them was correct before this change
  either.

**No constant offset was assumed.** The map is built per hunk from
`git diff -U0` against the verified pre-image; the insertions land in five
separate bands in `routes.rs` alone.

**The mechanical rule was applied and its refusals were honoured.** A citation
was rewritten mechanically only when no hunk touched its range and no insertion
fell inside it, and then only after the pre-image text at the old lines was
compared byte for byte against the text at the mapped lines. Every mismatch was
refused rather than rewritten. The ten hand resolutions were the ranges an
insertion landed inside — `api_router()`, the gate predicate and its helper
(which `is_network_route` now sits between), the whole `paths` object of
`openapi.json`, the rotate-key path object, `encode_psk` with its doc comment,
the zbus interface block, and the two rotate-key error arms whose wrapping
expression this milestone changed. Each was checked afterwards: the new range
begins and ends on the byte-identical line the old one did and contains every
line the old range did.

**The rewrites were applied in one simultaneous pass per document**, both for
the mechanical map and for the ten hand resolutions. A sequential pass would let
a citation rewritten to `:884-888` be caught again by the rule whose old value
is `:884-888`, and both of the rotate-key arms are exactly that shape.

**The duplicate clause needed a second pass, run the same way.** The ruling
arrived after the first re-anchoring had landed, and its edits moved
`routes.rs`, `tests.rs`, `openapi.json`, `authorized_key.rs`, `lib.rs` and —
because the clause is recorded there — `docs/design/api.md` itself. The second
pass was built against the first pass's gate-green result (`1557/1557 PASS`) as
its pre-image, and its map covers `.md` as well as `.rs` and `.json`, because a
document that gains a section moves the citations other documents make **into**
it: 265 rewritten mechanically, 180 already correct, 4 refused and resolved by
hand. Three of the four are the `paths` object of `openapi.json`, whose range
grew again; the fourth is `MAX_KEYS`, whose line this milestone changed from
`const` to `pub const` — its quoting record still holds, because the quoted
fragment is a literal excerpt of the new line, so the number moved and
`docs/task/RFCT-211.md`'s prose did not.

**One code line was written to keep a record true.** `docs/task/RFCT-210.md`
quotes `use axum::routing::{any, get, post};` verbatim as the measurement behind
its central negative — apid had never served a write verb — and `docs/task/RFCT-240.md`
records that M4 left it intact. `put` is therefore imported on its own line, the
way `delete` already is, rather than folded into that import; the file's comment
above the two says so. The quoted line moved by one and was re-anchored
mechanically, and its text is unchanged.

## 11. Gates

All four, at `HEAD` of `bkd/36tblhgs`.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `1559/1559 PASS` |
| `bash docs/verify-index.sh` | `780/780 PASS` |
| `bash os/pkgs/mosd/hack/check.sh`, unmodified, in the amd64 builder | `Summary [  70.843s] 812 tests run: 812 passed, 0 skipped`; `advisories ok, bans ok, licenses ok`; `ALL CHECKS PASSED` |
| `oasdiff breaking … --fail-on ERR --severity-levels …` | `No breaking changes to report`, `RC=0`, against **both** the pre-M6 spec on this branch and `main`'s |

The gate script ran unmodified. Two things sit around it and neither touches it:
`dbus` is installed in the container first, without which the bus round-trip
test exits 100, and the builder image was confirmed to report `amd64` before any
result from it was believed. oasdiff is the 1.29.1 release the workflow pins,
sha256-checked against the pinned digest, run with the same two severity
promotions the workflow writes.
