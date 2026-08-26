# RFCT-153 PLAN-015 M6: form compression in test/, mosd/ (incl. apid) and board/

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-26 18:20
- **claimedAt**: 2026-08-26 18:20
- **completedAt**: 2026-08-26 21:40
- **plan**: PLAN-015 (M6)

PLAN-015 M6's four form rules applied to 38 source files: multi-word ALL-CAPS
emphasis sentence-cased, decorative banner separators deleted, contiguous
comment blocks compressed toward the <= 8-line target, and the MUST-KEEP list
held binding throughout. No executable line, string literal or code-line
whitespace changed anywhere; that is proved per file rather than asserted.

The task was dispatched as RFCT-143 and renumbered to RFCT-153 mid-run
(RFCT-143..149 were consumed by the concurrent docs workstream). No file named
`docs/task/RFCT-14*.md` was ever created on this branch.

## Scope

The 36 files of the dispatch list, plus two added mid-task by L2:

- `mosd/apid/src/startup.rs` — added for one stale-fact correction only
  (lines 44-48). Its 32-line module header is deliberately **not** compressed:
  the addition was scoped to the fix.
- `board/common/mos-required.fragment` — added for the stale Talos/machined
  claims in its two comment blocks.

Counts are `caps` (runs of 3+ consecutive ALL-CAPS words on a comment line),
`banners` (comment lines carrying 20+ of one repeated character), `15+ blocks`
(contiguous comment blocks of 15 or more lines) and `longest` (longest
contiguous comment block), measured with the milestone's metric script. Before
is main at `63c11cf`; after is this branch.

| file | caps b/a | banners b/a (a: rule-2 / indent) | 15+ blocks b/a | longest b/a |
| --- | --- | --- | --- | --- |
| `test/apid-api/src/phases/05-mutate.ts` | 10 -> 0 | 21 -> 0 (0/0) | 5 -> 0 | 33 -> 14 |
| `test/apid-api/src/phases/04-readonly.ts` | 0 -> 0 | 26 -> 0 (0/0) | 4 -> 0 | 47 -> 14 |
| `test/apid-api/run.sh` | 3 -> 0 | 11 -> 11 (11/0) | 4 -> 0 | 48 -> 14 |
| `mosd/mosd/src/reconciler/sshd.rs` | 0 -> 0 | 15 -> 15 (12/3) | 4 -> 2 | 34 -> 26 |
| `mosd/mosd/src/reconciler/mqtt.rs` | 0 -> 0 | 0 -> 0 (0/0) | 7 -> 2 | 32 -> 16 |
| `test/apid-api/src/phases/07-reboot.ts` | 2 -> 0 | 12 -> 2 (2/0) | 3 -> 2 | 28 -> 20 |
| `mosd/mosd/src/reconciler/wifi_ap.rs` | 0 -> 0 | 10 -> 10 (10/0) | 4 -> 2 | 28 -> 25 |
| `mosd/hack/dbus-policy-test.sh` | 0 -> 0 | 8 -> 8 (8/0) | 4 -> 4 | 31 -> 25 |
| `mosd/apid/src/routes.rs` | 0 -> 0 | 5 -> 5 (0/5) | 4 -> 3 | 31 -> 25 |
| `test/apid-api/src/phases/03-login.ts` | 4 -> 0 | 9 -> 7 (7/0) | 1 -> 0 | 32 -> 14 |
| `test/apid-api/src/client.ts` | 0 -> 0 | 17 -> 1 (1/0) | 1 -> 1 | 24 -> 16 |
| `test/apid-api/src/phases/02-setup.ts` | 2 -> 0 | 11 -> 9 (9/0) | 1 -> 0 | 15 -> 14 |
| `test/apid-api/src/selftest.ts` | 1 -> 0 | 11 -> 5 (5/0) | 1 -> 0 | 24 -> 14 |
| `mosd/mosd/src/reconciler/wifi_client.rs` | 0 -> 0 | 7 -> 7 (7/0) | 2 -> 2 | 22 -> 19 |
| `mosd/mosd/src/provisioning.rs` | 0 -> 0 | 0 -> 0 (0/0) | 3 -> 2 | 32 -> 27 |
| `mosd/mosd-settings/src/migration.rs` | 0 -> 0 | 0 -> 0 (0/0) | 3 -> 1 | 19 -> 17 |
| `mosd/apid/src/tests/broken_classes.rs` | 0 -> 0 | 0 -> 0 (0/0) | 3 -> 3 | 37 -> 31 |
| `mosd/apid/src/auth.rs` | 0 -> 0 | 0 -> 0 (0/0) | 3 -> 3 | 29 -> 24 |
| `test/apid-api/src/phases/06-backoff.ts` | 0 -> 0 | 4 -> 4 (4/0) | 2 -> 0 | 21 -> 14 |
| `mosd/mosd/src/transient.rs` | 0 -> 0 | 4 -> 4 (4/0) | 2 -> 2 | 26 -> 20 |
| `mosd/mosd/src/main.rs` | 2 -> 0 | 0 -> 0 (0/0) | 2 -> 1 | 31 -> 27 |
| `board/cx3576/uboot/Dockerfile` | 2 -> 0 | 0 -> 0 (0/0) | 2 -> 0 | 22 -> 14 |
| `test/apid-api/src/phases/07b-postreboot.ts` | 1 -> 0 | 5 -> 5 (5/0) | 1 -> 1 | 32 -> 15 |
| `test/apid-api/src/console.ts` | 1 -> 0 | 5 -> 1 (1/0) | 1 -> 0 | 35 -> 12 |
| `mosd/mosd/src/reconciler/container.rs` | 2 -> 0 | 3 -> 0 (0/0) | 1 -> 1 | 26 -> 20 |
| `mosd/mosd-settings/src/authorized_key.rs` | 0 -> 0 | 6 -> 6 (6/0) | 1 -> 1 | 17 -> 15 |
| `mosd/mqttd/src/bridge.rs` | 0 -> 0 | 0 -> 0 (0/0) | 2 -> 1 | 25 -> 18 |
| `mosd/mosd/src/tree.rs` | 0 -> 0 | 0 -> 0 (0/0) | 2 -> 2 | 21 -> 16 |
| `mosd/mosd/src/reconciler/systemd.rs` | 0 -> 0 | 0 -> 0 (0/0) | 2 -> 1 | 23 -> 18 |
| `mosd/mosd/src/identity.rs` | 0 -> 0 | 0 -> 0 (0/0) | 2 -> 1 | 30 -> 20 |
| `mosd/mosd-settings/src/model.rs` | 0 -> 0 | 0 -> 0 (0/0) | 2 -> 1 | 22 -> 18 |
| `mosd/hack/build-target.sh` | 0 -> 0 | 0 -> 0 (0/0) | 2 -> 0 | 22 -> 14 |
| `mosd/busname/src/lib.rs` | 0 -> 0 | 0 -> 0 (0/0) | 2 -> 2 | 57 -> 44 |
| `mosd/apid/src/assets/serve.rs` | 0 -> 0 | 0 -> 0 (0/0) | 2 -> 2 | 28 -> 23 |
| `test/apid-api/src/phases/01-transport.ts` | 0 -> 0 | 4 -> 2 (2/0) | 1 -> 0 | 15 -> 13 |
| `board/cx3576/kernel/Dockerfile` | 2 -> 0 | 0 -> 0 (0/0) | 1 -> 0 | 15 -> 11 |
| `mosd/apid/src/startup.rs` (added mid-task) | - -> 0 | - -> 0 (0/0) | - -> 1 | - -> 32 |
| `board/common/mos-required.fragment` (added mid-task) | - -> 0 | - -> 0 (0/0) | - -> 0 | - -> 6 |
| **total (36 originally in scope + 2 added)** | **32 -> 0** | **194 -> 102 (94/8)** | **87 -> 44** | |

