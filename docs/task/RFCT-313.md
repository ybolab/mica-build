# RFCT-313 The baked reader, the precedence, and the operator document's move

- **status**: completed
- **priority**: P2
- **owner**: plan-070-f5-f6-f6b/bkd-o6eeb97q
- **createdAt**: 2026-09-05 10:00

## Description

PLAN-070's backlog rows **F5**, **F6** and **F6b**, taken as one task because
the plan takes them as one: *"F6 and F6b are the slices with the highest chance
of a silent defect, because getting the parse-error case wrong is invisible
until the day it matters, and because a half-finished move is exactly the
two-files-name-the-channel state the move exists to prevent."* F5 is the reader
both stand on.

- **F5** — the baked manifest reader in mosd: parse
  `/usr/share/mos/meta/updates/manifest.json`, validate, `deny_unknown_fields`,
  expose it as live state, and make an unknown key a **build** error rather
  than a runtime one.
- **F6** — §5.1's three-layer precedence: per-key override of the four keys
  layer 1 bakes defaults for, and the parse-error rule that does **not** fall
  back to the baked channel.
- **F6b** — retire `/var/lib/mos/update-policy.toml`; `/mos/config/updates.json`
  in its place, as JSON, with `source.url` carried over as an override and
  `source.rootPath` dropped.

RFCT-306's amendment (PLAN-070 §5.3, PLAN-071 §10) governs the schema: the two
URLs are overridable and the anchors are not, so F6b's original *"a document
naming a source URL is a load error"* is inverted, and what must be a load
error is any anchor-shaped key — asserted by name per key rather than only
through the generic unknown-key path.

## ActiveForm

Building the baked reader, the precedence and the operator document's move.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- F5: the reader parses and validates the baked manifest, refuses an unknown
  key at build time, and always answers with a document.
- F6: layer 2 overrides layer 1 per key; a layer-2 document that does not load
  refuses the actions it gates and does not adopt the baked channel; an
  overridden source that does not answer reports the failure and does not
  revert to the baked address.
- F6b: the operator document is `/mos/config/updates.json`; `source.rootPath`
  is gone; `trust`, `signingKeys`, `signingKeyId(s)`, `rootPath` and `keyring`
  are load errors by name; the same-origin credential base is pinned to the
  **baked** `update.source` and `http.credentialHosts`.

- complete: the three slices are implemented, and the parse-error rule is
  enforced by a shape rather than by a convention.

  **F5 — `pkgs/mosd/mosd/src/baked_meta.rs`.** `BakedManifest` mirrors
  PLAN-070 §2's document with `deny_unknown_fields` and **no serde default on
  any field**, which is that section's "no implicit defaults" made mechanical:
  a manifest missing a key is refused rather than silently completed. `load()`
  always answers with a `LoadedMeta` — the document plus the reason it is not
  this device's — so no caller has an absent layer to handle. `main.rs` reads
  it once at startup, because the file is inside the read-only dm-verity root
  and a re-read per decision would answer the same thing, and publishes the
  whole document under live-state `meta`. Publishing it whole is safe for
  PLAN-070 §8's structural reason and not a promise: the baked set is
  allowlisted at staging and checked again against the image.

  **The unknown key is a build error.** `rootfs/build.sh` compares the key
  names in `meta/updates/manifest.json` against
  `meta.example/updates/manifest.json` and refuses the build in **both**
  directions — an unknown key and a missing one. The allowed set is read out of
  the committed example rather than listed in the script: that file is already
  the statement of the shape and `gen-dev-keys.sh` already instantiates `meta/`
  from it, so a list in the script would have been a second copy that agrees
  with nothing on the day the schema grows a key.

  **F6 — precedence, and the case that had to be right.** `PolicyStore` now
  carries the baked layer and resolves layer 2 over it per key:
  `source.url`, `source.channel`, `policy` and `checkIntervalMinutes` take the
  baked value when the document is silent about them, and layer 2 owns the
  windows, the network mode, the workspace paths and the reboot-gate keys
  outright. The parse-error rule is enforced by a **signature**, not by a
  comment: `EffectivePolicy::unknown_selection()` takes no arguments, so the
  malformed path structurally cannot reach the baked layer, and the selection
  it produces is `None` rather than a channel somebody might read. Every action
  the document gates refuses with a message naming the file; the reboot gate
  keeps evaluating on the code defaults, because an unreadable file must not
  brick the reboot button. There is no fallback to the baked address anywhere:
  the baked value is consulted when layer 2 is silent and at no other moment.

  **F6b — the move.** `/var/lib/mos/update-policy.toml` is gone; the document
  is `/mos/config/updates.json` and it is JSON. `source.rootPath` left with it
  — `--root` is now a build-side constant that F7 replaces with the baked
  `trust.signingKeys` — and `source.url` stayed, per §5.3. `autoCheck` is
  retired for PLAN-071 §1's top-level `checkIntervalMinutes`, and `policy`
  (`off`/`check`/`auto`) is carried through the precedence and gates the
  auto-check loop; the automatic fetch and install behind `auto` are PLAN-071's
  slice and are not built, so `auto` checks on the same cadence `check` does.

  **The anchors are refused by name.** `ANCHOR_KEYS` — `trust`, `signingKeys`,
  `signingKeyId`, `signingKeyIds`, `rootPath`, `keyring` — is scanned over the
  parsed document **at any depth, before deserialisation**, and a hit is a load
  error naming the key. This is deliberately not the generic unknown-key path:
  a document that named `trust` would be refused by `deny_unknown_fields` today
  and would stop being refused the day somebody widens the schema for a benign
  reason, which is exactly the failure §5.3.5 describes. The plural
  `signingKeyIds` is in the list as well as the singular the plan names,
  because the plural is what the baked manifest calls the field.

  **The credential base is pinned to layer 1.**
  `BakedManifest::credentials_allowed_for(url)` compares the target against the
  origin of the **baked** `update.source` and the **baked**
  `http.credentialHosts`, and it takes the target URL as its only argument —
  there is no shape of the call that could re-anchor on an override. It has no
  caller yet, by design: mos authenticates to no update source, and §2.1
  requires the rule to exist before the first credential does because the
  failure it prevents is silent.

  **Not verified, and named rather than implied.** Per this batch's working
  mode no tests were written and no suite was run. What ran: `cargo check`,
  `cargo clippy -p mosd --all-targets -D warnings` and `cargo fmt --check` in
  `localhost/mos-build-rust-check:amd64`, all green, and `bash -n
  rootfs/build.sh`. Nothing in this record was executed. Owed as tests: the
  by-name anchor refusal, one case per key (§5.3.5 asks for exactly this and it
  is the assertion this task could not write); the parse-error case asserting
  that the effective selection is absent rather than the baked one; the
  same-origin predicate, whose origin parser has never been run; and
  `meta.example/updates/manifest.json` parsing into `BakedManifest`, which is
  what ties the build-side key check to the reader.

  **Out of scope and still owed by their own rows.** F6c owns `/mos/config/`
  itself — the `mos-data-layout` entry at 0700, `SYSTEM_SKELETON` in
  `reset.rs`, and tier 1's re-seed — so until it lands a device has no
  directory to write the document into and a reset does not restore it. F9 owns
  the baked/operator/effective reading on `GET /api/v1/provisioning/status`;
  the lifecycle entry reports the effective values and `null` for all four when
  the document did not load, and deliberately does not show the baked value as
  a stand-in. F10 owns the design documents that still describe
  `update-policy.toml`. PLAN-071 owns `rebootPolicy`, the
  `auto`-requires-a-window rule and the write route; none is in this schema,
  because a key nothing reads is worse than a key the schema refuses.

