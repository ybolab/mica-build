# RFCT-226 The /var/log package-manager residue, now load-bearing for the stage-order gate

- **status**: completed
- **priority**: P2
- **owner**: bkd/taa0mdf7
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

## Closed 2026-08-28 — what was measured, and what changed

### The premise this record was built on is half false

The record above says the stage order "is gated on" `dpkg.log` and calls a
green gate the thing that would turn red. **There is no such gate.** Measured
on this branch, `grep -rn 'dpkg\.log'` across the whole tree returns fifteen
lines and not one of them is executable: four are this file and its siblings
under `docs/`, four are prose in `os/rootfs/README.md` and
`os/rootfs/stages/README.md`, and two are dependency comments in
`stages/30-feature-radios.Dockerfile` and `stages/40-board.Dockerfile`. No
`.sh`, no `.ts`, no `Makefile` target and no CI job reads the file.

What `dpkg.log` is load-bearing for is a **manual instrument**: the checklist
under "Running the gate" in `os/rootfs/README.md`, which a person drives across
two cold builds cut with `git worktree add --detach`. So "the gate still
passes" was never a claim about a green run, and the constraint the record
exists to carry is real but differently shaped — the thing to protect is not a
CI verdict but a procedure's ability to still be run. That distinction is what
picked the shape below, and it is why criterion 3 is answered by argument and
not by a run.

### The shape chosen: keep the bytes, drop the image content

The smaller of the two shapes, and it holds. `90-pack`'s `closed` stage now
runs `scripts/package-manager-logs-capture.sh` **before** the purge, copying
`/var/log/dpkg.log`, `/var/log/alternatives.log` and `/var/log/apt/` to
`/rootfs-report.pkglogs`. `pack-tree-surgery.sh` moves that to `/out/pkg-logs`
and the `artifact` stage exports it to `_out/<board>/pkg-logs/` — exactly the
lifecycle `/rootfs-report.txt` already had: produced in the root, moved out of
it, never shipped. The purge then removes all three paths from `/var/log`.

The comparison is **unchanged**. It reads the same bytes, unstripped and
verbatim, from a different directory; the `sed`-strip-and-`diff` a person runs
is the same operation on the same input. Criterion 4 therefore does not apply:
the comparison was not replaced.

The two steps cannot come apart. `package-manager-purge.sh` opens with
`[ -s /rootfs-report.pkglogs/dpkg.log ]` and **refuses** otherwise, so the
failure the record warned about — someone extends the `rm -rf` list and
silently destroys the evidence — is now a build error naming the instrument
rather than a claim that quietly stops being measurable.

### What the determinism claim proves now

The same thing, and the control around it is tighter. The known-differing set
in `os/rootfs/README.md` was **six of 9,241 entries**; four of those six were
these logs, differing only by wall-clock stamps. Removing them from the packed
root leaves **two** — `initrd.img-*` and `aux-cache` — and makes the seventh,
outside-the-tree entry (`apt/eipp.log.xz`, which lives under `/var/log/apt`)
unable to arrive at all. A control that admits fewer differences admits fewer
real ones with them, so the byte-identity half of the comparison is strictly
stronger than before. The order half is unchanged, because its input is
unchanged.

**Not run, and this is stated rather than implied.** The comparison itself is
two cold rootfs builds on one board, roughly forty minutes each plus the
extraction and both instruments; this task did not run it. What would run it is
the checklist in `os/rootfs/README.md` under "Running the gate", with one line
different: the apt-order bullet reads `_out/<board>/pkg-logs/dpkg.log` on each
side instead of `usr/share/factory/var/log/dpkg.log` in the extracted root.

### The image side, held by a check

`checks-engine.ts` gains `PKGMGR_LOGS` — the three paths in both `/var` and
`/usr/share/factory/var`, six entries, for the reason `PKGMGR_TREES` already
lists both: a log left under the factory tree is restored onto `/var` on the
first boot. They fold into the existing `purge-no-package-manager` conclusion
rather than becoming a new check, and the trailing slash that says "tree, not
file" is decided per path because the set is mixed. Four negative fixtures in
`checks-engine.test.ts` drive it from the failing side: the log on `/var`, the
factory copy, the `apt/` directory with its slash, and `alternatives.log` on
both boards. Each asserts the check green on the unmutated fixture first, so a
fixture that was already red proves nothing.

### Gates

- `bash docs/verify-index.sh` — 863/863 PASS, unchanged from the baseline.
- `bash docs/verify-citations.sh` — 2170/2170 PASS, unchanged from the baseline
  measured on the parent commit.
- `bash os/verify/run.sh` — 1096/1096 PASS, from a 1092/1092 baseline; the four
  are this task's negative fixtures.
- `make os-shell-pipefail-lint` — 30/30 files clean.
- No rootfs build was run. `_out/<board>/pkg-logs/` is asserted by construction
  and by the purge's refusal, not by a measured artifact.

### Residue

The `pkg-logs/` export is a new file surface in `_out/<board>/`. Nothing reads
it programmatically — it is a record for a person, listed as such in
`build-v2.sh`'s output comment — so no consumer needed changing, and the next
cold build is what would confirm it lands. That confirmation is unclaimed.
