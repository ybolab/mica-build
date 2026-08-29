# RFCT-221 PLAN-012 container-engine audit: milestone verdicts and closeout recommendation

- **status**: completed — M1, M2 and M4 implemented, M3 implemented with one measured divergence, M5 half open; recommend closing PLAN-012 with a dated amendment plus two tasks routed to PLAN-025
- **priority**: P1
- **owner**: bkd/y5dics1b
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-024 (M1)

## 1. What was audited, and against what

PLAN-024 M1(b): PLAN-012, the container-engine plan, read milestone by
milestone and decision by decision against the tree at commit `a86ab46` on
branch `bkd/y5dics1b`. Nothing was implemented, and no plan file was edited:
the two files this task writes are this record and its row in
`docs/task/index.md`.

The plan is the reason PLAN-024 exists. Its own status head reads `proposal`
(`docs/plan/PLAN-012.md:3`), its `relatedTask` (`docs/plan/PLAN-012.md:7`) is
empty, its index row is unticked — "PLAN-012 Container engine"
(`docs/plan/index.md:45`) — and every milestone checkbox is untouched, while
RFCT-101, RFCT-102 and RFCT-103 shipped four of its five milestones.
Every verdict below was reached by opening the artifact, not by reading a task
record: where a record's claim and the tree disagree, section 4 names the
disagreement.

## 2. Milestones

### M1 — the build directory, the pinned versions, the README, `make podman`

**implemented, at a different path than either the prose or the milestone row
names.**

The directory is `os/pkgs/podman`, headed "the container engine, built from
source" (`os/pkgs/podman/README.md:1`). Its four required artifacts are all
present:

- `versions.env`, one tag and one hash per upstream — `PODMAN_VERSION=v5.8.6`
  (`os/pkgs/podman/versions.env:27`).
- The `make` target, which delegates to the build script:
  `bash os/pkgs/podman/build.sh` (`Makefile:287`).
- A README that states what is built and how to bump it, and names the pattern
  it follows — "Same arrangement as" (`os/pkgs/podman/README.md:4`) the board's
  kernel build.
- Seven binaries, hashed on export: `sha256sum podman quadlet crun conmon
  catatonit netavark aardvark-dns` (`os/pkgs/podman/Dockerfile:361`).

Two of the three build assertions the milestone row demands are in the verify
stage: the target-architecture ELF check, and `file -b catatonit | grep -q
'statically linked'` (`os/pkgs/podman/Dockerfile:353`). The pinned-hash
requirement is enforced with no soft mode: `if [ "${want}" = "PENDING" ]; then`
(`os/pkgs/podman/Dockerfile:140`).

**Where it diverged.** Three divergences, all deliberate and all recorded in
the tree rather than in the plan:

1. **Location.** D2's prose asks for a top-level directory described as
   "is a self-contained build directory" (`docs/plan/PLAN-012.md:130`), modelled
   on the board kernel build; the milestone row instead names `os/podman/` in
   "builds the seven binaries for arm64 from pinned sources"
   (`docs/plan/PLAN-012.md:273`). It landed at `os/pkgs/podman`, which is
   neither, because PLAN-019 moved every buildable component under `os/pkgs`.
   The plan's own comparison anchor moved with it: the kernel build is now at
   `os/boards/cx3576/bsp/kernel`.
2. **Output directory.** D2 names `out/`; the build writes `out-<arch>/` so an
   arm64 and an amd64 set can coexist.
3. **The third assertion was retired, not shipped.** The milestone row asks
   that every binary's `NEEDED` soname be checked against a list generated from
   the packed rootfs. That check does not exist and was deliberately removed:
   "NO image-libs.txt, and no rootfs prerequisite."
   (`os/pkgs/podman/build.sh:97`). The reason given is a build-order cycle — the
   rootfs stages the engine, so the engine's check could not depend on the
   rootfs — and the check moved into the image build, where the real loader
   answers against the real binaries (`os/rootfs/scripts/podman-assert.sh`).
   The replacement is stronger than the plan's design. The plan was never
   updated to say so.

### M2 — image wiring and the assertions that prove it

**implemented.**

- Staged by the rootfs build: `declined containers || FEATURE_ARGS+=(--arg
  PODMAN_DIR="_out/$MOS_BOARD/podman")` (`os/rootfs/build-v2.sh:642`).
- Installed by the feature stage: `COPY ${PODMAN_DIR}/ /tmp/podman/`
  (`os/rootfs/stages/31-feature-containers.Dockerfile:103`).
