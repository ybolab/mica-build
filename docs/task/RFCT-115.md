# RFCT-115 PLAN-015 M2: function-oriented comments in mosd/, excluding apid

- **status**: completed
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-26 16:40
- **claimedAt**: 2026-08-26 16:40
- **completedAt**: 2026-08-26 19:10
- **plan**: PLAN-015 (M2)

Apply PLAN-015's triage rule to `mosd/` excluding `mosd/apid/` (PLAN-016 M4)
and `mosd/hack/` (PLAN-015 M3): delete the C1-C4 classes outright, rewrite the
C5-C7 survivors into short present-tense statements, and leave every MUST-KEEP
item standing. Module doc comments shrink to what the module does and its
invariants.

## Scope

- **In**: `mosd/mosd/`, `mosd/broker/`, `mosd/busname/`, `mosd/mqttd/`,
  `mosd/mosd-settings/`, including their `tests/*.rs` and `dist/` unit and
  policy files, plus `mosd/deny.toml`.
- **Out**: `mosd/apid/**`, `mosd/hack/**`, every `Cargo.toml` and `Cargo.lock`.
- Comment and blank-line changes only. No executable Rust line changed.

## Acceptance

- `git diff bkd/fxykktxe...HEAD` over the area is comment/whitespace-only plus
  the two `docs/task/` files.
- Every MUST-KEEP item that lives in this area survives; anything reworded is
  quoted before and after below.
- All gates green.

## What changed, in numbers

36 files, **+408 / -544** lines over 11 commits: a net reduction of 136 lines,
of which 134 are comment lines.

Measured against `bkd/fxykktxe`, over the 46 in-scope `.rs` files:

| measure | before | after |
|---|---|---|
| comment lines (`//`, `///`, `//!`) | 5,653 | 5,522 |
| contiguous comment blocks of 25+ lines | 22 | 16 |
| `RFCT-nnn` / `PLAN-nnn` mentions | 51 | 9 |

Counting the non-`.rs` in-scope files as well (the D-Bus policies, the unit
files, `deny.toml`), comment-ish lines go 6,467 -> 6,333.

**This is 2.3%, not the ~44% PLAN-015 estimates for mosd as a whole, and the
gap is deliberate — see "The reduction is small, and why" below.**

## Files treated

**The eight worst files PLAN-015 names, in the order it names them:**

| file | before | after |
|---|---|---|
| `mosd/mosd/src/main.rs` | 546 lines | 481 |
| `mosd/busname/src/lib.rs` | 314 | 307 |
| `mosd/mqttd/src/lib.rs` | 85 | 78 |
| `mosd/mosd/src/reconciler/mqtt.rs` | 977 | 972 |
| `mosd/mosd/src/reconciler/sshd.rs` | 1,887 | 1,864 |
| `mosd/mosd/src/transient.rs` | 677 | 672 |
| `mosd/mosd/src/bus.rs` | 1,169 | 1,169 |
| `mosd/mosd/src/reconciler/wifi_ap.rs` | 2,010 | 2,010 |

`bus.rs` and `wifi_ap.rs` each lost one comment line and gained one; both are
already function-oriented throughout (`bus.rs`'s module header is four lines,
`wifi_ap.rs`'s is a numbered list of the three system effects plus the secret
hygiene rule). Their listing as "worst files" reflects comment DENSITY, which
is not the same measure as narrative content.

**The rest of the area**, grep-driven per the plan's list (`RFCT-`, `PLAN-`,
`used to`, `no longer`, `previously`, `WAS HERE`, `═══`, dash banners, 25+ line
blocks), plus a second and third sweep on `was proposed/rejected/added/written`,
`had been`, `this campaign`, `the defect`, `TODO/FIXME`, `renamed from`,
`deleted`, `legacy`, `superseded`:

- `mosd/mosd/src/` — `bus.rs`, `fswrite.rs`, `identity.rs`, `main.rs`,
  `provisioning.rs`, `rauc.rs`, `scan.rs`, `transient.rs`, `tree.rs`.
