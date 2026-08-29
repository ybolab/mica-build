# RFCT-235 The podman base at two architectures in one build: MOS_BUILD_BASE_NATIVE

- **status**: completed
- **priority**: P2
- **owner**: bkd/c36ol4x1
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-025 (M2 residue, wall 1); executed under PLAN-027 M7

The cx3576 IMAGE build stops at os/pkgs/podman: its Dockerfile's
`FROM --platform=$BUILDPLATFORM ${MOS_BUILD_BASE} AS src` needs the build
base at the HOST architecture while the rest of the build runs at the
target's — one FROM cannot resolve one name to two architectures. The fix is
a MOS_BUILD_BASE_NATIVE build-arg resolved at the host architecture and
carried as a second OCI layout. Newly possible since the architecture-
qualified tag scheme landed (before it there was no amd64 base to resolve to
on a host that had built arm64); deliberately unshipped by RFCT-234 because
proving it costs an arm64 podman/crun/netavark/aardvark-dns compile under
emulation, and the campaign does not ship wiring it cannot measure.

Claiming this task requires a plan whose scope admits os/pkgs/podman. Wall 3
(os/rootfs needs a real host binfmt_misc registration for its smoke run) is
NOT this task and no tagging change reaches it; the booted cx3576 smoke
remains a stated obligation recorded in RFCT-206 section 7.

## Dependencies

- **blocked by**: (none — the tag scheme it needs is on main)
- **blocks**: the cx3576 image build on binfmt-less hosts.

## 1. What the defect actually was

Not what this task's own opening paragraph says. It says one `FROM` "cannot
resolve one name to two architectures", which reads as a refusal. Measured
here, at both driver paths, it RESOLVES -- to the wrong architecture, silently.

`--platform` selects a manifest out of an INDEX. A digest-pinned upstream
reference is an index; a `localhost/mos-build-*` tag is one manifest and no
index, so there is nothing to select. Docker serves what the tag holds,
buildkit still believes the stage runs at the platform the `FROM` named,
applies no emulator, and the stage dies on its first `RUN`. A minimal
two-stage reproduction, `linux/arm64`, the arm64 base given to the `src`
stage under `--platform=$BUILDPLATFORM`:

    # docker driver, tag out of the local image store
    #4 resolve localhost/mos-build-base:arm64@sha256:b1f5a46d... 0.0s done
    #5 0.444 exec /bin/sh: exec format error

    # mos-arm64 docker-container driver, base handed over as an OCI layout
    #6 [context localhost/mos-build-base:arm64] OCI load from client
    #6 resolve localhost/mos-build-base:arm64@sha256:b1f5a46d... 0.0s done
    #7 0.573 exec /bin/sh: exec format error

Neither report names the base, the architecture or the argument, and both are
the same `exec format error` a MISSING emulator gives. RFCT-231 lines 232-234
already had this right for the layout path -- "buildx does not refuse the
mismatch -- it serves what the layout holds and the stage dies inside" -- and
this task's opening paragraph did not. The record is corrected here rather than
in RFCT-231, which is frozen.

## 2. What was built

- `os/pkgs/podman/Dockerfile`: a fifth `ARG MOS_BUILD_BASE_NATIVE`, used by the
  `src` stage's `--platform=$BUILDPLATFORM` FROM and by nothing else. The other
  four keep their meaning; every compiling stage stays at the target's
  architecture.
- `os/pkgs/podman/build.sh`: `NATIVE_ARCH` from `uname -m`, mapped exactly as
  `os/build-env/build.sh` maps it, and a SECOND `os/build-env/from.sh` call at
  that architecture -- `--arch` is per-invocation, so a second architecture is
  a second call, not a fifth pair on the first. A fifth OCI layout goes to a
  container-driver builder only when `NATIVE_ARCH` differs from `MOS_ARCH`: on
  a native build both arguments resolve to one tag, and a second
  `--build-context` under the same name would be one name bound twice plus a
  300 MB export to restate what was already stated.
- `os/pkgs/podman/README.md`: the five-argument table, why `src` is the odd
  stage, and that a cross build needs BOTH builder families on the host.

`uname -m` and not `docker buildx inspect`: inspect reports the `mos-arm64`
builder as `linux/amd64, linux/386` on this host while a throwaway build on it
prints `aarch64` (`docs/design/build-harness.md:204-222`). No architecture claim
in this record rests on an inspection.

`os/pkgs/podman/versions.env` and `.github/workflows/**` were not touched; they
belong to RFCT-223.

## 3. Acceptance: the amd64 control first, then arm64

