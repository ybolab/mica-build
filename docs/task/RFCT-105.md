# RFCT-105 An over-the-wire suite for apid: nine phases against one boot, and effects observed on the device

- **status**: completed — The suite is merged — `test/apid-api/`, 23 files, 8726
  lines, offline selftest `RESULT: PASS (37/37 checks)` under bun 1.4.0 — and
  **the measurement has now been taken**. `make os-apid-api-test` runs against
  a booted x64 image and ends `RESULT: FAIL (231/232 checks)`. The single FAIL
  is **a defect in the daemon, not in the suite**: `POST /ssh/password` answers
  `502 Bad Gateway` on the shipped x64 image, so the transient SSH root
  password is non-functional. Finding that from outside was the point of
  building this; it is recorded in full below and deliberately **not fixed
  here**, because `mosd/` was read-only for this campaign
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

Those five gaps are what phases 01, 05, 07 and 07b are for. The first of them
is also what found the 502: a read-only rootfs on the far side of a real system
bus is the only place that failure exists.

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

That containment is not theoretical any more: it is exactly what the 502 did to
the continuous run, and the reason the lifecycle evidence had to be gathered
separately (below).

Reporting follows `os/verify-image-v2.sh`: one `PASS:`/`FAIL:` per assertion,
`RESULT: PASS|FAIL (n/m checks)` with dynamic totals, non-zero exit on any
failure. **Zero checks is a failure** — a run that asserted nothing must not
read as success.

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
offset, because a boot writes thousands of lines and `Started ssh.service` is
among them — a whole-file grep would let the *boot* satisfy an assertion about
a POST made thirty seconds ago, so the module contains no whole-file search at
all. (The live run proved that hazard is real in the harness's own waits too:
defect 3 below, where a readiness grep over the whole file matched the
*previous* boot's line.) And **a missing log is a SKIP, never a PASS**: with
no console, `expectConsoleAbsent` would make "the transient password never
appears in the log" **vacuously true**, so it refuses an empty window
outright.

`07b-postreboot` states where things live before it asserts, because getting
that wrong turns an assertion into a coincidence. `/var/lib/mos` is a bind
mount onto STATE, so `session.key` and `login_guard.json` **persist** — which
is what makes the backoff assertion a real test of `docs/design/access.md` §6
rather than a hopeful one — while `state.sessions` is an in-RAM table, so the
pre-reboot cookie is refused because its id is simply gone. The phase says
which of the two reasons it is claiming. It also records the finding it would
report but never fix: if the boot-2 console shows apid **regenerating**
`cert.pem` or `session.key`, STATE did not mount. On the live run it did not
regenerate either; STATE mounted.

`02-setup` does not merely assert `SameSite=Lax` on the cookie. apid issues
**no CSRF token**, so `SameSite=Lax` is the *entire* cross-site defence and
`HttpOnly` the entire defence against script theft — and the phase checks the
absence of every marker an anti-forgery scheme would have to leave in the
markup or the headers. The claim is verified, not asserted in a comment.

## The defect this campaign found: `POST /ssh/password` answers 502

**The transient SSH root password is non-functional on the shipped x64 image.**
This is a defect in **mosd**, found from outside, and it is the headline
result of this task.

**Reproduction.** With a valid session, `POST /ssh/password` with the body
`password=<pw>&confirm=set-transient-password`. apid answers **502 Bad
Gateway** where every other form post answers 303. The suite's line, from the
continuous run of 2026-08-24:

    FAIL: POST /ssh/password (password + confirm=set-transient-password) is accepted with 303
        expected: status 303
        actual:   status 502 Bad Gateway
        request:  POST /ssh/password

**The console says why.** From the same run's `console-boot1.log`, inside the
window marked before the POST (kernel time 69.56 s; the pid is whatever apid
got on that boot):

    apid[772]: WARN apid::routes: mosd call failed
      error=org.freedesktop.DBus.Error.Failed: set transient root password:
      record the transient marker:
      create /etc/.transient-root-password.mosd-tmp: Read-only file system (os error 30)

**Root cause, traced in the source, because a symptom without one is a bug
report somebody has to re-do.** `mosd/mosd/src/transient.rs:88`:

    pub fn transient_marker_path(shadow_path: &Path) -> PathBuf {
        shadow_path.with_file_name(MARKER_NAME)
    }

`production_shadow_path()` is `/etc/shadow`, and `mosd/mosd/src/main.rs:13`
says in its own comment that this *"is a symlink onto STATE on the v2 image"*.
`Path::with_file_name` is **lexical**: it does not resolve the symlink. So the
write to `/etc/shadow` follows the link onto STATE and succeeds, while the
marker written *beside* it lands in the literal directory `/etc/` — a
dm-verity squashfs, read-only, `os error 30`. Other writable paths under `/etc`
on this image are bind mounts (`etc-hostname.mount`,
`etc-containers-systemd.mount`); this one is not.

**Why no existing test catches it, which is the part worth recording.**
`transient.rs`'s own unit test
`the_marker_sits_beside_the_shadow_file_whatever_that_is` asserts three cases —
`/var/lib/mos/shadow`, `/mnt/state/mos/shadow`, `/tmp/case-3/shadow` — and
every one of them is an already-**resolved** path. The single path production
actually passes, the `/etc/shadow` symlink, is not among them. The test is
correct about what it tests and blind to the production case. And
`mosd/apid/tests/e2e.rs` cannot reach it either: it runs with `MOSD_DRY_RUN=1`
*precisely because* setting a transient password rewrites the shadow file, so
no reconciler ever executes. Catching this needs a real read-only rootfs on the
far side of a real system bus — the narrow claim `docs/design/api.md` §10.4
makes for this suite, now demonstrated rather than argued.

**Not fixed, deliberately.** `mosd/` was read-only for this campaign, and
putting an unreviewed daemon change on a test branch is not a trade worth
making. Whoever fixes it — resolving the shadow path before deriving the marker
from it, or giving the marker its own writable location — should re-run
`make os-apid-api-test` and expect all nine phases to execute continuously,
which is the thing the 502 currently prevents.

Downstream of the 502, one check in 05 stays a SKIP that would otherwise have
been promoted: the audit event for the transient password. There is no event to
word a pattern from, because the operation never happens. The module says so at
the SKIP rather than inventing a pattern.

## What the live runs measured

**The continuous run.** `make os-apid-api-test` on 2026-08-24, against
`x64-mos-v2-1787568481.img` (built 10:48Z), one boot on the `traefik` docker
network:

    RESULT: FAIL (231/232 checks)          # harness + suite, the merged total
    boot1 suite: {"pass": 223, "fail": 1, "skip": 6}

    01-transport     pass   25/25
    02-setup         pass   29/29
    03-login         pass   24/24
    04-readonly      pass  118/118
    05-mutate        fail   27 pass, 1 fail, 2 skip
    06-backoff       skip   (05-mutate failed)
    07-reboot        skip   (05-mutate failed)
    07b-postreboot   skip   (05-mutate failed)
    08-poweroff      skip   (05-mutate failed)

The one FAIL is the 502 above. `06`, `07`, `07b` and `08` are **SKIPped in a
continuous run** — not passed, not failed — because 05 failed and the runner
contains failures by design, each skip quoting the failing phase and its own
`assumes` string. The harness then declines the second boot at all, because the
reboot handoff 07 writes is absent: attempting one would run post-reboot
assertions against a machine that never restarted.

**The lifecycle evidence therefore comes from a GROUPED run, and that is not
the same evidence.** Say it plainly: the one-boot, nine-phase ordering *is* the
design, and while the 502 stands, no single run exercises it end to end. What
was run instead:

    MOS_APID_PHASES=01-transport,02-setup,03-login,06-backoff,07-reboot
    -> RESULT: PASS (128/128 checks)

across two real boots off one disk — boot 1 `PASS (101/101)`, boot 2 running
`07b-postreboot` PASS (6 pass, 2 skip) and `08-poweroff` PASS (9 pass), 15
checks. Every phase in that run still declared and got its `assumes`; what it
does not prove is that the same device survives 04 and 05 on the way there.
Closing that gap needs the daemon fix, not a suite change.

**The reboot and the power-off are proven from the console**, not from a status
code. 07's shutdown check matched
`systemd-shutdown[1]: Using hardware watchdog 'iTCO_wdt'` **1002 ms** after the
post, with `systemd-shutdown[1]: Rebooting.` a second behind it; boot 2's own
console then opens with

    BdsDxe: loading Boot0001 "UEFI Misc Device" from PciRoot(0x0)/Pci(0x2,0x0)
    GNU GRUB  version 2.12-9+deb13u2
    apid[639]: APID_LISTENING https=0.0.0.0:443 http=0.0.0.0:80

— firmware, GRUB and a *different* apid pid, which is what makes it a second
boot rather than a claim about one. 08's power-off matched
`systemd-shutdown[1]: Powering off.` 2003 ms after its post.

**A device effect, end to end.** `POST /containers/enable` produced, in order,
mosd's `container: turn_on begin`, mosd's `container: starting the bind`, and
systemd's `Mounted etc-containers-systemd.mount - Quadlet unit directory on the
STATE partition.` — three lines none of which is written by the route under
test.

**Power actions answer 202, not 303.** Measured, and it is not what the suite
assumed: every other form post in apid answers 303, `/power/reboot` and
`/power/poweroff` answer **202 Accepted**, and an unconfirmed post answers
**422** rather than a redirect. 202 is the honest code — the machine is going
away, so there is no page to redirect to — and the console confirmed the reboot
1002 ms later, so 202 *is* acceptance and the 303 expectation was simply wrong.
Worth recording where the mistake was: `docs/design/api.md` §1 already had it
right — its route table records **202 Accepted** for both power routes and
**422** when the confirm token does not match. The suite inferred 303 from the
shape of every other form post instead of reading the row, which is the same
habit this campaign keeps catching in the other direction.

**Three of four console SKIPs were promoted to hard checks** once the wordings
were measured on the live guest: the hostname rename (`Hostname set to
<mos-e2e-renamed>`, with the new name required *inside* the line, so a match is
evidence about *this* rename and not about the boot's own), the container
bind coming down (`etc-containers-systemd.mount: Deactivated successfully.`),
and ssh.service stopping (an alternation over its three wordings, because which
lands first is timing, not whether the device acted). The measurement also
killed a candidate pattern that could never have matched: **mosd emits no
`container: turn_off` line at all** — the reconciler logs `container: turn_on
begin` going up and nothing symmetrical coming down. The fourth, the transient
password's audit event, could not be promoted: see the 502.

## That the suite can fail, proved twice

`src/selftest.ts` runs offline in seconds — no network, no docker, no QEMU, no
image — and drives every assertion helper, the cookie jar, the redirect
refusal, the verbatim request writer and the phase runner against inputs that
are **deliberately wrong**, requiring each to fail *with its own message*. Its
`RESULT: PASS (37/37 checks)` means "37 wrong answers were correctly rejected".
Measured under `oven/bun:1` (bun 1.4.0), six phases: `selftest-negative`,
`selftest-positive`, `selftest-client`, `selftest-runner`, `selftest-config`,
`selftest-sni`. **Positive controls sit beside every negative**, so a helper
hardwired to always fail does not satisfy it either.

**The live half is now done too, and it was worth doing.** The negative control
ran against the booted guest, aimed at a *device-effect* assertion rather than
a status code: `APID_NEGATIVE='starting the bind'`, which inverts the check
that mosd's container reconciler logged `container: starting the bind`. The
same command was run twice, differing in nothing but that variable — 224
counted checks both times, 230 reported lines both times, and **exactly one
line different**:

    < FAIL: (b) device effect: mosd's container reconciler logged `container: starting the bind`
    > PASS: (b) device effect: mosd's container reconciler logged `container: starting the bind`

Both runs were red overall, because both hit the 502 — `FAIL (230/232)` with
the inversion and `FAIL (231/232)` without it. What the control demonstrates is
the *delta*: one named device-effect assertion, on a real guest, made to fail on
demand and reported as such, with `NOTE: APID_NEGATIVE inverted this check
(pass -> fail); this run is expected to be RED` beside it so an inverted run can
never be mistaken for a clean one.

**That demonstration required a harness fix, and the fix is the interesting
part.** `run.sh` was not forwarding `APID_NEGATIVE` into the suite container,
so the run that was supposed to be red ran **green** — the knob looked applied
and was not. That is precisely the false negative the knob exists to rule out,
and it was found by using it. Both `APID_NEGATIVE` and `APID_HANDOFF` are now
forwarded when set and omitted entirely when unset, so an unset knob keeps the
suite's own default rather than being overridden with an empty string.

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
drops the flag degrades correctly. The second boot is no longer opt-in:
`MOS_APID_BOOT2` defaults to `1` (`test/apid-api/run.sh:111`), and
`07b-postreboot` and `08-poweroff` have both run and passed on a real second
boot.

**3. Image/code skew, now guarded rather than merely noted.** The image under
test predates RFCT-104, so `/mqtt` and `POST /mqtt/enable` are **uncovered**;
the skew is visible on the console as `mos-mqttd` warning `broker connection
lost; retrying after backoff error=I/O: Connection refused (os error 111)`,
which is the RFCT-097 behaviour RFCT-104 replaced. What has changed since this
record was first written is that the under-coverage now **announces itself**:
`04-readonly` asserts `GET /mqtt` with `Accept: */*` → **404** and
`POST /mqtt/enable` → **405**, and both passed on today's image. Those are the
two answers the *fallback* gives and a real route cannot — a real
`get(mqtt_form)` ignores `Accept` entirely and answers 200, and a real
`post(mqtt_enable)` answers anything but 405 — so a rebuilt image turns both
red at once. Each failure detail carries the instruction rather than a puzzle:

    THIS IS AN IMAGE-SKEW GUARD, NOT A DEFECT IN apid. [...]
      the image now serves /mqtt; add it to PANES and /mqtt/enable to
      POST_ONLY in 04-readonly, then update this guard.

The routes themselves remain uncovered until the image is rebuilt; the guard
buys notification, not coverage.

**4. `/network`'s no-op round trip is NOT exercised, and this one got worse.**
Measured: a freshly provisioned device renders **no configured interface at
all** — `/network` shows the "Add interface" fieldset and nothing above it,
because the link this suite talks over is brought up by systemd-networkd's own
defaults rather than by anything in mosd's settings. The phase previously
**FAILED** there, i.e. reported the device's ordinary shipped state as a
defect; it now asserts the pane renders and **SKIPs the round trip** with that
reason. Be clear about what was lost: there is genuinely no no-op to make.
Posting `dhcp=on` against nothing configured would **create** configuration
rather than round-trip it, and posting a static address is forbidden outright
from this suite — it would reconfigure the very interface every other assertion
travels over, and the resulting timeouts would look exactly like apid crashing.
So the reconciler's "applies an identical configuration without tearing the
link down" behaviour is **untested**. Closing it needs a device with a
mosd-managed interface, or a harness that can reach the guest another way.

## What the live run cost the documentation: one stale number

`test/apid-api/README.md:14` justifies the one-boot design with *"A TCG boot of
the image takes roughly **ten minutes**"*, and `HARNESS.md:120` says ~200–260s
to a login prompt. **Measured on this host, under TCG with no `/dev/kvm`,
across this campaign's eight runs**: launch to `APID_LISTENING` is **60–66 s**,
ready (both signals) at **65–72 s**, and a full two-boot lifecycle run takes
about **four minutes** wall clock end to end.

**The one-boot decision is unaffected and should not be revisited on this
number.** A full run is two boots plus nine phases plus 06-backoff's own
doubling windows, and TCG under load varies by multiples. But the ten-minute
figure is not a measurement of this host, and the sweep that chased it found it
had propagated from **one brief** into four places that rest a decision on it --
`README.md`, `HARNESS.md`, `src/runner.ts` and `run.sh` -- which is the part
worth recording, because one unsourced number copied until it justifies a design
is the same class of defect RFCT-092 was opened about. **Those four are now
corrected**: README.md and HARNESS.md at `1c0b428`, `src/runner.ts` and `run.sh`
after it. The sweep also counted **nine further occurrences** in the suite's
source (`config.ts`, `client.ts`, `console.ts`, `report.ts`, `selftest.ts:701`,
`runner.ts:80`, `05-mutate.ts`, `07-reboot.ts`, `07b-postreboot.ts`) where the
figure is an incidental cost aside -- *"costs a ten-minute TCG boot to
diagnose"* -- rather than a premise. Those are **open**; one of them is a
selftest check's text, so correcting it edits an assertion string.

## The defects this campaign found in the suite itself

**Before any live run: the SNI defect, in the suite's own client.**
`tls.connect()` throws synchronously when `servername` is an IP literal — SNI
carries a `host_name` and never an address (RFC 6066 §3), and bun *enforces* it:
`TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.servername' Setting
the TLS ServerName to an IP address is not permitted`, measured under bun 1.4.0
for both `127.0.0.1` and `::1`. Node behaves the same way; it is not a bun
quirk. This campaign's host is **always** an IP literal — the QEMU container's
address on the shared docker network, and `config.ts` refuses to default
`APID_HOST` precisely so nobody aims the suite at loopback — so the fault made
`inspectCertificate()` and every raw HTTPS write throw at call time, and the
suite could not have made a single TLS assertion against a real device. Fixed
in `4de57ef` by `sniServerName()`, which omits the property (absent, not
`undefined`) for an IP and passes a hostname through unchanged. The pure
`selftest-sni` guard has three checks rather than two on purpose: a function
hardwired to return `undefined` would satisfy both IP cases and silently drop
SNI against a hostname, where it is legal and useful.

**Then the live runs found nine more, every one in the suite or the harness and
none in apid.** They are worth a line each because they are all the same class
— *green while asserting nothing* — which is the class this campaign keeps
hitting:

1. **A 303 alone was read as an accepted power action.** With no valid session
   the auth gate answers *every* route with 303 to `/login`, so `08-poweroff`
   PASSED "the confirmed POST is accepted" on a run where the guest was never
   asked to do anything. Both 07 and 08 now assert the `Location` is not the
   gate's.
2. **A phase that asserted nothing recorded `"status": "pass"`.**
   `07b-postreboot` ran, skipped all five of its checks because the handoff was
   missing, and wrote `pass` into the result JSON — the same "no failures means
   success" reading `run.sh` already refuses for the whole run, one level down.
   A phase with no passing check is now recorded as `skip`.
3. **The readiness wait matched `APID_LISTENING` from the PREVIOUS boot.** A
   guest that resets in place appends to the same console capture, and
   `wait_for_apid` grepped the whole file — so it declared the guest ready
   **0 s** after a reboot that had just taken it down. Every wait is now
   anchored to the console's size at the moment it began.
4. **The harness attempted a second boot when nothing had rebooted.** On the
   run where the 502 failed 05, the runner skipped 06 and 07, nothing rebooted,
   and the harness treated the still-running first boot as the second one —
   running every post-reboot assertion against a machine that had not
   restarted, with 08 reporting the most destructive assertion in the suite as
   PASS. The reboot handoff's presence and mtime is now the signal, and its
   absence is stated in a sentence instead of assumed away.
5. **The handoff recorded the hostname 05 was *configured* to apply, not the
   one it *did* apply.** In a full run the two coincide, so it was invisible; a
   phase-restricted run exposed it, and 07b then FAILED about a rename that was
   never performed — a phase reporting the *shape of the run* as a defect in
   the device, which also skipped a real power-off. 07 now reads what 05
   recorded, and 07b skips with that reason.
6. **The harness raced QEMU's exit.** 07 returns as soon as the HTTPS port goes
   quiet, which is before QEMU has torn down; a single `docker inspect` at that
   instant still said RUNNING, so the harness concluded "reset in place" and
   waited out its entire 900 s deadline on a container that had exited seconds
   later. The container now gets a bounded grace period to exit.
7. **`03-login` timed the backoff window from before the POST.** apid hashes
   with argon2, deliberately slowly, and on a TCG guest that one request took
   over a second — the whole window — so the phase waited only its margin and
   the correct password came back 429 from a guard still armed. Timed from the
   401 response now, which errs in the safe direction, with the round-trip time
   in the failure detail.
8. **`client.follow()` threw on a response with no `Location`**, and `03-login`
   called it unguarded, so one unexpected status cost the phase every remaining
   check — it threw instead of reporting. Guarded in 03 and in `02-setup`,
   which had the same shape.
9. **`APID_NEGATIVE` was not forwarded into the suite container**, so the run
   that was supposed to be red ran green. See above: the knob's own false
   negative, found by using the knob.

Two consolidations sit alongside these rather than among them: the duplicate
console reader inside `07-reboot.ts` was folded into `src/console.ts` (which
refuses to attribute lines when a log *shrinks*, where the other silently
restarted from offset 0), and that consolidation surfaced two assertions a
missing console could satisfy vacuously — both now SKIP with the reason.

**Defects found in apid/mosd: one, and it is the 502.** That is what the
instrument was for.

## Outcome

**Verified.**

- `make os-apid-api-test` end to end: `RESULT: FAIL (231/232 checks)`, boot1
  `{pass 223, fail 1, skip 6}`, the single FAIL being the daemon's 502 on
  `POST /ssh/password`. Artefacts: `realrun.log`, `suite-boot1.log`,
  `result.json`, `console-boot1.log`.
- The lifecycle, from a grouped run:
  `MOS_APID_PHASES=01-transport,02-setup,03-login,06-backoff,07-reboot`
  → `RESULT: PASS (128/128 checks)` across two real boots off one disk, with
  `07b-postreboot` and `08-poweroff` green on boot 2 and the reboot, the second
  firmware/GRUB boot and the power-off all read off the console.
- The negative control against the live device: same command twice, one
  variable different, one line different.
- `bun run typecheck` clean and `bun run selftest` `RESULT: PASS (37/37
  checks)` under `oven/bun:1` (bun 1.4.0).
- `make docs-verify` for this record.

**Not verified, and this is the boundary.**

- **No single continuous run has executed all nine phases**, and none can until
  the 502 is fixed: 05 fails, and the runner correctly contains that failure.
  The lifecycle evidence above is from a grouped run, which is weaker evidence
  than the one-boot design is meant to produce.
- **§4.4's traversal guards, `/mqtt`, and `/network`'s no-op round trip are
  uncovered**, for the reasons under "The limits" — a bundle-less device, an
  image built before the routes existed, and a device with no mosd-managed
  interface respectively.
- **The 502 itself is reported, not fixed.** `mosd/` was read-only here.
