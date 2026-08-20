# RFCT-078 The five broken-classes behavioural suite, with coverage asserted

- **status**: complete — each of §6.1's five failure classes is constructed end to end, the one documented action reaches a working UI from every one of them and the control there deactivates the bundle, each class asserts a distinct state the mechanism reported, and the set of classes that ran is diffed against the set declared
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-20 20:10
- **claimedAt**: 2026-08-20 20:10
- **completedAt**: 2026-08-20 22:05

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2.
Branch `bkd/1hcp7b3s`. Base `c47d6b2`, the campaign head carrying RFCT-071
through RFCT-076 and RFCT-080.

```
$ git rev-parse HEAD
c47d6b28526b51167bd33083ccb16bfbe8cf3ff4
$ git merge-base --is-ancestor c47d6b2 HEAD && echo BASE-OK
BASE-OK
$ test -f mosd/apid/src/startup.rs && grep -q '/builtin' mosd/apid/src/routes.rs && echo DEPS-OK
DEPS-OK
```

Both dependencies this suite is meaningless without were present and are what it
drives:

- **RFCT-075's `/builtin` prefix** — `mosd/apid/src/routes.rs` declares
  `.nest(BUILTIN, …)` and `.route(BUILTIN_PATH, get(builtin_home))`, with
  `builtin_deactivate` behind `POST /builtin/deactivate`. Every one of the seven
  facts below performs exactly that navigation and exactly that control.
- **RFCT-076's `startup::discover`** — `mosd/apid/src/startup.rs` exposes
  `pub async fn discover(store: Store) -> BundleState` and
  `pub const SERVED_API_VERSIONS: &[&str] = &["v1"]`. Classes 3 and 5 are
  detected at start-up per §6.1's own table, so they are driven through
  `discover`, the entry point `main` calls, and not through a request.

## Description

§8.2 phase 4's first acceptance is §6.3's own test, made concrete:

> For **each** of §6.1's five failure classes, one documented action — navigate
> to `https://<device>/builtin/` — reaches a working UI, and one control there
> deactivates the bundle. **The operator diagnoses nothing.** A class that
> requires knowing the cause fails the phase.

This task demonstrates that rather than arguing it. It adds no mechanism: every
mechanism it exercises already existed at `c47d6b2`, and `bundle.rs`,
`startup.rs`, `routes.rs` and `assets/*.rs` are consumed exactly as merged.

## Deliverable

| file | what |
| --- | --- |
| `mosd/apid/src/tests/broken_classes.rs` | new; the enumerated per-class suite and the class-5 negative control — two tests, seven facts |
| `mosd/apid/src/tests.rs` | one line: `mod broken_classes;` |
| `docs/task/RFCT-078.md`, `docs/task/index.md` | this record and its row |

Nothing else was touched. `os/**` (RFCT-077 is there), `Makefile`,
`docs/design/**`, `docs/README.md`, `Cargo.toml` and `Cargo.lock` are unchanged,
and no dependency was added.

## What is **not** restated, because it is already proven more strongly

RFCT-075's `the_escape_answers_identically_whatever_the_bundle_store_holds`
states §6.3 as an **invariance** over bundle-store states: the escape's rendered
page is byte-identical across six of them, with `/` asserted to *disagree*
across the same six as the control that makes the equality non-vacuous. An
invariance is stronger than an enumeration, because it holds for states nobody
enumerated, including ones a future change invents.

So this suite does **not** assert that the escape page is the same across
classes. `one_documented_action` — the shared routine every fact calls — carries
that decision in its own doc comment: *"a weaker per-class restatement would
look like more coverage and be less."* What each fact asserts is that the
control is **there** and **works** from that class's state, which the invariance
does not say.

Two more citations rather than second versions:

| already proven | where | what this suite therefore omits |
| --- | --- | --- |
| class 1 is not **logged** as an error — no WARN, no ERROR, with the log captured | `startup::tests::an_absent_srv_ui_is_normal_operation_and_not_an_error` | the log assertion; the fact here asserts the named *answer* and the escape from it |
| a bundle matching only the **outgoing** major stays active (§2.1's dual-major case) | `startup::tests::a_bundle_matching_only_the_outgoing_major_stays_active` | see F3 — this layer cannot construct a multi-member served set without editing the constant under test |
| a bundle cannot shadow the reserved prefix, both directions | `tests::a_bundle_cannot_shadow_the_reserved_builtin_prefix` and its `without_the_reservation_…` pair | the shadowing guard |

## The seven facts, and the distinct outcome each asserts

Seven facts over five classes: §6.1 states class 2 in two shapes — *"a bundle
with no `index.html`, **or whose index is a directory**"* — and class 4 has two
different correct answers, which is the whole of its asymmetry.

**Why distinctness is not a nicety.** Several classes produce the same
observable — the built-in UI. If every fact asserted only *"the built-in UI
answered"*, then a suite in which class 3's construction silently failed and
fell through to class 1's state would still pass. So each fact asserts the state
**the mechanism itself reported**, and the suite then asserts the evidence
strings are pairwise distinct and names any collision.
`assets::path::tests::each_guard_is_exercised_by_exactly_one_hostile_feature`
is the discipline this follows.

Observed, printed out of the run:

| fact | evidence the mechanism reported |
| --- | --- |
| class 1: no bundle installed, `current` absent | `no custom bundle is active; the built-in UI is being served` |
| class 2: a bundle whose `index.html` is absent | `generation 1 active, index.html is absent, its assets still serve` |
| class 2: a bundle whose `index.html` is a directory | `generation 1 active, index.html is a directory, its assets still serve` |
| class 3: a malformed or half-written bundle, digest mismatch | `generation 1 was deactivated at start-up: the tree no longer matches the digest recorded at activation (§6.1 class 3)` |
| class 4: an unreadable `index.html` falls back to the built-in UI | `generation 1 active, index.html will not open (a UNIX socket in its place, ENXIO), / is the built-in UI` |
| class 4: an unreadable inner asset is 404 and nothing else changes | `generation 1 active, assets/app.a1b2c3.js will not open (a UNIX socket in its place, ENXIO) and is 404, assets/other.d4e5f6.js still 200, / is the bundle's index` |
| class 5: the declared range and the served set have no member in common | `generation 1 was deactivated at start-up: declared API versions ["v0"] have no member in common with the served set ["v1"] (§6.1 class 5)` |

Each also carries the control that stops it passing as a neighbour:

- **Classes 2 and 4** assert an inner asset **still 200s with its own bytes**, so
  "the built-in UI answered" cannot be explained by an empty store — that is
  class 1's state, not theirs — and assert `current` is **still active**, which
  classes 3 and 5 are not.
- **Classes 3 and 5** assert `BundleState::Deactivated` with the reason list
  matched exactly: `Reason::DigestMismatch` and
  `Reason::Incompatible { declared, served }` respectively, and no other class
  can produce either. Both also assert `bundle_dir(1).is_dir()` — deactivate
  removes the pointer, never the tree.
- **Class 5** asserts the renders-perfectly half **first**, from requests: `/`
  returns the bundle's own index byte for byte, its asset 200s, and
  `status().index_readable` is true. *"Every file-level check passes … nothing
  is wrong with the filesystem."* Without that, the fixture would be some other
  class wearing class 5's name.

## The coverage assertion, which is what makes the count mean anything

> *"7 passed"* and *"5 passed, 2 never ran"* are the same number.

A suite cut short does not fail loudly. It tests fewer facts and reports green
on the ones it reached, so a bare pass count is **invariant across the defect it
is supposed to detect**. The coverage assertion is therefore not a precaution
around a valid control; it is the thing that makes the control valid.

The shape is `startup::tests::no_hostile_store_can_stop_start_up`'s, twice:

1. **Facts.** `EXPECTED_FACTS` declares all seven by identity. The observed set
   is built from the `Fact`s the run actually produced, the two are `BTreeSet`s,
   and the failure names `missing` and `unexpected` — never a count, never
   absence-of-failure.
2. **Classes.** §8.2 counts *classes*, not facts, and asks for five. The covered
   set is **derived from what ran** (`facts.iter().map(|f| f.class)`) and diffed
   against `1..=5` the same way.

## Class 4's asymmetry, in both directions

§6.1: *"The fallback trigger is the index, not any file."* A suite that tested
only the fallback half would pass against an implementation that swapped the
whole UI out on any unreadable file, so both directions are asserted:

- **Index** → the built-in UI at `/`, *and* the bundle still active, *and* its
  assets still serving.
- **Inner asset** → 404 with an empty body for that asset, and then, explicitly:
  a **sibling asset requested afterwards must return 200 with its own bytes**,
  and `/` must still be **the bundle's own index** and not the built-in UI. *"A
  UI missing one image is still a working UI."*

Both halves were fired — see the guard-fire table.

## Class 5: what this layer can and cannot establish

§6.1 is emphatic about why the exact relation matters more here than anywhere
else: *"An escape hatch that fires on the wrong condition is worse than one that
does not exist, because the operator will trust it."*

**Established end to end.** A bundle activated against `["v0"]` — an earlier
image's API — is deactivated by `startup::discover` against this binary's
`SERVED_API_VERSIONS`, with the reason carrying **both** sets by name. That is
§6.1's A/B case, *"the only moment at which anything on the device is in a
position to notice."*

**The negative control, end to end.** `a_bundle_that_intersects_the_served_set_is_not_deactivated`
activates a bundle declaring `["v0", "v1"]` and drives the same `discover`: it
stays `Active`, `current` still resolves, and `/` is still the bundle's index.
A non-empty intersection is not a trigger, however partial — which rules out set
equality and rules out "declared must be a subset of served".

**Not established here, and cited rather than weakened.** It does **not** rule
out equality against the served set's `current` member, because with a
one-member served set every member *is* `current`. That is F3, and the case is
`startup::tests::a_bundle_matching_only_the_outgoing_major_stays_active`.

## Guards fired

Every assertion below was made to fail on purpose, and the mechanism restored
immediately afterwards; `git status` was clean of `routes.rs` and
`assets/serve.rs` before the checks were run. The deletions exist only in this
record.

| what was broken | what fired |
| --- | --- |
| `class_5_no_common_api_version().await` deleted from the suite | `§6.1 facts demonstrated: missing ["class 5: the declared range and the served set have no member in common"], unexpected []` |
| class 2's two shapes given the same evidence string | `two facts rest on the same observation, so one could pass for the other's reason: ["class 2: … absent and class 2: … a directory: generation 1 active, index.html is broken, its assets still serve"]` |
| `assets/serve.rs`: an unreadable inner asset answered with the built-in UI instead of 404 (run under an unprivileged uid, so the fixture was a real `EACCES` file) | `class 4: an unreadable inner asset is 404 and nothing else changes: the unreadable asset is 404 — left: 200, right: 404` |
| `assets/serve.rs`: `root()` made to always return the built-in UI — the whole-UI swap | `class 4: … `/` must still be the bundle's own index`, and the class-5 negative control's `/` assertion |
| `routes.rs`: the `.nest(BUILTIN, …)` and `.route(BUILTIN_PATH, …)` declarations deleted | `class 1: no bundle installed, `current` absent: /builtin is a way in without a way out: …` — the asset router's page answered, carrying no escape control |

The last one is the important one: with the reservation gone, `/builtin` still
returns **200 and a built-in-looking page** for the no-bundle class. A test that
asserted only a status code, or only *"the built-in UI answered"*, would have
passed. It fails on the **control** being absent, which is what (A) without (B)
means — *"a way in, not a way out."*

## Findings — reported, not designed around

**F1. `EACCES` cannot be constructed against a test runner that holds
`CAP_DAC_OVERRIDE`, and this repository's checks run as one.** Measured on this
tree: `id -u` is `0`, `CapEff` is `00000000a80425fb`, and a file chmodded
`0o000` reads straight through. A class-4 fixture written as "chmod `0o000` and
request it" therefore constructs **nothing** here while still reporting green —
exactly this task's own rule, one level down: a fixture that silently did not
fire is indistinguishable from one that did.

So `will_not_open` sets the mode, **verifies the construction with the same call
the mechanism makes** (`fs::read`), and when it did not take effect replaces the
entry with a UNIX socket, which no uid can open for reading (`ENXIO`). The
construction that actually ran is returned and travels into the fact's evidence,
so the record says which one it was instead of implying `EACCES` either way.

Both were run, and the suite is identical under each:

```
$ cargo nextest run -p apid -E 'test(every_one_of_6_1s)'          # uid 0
EVIDENCE class 4: an unreadable `index.html` … => … (a UNIX socket in its place, ENXIO) …

$ setpriv --reuid=65534 --regid=65534 --clear-groups env TMPDIR=/tmp \
    ./target/debug/deps/apid-<hash> --exact tests::broken_classes::every_one_of_6_1s…
EVIDENCE class 4: an unreadable `index.html` … => … (mode 0o000, EACCES) …
test result: ok. 1 passed; 0 failed
```

**One narrowing, stated because it changes which arm answers.** For the
**index** the arm is the same under both constructions: `serve_index` resolves
the path and `serve_file`'s `fs::read` fails. For an **inner asset**
`assets/serve.rs` gates on `file.is_file()`, which a socket is not — so under a
permission-overriding runner the 404 comes from the not-a-regular-file miss arm
rather than from a failed `open`. The **observable** §6.1 specifies — 404 for
that asset, nothing else changed — is identical, and it is the observable the
suite asserts. The failed-`open` arm proper is exercised on a non-root runner,
which is the run above.

**F2. Classes 2 and 4, constructed the only way §6.1 says they are reachable,
are class 3 at the next start-up.** §6.1 says class 2 can reach serving only
because *"the tree was mutated outside the install path"*, and class 4 arrives
the same way; but any such mutation moves the tree off the digest recorded at
activation. Measured, both fixtures through `startup::discover`:

```
SCRATCH-2 generation 1 was deactivated at start-up: the tree no longer matches
          the digest recorded at activation (§6.1 class 3)
SCRATCH-4 generation 1 was deactivated at start-up: the tree no longer matches
          the digest recorded at activation (§6.1 class 3)
```

This is not a defect — it is §6.1's own *"a corruption introduced mid-life is
detected at the next restart"* doing its job, and the device self-heals to the
built-in UI. It is recorded because it has a direct consequence for any suite
of this shape: **the five classes are disjoint as detectors, not as fixtures.**
A suite that ran `discover` over its class-2 or class-4 fixture would silently
be demonstrating class 3 twice and reporting five. This suite therefore keeps
classes 1, 2 and 4 at the request layer and classes 3 and 5 at start-up, which
is §6.1's own "detected when" column, and the distinct-evidence assertion is
what would catch it if that ever drifted.

**F3. The end-to-end layer cannot construct a multi-member served set without
editing the constant under test.** `startup::evaluate(store, served)` takes the
set as a parameter *precisely* so §6.1's A/B case is reachable, but it is
private to `startup`; only `discover` is `pub`, and it calls `run`, which is
hard-wired to `SERVED_API_VERSIONS = &["v1"]`. `bundle::Store::recheck_active`
is public and does take a served set, but the deactivate-or-not **decision** —
which is what §6.1 class 5 is about — lives in `startup`'s private `recheck`.
So the dual-major case is cited (`a_bundle_matching_only_the_outgoing_major_stays_active`,
which builds `["v1", "v2"]` with `current` = `v2`) rather than restated here in
a weaker form. Not a defect: making `evaluate` public to suit a test would widen
the module's surface for no operator-visible reason.

**F4. For classes 3 and 5 the escape control reports "No custom UI was active",
and that is the mechanism working.** `startup::discover` has already taken the
pointer down by the time the operator arrives, so `Store::deactivate` returns
`false`. The **message** therefore differs by class while the **outcome** does
not — no `current`, `/` is the built-in UI, 200 either way. Recorded because it
looks at first glance like the escape not working, and because §6.3's
requirement is explicitly about the outcome: *"the same operation … both values
are the same success, because §6.3 requires an outcome that does not depend on
what was wrong."* The suite asserts the outcome for all seven facts and accepts
either message.

**F5 (inherited, not new). The escape is behind the auth gate**, so for a
logged-out operator §6.3's "one documented action" is *sign in, then go to
`/builtin/`*. RFCT-075 recorded this as its F5 and the posture is unchanged;
this suite logs in for every one of the seven facts, so it inherits the
assumption rather than testing it away. Noted so the enumeration is not read as
independent evidence that the action is literally one step.

## Checks run

Every count predicted per term **before** running.

| command | predicted | observed |
| --- | --- | --- |
| `bash mosd/hack/check.sh` | 381 on base + 2 new tests = **383** | `383 tests run: 383 passed, 0 skipped`; `ALL CHECKS PASSED` |
| `bash docs/verify-index.sh` | 255 + 3 (forward, reverse, once-each for `RFCT-078.md`) = **258** | `258/258 PASS` |
| `bash docs/verify-index-test.sh` | **8/8**, unchanged — no case added | `RESULT: PASS (8/8 cases)` |
| `make os-image-cx3576-v2` | assembles | image assembled |
| `make os-verify-cx3576-v2` | **323/323**, unchanged — this task adds no verifier assertion | `RESULT: PASS (323/323 checks)` |

The base numbers are not assumed: `mosd/hack/check.sh`, `docs/verify-index.sh`
and `docs/verify-index-test.sh` were run on `c47d6b2` before any edit and read
381, 255/255 and 8/8.

The image verifier's total is a **scope control**, not a description. This task
adds no verifier assertion, so a total that moved would have said the fence was
crossed before the diff did.

`BOARD_DIR=/srv/ai/mos/board/cx3576` — the main checkout's prebuilt BSP
artifacts, because a BKD worktree has none. That is valid **only** because this
campaign changes nothing under `board/`, and it changes nothing under `board/`.
The image pair is not skippable: this task compiles into `apid`, and
`/usr/bin/apid` is packed into the verity squashfs, so an aarch64 cross-build
failure is exactly what the host-side checks cannot see.

## Deliberately out of scope

- **Editing any mechanism.** `bundle.rs`, `startup.rs`, `routes.rs` and
  `assets/*.rs` are unchanged. F1 to F4 are recorded here, not patched there.
- **`docs/design/api.md`** — a later L3 owns documentation reconciliation.
- **Anything under `os/`** — RFCT-077 is there.
- **The `tests/e2e.rs` layer.** It spawns a real `apid` over real HTTPS, but
  §5.2 fixes the bundle store at `/srv/ui` and nothing configures it
  (`Store::at_default`), while `AppState::with_bundle_root` is `#[cfg(test)]`.
  So a bundle cannot be installed under the e2e harness without either writing
  to the host's `/srv/ui` or adding configuration to the mechanism under test.
  The in-crate router layer is the furthest end of the stack this suite can
  reach, and that is what "end to end" means below.
- **A failing `Store::deactivate`.** RFCT-075's 500 branch — the page naming
  `rm /srv/ui/current` — is not reached by any fact here; every store this suite
  builds is writable.

## What is NOT claimed — hardware

**This work was not exercised on hardware.** Both overstatements are wrong and
both are avoided:

- Hardware **has** booted. A **v1** image reached the `mos login:` prompt on a
  real CX3576-Z, and the repart/maskrom and SPL-hash work ran against a real
  board. "Never booted" would be false.
- What has **never been exercised on hardware** is the **v2** stack — verity
  root, A/B, `rauc install`, and apid itself. "Verified on device" would be
  equally false.

§6.3 says so in its own words: *"No hardware claim is made anywhere in this
section."*

**This suite demonstrates the escape in a test harness.** It builds bundle
stores in temporary directories, drives the router in-process with `tower`'s
`oneshot`, and calls `startup::discover` directly. **That an operator can reach
`https://<device>/builtin/` on real hardware and click through is not
established by anything written here.** No assertion observes the prefix fetched
over TLS from a device, `/srv/ui/current` removed on a mounted DATA partition,
a bundle deactivated at a real boot into a new A/B slot, or the deactivation
surviving a real reboot. Cross-building `apid` into a v2 image and checking that
image on the host is not a booted device.
