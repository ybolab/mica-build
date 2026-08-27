# RFCT-151 PLAN-015 M6: form compression in os/build (28 files)

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-26 18:20
- **claimedAt**: 2026-08-26 18:20
- **completedAt**: 2026-08-26 20:10
- **plan**: PLAN-015 (M6)

PLAN-015 M6's four form rules applied to the 28 source files of `os/build`.
Constraint content is preserved; typography, decorative banners and essay
length change. No behaviour change, no executable-line change, no
string-literal change.

## Scope

Only these files were edited, plus `docs/task/RFCT-151.md` (this file).
`docs/task/index.md` was not touched. Counts are the M6 metric
(`score = 2*caps + banners + 5*blocks15`); "before" is the dispatch's
measurement at `63c11cf`, "after" is measured on this branch.

| file | before | after |
|---|---|---|
| `os/build/src/bundle.ts` | 75 caps=18 ban=4 blk=7 longest=50 | 20 caps=0 ban=0 blk=4 longest=30 |
| `os/build/src/mkimage-x64.ts` | 70 caps=25 ban=0 blk=4 longest=59 | 25 caps=0 ban=0 blk=5 longest=38 |
| `os/build/src/stages.ts` | 53 caps=9 ban=15 blk=4 longest=46 | 5 caps=0 ban=0 blk=1 longest=37 |
| `os/build/run.sh` | 42 caps=14 ban=4 blk=2 longest=40 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/bundle.test.ts` | 37 caps=8 ban=11 blk=2 longest=21 | 5 caps=0 ban=0 blk=1 longest=16 |
| `os/build/src/mkimage-v2.ts` | 34 caps=12 ban=0 blk=2 longest=47 | 5 caps=0 ban=0 blk=1 longest=32 |
| `os/build/src/mkimage-x64.test.ts` | 32 caps=9 ban=4 blk=2 longest=23 | 10 caps=0 ban=0 blk=2 longest=23 |
| `os/build/src/toolbox.ts` | 28 caps=9 ban=0 blk=2 longest=42 | 10 caps=0 ban=0 blk=2 longest=24 |
| `os/build/src/grub-x64.ts` | 28 caps=8 ban=2 blk=2 longest=34 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/toolsets.ts` | 25 caps=5 ban=0 blk=3 longest=17 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/layout-x64.ts` | 22 caps=6 ban=0 blk=2 longest=40 | 10 caps=0 ban=0 blk=2 longest=23 |
| `os/build/src/pin-seeded-times.ts` | 21 caps=8 ban=0 blk=1 longest=54 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/layout-cx3576.ts` | 20 caps=5 ban=0 blk=2 longest=29 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/tools/e2fsprogs.ts` | 18 caps=4 ban=0 blk=2 longest=49 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/verify-package.ts` | 17 caps=6 ban=0 blk=1 longest=45 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/stages-cli.ts` | 16 caps=3 ban=0 blk=2 longest=20 | 5 caps=0 ban=0 blk=1 longest=18 |
| `os/build/src/mkimage-v2.test.ts` | 16 caps=4 ban=3 blk=1 longest=22 | 5 caps=0 ban=0 blk=1 longest=22 |
| `os/build/src/geometry.ts` | 15 caps=5 ban=0 blk=1 longest=47 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/paths.ts` | 14 caps=2 ban=0 blk=2 longest=20 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/bundle-cli.ts` | 13 caps=4 ban=0 blk=1 longest=28 | 5 caps=0 ban=0 blk=1 longest=18 |
| `os/build/src/tools/rauc.ts` | 11 caps=3 ban=0 blk=1 longest=23 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/tools/mtools.ts` | 11 caps=3 ban=0 blk=1 longest=23 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/boot-cx3576.ts` | 11 caps=3 ban=0 blk=1 longest=19 | 5 caps=0 ban=0 blk=1 longest=17 |
| `os/build/src/tools/sgdisk.ts` | 10 caps=2 ban=1 blk=1 longest=37 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/bundle-cli.test.ts` | 10 caps=1 ban=8 blk=0 longest=11 | 0 caps=0 ban=0 blk=0 longest=11 |
| `os/build/src/tools/dd.ts` | 9 caps=2 ban=0 blk=1 longest=19 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/mkimage-x64-cli.ts` | 9 caps=2 ban=0 blk=1 longest=15 | 0 caps=0 ban=0 blk=0 longest=14 |
| `os/build/src/layout-x64.test.ts` | 9 caps=2 ban=0 blk=1 longest=15 | 0 caps=0 ban=0 blk=0 longest=14 |
| **totals** | **caps 182, banners 52, blocks15 52** | **caps 0, banners 0, blocks15 22** |

Rule-1 caps runs: 182 -> 0. Rule-2 banner lines: 52 -> 0, with no
sibling-convention survivors claimed; every `# --- name ---------` and
`// --- name ---------` marker became one short plain-text header line, which
is what rule 2 asks for where a section break is genuinely needed. Rule-3
15+-line blocks: 52 -> 22, each survivor named and justified below.

