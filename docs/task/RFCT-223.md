# RFCT-223 A scheduled upstream-tag check for the container engine's six pins

- **status**: completed
- **priority**: P2
- **owner**: bkd/fibmgppm
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-29
- **plan**: PLAN-012 (M5 residue, filed by PLAN-024 M2; routed to PLAN-025-class work)

PLAN-012 M5 — supply-chain tracking — is the one milestone of that plan that
was never built. `os/pkgs/podman/versions.env` pins six upstreams in three
languages and nothing in the tree watches any of them. PLAN-012's own Risks
section calls that mitigation not optional, so the plan closes (Amendment 1,
2026-08-28) with this filed rather than with an unticked box left behind.
RFCT-221 is the audit that measured it; nothing here needs re-auditing.

## Scope when claimed

Add a check that reads each pin in `os/pkgs/podman/versions.env`, asks each
upstream for its newest release tag, and fails when a pin is behind.

Three things make this harder than a loop over six URLs:

- The six upstreams do not share a tag convention — some are `v`-prefixed and
  some are not — so the comparison cannot be string equality against a
  normalised guess.
- catatonit's upstream is quiet by nature. The check must distinguish "behind"
  from "unchanged", and must not read a two-year-old newest tag as a failure.
- The check needs network access, which the fast CI lane does not have. Wire
  it into the privileged lane's existing weekly schedule rather than adding a
  second cron.

## Acceptance criteria

1. A run against the current tree is green.
2. A run with any one pin edited backwards is red, and names that component,
   its pinned tag and the newer one.
3. The failure text tells the reader to edit `versions.env` and re-run
   `make podman`.
4. The catatonit case — a quiet upstream that is correctly pinned — is covered
   by a test, not by an assumption.

## Files it is expected to touch

`.github/workflows/privileged.yml`, a new checker under `os/pkgs/podman` or
`os/tools`, `Makefile` if it gets a target, `os/pkgs/podman/README.md`.

## Dependencies

- **blocked by**: (none — claimable any time)
- **blocks**: nothing. The pins are correct today; this is the mechanism that
  keeps them measurable rather than assumed.

## Disposition, 2026-08-29

Built. `os/pkgs/podman/check-pins.sh` reads `versions.env`, asks each of the six
upstreams for its releases, and fails when a pin is behind;
`os/tests/podman-pins-test.sh` drives it against recorded upstream responses;
`make podman-pins` / `make podman-pins-test` name both; and
`.github/workflows/privileged.yml` runs them weekly on the cron that was already
there.

### The deliverable is the signal, not a bump

The check never writes the file it reads. `versions.env` states the procedure
itself — "change the tag, set its hash to the literal string `PENDING`, and run
`make podman`" (`os/pkgs/podman/versions.env:16-17`) — and says of it that
recording a hash "is an act rather than a copy from an upstream page nobody
re-checked" (`os/pkgs/podman/versions.env:19-20`). A job that pasted the new tag in
would be exactly that copy, so a red run prints the component, its pin, the
newer tag and that procedure, and stops. Case 9 of the suite asserts the
contract by bytes rather than by review: `sha256sum` of the real `versions.env`
before and after a run that found a pin behind.

### What the comparison had to get right

**No shared tag convention.** The prefix comes from the pin as written — its
leading non-digit run — so `CRUN_VERSION=1.29.1` and `CONMON_VERSION=v2.2.1`
are each compared inside their own namespace. A tag outside it is skipped *and
counted in the output*; the live run reports `1 tag(s) skipped as a different
convention` for aardvark-dns, which is upstream's `v1.10.1-rhel`. A component
where nothing upstream matches the pin's convention exits 2, because comparing
nothing is not a pass.

**podman's line.** Upstream ships v5.8.6 and v6.1.0 concurrently, and
`versions.env` is explicit: "podman is pinned to the 5.x line, NOT the newest
tag" (`os/pkgs/podman/versions.env:22`). The comparison is confined to the pinned
major, read from the pin, so
moving the pin to 6.x moves the check with it and needs no edit to the checker.
The other line is printed as a note that cannot change the exit status. The
suite asserts both halves: a correct 5.x pin is not called behind while v6.1.0
exists, and a pin at v5.8.3 *is* called behind — naming v5.8.6, never a 6.x
release.

**catatonit.** Age is never an input to the verdict. The date is printed so a
quiet upstream reads as measured rather than assumed, and criterion 4 is held by
two fixture cases rather than by an assumption: green while upstream is quiet
and the pin is current, red against a recording in which v0.3.0 shipped. Without
the second, "catatonit is green" would be indistinguishable from "catatonit is
never actually compared".

### Acceptance, as measured

The host had outbound network, so criteria 1 and 2 were proved live as well as
by fixture.

1. Green. `bash os/pkgs/podman/check-pins.sh` against the tree, live:
   `RESULT: PASS (all 6 pins are at their newest applicable upstream release)`,
   exit 0, all six reported `UNCHANGED` by name.
2. Red, naming the component and both tags. Live, against a fixture pin file so
   the real one was never written: `conmon: pinned at v2.1.13, upstream released
   v2.2.1 on 2026-02-12.`, exit 1. `sha256sum os/pkgs/podman/versions.env` read
   `575d4b247824bd6a253dc5468ab0679e5c530d244634cc42a3de133eb35c956d` before and
   after.
3. The failure text carries the procedure: "set the component's `*_VERSION` to
   the newer tag, set its `*_SHA256` to the literal string PENDING, and run
   `make podman`", closing with "Nothing here edits versions.env for you: moving
   a pin is a human act."
4. `bash os/tests/podman-pins-test.sh` → `RESULT: PASS (39/39 assertions)`,
   offline, covering the quiet-upstream case in both directions.

The suite was checked against three mutations of the checker before it was
trusted: dropping the line policy failed 9 assertions, dropping the
prerelease/draft filter failed 1, and replacing the numeric maximum with a
lexical one failed 2 — the last being the `1.28` vs `1.29.1` case that a string
comparison gets backwards.

### What this does NOT reach

- **The live fetch is proved on this host, not on a runner.** Six
  `api.github.com` requests succeeded here on 2026-08-29. Whether the CI runner
  has outbound HTTPS, and whether Gitea schedules the job at all, is unproven
  until the weekly cron fires. Nothing converts that into a pass: a failed fetch
  exits 2 with "The check did not run; this is not a pass."
- **The job does not use `runs-on: privileged`**, unlike every other job in that
  file, and the file's header — which cannot be edited without moving the line
  RFCT-221 cites — still says "Until a runner with this label is registered,
  Gitea never schedules these jobs" (`.github/workflows/privileged.yml:39-40`).
  The job's own comment states the exception
  at the top of the jobs list. The check needs outbound HTTPS and nothing else,
  and an alarm behind an unmatched label is an alarm that never rings.
- **CVE tracking is not this.** The README calls the cost "Six upstreams to
  track for CVEs, in three languages" (`os/pkgs/podman/README.md:159`); a tag
  check answers "has upstream
  released" and not "is the pinned release vulnerable". The second is a
  different feed and a different piece of work.
- **`check.yml`'s closing summary was not extended** to list `make podman-pins`
  among what the fast lane does not cover. That file was outside this task's
  stated scope.
