# The apid API harness

`test/apid-api/run.sh` boots the x64 image in QEMU with apid's port forwarded,
finds the guest, waits for the daemon, and runs the bun suite against it.

    make os-apid-api-test              # the whole thing
    bash test/apid-api/run.sh --dry-run   # preconditions + discovery, boots nothing

It **builds nothing**. `_out/x64/x64-mos-v2-latest.img` is an input; if it is
missing the run refuses and names the two commands that make it.

## The address of the guest is never 127.0.0.1

There are three doors between this script and apid, and all three fail as
"connection refused" with nothing to say which one was shut:

1. QEMU's user-mode `hostfwd` binds **inside the container running QEMU**.
2. That container must also **publish** the port, which `os/qemu-run.sh` does.
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
container that writes the kernel append into the ESP and holds the same mount.

## One run directory, shared

`os/qemu-run.sh`'s `RUN_DIR` is the single fixed path `_out/x64/.qemu`. The x64
verification line uses it too. **The two cannot run at once**: each would
overwrite the other's `disk.img` and the loser would fail somewhere unrelated.

The harness therefore refuses to start while any running container binds that
directory, and it compares **resolved** paths — `docker inspect` reports the
path it was *given*, not the path it *resolved*, so a run directory reached
through a symlink would otherwise slip past the guard.

`os/qemu-run.sh` is owned by the image line and is **not edited** by this
harness; the path cannot be moved, so it is guarded instead.

## Two boots off one disk, because of `-no-reboot`

`os/qemu-run.sh:167` passes `-no-reboot`, so a guest-initiated reboot makes QEMU
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
container still running — never by assuming. If a future `os/qemu-run.sh` drops
`-no-reboot`, the guest resets in place, the container is still there, and the
harness waits for apid to come back on that same container instead of starting a
second one against a disk something is already booting.

The second boot is **on by default**. It was off while `07b-postreboot` and
`08-poweroff` did not exist; both now do. `MOS_APID_BOOT2=0` turns it off for a
boot-1-only run — but note what that costs: phase 07 ends with the guest
deliberately down, so a run that stops there never observes it come back.

## The console is the only journal

mos keeps journald at `Storage=volatile` because `/var` is the EPHEMERAL
partition, so a guest's log dies with the guest. `os/qemu-journal.sh` **does not
work** and is committed as known-broken for exactly that reason; this harness
does not call it and does not try to fix it.

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

A TCG boot on this host reaches a login prompt in ~200–260s when the machine is
quiet and four to five times that when it is not, so the wait prints a progress
line every 15s carrying the elapsed time and the last console line — and on
timeout it prints the last 40 console lines *before* tearing anything down.

## Knobs

| variable | default | what it is |
| --- | --- | --- |
| `MOS_APID_PHASES` | all | passed through as `APID_PHASES` |
| `MOS_APID_BOOT2` | `1` | run the second boot and the post-reboot phases |
| `MOS_APID_READY_TIMEOUT` | `900` | deadline for apid to answer |
| `MOS_APID_CONTAINER_TIMEOUT` | `240` | deadline to find the QEMU container |
| `MOS_APID_KEEP_DISK` | `0` | keep the 4 GiB `disk.img` after the run |
| `MOS_QEMU_HTTPS_PORT` / `MOS_QEMU_HTTP_PORT` | `18443` / `18080` | forwarded ports |
| `MOS_QEMU_RUN_SECONDS` / `MOS_QEMU_TIMEOUT` | `2400` / `2700` | QEMU-side backstops |

## Artefacts

Everything lands in `_out/x64/apid-api/`: `console-boot1.log`,
`console-boot2.log`, `suite-boot*.log`, `result-boot*.json` (written by the
suite) and `result.json` — an envelope from this harness that embeds each boot's
result **verbatim** and carries the run's own totals. Console logs are never
removed; the disk is, unless `MOS_APID_KEEP_DISK=1`.

Reporting follows `os/verify-image-v2.sh`: one `PASS:`/`FAIL:` line per
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
