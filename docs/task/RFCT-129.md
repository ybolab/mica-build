# RFCT-129 apid reads /proc/uptime itself, against its own rule that mosd owns every system fact

- **status**: completed
- **priority**: P2
- **owner**: bkd/0fibgdbm
- **createdAt**: 2026-08-26

`GET /` reads `/proc/uptime` from inside apid
(`mosd/apid/src/routes.rs:1223-1225`, parsed at `:1185` and rendered at
`:1233`). The crate states the opposite rule two files away: *"The power
actions are here rather than executed locally because mosd owns every system
action: apid never spawns a process and never talks to systemd itself"*
(`mosd/apid/src/settings_api.rs:10-12`).

mosd publishes no uptime — `grep -rn uptime mosd/mosd/src/` returns nothing —
so the live-state tree has no field for it and `GET /api/v1/state/` cannot
serve one. The result is a status pane field that the API cannot reproduce:
two consumers of the same appliance disagree about what facts exist, and the
one that reads a `/proc` file directly is the one that also has to grow a
second reader for every system fact added after it.

The fix is a mosd-side change: publish uptime into the live-state tree and
have apid read it through `get_state` like every other system fact. Until that
lands, the built-in UI and the API are not answering from the same source.

## Resolution

**Tree path and refresh point, as the task asked to be decided and
recorded.** Path: top-level `uptime`, a bare JSON number of whole seconds
since boot. Refresh point: computed at `GetState` time — mosd reads its own
`/proc/uptime` inside the call and grafts the number onto the served view
(the direct read and the whole-tree read both call
`read_uptime_seconds()` `os/pkgs/mosd/mosd/src/bus.rs:649-668`), so no cached seconds-counter exists
anywhere to go stale. Grafted rather than stored: the stored tree stays
reserved for pushed facts, so a read never manufactures a change edge for the
item façade's diff stream, and `GetItems` is unchanged.

apid's status pane reads uptime like every other system fact —
`get_state("uptime")` (`os/pkgs/mosd/apid/src/routes.rs:4254-4262`); the `/proc/uptime` reader and
its parser are deleted, closing the contradiction with the crate's own rule
(`settings_api.rs:10-12`). `GET /api/v1/state/uptime` now serves the field
the pane shows, from the same source.

**RED-GREEN.** New assertions observed red against the pre-change
implementation (`GetState("uptime")` errored over the real bus; the pane
rendered a real `/proc` uptime where the fake's state had none), then green:
`bus_roundtrip` (over a private bus), `get_state_serves_uptime_without_storing_it`
(unit, including the stored-tree-untouched half), and two pane tests
(humanized rendering from seeded state; unavailable notice — not a `/proc`
number — when state has no uptime).

**Commits.** `e9974a4` (implementation and tests, with the api.md §1.6/§2.2
item 3/§2.3/§9 updates recording the decision), `5502a4f` (mechanical
citation re-anchoring).
