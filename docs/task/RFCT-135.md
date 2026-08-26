# RFCT-135 The network form accepts a VLAN interface name that the settings path syntax then rejects

- **status**: pending
- **priority**: P1
- **owner**: (unclaimed)
- **createdAt**: 2026-08-26

`valid_iface_name` permits `.` in an interface name:

```rust
.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
```

(`mosd/apid/src/routes.rs:806-811`), and the error message the pane shows
advertises it — *"letters, digits, '.', '_' or '-'"* (`:850`). `eth0.100` is
the standard spelling of a VLAN interface and passes validation.

`network_submit` then writes it as a dot-path: `set_settings("network.eth0.100")`
(`mosd/apid/src/routes.rs:1534`). `split_path` splits on `.` unconditionally
(`mosd/mosd-settings/src/path.rs:26-32`), producing three segments, so `100` is
offered as a field of `IfaceSettings` — which carries `deny_unknown_fields`
(`mosd/mosd-settings/src/model.rs:414-416`) and refuses it.

The operator sees the form accept the name and then a bus error, with no
message saying that VLAN interfaces cannot be configured at all. Either the
validator should reject `.` and say why, or the path syntax needs a way to
address a key containing one. The second is the real fix and is not apid's to
make: it is the settings dot-path syntax, and the same limit blocks any key
with a dot in it.
