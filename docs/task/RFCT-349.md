# RFCT-349 A cache fetch nothing could interrupt, and a lint that read prose as a command

- **status**: completed
- **priority**: P2
- **owner**: bkd/f0e86ea6
- **createdAt**: 2026-09-07 23:10
- **relatedPlans**: [PLAN-080](../plan/PLAN-080.md) section 0.4 (the lint); the
  cache hang has no plan item and did not acquire one

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

Two defects [RFCT-347](RFCT-347.md) found while doing something else, and
neither of them was its to fix.

- **The cache step hangs where its own timeout cannot run.**
  `rootfs/debian/run.sh cache` sat for ten minutes at 100% CPU with frozen
  network I/O on one pin out of 172. `rootfs/debian/fetch.ts` budgets 180 s an
  attempt and three attempts through an `AbortController`, and the abort never
  fired, so the nine-minute ceiling that file states never applied. It is not
  the defect fixed on 2026-09-06 -- that one was an unbounded body stream, and
  the comment describing it is still correct.
- **The host-toolchain lint reads prose inside a quoted argument as a command.**
  `docs/bsp/cx3576-bench-collect.sh:1058` is
  `operator_step "install the GOOD bundle (rauc install <bundle>), ..."`, one
  English sentence, and the `(` read as a command separator to a scanner that
  did not track quoting. It was carried as a registered false positive, which
  is the right stopgap and the wrong permanent answer: every false positive
  spends some of the credibility a lint needs, and this tree has already
  rejected one rule on those grounds.

## ActiveForm

Bounding the Debian cache fetch from outside, and teaching the lint what a
quoted string is

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The hang reproduced, or honestly not; bounded either way, and the bound
  demonstrated rather than asserted.
- The scanner fixed and not the file; the true positive preserved;
  `tests/host-toolchain-lint-test.sh` extended, with the count stated.
- Green under busybox awk as well as the host's.
- The false-positive half of the exemption row removed, and the exempted count
  stated.
- `bash tests/debian-base-test.sh`, `bash tests/debian-lock-test.sh`,
  `bash tests/host-toolchain-lint.sh`, `make docs-verify` from a `git archive`
  into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## Notes

The durable record for the lint is `docs/design/build.md` §0.3 and §0.4. What
follows is what only this task can say.

### Defect 1: the hang did not reproduce, and the bound is the deliverable

**692 fetches of the exact pin set, and not one of them hung.** All of it
through `IMAGE_BUN_1` -- bun 1.4.0, the same image that measured the hang -- on
the `traefik` network, against a private `--cache-dir`; `_out/debian-base` was
not touched.

| Question RFCT-347 left | What was measured |
| --- | --- |
| Is it that URL? | No. `dbus-bin_1.16.2-2_amd64.deb` fetched **204/217/203 ms** across three passes, and `curl` answers it in **0.29 s** (302 -> 200, 80004 bytes) |
| Is it positional? | No. Three full passes over all **173** amd64 archives, a fresh `bun fetch.ts` process per pin exactly as `run.sh` spawns one: **519 fetches, 0 non-zero exits**, mean **241 ms**, slowest **1767 ms** (`wpasupplicant`) |
| Is it random? | Not at this rate. The real command -- `rootfs/debian/docker.sh cache --arch amd64 --all` -- downloaded and verified all **173 archives in 44.5 s** |
| Is it the redirect chain? | No loop. `snapshot.debian.org` answers **exactly one** 302, to `/file/<hash>/<name>`; curl and bun both follow it inside 0.3 s |

So the reproduction failed, and this record says so rather than dressing a
guess as a diagnosis. What *was* settled is the mechanism question, and it is
the one that decides the shape of the fix.

**No in-process bound can end a wedged event loop.** Measured in the pinned
image, on a bun process that spins synchronously with all three candidates
armed at 500 ms:

```
timeout 5    bun wedge.ts   ->  exit 124, no output at all
                                (no TIMER, no ABORT, no RACE -- 5 s, nothing fired)
timeout -k 10 3 bun wedge.ts ->  exit 124 after 3 s
```

`setTimeout`, `AbortController.abort()` on a timer and `Promise.race` against
`Bun.sleep` are the same mechanism wearing three names: they all resolve on the
loop they are meant to interrupt. **A `Promise.race` would have been exactly as
dead as the `AbortSignal`, and adding one would only have looked like a fix.**
Only another process can end a wedged one.

**The ceiling is therefore out of process.** `run.sh` now runs every fetch under
`timeout -k 10 "$FETCH_DEADLINE"` (600 s, which is fetch.ts's own worst case of
3 x 180 s plus 3 s of backoff, with room), `need timeout` is declared, and 124 /
137 / 143 -- GNU's spelling and busybox's -- become a refusal that names the
ceiling and the URL. `-k` is the load-bearing flag: the second signal is a
SIGKILL, which no handler inside bun can defer. `fetch.ts` keeps its
`AbortController`, which is the right bound for everything the network can do,
and its header now says which half it cannot close.

**The bound is demonstrated through the real seam, and the demonstration is
mutation-sensitive.** `tests/debian-base-test.sh` already stands up a real
loopback HTTPS mirror for the 404 -> exit 44 case; it gained a `/stall` route
that accepts the request and answers nothing (`idleTimeout: 0`, so the server
does not hang up first) and a case that drives real `run.sh`, real `fetch.ts`,
real bun and real TLS against it:

