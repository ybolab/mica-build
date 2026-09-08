# 20260908-2011-state-units-never-load STATE-seeded systemd units never load on first boot

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-08 20:11

## Description

A unit installed into `/mnt/state/systemd-units` — the extension mechanism
`docs/design/ro-root.md` §4 describes — never runs on first boot: systemd
enumerates `multi-user.target.wants` when it builds the initial transaction,
before `usr-local-lib-systemd-system.mount` binds STATE over
`/usr/local/lib/systemd/system`, and nothing issues a `daemon-reload`
afterwards. The mount succeeds and the seeded unit is never loaded. Reproducer:
`tools/qemu-seed-state.sh unit.service /systemd-units/unit.service` plus the
`multi-user.target.wants/` symlink, then boot.

Acceptance: a unit seeded into STATE starts on the first boot of a fresh image
on x64 under QEMU (a failing test first), by whatever ordering or reload
mechanism the fix chooses; the design section's `> status:` line is truthful
about what the mechanism does; the same fix applies to `/etc/containers/systemd`
(Quadlet, the same bind pattern) or the record says why it does not. The
file-based A/B plan's P5 reworks the writable layout; coordinate the chosen
mechanism with it rather than duplicating it.

## ActiveForm

Not started.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Surfaced by the P1-B writable-path audit (`docs/task/20260908-1712-p1-writable-path-audit.md` §11), measured on x64 under QEMU; recorded there, not repaired there.
