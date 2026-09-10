# 20260910-1050-c-native-endpoint-verification Verify native binaries contain no default update endpoints

- **status**: in_progress
- **priority**: P1
- **owner**: worker-c/wja3bzl2
- **createdAt**: 2026-09-10 10:50

## Description

Implement PLAN-070 F8 and RFCT-315 F8 through the packed-root ROOT_CHECKS registry. Require and scan only /usr/bin/mosd, /usr/bin/apid, and /usr/bin/mos-deploy as nonempty regular non-symlink ELF inputs; refuse compiled update/fleet endpoint literals and unsafe inputs. Report examined paths, file count, and byte count. Configured URLs remain outside this scan.

## ActiveForm

Verifying current native binaries for compiled update and fleet endpoints.

## Dependencies

- **blocked by**: 20260910-1050-c-packed-public-meta-validation (reviewed C.D3, released through local L2 9f773a9cb1ad1bd882e2f11784288aea4a9e262f)
- **blocks**: (none)

## Notes

- Campaign: mos-open-plans-20260910-100408; node C.D4; BKD issue wja3bzl2; integration owner L2 58sdocnk.
- Full-tier implementation was explicitly approved by the campaign dependency release; no repeated proposal gate is needed.
- Started from clean bkd/wja3bzl2 at 5d0dca577a782aa707d9530779c4b23f2a7eda31 and fast-forward merged exact local L2 9f773a9cb1ad1bd882e2f11784288aea4a9e262f (tree e267aaec1fea2fc96e71c6589aaf4075c64a7381).
- Verified ancestors: approved source 5d0dca577a782aa707d9530779c4b23f2a7eda31; C1 0f9b4e7e0e25c0ffad151db793a72479f55f96a0 and fa51970ca32c2a7d16f809134e78d249c0a1f897; C.D2 e30aebf2086c41f4b3c255de95f74ffb52fa2c62 and 7319e2ecb305f3311601f2dd44cd47ce5a4a913f; C.D3 5389d6517d6519416590c0af9cdef506ce6a20c0, 2a547e7c039b5320e7ad92e6ead8736fb6d07e54, and f30e2492a4f4a0d29f91f13d02abbcc2f92c093a.
- C1 historical evidence baseline remains 5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d. Existing development artifact equivalence is not a fresh build or hardware qualification.
- Exact immutable packed-root inputs and source identities have been requested from L2; no artifact path is inferred and no image build is authorized.

- RED gate launched in persistent-shell tmux wja3bzl2-a69735: `timeout 240s bash verify/run.sh src/checks-file-root.test.ts`; source commit 9f773a9cb1ad1bd882e2f11784288aea4a9e262f; source/test diff SHA256 1665c0b7cedb5fbc550d6e0f029153b2ac819efea897c0df08b4771b11f7d4c2; startedAt 2026-09-10T20:38:14.560235+00:00; PID 1478392; output /tmp/wja3bzl2-native-red.log; metadata /tmp/wja3bzl2-native-red.json. The initial launch was pending; its terminal setup failure is recorded below.

- Initial test setup exited 2 at 2026-09-10T20:38:16.494409+00:00: `src/checks-file-root.test.ts(406,11): error TS2769: No overload matches this call.` The readonly string tuple did not match test.each; the remaining TS2345 path errors followed from unknown inference. This is compilation/setup evidence, not behavioral RED. Corrected only the new table to an ordinary string array. A registry-only placeholder now returns pass without scanning, so the endpoint and unsafe-input fixtures can demonstrate actual missing behavior with verdict assertions before implementation.

