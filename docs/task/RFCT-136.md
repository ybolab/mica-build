# RFCT-136 The custom-UI bundle store is complete and no HTTP route reaches it

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26

`mosd/apid/src/bundle.rs` implements the `/srv/ui` store in full: layout,
validation, atomic activation, deactivation, generation tracking and a status
read. `Store::status` answers from the served tree and names the empty case
(`bundle.rs:620`, `NO_CUSTOM_BUNDLE` at `:45`), and startup activates a staged
bundle and deactivates an incompatible one
(`mosd/apid/src/startup.rs:215-227`, `:277-283`).

The API router declares four routes and none of them is a bundle route:

```rust
.route(VERSIONS_PATH, get(api_versions))
.route(V1_META_PATH, get(api_v1_meta))
.route(V1_SETTINGS_ROUTE, get(api_v1_settings))
.route(V1_STATE_ROUTE, get(api_v1_state))
```

(`mosd/apid/src/routes.rs:266-271`). There is no upload operation and no
installed-bundle read; `status` carries `#[allow(dead_code)]` at
`bundle.rs:619` because nothing calls it.

So the store is reachable only by an operator writing into `/srv/ui` out of
band and restarting apid. Two things are owed: the install transport, which
needs an archive-format decision ([[RFCT-138]]) and an authorisation decision —
today the only credential in the crate is the single webAdmin password — and a
read endpoint, whose one constraint is already recorded in the code:
`status()` hashes the whole tree, so it must not be called per request, which
is why the asset router uses `active_generation()` instead.

## Resolution

Resolved as a decision record, not a transport: the bundle store stays
route-less **deliberately**, and the deferral is now written down where the
API is designed — `docs/design/api.md` §2.3 carries a paragraph in the
"operations with no API equivalent" inventory naming the store and the two
prerequisites any bundle route waits on:

1. **The archive-format decision** for the upload transport. The obvious tar
   and zip candidates split exactly along the no-C-dependency line that
   [[RFCT-138]] moved from a `Cargo.toml` comment into `deny.toml`'s bans
   list; choosing a crate is now a gated decision, not a taste call, and it
   has not been taken.
2. **The authorisation decision.** The only credential in the crate is the
   single webAdmin password. An operation that installs content served from
   the management origin needs its own authorisation answer rather than
   inheriting that default.

Until both are taken, installation stays what it is today: out of band —
write into `/srv/ui`, restart apid. No route was added, no transport code was
written. `Store::status` keeps its `#[allow(dead_code)]` and its constraint
comment (`bundle.rs:618-619`): it hashes the whole served tree, so the read
endpoint that eventually calls it must not run per request — the asset router
keeps reading `active_generation()` instead.
