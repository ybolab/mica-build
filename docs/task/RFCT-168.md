# RFCT-168 PLAN-019 M4: mosd/ moves to os/pkgs/mosd/, every consumer repointed

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-019 (M4)

The largest move: 91 tracked files, and the tree most cited by the gated design
documents. `mosd` is a top-level directory, so the moment it moves its first
path segment stops existing at the repository root — exactly the class RFCT-167
proved the checker does not protect. The 708 gated citations therefore ride in
the same commit as the move rather than in a follow-up.

Split in two deliberately: one commit that is the move plus its citations, and
one that repoints consumers. The first is verifiable by reversal; the second is
not, and mixing them would have destroyed that property.

## Scope

| file | change |
| --- | --- |
| `mosd/**` | `git mv` to `os/pkgs/mosd/**`, 91 tracked files |
| `docs/design/api.md` | 612 citations, prefix-only |
| `docs/design/dashboard.md` | 72 citations |
| `docs/design/remote-management.md` | 19 citations |
| `docs/design/bus.md` | 5 citations |
| `os/pkgs/mosd/hack/build-target.sh` | repository derived three levels up, container at `-w /src/os/pkgs/mosd` |
| `os/pkgs/mosd/hack/dbus-policy-test.sh` | repository derived four levels above its own directory |
| `.github/workflows/check.yml` | paths; the two-manifest MSRV agreement preserved |
| `Makefile`, `os/rootfs/build-v2.sh`, `os/build-env/**` | paths |
| `os/verify/src/**`, `test/apid-api/**` | paths, including three built from segments |
| `docs/architecture.md`, the READMEs | prose paths |

`check.sh` and `build-aarch64.sh` are dirname-relative and move-proof, so both
are untouched.

## The proof that the citation rewrite is prefix-only

Reversing the 708 rewrites reproduces the pre-image of all four documents byte
for byte. That is the whole claim: no line number moved, no quoted fragment was
retouched, and `docs/verify-citations.sh` read 902/902 with an unchanged split
on both sides of the commit.

## Three consumer classes a path-as-a-string grep does not reach

Each was found by a sweep the briefed file list did not contain, and each is on
PLAN-019's standing proof obligation because of this milestone.

1. **Segment-built paths.** `join(REPO_ROOT, 'mosd', ...)` in
   `os/verify/src/checks-connd.ts`, `checks-system.ts` and `smoke-pins.ts`.
   Two of these were beyond the briefed list.
2. **Crate-relative shorthand.** `check.yml`'s `mosd/tests/*.rs` was relative to
   the workspace, not to the repository root, so a blanket prefix would have
   named a path that does not exist.
3. **Variable-prefixed paths.** `$REPO_ROOT/mosd/...` in `build-v2.sh` carries
   no left-hand boundary for a grep to anchor on — the acceptance grep's own
   `(?<![/\w.-])` lookbehind excludes this shape *by construction*, because the
   preceding character is `/`. Three lines in this milestone's own hack script
   were missed on the first pass this way.

### The weakened assertion, which is worse than a red test

`os/verify/src/smoke-pins.test.ts:157` asserted
`expect(pin.file).toContain(join('mosd', crate))`. After the move `mosd/<crate>`
is still a substring of `os/pkgs/mosd/<crate>`, so **the test would have kept
passing** while asserting strictly less than it was written to assert. It is now
`join('os', 'pkgs', 'mosd', crate)`.

The rule this produced, carried into M5's acceptance: when a move touches a
test, check that its assertions still *assert*, not merely that they pass.

## Left deliberately

Each of these carries the token `mosd` and must not be rewritten:

- the daemon name in prose;
- the feature identifier driving `selectStages()` and `--without mosd`, and the
  `Package: mosd` dpkg strings;
- the staged `mosd/` build-context directory in `os/rootfs/README.md:265`;
- the and-slash in "the ELF architecture of mosd/apid"
  (`os/verify/src/checks-system.ts:7`);
- the two verbatim quotations of PLAN-014's Scope section
  (`os/verify/src/checks-connd.ts:11`, `checks-system.ts:24`), which quote a
  document that still reads `` `mosd/` Rust sources `` at `:243` and `:256`.
  `docs/plan/` is history and keeps its old paths, so rewriting the quotation
  would fabricate a quotation of a document that says something else.

## Measurements

- `docs/verify-citations.sh`: 902/902, split 355 quoted / 547 resolution-only,
  skip buckets 50 / 168 / 4 — identical before and after.
- No dependency change: no lockfile moved, and the only manifest diff is three
  comment lines in `os/pkgs/rauc-sign/Cargo.toml`.
- Both manifests still answer MSRV 1.96, which is what `check.yml`'s agreement
  step requires.
- `mosd/target/` (4.2G, untracked) was moved by hand at integration.