- `mosd/mosd/src/reconciler/` — `container.rs`, `hostname.rs`, `mqtt.rs`,
  `sshd.rs`, `systemd.rs`, `wifi_ap.rs`, `wifi_client.rs`.
- `mosd/mosd/tests/` — `bus.rs`, `scan.rs`, `tree.rs`.
- `mosd/mosd-settings/` — `src/{migration,model,store}.rs`,
  `tests/settings.rs`.
- `mosd/mqttd/` — `src/{config,lib,topic,transport}.rs`, `tests/protocol.rs`,
  `dist/mos-mqttd.service`.
- `mosd/broker/` — `src/main.rs`, `dist/mos-mqtt-broker.service`.
- `mosd/busname/src/lib.rs`.
- `mosd/dist/` — `com.mos.mosd.conf`, `com.mos.ext.conf`, `mos-mqttd.conf`.
- `mosd/deny.toml`.

**Twenty in-scope files were read and left untouched** because nothing in them
matched a C-class: `broker/src/config.rs`, `dist/{apid,mosd}.service`,
`mosd-settings/src/{authorized_key,error,lib,path}.rs`,
`mosd/src/{actions,power}.rs`, `mosd/src/reconciler/{mod,network}.rs`,
`mosd/src/reconciler/container/tests.rs`,
`mqttd/src/{bridge,item,main,payload,runtime,source}.rs`, `.cargo/config.toml`,
`.gitignore`. `mosd/dist/apid.service` is in scope by path (it is not under
`mosd/apid/`) and needed no edit, which also keeps this branch clear of
PLAN-016's write set.

## What was deleted outright (C1-C4)

- **C1, task-ID provenance.** 42 of the 51 `RFCT-nnn` / `PLAN-nnn` mentions in
  `.rs` files, plus four in the `dist/` policy and unit files and one in
  `deny.toml`. This includes 21 requirement-ID section openers of the shape
  `// R6.3a — <text>` and `// ---- R7.2: <text> ----` in `identity.rs`,
  `provisioning.rs`, `transient.rs`, `sshd.rs`, `wifi_ap.rs`,
  `wifi_client.rs` and `mosd-settings/tests/settings.rs`; each kept its label
  and lost its identifier, and the dash banners were re-padded to the file's
  own width.
- **C2, process narrative.** `mosd/mosd/src/main.rs:66-82` — the
  `═══ WHY THIS FILE WAS EDITABLE AT ALL ═══` block recording who authorised
  the edit and when (`THE USER LIFTED THAT EXCLUSION ON 2026-08-26`), together
  with the PLAN-014-scope account around it. It was the only box header in the
  area; there are now zero `═══` runs in `mosd/` outside the carve-outs.
- **C3, self-referential meta-commentary.** None found in this area.
- **C4, tombstones and dead-path citations.** One: `os/verify-image-v2.sh` in
  `mosd/dist/mos-mqttd.conf`, rewritten to "The image verifier". Verified the
  path really is gone. No `WAS HERE` markers exist in the area.

## MUST-KEEP items, verified file by file

Every item on PLAN-015's binding list that lives in this area is still present,
checked by grepping the load-bearing phrase after the sweep:

