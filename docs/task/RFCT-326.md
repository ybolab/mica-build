# RFCT-326 The pour: mosd validates documents it did not write

- **status**: completed
- **priority**: P1
- **owner**: bkd/kl4k8pgb
- **createdAt**: 2026-09-05
- **baseline**: `9243aeea804e572b2423bf525cd58ee6d07ae980`
- **worktree**: `/srv/bkd/worktrees/33z9aa5q/kl4k8pgb`, branch `bkd/kl4k8pgb`

## Description

PLAN-070's backlog row **F6g**, the slice the plan calls *"separable and the
half that delivers the decision's actual goal — without it the documents exist
and nobody can pour anything into them."*

[RFCT-313](RFCT-313.md) built the reader, the three-layer precedence and the
parse-error rule for `/mos/config/updates.json`.
[RFCT-314](RFCT-314.md) built the namespace: the `mos-data-layout` entry at
`0700`, the per-reconciler documents, `0600` mode-before-rename, and
`RequiresMountsFor=/mos`. What was missing is the pour itself — §5.2.7's **one
exception** to machine-written-never-hand-edited:

> an integrator writes these files onto a device that is **not running**, and
> mosd validates what it finds on the next boot exactly as it validates its own
> output. A pour onto a *running* device is not supported.

Three gate clauses:

1. a hand-written document that parses and validates is **adopted**;
2. one that does not **refuses its subsystem and names the file**;
3. **nothing a poured document carried appears in any served record**.

## ActiveForm

Making a hand-poured `/mos/config/` namespace adoptable, and a bad document in
it cost exactly the subsystem it configures.

## Dependencies

- **blocked by**: (none — RFCT-313 and RFCT-314 are both merged)
- **blocks**: (none)

## Acceptance

`bash pkgs/mosd/hack/check.sh` in `localhost/mos-build-rust-check:amd64` —
**ALL CHECKS PASSED**. That is `cargo fmt --all --check`, `cargo clippy
--workspace --all-targets --locked -- -D warnings`, `cargo nextest run
--workspace --locked`, workspace doctests, and `cargo deny check licenses bans
advisories`.

Per package, `cargo test --locked`, each green:

- `mosd-settings` — 58 unit + 65 integration + 0 doc;
- `mosd` — 506 unit + 1 (`tests/bus.rs`) + 7 (`tests/scan.rs`);
- `apid` — 319 unit + 2 (`tests/e2e.rs`).

**The image the definition of done named is `localhost/mos-build-rust:amd64`,
and the gate was run in `localhost/mos-build-rust-check:amd64` instead.** The
reason is measured, not preferred: `mos-build-rust:amd64` carries no
`dbus-daemon`, and `mosd/tests/bus.rs` and `apid/tests/e2e.rs` both **fail
rather than skip** when it is missing, by their own module docs. `-check` is
the same compiler and the same `Cargo.lock` with the four gate tools and the
bus daemon added — `tests/rust-gate.sh` is the shipped route to it — so what
ran is a superset of the named floor, not a substitute for it. Both figures are
reported above.

Not run here, and owed rather than skipped quietly: **no image was composed,
`verify/run.sh` was not run, and nothing reached a board.** §6 names the one
clause that a composed image would strengthen.

`docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` are
untouched. `pkgs/mosd/apid/openapi.json` is unchanged and was re-generated to
confirm it: no route and no `utoipa::path` rustdoc was edited.

## 1. The decision: **refuses its subsystem**, and what still refuses to start

The gate says *"one that does not refuses its subsystem and names the file"*,
and "refuses its subsystem" is a different rule from F6f's "refuses to start".
Before this change the tree had only the second one for the settings
documents: `Store::load_with_report` returns `Err` on any document's parse
error, `main.rs` propagates it, and mosd exits. A mistyped `wifi.json` therefore
took the **network** reconciler down with it and put the device off the air for
a mistake in an unrelated subsystem — on a device whose configuration had just
been hand-written by somebody who could not test it first.

**What was built is the per-document refusal**, and the two rules that stay hard
failures are stated at the code and asserted:

| The bytes | The answer | Why |
|---|---|---|
| `/mos/config/` is not a directory | **daemon refuses to start**, naming the mount | F6f / §5.2.6: a device that cannot reach its configuration must not render a different one |
| `/var/lib/mos/settings.toml` does not parse | **daemon refuses to start** | not in the namespace and not pourable; it carries the device identity and the administrator credential, and degrading it would let `provisioning::ensure_provisioned` mint fresh ones over the top of real ones that merely failed to parse |
| one `/mos/config/*.json` does not load | **that document's subsystems are refused**; the rest of the device runs | §5.2.7 / F6g |
| one `/mos/config/*.json` is absent | its schema default, silently | §5.2.7: absence is a subsystem nobody configured |

The mechanism, in three pieces:

- `mosd-settings/src/store.rs` — `Store::load_with_refusals` returns
  `LoadedStore { settings, rollback, refusals }`. A `DocumentRefusal` carries
  the document name, the **full path**, the sentence an operator reads, and the
  dot-path subtrees that document backs.
- `mosd-settings/src/documents.rs` — `DOCUMENT_SUBTREES`, §5.2.2's mapping in
  the form a caller can compute with. It is what makes the refusal cover
  *exactly* the right capabilities: `wifi.json` carries `wifi`, so it gates both
  the `wifiAp` reconciler (subtree `wifi`) and the `wifiClient` one (subtree
  `wifi.client`), which a match by equality would have missed.
- `mosd/src/bus.rs` — `reconcile_subtree` skips a reconciler whose document was
  refused and records `{"refused": "…"}` where the applied state would go, so
  the live-state tree says why a subsystem is not running. `main.rs` logs each
  refusal at ERROR before the first reconcile, and
  `MosdService::set_config_refusals` publishes the list at
  `configuration.refused` for an operator who does not know which reconciler to
  look under.

**Both directions are asserted, per document.**
`one_unparseable_document_refuses_itself_and_nothing_else`
(`mosd-settings/tests/settings.rs`) pours all seven documents by hand, breaks
one, and asserts exactly one refusal **and** that the other six were adopted
from the same load — for each of the seven in turn. The negative half is the one
that would rot silently: a loader that refused the whole namespace on one bad
file passes an assertion that only checks the refusal.
`a_refused_document_skips_its_reconcilers_and_leaves_the_others_running`
(`mosd/src/bus.rs`) makes the same claim at the reconcile loop: two reconcilers
refused and named, three run.

### 1.1 The consequence that arrives one `save` later

A refused subtree sits at its **schema default** in the addressed tree, because
the tree is total and the dot-path API has no shape for a hole. `Store::save`
writes every document out of that tree. So the refusal, on its own, would have
been a slower way of losing the same bytes: the next save replaces the
integrator's file with the default nobody chose, and the boot after that comes
up clean on it with no refusal to show.

The first save is not an operator action. It is `provisioning::ensure_provisioned`
minting the device identity, **on the very boot that finds the pour**.

`Store::preserving(&[…])` is the answer, and it is on the store rather than an
argument to `save` because five modules on the boot path call `save`
(`provisioning`, `reset`, `recovery`, `provisioning_doc`, the bus) across six
call sites, and a rule that has to be remembered at six call sites is a rule
with five places to forget it. `main.rs` narrows the store once, immediately after the load; every
later holder inherits it.

Two bounds on it, each with a test:

- **only while the file is still there.** A tier-1 reset empties
  `/mos/config/` and then saves; the refused file is gone by then, and writing
  the fresh default is exactly what the reset asked for. Preserving by name
  alone would leave the refused document as the one occupant a factory reset
  failed to restore (`a_preserved_document_that_no_longer_exists_is_written_again`).
- **the document a write reaches is not preserved.** §5.2.7 says a human edits
  these documents through an authenticated API, so a write into a refused
  subtree is the sanctioned repair and has to land — otherwise the serial
  console is the only way out of a typo. `MosdService::persist_setting`
  preserves the refusals the write does not reach, and clears the one it does
  (`an_unrelated_write_preserves_a_refused_document_and_a_reaching_one_repairs_it`).

## 2. Fail closed for **every** document, confirmed rather than assumed

The namespace has **eight** occupants and **two** readers in different modules,
and the rule is the namespace's, not one reader's. Each was read rather than
assumed about:

| Occupant | Reader | On bytes that do not become configuration |
|---|---|---|
| the seven settings documents | `Store::read_config` → `read_document` | refusal, naming the file; the subtree is never adopted |
| `updates.json` | `configuration::load_updates` | `Err` naming the file; `PolicyStore::load` turns it into `LoadedPolicy { policy: EffectivePolicy::unknown_selection(), error }`, so there is no selection for a later caller to read a channel out of (RFCT-313) |

`every_occupant_of_the_namespace_fails_closed_and_names_its_file` asserts both
sides in one test, for the reason the plan gives: a slice that hardens the
reader it was thinking about and leaves the other to be found later is the shape
§5.2.7 warns about.

**Two places that DO return a schema default were checked and are neither silent
nor the pour's:**

- `load_newer` (`store.rs`) falls back to a document's schema default when a
  **newer** schema reshaped a key. That is the A/B rollback path, it is bounded
  to one document, and it is **reported** — `RollbackReport { defaulted: true }`
  reaches `main.rs`, which logs it at ERROR. A refusal there would crash-loop a
  rolled-back-to slot, which is the failure the tolerant load exists to prevent.
- `load_manifest` (`configuration.rs`) always answers, with
  `BakedManifest::code_defaults()` plus the reason. That is **layer 1**, inside
  the read-only verity root, not a poured document; and the defaults it answers
  with are empty of everything a device could act on — no source, no trusted
  key, fleet off — so it fails closed in effect as well as loudly.

`every_way_a_document_fails_is_a_refusal_and_not_a_default` drives the six
failure modes plus an unreadable file, because "fail closed for every document"
is a claim about the failure modes as much as about the files: a reader that
refused a parse error and let a bad `chmod` through fails open on exactly the
one an integrator produces.

And `a_refused_document_is_distinguishable_from_an_absent_one` pins §5.2.7's
*a parse error is not absence*: the two produce the same subtree and a different
`refusals`, so no caller can collapse them.

## 3. Clause 3, the hard way

`apid/tests/e2e.rs::a_poured_document_is_adopted_and_its_secret_reaches_no_served_record`
is a real `dbus-daemon`, a real `mosd` and a real `apid`. A `wifi.json` is
hand-written into the namespace **before the daemon exists** — which is the
bound §5.2.7 puts on the pour — carrying `wifi.ap.psk` and
`wifi.client.networks[0].psk`, both set to a string with no other reason to
exist on the device.

- **The device really holds it.** The bus surface is mosd's own tree with no
  redactor in front of it, and `GetSettings("")` returns the key. Without this
  half, a device that ignored the document would satisfy "the key is nowhere"
  perfectly.
- **The enumeration is a criterion, not a list.** Every GET path is read out of
  `pkgs/mosd/apid/openapi.json` — the document the route table generates — so a
  route added later is probed without anybody remembering to add it. **25
  published GET paths**, expanded to 33 concrete URLs; a parameterised path the
  expansion table does not know **fails the test** rather than going unprobed.
  Every response body is searched for the key.
- **The space is populated.** `GET /api/v1/settings/wifi` answers 200 with the
  poured SSID *and* `<redacted>`; `GET /api/v1/settings/wifi.ap.psk` — the
  dot-path naming the secret directly, which the structural walk cannot see
  because a bare JSON string has no field name left in it — answers the
  sentinel; `GET /api/v1/wifi/client/networks` answers the poured network with
  the key removed; the diagnostic snapshot is **collected first** and then
  fetched, so the search runs over a real bundle rather than a 404.

### 3.1 The second secret: the one a **refusal** carries

The adopted document and the refused one leak by different routes, and only one
of them is the redactor's. **This is the defect the slice went looking for and
found in its own first draft.**

A parser's sentence echoes what it choked on: serde prints `invalid type:
string "…", expected a boolean` with the value in it. The first draft put that
sentence into `DocumentRefusal::message`, which `reconcile_subtree` records
under the reconciler and `MosdService::publish_refusals` publishes at
`configuration.refused` — and `GET /api/v1/state/configuration` serves that,
past a redactor that keys on **field names** and has no reason to look at one
called `message`. A poured `mqtt.json` reading `"enabled": "<the site's broker
secret>"` would have published that secret through its own refusal.

The answer is a split, with the safe half taking the obvious name so that a
future call site reaching for `message` gets the one that may leave the device:

- **`message`** — served. The file, and which of **three** things went wrong:
  *did not parse as this build's schema*, *is at a schema version this build has
  no migration for*, *could not be read*. Words this build chose, so the set is
  closed and none of them can carry a byte of the document.
