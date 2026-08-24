# RFCT-105 An over-the-wire suite for apid: nine phases against one boot, and effects observed on the device

- **status**: the suite is complete and merged — `test/apid-api/`, 24 files,
  8190 lines, offline selftest `RESULT: PASS (37/37 checks)` under bun 1.4.0.
  **No live phase run has completed.** The only recorded live run is the
  harness's own, before the phase modules existed: `RESULT: FAIL (8/9 checks)`,
  the ninth check being *"the suite entry point test/apid-api/src/main.ts does
  not exist, so nothing was asserted about apid"*. The suite has therefore
  never yet made an assertion against a booted device, and every claim below
  about what it *would* observe is a claim about code that has been read and
  self-tested, not about a run that happened
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-24 08:04
- **claimedAt**: 2026-08-24 08:04

apid has been tested from inside itself since it existed. `mosd/apid/src` holds
**168** test functions and every one of them calls a handler on the axum
`Router` directly. That is a good body of tests and it is not the thing this
task adds. What it adds is a client that opens a socket to a **booted image in
QEMU**, behaves like a browser, and asserts on what comes back — real TLS, real
systemd, a real system bus, and a real device on the far end of the form post.

`make os-apid-api-test` is the whole of it. `test/apid-api/run.sh` boots the
x64 image with apid's ports forwarded, finds the guest **by looking** rather
than by assuming, waits for two independent readiness signals, and runs the bun
suite against it.

## One correction to the premise this task was given

The brief said *"nothing in this repository had ever spoken to apid over a
socket."* **That is false, and the tree is what says so.**
`mosd/apid/tests/e2e.rs` is a single `#[tokio::test(flavor = "multi_thread")]`
that spawns a private `dbus-daemon --session`, a real `mosd` and a real `apid`,
and drives them over real HTTPS with `reqwest` — asserting the setup redirect,
the session cookie, a hostname write read back over the bus, the login curve
against the real listener, the `202` on the power actions, and the `:80` HTTP
listener's redirect to the HTTPS origin. It is a genuinely good test and it is
the honest baseline this task should be measured against. Recording the
inflated version of the claim would have been the same defect this suite exists
to catch: an impressive statement nothing checks.

**What that test structurally cannot reach is still the whole of the case for
this one**, and it is a shorter list than "everything":

- It runs on the **build host**, with `MOSD_DRY_RUN=1` and `MOSD_SHADOW_PATH`
  pointed at a tempdir — both *hard safety requirements* in its own words. No
  reconciler ever touches a machine, so **no device effect is observable at
  all**; the far end of every write is mosd's own in-memory settings tree.
- The bus is a **private session bus**, never the system bus, and never
  systemd.
- The client is built with `danger_accept_invalid_certs(true)`. The certificate
  is *trusted*, not *inspected* — nothing asserts what apid actually generated
  into its `StateDirectory` on first boot, or that the chain is one deep and
  self-issued.
- `reqwest` normalises request targets, so no assertion there can be about the
  **shape of a path as it arrives on the wire**.
- There is no image, no firmware, no GRUB, no A/B slot, no STATE partition, no
  journald and no reboot. Nothing survives anything, because nothing is ever
  taken down.

Those five gaps are what phases 01, 05, 07 and 07b are for.

## One boot, nine phases, and the coupling made structural

A boot per test was never on the table. The phases are ordered, they run
against **one** boot, and they hand state to each other:

| id | what it covers |
|----|----------------|
| `01-transport` | the self-signed certificate, the `:80 → :443` redirect, verbatim request targets |
| `02-setup` | setup mode, the gate, the first admin password |
| `03-login` | the cookie's five attributes from the *other* handler, `/logout` |
| `04-readonly` | every GET pane, `/healthz`, the `/api/` envelope, the fallback contract |
| `05-mutate` | hostname, network, ssh, containers — by their effect |
| `06-backoff` | the login guard: global, doubling, and left armed for 07b |
| `07-reboot` | `POST`-only, the confirm token, and taking the machine down |
| `07b-postreboot` | what survived the power cycle, and what correctly did not |
| `08-poweroff` | `POST`-only, the confirm token, the guest going down |

