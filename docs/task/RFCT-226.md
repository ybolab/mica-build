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

It was not run; "What is proven, and what is not" below says so and says why.

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

### What is proven, and what is not

**Criterion 1 is proven by fixture and by wiring review, not by a build.** No
rootfs build was run for this task. One is roughly forty minutes per side on
this host, the host was under heavy load from concurrent work while this ran,
and the brief did not require it. What stands behind criterion 1 is therefore:
the purge removes the three paths (read, not executed); the image checker
asserts their absence in both `/var` and the factory tree, driven red by four
negative fixtures; and the two refusals below make the capture and the purge
inseparable.

**What a real build would add.** The path
capture -> `pack-tree-surgery` -> `artifact` export **has never executed**. Its
failure mode is benign in kind but unmeasured in fact: an error in that chain —
a mistyped path, a `mv` whose source is absent, an export target that does not
land — surfaces as a **build failure**, not as a wrong image, because
`package-manager-logs-capture.sh` runs under `set -eu`, `pack-tree-surgery.sh`
is an `&&` chain, and the purge refuses when the capture is missing. So the
untested chain cannot ship a root that still carries the logs; it can only fail
to build one. The first cold build is what turns that argument into a
measurement, and it has not been made.

**Criterion 3, restated without a green run behind it.** The stage-order
comparison is a MANUAL instrument, not a gate: `os/rootfs/README.md`, "Running
the gate", driven by a person across two cold builds. This change kept it
reading the same bytes — verbatim and unstripped — from a new location,
`_out/<board>/pkg-logs/` instead of the extracted root. It was **not run**,
because running it requires two builds. What would run it is that checklist with
one line different: the apt-order bullet reads `_out/<board>/pkg-logs/dpkg.log`
on each side. The claim "it still proves the same thing" rests on the inputs
being identical bytes, which is an argument about the wiring, not a result.

### The two refusals

They are symmetric and they are what makes the capture and the purge one thing:

- `package-manager-logs-capture.sh` refuses when `/var/log/dpkg.log` is missing
  or empty **before** it copies anything — so a build that silently stopped
  producing the evidence fails loudly instead of capturing nothing.
- `package-manager-purge.sh` refuses when `/rootfs-report.pkglogs/dpkg.log` is
  missing **before** it removes anything — so the failure this record was
  written to prevent, someone extending the `rm -rf` list, is a build error that
  names the instrument and the README section rather than a quiet loss.

### Gates

Measured in an isolated worktree on branch `bkd/taa0mdf7`, as a before/after
pair rather than against a relayed number.

| Gate | Before (`5c71ec4`) | After |
|---|---|---|
| `docs/verify-index.sh` | 863/863 PASS | 863/863 PASS |
| `os/verify/run.sh` | 1092/1092 PASS | 1096/1096 PASS |
| `os/tests/shell-pipefail-lint.sh` | 30/30 clean | 30/30 clean |
| `docs/verify-citations.sh` | 2170/2170 PASS, near-miss 352 | 2171/2171 PASS, near-miss 352 |

The four new tests are this task's negative fixtures. The one extra citation is
this record's own, armed with a quote.

The citation gate was run three times, and the middle run is the one worth
keeping. At the code commit it read **7 FAILED (0 resolution, 7 content), 2163
passed** — every one a line-number shift from the insertions above, re-anchored
mechanically in the commit that follows. The next run read **1 FAILED (0
resolution, 0 content, 1 ratchet)**: this record had introduced a citation with
no adjacent quote, above its ceiling of 0. It was quoted rather than having the
ceiling raised, because a quoted citation is content-checked on every future run
and a raised ceiling is a permanent licence not to check.

The near-miss count is **352 on both sides, unchanged**. It is reported because
a near-miss delta on one's own diff means a citation whose quote is silently not
being checked — the gate says so on a line most readers skip.

The bare `` `:NNN` `` continuation form is invisible to that gate, so
`RFCT-159.md:219`'s three continuation citations into
`stages/40-board.Dockerfile` were checked by hand against the pre-image, line by
line, and moved. One pre-existing error was found and deliberately NOT fixed:
`docs/design/api.md:3550` *"copies the cross-built"* — and `:4077` with it —
names `build-v2.sh` at its lines 75-76 for prose about staging the cross-built
binary, but those lines held `exit 1` and a case terminator at the parent commit
already. That path is written without a slash on purpose: naming it as a
citation would assert a resolution this sentence exists to say is wrong.

