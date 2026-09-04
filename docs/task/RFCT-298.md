# RFCT-298 Report rtnetlink enums on the observed-network surface as names

- **status**: completed
- **priority**: P2
- **owner**: net-route-protocol/bkd-txd1prdv
- **createdAt**: 2026-09-04 10:00

## Description

`GET /api/v1/network/status` returned a default route whose `protocol` was the
string `"16"` on a bench cx3576. 16 is `RTPROT_DHCP`; every neighbouring member
of the same object is a name.

The number is not the kernel's fault and not the UI's. networkd emits both a
numeric `Protocol` and a `ProtocolString` for every route, and its JSON writer
resolves `ProtocolString` against `route_protocol_table[]` -- three entries,
`kernel`/`boot`/`static` -- then falls back to `asprintf("%i")`. mosd's
`default_route_json` copied that string through. The name `dhcp` exists in
systemd's own `route_protocol_full_table[]`; the JSON writer just does not use
it, so the translation has to happen in `network_state.rs`.

Protocol ids are also assigned to daemons at runtime, so no map is total. The
same writer produces the same decimal fallback for an address `ScopeString` the
kernel does not name and for a route `TableString` nothing named.

## ActiveForm

Reporting rtnetlink enums as names beside their raw ids.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- A test that reproduces `protocol: "16"` from a networkd `Describe` shaped the
  way systemd 257 actually shapes one, red before the fix.
- `protocol` is the well-known rtnetlink name; an id no table names reports
  `unknown` rather than the number again, and the raw id is carried beside it
  so an operator can tell an unnamed protocol from a broken field.
- The other rtnetlink enums on the same path are judged, and the ones with the
  same defect are fixed with the same rule.
- The diagnostics redaction allowlist admits every new member; a member the
  allowlist does not name is dropped from the bundle.
- `cargo test` green for the crates touched; `(cd verify && bun test)`,
  `(cd build && bun test)` and `make docs-verify` green.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

- complete: `default_route_json` and `address_json` now resolve every
  rtnetlink enum on the observed surface from the numeric id networkd carries
  beside its string form, and report a name plus that id: `protocol` +
  `protocolId`, `scope` + `scopeId`, `table` + `tableId`. An id nothing names
  is `unknown`, never the number again. No id at all stays absent -- neither
  member is invented.

  Where the number came from, established rather than guessed: systemd v257's
  `src/network/networkd-json.c` builds a route's `ProtocolString` with
  `route_protocol_to_string_alloc`, and `networkd-route-util.c` defines that
  against `route_protocol_table[]` -- `kernel`, `boot`, `static`, three
  entries -- through `DEFINE_STRING_TABLE_LOOKUP_WITH_FALLBACK`, whose
  `_to_string_alloc` does `asprintf("%i")` for anything else
  (`src/basic/string-table.h`). `RTPROT_DHCP` is 16, so a DHCP default route
  describes itself as `"16"`. The name exists in the same file's
  `route_protocol_full_table[]`; only the JSON writer does not use it, which
  is why the translation belongs in mosd and not in the UI.

  The map is `linux/rtnetlink.h`'s `RTPROT_*` set, checked against the kernel
  header rather than recalled -- the same set `/etc/iproute2/rt_protos` ships,
  plus `RTPROT_MROUTED` (17), which the header names and that file omits.

  The other rtnetlink enums on this path, all four judged:

  - `scope` on addresses: **same defect, fixed.** networkd builds
    `ScopeString` with the same fallback macro over a five-entry table, and
    ids 1-199 / 201-252 are the range the kernel hands to userspace, so an
    address with a user-defined scope reads as a number.
  - `table` on routes: **same defect, fixed differently.** Table names come
    from configuration (`RouteTable=`) as well as from the three the kernel
    reserves, so networkd knows names this tree cannot derive; its
    `TableString` is kept as the name and rejected only when it is the decimal
    fallback the same writer emits for a table nothing named.
  - `scope` on routes and `type` on routes: **not applicable.** Neither is on
    this surface -- `default_route_json` emits family, gateway, interface,
    interfaceIndex, metric, protocol, table and configSource, and nothing
    else. Adding them would be a new field, not a fix.

  Not changed, and why: the reduced view behind `GET /api/v1/network` copies
  networkd's `Addresses`, `DNS` and `Routes` arrays through **verbatim**, so
  `ProtocolString: "16"` is still readable there. That is not the same defect
  -- those members carry networkd's own key names (`Family`, `Destination`,
  `ProtocolString`), so a reader is reading systemd's document, not this
  API's vocabulary, and the bench report named the lowercase `protocol` that
  only the observed surface has. It is worth recording that `docs/design/api.md`
  calls that view "normalized" while its nested arrays are not; naming those
  fields would be a second vocabulary and a design decision, so it was left.

  The diagnostics redaction allowlist is an allowlist -- an unlisted member is
  dropped from the bundle -- so `protocolId`, `scopeId` and `tableId` were
  added to it and `REDACTION_SCHEMA_VERSION` went 2 -> 3, which is the trigger
  its own comment names. `SCHEMA_VERSION` was left at 1: the snapshot's
  sections and their identities are what `docs/design/diagnostics.md` section 5
  enumerates and none of them changed. (Unrelated and untouched: that
  section's heading says "version 1" while its own table row says `2`.)

  Verified: `cargo test --locked -p mosd -p apid` green (489 + 317 + the
  integration suites), red before the fix with `left: String("16")`;
  `(cd verify && bun test)` 1248 pass; `(cd build && bun test)` 869 pass;
  `make docs-verify` green; `bash pkgs/mosd/apid/ui/build.sh --check` (lint,
  typecheck, vitest in the pinned Bun image) green. `cargo fmt` and
  `cargo clippy` were NOT run: `localhost/mos-build-rust` ships only cargo,
  rustc and std, and this container has no Rust toolchain of its own.
