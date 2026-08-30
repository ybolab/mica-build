# The apid API harness

`os/pkgs/mosd/tests/apid-api/run.sh` boots the x64 image in QEMU with apid's port forwarded,
finds the guest, waits for the daemon, and runs the bun suite against it.

    make os-apid-api-test              # the whole thing
    bash os/pkgs/mosd/tests/apid-api/run.sh --dry-run   # preconditions + discovery, boots nothing

It **builds nothing**. `_out/x64/x64-mos-v2-latest.img` is an input; if it is
missing the run refuses and names the two commands that make it.

## The address of the guest is never 127.0.0.1

There are three doors between this script and apid, and all three fail as
"connection refused" with nothing to say which one was shut:

1. QEMU's user-mode `hostfwd` binds **inside the container running QEMU**.
2. That container must also **publish** the port, which `src/qemu.ts` does.
3. `-p 127.0.0.1:<port>:<port>` publishes on the **docker host's** loopback.
   Anything running in a container has its own loopback and no route to that
   one. Measured 2026-08-24: this session is on a docker network at
   172.18.0.0/16 while a plain `docker run` lands on the default bridge at
   172.17.0.0/16, with nothing between them — the publish was right, the
   hostfwd was right, and the port was unreachable anyway.

So the harness passes `MOS_QEMU_NETWORK` and talks to **the QEMU container's own
address on that network**. The network is *discovered*, not named: the script
reads its own `eth0` address and asks each docker network whether it lists it.
Hardcoding a network name works on one host; `hostname` is the container's short
id about as often as it is anything useful.

The QEMU container is started `--rm` with **no `--name`**, so it is found by its
bind mount on the run directory — and required to have an address on the
discovered network, which is what distinguishes it from the short-lived `mtools`
containers that read and write the kernel append in the ESP and hold the same
mount.

## One run directory, shared

`src/qemu.ts`'s `RUN_DIR` is the single fixed path `_out/x64/.qemu`, and
`os/tools/qemu-seed-state.sh` writes into that same `disk.img` by name.
**Two runs cannot go at once**: each would overwrite the other's `disk.img` and
the loser would fail somewhere unrelated. That is not hypothetical — `_out` is
per-checkout and gitignored, so a worktree points it at the checkout that built
the image and the two then share the *real* directory.

The harness therefore refuses to start while any running container binds that
directory, and it compares **resolved** paths — `docker inspect` reports the
path it was *given*, not the path it *resolved*, so a run directory reached
through a symlink would otherwise slip past the guard.

The boot engine is **this harness's own** since: `src/qemu.ts` is the
port of a shell tool under `os/tools/` that this harness was the only caller of
and was told not to edit. The path is still a single fixed one and is still
guarded rather than moved, because `os/tools/qemu-seed-state.sh` names it too.

### Where the boot engine runs

`src/qemu.ts` needs bun **and** a docker client in one place. The bun pinned as
`IMAGE_BUN_1` carries no client, which is the gap `os/verify/Dockerfile` was
written for — two digest `FROM`s, one `COPY` of the static client, and a
build-time `docker --version && bun --version`. `run.sh` reuses that Dockerfile
rather than adding a second one saying the same thing; the tag carries both
input digests, so bumping either pin builds a new image and there is no stale
parent to find. Under the default pins it is byte for byte the image `os/verify`
builds.

The repository is mounted at **its own path**, not at `/w`: every `docker run`
the engine makes hands the daemon a path, that daemon is the host's, and the
containers it opens are siblings rather than children — so a path has to mean
the same thing on both sides. The run directory is deliberately **not** mounted
into that container, or the guard above and `find_guest` would both mistake it
for the one running QEMU.

## Two boots off one disk, because of `-no-reboot`