- Behavioral RED: `timeout 240s bash verify/run.sh src/checks-file-root.test.ts` passed typecheck and exited 1, with the existing 63 tests passing and 35 new tests failing / 212 assertions. The registry-only placeholder returned pass for endpoint-bearing and unsafe inputs; the endpoint assertions expected fail and received pass. Source 9f773a9cb1ad1bd882e2f11784288aea4a9e262f; diff SHA256 65c046c58b1c1131338ac23d37022c984f8eaac0a4552001ac538117acdc2d93; startedAt 2026-09-10T20:43:00.356792+00:00; PID 1491160 / runner 1491152; exitCode 1 at 2026-09-10T20:43:02.266969+00:00; metadata /tmp/wja3bzl2-native-red2.json; output /tmp/wja3bzl2-native-red2.log.

- Initial GREEN: `timeout 240s bash verify/run.sh src/checks-file-root.test.ts` passed 98 tests / 298 assertions, exitCode 0; source 9f773a9cb1ad1bd882e2f11784288aea4a9e262f; diff SHA256 04e11eddb6d8726554af935ac2a23b26e1eb79fcd0df6a0ab7b4e2ddbb9146ee; startedAt 2026-09-10T20:44:29.347654+00:00; PID 1491587 / runner 1491579; finishedAt 2026-09-10T20:44:31.299879+00:00; metadata /tmp/wja3bzl2-native-green.json; output /tmp/wja3bzl2-native-green.log.

- Focused GREEN with ELF header and authority boundary coverage: `timeout 240s bash verify/run.sh src/checks-file-root.test.ts` passed 109 tests / 330 assertions, exitCode 0; source 9f773a9cb1ad1bd882e2f11784288aea4a9e262f; diff SHA256 6f426440becb22c6d5a7c8bb4579beeca4f13454083594a104f78e439064b57a; startedAt 2026-09-10T20:45:57.973236+00:00; PID 1492176 / runner 1492168; finishedAt 2026-09-10T20:45:59.891435+00:00; metadata /tmp/wja3bzl2-native-green2.json; output /tmp/wja3bzl2-native-green2.log.

- Relevant verifier suite including typecheck: `timeout 300s make os-verify-test` passed 749 tests / 6891 assertions, exitCode 0; source 9f773a9cb1ad1bd882e2f11784288aea4a9e262f; diff SHA256 6f426440becb22c6d5a7c8bb4579beeca4f13454083594a104f78e439064b57a; startedAt 2026-09-10T20:46:23.222546+00:00; PID 1492347 / runner 1492337; finishedAt 2026-09-10T20:46:30.426515+00:00; metadata /tmp/wja3bzl2-native-suite.json; output /tmp/wja3bzl2-native-suite.log.

- PMA-CR core and TypeScript backend review of the actual two-file diff: PASS, zero high-confidence findings. The diff adds only the native ROOT_CHECKS entry and its tests, preserves all C.D3 and unrelated checks, refuses root/parent/leaf symlinks and special files before binary reads, validates ELF headers before counting bytes, and reports no binary contents. No endpoint exclusions are implemented. Actual packed-input and embedded-namespace classification acceptance remains pending exact immutable source/artifact evidence from L2; fixture acceptance alone does not establish those facts.

- Concrete missing integration row: immutable current packed/unpacked-root absolute path, source commit or reviewed content-equivalence mapping, and content hashes for /usr/bin/mosd, /usr/bin/apid, and /usr/bin/mos-deploy. The request was forwarded by L2 to L1 as message 01M26GMEBR2C3Y6RRKDD5VJ01F. No guessed or historical binary was scanned. Any non-endpoint full URL exemption still requires exact binary/embedded-source evidence and a same-family negative test. Task completion remains pending this input classification; no hardware or new build acceptance is claimed.

- Verifier source commit: 197e1e53f92e525f6284dc262698733d21c9f679, containing only the two verifier paths. Its bytes equal the focused/full-suite tested diff SHA256 6f426440becb22c6d5a7c8bb4579beeca4f13454083594a104f78e439064b57a over 9f773a9cb1ad1bd882e2f11784288aea4a9e262f.

