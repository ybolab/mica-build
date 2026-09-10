# 20260910-1050-c-native-endpoint-verification Verify native binaries contain no default update endpoints

- **status**: completed
- **createdAt**: 2026-09-10 10:50
- **approvedAt**: 2026-09-10 20:35
- **relatedTask**: 20260910-1050-c-native-endpoint-verification

## Final result

The bounded software/sample slice is complete at verifier source 57312ed80715319f95fb2edd5c6cb64d6008b0b7: 271 focused tests, 911 verifier tests, and the real ROOT_CHECKS sample scan pass. The exact sample contributes 3 native files / 19,824,184 bytes with rechecked hashes; it retains the original #313 dirty development identities. Initial sample failure remains recorded. A4/B7 own later current-candidate scans and all hardware evidence remains separate. The task records final review and complete gate metadata. Earlier pending-attribution annotations below describe prior stages and are superseded by the exact dependency evidence in this section.

## Context

C1 D4 identifies the missing native equivalent of PLAN-070 F8 and RFCT-315 F8. The approved local L2 baseline is 9f773a9cb1ad1bd882e2f11784288aea4a9e262f. C.D3's independent public metadata validator is reviewed and preserved. ROOT_CHECKS already reaches packed-root verification, but currently has no compiled endpoint check. The current first-party inputs are /usr/bin/mosd, /usr/bin/apid, and /usr/bin/mos-deploy.

## Proposal

1. Add behavioral fixtures through the new ROOT_CHECKS entry: all three clean ELF inputs, endpoint-bearing ELF versus identical configured metadata URL, missing/empty/non-ELF/symlink inputs, and exact scan evidence. Verify RED before implementing.
2. Add the native endpoint check only in checks-file-root.ts. Validate input paths and ELF bytes, inspect all three binaries, and produce path-specific diagnostics without byte dumps. Verify GREEN through the same registry entry.
3. Review the scoped diff for endpoint exclusions and image-root resolution; run the focused verifier test, make os-verify-test, make docs-verify, and scoped git diff --check. Record exact commit/log/process/time/exit evidence. Distinguish fixtures from immutable packed-artifact evidence supplied by L2.

## Risks

- Broad URL exclusions can hide defaults; any exclusion must match a complete literal backed by current binary or embedded-source evidence, with a minimally changed negative control.
- Symlink traversal or absent inputs can fabricate success; refuse unsafe inputs before reading and require all three paths with nonzero file and byte counts.
- Embedded frontend namespaces and API documentation are not necessarily network defaults; classification requires exact current evidence, without domain-wide exemptions.

## Scope

Write only verify/src/checks-file-root.ts, verify/src/checks-file-root.test.ts, this task/plan pair, and their own index rows. Preserve public metadata, other root policy checks, historical classifications, runtime defaults, fixed trust, UI, and sibling records. No compatibility, third-party scan, retired updater restoration, network activation, full-image/kernel/root/QEMU build, or hardware qualification.

## Alternatives

No generic scanner helper is authorized. Keep the bounded check in the existing module; request missing immutable artifact evidence through L2 rather than rebuilding or guessing exclusions.

## Annotations

- The dependency-release amendment authorizes implementation now and satisfies the PMA proposal gate.
- Baked fleet remains off/null on this baseline. The reviewed protocol design adds no compiled endpoint or runtime. The separate offline fleet configuration slice is not merged and is not claimed here.
- L2 D owns global history; provide an English history note at handoff without editing changelog.

- Fixture implementation at 197e1e53f92e525f6284dc262698733d21c9f679 passes 109 focused tests and 749 verifier tests including typecheck; documentation verification passes. PMA-CR scoped review is PASS with zero high-confidence findings. No literal exclusion is inferred. This plan remains implementing until L2 supplies immutable current native inputs and exact embedded-source evidence for any required non-endpoint classification.

