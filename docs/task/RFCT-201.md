# RFCT-201 PLAN-022 M2: quoted-segment path syntax

- **status**: completed
- **priority**: P1
- **owner**: bkd/03p7k0l1
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-022 (M2)
- **design**: RFCT-200 section 2.1 (the mechanism), section 8 (the M2 cut)

M2 is the path-syntax half of RFCT-135: a settings key holding a dot becomes
addressable. Nothing about interface *types* lands here — no `kind`, no VLAN
block, no schema bump. What lands is the segment grammar, the writers that
compose paths in it, and the `network` key rule that keeps the one
unspellable key out of the tree.

## Scope

| file | change |
| --- | --- |
| `os/pkgs/mosd/mosd-settings/src/path.rs` | the segment lexer: bare or double-quoted segments, shared by `json_path_get` and `split_path`; `quote_path_segment` composes them |
| `os/pkgs/mosd/mosd-settings/src/lib.rs` | `quote_path_segment` exported |
| `os/pkgs/mosd/mosd-settings/src/model.rs` | `Settings::set` validates the `network` keys the write introduces |
| `os/pkgs/mosd/apid/src/routes.rs` | `iface_settings_path` quotes the interface segment; both `network.<iface>` writers use it |
| `os/pkgs/mosd/mosd-settings/tests/settings.rs` | five tests, including the RFCT-135 reproduction as a fixture |
| `os/pkgs/mosd/apid/src/tests.rs` | the pane writes the quoted path |
| `docs/design/*.md` | line-number-only citation re-anchor (below) |

## The grammar

A path is `.`-separated segments. A segment is either **bare** — no `.`, no
`"` — or **double-quoted**, inside which `.` is an ordinary character:

```text
network."eth0.100".dhcp      one interface named eth0.100, one field
network.eth0.100             unchanged: field `100` of interface eth0, an error
```

This is TOML's own quoted-key spelling, which is what the store already
writes for such a key — RFCT-200 section 1.2 measured `[network."eth0.100"]`
coming out of the serializer with no code change at all. The accessor now
reads the notation the persistence layer was already emitting; `settings.toml`
on STATE and an API path are spelled the same way.

Malformed spellings are path errors, not keys: an unterminated quote
(`network."eth0.100`), text after the closing quote (`network."eth0.100"x`),
a quote inside a bare segment (`network.eth"0.100"`), an empty quoted segment
(`network.""`) and a lone quote each return `SettingsError::NotFound` on the
write side and `None` on the read side. No new error variant: malformed paths
were already `NotFound`, as `Settings::set`'s own contract says.

Reads and writes go through one function. `json_path_get` no longer splits on
`.` itself; it calls `split_path` and walks the segments it returns, so a path
that resolves for `get` is spelled exactly the way `set` takes it. The
segment type changed from `&str` to `String` because an unquoted segment is
no longer a subslice of the path.

## Key-charset validation, and the M2/M3 boundary

Section 8's M2 bullet assigns *"v7 key-charset validation for `network`
keys"* to this milestone while schema v7 itself is M3. That reads ambiguous
only until section 7 resolves it: *"New key-charset validation (section 2.1)
applies to writes, not loads, so no existing loadable tree is rejected."* A
rule that applies to writes is a property of `Settings::set`, not of the
document format, and needs no version bump to hold — so M2 is implementable
literally, and nothing here is blocked on M3.

`Settings::set` therefore rejects a `network` key that is not an interface
name: empty, longer than 15 bytes (`IFNAMSIZ` minus the terminator), `.` or
`..`, or carrying anything but ASCII alphanumerics and `. - _ :`. The charset
is the network reconciler's own (`validate_iface_name`,
`os/pkgs/mosd/mosd/src/reconciler/network.rs:154-174`), repeated rather than
widened: a key the renderer would refuse should not be writable through the
tree, and repeating it also makes the one key this grammar cannot spell — a
key containing `"` — structurally impossible rather than merely
unaddressable, which is the mitigation RFCT-200 section 2.1 asks the schema
to provide.

`.` and `..` are refused as well. Section 2.1 states the rule as three
clauses (non-empty, at most 15 bytes, that charset), and a bare `.` passes
all three; the reconciler refuses it as a file-name escape, and a key
writable through the API that then fails every subsequent reconcile of the
whole `network` subtree is a self-inflicted outage. The two clauses that
close that are the reconciler's, verbatim.