**State coupling is accepted, and then made structural.** Every phase carries a
required non-empty `assumes` string; `runner.ts` refuses a registry containing
an empty one (`EmptyAssumesError`) *before running anything*, which turns "each
phase says what it depends on" from a comment somebody can delete into a
property of the code. Once a phase fails, every later phase is **SKIPped** with
a line naming the phase that failed and quoting this phase's own assumption —
so a phase-3 failure is never read as a phase-4 bug. **A SKIP is not a PASS**
and is counted on neither side of the `RESULT` line.

Reporting follows `os/verify-image-v2.sh`: one `PASS:`/`FAIL:` per assertion,
`RESULT: PASS|FAIL (n/m checks)` with dynamic totals, non-zero exit on any
failure. **Zero checks is a failure** — a run that asserted nothing must not
read as success, which is exactly the verdict the one live run produced.

## Device effects, not status codes

Phase 05 is the phase the suite exists for, and its rule is stated in the
module: *posting `/hostname` and getting a `303` proves that a handler
returned.* It does not prove the hostname changed. Every other phase can be
satisfied by apid answering correctly **about itself**; this one cannot, so
each mutation is observed at least twice and never only by its status code:

- **Through the bus.** The GET pane re-renders what mosd holds, read back over
  the system bus — which proves the write round-tripped apid → bus → mosd.
- **On the device.** `src/console.ts` is the second observation channel, and it
  exists because every HTTP answer is the thing under test describing itself.
  The lines it reads are written by **systemd and mosd**, not by the route
  being exercised. The image keeps journald at `Storage=volatile` because
  `/var` is the EPHEMERAL partition, and `os/qemu-journal.sh` is committed
  known-broken for that reason — it is neither called nor repaired from here —
  so the guest boots with `systemd.journald.forward_to_console=1` and the
  captured serial console is the only usable journal.
- **Across the reboot.** The hostname target is handed to `07b-postreboot`, on
  the far side of a real power cycle.

Two rules are what make the console evidence rather than decoration. **Mark
first**: every observation is made against bytes written *after* a captured
offset, because a ten-minute boot writes thousands of lines and `Started
ssh.service` is among them — a whole-file grep would let the *boot* satisfy an
assertion about a POST made thirty seconds ago, so the module contains no
whole-file search at all. And **a missing log is a SKIP, never a PASS**: with
no console, `expectConsoleAbsent` would make "the transient password never
appears in the log" **vacuously true**, so it refuses an empty window outright.

`07b-postreboot` states where things live before it asserts, because getting
that wrong turns an assertion into a coincidence. `/var/lib/mos` is a bind
mount onto STATE, so `session.key` and `login_guard.json` **persist** — which
is what makes the backoff assertion a real test of `docs/design/access.md` §6
rather than a hopeful one — while `state.sessions` is an in-RAM table, so the
pre-reboot cookie is refused because its id is simply gone. The phase says
which of the two reasons it is claiming. It also records the finding it would
report but never fix: if the boot-2 console shows apid **regenerating**
`cert.pem` or `session.key`, STATE did not mount.

`02-setup` does not merely assert `SameSite=Lax` on the cookie. apid issues
**no CSRF token**, so `SameSite=Lax` is the *entire* cross-site defence and
`HttpOnly` the entire defence against script theft — and the phase checks the
absence of every marker an anti-forgery scheme would have to leave in the
markup or the headers. The claim is verified, not asserted in a comment.

## That the suite can fail