| item | where | status |
|---|---|---|
| `MOSD_DRY_RUN=1` harness block | `mosd/mosd/tests/bus.rs:116`, `tree.rs`, `scan.rs` | untouched |
| `MOSD_SHADOW_PATH` redirection | same three files | untouched |
| "never be pointed at the host's /etc/shadow" | `mosd/mosd/tests/bus.rs:111` | untouched, verbatim |
| shadow(5) nine fields | `tests/bus.rs:33`, `tests/scan.rs:27`, `transient.rs:277`, `mosd/mosd/src/bus.rs:744`, `sshd.rs:487` | all five untouched |
| bcrypt 72-byte truncation | `transient.rs:69` | untouched |
| OpenSSH fingerprint format | `sshd.rs` `SHA256:`+unpadded-base64 doc | untouched |
| MQTT QoS-0 / retained-delete / topic grammar | `mqttd/src/{transport,payload,topic}.rs` | untouched |
| D-Bus `own_prefix` measured semantics | `busname/src/lib.rs:38`, `:110`, `:224`, `:252`; `dist/com.mos.ext.conf` | present; see rewording 3 |
| broker config key set | `broker/src/config.rs`, `mqtt.rs` `render_config` | untouched |
| config-before-service-start | `sshd.rs`, `mqtt.rs`, `wifi_ap.rs`, `wifi_client.rs` module headers | present, all four |
| broker-before-bridge ordering | `mqtt.rs` module header | untouched |
| sshd config precedence (`05-` sorts first) | `sshd.rs` module header, `render_drop_in`, and the test at `:1526` | untouched |
| `reset-failed` for StartLimitBurst | `mqtt.rs:~290`, `systemd.rs:95-117` | present; see rewording 5 |
| PSK single-0600-file rule | `wifi_ap.rs:25-28` | untouched |
| mqttd structural redaction key list | `mqttd/src/payload.rs:20`, `mqttd/src/lib.rs:64-66` | key list untouched; see rewording 2 |
| independent-draw rule | `identity.rs:102-106` | untouched |
| "a fleet-wide shared secret" strings | `identity.rs:5`, `model.rs:258`, `:534` | untouched |

### The MUST-KEEP items that were reworded, quoted before and after

**1. `mosd/mosd/src/reconciler/sshd.rs` — the PAM paragraph.** The rule is
unchanged; the past-tense account of what the reconciler used to do went.

Before:

    //! **The device password no longer reaches PAM.** This reconciler used to hash
    //! `secrets/device-password` with bcrypt and write it into the root account's
    //! shadow entry, which made a fielded device carry a password that never
    //! expired. The secret file stays on STATE (no production code reads it back
    //! today), but the credential of record for shell access is now an SSH public
    //! key, or a transient password the operator sets explicitly through
    //! `crate::transient` and which the next boot clears.

After:

    //! **The device password does not reach PAM.** The credential of record for
    //! shell access is an SSH public key, or a transient password set through
    //! `crate::transient` that the next boot clears. Nothing reads
    //! `secrets/device-password` back: a hash in the root shadow entry would be a
    //! password on a fielded device that never expires.

**2. `mosd/mqttd/src/lib.rs` — the secrets section.** The four key names, the
`docs/design/bus.md` §8 citation and "defence in depth, not the primary
control" are verbatim; only the `(PLAN-011 D6)` stamp and the word
"nevertheless required" changed.

Before:

    //! publish-side masking in [`payload`] is nevertheless required (PLAN-011 D6)
    //! and applies the identical structural rule to every payload leaving this
    //! process. It is defence in depth, not the primary control, and it should
    //! find nothing to mask in practice.

After:

    //! publish-side masking in [`payload`] applies the identical structural rule
    //! to every payload leaving this process. It is defence in depth, not the
    //! primary control, and it should find nothing to mask in practice.

**3. `mosd/busname/src/lib.rs` and `mosd/dist/com.mos.ext.conf` — the
`own_prefix` measurement.** All four `docs/task/RFCT-093.md` citations in
`busname` and the one in the policy file are **kept**, against the general rule
that `docs/task/` pointers are provenance: PLAN-015's MUST-KEEP list names
"D-Bus `own_prefix` measured semantics" as binding, and RFCT-093 §"Investigation
— `own_prefix` semantics (measured 2026-08-22)" is where the measurement itself
lives. Deleting the pointer would leave a measured claim with nothing behind it.
The measured statements are byte-identical. What changed around them:

Before (`lib.rs`):

    ///   operators, to the dashboard and to the MQTT bridge **as the system**.
    ///   That is origin spoofing, and it is worse than the wrong-class defect
    ///   PLAN-011 D5 names as the thing to test for.

After:

    ///   operators, to the dashboard and to the MQTT bridge **as the system**.
    ///   That is origin spoofing.

Before (`com.mos.ext.conf`):

           costs ZERO edits to this file — that property is the reason the
           namespace was split this way rather than by enumerating denials, which
           would have had to be extended in lockstep forever and would have failed
           open the one time somebody forgot. Measured on dbus-daemon 1.12.20;

