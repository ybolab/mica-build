# RFCT-137 apid's unit sandboxes almost everything except the filesystem it serves files out of

- **status**: completed
- **priority**: P2
- **owner**: bkd/1n7prrif
- **createdAt**: 2026-08-26

`mosd/dist/apid.service:28-39` carries a substantial sandbox: `NoNewPrivileges`,
`ProtectHome`, `PrivateTmp`, `ProtectKernelTunables`, `ProtectKernelModules`,
`ProtectControlGroups`, `RestrictRealtime`, `RestrictSUIDSGID`,
`LockPersonality`, `MemoryDenyWriteExecute`, `SystemCallArchitectures` and
`RestrictAddressFamilies`.

`ProtectSystem=` is absent, and so is an explicit `ReadWritePaths=`. apid runs
as root — it binds 80 and 443 — so its view of the filesystem is writable
everywhere the mount is, and the one directive that would make `/usr`, `/boot`
and `/etc` read-only to it independently of dm-verity is the one not set.

Two things rest on that gap. On a verity root the protection of the served
tree is dm-verity and nothing behind it, so a defect in apid has no second
layer to hit. And the asset router resolves paths under `/srv/ui`, on DATA,
which is writable by construction: `ProtectSystem=strict` with
`ReadWritePaths=/srv/ui /var/lib/mos` would bound what a path-resolution defect
could reach to the two directories apid is supposed to touch.

The two directives are the whole change. What needs care is the
`ReadWritePaths=` list — `StateDirectory=mos/apid` already grants
`/var/lib/mos/apid`, and getting the list short enough to be worth setting
means checking what else apid writes.

## Resolution

`apid.service` now sets `ProtectSystem=strict` and `ReadWritePaths=-/srv/ui`.

The list was derived by reading every write site in the crate rather than by
guessing. apid writes exactly two trees:

- **The state directory** (`/var/lib/mos/apid`): `tls.rs` persists the
  certificate, key and session signing key under it
  (`load_or_generate_certificate` / `load_or_generate_session_key`, both
  rooted at `config.state_dir`); `auth.rs` persists the login-backoff
  counters through `persist::write_atomically`; the audit ring appends there
  (`routes.rs` `with_persistence` constructs `Audit::at(state_dir)`,
  `audit.rs` `append`). All of it is under `StateDirectory=mos/apid`, which
  systemd exempts from `ProtectSystem=strict` on its own — so the state tree
  does not appear in `ReadWritePaths=`.
- **The bundle store** (`/srv/ui`): `bundle.rs` stages, activates
  (`fs::rename`, `write_record`), deactivates (`remove_file` of `current`)
  and deletes generations under `Store`'s root, `DEFAULT_ROOT = "/srv/ui"`
  (`bundle.rs:41`); `startup.rs` drives activation/deactivation at boot. This
  is the one entry in the list.

The entry is `-`-prefixed because apid never creates `/srv/ui` — the store
deliberately requires an operator to (`bundle.rs:679`), and the image does not
bake it (the verify suite asserts nothing is baked under the custom UI root) —
so on a device with no bundle ever installed the path is absent, and an
unprefixed missing path fails the unit's mount-namespace setup. Bundle
installation is out of band and ends in an apid restart, which picks the
directory up.

`User=` is unchanged: apid stays root to bind 80/443. No other absolute path
is written anywhere in the crate (`/proc/uptime` is read-only).