## Two comment lines left verbatim by L1 instruction

`os/build/src/mkimage-v2.test.ts:13` and `os/build/src/mkimage-x64.test.ts:13`
carry the HARNESS-pointer sentence ("... and `os/build/HARNESS.md` carries the
recipe and the two/four hashes"). The sibling docs workstream owns those, so
the sentence was left byte-identical in both files, and the paragraph above it
in `mkimage-x64.test.ts` was padded by one line so the sentence keeps line 13
exactly. Verified:

```
$ BASE=$(git merge-base HEAD main)
$ diff <(git show "$BASE:os/build/src/mkimage-x64.test.ts" | sed -n '12,14p') \
       <(sed -n '12,14p' os/build/src/mkimage-x64.test.ts)
1c1
< // THE BYTE-IDENTITY GATE IS NOT HERE. It is shell-against-TypeScript over the
---
> // The byte-identity gate is not here. It is shell-against-TypeScript over the
3c3
< // carries the recipe and the four hashes. What IS here is everything that gate
---
> // carries the recipe and the four hashes. What is here is everything that gate
```

Only the two sentences *around* the reserved one changed (the ALL-CAPS lead-in
before it and `What IS here` after it). The reserved sentence itself --
`It is shell-against-TypeScript over the real _out/x64/ inputs, it takes a
minute and 1.9 GiB, and os/build/HARNESS.md carries the recipe and the four
hashes.` -- is unchanged, and so is the `_out/cx3576/` / "two hashes" form in
`mkimage-v2.test.ts`.

## The comment-only proof

### The mandated stripper

`$SCRATCH` is a private scratch directory (`mktemp -d /tmp/m6-swkqcwux-XXXX`);
bare `/tmp` paths are not used because sibling subtasks share this host. The
stripper is the one in the dispatch, written to `$SCRATCH/strip.py`; the scope
list is `$SCRATCH/scope.txt`.

```bash
BASE=$(git merge-base HEAD main)
while read -r f; do
  diff -u <(git show "$BASE:$f" | python3 $SCRATCH/strip.py "$f") \
          <(python3 $SCRATCH/strip.py "$f" < "$f") >/dev/null \
    || echo "DIFFERS: $f"
done < $SCRATCH/scope.txt
```

**Sentinel validation, before any edit.** One deliberate whitespace change on a
code line (`import { join } from 'node:path'` ->
`import  { join } from 'node:path'` in `os/build/src/paths.ts`):

```
### sentinel active:
 os/build/src/paths.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
### proof output with sentinel:
DIFFERS: os/build/src/paths.ts
### proof output after revert:
(empty)
```

**Output over the finished branch:**

```
DIFFERS: os/build/src/bundle.test.ts
```

### Why that one line is the stripper's defect and not a code change

The stripper does not know TypeScript regular-expression literals. In
`os/build/src/bundle.test.ts:174` the assertion

```
      .toThrow(/rootfs-report-v2\.txt not found; the image's RAUC version is unknown/)
```

contains an apostrophe inside a regex literal. The stripper reads that `'` as
the start of a string literal, and the phantom string runs on until the next
`'`, swallowing every comment in between. Measured on the file as it stands:

```
$ python3 $SCRATCH/strip.py os/build/src/bundle.test.ts < os/build/src/bundle.test.ts | grep -c '^\s*//'
15
```

A comment stripper that leaves 15 comment lines behind is blind over that
range, and it is blind identically at the merge base. Two of the eleven banner
lines this task had to delete (`// --- G6, G6b: the boot-attempt credits ---`
and `// --- G14, G15: the grub cmdline fragment ---`) fall inside that range,
so the mandated harness reports them as a difference. They are comments; rule 2
requires them to go.

The same defect class cost one other edit: `os/build/src/boot-cx3576.ts` has
`/dm-mod\.create="[^"]*"/g` at line 200, whose quotes open the same kind of
phantom string. One doc-comment rewrite below it was reverted rather than
carried, because that block was already inside the rule-1/2/3 limits and the
rewrite bought nothing. That file passes the mandated stripper.

### The second, regex-aware stripper

To prove the two banner lines really are the only difference,
`$SCRATCH/strip2.py` is the mandated stripper plus regex-literal handling
(same string/template/comment rules, plus: a `/` in expression position starts
a regex literal, character classes and escapes honoured, flags consumed). Same
loop, same scope list:

```
$ bash $SCRATCH/proof2.sh
(no output over all 28 files)
```

It leaves no comment behind in the file the mandated one is blind in:

```
$ python3 $SCRATCH/strip2.py os/build/src/bundle.test.ts < os/build/src/bundle.test.ts | grep -c '^\s*//'
0
```

**Sentinel validation of the regex-aware stripper**, so an empty result is
evidence rather than a silent pass:

```
=== sentinel A: whitespace on a code line in paths.ts ===
DIFFERS: os/build/src/paths.ts
=== sentinel B: a code line in bundle.test.ts (describe( 'the boot-attempts ...) ===
-- mandated stripper:      DIFFERS: os/build/src/bundle.test.ts
-- regex-aware stripper:   DIFFERS: os/build/src/bundle.test.ts
=== both sentinels reverted ===
(both strippers: empty)
```

Conclusion: every hunk in all 28 files is comment-only. Zero executable lines,
zero string literals and zero code-line whitespace changed.

## MUST-KEEP items reworded

Every MUST-KEEP class present in these files survives. Items reworded rather
than left byte-identical, one row each:

| # | item | before | after |
|---|---|---|---|
| 3 | debugfs fails on stderr, not exit status (`tools/e2fsprogs.ts`) | `debugfs   ITS STDERR, mostly -- and the detail matters here, so it was MEASURED rather than taken from the comment that describes it. debugfs 1.47.1, ...` + a 7-row table + `So neither signal alone is the verdict: three failure shapes exit 0 and two exit 1` | `debugfs's two signals, measured on 1.47.1, `-w -f <cmds> <img>`, 2026-08-25:` + the same seven measurements folded to three rows (`rc 0, banner only:` / `rc 0, with text:` / `rc 1:`) + `Three failure shapes exit 0 and two exit 1, so neither signal alone is the verdict and both are read below; the empty command file is the row neither signal carries, and debugfsApply refuses it.` |
| 3 | debugfs stderr rule at the call (`tools/e2fsprogs.ts`) | `THE STDERR IS THE VERDICT. debugfs exits 0 even when an individual command inside it failed, so its exit status cannot be the signal` | `The stderr is the verdict: debugfs exits 0 even when an individual command inside it failed, so everything on stderr but the version banner is an error.` |
| 3 | sgdisk silent relocation (`tools/sgdisk.ts`) | `THE OTHER THING sgdisk DOES QUIETLY is move a partition. A requested start that is not a multiple of the alignment is RELOCATED, silently, with a success exit. Measured here on 2026-08-25: `--new=1:64:+32704S` with no `-a 1` lands the partition at sector 2048 and exits 0.` | `sgdisk also relocates silently: a requested start that is not a multiple of the alignment is moved, with a success exit. Measured 2026-08-25, `--new=1:64:+32704S` with no `-a 1` lands the partition at sector 2048 and exits 0` |
| 3 | sgdisk argv-shape measurements (`tools/sgdisk.ts`) | five-row table in the file header, `-a 1 where a start is sector 64   NOT the same: 64 vs 2048` | moved onto `GptSpec` as prose, `... and `-a 1` where every start is already MiB-aligned are all byte-identical. `-a 1` where a start is sector 64 is NOT: 64 against 2048.` |
| 3 | mkfs.vfat does not enforce FAT32 (`tools/mtools.ts`) | `mkfs.vfat -F 32 DOES NOT ENFORCE FAT32. Given a partition too small to hold 65525 clusters it writes a FAT32 boot sector over a filesystem that is not FAT32, exits 0` | `NOT for mkfs.vfat, which does not enforce FAT32 under `-F 32`: given a partition too small for 65525 clusters it writes a FAT32 boot sector over a filesystem that is not FAT32 and exits 0` |
| 3 | replaceAll `$&` expansion (`grub-x64.ts`) | `AND THE REPLACEMENT IS A FUNCTION ... An earlier version of this comment said the right-hand side "has no right-hand-side syntax at all", and that was WRONG: a *string* replacement in JavaScript expands `$&`, `` $` ``, `$'`, `$$` and `$n`.` | `The replacement is a function for the other half of the same problem -- a *string* replacement in JavaScript expands `$&`, `` $` ``, `$'`, `$$` and `$n` ...` (the "earlier version of this comment" framing dropped, as PLAN-015 M6 directs; the rule and the `bdf340e9…` before/after measurement kept) |
| 3 | replaceAll `$&` expansion (`bundle.ts`) | `THE REPLACEMENTS ARE FUNCTIONS, AND THAT IS THE WHOLE POINT. A string replacement is NOT literal in JavaScript ... the first version of this port fixed `&` and reintroduced the same class under `$`` | `The replacements are functions, and that is the whole point: a string replacement is NOT literal in JavaScript ... Measured without the fix: `mos-a$&b` renders as `compatible=mos-a@COMPATIBLE@b`` |
| 2 | single-processor-equivalent mksquashfs pinning (`bundle.ts`, `tools/rauc.ts`) | `rauc's `--mksquashfs-args`, verbatim. rauc drives mksquashfs itself and without them stamps the payload with the wall clock, the build container's uid map and a thread count.` | unchanged in substance, moved from the file header into the post-import block: same sentence |
| 2 | FILE_MTIME before mcopy (`bundle.ts`) | `EVERY STAGED FILE TOUCHED TO FILE_MTIME BEFORE mcopy, because `mcopy -m` takes each entry's mtime from its source.` | `Every staged file touched to FILE_MTIME before mcopy, because `mcopy -m` takes each entry's mtime from its source.` |
| 2 | `--invariant` / `-m` reproducibility (`tools/mtools.ts`) | `REPRODUCIBILITY. `--invariant` on mkfs.vfat (without it the volume-label directory entry carries the wall clock) and `-m` on mcopy (each entry keeps its source's mtime, which the caller has pinned). Both are required fields rather than defaults for the same reason SOURCE_DATE_EPOCH is in mkimage.ts` | `Reproducibility: every mkfs.vfat passes `--invariant`, every mcopy `-m`.` -- the two *reasons* were not deleted, they are the existing per-site comments at `mkfsVfatArgs` ("without it mkfs.vfat derives the volume id from the current time") and `mcopyArgs` ("-m: keep each entry's mtime, which the caller pinned with `touch -d`"), both untouched |
| 2 | verity UUID/salt pinning (`bundle.ts`) | `Neither is recomputed. The dm-verity table is computed in ONE place` | `Neither is recomputed. The dm-verity table is computed in one place` (the salt-against-the-pin rule below it unchanged) |
| 2 | `pin-seeded-times.ts` inode-time argument | 54-line header: `THIS FILE IS AN ARGUMENT, NOT A UTILITY`, `WHAT IT IS FOR`, `WHICH OF AN INODE'S FOUR TIMES ARE THE ASSEMBLER'S NOISE`, `THE INODE SET COMES FROM THE BITMAP, NOT FROM WALKING THE SOURCE TREE`, `AND THE COUNT IS CROSS-CHECKED AGAINST THE SUPERBLOCK`, `WHY THE PORT IS NOT A CALL INTO THE SHELL` | 14-line header + a 14-line post-import block + the bitmap rule moved onto `inUseInodes` + the cross-check onto `refuseUnlessCountsAgree`. Every fact kept: 106 bytes of inode table, `mke2fs -d` copying atime/mtime/ctime, `NO syscall sets ctime -- not touch, not utimensat`, `cp -a` + relatime bumping atime, mtime left alone as the producer's data, `E2FSPROGS_FAKE_TIME` pinning only crtime, the bitmap-not-a-walk rule, the first-non-reserved-inode start, and the superblock cross-check with debugfs's `exits 0 with a clean stderr` |
| 2 | board geometry / bigint precision (`geometry.ts`) | `2. BIGINT, NOT NUMBER. board.ts reads its integers with `Number(t)`, which is exact to 2^53 and silently not beyond it -- and board-env.ts evaluates `$(( ))` in BigInt precisely because "these are byte offsets; ..."` | moved onto `parseInt64`: `Re-read from the string rather than taken from board.ts's `number`, which comes from `Number(t)`: exact to 2^53 and silently not beyond it ... board-env.ts evaluates `$(( ))` in BigInt because "these are byte offsets; past 2^53 a double stops being exact, and a size that is silently one byte out is the class of defect this package exists to make visible."` |
| 5 | stage selection and SOURCE_DATE_EPOCH (`stages.ts`, `stages-cli.ts`) | `IT REFUSES A NAME IT CANNOT FIND, and that is the point of the function rather than a nicety.` / `REFUSED HERE RATHER THAN DEFAULTED, and that is the whole point of the option.` | `It refuses a name it cannot find, which is the point of the function` / `Refused here rather than defaulted, and that is the whole point of the option.` -- the buildkit fact ("takes SOURCE_DATE_EPOCH from the environment; unset ... it stamps the wall clock into the image config and into every entry of the exported layer") is unchanged |
| 2 | the export's reproducibility measurements (`stages.ts`) | three-column table with `SOURCE_DATE_EPOCH   Load-bearing.` / `rewrite-timestamp   Load-bearing, but ONLY when the layer is genuinely rebuilt` / `--provenance/--sbom NOT load-bearing here` | three prose paragraphs carrying the same three verdicts and every number: two exports of one already-built root giving two different archives, two cold rebuilds differing without `rewrite-timestamp` and byte-identical with it, the warm-cache caveat, buildx 0.32.2 adding no attestation to a `type=oci` export, and the `rewrite-timestamp`/`unpack` conflict |
| 7 | design-doc contract citation (`mkimage-v2.ts:14`) | `(docs/design/uboot-ab-handshake.md sections 5.4-5.5)` | unchanged, and still at line 14 |

Not reworded, verified present and byte-identical: the `FILE_MTIME` / `@epoch`
`SOURCE_DATE_EPOCH` derivation block in `geometry.ts` (`git show
$BASE:os/build/src/geometry.ts | sed -n '358,364p'` matches the current
`sed -n '341,347p'` line for line), the `mcopy -m` note in `tools/mtools.ts`,
the `--invariant` note in `mkfsVfatArgs`, and the rauc version cross-check
strings in `tools/rauc.ts` and `bundle.ts` (string literals, untouched).

MUST-KEEP classes with no instance in these 28 files: test-harness safety
(`MOSD_DRY_RUN` / `MOSD_SHADOW_PATH`), protocol/wire facts (shadow(5), bcrypt,
OpenSSH, MQTT, D-Bus), secret-handling rules, the `.PHONY` / pipefail-SIGPIPE
inversion (`Makefile`, out of scope), the mkimage wall-clock fallback
(`os/tests/handshake-test/harness.sh`, out of scope) and the PLAN-014 Scope
quotes (`os/verify/`, out of scope).

## Surviving 15+-line comment blocks

22 of the original 52 survive. Each is a MUST-KEEP enumeration whose items are
individually irreducible; compressing further means deleting a measured number,
a tool quirk or a named constraint. Prose around them was cut hard: the four
largest headers lost 21, 22, 15 and 36 lines respectively.

| block | lines | why it cannot be shorter |
|---|---:|---|
| `bundle.ts:29-58` | 30 | The four things the port has to get right (mcopy order as a written-out list, no `-i`/no slot label with `BUNDLE_BOOT_FAT_LABEL` and `--invariant`, FILE_MTIME before mcopy, `--mksquashfs-args` verbatim) plus the one refusal the shell does not make, quoted with the exact `grep -oE 'BOOT_[AB]_LEFT [0-9]+' \| awk '{print $2}'` pipeline that makes the vacuous pass reachable. Was 50 lines in one block; the module summary above it is now a separate 14-line block. |
| `bundle.ts:257-278` | 22 | Both slots' env files in one bundle, the unsuffixed-name rule, why these checks are not a duplicate of the assembler's, and the two documented differences from `mkverityenv()` (shared sentence for absent `dm-mod.create=`/`dm-mod.waitfor=`, salt additionally required in the table). Five distinct refusals. |
| `bundle.ts:422-442` | 21 | The `$&`/`` $` ``/`$'`/`$$`/`$n` expansion rule, the `sed`-`&` precedent at `os/update/bundle.sh:289`, the measured wrong render `compatible=mos-a@COMPATIBLE@b`, and the two value-shape guards (`^[A-Za-z0-9][A-Za-z0-9._+-]*$`, `mos-<board>`) that make it unreachable today. |
| `bundle.ts:664-681` | 18 | Why `carry` cannot work on the host route, what `provenance: 'shipped'` then claims falsely, and why the refusal lives here rather than in `src/toolbox.ts`. |
| `mkimage-x64.ts:1-17` | 17 | The nine-partition inventory plus the "not `mkimage-v2.ts` with a board parameter" rule and the list of what the two boards genuinely share. |
| `mkimage-x64.ts:28-65` | 38 | Five byte-deciding constraints (pinned debian and its grub package, grub tools run with the work directory as cwd, three `mcopy -m` calls in vmlinuz/initrd.img/cmdline.cfg order against one `mcopy -s -m` of a staged tree with the 18-moving-byte `mmd` measurement, `cp -a` on the host with the SELinux/xattr reason, sectors with `-a 2048`) plus the determinism-control list and the nine-MiB measurement. Was 59 lines. |
| `mkimage-x64.ts:178-200` | 23 | The ESP FAT32 floor: free-vs-total clusters, the measured 129021/129022/117119, why moving the call turns a type check into a free-space check, and the `-F 32` non-enforcement with the OVMF outcome. |
| `mkimage-x64.ts:274-294` | 21 | Why the read-back exists although no x64 start is relocatable, plus the measured `-a 4096` behaviour (ESP 2048 -> 4096, "Information: Moved requested sector", exit 0) against cx3576's exit 4, and the `-a 2048`-vs-no-alignment equivalence. |
| `mkimage-x64.ts:522-548` | 27 | EPHEMERAL seeded at build time with the systemd-networkd-persistent-storage race, the two-call create-then-pin rule with the measured `touch -h` failure text, and why both run in the container. |
| `stages.ts:491-527` | 37 | The two-invocation/one-export rule, the no-`--no-cache` rule, and the three-flag reproducibility record with every measurement (see the MUST-KEEP table). Was 46 lines. |
| `bundle.test.ts:1-16` | 16 | The positive-control rule, the mutation-is-a-mutation rule, and the derived-fixtures rule naming `ROOTFS_A_GUID`/`ROOTFS_B_GUID`, `VERITY_SALT`, the shipped `boot.cmd` and `manifest.raucm.in`. |
| `mkimage-v2.ts:25-56` | 32 | The determinism control list plus the four byte-deciding constraints and the `-a ${GPT_ALIGN_SECTORS}` maskrom consequence. Was 47 lines in one block with the module summary; the summary is now a separate 14-line header. |
| `mkimage-x64.test.ts:1-23` | 23 | Pinned by the reserved HARNESS-pointer sentence at line 13, which may not move; the block cannot end before it. |
| `mkimage-x64.test.ts:424-439` | 16 | The measured relocation *and* shrink (129024 sectors at 4096 vs 131072 at 2048, capped at the next partition's original start 133120) with why a start-only check would misreport it. |
| `mkimage-v2.test.ts:1-22` | 22 | Same reserved-sentence pin at line 13, plus the lowercase/uppercase PARTUUID fixture rule that has to be stated before the fixtures. |
| `toolbox.ts:19-42` | 24 | Three separate rules: the container is the normal route (with this host's missing tools and e2fsprogs 1.46.5), per-toolset not per-tool, and the session timings (~320 ms vs ~40 ms, ~1.3 s apk). |
| `toolbox.ts:296-311` | 16 | The apk retry measurement: 3 failures in 40 runs, the quoted `ERROR: unable to select packages` text, the exit-6 variant, ~7% per install over eight opens, and why three attempts hide nothing. |
| `layout-x64.ts:15-37` | 23 | The three numbered differences from cx3576, each with its shell line number and arithmetic (`os/mkimage-x64.sh:117`, board.env sourced at :74 and read at :119, the 2048 alignment). |
| `layout-x64.ts:186-208` | 23 | Order-off-the-board, the explicit-alignment measurement, and why there is no loader read-back here although `checkPartitionsLanded` still reads the table back. |
| `stages-cli.ts:234-251` | 18 | The quoted three-line buildkit error and the one case it bites (docker-container fallback on an amd64 host building arm64 with no binfmt_misc). |
| `bundle-cli.ts:1-18` | 18 | The seam and epoch rule plus the two resolutions (signing material with its two distinct failure sentences, host architecture vs board). |
| `boot-cx3576.ts:1-17` | 17 | Purity-for-testability plus the GUID case rule, which has to state both spellings and both producers. |

## Gate results

Run from the worktree root after the final content commit (`3e3515d`).

| gate | command | result |
|---|---|---|
| build suite | `MOS_BUILD_CONTAINER=1 bash os/build/run.sh` | `RESULT: PASS (689/689 tests)`, `Ran 689 tests across 25 files.`, **rc=0** (run 3; runs 1 and 3 green, run 2 hit a container-teardown flake -- see below) |
| shell lint | `bash os/tests/shell-pipefail-lint.sh` | `RESULT: PASS (29/29 files clean, 29 scanned)`, **rc=0** |
| `bash -n` | `bash -n os/build/run.sh` (the only `.sh` touched) | **rc=0** |
| shebang | `diff <(git show $BASE:os/build/run.sh \| head -1) <(head -1 os/build/run.sh)` | identical; `head -1 \| cat -A` reads `#!/usr/bin/env bash$` |
| comment-only proof | mandated stripper over 28 files | one line, `DIFFERS: os/build/src/bundle.test.ts`, explained above |
| comment-only proof | regex-aware stripper over 28 files | empty, sentinel-validated |

Build suite, verbatim tail:

```
 689 pass
 0 fail
 3892 expect() calls
Ran 689 tests across 25 files. [325.06s]
RESULT: PASS (689/689 tests)
[exited with code 0]
```

The count is unchanged from `main`'s 689/689 across 25 files, which is what a
comment-only pass must produce. The container route is the CI route; the host
bun (1.3.13) cannot read this `bun.lock` (lockfileVersion 2), so a bare
`bash os/build/run.sh` fails at `main` too.

### The one red run, and why it is not this change

The suite was run three times. Run 1 (before the `run.sh` header split) and
run 3 (after it) are `RESULT: PASS (689/689 tests)` rc=0. Run 2 was:

```
 689 pass
 1 fail
 3892 expect() calls
Ran 690 tests across 25 files. [279.93s]
RESULT: FAIL (bun test exited 1; 689 passed of 690 run)
rc=1

1 tests failed:
(fail) (unnamed) [5000.56ms]
  ^ a beforeEach/afterEach hook timed out for this test.
```

The same 689 named tests passed in that run; the extra unit is an unnamed hook.
It is `mkimage-v2.test.ts:127`

```
afterAll(async () => {
  await tb?.close()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})
```

-- a `docker rm` of the assembly container, timing out at bun's 5 s default
(`5000.56ms`). Two facts rule this change out as the cause:

- that hook is byte-identical to the merge base
  (`diff <(git show $BASE:os/build/src/mkimage-v2.test.ts | sed -n '127,140p') <(sed -n '127,140p' ...)`
  is empty), and
- the only file that changed between the green run 1 and the red run 2 was
  `os/build/run.sh`, whose executable content is byte-identical to the base:
  filtering the whole `git diff` of that file to non-comment, non-blank lines
  yields nothing at all, and its stripped-comment form matches the base exactly.

L2 independently reached `RESULT: PASS (689/689 tests)` rc=0 for this gate on
its own branch at 20:05 UTC, on this host. Recorded as a container-teardown
flake; not chased further.

Shell lint, verbatim tail:

```
PASS: os/verify/run.sh pipes nothing into an early-exiting grep
PASS: test/apid-api/run.sh pipes nothing into an early-exiting grep
RESULT: PASS (29/29 files clean, 29 scanned)
```

## Notes

- On the rule-3 target: L1 withdrew the numeric "single digits" goal for
  15+-line blocks in favour of the justified-survivor rule, so this pass stops
  where facts begin rather than compressing to a number. Each of the 22
  survivors is named above with the constraint the next line removed would
  cost. No second pass was made.
- The two HARNESS-pointer sentences at `os/build/src/mkimage-v2.test.ts:13` and
  `os/build/src/mkimage-x64.test.ts:13` are reserved by L1 for the sibling docs
  workstream and were left verbatim; see the section above for the diff that
  shows only the sentences around them changed.
- Nothing outside the 28 files and this task file was edited.
  `docs/task/index.md` was deliberately left alone; the workstream's finisher
  subtask writes every claim line at once.
- `os/build/run.sh` had a 32-line header block that the dispatch's per-file
  measurement did not surface (its shebang counts as a comment line). It was
  split: usage above `set -euo pipefail`, the package rationale below it, and
  the "zero tests is a failure" measurement moved down to the guard it
  describes. Both of that file's 15+-line blocks are gone.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