After:

           costs ZERO edits to this file — that property is why the namespace is
           split this way rather than by enumerating denials, which would have to
           be extended in lockstep forever and would fail open the one time
           somebody forgot. Measured on dbus-daemon 1.12.20;

**4. `mosd/mosd/src/reconciler/sshd.rs` — the reload-not-restart rule.** All
three rules survive: reload never restarts, `KillMode` is not what keeps
sessions alive, and there is deliberately no fallback to `restart`. Two
paragraphs of argument were compressed.

Before:

    /// **`KillMode` is not what keeps those sessions alive.** Debian's
    /// `openssh-server` happens to ship `KillMode=process`, which would spare
    /// established sessions across a restart — but nothing in this image chose
    /// that value, nothing here asserts it, and a future package revision could
    /// change it with no signal on our side. Reload survives by construction
    /// rather than by that grace, which is why a restart here would *not* be
    /// equally fine.
    ///
    /// **This depends on `ssh.service` carrying `ExecReload`.** That comes from
    /// the Debian `openssh-server` package; this repo ships no `ssh.service`, so
    /// the property is inherited rather than chosen — the same shape of problem
    /// as `KillMode`, in a new place. A unit file without `ExecReload` makes
    /// systemd refuse the job, and that refusal is surfaced with an error naming
    /// `ExecReload` and saying the configuration change has not been applied.
    /// There is deliberately **no fallback to `restart`**: falling back would
    /// silently reintroduce the disconnect this reload exists to prevent, and
    /// would hide the missing `ExecReload` from the next person to look.

After:

    /// **`KillMode` is not what keeps those sessions alive.** Debian's
    /// `openssh-server` ships `KillMode=process`, which would spare established
    /// sessions across a restart, but nothing in this image chose that value
    /// and a future package revision can change it silently. Reload survives by
    /// construction rather than by that grace.
    ///
    /// **This depends on `ssh.service` carrying `ExecReload`**, which is the
    /// Debian package's and not this repo's. A unit without it makes systemd
    /// refuse the job, and the refusal is surfaced with an error naming
    /// `ExecReload` and saying the change has not been applied. There is
    /// deliberately **no fallback to `restart`**: it would reintroduce the
    /// disconnect this reload prevents and hide the missing `ExecReload`.

**5. `mosd/mosd/src/reconciler/mqtt.rs` — the `reset-failed` guard.** The
`reset-failed`-before-start rule, the guard on `FAILED_STATE` and the
broker-only scope are unchanged; the closing clause was retensed.

Before:

                // Broker only. The bridge carries no StartLimit override, so it
                // inherits systemd's 10-second default, which at its RestartSec=5
                // fits about two attempts and is therefore unreachable -- the very
                // gap the broker's 60-second interval was added to close.

After:

                // Broker only. The bridge carries no StartLimit override, so it
                // inherits systemd's 10-second default, which at its RestartSec=5
                // fits about two attempts and so cannot reach the limit at all.
                // The broker's 60-second interval is what makes it reachable
                // there.

## Decisions taken, and what they cost

**Runtime strings and assertion messages were NOT edited.** M2's rule is
comment-only; PLAN-015 assigns string changes to M3. Four task-ID mentions
therefore survive inside string literals and are listed so this sweep does not
read as complete when it is not:

- `mosd/busname/src/lib.rs:262` — `"(measured, RFCT-093 Investigation), …"`
- `mosd/mosd/tests/scan.rs:674` — `"… RFCT-093), so publishing it as system-origin …"`
- `mosd/mqttd/tests/protocol.rs:730` — `"… PLAN-011 D5 names, reached by the other route"`
- `mosd/mosd/src/reconciler/sshd.rs:968` —
  `"the shadow file is no longer an input to this reconciler"`, past-tense
  narrative inside an `expect()` message.

**Two doc lines quoting `ssh-keygen -C rfct-034-…` were kept.** `sshd.rs:1004`
and `:1006` document the exact command that produced the committed key
constants below them, and the task ID is part of the key's own comment field
inside those string constants (`… rfct-034-test-ed25519`). Editing the doc
lines would make them disagree with the data they describe. Left for M3, which
owns string changes.

