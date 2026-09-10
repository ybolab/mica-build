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
