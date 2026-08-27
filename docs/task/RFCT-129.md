# RFCT-129 apid reads /proc/uptime itself, against its own rule that mosd owns every system fact

- **status**: in progress
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