**The control, and its honest limit.** `MOS_ARCH=amd64 bash
os/pkgs/podman/build.sh` exited `AMD64_RC=0` with seven x86-64 ELFs:

      podman            64752 KiB  ELF 64-bit LSB executable, x86-64
      quadlet            3571 KiB  ELF 64-bit LSB executable, x86-64
      crun               2882 KiB  ELF 64-bit LSB pie executable, x86-64
      conmon              171 KiB  ELF 64-bit LSB pie executable, x86-64
      catatonit           819 KiB  ELF 64-bit LSB executable, x86-64
      netavark          14230 KiB  ELF 64-bit LSB pie executable, x86-64
      aardvark-dns       3214 KiB  ELF 64-bit LSB pie executable, x86-64
      TOTAL             89647 KiB

It completed in 15 seconds with every stage `CACHED`. That is the expected
result -- adding an `ARG` changes no stage's cache key -- but it means the
control re-resolved the FROMs without re-executing the compiles. It did resolve
them: `#9 [src 1/3] FROM localhost/mos-build-base:amd64@sha256:abcc14d9...`.
And on amd64 `MOS_BUILD_BASE` and `MOS_BUILD_BASE_NATIVE` resolve to the SAME
tag, so the control cannot distinguish the two arguments at all. It establishes
that nothing regressed; the arm64 run is the one that proves the fix.

**The arm64 build.** `MOS_ARCH=arm64 bash os/pkgs/podman/build.sh` on the
`mos-arm64` docker-container builder, 21:33:41 to 22:35:53 UTC -- 62 minutes
under emulation -- exited `ARM64_RC=0`:

    === os/pkgs/podman/out-arm64 ===
      podman            60061 KiB  ELF 64-bit LSB executable, ARM aarch64
      quadlet            3443 KiB  ELF 64-bit LSB executable, ARM aarch64
      crun               3018 KiB  ELF 64-bit LSB pie executable, ARM aarch64
      conmon              218 KiB  ELF 64-bit LSB pie executable, ARM aarch64
      catatonit           782 KiB  ELF 64-bit LSB executable, ARM aarch64
      netavark          14444 KiB  ELF 64-bit LSB pie executable, ARM aarch64
      aardvark-dns       3300 KiB  ELF 64-bit LSB pie executable, ARM aarch64
      TOTAL             85273 KiB
    ARM64_RC=0

Both bases resolved in that ONE build, which is the whole claim:

    #5  [context localhost/mos-build-base:arm64] load metadata ... sha256:b1f5a46d...
    #8  [context localhost/mos-build-base:amd64] load metadata ... sha256:abcc14d9...
    #10 [context localhost/mos-build-base:amd64] OCI load from client
    #13 [context localhost/mos-build-base:arm64] OCI load from client

`grep -c 'exec format error'` over that log returns **0**.

**Where the `src` stage's execution is actually recorded, stated precisely.**
In the completing run `#15`-`#19` report `CACHED`. The stage EXECUTED in an
earlier run of the same build, whose log is the one that holds the evidence:

    #15 DONE 81.8s
    #17 11.54 ok podman v5.8.6 c2902305ef17a1207ee8c90e645cbbff8ffdf4a2dd493166cdd9cc8b04ef1f8c
    #17 21.27 ok crun 1.29.1 d5f2f27ea25554ad28c4163749cd3060f39ba48461b5dc6e80cf676b53ba5515
    #17 22.52 ok conmon v2.2.1 d3e602a1ae17dc73d1ee1b099a7510202878344f4546612547a86daee67be079
    #17 23.67 ok netavark v2.1.0 e6abbd7206bbdb431a7d6b186e8dad1d37e77a4522fe8104b6ce1785ea26bd8c

That run was at `aa9b670` and the completing run at `9925a5f`. The cache hit is
over identical build inputs, proved rather than assumed: `git diff --stat
aa9b670 9925a5f` is `docs/design/build-harness.md | 46 ++++` and nothing else,
and `os/pkgs/podman/Dockerfile` and `build.sh` hash identically at both commits
(`717f15bd...` and `41e0263f...`). The `src` stage ran on the amd64 base inside
a `linux/arm64` build and fetched and hash-verified all six upstreams --
which is exactly the step that previously died before its first command.

The shape was also proved before any of it was written, with a throwaway whose
`src` stood on the amd64 base and whose `verify` stood on the arm64 one, built
`--platform linux/arm64` on `mos-arm64`:

    #9 0.809 SRCARCH=x86_64 VERIFYARCH=aarch64

## 4. Five `InvalidDefaultArgInFrom` warnings, one of them new

