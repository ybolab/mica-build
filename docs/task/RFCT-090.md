# RFCT-090 PLAN-011 M2: writable items and /Actions/*, apid power pane on action items

- **status**: completed — the write path, both action items and apid's power pane landed; HTTP is unchanged and the D3 fork is resolved in writing
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-21 14:58
- **claimedAt**: 2026-08-21 14:58
- **completedAt**: 2026-08-21 20:58

PLAN-011 milestone M2, depends on M1 (RFCT-089). Deliverables: every
platform-config subtree (`hostname`, `network`, `wifi.client`, `wifi.ap`,
`access.ssh`) writable through `com.mos.Item1` (the tree is a facade over
the same store; reconcilers unchanged); `/Actions/*` items with
VeQItemAction semantics (value always 0, write triggers, forced re-zero,
log-before-power-call preserved); apid power pane consumes the action
items; `docs/design/api.md` §10.3 fork entry resolved with citation.
Verify: route tests behaviorally unchanged; live-bus tests per PLAN-011 M2.

## Outcome

M2 is complete. Four commits carry it — `c3e32ed` (`SetValue` on settings
items), `11cafed` (the `/Actions/*` items), `8b0451a` (the `-4`/`-5` split)
and `b242f7c` (apid's power pane) — merged onto the campaign branch as
`ea2a599`, `b6d3806`, `0a977e8` and `3b2ab65`.

**`SetValue` on settings items (`mosd/mosd/src/tree.rs`).** Every item below
the service root is its own D-Bus object carrying `GetValue`/`SetValue`,
registered before the well-known name is claimed and kept in step with the
tree by the existing change watcher. The **writable** surface is the five
platform-config subtrees — `hostname`, `network`, `wifi.client`, `wifi.ap`,
`access.ssh` — as a fixed list, deliberately *not* derived from the daemon's
reconciler set, so a dry-run daemon still reports the writability a real one
has rather than reporting none. `writable` in `GetItems`/`ItemsChanged` now
means something: `true` on those subtrees and the action items, `false`
everywhere else including all of live state.

**One write path with two spellings.** `SetValue` hands the value to the same
`MosdService::write_setting` (`mosd/mosd/src/bus.rs`) that `SetSettings`
calls — validate, persist, re-apply the reconcilers whose subtree overlaps the
path. `docs/design/bus.md` §1.2 names divergence between the two write paths
as a bug class the live-bus test must cover; sharing the function makes that
divergence **unrepresentable** rather than merely covered. Reconcilers are
unchanged.

**Action items (`mosd/mosd/src/actions.rs` + `tree.rs`).** `/Actions/reboot`
and `/Actions/poweroff` are item objects, one per path, value a constant `0`,
any written value triggers. Because the value is constant no projection diff
can carry the consumption edge, so the forced re-zero is *injected* into the
same coalesced `ItemsChanged` batch as the live-state power record — one
signal, §1.1's coalescing guarantee intact. Dispatch calls the existing
`request_reboot`/`request_power_off`, so `note_power_request` still logs and
records **before** the power call: the `Reboot` contract is preserved by
reusing the method rather than by restating it. The trigger is attributed
through the message header (`bus::sender_of`) exactly as a method call is.
Writability became an explicit `Access` enum — read-only, setting, action — so
an action is a case of its own, not an entry bolted onto the writable-subtree
list.

**The result-code vocabulary (`tree.rs`).** `0` ok, `-1` unknown path, `-2`
read-only, `-3` invalid value, `-4` validated but would not **persist**, `-5`
accepted but would not **dispatch**; positives reserved. `-4` and `-5` are
deliberately distinct because their retry semantics differ — a write that did
not persist took effect nowhere, while an action that did not dispatch was
already logged and recorded before the power call, so the request exists
either way. A sibling subtask documented the vocabulary as the
`docs/design/bus.md` §1.1 table.

**apid's power pane (`mosd/apid/src/bus_client.rs`).** `reboot()` and
`power_off()` now `SetValue` on the action items. `mosd/apid/src/routes.rs`
was **not** modified: the switch sits below the `SettingsApi` trait, so HTTP
behaviour is byte-for-byte unchanged — same routes, same confirm-token gate,
same `202 Accepted`. apid names **no** failure code; only `0` is success and
every other code takes the existing failure path, so mosd's failure vocabulary
can grow without apid tracking it. The `com.mos.mosd1` `Reboot`/`PowerOff`
methods are still served by mosd and are neither deprecated nor removed —
apid has simply stopped calling them.

**The D3 fork, resolved in writing.** `docs/research/venus-os-ui.md` §7 item 2
recorded actions-as-items-versus-methods as a fork in the road. It is now
closed in favour of items: `docs/design/api.md` §10.3 item 16 records the
resolution from the API side, citing PLAN-011 D3 and `docs/design/bus.md` §7,
and states that `POST /api/v1/actions/<verb>` remains and becomes a thin
mapping onto the items with no HTTP-visible change, with `bus_client.rs` as
the consuming caller that already proves it. That entry also routes the one
accuracy fix M2 owes to sections outside this task's scope — §1.3's
*"six methods"* proxy table and §2.2's two rows still name
`Reboot`/`PowerOff` as what backs the verbs.

**Contract markers.** In `docs/design/bus.md`, `[proposed]` → `[implemented]`
only on what M2 landed, each naming its path: `GetValue`/`SetValue` on
per-item object paths and the meaning of `writable` (§1.1), the single write
path and the still-open deprecation decision (§1.2), `SetValue` failures
reported only as a return code (§3), the slash-form object path (§4), and all
four of D3's statements plus apid's consumption of the items (§7). Section
headings follow their statements where every statement under them moved (§1.1,
§3, §4, §7). §1.1's result-code table was already `[implemented]` and is a
sibling subtask's; it is cited, not touched. §5, §6 and §10 stay `[proposed]`
— the class registry and the mandatory paths need extension services that do
not exist, and the bridge is M3.

**Four known limits, recorded as decisions (`docs/design/bus.md` §11).** An
unknown object path answers with D-Bus `UnknownObject` rather than `-1`
(zbus dispatches by exact path with no subtree handler, so a catch-all would
mean an object at every guessable path; and since the contract *is* a method
return code, there is no method to return one from — the internal `-1` branch
stays for the real projection-versus-dispatch race). A settings key that is
not a valid D-Bus path element (`network.br-lan`) gets no object but keeps its
`GetItems` read and its `SetSettings` write, with a `WARN` when it happens. A
reconciler's live-state key can shadow a settings top-level key, which is
unreachable today and cannot widen anything because live state is never
writable. And on a real reboot the forced re-zero may never reach a
subscriber — inherent to rebooting, and the reason the record is written
before dispatch.

**Verification.** `make docs-verify` green (303/303) at this close-out. The
code gates belong to the implementing subtasks and are theirs to claim:
`bash mosd/hack/check.sh` reported `419/419` at the action-items commit and
`423/423` at the apid switch, with live-bus tests against a real
`dbus-daemon` covering the `SetValue` persist-and-schedule path, the negative
codes, both triggers, the forced re-zero and the log-before-call ordering, and
`mosd/apid/src/tests/power_bus.rs` driving the real router against a fake mosd
serving both surfaces at once to assert which one apid uses. With all four
merged, the campaign branch reported `424/424` before this close-out began.
This docs-only close-out ran `make docs-verify` and claims nothing beyond it.