- **`detail`** — the parser's own sentence, logged by `main.rs` and nowhere
  else, with the reason written at the field.

So the e2e pours **two** documents: a valid `wifi.json` whose key must survive
the redactor's removal, and a broken `mqtt.json` whose secret must not survive
the refusal — and the 33-URL sweep searches every body for **both**.
`GET /api/v1/state/configuration` is asserted to answer 200 and to carry the
refusal, so the second sentinel was searched somewhere it could have been.

The same device also proves clause 2 end to end: `configuration.refused` has
**exactly one** entry, naming `mqtt.json`, while the `wifi.json` beside it was
adopted — one namespace, two documents, two different answers.

`GET /api/v1/provisioning/status` is probed and is psk-free. It answers **500**
in this environment, because apid reads its baked manifest from
`/usr/share/mos/meta/updates/manifest.json` and there is none on a test host —
so for that one route the probe is weaker than the others. It is not left on
that: the route is *structurally* unable to carry a `wifi` secret, and the
reason is at the code — `provisioning_status_at`'s `operator` half is a
projection built key by key over `update.source`, `update.channel` and
`update.policy`, and the handler's other two reads (`provisioning`, `access`)
go through `redact::redact` before anything is assembled. §6 records the
composed-image assertion that would close the gap.

Also asserted, on the same device: a valid pour refuses **nothing** —
`configuration.refused` is `[]` — which is clause 1 at the daemon.

## 4. One validator, not two

Nothing in this change grew a validator. The pour is validated by **exactly the
code that validates mosd's own output**, and that is a property of two lines:

- `Store::read_store` is the single loader. `load_with_report` and
  `load_with_refusals` differ by one argument — `Option<&mut Vec<DocumentRefusal>>`
  — which decides whether a document's failure is collected or propagated, and
  by nothing else. Two loaders would drift, and the direction they would drift
  in is the lenient one.
- `read_document` is the single per-document reader: the same `Format::parse`,
  the same `declared_version`, the same `serde_json::from_value` under
  `deny_unknown_fields`, whether the bytes came from `Store::save` or from an
  integrator's text editor.

For `updates.json` the same property was already true and is unchanged:
`configuration::validate` is public precisely so the reader and the write route
share one rule set, with the reason written at the function.

## 4.1 The tests were mutated, not only run

A green suite says the tests pass, not that they would notice. Four mutations
were applied to this branch one at a time, the suite re-run, and the tree
restored:

| Mutation | What went red |
|---|---|
| `apid::redact::redact` returns its argument unchanged | the e2e pour test, naming `GET /api/v1/settings/wifi` and printing the served `psk` — so **clause 3 is not vacuous**: the key really does travel that route and the redactor really is what stops it |
| the served refusal carries the parser's sentence instead of the class | the e2e pour test, naming `GET /api/v1/state/configuration` and printing `invalid type: string "refused-broker-secret-…"` — §3.1's leak, reproduced on demand |
| a document's failure produces `T::default()` with **no** refusal pushed | `one_unparseable_document_refuses_itself_and_nothing_else`, `every_way_a_document_fails_is_a_refusal_and_not_a_default`, `every_occupant_of_the_namespace_fails_closed_and_names_its_file`, `a_refused_document_is_distinguishable_from_an_absent_one` |
| the `preserve` guard removed from `Store::write_config` | `a_save_leaves_a_preserved_document_exactly_as_it_was`, `a_preserved_document_that_no_longer_exists_is_written_again` |
| the reconcile loop stops skipping a refused reconciler | `a_refused_document_skips_its_reconcilers_and_leaves_the_others_running`, with `left: [hostname, network, sshd, wifiAp, wifiClient]` against `right: [hostname, network, sshd]` |

## 5. The two open questions PLAN-070 says block this slice

§"Open questions" item: *"questions 7 and 8 block F6g, which is the slice that
delivers decision A's goal."* Both are answered here. Neither answer required
code.

### 5.1 Question 7 — how does an integrator physically perform the pour?

The plan offers two shapes and recommends the second: **(a)** mount the DATA
partition on a laptop and write `/mos/config/` directly, versus **(b)** drop the
documents at a fixed place on the boot medium and have the device adopt them on
first boot, reusing the provisioning document's transport.