The arm64 build printed five, and the fifth is mine:

    - ARG ${MOS_BUILD_C} ... (line 157)
    - ARG ${MOS_BUILD_RUST} ... (line 238)
    - ARG ${MOS_BUILD_GO} ... (line 278)
    - ARG ${MOS_BUILD_BASE} ... (line 333)
    - ARG ${MOS_BUILD_BASE_NATIVE} ... (line 102)

Four pre-existed. The fifth is the same shape as the four and has the same
cause, which the Dockerfile states as a decision: these arguments carry NO
default, deliberately, so that a missing value fails loudly instead of
building green against an image nobody chose. `MOS_BUILD_BASE_NATIVE` is
consistent with that, so this is not a regression -- but it is a warning count
that went from four to five and a reader should hear it here rather than find
it in a log.

## 5. The census cost of this change, in one place

Replacing line 74's text forced this; nothing else did. Two LIVE records quoted
that exact line, and the quote was DELETED rather than moved, so re-anchoring
had no target and is forbidden for a dated record besides:

| | |
| --- | --- |
| forced by | the replacement of `os/pkgs/podman/Dockerfile:74`'s text |
| files marked | `docs/task/RFCT-231.md` (line 230), `docs/task/RFCT-234.md` (line 352) |
| instrument | the `<!-- dated-record: ... -->` marker, appended to each; no word of either record was edited |
| citations exempted | **16**, all of them ARMED, content-checked anchors |
| of which broken | **2** -- one prose citation of `Dockerfile:74` per file |
| of which collateral | **14** still-valid citations, into `os/build-env/build.sh` (10), `os/rootfs/build-v2.sh` (2) and `os/tests/quadlet-doc-test.sh:83-85` (2) |
| resolution-only anchors lost | **0** -- that counter is 914 before and 914 after |
| floor moved | `os 1847 -> 1831` in `docs/verify-citations-baseline.txt` |
| base commit for 1847 | `c5f7e96`, where the gate read 2170/2170 PASS |
| commit that did it | `f997ea5`, the marker and the floor together, as that file requires of an intended drop |

The 14 are the real price: they were passing and they are now unchecked. The
counterfactual in section 6 is why the trade was taken rather than avoided.

## 6. The counterfactual: the marker was forced, and that is measured

The marker was added BEFORE the code change, so the red state never existed to
be observed -- an assertion standing where a measurement belonged. It was
therefore built and run: the code change present, both markers removed, the
floor put back to 1847 so a census failure could not mask what was being looked
for. Both sides pinned to a sha, never a branch name.

    pre-state (must be clean): []
    markers removed: RFCT-231=0 RFCT-234=0
    rc=1
      content failures:       2
    docs/verify-citations.sh: 2 FAILED (0 resolution, 2 content, 0 census,
    0 ratchet), 2168 citations passed

    FAIL docs/task/RFCT-231.md:230 quotes "FROM --platform=$BUILDPLATFORM
      ${MOS_BUILD_BASE} AS src", and that text is not at
      `os/pkgs/podman/Dockerfile:74`
    FAIL docs/task/RFCT-234.md:352 quotes "FROM --platform=$BUILDPLATFORM
      ${MOS_BUILD_BASE} AS src", and that text is not at
      `os/pkgs/podman/Dockerfile:74`

    post-state (must be clean): []

Exactly two failures, exactly the two named, and `0 resolution` -- line 74
still exists and says something else, which is this task's own silent-
misresolution shape appearing one level up, in the documentation about it. Two
records were marked because two records went red; that is the whole extent of
the marking.

## 7. What this does NOT reach

- **Wall 3 is not closer.** `os/rootfs` needs a real host `binfmt_misc`
  registration for its smoke run, `/proc/sys/fs/binfmt_misc/` is empty on this
  host, and no tagging or base-argument change reaches it. The booted cx3576
  smoke remains the obligation RFCT-206 section 7 records.
- The seven arm64 binaries were BUILT, not RUN. This host builds arm64 and does
  not execute it (`docs/design/build-harness.md:199`), so nothing here reports
  a `podman info` under aarch64 the way `os/pkgs/podman/README.md` does for
  amd64.
- The `docs/task/RFCT-221.md` anchors. That record is dated-marked, so six of
  its anchors into `os/pkgs/podman/` now point at content this task moved and
  no gate can see it. It was deliberately NOT re-anchored -- re-pointing a
  frozen record is what the marker exists to prevent -- and is filed as a
  finding rather than fixed here: a file-scoped marker exempts anchors its own
  rationale never contemplated.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none -- the cx3576 image build on binfmt-less hosts is
  unblocked at `os/pkgs/podman` by this task)