Every surviving banner line is one of two things, and neither is a decorative
separator — see "Banner survivors" below.

## The comment-only proof

Every hunk in all 38 files touches only comments. Comments are stripped from the
merge-base blob and from the working file, blank lines dropped, and the two
compared. `BASE` is `b55b9df`, the merge base of this branch with `main`.

```bash
BASE=$(git merge-base HEAD main)
while read -r f; do
  diff -u <(git show "$BASE:$f" | python3 "$S/strip.py" "$f") \
          <(python3 "$S/strip.py" "$f" < "$f") >/dev/null \
    || echo "DIFFERS: $f"
done < "$S/scope.txt"
```

Output over all 38 files:

```
(no output)
```

### The stripper had to be repaired first, and the repair is the reason the proof means anything

The multi-file stripper supplied with the dispatch is **not** a correct lexer for
this tree. Run unmodified it reports a false `DIFFERS` on one file and silently
mis-strips eight others. Three defects, each found by driving it rather than by
reading it:

1. **TypeScript block comments do not nest.** The supplied version counts nested
   `/*` while scanning a block comment. The token `` `text/*` `` inside
   `04-readonly.ts`'s module doc opens a phantom nesting level, so the comment is
   never closed at its real `*/` and the scan runs on until it finds `*/` inside
   the string literal `"... and */* is refused by condition 3"` — swallowing 46
   lines of real code at the base and none on the branch. That is a fabricated
   `DIFFERS` on a comment-only change. Fixed by not nesting for `.ts` (JS/TS
   block comments genuinely do not nest); Rust, where they do, is unchanged.
2. **No regex-literal handling for TypeScript.** `.replace(/&#x27;/gi, "'")` in
   `05-mutate.ts` — the `'` inside the regex opens a phantom string and the scan
   desynchronises for the rest of the file, leaving comments in the "stripped"
   output. Fixed with the standard "a `/` starts a regex only where a value may
   begin" heuristic, decided from the last significant character emitted.
3. **Rust lifetimes read as char literals.** The supplied version treats `'` in
   Rust as a quote, so `type ItemAttrs = HashMap<String, Value<'static>>;` in
   `tree.rs` opens a literal that runs to the next `'` and swallows the code
   between. RFCT-120's single-file stripper had explicit lifetime handling; the
   multi-file version had dropped it. Restored verbatim from RFCT-120.

The repaired stripper is at `$S/strip.py`. It is validated two ways, and both
are shown because a stripper that silently emits comments proves nothing:

**Residual-comment self-check.** Strip every one of the 38 files *at the merge
base* and assert no comment line survives:

```bash
BASE=$(git merge-base HEAD main)
while read -r f; do
  git show "$BASE:$f" > "$S/t.src"
  case "$f" in
    *.rs) pat='^\s*(//|/\*)' ;;
    *.ts) pat='^\s*(//|/\*|\* )' ;;
    *)    pat='^\s*#' ;;
  esac
  bad=$(python3 "$S/strip.py" "$f" < "$S/t.src" | grep -cE "$pat" || true)
  [ "$bad" != "0" ] && echo "RESIDUAL($bad): $f"
done < "$S/scope.txt"
```

Output: empty. Before the three repairs the same loop reported

```
RESIDUAL(1): mosd/mosd/src/reconciler/wifi_ap.rs
RESIDUAL(84): mosd/apid/src/routes.rs
RESIDUAL(8): mosd/mosd/src/reconciler/wifi_client.rs
RESIDUAL(17): mosd/mosd-settings/src/migration.rs
RESIDUAL(34): mosd/apid/src/tests/broken_classes.rs
RESIDUAL(94): mosd/mosd/src/tree.rs
RESIDUAL(7): mosd/busname/src/lib.rs
RESIDUAL(28): mosd/apid/src/startup.rs
```

**Sentinel validation.** A deliberate whitespace change on a code line, exactly
as RFCT-120 did — `use std::sync::Arc;` -> `use  std::sync::Arc;` at
`mosd/mosd/src/tree.rs:22` — with the repaired stripper:

```
=== proof, clean state ===
(end)

=== sentinel: 'use std::sync::Arc;' -> 'use  std::sync::Arc;' in mosd/mosd/src/tree.rs ===
DIFFERS: mosd/mosd/src/tree.rs
(end)

=== after revert ===
(end)
```

The harness is therefore shown to be able to fail before its empty result is
offered as evidence.

### One scratch-collision note, because it cost a false green

The first sentinel run printed nothing at all. The cause was not the stripper:
four subtasks of this workstream run concurrently on one host and share `/tmp`,
and a sibling had overwritten `/tmp/scope-files.txt` with its own scope list, so
the loop was checking `os/podman/Dockerfile` and friends rather than these
files. Everything here uses a private scratch directory instead. A pass over an
empty or wrong file list looks identical to a pass over the right one.

## MUST-KEEP items reworded

Every MUST-KEEP fact in these files is still present. The ones whose wording
changed are quoted before and after, one row each.

