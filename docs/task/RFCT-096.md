# RFCT-096 "0 skipped" does not mean nothing was skipped, and three test files still exploit that

- **status**: pending
- **priority**: P1
- **owner**: (unclaimed)
- **createdAt**: 2026-08-22 21:05

Measured by PLAN-011 M5's T11, and it undermines the acceptance criterion this
repository has been reading as proof.

**`cargo nextest`'s "0 skipped" counter cannot detect an in-test
`return Ok(())`.** A test that decides at runtime it cannot do its work — a
missing `dbus-daemon`, an absent fixture — and returns early is counted as
**passed**, not skipped. So every "green, 0 skipped" claim in this repository is
compatible with a suite in which several tests asserted nothing at all.

That is not hypothetical. `docs/task/RFCT-083.md:20-23` records `check.sh` green
on a host that lacked `dbus-daemon`. In that run `mosd/mosd/tests/bus.rs`,
`mosd/mosd/tests/tree.rs` and `mosd/apid/tests/e2e.rs` all returned early and
asserted nothing, and the gate reported success with zero skips.

## Still live at the time of writing

M5 fixed `mosd/mosd/tests/bus.rs` (RFCT-093's T11: it now panics, and CI
provisions `dbus-daemon`). Three sites remain, deliberately left because M5's
scope was closed:

- `mosd/mosd/tests/tree.rs` — a shared helper feeding **five** `return Ok(())`
  sites, so one absent tool silently empties five tests.
- `mosd/apid/tests/e2e.rs` — the original case named in RFCT-089's
  cross-workstream notes. Campaign 1 corrected its login-flow expectations
  against RFCT-081's backoff curve; it did **not** remove the skip path, which
  is still there.
- `mosd/apid/src/tests/power_bus.rs`.

## Why this is P1 rather than tidy-up

The repository's own discipline is that a check reporting success while testing
nothing is the failure mode every gate exists to prevent
(`os/ui-location-test.sh:11-18`, `docs/design/mosd.md` §5.3 on named outcomes).
This is that failure mode **in the counter the gate reports**. Two campaigns
have quoted "N tests, 0 skipped" as evidence — in acceptance criteria, in task
outcomes, and in reports to the user — and that phrase is weaker than everyone
reading it believed.

## Open questions, none settled here

- Should a test that cannot run **fail** (T11's answer for `bus.rs`, chosen
  because `mosd/mosd/src/scan.rs` already panics bare, so CI must supply
  `dbus-daemon` regardless — provisioning makes an existing contract true rather
  than imposing a new demand), or should it be a real nextest skip that the
  counter can see?
- Is there a lint or a gate-side check that can find `return Ok(())` guarded by
  a tool-presence test, so a fourth instance cannot be added silently?
- Should `check.sh` print what it provisioned, so a green run states the
  conditions it was green under?

One measured trap for whoever provisions: on Ubuntu 24.04+ the `dbus-bin`
package installs cleanly but does **not** ship `/usr/bin/dbus-daemon`; the
correct package is `dbus-daemon`, verified by T11 on 22.04, 24.04 and 26.04.

Related: [[RFCT-092]] (a citation nothing checks), [[RFCT-094]] (a warning that
always fires), [[RFCT-095]] (an assertion that cannot fail). This is the same
family: a signal that cannot carry the information its reader assumes it does.