- Documentation gate: `timeout 180s make docs-verify` passed all five groups (exitCode 0); source 197e1e53f92e525f6284dc262698733d21c9f679; no source diff; startedAt 2026-09-10T20:48:05.416108+00:00; PID 1500905 / runner 1500897; finishedAt 2026-09-10T20:48:07.127375+00:00; metadata /tmp/wja3bzl2-native-docs.json; output /tmp/wja3bzl2-native-docs.log.

- English history note for L2 D: Added a packed-root check requiring all three current native ELF binaries and rejecting compiled network endpoint literals with nonzero path/file/byte evidence. Focused fixtures and the verifier suite pass; current immutable packed-artifact and exact non-endpoint classification acceptance remains pending.

- At a clean committed boundary, merged exact reviewed local L2 0a8aa6e840bf455fd8cb088ab1e205b9f0e1e6f0 (tree ce2f09a76b63c4a5cc895102aea5da3136aa462c) as 3d6e55e38db3789b88ec5642bdd593aab8208d10. Only own index-row additions conflicted; every upstream row was preserved byte-for-byte and the own row appended. Both verifier blobs equal source commit 197e1e53f92e525f6284dc262698733d21c9f679. The approved offline fleet desired projection is now present through this merge only; it activates no endpoint or network service and supplies no new native binary evidence.

- Committed post-merge focused verification: `timeout 240s bash verify/run.sh src/checks-file-root.test.ts` passed (109 tests / 330 assertions); source ba2e0f5592017a54b5d447031facdfec81a7c33b; no source diff; startedAt 2026-09-10T20:49:53.308891+00:00; PID 1505063 / runner 1505055; finishedAt 2026-09-10T20:49:55.325774+00:00; exitCode 0; metadata /tmp/wja3bzl2-postmerge-focused.json; output /tmp/wja3bzl2-postmerge-focused.log.

- Committed post-merge documentation verification: `timeout 180s make docs-verify` passed (195 index / 509 links / 724 status / 249 translation / 131 board assertions); source ba2e0f5592017a54b5d447031facdfec81a7c33b; no source diff; startedAt 2026-09-10T20:50:05.749197+00:00; PID 1505727 / runner 1505719; finishedAt 2026-09-10T20:50:07.637841+00:00; exitCode 0; metadata /tmp/wja3bzl2-postmerge-docs.json; output /tmp/wja3bzl2-postmerge-docs.log.

- Committed scoped whitespace verification: `timeout 20s git diff --check 0a8aa6e840bf455fd8cb088ab1e205b9f0e1e6f0 HEAD -- verify/src/checks-file-root.ts verify/src/checks-file-root.test.ts docs/task/20260910-1050-c-native-endpoint-verification.md docs/plan/20260910-1050-c-native-endpoint-verification.md docs/task/index.md docs/plan/index.md` passed (no whitespace errors); source ba2e0f5592017a54b5d447031facdfec81a7c33b; no source diff; startedAt 2026-09-10T20:50:07.681347+00:00; PID 1507957 / runner 1507950; finishedAt 2026-09-10T20:50:07.686182+00:00; exitCode 0; metadata /tmp/wja3bzl2-scoped-diff-check.json; output /tmp/wja3bzl2-scoped-diff-check.log.

- Handoff status is partial: all authorized fixture, verifier, documentation, and whitespace gates pass, and the worktree is committed. Do not mark F8 or this task complete until immutable current native input classification is collected. No background gate remains running, no Docker resource was created, and no full-image or physical-board claim is made.


## Exact sample attribution progress

The L1 sample handoff supersedes the earlier wait for final current-C roots: this task must finish against the original #313 signed S905X5M development sample, while A4/B7 own later final candidates. It preserves source-content-equivalent 5d0dca577a782aa707d9530779c4b23f2a7eda31/tree a8b079edc67010b6662b2243a5647950eb7176ef and dirty build identities; it is not hardware-qualified. Rehashed both delivered manifests, source mapping, packed root, root descriptor, and all three regular 0755 ELF inputs exactly as supplied. All three files total 19,824,184 bytes. No retained path outside those three was read as image evidence, and no binary was executed.

