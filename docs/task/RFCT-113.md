# RFCT-113 PLAN-014 M7: built artifacts smoke-run on the base rootfs

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 22:05
- **completedAt**: 2026-08-26 11:05
- **plan**: PLAN-014 (M7)

Close the gap between "it linked" and "it runs": every self-built binary is
executed inside the base rootfs before an image ships it, and the version it
reports must equal the pin in `versions.env`.

## Scope

- The base stage exports an OCI image of the factory root (arm64 via the
  same binfmt/qemu-user path the rootfs build already uses).
- Smoke runner (TS, in `os/verify/`): for mosd, apid, mos-mqttd,
  mos-mqtt-broker, rauc, podman, quadlet, crun, conmon, netavark,
  aardvark-dns — minimal invocation inside that image, assert exit 0 and
  reported version == the recorded pin. catatonit (static, no --version
  contract) gets an exec-only check.
- Explicitly a smoke test: execution + version identity, not behaviour.
  QEMU boot tests keep functional coverage; ldd/NEEDED checks stay where
  they are.

## Acceptance

- A deliberately wrong-arch binary, a missing-soname binary, and a
  version-skewed binary each fail the build (three negative tests).
- The full artifact list above passes on both boards' base roots.
- The version loop is closed: bumping a `versions.env` pin without
  rebuilding the artifact turns the smoke run red.

## Dependencies

- After RFCT-108 (pinned environments) and RFCT-111 (the base stage that
  exports the factory root).

## What is discharged at close, and what is not

M7 closes **2026-08-26**, and its three acceptance clauses do not all close the
same way. A `completed` status that implied they did would be the kind of green
this campaign keeps finding.

### Clause 1 — three negative tests. Discharged, on the LITERAL reading.

**The clause's verb was the whole question, and it was decided rather than
assumed.** Clause 1 says a wrong-arch, missing-soname or version-skewed binary
must **"fail the build"**; clause 3, in the same record, says a version-skewed
pin **"turns the smoke run red"**. Two verbs, and the purpose line settles which
sense clause 1 carries: *"every self-built binary is executed inside the base
rootfs **before an image ships it**."*

**Measured before deciding, because the two readings only diverge if the looser
one is already satisfied and the stricter one is not.** They did. 672 tracked
files; 38 mention `smoke`; the only executable invocation of the runner anywhere
in the tree was `os/verify/run.sh` calling its own CLI. No `make` target, neither
`.gitea` workflow, and every `smoke` in `os/rootfs/build-v2.sh` was a comment —
including the one that states the risk exactly: *"an image that ships them
unexecuted looks exactly like one whose smoke run passed."*

**This is a gate deciding which sense of its own clause applies. It is not an
amendment** — clause 1's text is unchanged and says what it always said — and it
did not go to the user, because the literal reading turned out to be
*satisfiable*, and a clause question only exists when it is not. What made it
satisfiable is that the build path already required everything the smoke run
requires: `os/rootfs/build-v2.sh` has needed docker since its first `buildx`
line, and for cx3576 it already refuses up front without the host `binfmt` that
executing an arm64 root needs. A host that can build this root can run what is
in it.

**So the smoke run is the last step of `os/rootfs/build-v2.sh`, under `set -e`.**
In the script and not in the `Makefile`: two make targets run it, so does the CI
deep lane, and anyone can run it directly — a step wired into the callers would
be three copies to keep in step and bypassed by the fourth. No skip and no
opt-out.

**Its ordering, stated rather than implied.** Pack → export → *the two existing
refusals about the archive* → smoke → (the caller assembles). The step sits
**after** `build-v2.sh`'s own checks that `factory-root.oci` exists, is non-empty
and carries an `index.json`, not before them — so a missing or non-OCI archive is
still diagnosed as itself rather than arriving at the smoke runner as a
`docker load` failure. Those refusals are ~120 lines earlier in the file; the
smoke step is the last line, unguarded, with nothing after it whose success could
mask it.

**And what it costs a build that used to pass, driven rather than asserted.** A
smoke failure now fails the image build — that is the clause. The dangerous
half is the other one: *a build that silently skipped the step would produce an
image indistinguishable from one whose smoke run passed*, which is
`build-v2.sh`'s own sentence about a missing archive, now applying to this step.
**There is no skip path**, and both ways a real build host could lack the means
to run it were driven:

| host | measured |
|---|---|
| bun present, **no docker** | `error: Executable not found in $PATH: "docker"`, exit **1** |
| **no bun, no docker** | `error: --smoke on a host with no bun needs docker, and there is none`, exit **1** |

