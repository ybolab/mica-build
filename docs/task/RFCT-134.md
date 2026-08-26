# RFCT-134 The admin password can be set exactly once and no operation anywhere changes it

- **status**: pending
- **priority**: P1
- **owner**: (unclaimed)
- **createdAt**: 2026-08-26

`access.webAdmin.password_hash` is written by one line in the whole tree:

```rust
let value = serde_json::json!({ "password_hash": hash });
```

at `mosd/apid/src/routes.rs:1024-1025`, inside `setup_submit`. Every other
reference reads it (`:645`, `:708`, `:917`, `:963`, `:1129`). The setup
handlers refuse to run once a hash exists (`:917`, `:963`), so the one writer
is unreachable after first boot.

The consequence is that an operator who believes the admin password is
compromised has no way to rotate it. There is no HTML pane and no API route;
the only paths back are a factory reset, which loses the settings tree and
every home directory, or the transient SSH root password followed by a
hand-edit of a file the settings tree owns. For a credential that is the sole
authentication on the device's management surface, "cannot be changed" is a
security property, not a missing feature.

Whoever adds it owns two decisions the tree does not answer: whether the
change requires the current password (it should), and whether it invalidates
existing sessions (`mosd/apid/src/session.rs:32` holds them in a map keyed by
cookie, so clearing it is one call).
