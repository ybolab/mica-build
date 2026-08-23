# RFCT-085 access.md §6 made real in apid: persistent backoff counters and a bounded audit trail

- **status**: implementation complete — `cargo test -p apid` green (146 tests incl. 8 new persistence tests, mutation-checked); `docs/design/access.md` §6 rewritten per-intent
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-21 10:25
- **claimedAt**: 2026-08-21 10:25

Base `db57f2c` (RFCT-083 commit). One of the five roadmap workstreams the
RFCT-083 audit named and deferred; scope and outcome recorded at completion.

- **completedAt**: 2026-08-23 (finished by a later session; see below)

## How this was finished, and what was found

**Picked up 2026-08-23, two days after it stopped.** The work had been left
mid-flight: `audit.rs` (198 lines) and `persist.rs` (81 lines) sat on disk
with **no `mod` declaration anywhere**, so the compiler had never seen them,
and `auth.rs`'s `GuardStore` called `crate::persist::*`, which made the whole
`apid` crate fail to build. Nothing referenced `GuardStore` or `Audit` outside
the files that defined them.

What was missing was wiring, not design. Both modules are complete and well
made; `audit.rs` even ships its own three tests and an axum `Source`
extractor.

**Wiring done here.** `mod audit; mod persist;` declared in `main.rs`;
`chrono` added to `apid/Cargo.toml` (it is a workspace dependency the crate
had never listed, and `audit.rs` needs it for RFC 3339); `AppState.guard`
moved from `Arc<Mutex<LoginGuard>>` to `Arc<GuardStore>`, which folds the lock
handling inside and removes three `.lock().unwrap_or_else(...)` chains from
`routes.rs`; `AppState.audit` added; `AppState::with_persistence(state_dir)`
added and called from `main.rs`, rooting both in the directory that already
holds the TLS material. `login_submit` and both power handlers take the
`Source` extractor and record their outcomes.

**Eight tests added, because the shipped ones tested the curve and not its
survival.** The pre-existing `auth.rs` tests are all about `LoginGuard` — the
pure counter — and every one of them passes against an in-RAM guard, which is
what §6 exists to reject. The new ones are about the store: a restart still
refuses an attempt the armed window refused; the failure RUN survives too, so
an attacker cannot hold the curve at its base step by power-cycling; an
elapsed deadline does not come back as a lockout; a ten-year deadline is
capped rather than honoured; corruption starts clean rather than locking out;
the file is written and is 0600; fifty refused attempts rewrite nothing; and
the ephemeral store touches no filesystem.

**Mutation-checked.** With `GuardStore::load` altered to ignore the file
entirely, three of the four reload tests turn red. The fourth —
`an_elapsed_window_does_not_come_back_as_a_lockout` — stayed GREEN, because
"the attempt is admitted" is also what a store that never read the file does.
That is the assertion-that-cannot-fail shape this repository keeps finding, so
the test now asserts the failure count was loaded first, and under the same
mutation it turns red. Recorded rather than quietly fixed: the version that
looked fine was the version that proved nothing.

**`docs/design/access.md` §6 rewritten intent by intent**, because two of its
four are now real and two are not, and a single status marker on the section
would have been wrong either way. The persistent counters and the bounded
trail are `[implemented]` with paths. The hard lockout and the session/upload
audit are `[not implemented]` **with the reason**: both are lockdown decisions
whose failure mode is a bricked appliance, and §9 records that there is no
software path back in. The `no audit trail ⇒ no shell` claim is explicitly
NOT taken. The META → STATE deviation is recorded where the original text
said META.

## Not claimed

**No on-device verification.** Everything above is host tests. That the
counter survives a real power cycle on real hardware is the user's acceptance.

**An unrelated harness weakness, found and not fixed.** `apid`'s `e2e.rs`
spawns `target/debug/mosd` and checks only that the binary EXISTS. A stale one
is used silently — this run hit a two-day-old build and failed with
`reboot request never reached mosd`, which reads exactly like a regression in
the code under test. Attribution took a baseline worktree. The freshness check
belongs with RFCT-096's family of signals that do not say what they appear to.