**Writes, not loads, is enforced per entry.** The check runs over the
candidate tree's `network` entries and skips every entry the write leaves
byte-identical to the current one. So a hand-edited `[network."eth0 100"]`
that predates the rule still loads, still reconciles as it did, and does not
stand between an operator and an unrelated `hostname` write — while any write
that touches that entry is refused. A whole-candidate check would have made
one bad key on STATE reject every write in the tree, which is exactly the
"no existing loadable tree is rejected" outcome section 7 rules out.

## apid

Both `network.<iface>` writers — the `/network` pane and the setup wizard —
compose through `iface_settings_path`, a two-line helper over the exported
`quote_path_segment`. `valid_iface_name` still admits `.`
(`os/pkgs/mosd/apid/src/routes.rs:3396-3401`), and now the path it produces
means what the form said: one key, not two segments. Nothing else in the pane
changes; the typed per-kind forms are M6.

## Tests

`os/pkgs/mosd/mosd-settings/tests/settings.rs`, section *Quoted path
segments*:

- **the RFCT-135 reproduction as a fixture** — writing
  `network."eth0.100"` with a static block lands the key `eth0.100`, reads
  back through `network."eth0.100".static.address`, takes a leaf write at
  `network."eth0.100".dhcp`, persists as `[network."eth0.100"]`, and reloads
  equal. The four facts section 1.2 measured separately, in one test.
- the unquoted spelling still fails with `unknown field \`100\``, so the
  probe's original diagnosis stays reproducible;
- the five malformed spellings fail on both the read and the write side;
- the key rule refuses six names and accepts `eth0.100` and `br-lan:0`;
- a pre-existing bad key loads, does not block an unrelated write, and blocks
  a write to itself.

`os/pkgs/mosd/apid/src/tests.rs`: posting `iface=eth0.100` to `/network`
records exactly `network."eth0.100"` as the path handed to the daemon.

## Not touched, deliberately

- **`paths_overlap`** (`os/pkgs/mosd/mosd/src/bus.rs:32-47`) still splits on
  `.` naively, and is still correct for every path this change can produce: a
  reconciler subtree is always bare (`network`, `wifi.client`, `access.ssh`),
  a quoted segment can only appear below the first one, and a segment-wise
  prefix comparison reaches its `None` arm before it can mis-compare. A write
  to `network."eth0.100".dhcp` re-applies the network reconciler, which the
  suite covers.
- The network reconciler's error strings interpolate `network.{iface}`
  unquoted. They are messages, not paths, and the reconciler is M4's.
- apid's `FakeSettings` test double splits paths naively. It records what the
  routes send, which is what its assertions read; the lexer's semantics are
  tested where the lexer lives.

## Citation re-anchor

The three edited sources carry design-document citations by line number, and
the gate checks them. 247 tokens were re-anchored across `api.md`, `bus.md`,
`dashboard.md` and `remote-management.md` — line numbers only, computed by
diffing each file against its pre-image; no prose and no quoted fragment was
retouched, and `docs/verify-citations.sh` reports 902/902.

**Reported, not fixed.** Two things this milestone deliberately left alone:

- `api.md:1199-1203` and `api.md:4217-4221` still describe the collision as
  live (*"`split_path` splits on `.` unconditionally"*). That prose is now
  false, and rewriting it is M8/RFCT-207's assigned work (*"api.md section
  2.2's collision entry updated to the shipped fix"*). Their `path.rs`
  citations were re-pointed to `split_path`'s new range so they name the
  function the sentence is about; the sentences themselves are left for M8.
- `api.md:4218` cites `valid_iface_name` at a range that already pointed at
  `valid_ipv4` before this branch — the citation had drifted seven lines and
  the gate does not catch it, because it carries no quote. The re-anchor
  shifted it faithfully rather than repairing it: fixing someone else's drift
  inside a mechanical rewrite would make the rewrite unreviewable. RFCT-200
  section 1.3 cites the same function correctly.

## Verification

| gate | result |
| --- | --- |
| `bash os/pkgs/mosd/hack/check.sh` | `Summary [49.750s] 606 tests run: 606 passed, 0 skipped`, doctests ok, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| `bash os/pkgs/rauc-sign/hack/check.sh` | `ALL CHECKS PASSED` |
| `make docs-verify docs-verify-citations` | index assertions pass; `docs/verify-citations.sh: 902/902 PASS` |

Rust gates run in the `localhost/mos-build-rust` container against the
1.98 toolchain, with `cargo nextest` 0.9.133.
