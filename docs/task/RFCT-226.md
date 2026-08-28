# RFCT-226 The /var/log package-manager residue, now load-bearing for the stage-order gate

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-28
- **plan**: PLAN-013 (M1.4, filed by PLAN-024 M2; routed to PLAN-025-class work)

PLAN-013 M1.4 asked for two things and RFCT-222 found neither was done. The
purge script removes the package-manager databases and caches and stops there:
it never touches `/var/log/dpkg.log`, `/var/log/apt/` or
`/var/log/alternatives.log`. The image checker's tree list is unchanged too —
six package-manager paths, none of them a log path.

## The constraint that changed the task

Closing this is no longer the two-line change PLAN-013 assumed, and that
constraint is the reason this record exists rather than a fix.

`dpkg.log` has since become **load-bearing evidence**. The rootfs stage order
is gated on it: the gate asserts that the log, with its timestamps stripped, is
byte-identical across all 694 operations, and a stage file repeats the
dependency by carrying the logs into `/usr/share/factory/var/log` at pack time.

Removing the logs from the seeded `/var` therefore breaks a determinism gate
unless the removal keeps them reachable to that comparison, or replaces the
comparison with one that does not need them.

**A record that files this without the constraint is not this task.** Anyone
who picks it up and simply extends the purge script's `rm -rf` list will turn
a green stage-order gate red and will not know why.

## Scope when claimed

Remove the package-manager log residue from the shipped image while keeping
the stage-order determinism claim provable. Two shapes are open, and choosing
between them is part of the work:

- Keep the logs reachable to the gate — produced and compared during the build,
  dropped from the packed root before it is sealed — so the comparison is
  unchanged and only the artifact loses them.
- Replace the comparison with one that does not read `dpkg.log`, and then purge
  the logs unconditionally. This is the larger change and must not weaken what
  the stage-order gate proves today.

Extend the image checker's tree list to assert the log paths are absent, so the
removal is held in place by a check rather than by the purge script alone.

## Acceptance criteria

1. `/var/log/dpkg.log`, `/var/log/apt/` and `/var/log/alternatives.log` are
   absent from the packed root.
2. The image checker asserts their absence, with a negative fixture proving the
   assertion can fail.
3. The stage-order determinism gate still passes, and still proves the same
   thing it proves today — stated explicitly in the record, not assumed from a
   green run.
4. If the comparison was replaced, what it now compares and why that is at
   least as strong is written down.

## Files it is expected to touch

`os/rootfs/scripts/package-manager-purge.sh`, `os/verify/src/checks-engine.ts`
with its fixture and test, and — depending on the shape chosen —
`os/rootfs/stages/` and `os/rootfs/stages/README.md`.

## Dependencies

- **blocked by**: (none — claimable any time)
- **blocks**: nothing, but it collides with the stage-order gate, so it should
  not be claimed concurrently with work that rewrites that gate.