Both were then run through the actual seam — the same command under
`set -euo pipefail` with a line after it — and in neither case did that line
execute. A host that cannot execute the image at all is caught earlier still, by
`preflight`, which refuses before concluding anything about any artifact.

**The three negative tests are `os/verify/src/smoke-negative.ts`**, `make
os-smoke-negative-test`. Each MAKES its defect in a real image built from the
real factory root and drives the real `docker run` at it — a wrong-arch ELF, a
removed `DT_NEEDED` library, a binary reporting a version other than its pin —
with the unmutated artifact as its positive control in the same pass, a mutation
that fails the image BUILD if it changed nothing, and a requirement that the
whole run conclude FAIL with exit 1 on exactly one named artifact.

**Driven end to end at close**, with the real x64 factory root and the exact
command the build path now runs. One byte of `/usr/bin/crun`'s ELF header
(`e_machine` `0x3e` → `0xb7`) and nothing else:

    RESULT: FAIL (11 pass, 1 fail, 0 unclaimed, of 12). FAILED: crun.   exit 1
    ...and under `set -e` the line after it does not run.
    reverted: RESULT: PASS (12 pass, 0 fail, 0 unclaimed, of 12)        exit 0
    ...and it does.

### A measured fact corrected on the way, not a clause changed

M7b's exit-status diagnosis was **wrong about both of the shapes this clause
names**, and it had never been measured. Measured (docker 29.7.2, in exactly the
shape `dockerArgv` produces): a wrong-arch binary is **255**, not 126, and fell
through to *"the program ran and refused"* — it never ran. A missing soname is
**127**, not 126, and was reported as *"the path does not exist in the factory
root"* — it is there. 126, which the old map gave to both, is a **mode bit**, a
case nobody had considered. `preflight`'s comment in the same file already
recorded 255 with `exec format error`; one half of the module had the
measurement and the other had the convention, and nothing compared them —
because both branches were reachable in the suite only from a **fabricated**
`ExecResult`, where the test chooses the status whose diagnosis it then asserts.

That is why these three cases are not unit tests. With M7b's map restored, the
two cases it was wrong about report **DID NOT HOLD** and version-skew still
holds: `RESULT: FAIL (1 of 3 negative tests held)`.

### Clause 2 — "the full artifact list passes on both boards' base roots."

**x64: discharged.** `RESULT: PASS (12 pass, 0 fail, 0 unclaimed, of 12)`,
against the real x64 factory root, every artifact executed and every version
compared against its pin — and for `mosd` and `apid` the build commit as well,
read out of the record the build wrote rather than out of `git rev-parse HEAD`.

**cx3576: not discharged, and never observed.** See the disposition below.

### Clause 3 — the version loop. Discharged.

Driven end to end by M7b against the real image — `CRUN_VERSION` bumped with
nothing rebuilt, the run red naming both sides, reverted and green again — and
driven in the suite as a **loop** rather than as a comparison: one fixture
`versions.env`, one binary output held constant, one edit, verdict
`pass → fail → pass`. M7c adds the other half of the same loop as clause 1's
third case: the **binary** skewed instead of the pin.

## The disposition of clause 2, for cx3576

**Decided 2026-08-26 by the user, on L2's recommendation**, matching RFCT-111
clause 3. Both actors are named because both acted: L2 measured the walls and
made the recommendation; the user took the decision. RFCT-113 closes **over an
undischarged clause**, on **two named physical constraints** — not on any
judgement that cx3576 is fine.

**The two constraints, measured, and they are independent:**

1. **There is no cx3576 factory root to execute anything in.** The chain cannot
   be built here — no `binfmt_misc`, no builder advertising `linux/arm64`, and
   since RFCT-111 M5b no QEMU-bundled `docker-container` fallback — and
   `board/cx3576/rootfs/` carries no `modules.tar`, so even a capable host needs
   the BSP drop first.
2. **Even given the image, this host cannot execute it.** Measured against a
   *pulled upstream* arm64 image rather than ours, so it is a statement about the
   host: `docker run --platform linux/arm64 arm64v8/busybox /bin/true` → rc=255,
   `exec format error`. The runner catches this in `preflight`, before concluding
   anything about any artifact, and says so naming the platform and the remedy.

