# Design: time — NTP, timezone and the trusted-clock floor

> Always-running network time on the systemd/mosd base, a STATE-backed
> last-known-good clock floor, and a presentation-only timezone. Companion to
> mosd.md, api.md and ro-root.md. Implements PLAN-044 / RFCT-280.

## 1. What ships

- **`systemd-timesyncd`**, installed by `mos-system` and enabled statically
  (`sysinit.target.wants`), always running. There is **no enable or pause
  control anywhere** — not in the settings tree, not in the API, not in the
  UI.
- **Pinned base policy** in `/etc/systemd/timesyncd.conf.d/50-mos.conf`:
  adaptive polling 32–2048 s, 30 s connection retry, 60 s saved-clock
  interval. These are decisions, not settings; `verify`'s
  `packed-timesyncd-policy` check holds an image to them.
- **Two settings and only two** (schema v9): `time.ntp.servers` (a bounded,
  validated list of server names/addresses; empty means the image fallback
  pool) and `time.timezone` (a validated IANA name, presentation only).
- **A mosd reconciler** (`reconciler/time.rs`) rendering both into runtime
  configuration, and **a read-only status observer** (`time_status.rs`)
  served as `GetTimeStatus` on the bus and `GET /api/v1/time/status` over
  HTTPS.
- **A DATA-backed saved clock**: timesyncd owns `/var/lib/systemd/timesync`
  beneath the persistent whole-var bind.

## 2. UTC everywhere; the timezone is presentation

Machine, RTC, API and log time are UTC, always. The image bakes no zone —
`/etc/localtime` is absent or a UTC symlink, and `verify`'s
`packed-localtime-utc` check refuses anything else.

`time.timezone` is therefore **never applied to `/etc/localtime`**, and that
is a measured decision, not a shortcut. The `/etc/hostname` pattern (a
STATE-backed file bind written through `fswrite`) does not transfer:
`/etc/localtime` is a *symlink into zoneinfo*, so a bind onto it resolves onto
`/usr/share/zoneinfo/…/UTC` itself and hands the operator's local zone to
every reader of UTC — journald timestamps included — which is exactly the
corruption the UTC contract forbids.

Instead, mosd owns persistence (the settings tree) and application:

- the reconciler renders the zone name to **`/run/mos/timezone`** (one line),
  the runtime artifact any on-device consumer of "the operator's zone" reads —
  an explicitly local schedule being the intended future consumer;
- the API serves it (`GET /api/v1/settings/time.timezone`) and the UI formats
  presentation times with it;