- complete: the resolution is callable from outside the policy module, and
  there is one implementation of it.

  **Why it moved into the library rather than growing a getter.** RFCT-315's
  F9 reports the effective policy on `GET /api/v1/provisioning/status`, and
  that route is served by **apid**, which links `mosd-settings` and cannot
  link the `mosd` binary. So a resolution private to `mosd` could only have
  reached apid as a second implementation, which is the thing L1's constraint
  exists to prevent. The documents, the readers and the precedence now live in
  `mosd_settings::configuration`; `mosd/src/update_policy.rs` keeps the
  semantics — the refusals, the window, the cadence and the reboot gate — and
  re-exports the types so the lifecycle still names one module.
  `mosd/src/baked_meta.rs` is gone, absorbed into the same module: the baked
  layer is half the resolution and could not stay behind.

  **The seam.** `configuration::provisioning_status() -> Result<Value,
  ConfigError>`, the spelling RFCT-315 declared, plus
  `provisioning_status_at(manifest, updates)` which it is the no-argument form
  of, so the pair is testable without the production paths. It returns
  `{operator, effective}` with `update.source`, `update.channel`,
  `update.policy` and the baked `fleet.url`, `fleet.enabled`. The baked half
  of the route is RFCT-315's and is not duplicated here.

  **Absent and `null` are two answers, and stay two.** Every overridable key
  is `Option<Option<T>>` behind serde's absent/present split: a key the
  operator never wrote is `None`, a key they wrote as `null` is `Some(None)`,
  and `resolve` flattens both to the baked default because PLAN-071 §1 says
  `null` means *take the baked default*. `provisioning_status` reports the
  document rather than the resolution, so the operator object omits the first
  and carries `null` for the second.

  **A layer-2 failure is `Err`, on every path, for both callers.**
  `load_updates` returns `Ok` only for a document that read, parsed, carried
  no anchor-shaped key and validated — and for a **missing** file, which is
  the never-configured device and the one case that is legitimately the baked
  defaults. `PolicyStore::load` is the only place the two callers differ: it
  turns that `Err` into `EffectivePolicy::unknown_selection()` plus the
  reason, because a daemon needs a policy object to keep the reboot gate
  working. It does not build one from the baked layer, and it cannot —
  `unknown_selection()` takes no arguments. So the status route returning
  `Err` and the update path refusing are the same fact reaching two surfaces.

  **Redaction is unnecessary rather than remembered.** The operator half is
  built key by key from three named fields, never serialized from the
  document, so a key the projection does not name cannot reach a caller
  however the schema grows — the same shape PLAN-076 §4 gives the fleet
  snapshot. A caller may still pass it through its own redactor; it will find
  nothing to remove.

  **`fleet` is the baked value, and that is not a stub.** `/mos/config/`'s
  fleet document is PLAN-072 §2's and does not exist; nothing on the device
  reads one either, so reporting the baked value is what the device is
  genuinely using. Inventing its schema here would have risked refusing valid
  documents the day that slice lands. When it does, it extends this function;
  it does not add a second resolver.

  **A layer-1 failure is deliberately not an `Err` here.** `load_manifest`
  still always answers with a document, so `effective` reports the code
  defaults — which are the values the device is actually running on, so the
  two callers still agree. The baked half of the route reports the manifest's
  own error.

  Verified: `cargo clippy --workspace --all-targets -- -D warnings` and
  `cargo fmt --all --check` green in `localhost/mos-build-rust-check:amd64`,
  apid included. Still no tests written and no suite run. Newly owed on top of
  the list above: the absent-versus-`null` distinction through
  `provisioning_status_at`, and one case proving the `Err` path and the
  `unknown_selection` path come from the same document.