**This is a DISPOSITION, and it is none of the other three things this campaign
does to a clause.** It is not an AMENDMENT: clause 2's text is unchanged and says
exactly what it always said. It is not a SATISFACTION: the clause is not made
true, and nothing measured here makes it true. It is not a gate's call: a gate
states what it measured, and the decision to close over a live clause was taken
above it. The campaign's ledger now reads **six amendments, one satisfaction**
(RFCT-110's clause 3, closed by the verify image pin) **and two dispositions**
(RFCT-111's clause 3, and this one) — three different things that should not be
read as one.

**Precedent: RFCT-108 M2, and RFCT-111 M5.** The same physical constraint took an
applied default at M2 and a disposition at M5, for the same stated reason: the
reason is a host capability, not an implementation shortfall. This is the
campaign's third use of that rule.

**REVERTIBLE, and here is the trigger.** The first **arm64-capable host with the
BSP drop** to build a cx3576 factory root and run the smoke list against it
settles clause 2 one way or the other. **A failure there REOPENS RFCT-113.**
That sentence is what makes "revertible" mean something: without a named trigger
it is only a softer way of saying closed. `.gitea/workflows/privileged.yml`'s
deep lane is where it happens — its runner label already promises the arm64
emulation, `make os-image-cx3576-v2` runs the smoke list as part of the build,
and M7c added `make os-factory-root-gate` and `make os-smoke-negative-test`
beside it. **None of the three has ever run on cx3576.**

## The `os/tests/factory-root-gate` decision

**M7c's, 2026-08-26: it becomes a real target.** `make os-factory-root-gate`,
docker-requiring like `os-verify-cx3576-v2`, and a step in the deep lane. The
alternative — delete the directory and leave the recipe in
`os/rootfs/stages/README.md` — was rejected because the invariant it checks,
*the image the smoke run executes in is byte-for-byte the tree the device
ships*, is the assumption **every other M7 result rests on** and nothing else
checks it. The two trees come from two exports of one stage, so nothing about
their agreement is structural.

**It was not re-run green at close**, and that is stated rather than absorbed: it
needs a MATCHED PAIR — `factory-root.oci` and `rootfs-verity.img` from one build
— and no such pair existed on the closing host. Its REFUSAL was driven
(`rootfs-verity.img is missing or empty`, exit 1, before comparing anything).
M7a's own green run of the same script, 9,240 entries compared four ways with
every comparison driven from the failing side, is in
`os/tests/factory-root-gate/README.md`.

## The floor at close

Every line, at `07830c7`, all `rc=0`. The left column is the floor as measured
at `4c95928` (the head M7c merged); the right is this tree.

| target | at `4c95928` | at close | why it moved |
|---|---|---|---|
| `docs-verify` | 375/375 | 375/375 | — |
| `docs-verify-test` | 8/8 | 8/8 | — |
| `os-shell-pipefail-lint` | 29/29, 29 scanned | 29/29, **29 scanned** | no shell was added or deleted. The negative tests are TypeScript, and the Dockerfiles they build are generated at run time into a gitignored scratch directory, so the lint's file set is unchanged. |
| `os-layout-lint` | 26/26 | 26/26 | — |
| `os-layout-lint-test` | 42/42 | 42/42 | — |
| `os-verify-test` | 1045/1045, 30 files | **1066/1066, 31 files** | +5 in `smoke.test.ts` (four measured exit-status cases replacing three fabricated ones, plus the count lock the re-run mutation sweep showed was missing) and +16 in the new `smoke-negative.test.ts`. |
| `os-build-test` | 689/689, 25 files | 689/689, 25 files | — |
| `os-health-test` | 57/57 | 57/57 | — |
| `build-env` | 21 Dockerfile(s) agree | **21 Dockerfile(s) agree** | same reason as the shell lint: nothing added a tracked Dockerfile. |

`os-build-test` was run **alone**, not concurrently with anything else, and did
not flake: `689 pass, 0 fail, 3892 expect() calls, 25 files, 226.75s`. The known
5s-hook-budget timeout — which reports `N pass / 1 fail` with the failing entry
named `(unnamed)` and a total one higher — did not appear.

`os-verify-test` was also run with `_out/` **absent**, in a `git worktree add
--detach` on the same filesystem as the repository: `RESULT: PASS (1066/1066
tests)`. The two new docker-requiring targets were driven there too, and both
**refuse** rather than skipping — `error: x64: …/_out/x64/factory-root.txt does
not exist`, exit 1, before executing anything. The worktree was removed and
`git worktree prune` run.

### What was NOT run, named rather than implied

- **`make os-factory-root-gate` green.** It needs a matched pair and no such pair
  exists on this host; its refusal was driven. See the section above.
- **Anything on cx3576**, for the two measured reasons in the disposition.
- **A real rootfs build.** The smoke run and the three negative tests were driven
  against the real x64 factory root M7d built — still in this host's docker image
  store, carrying commit `60b9ccc76939` — with the `_out/x64/` record around it
  **reconstructed by hand**, which each of those files says on its own first
  line. The image is real; the record is not the one a build wrote.
