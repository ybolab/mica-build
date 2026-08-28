# RFCT-038 mos-shadow-reconcile: newline-safe append

- **status**: completed — implementation complete, `make os-shadow-test` (220 passed,
  0 failed) and `bash mosd/hack/check.sh` both green; no on-device behaviour
  is claimed
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 09:39
- **claimedAt**: 2026-08-19 09:39
- **completedAt**: 2026-08-19 10:55

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/bsysx13g`, merged by
L2 into `bkd/hiu25adw`.

## Description

`os/rootfs/overlay-v2/usr/lib/mos/mos-shadow-reconcile` runs on every boot and
converges the STATE-backed `/etc/shadow` with the accounts in `/etc/passwd`. It
builds a temp file by copying the existing shadow and then appends any missing
entry with `>>`. If the copy's final line carried no newline terminator, the
first appended entry landed on that same line.

The result is one malformed record welding two accounts together, in the file
`pam_unix` authenticates against:

```
daemon:*:19000:0:99999:7:::newsvc:!:20684:0:99999:7:::
```

The damage does not stay still. The loop skips an account only when
`grep -q "^${user}:"` matches, and the welded `newsvc` no longer starts a line,
so the next boot appends it again — and the boot after that. The harness now
demonstrates this directly: with the fix reverted, the idempotence assertion on
case 9.1 fails with a second `newsvc` line present after the second run.

This was found and reported by the RFCT-033 author, who correctly declined to
fix it as out of scope; it is recorded there under "Known sharp edge,
pre-existing, NOT fixed here". It predates that task, living in the `added`
loop that RFCT-029 introduced.

Reachability is low. Debian's factory shadow is newline-terminated, and mosd's
own rewrite path preserves the terminator. Low reachability is not
unreachability, and the file is a credential store on a boot path.

## Why it was invisible until now

The test harness normalised it away. `new_case` writes its fixture with

```sh
printf '%s\n' "$(printf '%s' "$2")"
```

which collapses any body — including one that arrived through a command
substitution, which strips trailing newlines — to exactly one trailing newline.
The comment above it said so explicitly and called the unterminated shape "not
the shape this script is fed on a device". That is true of the shapes this
stack writes, but it meant every one of the 117 existing cases fed the script
the single input shape the append path could not mishandle. The normalisation
was not wrong; it was just total.

The new cases use `new_case_raw`, which writes the body verbatim.

## Design

### The fix

Between the copy and the first append:

```sh
if [ -s "$tmp" ]; then
    if [ "$(tail -c 1 "$tmp" | od -An -tx1 | tr -d ' \n')" != "0a" ]; then
        printf '\n' >>"$tmp"
    fi
