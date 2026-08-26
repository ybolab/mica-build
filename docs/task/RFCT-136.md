# RFCT-136 The custom-UI bundle store is complete and no HTTP route reaches it

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
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