- Storage root on DATA: `graphroot = "/srv/containers/storage"`
  (`os/rootfs/overlay-v2/etc/containers/storage.conf:23`), and `/srv` is the
  growable partition — "ext4, label data (/srv)"
  (`os/boards/cx3576/board.env:29`).
- The unit that ships installed and not enabled is the STATE bind:
  `What=/mnt/state/quadlet`
  (`os/rootfs/overlay-v2/etc/systemd/system/etc-containers-systemd.mount:34`).

The verifier carries ten conclusions about the engine, four of which are
exactly the four the milestone row asks for: `container-engine-no-units`
(`os/verify/src/checks-engine.ts:181`), which is the "no engine socket without
the switch" control in its strongest form — no podman unit of any name exists;
`container-engine-not-enabled` (`os/verify/src/checks-engine.ts:340`);
`container-engine-graphroot-on-data` (`os/verify/src/checks-engine.ts:367`);
and `container-engine-quadlet-bind` (`os/verify/src/checks-engine.ts:427`).

The negative controls exist and are richer than the row's description — for
example "a STATICALLY ENABLED mount fails"
(`os/verify/src/checks-engine.test.ts:495`), plus a dangling-symlink case, a
retargeted mount, and a tmpfs-backed mount.

**Where it diverged.** The row names two files that no longer exist:
`Dockerfile.v2` (`docs/plan/PLAN-012.md:274`), replaced by the per-stage
Dockerfile chain, and `os/ui-location-test.sh` (`docs/plan/PLAN-012.md:274`),
which moved to `os/tests/` and was then deleted with the shell verifier at
`6eadc65`, its cases ported into the `os/verify` TypeScript suite at parity.
The mechanism also changed: D3 asks for a podman unit "installed and not
enabled" on the `hostapd@` model, but upstream's units are never built, so
what is installed-and-not-enabled is the Quadlet mount unit instead. That is a
better fit for a daemonless engine, and it is what the code documents.

### M3 — the settings key, the reconciler, the apid pane

**implemented, with one clause of its verification genuinely open.**

- The key: `pub struct ContainerSettings {`
  (`os/pkgs/mosd/mosd-settings/src/model.rs:70`), holding one boolean, default
  false.
- The reconciler: `pub struct ContainerReconciler<C: UnitControl> {`
  (`os/pkgs/mosd/mosd/src/reconciler/container.rs:64`), with seven unit tests
  driven through a mock unit driver — `MockUnitControl::new("inactive",
  "disabled")` (`os/pkgs/mosd/mosd/src/reconciler/container/tests.rs:36`).
- The apid pane: `.route("/containers", get(containers_form))`
  (`os/pkgs/mosd/apid/src/routes.rs:191`), with route tests that assert the
  written path — `vec!["container.enabled"]`
  (`os/pkgs/mosd/apid/src/tests.rs:3081`).

**Where it diverged, and this one has teeth.** D3 says the switch is
"an MQTT-addressable path for free" (`docs/plan/PLAN-012.md:169`) because
PLAN-011 M2 made the platform-config subtrees writable through the item
interface. It is not. The writable set is a fixed list —
`const WRITABLE_SUBTREES: [&str; 5] = [` (`os/pkgs/mosd/mosd/src/tree.rs:51`)
— holding `hostname`, `network`, `wifi.client`, `wifi.ap` and `access.ssh`.
`container` is not among them, so `/container/enabled` projects as a read-only
item: it is writable only through the daemon's own settings method, which is
the path apid uses. The milestone's third verification clause, a live-bus test
that the item is writable, therefore has nothing to test and does not exist —
the live-bus writability test lists five paths and `container` is not one of
them.

`docs/design/containers.md` states the untrue half of this to the integrator:
the switch is described as reachable over the bus as `com.mos.Item1`
(`docs/design/containers.md:38`) "and over MQTT"
(`docs/design/containers.md:38`). Either the subtree is added to the writable
list or the sentence is corrected; today the document promises a capability
the daemon does not offer.

### M4 — Quadlet wired to its generator directory, and the integrator's guide

**implemented.**

The directory is the measured one, bound from STATE by a unit whose target is
`What=/mnt/state/quadlet`
(`os/rootfs/overlay-v2/etc/systemd/system/etc-containers-systemd.mount:34`),
and `docs/design/containers.md` exists at 259 lines with ten sections. The test the row demands is real and runs the
shipped generator, not a description of it:
`QUADLET="${MOS_QUADLET_BIN:-${REPO_ROOT}/os/pkgs/podman/out-arm64/quadlet}"`
(`os/tests/quadlet-doc-test.sh:23`), wired as `bash
os/tests/quadlet-doc-test.sh` (`Makefile:279`). Examples are extracted from the
document by marker — `<!-- quadlet: web.container -->`
(`docs/design/containers.md:79`) — and the count is floored so a document that
lost its examples cannot pass on the one left: "it cannot demonstrate those in
fewer than five files" (`os/tests/quadlet-doc-test.sh:73`).