`src/selftest.ts` runs offline in seconds — no network, no docker, no QEMU, no
image — and drives every assertion helper, the cookie jar, the redirect
refusal, the verbatim request writer and the phase runner against inputs that
are **deliberately wrong**, requiring each to fail *with its own message*. Its
`RESULT: PASS (37/37 checks)` means "37 wrong answers were correctly rejected".
Measured today under `oven/bun:1` (bun 1.4.0), six phases:
`selftest-negative`, `selftest-positive`, `selftest-client`, `selftest-runner`,
`selftest-config`, `selftest-sni`.

**Positive controls sit beside every negative**, so a helper hardwired to
always fail does not satisfy it either — and among the runner's checks are
*"APID_NEGATIVE inverts a matching check, so a live run can be made red on
demand"* and *"APID_NEGATIVE that matches nothing fails the run rather than
passing quietly"*. That second one is the selftest catching its own machinery:
a typo in `APID_NEGATIVE` would otherwise leave a run green and read as clean.

**The live half of this is not done.** The negative control has been exercised
against the reporter, not against a device-effect assertion on a booted guest,
because no live phase run has happened.

## What the one live run actually measured

`_out/x64/apid-api/realrun.log`, today, from the harness subtask's worktree:

    PASS: image present: x64-mos-v2-latest.img -> x64-mos-v2-1787568481.img
    PASS: no competing run: nothing binds /srv/mos/_out/x64/.qemu
    PASS: docker network discovered by observation: traefik (this container is 172.18.0.7)
    PASS: boot1 guest found: container 494e349ba535 at 172.18.0.8 on traefik after 6s
    PASS: [boot1] APID_LISTENING on the console after 65s:
          [   51.358599] apid[769]: APID_LISTENING https=0.0.0.0:443 http=0.0.0.0:80
    PASS: [boot1] https://172.18.0.8:18443/healthz answered 200 from inside oven/bun:1 after 65s
    FAIL: [boot1] the suite entry point test/apid-api/src/main.ts does not exist,
          so nothing was asserted about apid
    RESULT: FAIL (8/9 checks)

That failure is the harness behaving correctly: a missing suite is a **loud
red**, not a quiet skip. The run proves the plumbing — image, docker network
discovery by observation, guest discovery by bind mount, both readiness signals
(`APID_LISTENING` on the console *and* a `200` from `/healthz` probed from
inside `oven/bun:1` on the discovered network) — and proves nothing whatever
about apid.

**One number in the documentation did not survive contact with that run.**
`test/apid-api/README.md` justifies the one-boot design with *"a TCG boot of the
image takes roughly ten minutes"*, and `HARNESS.md` says ~200–260s to a login
prompt on a quiet machine. The measured boot reached `APID_LISTENING` at kernel
time **51.4s**, 65s of harness wall clock, and was declared ready at **71s**.
The one-boot decision is unaffected — a full run is two boots plus nine phases
plus 06-backoff's own windows, and TCG under load is four to five times slower
— but the ten-minute figure is not a measurement of this host and should be
re-measured before it is repeated. It is exactly the kind of number RFCT-092
was opened about.

## The limits, and none of them is softened

**1. `docs/design/api.md` §4.4's traversal guards are NOT covered.**
`serve::respond` calls `asset_path::resolve` — the function holding every §4.4
guard — only inside `if let Some(root) = active_root(..)`. With no bundle
active at `/srv/ui`, **not one line of §4.4 executes**, and a bundle-less device
is what §5.2 calls the shipped state of every device. So `04-readonly` covers
**§4.2's fallback contract instead** and says so in the module, at length,
because claiming §4.4 coverage here would be precisely the defect this campaign
was assembled to find. The `/../../etc/passwd` probe is a real assertion — that
no `/etc/passwd` content comes back — but it passes because no path was ever
resolved against a filesystem, not because a guard rejected it. Closing this
needs a bundle seeded at `/srv/ui` on **DATA**, and `os/qemu-seed-state.sh`
writes **STATE** only. It is a different task.