`api.md`'s own citation into `build-v2.sh` carries no armed quote, which is why
the gate has never caught it and why the error could persist. It was re-anchored
to where that content moved rather than repointed at what the prose means:
repointing by meaning is a guess, and this task's mandate was to move what its
own edits shifted, not to correct someone else's target.

### Residue

- The `pkg-logs/` export is a new file surface in `_out/<board>/`. Nothing reads
  it programmatically — it is a record for a person, listed as such in
  `build-v2.sh`'s output comment — so no consumer needed changing.
- The first cold rootfs build is what would confirm the export lands and that
  the packed root is clean by measurement rather than by argument. Unclaimed.
- `api.md`'s stale `build-v2.sh:75-76` citation, above, is unowned.

## Addendum, 2026-08-29: criterion 1 executed

The record above says criterion 1 was proven by fixture and by wiring review and
NOT by a build. It has since been proven by a build. This section is dated
because it is a later measurement against the same record, not a rewrite of it.

**The run.** `MOS_BOARD=x64 MOS_ROOTFS_WITHOUT="rauc containers" bash
os/rootfs/build-v2.sh`, at `06b6455`, working tree clean, 13 minutes. It exited
non-zero, and the reason is not this milestone's: the smoke runner refuses a
feature-declined tree by design, downstream of the pack, because "a skip reports
the same green as a pass". Everything the pack produces was produced first.

**The chain executed, in order, both steps reporting:**

    #11 [closed 3/5] sh /mos-scripts/package-manager-logs-capture.sh
    #11 0.316 package-manager logs captured: 5 files, 104 KB
    #12 [closed 4/5] sh /mos-scripts/package-manager-purge.sh
    #12 2.971 package management removed; 158 copyright files kept

The second line is the load-bearing one. The purge refuses unless
`/rootfs-report.pkglogs/dpkg.log` exists and is non-empty, so its running at all
is the capture-before-purge ordering holding on a real build rather than in
review.

**The export landed**, `_out/x64/pkg-logs/`: `dpkg.log` at 44678 bytes and 653
lines, `alternatives.log`, and `apt/`. Its first two lines are
`2026-08-28 03:34:58 startup archives unpack` and
`2026-08-28 03:34:58 install libsystemd-shared:amd64 <none> 257.13-1~deb13u1`,
so the instrument the stage-order comparison reads survives outside the image
with real content.

**The assertion**, read out of `_out/x64/factory-root.oci`
(sha256 `063d6a3f87da49ac6401b7cf04c486cab420c8452b31c88ae8cd4086f5ad00a9`,
ref `localhost/mos-factory-root:x64` taken from `factory-root.txt` rather than
guessed), with two controls so a false pass is detectable:

    control A: usr/share/factory/var/ entries: 86, of which lib/: 62
               (a packed root has the factory tree; a pre-pack stage image
                does not, which is how a first attempt against the wrong
                image was caught and discarded)
    control B: none of usr/bin/dpkg, usr/bin/apt, usr/bin/apt-get is present
               (the purge ran in the image under test)

    RESULT: PASS -- none of /var/log/dpkg.log, /var/log/apt/,
    /var/log/alternatives.log is present, in /var or under
    /usr/share/factory/var

**The removal is surgical, which the fixtures could not show.** The packed root
still carries the rest of the log surface:

    usr/share/factory/var/log/README
    usr/share/factory/var/log/btmp
    usr/share/factory/var/log/journal/
    usr/share/factory/var/log/lastlog
    usr/share/factory/var/log/private/
    usr/share/factory/var/log/runit/ssh/
    usr/share/factory/var/log/wtmp

So the change removed the package-manager logs and nothing else; it is not a
blanket wipe of `/var/log` that happened to satisfy the assertion.

### What this covers, and what it does not

**Covered:** the absence of the three log paths from a real packed root, and the
`pkg-logs/` export, on a feature-reduced x64 root.

**Not covered:** the shipping cx3576 full-feature root, and the stage-order
comparison itself, which needs two cold builds.

The configuration reduction does not weaken the result, and the reason is
structural rather than convenient: the capture -> purge -> export path lives in
`90-pack`'s `closed` stage and runs after every feature stage unconditionally.
A feature stage can only ADD log content ahead of the capture point; none of
them decides whether the three paths survive into the packed root or whether
`pkg-logs/` receives them.

The shipping-configuration confirmation arrives free with the next ordinary
image build — any RFCT-206 section 7 run or a release build — so it is a
standing expectation on the next builder rather than a debt on this milestone.
