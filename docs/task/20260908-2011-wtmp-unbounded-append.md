# 20260908-2011-wtmp-unbounded-append Login accounting appends to /var/log/wtmp without a bound

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-08 20:11

## Description

Login accounting writes the classic append-only `/var/log/wtmp` (0 → 768 →
2304 bytes across SSH sessions), not `/var/log/wtmp.db`: `sshd-session` imports
`wtmpdb_login` but `/var/lib/wtmpdb/wtmp.db` stays a dangling symlink. No
`logrotate` is installed, so the file grows without bound on whatever holds
`/var/log`. It is the one path in the audit's negative list that does have a
writer.

Acceptance: either the writer is removed (mask or redirect the classic wtmp
path) or the file lives on a bounded DATA leaf with rotation; a test that
performs repeated logins and asserts the bound. Decide together with P5's
writable-path allowlist so `/var/log` gets exactly one treatment.

## ActiveForm

Not started.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Surfaced by the P1-B writable-path audit (`docs/task/20260908-1712-p1-writable-path-audit.md` §11), measured on x64 under QEMU; recorded there, not repaired there.