**2. `-no-reboot`, so the reboot is two boots off one disk.**
`os/qemu-run.sh:167` passes `-no-reboot`, so a guest-initiated reboot makes QEMU
**exit** rather than reset. The harness works with the flag rather than around
it: `--prepare-only`, then boot 1 (`MOS_QEMU_REUSE_DISK=1`) for phases 01→07
where QEMU's exit *is* the evidence the guest asked for a reset, then boot 2 on
the same `disk.img` — which still comes up through firmware, GRUB and the
grubenv the reboot just wrote. **What it does not exercise is QEMU's own
reset.** Which of the two shapes happened is decided by looking at whether the
container is still running, never by assuming, so a future `os/qemu-run.sh` that
drops the flag degrades correctly.

Beside that, and outstanding: **`MOS_APID_BOOT2` still defaults to `0`**
(`test/apid-api/run.sh:107`), with a comment reading *"turn it on once
07b-postreboot and 08-poweroff land"*. They have landed. The default and the
comment are now stale, the second boot is opt-in, and **`07b-postreboot` and
`08-poweroff` have therefore never run.** `os/` and `test/` were out of scope
for this record's task, so this is reported, not fixed.

**3. Image/code skew.** The image under test predates RFCT-104, so `/mqtt` and
`POST /mqtt/enable` are **uncovered**. The skew is visible on the console of
the one live run — `mos-mqttd` running unconditionally and warning
`broker connection lost; retrying after backoff error=I/O: Connection refused
(os error 111)`, which is exactly the RFCT-097 behaviour RFCT-104 replaced.
**There is no guard in the suite that goes red when the image is rebuilt.** The
brief for this record assumed one exists; `grep -rn -i 'mqtt\|skew'
test/apid-api/src/` returns nothing, and the code is what counts. A rebuilt
image simply gains two routes the suite says nothing about, silently. Adding
that guard is open work.

## The one defect this campaign found, and where it was

**It was in the suite's own client, not in apid.** `tls.connect()` throws
synchronously when `servername` is an IP literal — SNI carries a `host_name`
and never an address (RFC 6066 §3), and bun *enforces* it:
`TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.servername' Setting
the TLS ServerName to an IP address is not permitted`, measured under bun 1.4.0
for both `127.0.0.1` and `::1`. Node behaves the same way; it is not a bun
quirk. This campaign's host is **always** an IP literal — the QEMU container's
address on the shared docker network, and `config.ts` refuses to default
`APID_HOST` precisely so nobody aims the suite at loopback — so the fault made
`inspectCertificate()` and every raw HTTPS write throw at call time, and the
suite could not have made a single TLS assertion against a real device. Fixed
in `4de57ef` by `sniServerName()`, which omits the property (absent, not
`undefined`) for an IP and passes a hostname through unchanged.

The pure `selftest-sni` guard exists because of it, and it has three checks
rather than two on purpose: a function hardwired to return `undefined` would
satisfy both IP cases and would silently drop SNI against a hostname, where it
is legal and useful, so the third check asserts the pass-through.

**Defects found in apid: none.** Not "none found" in the sense of a clean live
run — **no live phase run has happened**, so the suite has had no opportunity
to find one. That opportunity is the outstanding work, and it is the whole
point of the thing that was built.

## Outcome

**Verified.**

- `bun run typecheck` clean and `bun run selftest` `RESULT: PASS (37/37 checks)`
  under `oven/bun:1` (bun 1.4.0), run today in a container with the repository
  mounted.
- The harness's own live run: `RESULT: FAIL (8/9 checks)`, quoted above in
  full, with the failing check being the one that should have failed.
- `make docs-verify` for this record.

**Not verified, and this is the boundary.** The suite has never asserted
anything about apid on a booted device. Every phase module has been read and
type-checked and its helpers self-tested against wrong input; none has been
executed against a guest. Until `make os-apid-api-test` completes with the
phase modules in place — and, for phases `07b` and `08`, with
`MOS_APID_BOOT2=1` — the correct reading of this task is *the instrument is
built and calibrated offline*, not *the measurement was taken*. That is why the
index row is `[ ]`.