| | Elapsed | Result |
| --- | --- | --- |
| with the wrapper, `MOS_DEBIAN_FETCH_DEADLINE=3` | **8.0 s** for the whole suite | `RESULT: PASS (54 checks)`, the stalled pin refused with `download exceeded the 3s ceiling and was killed: https://127.0.0.1:.../stall/pool/libmirror.deb` |
| `timeout -k` deleted from `fetch_to`, nothing else changed | **64.6 s** | `Terminated`, then `FAIL: missing refusal: download exceeded the 3s ceiling ...` |

Without the wrapper the run sits there until the test's own `timeout 60` kills
it; the case also asserts the elapsed seconds, so the property is the bound and
not the message. `MOS_DEBIAN_FETCH_DEADLINE` exists for that line and nothing in
the repository sets it -- a ten-minute ceiling cannot be shown to fire any other
way.

**What this does not claim.** It does not explain the ten minutes at 100% CPU.
The bound is a belt-and-braces deadline over a hang that would not reproduce
here, and it is described as that. It closes the *class*: whatever wedges bun,
the run now dies naming the pin instead of sitting.

### Defect 2: the scanner, not the file

`tests/host-toolchain-lint.sh`'s shell pass gained `code_only()`, which blanks
what a quoted string makes literal before the command-position match reads the
line. Three rules, and the second is the one that costs something to get right:

- A `'...'` span is blanked whole -- nothing expands in one.
- **A command substitution is still code, wherever it sits.** `$( )` and
  backticks are handed back to the scan untouched, including from inside a
  double-quoted string, so `"$(cargo build)"` stays red. The distinction is
  substitution versus literal paren, not quoted versus unquoted.
- A line that ends inside a quote is returned exactly as it came. A string that
  opens on one line and closes on another cannot be resolved by a reader that
  sees one line at a time, and guessing would cost findings; the fallback is
  what this lint has always done, so that case can only keep a false positive
  and can never lose a true one.

**It cost no finding.** Both scanners run over a `git archive` of `HEAD` with
the register removed, so every finding is visible:

```
before   FAIL: docs/bsp/cx3576-bench-collect.sh:497:  `rauc` runs on the host.
         FAIL: docs/bsp/cx3576-bench-collect.sh:1058: `rauc` runs on the host.
         RESULT: FAIL (346/347 files clean, 2 finding(s), 10983 ... examined)
after    FAIL: docs/bsp/cx3576-bench-collect.sh:497:  `rauc` runs on the host.
         RESULT: FAIL (346/347 files clean, 1 finding(s), 10983 ... examined)
```

Line 497 is `out=$(rauc status --output-format=shell ...)`: a command
substitution, and still a finding. Line 1058 is the sentence.

| Check | Result |
| --- | --- |
| `bash tests/host-toolchain-lint-test.sh` | **green**, `RESULT: PASS (25/25 cases)`, up from 23 |
| the same, under **busybox awk** (1.37.0, alpine 3.21's) | **green**, `25/25`, and the tree scan byte-identical to the host awk's |
| the new green case, against the **HEAD** scanner | **red at both lines** -- `prose-arg.sh:3: \`rauc\`` and `prose-arg.sh:4: \`mkfs.ext4\`` -- so it is the case that fails today, in both quote kinds |
| the new red case | `subst.sh:2: \`cargo\` runs on the host`, red before and after |
| `bash tests/host-toolchain-lint.sh` | **green**, `2 exempted invocation(s) under 1 rule(s)` -> **`1 exempted invocation(s) under 1 rule(s)`** |
| `bash tests/shell-pipefail-lint.sh` | **green**, `92/92 files clean` |
| `bash tests/bare-host-gate/gate.sh` | **`BARE HOST GATE PASSED`**, rungs 1-3, five steps. Rung 2 is this lint under alpine 3.21's busybox awk on a host with no bash until `apk add`, and it printed the RESULT line above **character for character** |

**What blanking a quoted span gives up, said here because this task is what
gave it up.** `bash -c 'cd x && cargo build'` runs cargo on this host and is now
invisible, where the `&&` inside the quotes used to make it a finding by
accident. Nothing can tell that line from `docker run ... sh -c 'mkfs.ext4 ...'`,
which is the toolbox and the thing the policy asks for -- so it joins the
heredoc body in the header's list of what the lint cannot see, rather than
acquiring a `-c` special case that would flag every container's script. There is
no such site in the tree: the before/after above moved the finding count by
exactly one, and a grep for a producer inside a single-line `-c '...'` finds
nothing. **The function is not a no-op** -- 5850 of the 11030 command lines are
re-read after masking, and exactly one finding changed.

**The register keeps its row and loses half its reason.** The row is one
`(file, tool)` pair covering both hits, so there was no row to delete: line
497's `rauc status` on a booted device is a real invocation outside the build
boundary and RFCT-347's argument for not inventing a `device` marker -- *"a
grammar nobody would maintain"* -- stands and was not revisited. What went is
the paragraph registering line 1058 as a false positive, and the header
sentence that counted two hits.

`docs/design/build.md` §0.3 and §0.4 and their `docs/zh` mirrors carried the
`2 exempted invocation(s) under 1 rule(s)` string and a description of what the
lint cannot see; both are updated, including the count of shapes the test suite
requires to stay green.

### What is owed

- **arm64.** Everything measured here is amd64. The `timeout` wrapper is
  architecture-neutral and `tests/debian-base-test.sh` runs in `IMAGE_BUN_1`
  either way, but no arm64 cache run was made.
- **The hang itself.** Unreproduced, and therefore unexplained. If it returns,
  the run will now name the pin and the ceiling instead of sitting, which is
  the evidence the next attempt did not have.
