# RFCT-137 apid's unit sandboxes almost everything except the filesystem it serves files out of

- **status**: in progress
- **priority**: P2
- **owner**: ai-agent
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