D4's content list is covered, including the security consequence in the
operator's terms: "Containers on this device run as root."
(`docs/design/containers.md:48`).

**One clause of D4 has no counterpart in the document.** D4 asks for "ports and
host networking, and which of the two the appliance's firewall posture
expects". The document does demonstrate a published port — `PublishPort`
(`docs/design/containers.md:86`) — but says nothing about host networking or the
firewall posture. This is a gap inside a delivered document, not a missing
deliverable.

### M5 — the pinned-version file plus a scheduled upstream-tag check

**half implemented, half genuinely open.**

`versions.env` exists and is the whole upgrade interface, pinning
`PODMAN_VERSION=v5.8.6` (`os/pkgs/podman/versions.env:27`). The privileged
CI lane exists and is already scheduled: `cron: '0 3 * * 1'`
(`.github/workflows/privileged.yml:65`).

The upstream-tag check does not exist. Nothing in the tree queries an upstream
release feed, compares it to a pin, or fails when a pin falls behind; the only
places the phrase occurs are the plan and the README's own statement of the
obligation — "scheduled upstream-tag check in the privileged CI lane"
(`os/pkgs/podman/README.md:161`). Six upstreams in three languages are pinned
with nothing watching them, which is precisely the risk the plan named and
called not optional.

## 3. Decisions

- **D1** (Podman, from source, root mode, the seven-binary artifact set) —
  **implemented**; the set is built and hashed on export —
  `sha256sum podman quadlet crun conmon catatonit netavark aardvark-dns`
  (`os/pkgs/podman/Dockerfile:361`). The revisit trigger it records is a
  future condition, not a deliverable.
- **D2** (self-contained build directory) — **implemented at a different
  path**, see M1. The `podman/` the decision names —
  "is a self-contained build directory" (`docs/plan/PLAN-012.md:130`) —
  does not exist; `os/pkgs/podman` does.
- **D3** (`container.enabled`, default false, reconciler) — **implemented**,
  except the bus-item writability claim
  "an MQTT-addressable path for free" (`docs/plan/PLAN-012.md:169`), which is
  contradicted by `const WRITABLE_SUBTREES: [&str; 5] = [`
  (`os/pkgs/mosd/mosd/src/tree.rs:51`).
- **D4** (Quadlet as the interface, the document as the deliverable) —
  **implemented**, with the firewall-posture clause unwritten, see M4.
- **D5** (root mode; rootless not built) — **implemented**. The consequence is
  stated in the pane in the operator's own terms:
  "Containers on this device run as root."
  (`os/pkgs/mosd/apid/src/routes.rs:3196`). The four rootless-only binaries are
  absent from the built set, whose whole contents are
  `sha256sum podman quadlet crun conmon catatonit netavark aardvark-dns`
  (`os/pkgs/podman/Dockerfile:361`).
- **D6** (share the update-state shape rather than duplicate it) —
  **superseded**, and it carried a review rather than an artifact. D4 removed
  the thing it was about: mos ships no container-delivered application update,
  no auto-update and no orchestration, so no second representation of
  "something is installing" was ever created. The reconciler publishes its own
  operational shape — mount state, Quadlet files, generated units, started and
  stopped units — and touches no update key; the type that does this is
  `pub struct ContainerReconciler<C: UnitControl> {`
  (`os/pkgs/mosd/mosd/src/reconciler/container.rs:64`). No record
  in `docs/task` documents the review D6 asked for; the audit's finding is that
  the review became moot rather than that it was skipped.

## 4. Discrepancies between the plan's own claims and the tree

1. **The plan says it is a proposal and was never approved.** Its status head
   still reads `proposal` (`docs/plan/PLAN-012.md:3`), its `relatedTask`
   (`docs/plan/PLAN-012.md:7`) is empty, and its index row is unticked —
   "PLAN-012 Container engine" (`docs/plan/index.md:45`). All three describe a
   plan nobody has started. Four of five milestones are in the shipped image. This
   is the checkbox-versus-reality gap PLAN-024 exists to measure, and it is the
   largest one in this plan.
2. **`relatedTask` is empty while three task records implement the plan.**
   RFCT-101 and RFCT-103 name PLAN-012 milestones in their titles, and RFCT-102
   works on the engine and explicitly defers M3. None of the three is listed on
   the plan. RFCT-100 mentions PLAN-012 as context only and is not one of them.