| # | class | file | before | after |
| --- | --- | --- | --- | --- |
| 1 | test-harness safety (`MOSD_DRY_RUN`, `MOSD_SHADOW_PATH`) | `mosd/mosd/src/main.rs` | "`MOSD_DRY_RUN` — when `1`, first-boot provisioning is skipped, no reconcilers are constructed, no service scan is constructed, power actions are routed to a no-op control, and the live-state root carries `{"dry_run": true}`; used by tests so the daemon never touches the host it runs on." | "`MOSD_DRY_RUN` — when `1`, first-boot provisioning is skipped, no reconcilers or service scan are constructed, power actions go to a no-op control, and the live-state root carries `{"dry_run": true}`; used by tests so the daemon never touches its host." |
| 2 | test-harness safety (`MOSD_SCAN` one-way hook) | `mosd/mosd/src/main.rs` | "It can only ever turn the scan ON: in production the scan is constructed unconditionally and the variable is ignored, whatever it holds." | "It can only turn the scan on; in production the scan is constructed unconditionally and the variable ignored." |
| 3 | secret handling — "a hash inside a signed rootfs is a fleet-wide shared secret" | `mosd/mosd/src/identity.rs` | "Nothing secret can therefore be baked into the image — it would be a fleet-wide shared secret and it would make the verity root hash depend on a random value." | "so nothing secret can be baked into the image — it would be a fleet-wide shared secret and would make the verity root hash depend on a random value." |
| 4 | secret handling — independent-draw rule | `mosd/mosd/src/identity.rs` | "The two secrets are drawn independently. PLAN-008 Part D reads as though the AP PSK could be the device password again; it is not, because recovering the WiFi PSK would then also hand over the root shell, and a second draw from the CSPRNG costs nothing." | "The two secrets are drawn independently — PLAN-008 Part D reads as though the AP PSK could be the device password again, but recovering the WiFi PSK would then also hand over the root shell, and a second CSPRNG draw costs nothing." |
| 5 | secret handling — PSK single-0600-file rule | `mosd/mosd/src/reconciler/wifi_ap.rs` | "**Secret hygiene.** The pre-shared key reaches exactly one place: the 0600 configuration file. It is never published in the live-state tree (which is served over D-Bus), never named in an error, and this module contains no logging statement at all." | "Secret hygiene: the pre-shared key reaches exactly one place, the 0600 configuration file. It is never published in the live-state tree (which is served over D-Bus), never named in an error, and this module contains no logging statement at all." |
| 6 | protocol/wire — nested MQTT live-state shape | `mosd/apid/src/routes.rs` | "* `units` has to be an array: the reconciler drives two units, and a flat `activeState` cannot say whose state it is. Every entry carries its own `unit`, `activeState` and `unitFileState` ..." | "and because `units` has to be an array: the reconciler drives two units and a flat `activeState` cannot say whose state it is. Every entry carries its own `unit`, `activeState` and `unitFileState` ..." |
| 7 | protocol/wire — broker config key set | `mosd/mosd/src/reconciler/mqtt.rs` | "Three keys and no more, and all three always present: the broker's parser requires exactly `listen_address`, `listen_port` and `auth_enabled`." | "Three keys and no more, all always present: the broker's parser requires exactly `listen_address`, `listen_port` and `auth_enabled`." |
| 8 | protocol/wire — D-Bus `own_prefix` measured semantics | `mosd/busname/src/lib.rs` | "That is measured, not reasoned — `docs/task/RFCT-093.md` §\"Investigation — `own_prefix` semantics (measured 2026-08-22)\" against dbus-daemon 1.12.20, asserted by `mosd/hack/dbus-policy-test.sh` section 4, where an unprivileged uid (65534) requesting the bare name is OWNED." | "That is measured, not reasoned — `docs/task/RFCT-093.md` §\"Investigation — `own_prefix` semantics (measured 2026-08-22)\" against dbus-daemon 1.12.20, asserted by `mosd/hack/dbus-policy-test.sh` section 4, where uid 65534 requesting the bare name is OWNED." |
| 9 | ordering — `reset-failed` for StartLimitBurst | `mosd/mosd/src/reconciler/systemd.rs` | "It exists for the START LIMIT and not for cosmetics. Once a unit exceeds its `StartLimitBurst` within `StartLimitIntervalSec`, systemd does not merely stop restarting it -- it REFUSES every further start job, from any caller, until the window elapses or the failure is reset." | "and it exists for the start limit rather than for cosmetics. Once a unit exceeds its `StartLimitBurst` within `StartLimitIntervalSec`, systemd refuses every further start job, from any caller, until the window elapses or the failure is reset." |
| 10 | ordering — config-before-service-start | `mosd/mosd/src/reconciler/mqtt.rs` | "Configuration before service start, deliberately and for the same reason `sshd.rs` renders before it starts: a broker started against a stale config is listening on the wrong address, and nothing about that is visible from the unit's state." | "Config before service start, as in `sshd.rs`: a broker on a stale config listens on the wrong address, and the unit's state does not show it." |
| 11 | ordering — broker-before-bridge | `mosd/mosd/src/reconciler/mqtt.rs` | "**Order is opposite on the way up and on the way down.** Starting: broker then bridge ... Stopping: bridge then broker, because stopping the server out from under its client is how you get a client logging connection failures about a shutdown that was deliberate." | "Order reverses between up and down -- broker then bridge starting, the bridge being the broker's client; bridge then broker stopping, or the client logs failures about a deliberate stop." |
| 12 | ordering — sshd config precedence | `mosd/mosd/src/reconciler/sshd.rs` | "**`AuthorizedKeysFile` is not rendered here.** It is a static image file, `05-mos-authorized-keys.conf`, which sorts ahead of this reconciler's `10-mos.conf`; sshd keeps the first value it obtains for a non-repeatable keyword, so emitting the keyword here would be dead text at best." | "`AuthorizedKeysFile` is not rendered here — it is the static image file `05-mos-authorized-keys.conf`, which sorts ahead of `10-mos.conf`, and sshd keeps the first value it obtains for a non-repeatable keyword." |
| 13 | tool quirk — tests run as root, `chmod 0o000` is not EACCES | `mosd/apid/src/tests/broken_classes.rs` | "a process holding `CAP_DAC_OVERRIDE` — root, which is how `mosd/hack/check.sh` is commonly run — reads a `0o000` file straight through, so a mode-only fixture would quietly test nothing there. A fixture that silently did not fire is indistinguishable from one that did." | "a process holding `CAP_DAC_OVERRIDE` — root, which is how `mosd/hack/check.sh` is commonly run — reads a `0o000` file straight through, so a mode-only fixture would quietly test nothing there." |
| 14 | tool quirk — `Path::with_file_name` is lexical, `/etc/shadow` is a symlink | `mosd/mosd/src/transient.rs` | "`Path::with_file_name` is LEXICAL: it rewrites the last component of the string and resolves nothing. ... The write fails with `Read-only file system (os error 30)`, mosd returns an error over the bus, and apid answers `502 Bad Gateway`" | "`Path::with_file_name` is lexical: it rewrites the last component of the string and resolves nothing. ... The write then fails with `Read-only file system (os error 30)`, mosd returns an error over the bus, and apid answers `502 Bad Gateway`" |
| 15 | tool quirk — hostapd takes the line literally | `mosd/mosd/src/reconciler/wifi_ap.rs` | "**hostapd's rules are not wpa_supplicant's.** hostapd takes the bytes after the `=` literally to the end of the line: there is no quoting to escape into, so a `\"` is an ordinary character and a newline is a new directive." | "hostapd's rules are not wpa_supplicant's: it takes the bytes after the `=` literally to the end of the line, so there is no quoting to escape into, a `\"` is an ordinary character and a newline is a new directive." |
| 16 | tool quirk — SNI rejects IP literals (bun/node) | `test/apid-api/src/client.ts` | "SNI carries a `host_name` and never an IP literal -- RFC 6066 section 3 says so in as many words -- and bun ENFORCES it by THROWING at `tls.connect()`, synchronously, before a socket is opened." | "SNI carries a `host_name` and never an IP literal (RFC 6066 section 3), and bun -- like node, so this is not a bun quirk -- enforces that by throwing at `tls.connect()` synchronously, before a socket is opened." |
| 17 | reproducibility — no `build.rs`, the build mount is a git worktree | `mosd/mosd/src/main.rs` | "There is deliberately no `build.rs` that shells out to git: the build mount is a git WORKTREE, so `git rev-parse HEAD` inside it fails with `fatal: not a git repository`, and a build script written to tolerate that would embed nothing on every build." | "there is deliberately no `build.rs` shelling out to git, because the build mount is a git worktree and `git rev-parse HEAD` inside it fails with `fatal: not a git repository`." |
| 18 | test-harness safety — the suite must be able to fail | `test/apid-api/src/selftest.ts` | "every assertion helper, the cookie jar, the redirect refusal, the verbatim request writer and the phase runner are driven here against inputs that are DELIBERATELY WRONG, and each one is required to have failed WITH ITS OWN MESSAGE." | "every assertion helper, the cookie jar, the redirect refusal, the verbatim writer and the phase runner are driven against wrong inputs and each must fail with its own message" |