The plan records nine exact APID-only non-endpoint literals, producer hashes, and offsets. Each required compiler input was rehashed, compared to original dist, and compared as a whole sequence at its attested APID offset. Current UI source is unchanged from Git 5d0dca57. Each exclusion has an exact positive, a same-host/path-family endpoint negative, and negatives in mosd/mos-deploy. Invalid UTF-8 cannot supply a missing authority or truncate a longer candidate into an exact exemption.

- Initial actual ROOT_CHECKS scan: fail in all three files; 3 files / 19824184 bytes; `timeout 60s bun /tmp/wja3bzl2-sample-scan.ts`; source c6001ed5a3c68d793464dddd1820e8c94489c6c5; diff SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; startedAt 2026-09-10T20:53:11.957705+00:00; PID 1508583 / runner 1508575; finishedAt 2026-09-10T20:53:12.088800+00:00; exitCode 1; metadata /tmp/wja3bzl2-sample-initial.json; output /tmp/wja3bzl2-sample-initial.log.

- Embedded UI and bare-scheme behavioral RED: 127 pass / 10 fail / 421 assertions; `timeout 240s bash verify/run.sh src/checks-file-root.test.ts`; source c6001ed5a3c68d793464dddd1820e8c94489c6c5; diff SHA256 9051d5a51c061f029aedb704186934a7bf5936c655a6cc35605671f3093a32a2; startedAt 2026-09-10T20:57:00.292951+00:00; PID 1513121 / runner 1513071; finishedAt 2026-09-10T20:57:02.532187+00:00; exitCode 1; metadata /tmp/wja3bzl2-ui-literals-red.json; output /tmp/wja3bzl2-ui-literals-red.log.

- Embedded UI GREEN: 137 pass / 0 fail / 424 assertions; `timeout 240s bash verify/run.sh src/checks-file-root.test.ts`; source c6001ed5a3c68d793464dddd1820e8c94489c6c5; diff SHA256 a0fde47e1ae0cb2f74ab976e19838dc130e4293864733d89fbd22cfd05c3a103; startedAt 2026-09-10T20:57:45.863498+00:00; PID 1513360 / runner 1513352; finishedAt 2026-09-10T20:57:47.806592+00:00; exitCode 0; metadata /tmp/wja3bzl2-ui-literals-green.json; output /tmp/wja3bzl2-ui-literals-green.log.

- Review-discovered UTF-8 truncation behavioral RED: 137 pass / 1 fail / 425 assertions; `timeout 240s bash verify/run.sh src/checks-file-root.test.ts`; source c6001ed5a3c68d793464dddd1820e8c94489c6c5; diff SHA256 fd643a42b777e57f596b3ec7a1747a34a32f9caea6e9033fecde5d4038668cab; startedAt 2026-09-10T20:58:46.255621+00:00; PID 1513789 / runner 1513781; finishedAt 2026-09-10T20:58:48.136846+00:00; exitCode 1; metadata /tmp/wja3bzl2-utf8-boundary-red.json; output /tmp/wja3bzl2-utf8-boundary-red.log.

- UTF-8 boundary GREEN: 138 pass / 0 fail / 430 assertions; `timeout 240s bash verify/run.sh src/checks-file-root.test.ts`; source c6001ed5a3c68d793464dddd1820e8c94489c6c5; diff SHA256 3baf18c62487f9dda62fb2ae715531f104a45c5562e4b3f31a6323a4dcbdd74b; startedAt 2026-09-10T20:59:03.448944+00:00; PID 1513914 / runner 1513904; finishedAt 2026-09-10T20:59:05.240449+00:00; exitCode 0; metadata /tmp/wja3bzl2-utf8-boundary-green.json; output /tmp/wja3bzl2-utf8-boundary-green.log.

