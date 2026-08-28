# RFCT-138 The workspace's no-C-dependency posture is a comment, and cargo-deny is configured to enforce nothing

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
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
project rejects dependencies that build C: `docs/design/dashboard.md:1001-1005` records
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
