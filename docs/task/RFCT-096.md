# RFCT-096 "0 skipped" does not mean nothing was skipped, and three test files still exploit that

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-22 21:05

Measured by PLAN-011 M5's T11, and it undermines the acceptance criterion this
repository has been reading as proof.

**`cargo nextest`'s "0 skipped" counter cannot detect a test that returns early
of its own accord.** A test that decides at runtime it cannot do its work — a
missing `dbus-daemon`, an absent fixture — and returns without asserting is
counted as **passed**, not skipped.

Note the defect has **more than one spelling**, so grepping for any single form
will undercount it: an explicit `return Ok(())`, and `?`-propagation of a
`None`/`Err` out of a tool-lookup helper (`find_dbus_daemon()?`). Describe the
family by behaviour — *a test that returns without asserting because a
precondition is absent* — not by syntax. So every "green, 0 skipped" claim in this repository is
compatible with a suite in which several tests asserted nothing at all.

That is not hypothetical. `docs/task/RFCT-083.md:20-23` records `check.sh` green
on a host that lacked `dbus-daemon`. In that run `mosd/mosd/tests/bus.rs`,
`mosd/mosd/tests/tree.rs` and `mosd/apid/tests/e2e.rs` all returned early and
asserted nothing, and the gate reported success with zero skips.

## Still live at the time of writing

M5 fixed `mosd/mosd/tests/bus.rs` (RFCT-093's T11: it now panics, and CI
provisions `dbus-daemon`). Three sites remain, deliberately left because M5's
scope was closed:

- `mosd/mosd/tests/tree.rs` — a shared `start()` helper (`tree.rs:111`,
  returning `Result<Option<Harness>>`) feeding **five** early-return sites, so
  one absent tool silently empties five tests at once.
- `mosd/apid/tests/e2e.rs` — the original case named in RFCT-089's
  cross-workstream notes. Campaign 1 corrected its login-flow expectations
  against RFCT-081's backoff curve; it did **not** remove the skip path, which
  is still there.
- `mosd/apid/src/tests/power_bus.rs` — skips by `?`-propagating `None` out of
  `find_dbus_daemon()` (`power_bus.rs:229`), not by `return Ok(())`; the same
  defect in a different spelling, which is why the family is described by
  behaviour above.

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

## Resolution

All three remaining sites now apply T11's answer for `bus.rs`: a test that
cannot do its work **fails**, loudly, naming the missing tool — never a silent
pass and never a skip. CI must provision `dbus-daemon` regardless, because
`mosd/src/scan.rs` already panics bare without it; failing makes an existing
contract visible rather than imposing a new demand.

- `mosd/mosd/tests/tree.rs` — `find_dbus_daemon() -> Option<PathBuf>` replaced
  by a panicking `dbus_daemon() -> PathBuf` (the same function, message
  included, that `tests/bus.rs` carries, down to the `dbus-bin`-is-not-enough
  trap this task recorded); `start()` now returns `Result<Harness>` and the
  five `let Some(harness) = start().await? else { return Ok(()); }` sites are
  plain `let harness = start().await?;`.
- `mosd/apid/tests/e2e.rs` — same replacement; the
  `eprintln!("skipping ..."); return Ok(())` path is gone.
- `mosd/apid/src/tests/power_bus.rs` — the `?`-propagation spelling:
  `fake()` returned `Option<Fake>` via `find_dbus_daemon()?`, and a
  `fake_or_skip!` macro turned `None` into a silent green in four tests. Both
  are gone: `fake()` returns `Fake` and absence panics through the same named
  message.

RED demonstrated before green: with the change and **without** installing
`dbus-daemon` in the container, `cargo nextest run -p mosd --test tree -E
'test(a_burst_of_changes_coalesces_into_one_items_changed)'` now fails —

    FAIL [ 0.007s] (1/1) mosd::tree a_burst_of_changes_coalesces_into_one_items_changed
    panicked at mosd/tests/tree.rs:64:9:
    dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. This test
    asserts real bus behaviour over a private session bus and MUST NOT skip ...

— where before the change the same run reported it passed. The full workspace
gate is green with `dbus-daemon` installed.

**Explicitly not done here**: the open question about a GATE-SIDE check (a
lint or `check.sh`-level guard that could catch a fourth silently-skipping
test being added, and having `check.sh` print what it provisioned). That is
gate hardening and belongs to PLAN-020's scope, not this task.