**`PLAN-nnn Dx` decision stamps were deleted along with the milestone stamps**,
matching RFCT-114's rule. `PLAN-011 D5`, `PLAN-011 D6`, `PLAN-012 D3/D4/D5` and
`PLAN-014 M4x` read as present-tense in the sentences they open, but PLAN-015's
MUST-KEEP list enumerates the deliberate citations and none of these is on it.
The constraint each one introduced is kept; the identifier is not.

**`docs/design/*.md` and `docs/plan/PLAN-008.md` references were kept.**
PLAN-015 class 7 names design-doc contract references as deliberate citations.
`mosd-settings/src/model.rs:366` cites `docs/plan/PLAN-008.md` Part D for the
rule that a fleet-wide constant PSK default is forbidden, and
`identity.rs:102-106` cites the same section for the independent-draw rule
(itself a MUST-KEEP item). Both are "X says «clause», therefore this code does
Y" and both stay.

**`connd` references were checked and kept.** `model.rs:300`,
`provisioning.rs:120` and `identity.rs:212` name `connd`, which is not a crate
under `mosd/`. It is a live design-level component: `docs/design/connd.md` and
`os/verify/src/checks-connd.ts` both exist. Not a dead reference.

## The reduction is small, and why

PLAN-015 estimates "~44% of 8,523 comment lines" for mosd as a whole. This
milestone removed 2.3% of its area's comment lines. The gap is stated rather
than absorbed, because the two numbers measure different things and because a
larger cut here would have to come out of the MUST-KEEP classes.

**What the plan's taxonomy actually found in this area, counted after the
sweep rather than estimated before it:**

- C1 is essentially gone: 51 task-ID mentions -> 9, and 7 of those 9 are either
  a MUST-KEEP measurement citation or a string M3 owns. That is the largest
  single class the plan names and it accounts for about 60 lines.
- C2 was one block, in `main.rs`. C3 was zero occurrences. C4 was one
  dead-path citation.
- C6 barely exists here: one `═══` header (now zero) and 21 multi-word
  ALL-CAPS runs across 24,800 lines, most of them emphasis inside a sentence
  rather than a banner.
- C7 was 22 blocks of 25+ contiguous comment lines, now 16. Of the 16 that
  remain, 11 are module headers that state what the module does and its
  invariants — which is what the milestone asks module headers to be — and the
  other five are API contracts (`Store::load_with_report`'s rollback contract,
  `ensure_provisioned`'s seven-step contract, `ensure_identity`'s generation
  contract, `busname::parse`'s grammar plus its doctest, and `sshd.rs`'s
  reload rule).