- Later clean-boundary sync: 0a8aa6e840bf455fd8cb088ab1e205b9f0e1e6f0 was merged as 3d6e55e38db3789b88ec5642bdd593aab8208d10 with only index append conflicts. The current source baseline now includes the approved offline fleet desired projection; original 9f773a9c evidence remains historical and accurate. Native verifier source bytes did not change across this merge.


## Signed development sample and exact embedded literals

L1 delivered the exact original #313 S905X5M sample: source-content-equivalent to 5d0dca577a782aa707d9530779c4b23f2a7eda31/tree a8b079edc67010b6662b2243a5647950eb7176ef, retaining package 0.1.0+git5c61f7fbb558.dirty-1 and mosd5c61f7fbb558-dirty. This is not a build of current C, the new A CX candidate, or a clean-commit rebuild. All hardware remains unqualified. L1's final scope clarification makes this software/sample slice sufficient; A4 and B7 own later current-candidate scans.

Rehashed /tmp/mos-open-plans-20260910-100408/s905x5m-native-elf-readonly-handoff.json (f119bfe3a647826a09fa06ff87ed195bd621b7b5e80ca175333cf4386de54dcf), its source mapping/root image/root descriptor, all three native files, and /tmp/mos-open-plans-20260910-100408/s905x5m-apid-retained-assets.json (f28dcbc7ee77e8efe4d91f69dcd80408398c4ef36dc8da435d0f33fee3c8b15b). Initial ROOT_CHECKS execution at c6001ed5a3c68d793464dddd1820e8c94489c6c5 rejected all three files after scanning 19,824,184 bytes. This records actual findings, not final candidate acceptance.

The following exact literals are established in the supplied compiler inputs, byte-identical original dist files, and delivered APID at the attested whole-asset offsets. Exclusions apply only to /usr/bin/apid, compare the entire extracted literal, and require same-host/path-family mutation and other-binary negatives. They do not skip an ELF section or an asset.

| Exact literal | Embedded producer | Reason |
|---|---|---|
| `https://react.i18next.com/latest/usetranslation-hook` | `assets/i18n-9iKEIePr.js`; APID offsets 7607214 | Suspense error help link |
| `https://tailwindcss.com` | `assets/index-7L3HmK3H.css`; APID offsets 7607585 | CSS license banner |
| `http://www.w3.org/2000/svg` | `assets/panel-BYX239aH.js`, `assets/react-BicOiEU0.js`; APID offsets 7886955,8003221,8003380,8017971,8060662,8072675 | SVG createElementNS and icon xmlns namespace |
| `https://react.dev/errors/` | `assets/react-BicOiEU0.js`; APID offsets 7907670,7911160 | React error-message URL prefix |
| `http://www.w3.org/1998/Math/MathML` | `assets/react-BicOiEU0.js`; APID offsets 8003286,8003449,8060704 | MathML createElementNS namespace |
| `http://www.w3.org/1999/xlink` | `assets/react-BicOiEU0.js`; APID offsets 8051490,8052807,8052887,8052964,8053038,8053113,8053188 | setAttributeNS namespace |
| `http://www.w3.org/XML/1998/namespace` | `assets/react-BicOiEU0.js`; APID offsets 8053260,8053338,8053417 | XML attribute namespace |
| `http://localhost` | `assets/router-CEPdftVX.js`; APID offsets 8112833 | Router origin fallback for local URL construction |
| `https://base-ui.com/production-error` | `assets/ui-primitives-DIySaKBw.js`; APID offsets 8284618 | UI error-message help link |

Verified producer asset SHA256 identities:

- `assets/i18n-9iKEIePr.js`: `9e9260712ce4b21f0d9cda01da17163df72cb54a748da07d39694a5d3b71dd87`.
- `assets/index-7L3HmK3H.css`: `c7c7cc29bf14f3e43f970e6c719c58bc6509104a8750372916170c76f023c857`.
- `assets/panel-BYX239aH.js`: `0a5b9e56d6180ecdcc8a510194ddb88bca627ae25cadf388af0af51cc77e65bf`.
- `assets/react-BicOiEU0.js`: `28d738722b3dfe10d0d7545435bf07159ea3c47f21c826ad949450de1391e783`.
- `assets/router-CEPdftVX.js`: `7a0e2e78ad2ece55ef57ce0dc41023781a6e204afcdc26a687333838328c18f7`.
- `assets/ui-primitives-DIySaKBw.js`: `a08f25b8d387948a282e81a18b4b03a60382b4d0a86812c4a971bdfcc935cbd9`.

The remaining native diagnostic/specification links need exact locked dependency source attribution. Their observed adjacent Rust string bytes are not silently treated as URL suffixes from source, and no domain-level exception is authorized. The two observed APID bare https:// fragments followed by invalid UTF-8 are not complete network authorities; valid endpoint bytes before or after invalid binary bytes must still be detected.

## Exact locked runtime diagnostic attribution

The read-only dependency handoff /tmp/bkd-58sdocnk-D4-dependency-source-evidence.json has SHA256 8d937c8c0f17e626926bb450204586f71ca25105296ef312c2b045cdebe8ca24. Verified the seven exact crate archives against package checksums in Git 5d0dca577a782aa707d9530779c4b23f2a7eda31 and current reviewed L2 0a8aa6e840bf455fd8cb088ab1e205b9f0e1e6f0. Relevant lock blocks are unchanged in their respective workspaces. Compared all eleven selected runtime source files byte-for-byte with archive members. The extracted registry has no .cargo-checksum.json; archive SHA256 plus exact member equality is the evidence. No download, build, cache mutation, private-key read, or third-party executable scan occurred.

The exact registry root is /srv/mos/tmp/s905x5m-current/source/_out/cargo/registry. The manifest records each full archive path, source path/hash, Git lock identity, and line context. Checked archive identities:

| Crate | Archive SHA256 | Runtime source |
|---|---|---|
| clap-4.6.6 | `473c7e07f409a8d772161724aa8db6a765a2532a70f9667eeb7b49d3d02fbdca` | Lock/archive identity control; no runtime literal exemption |
| clap_builder-4.6.6 | `7b48fea5a88e9ae728a2dcbedbfc0e730f7d60da42e1cb049a83c9fb8b789889` | `clap_builder-4.6.6/src/lib.rs:49` |
| getrandom-0.2.17 | `ff2abc00be7fca6ebc474524697ae276ad847ad0a6b3faa4bcb027e9a4614ad0` | `getrandom-0.2.17/src/error.rs:174` |
| getrandom-0.4.3 | `300e883d756b2e4ec94e02791f39b04b522276138852cfc41d9fb7e904106099` | Lock/archive identity control; no runtime literal exemption |
| rustls-0.23.43 | `0283386ce02abc0151e1761d08802dfe86c173b0b494af5cbc086574e453da06` | `rustls-0.23.43/src/conn.rs:303` |
| zbus-5.19.0 | `5db4be7c075cb421e4b7ee645541604239bd243ba7c357511f4ff3a74b555907` | `zbus-5.19.0/src/address/mod.rs:158`, `zbus-5.19.0/src/object_server/node.rs:174` |
| zbus_names-4.3.4 | `d8bf88b4a3ff53e883001e0e0115b297a9d53c31b9c1edd2bfdd853e3428624e` | `zbus_names-4.3.4/src/member_name.rs:48`, `zbus_names-4.3.4/src/interface_name.rs:50`, `zbus_names-4.3.4/src/bus_name.rs:549`, `zbus_names-4.3.4/src/error_name.rs:53`, `zbus_names-4.3.4/src/unique_name.rs:47`, `zbus_names-4.3.4/src/well_known_name.rs:48` |