- Actual sample with exact UI attribution: fail in all three files; 3 files / 19824184 bytes; non-UI dependency literals remain unclassified; `timeout 60s bun /tmp/wja3bzl2-sample-scan.ts`; source c6001ed5a3c68d793464dddd1820e8c94489c6c5; diff SHA256 3baf18c62487f9dda62fb2ae715531f104a45c5562e4b3f31a6323a4dcbdd74b; startedAt 2026-09-10T21:00:08.100939+00:00; PID 1514259 / runner 1514250; finishedAt 2026-09-10T21:00:08.342638+00:00; exitCode 1; metadata /tmp/wja3bzl2-sample-ui.json; output /tmp/wja3bzl2-sample-ui.log.

- Relevant full verifier suite: 778 pass / 0 fail / 6991 assertions and typecheck; `timeout 300s make os-verify-test`; source c6001ed5a3c68d793464dddd1820e8c94489c6c5; diff SHA256 3baf18c62487f9dda62fb2ae715531f104a45c5562e4b3f31a6323a4dcbdd74b; startedAt 2026-09-10T21:00:08.385465+00:00; PID 1514288 / runner 1514282; finishedAt 2026-09-10T21:00:14.619916+00:00; exitCode 0; metadata /tmp/wja3bzl2-ui-suite.json; output /tmp/wja3bzl2-ui-suite.log.

- PMA-CR core/TypeScript backend review found and fixed the UTF-8 candidate-truncation bypass before commit, with meaningful RED/GREEN. Final scoped review of this change is PASS with zero remaining high-confidence implementation findings; actual sample acceptance is still fail, not promoted from fixtures.
- Remaining exact input defect: current locked source/version/checksum attribution for the zbus/zbus_names, rustls, getrandom, and clap diagnostic/specification literals. The guarded request is retained at /tmp/wja3bzl2-dependency-source-request.json with a successful response. Only package blocks and the exact literal-producing source files were requested; no broad registry/package scan or new binary input is authorized. Observed non-UI raw byte runs are recorded at /tmp/wja3bzl2-sample-literal-attribution.json. Do not guess their Rust concatenation boundaries or add blanket domain exemptions.

- Exact UI attribution/source commit: 8c365a656a1a73afd5b08ab693c16471843a7891. The test/code diff over c6001ed5 matches the full-suite tested SHA256 3baf18c62487f9dda62fb2ae715531f104a45c5562e4b3f31a6323a4dcbdd74b.

- Committed-source real sample scan remains fail (3 files / 19824184 bytes): `timeout 60s bun /tmp/wja3bzl2-sample-scan.ts`; source 8c365a656a1a73afd5b08ab693c16471843a7891; clean verifier source; startedAt 2026-09-10T21:01:55.654158+00:00; PID 1514904 / runner 1514896; finishedAt 2026-09-10T21:01:55.901249+00:00; exitCode 1; metadata /tmp/wja3bzl2-sample-ui-committed.json; output /tmp/wja3bzl2-sample-ui-committed.log.

- Documentation gate passed all five groups: `timeout 180s make docs-verify`; source 8c365a656a1a73afd5b08ab693c16471843a7891; clean verifier source; startedAt 2026-09-10T21:01:55.944314+00:00; PID 1514934 / runner 1514928; finishedAt 2026-09-10T21:01:57.684947+00:00; exitCode 0; metadata /tmp/wja3bzl2-ui-docs.json; output /tmp/wja3bzl2-ui-docs.log.

- Read-only sample driver /tmp/wja3bzl2-sample-scan.ts SHA256 a62c6a6f231baf81b2d5a2c9c5bbddbd0b8d33fd833b9631f07ff5caf6a02f97. It rechecks the exact three ELF hashes before invoking the real ROOT_CHECKS entry and reports original source/dirty identity and input hashes.

- English history note for L2 D: Attributed nine exact APID embedded UI literals to immutable compiler assets, added per-binary and neighboring-endpoint controls, and fixed a UTF-8 truncation bypass. The original signed S905X5M development sample was scanned through ROOT_CHECKS; remaining native dependency literals fail closed pending exact locked-source attribution.
