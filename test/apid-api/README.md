# `test/apid-api` — the apid black-box HTTP suite

A bun + TypeScript suite that talks to **apid** in a booted mos guest over the
network, the way a browser would, and asserts on what comes back. It has **no
runtime dependencies**: a client that follows redirects, manages cookies
invisibly and normalises request targets would hide the exact behaviours this
suite exists to observe.

Nothing here modifies `os/pkgs/mosd/`. Any apid defect this suite finds is **reported,
never fixed from inside the test tree**.

## One boot, phased, ordered

A TCG boot of the image reaches apid's `APID_LISTENING` line in **60–66 s** and
both readiness signals in **65–72 s** — measured on this host on 2026-08-24,
across this campaign's eight runs, under TCG with no `/dev/kvm` and on a quiet
machine. That is a measurement of one host on one day, not a property of the
image: a contended host is materially slower, which is why the harness's
readiness deadline stays at 900 s and is not trimmed to fit these numbers.

**A boot per test is still not viable on that figure**, and the reason was never
the boot alone. A full lifecycle run is **two** boots, twelve phases,
`06-backoff`'s deliberately doubling login windows and an argon2 hash behind
every login — about **four minutes** end to end, measured the same way. Against
that, per-test isolation would multiply the boot across dozens of checks until
it dominated everything the suite actually measures, and under load TCG varies
by multiples rather than by seconds. So the suite runs against **one** boot per
invocation and the phases hand state to each other in a fixed order:

| id | what it covers |
|----|----------------|
| `01-transport` | the certificate, the `:80 → :443` redirect, verbatim request targets |
| `02-setup` | setup mode, the gate, the first admin password |
| `03-login` | the session cookie's attributes, the gate after setup, `/logout` |
| `04-readonly` | every GET route, `/healthz`, the `/api` 404 envelope |
| `05-mutate` | hostname, network, ssh, containers |
| `05b-wireguard` | the M6 surface: typed pane forms per kind, the live `kind`/`publicKey` readers, the rotate-key action |
| `05c-kernel-net` | PLAN-022 M7 on a live guest: the kernel creating the three link kinds, and the key store readable by the account that reads it |
| `05d-bearer` | the bearer credential end to end: the bootstrap mint, then read, write, collection, action and the token lifecycle over `Authorization: Bearer` alone, and 401 with no credential |
| `06-backoff` | the login guard: global, doubling, persistent |
| `07-reboot` | `POST`-only, the confirm token, taking the machine down |
| `07b-postreboot` | what survived the power cycle, and what correctly did not |
| `08-poweroff` | `POST`-only, the confirm token, the guest going down |

State coupling between phases is **accepted**, and then made structural. Every
phase declares an `assumes` string saying what it expects the previous phase to
have left behind; the runner **refuses to run a phase whose `assumes` is empty**,
and prints it above the phase's output. Once a phase fails, every later phase is
`SKIP`ped with a line naming the phase that failed and this phase's own
assumption — so a phase-3 failure is never read as a phase-4 bug.

A `SKIP` is not a `PASS`. It is excluded from both sides of the `RESULT` count.

## The address: three doors, and none of them is loopback

`APID_HOST` has **no default**, and specifically no default of `127.0.0.1`.
Reaching the guest crosses three separate hops, and getting any one wrong
presents identically as "connection refused":

1. QEMU's `hostfwd` binds **inside the container running QEMU**.
2. That container must **publish** the forwarded port.
3. `-p 127.0.0.1:...` publishes on the **docker host's** loopback — which is not
   the loopback of whatever container you are running this suite from.

