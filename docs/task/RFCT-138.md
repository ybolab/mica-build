# RFCT-138 The workspace's no-C-dependency posture is a comment, and cargo-deny is configured to enforce nothing

- **status**: completed
- **priority**: P2
- **owner**: bkd/1n7prrif
- **createdAt**: 2026-08-26

`mosd/deny.toml` is 45 lines. Forty of them are the `[licenses]` allowlist. The
bans section is two lines:

```toml
[bans]
multiple-versions = "warn"
```

(`:33-34`) — a warning, and no `deny` list at all. `mosd/hack/check.sh:13` runs
`cargo deny check licenses bans advisories`, so the gate executes and passes on
a bans policy that bans nothing.

The posture it is failing to enforce is real and written down elsewhere. The
project rejects dependencies that build C: `docs/design/dashboard.md:990-994` records
the workspace pinning `tough` to `=0.18.0` because *"0.19+ hard-depend on
aws-lc-rs, which builds C (AWS-LC)"*, and calls that posture enforced *"in a
comment rather than by accident"*.
That is a cross-compilation and reproducibility constraint for an appliance
image, and today the only thing standing between it and a regression is that
whoever adds the dependency happens to know.

An archive-format crate for the bundle-upload transport ([[RFCT-136]]) is the
next decision this will be tested by: the obvious candidates for tar and zip
split along exactly this line.

What is owed is a `[bans] deny = [...]` list naming the C-building crates the
project has already decided against, so the next one is refused by the gate
rather than by memory.

## Resolution

`deny.toml`'s `[bans]` now carries a `deny` list with the two crates the
recorded decision names:

- `aws-lc-rs` (any version) — builds C (AWS-LC); the workspace's crypto
  backend is ring, pure Rust.
- `tough@>=0.19.0` — 0.19+ hard-depends on aws-lc-rs; the `=0.18.0` pin in
  `Cargo.toml` stays, and the ban is what refuses un-pinning it.

`multiple-versions = "warn"` is unchanged. The gate (`hack/check.sh` runs
`cargo deny check licenses bans advisories`, cargo-deny 0.19.5) stays green on
the real graph: `cargo deny check bans` → `bans ok`.

Refusal was demonstrated against a scratch copy of the workspace with
`aws-lc-rs = "1"` appended to `apid/Cargo.toml`:

```
error[banned]: crate 'aws-lc-rs = 1.18.0' is explicitly banned
   ┌─ /scratch/deny.toml:41:16
   │
41 │     { crate = "aws-lc-rs", reason = "builds C (AWS-LC); ..." },
   │                banned here
```

exit code 2. The resolved graph also showed exactly the regression the posture
exists to block: `aws-lc-sys v0.44.0` pulling `cc` and `cmake`.