- validation is **syntactic and deterministic** at every write surface
  (`mosd_settings::validate_timezone_name`, the tzdata name grammar — no
  dependence on the host's tzdata in unit tests); whether the zone file
  actually exists under `/usr/share/zoneinfo` is checked at reconcile time
  and published as `time.timezone.available` in live state, a warning and
  never a failure.

## 3. Boot ordering: RTC → saved floor → network time → TLS/catalog

The trusted-clock floor is `max(RTC, saved clock)`, in place before anything
that validates certificate or metadata expiry runs:

1. **RTC.** The kernel (and systemd's built-in epoch clamp) set the initial
   clock from the RTC where the board has one. cx3576 declares an
   AT8563/HYM8563 RTC; driver and backup-power validation are
   hardware-dependent (see RFCT-280's completion note).
2. **Saved floor.** timesyncd starts after `var.mount` and creates its owned
   state directory at `/var/lib/systemd/timesync`. It touches `…/clock` every 60 s
   (`SaveIntervalSec`, pinned) and at startup **advances a clock that is
   behind that file's mtime**. DATA/var survives reboots and component updates,
   so a device with no RTC or a dead RTC battery still
   boots no earlier than the last minute it was known to be running.
3. **Network time.** timesyncd (in `sysinit.target`) polls the managed or
   fallback servers on the pinned adaptive policy and disciplines the clock.
4. **TLS/catalog consumers.** Everything that validates expiries starts after
   `sysinit.target`, i.e. after the floor is in place; network time then only
   moves the clock forward-or-slightly-sideways from a floor that was already
   sane. What those consumers validate is boundary (b) of
   `docs/design/security-model.md` §3; the floor is what keeps its expiry
   checks meaningful.

The ordering `Before=systemd-timesyncd.service` on the mount is load-bearing:
timesyncd reads the clock file once, at startup, so a bind that arrives later
shadows the saved clock silently.

## 4. Reconciliation

`time.ntp.servers` renders to `/run/systemd/timesyncd.conf.d/60-mos-servers.conf`
(`NTP=` under `[Time]`; `60-` so it sorts after the pinned `50-mos.conf` and
shadows nothing). `/run`, not STATE: the file derives entirely from the
settings tree and is re-rendered before the unit is touched on every boot.
An empty list renders **no `NTP=` line** — a bare `NTP=` would clear the
compiled-in fallback pool and leave the device polling nothing.

The server-list grammar (`mosd_settings::validate_ntp_servers`: hostname/IP
charset, 253-byte bound, at most 8, no duplicates) is stated once in
mosd-settings and enforced through `Settings::set` itself, so no write
surface can store what the renderer cannot carry.

A changed render restarts timesyncd (no `ExecReload`; a restart costs one
poll cycle). A timezone change restarts nothing — timesyncd does not read it.
The reconciler never enables or disables the unit; the image owns enablement.

## 5. Synchronization status

`GET /api/v1/time/status` (read-only, authenticated) serves mosd's
classification over live evidence from `org.freedesktop.timesync1`
(ServerName, ServerAddress, NTPMessage) and `org.freedesktop.timedate1`
(NTPSynchronized):

| status | meaning |
| --- | --- |
| `synchronized` | timedate1 reports a bounded clock error (see below) |
| `polling` | a server is selected and packets are being exchanged, and that bound is not reported |
| `offline-degraded` | no usable server; the floor holds and retries continue on the pinned 30 s policy |
| `invalid-source` | a server answered and its replies are unusable (leap 3, stratum 0 or ≥ 16) |
| `unknown` | a signal the state would rest on could not be read (see below) |

**What `synchronized` asserts, exactly.** It is timedate1's
`NTPSynchronized` and nothing else, and that property is *not* "an NTP reply
arrived": timedated computes it as `adjtimex().maxerror < 16 s`, the kernel's
own bound on how wrong the clock may be. The response carries that bit as
`synchronized` beside the state, so a reader never has to infer which signal
was used.

**Why the other state is `polling` and not `synchronizing`** (RFCT-299). The
two claims above are legitimately different, and a device can hold a usable
sample while failing the second one for as long as the cause lasts: timesyncd
writes `maxerror` back down only through the `clock_adjtime` call it makes for
a sample it *accepts*, so a reply rejected as a spike leaves the bound growing
at the kernel's tolerance while replies keep arriving. `synchronizing` reads
as "in progress, nearly there" and would therefore publish a prediction the
device cannot make. `polling` names what is observed — a server is selected
and answering — and promises nothing about where it is heading. An operator
reading `polling` with a healthy `sample` is being told the truth: the clock
is *not* known to be within the kernel's bound, and the evidence for both
halves is in the same response.

**What `unknown` covers** (RFCT-300). It is the state for a signal that could
not be *read* — not for one particular daemon being down. Two services feed
the classification and either read can go missing: `timesync1` may not be on
the bus at all, or `timedate1` may not answer `NTPSynchronized`. Three of the
other four states rest on that second bit — `synchronized` asserts it, and
`polling` and `offline-degraded` are only reached once it has been ruled out
— so a read that did not answer cannot produce any of them. A device nobody
could query is not a device that was queried and found out of sync, and
reporting the second for the first sends an operator after a clock that may
be perfectly disciplined. `invalid-source` is the exception and survives an
unread bit: it rests on the sample alone, already outranks the bit, and says
only that the source's replies are unusable, which *was* read.

Nothing is inferred to fill the gap — no sample, stratum or earlier reading is
promoted into a state. The evidence that was read is still reported (`server`
and `sample` appear as observed), the `synchronized` member stays **absent**,
and that absence beside `unknown` is what distinguishes "not read" from "read
and false". `detail` names the read that went missing, since the two live in
different services and only one of them is worth looking at.

Nothing in the status path can stop retries — it observes, it never acts.
The classification (`time_status::classify`) is a pure function with
deterministic offline/online tests.

**Step versus drift**: where the last NTP sample is available, the response
carries `sample.offsetSeconds` and `sample.correction` — `"step"` past
timesyncd's own 0.4 s step boundary, `"slew"` inside it — so status readers
and audit trails can tell a clock correction from ordinary drift. Absent
evidence stays absent; no member is manufactured.

## 6. Out of scope

PTP, NTS, user-configurable polling periods and any NTP pause switch
(PLAN-044). Per-board RTC backup-power validation is hardware work tracked in
RFCT-280.