Two further rewrites are corrections of facts that had gone stale, not
compressions. Both were ordered by L2 and are quoted in full below.

### Stale fact 1 — `mosd/apid/src/startup.rs:44-48`

`GET /api/versions` has been declared since PLAN-016 M1
(`mosd/apid/src/routes.rs:267`, `.route(VERSIONS_PATH, get(api_versions))`), so
both claims in this comment were false.

Before:

```rust
/// `GET /api/versions` itself is **not** declared: it is an unauthenticated
/// endpoint and therefore an authentication decision, which §8.2 phase 2
/// reviews as a set rather than one route at a time. `/api/` 404s everything,
/// this path included, and that stays true. When phase 2 lands the route, it
/// serves this constant rather than a second copy of it.
```

After:

```rust
/// `GET /api/versions` is declared (`routes::api_router`) and serves this
/// constant rather than a second copy of it; it is unauthenticated by §2.1.
/// Every path under `/api/` that is not a declared route still 404s.
```

### Stale fact 2 — `board/common/mos-required.fragment`

The file called itself "the board-independent Talos runtime baseline" and
attributed the hugetlbfs/tracefs/SELinux entries to machined's early boot.
Since PLAN-010 the talos repo is archived reference-only and nothing in the
shipping image runs machined. The parts that are still true — the
`mos-common` buildx context, `merge_config.sh -m` before `olddefconfig`, the
`=y` assertion loop, and the dm-verity no-initramfs "built-in `=y`, never `=m`"
rule — are unchanged.

Before:

```
# mos-required kernel options — the board-independent Talos runtime baseline,
# shared by every board (board/common/, referenced as buildx named context
# `mos-common`). Board kernels merge this BEFORE olddefconfig and assert every
# =y line against the final .config.
...
# machined early boot fsopen()s these pseudo filesystems unconditionally
# (internal/pkg/mount/v3/helpers.go in the talos repo); a missing one causes
# "early boot failed: openfs failed" and a reboot loop (seen on hardware
# 2026-08-17: hugetlbfs). SELinux is permissive by default (DEVELOP=y);
# machined decides enforcing per machine config.
```

After:

```
# mos-required kernel options — the board-independent runtime baseline, shared
# by every board (board/common/, referenced as the buildx named context
# `mos-common`). Board kernels merge this before olddefconfig and assert every
# =y line against the final .config.
...
# Inherited from the baseline PLAN-010 line 53 records as "machined-era options
# (harmless) + WireGuard", and retained deliberately: nothing in the shipping
# image requires them. A missing hugetlbfs put the board in a reboot loop on
# hardware (2026-08-17). SELinux is permissive: CONFIG_SECURITY_SELINUX_DEVELOP=y
# and no shipping process changes that.
```

The measured hardware fact (2026-08-17 reboot loop) is kept; only its false
causal attribution to machined is dropped. `CONFIG_TRACING`'s "tracefs has no
Kconfig symbol of its own" note and the `SQUASHFS_XATTR` note are untouched.

## Banner survivors

Rule 2 deletes decorative separators and exempts "short labelled markers that
mirror an existing sibling-script convention (`docs/verify-index.sh` style)".
After this pass **no decorative banner remains in any of the 38 files**. The 102
lines the metric still flags split into exactly two kinds, and the split is
mechanical:

| kind | count | disposition |
| --- | ---: | --- |
| rule-2 labelled markers — `# --- 4. own_prefix semantics ---`, `// -- 1. logout ---`, `// ---- rendering ----` | 94 | **kept.** Established sibling convention. |
| metric false positives — comment lines whose *indentation* is 20+ spaces, so `(.)\1{19,}` matches the leading run | 8 | **kept.** Not banners at all. |
| decorative separators | 0 | all deleted |

The labelled-marker convention is not local to these files, which is why
deleting it here would have made the tree inconsistent with files this subtask
may not edit:

```
$ grep -rcE '^# -{3} .* -{5,}$' --include='*.sh' .
docs/verify-index.sh:3          os/verify/run.sh:8          os/build/run.sh:6
docs/verify-index-test.sh:6     os/tests/health-test.sh:7   os/tests/quadlet-doc-test.sh:3
os/tests/shadow-reconcile-test.sh:7                         os/update/rauc/render-config.sh:3
os/tests/repart-loader-test.sh:1  os/tests/handshake-test/harness.sh:2
```

`docs/verify-index.sh` — the file rule 2 names — is in that list. The same
convention exists in `.ts` (`test/apid-api/src/report.ts`,
`src/phases/08-poweroff.ts`, both outside this scope) and in `.rs`
(`mosd/apid/tests/e2e.rs`, `mosd/mosd-settings/tests/settings.rs`, both outside
this scope).

The 8 indentation false positives are, in full: `mosd/apid/src/routes.rs:750-754`
(a comment nested inside a `maud` `html!` block, indented 24 columns) and
`mosd/mosd/src/reconciler/sshd.rs:419-421` (a comment inside a nested
`json!({...})`, indented 20 columns). Both are ordinary prose comments.

## Surviving 15+-line comment blocks

44 blocks, down from 87. Every one is a single dense block of constraints,
measured facts or design-document contract citations; the `before -> after` line
counts in each row are this pass's own reduction. Two entries are structural
rather than prose: `busname/src/lib.rs:86` carries an executable rustdoc
doctest, and `apid/src/startup.rs:1` is out of compression scope.