**The remaining 5,522 comment lines are overwhelmingly present-tense.** They
are API contracts on `pub` items, protocol and wire facts (shadow(5) fields,
bcrypt truncation, IEEE 802.11 SSID and PSK bounds, `IFNAMSIZ`, networkd
lexical ordering, sshd's non-repeatable-keyword rule, MQTT topic grammar),
injection boundaries, and secret-handling rules. PLAN-015's triage rule is
explicitly tense-based — "present-tense constraint stays, past-tense narrative
goes" — and its MUST-KEEP list protects most of the rest by name. Cutting to
44% in this area would mean deleting present-tense constraints, which the plan
calls a defect.

**Where the volume actually was, and it was not here.** The plan's own mosd
figure of 8,523 comment lines is for mosd *including* `mosd/apid/`, which
PLAN-016 M4 owns and which this milestone may not touch. This area is 5,653 of
that. `mosd/hack/` — which the plan singles out as "58% comments, header is an
account of the previous implementation" — belongs to M3.

L2 should treat the 44% figure as not met for this area and decide whether a
second, more aggressive pass is wanted. This milestone applied the rule as
written.

## Load-bearing comments found, and kept

None deleted. Two mechanisms that read comment-adjacent text were checked:

- `mosd/hack/dbus-policy-test.sh` loads all three shipped policy files
  (`com.mos.mosd.conf` sections 0-3, `com.mos.ext.conf` section 5,
  `mos-mqttd.conf` section 6) into a real `dbus-daemon` and drives refusals
  against it. Only the XML elements reach the daemon, and all three files'
  element content is byte-identical to `bkd/fxykktxe` — proved mechanically
  above, where the `<!-- … -->` blocks are the only thing stripped. That script
  needs root plus `setpriv` and is M3's file; it was **not** run here.
- The image verifier asserts `mos-mqttd.conf`'s granted member set against the
  same elements. Same argument: only the comment block changed.

## Nothing was refactored, and two things are reported instead

Per PLAN-015's design constraints, no code was changed and no dead code
deleted. Noted for whoever owns them:

- `mosd/mosd/src/identity.rs`'s `verify_password` is `#[cfg(test)]` and called
  only by two `ensure_identity` tests. Its own doc comment says so. Reported,
  not deleted.
- `mosd/mosd/src/reconciler/sshd.rs:968`'s assertion message
  (`"the shadow file is no longer an input to this reconciler"`) is past-tense
  narrative in a string. It belongs to M3's string class.

## The comment-only property, proved mechanically

Every changed non-`docs/` file was checked by stripping comment lines and blank
lines from `git show bkd/fxykktxe:<file>` and from the working copy and
requiring the two to be equal — `//`/`///`/`//!` lines for Rust, whole
`<!-- … -->` blocks for the XML policies, `#` lines for the `.service` and
`.toml` files:

    checked 36 non-docs files; comment-only violations: 0

## Gate results

Run at `959fb5c`. **Toolchain: the pinned `localhost/mos-build-rust` image
(rung 1).** The image ships rustc 1.98.0 (88d9e12ae) but no rustfmt, clippy or
dbus-daemon; the first two come from `/srv/mos-rust-tools/bin` (built against
the same rustc, confirmed by the matching build hash) with the image's own
sysroot on `LD_LIBRARY_PATH`, and dbus is installed into the container at run
time the way CI does. The exact command form:

    docker run --rm \
      -v "$PWD:/src" \
      -v /srv/mos-rust-tools:/tools:ro \
      -v "$PWD/_out/cargo/registry:/usr/local/cargo/registry" \
      -v "$PWD/_out/cargo/git:/usr/local/cargo/git" \
      -w /src/mosd \
      --entrypoint /bin/bash localhost/mos-build-rust -c '
        export PATH=/tools/bin:$PATH
        export LD_LIBRARY_PATH=/opt/rust/lib
        apt-get update && apt-get install -y --no-install-recommends dbus
        <cargo command>'

The repository is mounted at `/src`, not `mosd/`, because the workspace lists
`../update/sign` as a member. Versions inside that container:

    rustc 1.98.0 (88d9e12ae 2026-08-18)
    rustfmt 1.9.0-stable (88d9e12ae1 2026-08-18)
    clippy 0.1.98 (88d9e12ae1 2026-08-18)
    cargo 1.98.0 (797e8a9bc 2026-08-05)
    D-Bus Message Bus Daemon 1.16.2

`/srv/mos-rust-tools/rust96/` (a standalone 1.96.0 toolchain) was **not** used:
a 1.96 formatter judging a 1.98 workspace is a different gate.

| gate | command | result |
|---|---|---|
| format | `cargo fmt --all --check` | rc=0 |
| lint | `cargo clippy --workspace --all-targets --locked -- -D warnings` | rc=0, 0 warnings |
| tests | `cargo test --workspace --locked` | rc=0, **593 tests** over 22 result lines, 0 failed |
| doctests | `cargo test --doc --workspace --locked` | rc=0; `mos_busname` `parse` (line 133) passes |
| docs index | `bash docs/verify-index.sh` | 381/381 PASS, rc=0 |

`mosd/mosd/tests/bus.rs` really ran: it fails rather than skips without
`dbus-daemon`, and its `running 1 test … finished in 19.99s` line is in the
suite output above.

**`cargo nextest` and `cargo deny` were skipped**, as the milestone brief
permits: nextest gates test-running mechanics and deny gates dependency policy,
and a comment-only change moves neither. `cargo-deny 0.19.5` is present in
`/tools/bin` if L2 wants it run.

**Baseline check.** `cargo fmt --all --check` was run before any edit and was
already clean at the merged head, so the green above is this milestone's and
not an inherited state.