`src/qemu.ts` passes `-no-reboot` to QEMU, so a guest-initiated reboot makes it
**exit** instead of resetting. The harness works with the flag rather than
around it:

    --prepare-only          copy the pristine image into disk.img, grow it,
                            apply the kernel append. Boots nothing.
    boot 1 (REUSE_DISK=1)   phases 01-transport .. 07-reboot. Phase 07 posts
                            /power/reboot; QEMU exits, and that exit IS the
                            evidence the guest asked for a reset.
    boot 2 (REUSE_DISK=1)   the same disk.img, so it comes up through firmware,
                            GRUB and the grubenv the reboot just wrote.
                            Phases 07b-postreboot .. 08-poweroff.

Which of the two shapes happened is decided **by looking** — is the QEMU
container still running — never by assuming. But it is looked at over a
**grace period**, not once: phase 07 returns as soon as the HTTPS port goes
quiet, which is before QEMU has finished tearing itself down. Measured
2026-08-24, a single `docker inspect` at that instant still said *running*, the
harness concluded "reset in place", and then waited out its whole deadline for
apid on a container that had exited seconds later. Still running after
`MOS_APID_QEMU_EXIT_GRACE` seconds is the reset-in-place shape; exiting during
it is the `-no-reboot` shape.

The second boot is also **conditional on a reboot having been posted at all**.
Phase 07 writes its handoff immediately after the confirmed `POST
/power/reboot`, so that file being present and newer than this run's `disk.img`
is the signal. When an earlier phase fails, the runner skips 07, nothing
reboots — and without this check the harness would wait out its full readiness
deadline on a guest that never restarted, then run every post-reboot assertion
against the first boot. Measured on this campaign's first full run.

The readiness wait is **anchored to a console offset** for the same reason. A
guest that resets in place appends to the *same* capture file, under the first
boot's `APID_LISTENING` line, so a whole-file grep answers "apid is listening"
with a line the previous boot wrote. If `-no-reboot` is ever dropped, the guest
resets in place, the container is still there, and the harness waits for apid to
come back on that same container instead of starting a second one against a disk
something is already booting.

The second boot is **on by default**. It was off while `07b-postreboot` and
`08-poweroff` did not exist; both now do. `MOS_APID_BOOT2=0` turns it off for a
boot-1-only run — but note what that costs: phase 07 ends with the guest
deliberately down, so a run that stops there never observes it come back.

## The console is the only journal

mos keeps journald at `Storage=volatile` because `/var` is the EPHEMERAL
partition, so a guest's log dies with the guest — no post-mortem journal
reader can work.

Instead every boot is captured to a file under `_out/x64/apid-api/`, and
`MOS_QEMU_APPEND=systemd.journald.forward_to_console=1` puts journald on the
serial line — which is what makes apid's own `APID_LISTENING` line exist at all.
**Do not drop that append to simplify a run**: without it the console stops at
the login prompt and the readiness signal the harness waits on has been deleted.

Readiness is **both** signals: `APID_LISTENING` on the console *and* a 200 from
`https://<guest>:18443/healthz`, probed from inside `oven/bun:1` on the
discovered network — the suite's own runtime over the suite's own path.
`/healthz` is the probe because it is the only route the auth gate lets through
unauthenticated; anything else answers a redirect to `/setup`, and a redirect is
not evidence that the daemon is serving. Redirects are never followed: apid's
`:80 -> :443` redirect names the *guest's* port 443, which is not followable
through a port forward, and a client that follows it hangs in a way that reads
as apid being down.

A TCG boot on this host reaches `APID_LISTENING` in **60–66 s** and both
readiness signals in **65–72 s** — measured 2026-08-24 across this campaign's
eight runs, under TCG with no `/dev/kvm`, on a quiet machine. (One earlier boot
with `/dev/kvm` present reached `APID_LISTENING` in 65 s as well — a single run,
recorded here because it bounds nothing but is what was seen.) Note what these
numbers are a measurement *of*: the daemon answering, not a login prompt. The
harness never waits for a login prompt.

`MOS_APID_READY_TIMEOUT` stays at **900 s** regardless, because the deadline
exists for the bad case rather than the measured one. A contended host is
materially slower, by an amount nothing here has measured, and under contention
the guest goes long stretches without printing a line — indistinguishable from a
stall unless the waiting loop says what it is doing. So the wait prints a
progress line every 15s carrying the elapsed time and the last console line, and
on timeout it prints the last 40 console lines *before* tearing anything down.