fi
```

The last byte is inspected through `od` rather than compared as a string,
because command substitution strips trailing newlines: `$(tail -c 1 "$tmp")` is
the empty string both for a file ending in a newline and for a file ending in
no byte at all. Those two cases need opposite treatment, so the byte is
rendered as hex, where a terminator is `0a` and nothing else is. The `-s` guard
keeps an empty copy empty — there is no final line to terminate, and a bare
newline there would become a blank first line.

POSIX `sh` throughout: `tail -c`, `od -An -tx1` and `tr -d` are all in POSIX and
in busybox. This adds three externals to a boot script that already calls
`awk`, `grep`, `head`, `date` and `find`.

### The deliberate decision NOT to rewrite a converged-but-unterminated file

The repair writes to `$tmp`, never to `$SHADOW`. A shadow file that is
unterminated but needs no new entry therefore still reaches the existing
`added -eq 0` early exit, which discards `$tmp` and leaves `$SHADOW` untouched.
It stays unterminated on disk, deliberately.

The reasoning: with nothing to append there is nothing that can be welded, so
rewriting would buy no safety at all. What it would cost is turning a no-op
boot into a write to a credential file — on every boot, forever, for a file
that is already correct as far as anything that reads it is concerned. That is
the opposite of what this script exists to do; "if every account already has an
entry the file is not replaced at all" is its stated contract.

This is the kind of asymmetry a later reader tidies into a bug, so it is stated
in a comment at the fix site as well as here, and case 9.2 asserts it in bytes.

## R2 audit: the sibling write paths

Both other write paths in this script were checked for the same
unterminated-input exposure. **Neither has it, and neither was changed.**

### The transient-marker clearing block (RFCT-033)

```sh
awk -F: -v OFS=: '$1 == "root" { $2 = "!" } { print }' "$SHADOW" >"$ttmp"
```

Safe, for two independent reasons.

1. It is a whole-file rewrite through `>`, not an append through `>>`. There is
   no pre-existing tail for new content to land on, so the welding failure mode
   does not exist here.
2. `awk` treats an unterminated final line as a complete record, and `print`
   supplies `ORS` unconditionally. Its output is therefore always
   newline-terminated regardless of how the input ended.

Consequence worth naming: when this branch fires against an unterminated file,
the file comes out terminated. That is a byte change, but it happens only in
the branch that was already rewriting the file deliberately, so it costs no
extra write. Case 9.6 asserts it rather than assuming it.

### `lock_entry`

```sh
lock_entry() {
    echo "$1" | awk -F: -v OFS=: '{ if ($2 !~ /^[!*]/) $2 = "!"; print }'
}
```

Safe. Its input is `line="$(grep "^${user}:" "$FACTORY" | head -n1)"`, and the
command substitution strips any trailing newline; `echo` then adds exactly one
back, and `awk`'s `print` adds `ORS` to that. The output is exactly one
terminated line whatever the factory template's final byte was — so an
unterminated `/usr/share/factory/etc/shadow` cannot produce an unterminated
appended entry either. Case 9.7 proves this with a factory fixture that has no
final newline.

The sibling `echo "${user}:!:${today}:0:99999:7:::" >>"$tmp"` fallback is safe
for the same reason: `echo` terminates its output.

So the copy path was the only one that needed the fix.

## Files changed

- `os/rootfs/overlay-v2/usr/lib/mos/mos-shadow-reconcile` — the terminator
  repair between the copy and the append loop, plus the comment explaining why
  it targets `$tmp` and not `$SHADOW`.
- `os/shadow-reconcile-test.sh` — section 9: `new_case_raw`, four byte-level
  helpers, `check_idempotent`, and ten cases.
- `docs/task/RFCT-038.md` — this record.

Nothing under `mosd/`, no Dockerfile, no verifier, no Makefile: three sibling
L3s were running against those concurrently.

## Verification (2026-08-19)

```
make os-shadow-test     ->  220 passed, 0 failed   (baseline 117 passed, 0 failed)
bash mosd/hack/check.sh ->  ALL CHECKS PASSED, 250 tests
```

`check.sh` is unchanged from baseline, as expected — no Rust was touched.

The 103 added checks are not merely present; they were confirmed to fail
without the fix. Reverting only the terminator repair and rerunning the harness
gives `192 passed, 18 failed`, with the welded line visible verbatim in the
failure output and the compounding visible in the idempotence assertions.

### What the harness covers

Every case asserts on bytes, not on exit status alone. File comparisons go
through `file_hex` (`od -An -tx1`), because `$(cat file)` strips trailing
newlines and would report a terminated and an unterminated file as equal —
exactly the distinction under test. Line counts go through `awk END { NR }`,
because `wc -l` does not count an unterminated final line and would
under-count these fixtures silently.

| # | Case | Asserts |
|---|------|---------|
| 9.1 | unterminated + an account to add | 3 lines, new entry on its own line and locked, previous final line byte-identical, exactly one `newsvc` line, `daemon` and `newsvc` never share a line, result terminated |
| 9.2 | unterminated + nothing to add | byte-identical, **still unterminated**, converged message, nothing logged as added |
| 9.3 | empty shadow + accounts to add | both entries land, zero blank lines, first line is `root`, entry locked |
| 9.4 | single unterminated line | 2 lines, original line byte-identical, `daemon` on its own line, root hash untouched |
| 9.5 | file ending in two newlines, both directions | no blank line invented, exactly one line gained, both seeded accounts survive; and byte-identical when converged |
| 9.6 | transient marker vs unterminated file, three directions | matching: root cleared, 2 lines, `daemon` line byte-identical, file terminated by the rewrite. Mismatching: byte-identical, still unterminated, dev hash survives. Mismatching **and** an account to add: the append path copes with the file the transient path declined to rewrite |
| 9.7 | unterminated factory template | appended entry on its own line with the template's aging fields, result terminated |

Every case ends with `check_idempotent`: a second run must exit 0, leave
byte-identical output, and leave no temp files. That is the half that would
catch a fix which "repaired" a converged file into a fresh write on every boot.

## What is NOT proven

- **Nothing about a real boot.** Every case runs the script offline against
  fixtures in a temp dir via `MOS_SHADOW_PASSWD` / `MOS_SHADOW_FACTORY`. No
  device was booted, no PAM stack was exercised, and no claim is made about
  `pam_unix` behaviour on hardware.
- **`chgrp shadow` was faked.** The harness runs unprivileged, so the group
  assertions are skipped in that mode; it prints which mode it took. This is
  pre-existing harness behaviour, not something this task changed.
- **No evidence any device ever had an unterminated shadow file.** This is a
  defect fix on a path that was reachable, not a response to an observed
  failure. The two known writers of this file both terminate their output.
- **`od`, `tail` and `tr` are assumed present in the initramfs-era environment
  this script can run in.** They are coreutils and busybox staples, and the
  script already depends on `head` and `date` from the same package, but this
  was not verified against the actual image manifest.
- **Not fuzzed.** The fixtures are hand-written shapes, not generated ones. A
  shadow file containing a NUL byte, a CRLF terminator, or an incomplete UTF-8
  sequence is untested; `\r\n` in particular would leave a stray `\r` at the
  end of a field, which this fix neither creates nor repairs.

## ActiveForm

Making the append rule safe against a shadow file whose final line carries no
terminator, without turning a converged boot into a write.

## Dependencies

- **blocked by**: RFCT-029 (the reconcile script and its append loop),
  RFCT-033 (the transient-marker block audited under R2, and the harness this
  extends)
- **blocks**: nothing