**Answer: (a) is the shape this slice serves, and it is the shape §5.2.7's own
sentence describes** — *"an integrator writes these files onto a device that is
not running, and mosd validates what it finds on the next boot"*. A document
that is already at `/mos/config/wifi.json` when mosd starts is exactly what the
reader above is written against, and `MOSD_CONFIG_DIR` is what lets a test be a
device.

**Answering (a) does not foreclose (b), and that is why the question could be
answered at all.** (b) is a *transport*: a staging reader that ends by writing
the same documents into the same namespace, at which point the validation built
here is the thing that runs, unchanged. The plan's preference for it is a
preference about how bytes arrive — *"a partition an integrator mounts is a
partition an integrator can corrupt"* — not about what happens to them once
they are there. It is **owed** and named in §6; it was not built because it is a
new on-medium contract that belongs beside `provisioning.md` §4, which a
concurrent branch owns.

### 5.2 Question 8 — does a poured `ssh.json` inherit the provisioning document's bound?

`ssh.json` carries `access.ssh` whole, which includes `authorizedKeys`. The
provisioning document's bound, read at `provisioning_doc.rs` rather than
recalled: **a device that already has an administrator credential refuses the
document entirely** and writes nothing at all.

**Answer: the pour does not inherit that bound, and should not, because the two
channels rest on different authority.** The provisioning document arrives on
removable media inserted into a **running** device by whoever is standing next
to it, so the already-claimed refusal is what stops a stranger with a stick from
reconfiguring a deployed appliance — the same reason the transport has no udev
trigger. The pour is a write to the DATA partition of a device that is **not
running**, by somebody holding the storage medium. That person can equally write
`/var/lib/mos/settings.toml` and set `access.webAdmin.password_hash` to a hash
of their choosing, so a claim gate on `ssh.json` would bolt the front door of a
house whose back door is the same partition. The authority that bounds the pour
is physical custody of the medium, which is the authority
`docs/design/recovery.md` already gives the serial console.

This is the one place the plan says §5.2's pour and `provisioning.md` §4.1.4
have to agree. **The sentence belongs in `provisioning.md` §4 and that document
is a concurrent branch's**, so it is recorded here and named as owed in §6
rather than written into a file another agent is editing.

## 6. What was deliberately not changed, and what is owed

**Not changed, because a concurrent branch owns it:**

- `pkgs/mosd/mosd-settings/src/configuration.rs` — **not one line**. PLAN-071
  U11's save path and the apid write route for `updates.json` are being built
  in that module by another branch. `Store::save`, `Store::new`,
  `Store::load_with_report` and `MosdService::new` all keep their exact
  signatures for the same reason; everything this slice needed was added beside
  them (`Store::preserving`, `Store::load_with_refusals`,
  `MosdService::set_config_refusals`).
- every design document, including `docs/design/provisioning.md` §4 (F10/F11/U9).
- `docs/plan/index.md`, `docs/task/index.md`, `docs/CHANGELOG.md` (L1's).
- the console (U7).

**Not changed, because it is not this slice's:**

- the write route and the atomic save for `updates.json` (U11).
- `SettingsError`'s variants. A refused document produces no new error variant
  at all — it is a value, not an error — so `mosd::bus`'s error mapping and
  apid's status mapping are untouched and no bus contract moved.

**Owed:**

1. **`docs/design/mosd.md` §5.1a** — RFCT-314 wrote §5.2.7's rules where a
   subsystem author meets them; the per-document refusal, the
   `configuration.refused` live-state entry and `Store::preserving`'s rule
   belong in the same place. Not written here because it is a design document
   and the instruction was explicit; it is a documentation edit with no
   behaviour behind it.
2. **`provisioning.md` §4.1.4** — §5.2's answer to question 8, above, in the
   document the plan says it has to agree with.
3. **Question 7's shape (b)**, if it is wanted: the boot-medium transport. It is
   additive to everything here.
4. **One composed-image assertion.** `GET /api/v1/provisioning/status` answers
   500 on a test host for want of a baked manifest (§3), so the clause-3 probe
   over that one route is weaker than over the other twenty-four. On a composed
   image the manifest is present and the route answers 200; the assertion that
   a poured secret is absent from a **200** provisioning status is the one
   clause of this gate that a composed image would strengthen and that was not
   run here.
