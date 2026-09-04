# RFCT-311 Implement PLAN-078 S1–S7: the short-lived signer and its refusals

- **status**: completed
- **priority**: P1
- **owner**: short-lived-signer/bkd-48ttwp8y
- **createdAt**: 2026-09-04 21:20
- **relatedPlan**: [PLAN-078](../plan/PLAN-078.md)

## Description

PLAN-078 measured RAUC 1.13's certificate-validity semantics and designed a
short-lived bundle signer around what it found. The user then took two
decisions that the plan records and that change the backlog:

- **§4a — option (a), monthly root access.** No intermediate CA;
  `basicConstraints` stays `pathlen:0`. S8 is conditional on §4(b) and is
  therefore out of scope.
- **§3a — the window is 45 days**, not the 35 the plan's own table still says.
  All three of §3's reasons were re-checked and survive; the price is ten more
  days of attacker-usable time.

This task implements **S1 through S7** of that backlog: the device-side asserted
absence, the build's warning and its refusal, the failed-install diagnostic, the
one declared validity number, and the two documents that record what became
true.

## ActiveForm

Implementing the seven authorised slices against the plan's own gates, with the
negative tests each gate names, and re-running the gates the changed surfaces
are covered by.

## Dependencies

- **blocked by**: (none)
- **relates to**: [RFCT-308](RFCT-308.md) (the measurement this implements),
  [PLAN-077](../plan/PLAN-077.md) §7 (owed a recurring-ceremony runbook under
  decision (a)), [PLAN-071](../plan/PLAN-071.md) §9.6 (the clock floor this
  adopts rather than rebuilds)

## Acceptance

- Each of S1–S7 satisfying the gate its row states, with the negative tests
  those gates name.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify` green.
- `bash tests/rauc-trust-negative-test.sh` green.
- A composed x64 image and `bash verify/run.sh --verify --board x64` green.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

- complete: S1–S7 shipped; S8 and S9 deliberately not.

  ### Which slices, and what each became

  - **S1** — `rauc-keyring-verifies-against-now` in `verify/src/checks-rauc.ts`
    asserts the rendered `[keyring]` sets neither `use-bundle-signing-time` nor
    `check-crl`. RED spelled `true` **and** spelled `false`, for both keys;
    RED for `key = value` and an indented key, because RAUC reads the file with
    GKeyFile and a reader matching only `key=` would pass an image RAUC reads
    as true; green for a commented line and for the same key in another
    section. The section reader distinguishes "no `[keyring]`" from "`[keyring]`
    sets nothing" and fails on the first: an absence asserted over a missing
    section is an absence asserted over nothing and stays green forever.
    `pkgs/rauc/system.conf.in` carries the reason at the site.
  - **S2** — `bundleArgs` passes `--keyring`, and the field is required on
    `BundleSpec` so no caller can silence the warning by omission. Measured
    against the real rauc: a 20-day signer produces `will expire in less than a
    month!` and a 90-day one does not.
  - **S3** — `bundle()` refuses before running anything when the signing
    certificate is inside `MOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS`, naming the
    `notAfter` it read. `build/src/signer-window.ts` reads that date by a
    minimal DER walk rather than by openssl, because the refusal happens on the
    host before the container starts.
  - **S4** — `install_failure_time_facts` (`pkgs/mosd/mosd/src/rauc.rs`) puts
    the device's clock and its time-status document beside a failed install,
    and `clock_implicated` is true only when the error names a validity window
    *and* the clock is not one the kernel vouches for. A real expiry on a
    synchronized clock still renders both facts and says the clock is not the
    explanation. apid's redaction allowlist names the new member — it fails
    closed, so an unnamed member is dropped silently — and both snapshot schema
    versions moved with it.
  - **S5** — `pkgs/rauc/key-validity.env` declares the window (45 days, §3a)
    and the refusal threshold with their reasons. The generator mints from it;
    `build/src/signer-window.test.ts` holds `release-signing.md` §2.1's `-days`
    to it, and excludes the CA's own horizon from that binding on purpose.
  - **S6** — `release-signing.md` §2.2 rewritten: the monthly root cadence, the
    two build lines, the `rauc resign` archive repair, and the blockquote
    warning that `use-bundle-signing-time=true` is release-host-only. §2.4
    untouched.
  - **S7** — `security-lifecycle.md` §1.2's revocation bullet rewritten as a
    bounded window with five explicit uncovered cases.

  ### What was NOT done

  - **S8** is out of scope: it is conditional on PLAN-078 §4(b), and the user
    chose §4(a). No stub was left.
  - **S9** is blocked on a design that does not exist. §2.2 now names the
    coupling and says the record is not designed yet, which is the most that
    could be written honestly.
  - CA rotation, PLAN-077 §6's second anchor, `/mos/config/` and the package
    side are all out of scope by the plan's own §7 and §6.
  - PLAN-078 itself was not edited; its S5 row still reads 35 days, and §3a
    already records that the window is 45.
  - No `docs/zh/` mirror was owed: `docs/zh/verify-coverage.sh` gates
    `docs/{user,website,bsp}` and every document touched is under
    `docs/design/`.

  ### Gates, as run

  - `(cd verify && bun test)` — PASS 1277/1277.
  - `(cd build && bun test)` — PASS 919/919.
  - `make docs-verify` — PASS.
  - `bash tests/rauc-trust-negative-test.sh` — PASS 10/10, signing through the
    generator's real 45-day signer.
  - `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked
    -- -D warnings`, `cargo nextest run --workspace --locked` (1030/1030),
    `cargo test --doc --workspace --locked` — all PASS.
  - `bash tests/shell-pipefail-lint.sh` (69/69) and
    `bash tests/trust-domain-hygiene-test.sh` (8/8) — PASS.
  - A composed x64 image and `bash verify/run.sh --verify --board x64` —
    PASS 314/314, with the new check among them:
    `PASS: RAUC [keyring] sets neither use-bundle-signing-time nor check-crl`.