So `APID_HOST` is the **QEMU container's address on the shared docker network**
(this campaign's is `traefik`, `172.18.0.0/16`).

Related: apid's `:80 → :443` redirect is a `308` whose `Location` names the
**guest's** port 443. Through a port forward that authority is unreachable, so
the client **asserts the redirect and never follows it**. `follow()` throws
`CrossAuthorityRedirectError` rather than hanging; a client that follows blindly
here looks exactly like apid being down.

## Environment

| variable | required | default | meaning |
|----------|----------|---------|---------|
| `APID_HOST` | **yes** | — | address of the container running QEMU. Not loopback. |
| `APID_HTTPS_PORT` | no | `18443` | published port reaching the guest's `:443` |
| `APID_HTTP_PORT` | no | `18080` | published port reaching the guest's `:80` |
| `APID_CONSOLE` | no | — | path to the captured QEMU console log |
| `APID_ADMIN_PASSWORD` | no | `mos-e2e-admin-pw` | password set at `/setup` |
| `APID_HOSTNAME_TARGET` | no | `mos-e2e-renamed` | hostname `05-mutate` renames to |
| `APID_PHASES` | no | all | comma-separated phase ids; a partial run says so, loudly |
| `APID_RESULT_JSON` | no | — | path for the machine-readable result |
| `APID_NEGATIVE` | no | — | invert the first matching check, to prove a run can go red |
| `APID_HANDOFF` | no | `<result dir>/handoff-07-reboot.json` | where `07-reboot` leaves what `07b-postreboot` reads |

`APID_HANDOFF` matters only across the two boots: they are two separate `bun`
processes, so 07 writes what 07b needs as JSON and 07b reads it. The default
sits beside `APID_RESULT_JSON`, which outlives both boots and is mounted at the
same path in both invocations. A missing handoff makes 07b **skip** with that
reason rather than invent one.

## Running

The whole thing, image and all:

```sh
make os-apid-api-test
```

The self-test — **no network, no docker, no QEMU, no image**. Measured under
`oven/bun:1` (bun 1.4.0) on 2026-08-24: `selftest` itself takes **~0.17 s** and
`typecheck` **~2 s**, so the whole block below is a couple of seconds after the
first `bun install`:

```sh
bun install
bun run typecheck
bun run selftest
```

`selftest.ts` drives every assertion helper, the cookie jar, the redirect
refusal, the verbatim request writer and the phase runner against inputs that
are **deliberately wrong**, and requires each one to fail *with its own
message*. Its `RESULT: PASS (n/m checks)` means "n wrong answers were correctly
rejected". Positive controls sit beside every negative, so a helper hardwired to
always fail does not satisfy it either.

Run it before and after touching anything in `src/`. An assertion that stays
green on a wrong input is the defect this file exists to catch.

The other no-boot check, and the only one CI runs:

```sh
bash spec-pins.sh          # or: make os-apid-api-spec-pins, from the repo root
```

`src/spec-pins.ts` asserts that every literal a phase pins which
`os/pkgs/mosd/apid/openapi.json` ALSO states agrees with the document — 38 of
them, read out of the phase files' own bytes rather than imported, so both
directions of drift go red. It exists because the phases below only run under a
booted run: a milestone that moves a shipped status otherwise leaves every
phase pinning the old one green until somebody boots the image (PLAN-028 M4).
Its header states what is out of scope and why; `docs/task/RFCT-259.md`
section 4 states the residue, which is most of this file's pins.

It runs on a host bun when there is one and in the bun pinned as `IMAGE_BUN_1`
otherwise, and says which. `MOS_APID_CONTAINER=1` forces the pinned container.

bun is not required on the host — run it in a container, mounting the
**repository** (a `/tmp` mount does not propagate to the docker daemon here and
silently yields an empty directory):

```sh
docker run --rm -v "$(git rev-parse --show-toplevel):/w" -w /w/test/apid-api \
  oven/bun:1 sh -c "bun install && bun run typecheck && bun run selftest"
```

## Layout

```
src/spec-pins.ts  the build-time pin check: the phase literals openapi.json
                  also states, asserted against it with no boot
src/config.ts     the environment contract; validates once, then freezes
src/client.ts     the browser-simulating client: jar, manual redirects,
                  per-request TLS scoped to APID_HOST, and raw() for
                  byte-for-byte request targets
src/report.ts     the house PASS/FAIL/RESULT format and the assertion helpers
src/runner.ts     phases, `assumes`, and failure containment
src/main.ts       the ordered registry — every phase imported up front, so a
                  phase author edits exactly one file
src/selftest.ts   the proof the machinery can go red
src/phases/       one module per phase
```