| block | lines | why it cannot be shorter without losing a constraint |
| --- | ---: | --- |
| `mosd/busname/src/lib.rs:86` | 44 | Contains a 15-line rustdoc doctest that `cargo test --doc` executes; the prose above it was cut 41 -> 28 and the doctest is code, not comment form. |
| `mosd/apid/src/startup.rs:1` | 32 | Out of compression scope: startup.rs was added mid-task for one stale-fact fix only. Header untouched. |
| `mosd/apid/src/tests/broken_classes.rs:1` | 31 | Two named anti-patterns (pass-count invariance, same-observable collision) each with a cited model test, plus §6.1's layer table. 37 -> 31. |
| `mosd/mosd/src/provisioning.rs:97` | 27 | Seven-step seeding contract, one distinct fact per step, plus a rustdoc `# Errors` section. 32 -> 27. |
| `mosd/mosd/src/main.rs:1` | 27 | An environment-variable reference list: five variables, three of them MUST-KEEP safety invariants (`MOSD_SHADOW_PATH`, `MOSD_DRY_RUN`, the one-way `MOSD_SCAN` hook). 31 -> 27. |
| `mosd/mosd/src/reconciler/sshd.rs:1` | 26 | Three ordered system effects with their paths and modes, plus three separate MUST-KEEP rules (PAM, PasswordAuthentication gating, AuthorizedKeysFile precedence). 34 -> 26. |
| `mosd/mosd/src/reconciler/wifi_ap.rs:1` | 25 | Three ordered system effects, the single-radio conflict rule, and the PSK secret-hygiene invariant. 28 -> 25. |
| `mosd/mosd/src/reconciler/sshd.rs:314` | 25 | The reload-not-restart rule, the `KillMode` measurement, the `ExecReload` dependency and the no-fallback rule. 31 -> 25. |
| `mosd/hack/dbus-policy-test.sh:1` | 25 | Harness contract: what is proved, the both-directions rule, the three-bus separation and the refuse-rather-than-skip rule. 31 -> 25. |
| `mosd/apid/src/routes.rs:2208` | 25 | MUST-KEEP nested MQTT live-state shape plus the cross-crate test-pair contract. 31 -> 25. |
| `mosd/apid/src/auth.rs:49` | 24 | `docs/design/access.md` §3.3 curve, the counter-survives-expiry rule and the never-permanent cap, all §6 contract citations. 29 -> 24. |
| `mosd/apid/src/assets/serve.rs:1` | 23 | api.md §4.1/§4.2/§4.3 applied: the structural-precedence rule with its quoted clause, the five ordered conditions and the §4.3 header rules. 28 -> 23. |
| `mosd/hack/dbus-policy-test.sh:731` | 21 | The layered allow-over-deny question, the one-bus rationale and the username-substitution limit with its verifier pairing. 23 -> 21. |
| `mosd/apid/src/tests/broken_classes.rs:88` | 21 | MUST-KEEP `CAP_DAC_OVERRIDE` fixture quirk plus the socket-construction narrowing. 24 -> 21. |
| `test/apid-api/src/phases/07-reboot.ts:250` | 20 | Two exported constants, each with its measured 2026-08-24 status code (202/422) and the auth-gate 303 ambiguity. 23 -> 20. |
| `mosd/mosd/src/transient.rs:1` | 20 | The not-a-setting rule, the two STATE files, and the marker-vs-shadow disagreement rule that is the reason a marker exists. 26 -> 20. |
| `mosd/mosd/src/reconciler/container.rs:1` | 20 | Why the switch is not a service, the Quadlet generator mechanism, both switch states and the mandatory daemon-reload. 26 -> 20. |
| `mosd/mosd/src/identity.rs:83` | 20 | Three generated artefacts with their paths, the independent-draw rule, the not-saved rule and a `# Errors` section. 30 -> 20. |
| `mosd/mosd/src/transient.rs:76` | 19 | MUST-KEEP `with_file_name`-is-lexical quirk with its measured failure chain to apid's 502. 24 -> 19. |
| `mosd/mosd/src/reconciler/wifi_client.rs:1` | 19 | Three ordered system effects including the `wpa_supplicant@.service` filename contract. 22 -> 19. |
| `mosd/mosd/src/provisioning.rs:1` | 19 | The no-network invariant with its full exclusion list, and the one-`Store::save` atomicity rule. 25 -> 19. |
| `mosd/hack/dbus-policy-test.sh:497` | 19 | MUST-KEEP `own_prefix` measurement rationale and the separate-bus attribution rule. 22 -> 19. |
| `mosd/busname/src/lib.rs:1` | 19 | The two-grammar table (4 literal lines) plus the class-position rule and the bare-namespace case. 24 -> 19. |
| `mosd/mqttd/src/bridge.rs:1` | 18 | §10.1 alive-gate rule enumerating the five gated publications, plus the mirror/rate-limit rule. 25 -> 18. |
| `mosd/mosd/src/reconciler/systemd.rs:92` | 18 | MUST-KEEP `reset-failed` start-limit rule plus a `# Errors` section. 23 -> 18. |
| `mosd/mosd-settings/src/model.rs:76` | 18 | MQTT master-switch semantics, the deliberate non-coupling of `listen`/`auth`, and the default-false rationale. 22 -> 18. |
| `test/apid-api/src/phases/07-reboot.ts:1` | 17 | The console-not-status-code rule and the `-no-reboot` mechanism with the cross-process handoff. 27 -> 17. |
| `mosd/mosd-settings/src/migration.rs:152` | 17 | v2<->v3 up and down key lists and the three deliberate losses on rollback. 19 -> 17. |
| `mosd/apid/src/tests/broken_classes.rs:679` | 17 | §6.1 quoted clause plus the one case this layer cannot cover, with its cited substitute test. 19 -> 17. |
| `mosd/apid/src/routes.rs:674` | 17 | Session-before-bus ordering soundness argument and the two properties it buys. 20 -> 17. |
| `mosd/apid/src/routes.rs:121` | 17 | §6.3 unshadowable-prefix rule, the whole-subtree reservation and the two-spelling split. 19 -> 17. |
| `mosd/apid/src/auth.rs:324` | 17 | The 16-second seeding rationale with the whole-UNIX-second truncation measurement. 19 -> 17. |
| `test/apid-api/src/client.ts:283` | 16 | MUST-KEEP SNI tool quirk with the verbatim measured bun 1.4.0 TypeError. 24 -> 16. |
| `mosd/mosd/src/tree.rs:1` | 16 | §1.1 projection contract, the §1.2 single-writer rule and the §7 actions projection. 19 -> 16. |
| `mosd/mosd/src/reconciler/mqtt.rs:175` | 16 | The no-coupling rule plus the measured StartLimit numbers (60 s / burst 5 / ~25 s). 28 -> 16. |
| `mosd/hack/dbus-policy-test.sh:624` | 16 | The separate-bus attribution argument and the both-directions rule. 20 -> 16. |
| `test/apid-api/src/phases/07b-postreboot.ts:1` | 15 | Which files persist and why, keyed to the STATE bind mount, plus the regeneration finding. 32 -> 15. |
| `mosd/mosd/src/tree.rs:361` | 15 | The setting/action split with both §3 failure codes. 21 -> 15. |
| `mosd/mosd/src/reconciler/wifi_client.rs:265` | 15 | Determinism, priority ordering and the `update_config=0` rule, plus `# Errors`. 18 -> 15. |
| `mosd/mosd/src/reconciler/wifi_ap.rs:437` | 15 | WPA2-PSK-only and `ieee80211d=1` rules, plus `# Errors`. 17 -> 15. |
| `mosd/mosd/src/reconciler/mqtt.rs:1` | 15 | Two ordered system effects, the unconditional-render rule, the master-switch rule and the reversed start/stop order. 32 -> 15. |
| `mosd/mosd-settings/src/authorized_key.rs:53` | 15 | The no-`options`-field rule (an RCE surface) and canonical form, plus `# Errors`. 17 -> 15. |
| `mosd/apid/src/auth.rs:80` | 15 | Check-and-charge atomicity argument and the pessimistic-charge rule. 17 -> 15. |
| `mosd/apid/src/assets/serve.rs:192` | 15 | §4.2 condition 3 with its acceptance property and the stated `curl` cost. 19 -> 15. |

Where a block still exceeds the <= 8-line target, the binding constraint was
rule 3's other half — "every constraint, measured fact and tool quirk survives".
Compression stopped at the point where the next line removed would have deleted
a fact rather than rhetoric. Rustdoc `# Errors` sections (a mandatory four lines
each: blank, heading, blank, text) account for the floor in eight of these.

## Gate results

Run from the worktree root at `90a39f8`, the last content commit.