3. **RFCT-101's status head describes a mechanism that no longer exists.** It
   claims "every unit masked" (`docs/task/RFCT-101.md:3`). Nothing is masked
   today: upstream's units are never built, and the verifier asserts their
   total absence — `container-engine-no-units`
   (`os/verify/src/checks-engine.ts:181`). The claim was true of trixie's packaged podman
   and was superseded within the same campaign by RFCT-103's from-source build.
   Downgraded from evidence to history.
4. **RFCT-101, RFCT-102 and RFCT-103 all report a suite that no longer
   exists.** Each status head counts cases in `os/ui-location-test.sh`
   (`docs/task/RFCT-103.md:3`). That file was moved to `os/tests/` and then
   deleted with the shell verifier; its cases live in `os/verify/src` now. The
   counts remain valid as history and are unverifiable as present-tense claims.
5. **The M1 row's third assertion was retired rather than built**, and the
   plan still asks for a list "generated from the packed rootfs"
   (`docs/plan/PLAN-012.md:273`). See M1.
6. **`os/pkgs/podman/README.md` still describes the retired assertion.**
   The README tells the reader the verify stage checks each soname against
   `image-libs.txt` (`os/pkgs/podman/README.md:150`), a list the build script
   beside it explicitly removed:
   "NO image-libs.txt, and no rootfs prerequisite."
   (`os/pkgs/podman/build.sh:97`). The README contradicts the build.
7. **`docs/design/containers.md` promises bus and MQTT writability the daemon
   does not implement.** The document offers the switch over the bus as
   `com.mos.Item1` (`docs/design/containers.md:38`). See M3.

## 5. Routed to sibling plans

Nothing in this audit belongs to PLAN-023: the apid pane, its route and its
tests are all present and correct, and the audit claims no work there.

Three items are routed to **PLAN-025**, which owns `os/**` and CI:

- **R1 — the M5 upstream-tag check.** CI plus `os/pkgs/podman`. Genuinely open;
  proposed as a task below.
- **R2 — `container` is not a writable bus subtree.** `os/pkgs/mosd/mosd`, and
  the design document that describes it. Genuinely open; proposed as a task
  below.
- **R3 — two stale paragraphs.** The engine README still names
  `image-libs.txt` (`os/pkgs/podman/README.md:150`), and
  `docs/design/containers.md` lacks D4's
  firewall-posture clause. Both are documentation repairs inside delivered
  artifacts, too small to be their own task; fold them into whichever PLAN-025
  task next touches those files.

## 6. Recommendation

Mixed, as PLAN-024 M1 allows: **close M1, M2, M3 and M4 with a dated
amendment; keep M5 open as one task, and raise the D3 divergence as a second.**
Both open items are `os/**` or CI work and belong to PLAN-025, not to
PLAN-024's own reservation.

### 6a. Close with an amendment (M1, M2, M3, M4)

The plan's status line should become:

```
- **status**: completed — M1-M4 shipped by RFCT-101..RFCT-103 (2026-08-23/24); M5 open, carried by PLAN-025. See Amendment 1.
- **approvedAt**: 2026-08-28 (retroactive; see Amendment 1)
- **completedAt**: 2026-08-28
- **relatedTask**: RFCT-101, RFCT-102, RFCT-103, RFCT-221
```

and its index row's marker should follow to `[x]`. Literal amendment text, to
be appended to `docs/plan/PLAN-012.md` by whoever holds the write scope — this
record does not append it:

```
## Amendment 1 — 2026-08-28, retroactive approval and closeout

This plan was implemented while its own status head read `proposal` and its
`approvedAt` was empty. RFCT-101, RFCT-102 and RFCT-103 shipped M1, M2, M3 and
M4 between 2026-08-23 and 2026-08-24; RFCT-221 audited the result against the
tree at `a86ab46` and this amendment records what was actually built, so that
the plan and the tree stop disagreeing.

Approved retroactively. The four shipped milestones are marked done. M5 is not
done and is carried forward to PLAN-025.

**What was built differently from what was decided.**

1. The build directory is `os/pkgs/podman`, not the top-level `podman/` D2
   names and not the `os/podman/` the M1 row names. PLAN-019 moved every
   buildable component under `os/pkgs`, and the comparison anchor D2 uses moved
   with it, to `os/boards/cx3576/bsp/kernel`. Output is `out-<arch>/` rather
   than `out/`, so two architectures can coexist.

2. The M1 row's third build assertion — every `NEEDED` soname checked against
   a library list generated from the packed rootfs — was built, found to be a
   build-order cycle, and removed. `os/pkgs/podman/build.sh` records the
   removal and its reasoning. The check now runs inside the image build, where
   the real loader answers against the real binaries in the assembled root.
   That is a stronger claim than the one this plan specified, and it is the
   claim the tree makes.

3. D3 asks for a podman unit installed and not enabled, on the `hostapd@`
   model. Upstream's units are never built, so the image contains none, and
   what ships installed-and-not-enabled is `etc-containers-systemd.mount`
   instead. The switch gates a bind mount rather than a service, which is what
   a daemonless engine allows.

4. D3's claim that the switch is a writable bus item and an MQTT-addressable
   path "for free" is not true of the tree. `container` is absent from mosd's
   fixed writable-subtree list, so `/container/enabled` projects read-only and
   is written only through the daemon's settings method, which is the path apid
   uses. `docs/design/containers.md` states the untrue version to integrators.
   Closing this is PLAN-025's, and it is a decision — widen the writable list,
   or correct the document — not a defect to be patched either way by default.

5. M2's row names `Dockerfile.v2` and `os/ui-location-test.sh`. Both are gone:
   the rootfs is a chain of per-stage Dockerfiles, and the shell verifier was
   deleted at full parity with the `os/verify` TypeScript suite, which is where
   the engine's ten conclusions and their negative controls now live.

6. D6 is moot rather than discharged. It asked that a container-delivered
   application update reuse the existing update-state shape; D4 decided mos
   ships no orchestration and no auto-update, so no such update path was
   built and no second shape was invented.

**What is not closed.** M5's scheduled upstream-tag check does not exist.
`versions.env` pins six upstreams in three languages and nothing watches them.
This plan's own Risks section calls that mitigation not optional. It is carried
to PLAN-025 rather than left as an unticked box here.
```

### 6b. Tasks that remain (numbers proposed, not allocated)

Both are proposed for PLAN-025's reservation. The numbers below are drawn from
the RFCT-223..229 pool as PLAN-024 M1 instructs; they are **proposed, not
allocated**, and this record creates no files for them.

**RFCT-223 — the scheduled upstream-tag check for the container engine's six
pins (PLAN-012 M5).**

Scope: add a check that reads each pin in `os/pkgs/podman/versions.env`, asks
each upstream for its newest release tag, and fails when a pin is behind. Six
upstreams, three of them on different tag conventions (`v`-prefixed and not),
and one — catatonit — whose upstream is quiet by nature, so the check must
distinguish "behind" from "unchanged" and must not treat a two-year-old
newest-tag as a failure. Wire it into the privileged lane's existing weekly
schedule rather than adding a second cron. The check needs network access,
which the fast lane does not have, and that is why it belongs in the privileged
lane.

Acceptance: a run against the current tree is green; a run with any one pin
edited backwards is red and names that component, its pinned tag and the newer
one; the failure text tells the reader to edit `versions.env` and re-run
`make podman`. The catatonit case is covered by a test, not by an assumption.

Files: `.github/workflows/privileged.yml`, a new checker under `os/pkgs/podman`
or `os/tools`, `Makefile` if it gets a target, `os/pkgs/podman/README.md`.

**RFCT-224 — decide and settle `container.enabled`'s bus writability.**

Scope: `container` is not in mosd's writable-subtree list, so the switch is not
a writable item and is not MQTT-addressable, while PLAN-012 D3 and
`docs/design/containers.md` both say it is. This is a decision before it is an
edit: either add `container` to the writable subtrees — with the same care the
list's own comment demands, since writing it grants root-capable containers to
anything that can reach the bus — or correct the plan and the design document
to say the switch is written through the settings method only. Note that `mqtt`
is in the same position, so whichever way this goes, the answer should be
stated for the class rather than for one key.

Acceptance: the design document and the daemon agree, proven by a test. If the
subtree is widened, the live-bus writability test lists `/container/enabled`
among the writable paths and the item round-trips; if the document is
corrected instead, its claim about bus and MQTT reachability matches what the
daemon exposes and a test pins the read-only projection.

Files: `os/pkgs/mosd/mosd/src/tree.rs`, `os/pkgs/mosd/mosd/tests/tree.rs`,
`docs/design/containers.md`, `docs/design/bus.md` if it carries the same claim,
and `docs/plan/PLAN-012.md` only if the closeout amendment has not already
recorded it.

<!-- dated-record: the PLAN-024 M1 audit, frozen at `a86ab46`; its citations name the plan heads and the sibling plans as they stood before the PLAN-024 M2 closeout (RFCT-227) amended them, and re-pointing them would falsify what was measured when; exempt from docs/verify-citations.sh (RFCT-172) -->