D-Bus links occur in validation error messages or the emitted introspection XML DOCTYPE, not a service connection. Rustls links from its unexpected-EOF error; getrandom 0.2.17 links from NODE_ES_MODULE; clap_builder 4.6.6 links from INTERNAL_ERROR_MSG. Neither clap's docs-only link nor getrandom 0.4.3 is substituted for the compiled runtime producer.

The span proof /tmp/wja3bzl2-native-diagnostic-spans.json (SHA256 e02299afe01129bc4fcbe83c9ed539d6044b25916ce1fc07345ef302ff2508e2) compares every complete source diagnostic with actual sample bytes and separates its URL interval from adjacent Rust string storage. Offsets below are decimal half-open byte intervals in the exact handed-off binaries; they are evidence only, never scanner skip ranges. The implementation keeps whole-token equality and compares complete source/following text. It scans subsequent URLs independently, including URLs occurring within that following text. Unknown layouts fail closed.

| Binary | Source diagnostic | URL byte intervals |
|---|---|---|
| `/usr/bin/mosd` | Invalid address. See | 5568377..5568443 |
| `/usr/bin/mosd` | Invalid member name. See | 5591871..5591957 |
| `/usr/bin/mosd` | Invalid interface name. See | 5591985..5592074 |
| `/usr/bin/mosd` | Invalid well-known name. See | 5592103..5592186 |
| `/usr/bin/mosd` | Invalid error name. See | 5592210..5592295 |
| `/usr/bin/mosd` | Invalid unique name. See | 5592340..5592423 |
| `/usr/bin/mosd` | Invalid bus name. See | 5592507..5592590 |
| `/usr/bin/apid` | peer closed connection without sending TLS close_notify: | 8663701..8663780 |
| `/usr/bin/apid` | Invalid address. See | 8872345..8872411 |
| `/usr/bin/apid` | Invalid member name. See | 8894725..8894811 |
| `/usr/bin/apid` | Invalid interface name. See | 8894839..8894928 |
| `/usr/bin/apid` | Invalid error name. See | 8894952..8895037 |
| `/usr/bin/apid` | Invalid unique name. See | 8895082..8895165 |
| `/usr/bin/apid` | Invalid bus name. See | 8895249..8895332 |
| `/usr/bin/apid` | Node.js ES modules are not directly supported, see | 8898835..8898885 |
| `/usr/bin/mos-deploy` | Fatal internal error. Please consider filing a bug report at | 1349722..1349760, 1501900..1501938, 1495384..1495422, 1499941..1499979, 1502473..1502511, 1495573..1495611, 1503297..1503335 |
| `/usr/bin/mosd` | Exact quoted introspection DTD | 5584592..5584652 |
| `/usr/bin/apid` | Exact quoted introspection DTD | 8888502..8888562 |

Following text is independently observed data, not URL suffix attribution. It is limited to the exact contexts embedded in the two verifier files: `mid > len`; the next complete D-Bus diagnostic (with the observed `org.freedesktop.DBus` or name-debug labels where present); `internal error: entered unreachable code`; `Errorinternal_codedescriptionunknown_code` followed by NUL; and the exact Display error text with `a` or `falseTryFromIntErrora` prefixes. The signed sample has 22 diagnostic occurrences and 19 distinct binary/message/context fixtures. The URL itself may also be naturally delimited after its complete source diagnostic. No URL-only diagnostic exemption or known-prefix match is used.

Controls cover exact positives, same-family URL mutations, unknown suffixes, truncated adjacent tokens, removal of source diagnostics, wrong binary attribution, and immediately adjacent injected endpoints. XML/UI literals retain exact positives and changed-neighbor negatives. The review-discovered context defect reproduced as 254 pass / 17 fail after successful typechecking; the final focused run passes 271 tests / 913 assertions. Full verifier acceptance is 911 tests / 7474 assertions. The same committed ROOT_CHECKS entry passes the rehashed original sample, and none of this establishes current candidate or physical-board acceptance.