| gate | command | result |
| --- | --- | --- |
| comment-only proof | the loop above, 38 files | **empty**, with the sentinel shown failing first |
| stripper self-check | residual-comment scan over all 38 files at the merge base | **empty** (8 files had residuals before the repair) |
| rustfmt | `rustfmt --edition 2024 --check $(find mosd -name "*.rs")` | clean, rc=0 |
| clippy | `cargo clippy --workspace --all-targets --locked -- -D warnings` | clean, rc=0 |
| tests | `cargo test --workspace --locked` | **616 passed / 0 failed**, rc=0 |
| baseline tests | the same three, on the merge-base tree | **616 passed / 0 failed**, rc=0 — identical per suite |
| `bash -n` | the three `.sh` files touched | rc=0 each |
| shell lint | `bash os/tests/shell-pipefail-lint.sh` | `RESULT: PASS (29/29 files clean, 29 scanned)`, rc=0 |
| apid harness | `bash test/apid-api/run.sh --dry-run` | rc=1 — **identical at the merge base**, see below |

The Rust route is the dispatch's container recipe with one correction: `cargo`
has to run from `/src/mosd`, not `/src`, because the workspace manifest is
`mosd/Cargo.toml` and there is no `Cargo.toml` at the repository root. `rustfmt`
still runs from `/src` so the `find mosd -name "*.rs"` path list resolves.
`dbus-daemon` is installed in the throwaway container layer, as required —
`mosd/mosd/tests/bus.rs` and `tests/scan.rs` refuse rather than skip without it,
which is a MUST-KEEP safety invariant doing its job. No image change is
committed.

```
$ docker run --rm -v "$PWD:/src" -v /srv/mos-rust-tools:/tools:ro \
    -w /src/mosd --entrypoint /bin/bash localhost/mos-build-rust -c '
      export PATH=/tools/bin:$PATH LD_LIBRARY_PATH=/opt/rust/lib
      apt-get update -qq && apt-get install -y -qq dbus >/dev/null 2>&1
      cd /src && rustfmt --edition 2024 --check $(find mosd -name "*.rs") && echo RUSTFMT_OK &&
      cd /src/mosd &&
      cargo clippy --workspace --all-targets --locked -- -D warnings && echo CLIPPY_OK &&
      cargo test --workspace --locked'
RUSTFMT_OK
CLIPPY_OK
...
rust gate rc=0
total passed: 616
total failed: 0
```

### The expected test count is 616, not 593, and that is not this change

RFCT-116 recorded `cargo test --workspace` at **593 passed**, and the dispatch
carried that number forward as the expected baseline. It is stale: `main` has
advanced since (PLAN-016's apid work landed), and the difference is not
attributable to a comment-only change. Rather than assume, the same gate was run
against a clean extraction of the merge base itself:

```bash
BASE=$(git merge-base HEAD main)          # b55b9df
git archive "$BASE" | tar -x -C /srv/m6-27b35kri-base
# ... same docker invocation against /srv/m6-27b35kri-base ...
base rust gate rc=0
base passed: 616
base failed: 0
```

and the per-suite counts compared line for line:

```
$ diff <(grep -oE 'ok\. [0-9]+ passed' base.log) <(grep -oE 'ok\. [0-9]+ passed' branch.log)
IDENTICAL per-suite counts
```

**616 / 0 on both sides, suite by suite. No test count moved.** The extraction
is a plain `git archive` into a scratch directory — no worktree, no branch, no
stash, and nothing in git state was touched.

### `test/apid-api/run.sh --dry-run`

```
=== apid dry-run on branch ===
branch rc=1
=== apid dry-run on base tree ===
base rc=1
```

Identical to the merge base, which is the pass condition. It refuses at its
image precondition; rc=0 is not expected here and was not expected at `main`.

### English-only and provenance

```
$ LC_ALL=C grep -nP '[^\x00-\x7F]' $(git diff --name-only $BASE HEAD) | grep -P '[\x{4e00}-\x{9fff}]'
no CJK
$ grep -rniEf assistant-names.txt $(git diff --name-only $BASE HEAD)
no agent, model or assistant names
```

## Findings — reported, not acted on

1. **The supplied comment stripper is unsound on this tree.** Three defects,
   detailed above. Any sibling subtask that ran it unmodified over a `.ts` file
   containing `` `text/*` ``, a `.ts` file containing a regex literal, or a
   `.rs` file containing a lifetime has either a fabricated `DIFFERS` or a proof
   that never examined the code it claimed to check. The repaired version is at
   `$S/strip.py`; the residual-comment self-check is the cheap way to detect the
   problem on any file set.
2. **`/tmp` is shared between the concurrent subtasks of this workstream.** A
   sibling overwrote `/tmp/scope-files.txt` mid-run here. Any subtask using the
   dispatch's bare `/tmp` paths may have measured a sibling's file list.
3. **The metric's banner regex matches indentation.** `(.)\1{19,}` fires on any
   comment line indented 20+ columns, which is why deeply nested comments in
   `routes.rs` and `sshd.rs` count as banners. 8 of the 102 remaining "banners"
   in this scope are that, and no scope can drive them to zero without
   re-indenting code.
4. **`mosd/apid/src/routes.rs` doc-comments in the utoipa range are API
   surface.** RFCT-120 Finding 3 records that the doc-comments on
   `#[utoipa::path]` handlers and `ToSchema` types (roughly lines 315-520) are
   lifted verbatim into `openapi.json`. No comment in that range was touched by
   this pass; the four blocks edited in `routes.rs` are at `:1`, `:121`, `:674`
   and `:2208`, all outside it, and `MqttView` carries no `ToSchema` derive.