## Knobs

| variable | default | what it is |
| --- | --- | --- |
| `MOS_APID_PHASES` | `01-transport`..`07-reboot` | the FIRST boot's phase list, passed through as `APID_PHASES`. Not "all": phase 07 takes the guest down, so running `07b`/`08` here waits out their deadlines against a machine that is deliberately off |
| `MOS_APID_BOOT2` | `1` | run the second boot and the post-reboot phases |
| `MOS_APID_READY_TIMEOUT` | `900` | deadline for apid to answer |
| `MOS_APID_CONTAINER_TIMEOUT` | `240` | deadline to find the QEMU container |
| `MOS_APID_QEMU_EXIT_GRACE` | `90` | how long to let QEMU exit before calling it a reset-in-place |
| `MOS_APID_KEEP_DISK` | `0` | keep the 4 GiB `disk.img` after the run |
| `MOS_QEMU_HTTPS_PORT` / `MOS_QEMU_HTTP_PORT` | `18443` / `18080` | forwarded ports |
| `MOS_QEMU_RUN_SECONDS` / `MOS_QEMU_TIMEOUT` | `2400` / `2700` | QEMU-side backstops |
| `APID_NEGATIVE` | — | forwarded to the suite: invert the first matching check, to prove a live run can go RED |
| `APID_HANDOFF` | `<result dir>/handoff-07-reboot.json` | forwarded to the suite: where 07 leaves what 07b reads |

`APID_NEGATIVE` and `APID_HANDOFF` are passed through only when set, so an unset
knob keeps the suite's own default instead of being overridden with an empty
string. `APID_NEGATIVE` names a substring of `"<phase-id>: <check text>"`; the
first check it matches has its verdict inverted, and a value matching *nothing*
fails the run rather than passing quietly — so a typo cannot read as evidence.

## Artefacts

Everything lands in `_out/x64/apid-api/`: `console-boot1.log`,
`console-boot2.log`, `suite-boot*.log`, `result-boot*.json` (written by the
suite), `run-started` (an empty stamp the handoff freshness check compares
against — `disk.img` cannot serve, the guest writes to it all boot) and
`result.json` — an envelope from this harness that embeds each boot's
result **verbatim** and carries the run's own totals. Console logs are never
removed; the disk is, unless `MOS_APID_KEEP_DISK=1`.

Reporting follows the `os/verify/run.sh` register: one `PASS:`/`FAIL:` line per
assertion and a final `RESULT: PASS|FAIL (n/m checks)` with counted totals.
**Zero checks is a failure** — a run that asserted nothing must not read as
success.

### The 07 → 07b handoff

The two boots are two separate `bun` processes, so nothing survives between them
in memory. Phase 07 writes what 07b needs — the hostname it expects to read back,
the login-backoff state it left behind — as JSON, and 07b reads it. A missing
handoff makes 07b **skip** with that reason rather than invent one.

The default path is `dirname(APID_RESULT_JSON)/handoff-07-reboot.json`, i.e.
`_out/x64/apid-api/handoff-07-reboot.json`. That directory is the right home for
it because it outlives both boots and is bind-mounted at the *same* path in both
`bun` invocations — a handoff written to a container-local path would vanish with
the container that wrote it.

`APID_HANDOFF` overrides that path. It is the knob to set when running the two
boots by hand, or when running 07b against a handoff from an earlier run.

## Running it from a worktree

`_out/` is gitignored and per-checkout, so a git worktree has no image of its
own. Point it at the checkout that built one:

    ln -s /path/to/main/checkout/_out _out

The harness resolves symlinks everywhere it matters — the competing-run guard,
and the `_out` bind it gives the bun container so the suite is not handed a
dangling link. Note that this makes the worktree share the *real* run
directory, so the guard above applies across worktrees too.
