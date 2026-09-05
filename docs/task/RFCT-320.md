# RFCT-320 Three small truths: the cx3576 kernel stamp, and two documents that said something false

- **status**: completed
- **priority**: P2
- **owner**: three-small-truths/bkd-24shakyy
- **createdAt**: 2026-09-05 02:10
- **completedAt**: 2026-09-05 02:14

## Description

Three unrelated, well-bounded corrections. None needed a design decision, and
none was verified by execution: this batch traded per-task verification for
wall-clock, so the floor here is "it parses", and what that leaves owed is
stated in §5 rather than blurred.

1. `boards/cx3576/bsp/kernel/Dockerfile` pinned none of
   `KBUILD_BUILD_TIMESTAMP`, `KBUILD_BUILD_USER`, `KBUILD_BUILD_HOST`;
   `boards/x64/bsp/kernel/Dockerfile` pins all three. RFCT-304 measured the
   consequence: two builds of one unchanged cx3576 tree gave an `Image` of
   equal size and different sha256, so that task compared the kernel by size.
2. `docs/design/api.md` called the observation behind `GET /api/v1/network`
   "normalized". RFCT-298 found that only the top level is: the per-interface
   `addresses`, `dns` and `routes` arrays are copied through verbatim, so
   `ProtocolString: "16"` is readable there. RFCT-298 left the data alone, for
   a reason that stands; the document had to stop over-claiming.
3. `docs/design/build.md` listed the builder family as `{base,c,go,rust}`.
   The tree has `deb` (since the flatten, 69febcae) and `rust-check` (RFCT-309,
   68bd0452). The task named line 41; the row is at line 219 today, the file
   having been restructured since the note in RFCT-309 was written.

## ActiveForm

Pinning the cx3576 kernel stamp and correcting two documents.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- cx3576 pins the three `KBUILD_BUILD_*` strings to the values x64 pins, taken
  from the same source, with no second convention introduced.
- `docs/design/api.md` no longer claims a normalization the view does not
  have: it says which parts are normalized, which are passed through, and why.
  The API is unchanged.
- `docs/design/build.md` lists the whole builder family. Every other place
  that enumerates the family was checked; each was either brought into
  agreement or is named here with the reason it was left.
- The code parses. No tests written or run, no image, deb pool or compose
  built. What was not verified is stated.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`
  untouched; `main` merged before the report.

## 1. The cx3576 kernel stamp

**Where x64 takes the values from.** An `ENV` block in
`boards/x64/bsp/kernel/Dockerfile`, immediately before the `make bzImage
modules` step: `KBUILD_BUILD_TIMESTAMP="@1577836800"`, `KBUILD_BUILD_USER=mos`,
`KBUILD_BUILD_HOST=mos-build`. The timestamp is a literal in that file, and its
comment names the source of the number: 1577836800 is 2020-01-01T00:00:00Z,
the constant `boards/x64/board.env` pins as `FILE_MTIME` and
`E2FSPROGS_FAKE_TIME` and `rootfs/build.sh` passes as `SOURCE_DATE_EPOCH`.

**cx3576 now does the same.** `boards/cx3576/board.env` pins the identical
`FILE_MTIME=@1577836800` and `E2FSPROGS_FAKE_TIME=1577836800`, so the same
`ENV` block, with the same three literals, now sits in
`boards/cx3576/bsp/kernel/Dockerfile` before its `make Image modules` step.
The comment there says what it pins, cites RFCT-304's measurement as the
reason, and points at the board's own `board.env` for the number. No shared
variable was introduced to carry the value between the two Dockerfiles: that
would be a refactor of x64's convention, and the task was to adopt it.

The `ENV` also covers the DTB build that follows in the same stage. That build
stamps nothing, so this is harmless rather than intended.

## 2. `docs/design/api.md` — what is normalized, and what is not

**What the code does**, read rather than assumed. In
`pkgs/mosd/mosd/src/network_state.rs`, `describe()` runs networkd's `Describe`
document through `normalize`: it emits an `interfaceCount` and an `interfaces`
array, and for each interface copies a fixed allowlist of seventeen members
under camelCase names — `Index`→`index` through `HardwareAddress`→
`hardwareAddress`, and `Addresses`→`addresses`, `DNS`→`dns`,
`Routes`→`routes`. Every other per-link member networkd reports is dropped.
For the three arrays only the key is renamed; the value is `clone()`d, so its
elements keep networkd's own key names and values. In
`pkgs/mosd/apid/src/routes.rs`, `api_v1_network_read` deserialises each
interface into `ObservedInterface`, which types the scalar members and holds
`addresses`, `dns` and `routes` as `Vec<Value>` — untouched.

**What the document now says.** The observation is normalized at the top level
only; the allowlisted members are named; the three arrays are passed through
verbatim, with networkd's key names (`Family`, `Address`, `PrefixLength`,
`Destination`, `Gateway`, `ProtocolString`, …) and networkd's values, so a
route whose protocol networkd cannot name reads `ProtocolString: "16"` there;
and why — a reader of those arrays is reading systemd's document, not this
API's vocabulary, and naming those members would be a second vocabulary for
the same facts, a design decision rather than a normalization. The sentence
on observation failure is unchanged.

**Not changed.** The API and its OpenAPI text: the route's response description
is "Configured interfaces and the current systemd-networkd observation", which
claims no normalization, so nothing in code needed to move. `docs/design/
diagnostics.md`'s one mention of `ProtocolString` already says it cannot be
used for a name, which agrees with this. `docs/zh/design/api.md` carries no
sentence about the networkd observation, so there is nothing to mirror.

## 3. The builder family — every list, and what was done with each

**The truth** is `build-env/build.sh`'s `IMAGES` array: six rows — `base`,
`c`, `deb`, `go`, `rust`, `rust-check` — with `rust-check` the one row whose
parent is `mos-build-rust` rather than the base, and an ordering check that
enforces parent-before-child.

| Where the family is enumerated | Said | Now |
|---|---|---|
| `docs/design/build.md`, the producers' inputs table | `{base,c,go,rust}` | **fixed** — six |
| `docs/zh/design/build.md`, the same row | `{base,c,go,rust}` | **fixed** — six, so the mirror does not disagree with the page it mirrors |
| `Makefile`, the comment above the `build-env` target | `mos-build-{c,go,rust} are FROM it`; "All four assert by USE" | **fixed** — `{c,deb,go,rust}` are FROM the base and `rust-check` is FROM `mos-build-rust`; what `deb` and `rust-check` assert is stated from their Dockerfiles (`deb` runs its dpkg tools' `--version` against floors; `rust-check` asserts clippy against rustc's own release and nextest and deny exactly), and "all four" is now "base, c, go and rust", which is what it always meant |
| `docs/plan/PLAN-080.md`, the producers table | `{base,c,deb,go,rust}` | **fixed** — the one token. Its evidence column says `line 538`; the `docker buildx build "${BUILDER_ARGS[@]}"` line is 548 today. Left: that column is the plan's own dated evidence and the plan is RFCT-310's, still implementing |
| `Makefile` help text (`make help`, the `build-env` line) | six | already right |
| `build-env/build.sh`, its header | six | already right |
| `pkgs/podman/README.md` and `pkgs/podman/Dockerfile`: "the four builder images `{base,c,go,rust}`" | four | **left, not a disagreement**: both describe the images podman's own stages are FROM (`src` and `verify` on base, `c-build`, `rust-build`, `go-build`), and that is true — podman stands on neither `deb` nor `rust-check` |
| `docs/task/RFCT-309.md`, *Still open* | records the old `{base,c,go,rust}` line | left — it is that task's record of what it found and did not touch |

## 4. Not changed

- `boards/x64/bsp/kernel/Dockerfile` and both `board.env` files.
- The network API, its OpenAPI text, mosd's `normalize`, apid's
  `ObservedInterface`.
- `docs/plan/index.md`, `docs/task/index.md`, `docs/CHANGELOG.md`.
- `docs/task/RFCT-309.md`, `pkgs/podman/README.md`, `pkgs/podman/Dockerfile`.

## 5. What was NOT verified — read before trusting §1

- **No cx3576 kernel was built**, so the property the pin exists for — two
  cold builds of one unchanged tree yield one `Image` sha256 — is asserted
  from x64's precedent and the kernel's documented behaviour, not measured.
  RFCT-304 could not get that equality (equal size, `559d7669…` vs
  `5bb2f1b2…`); the next cx3576 kernel build is where it is owed. Pass
  criterion: same `Image` sha256 across two `docker-container` builders that
  cannot replay each other's cache, and no `root@buildkitsandbox` in
  `strings Image`.
- **How the timestamp renders** in `uname -v` was not checked on this 6.1
  vendor tree. The value is constant either way; only whether the kernel
  prints it through `date` or as the literal `@1577836800` is open, and x64
  carries the same question.
- **No test suite ran, and `make docs-verify` did not run.** Its index and
  link checks exclude `docs/task/` and `docs/plan/` by design; the design
  edits add no links and change one token in one table cell each.

## 6. Gate results — 2026-09-05, in `/srv/bkd/worktrees/33z9aa5q/24shakyy`

| Gate | Result |
|---|---|
| `docker buildx build --check` on the edited cx3576 kernel Dockerfile (BuildKit parse and lint, no build) | **one warning, pre-existing**: `InvalidDefaultArgInFrom` at the `FROM` line. The identical single warning is reported for HEAD's copy of the file, checked the same way; the added `ENV` block reports nothing. x64 skips that rule with a `# check=skip=` directive; cx3576 never did, and adding one is not this task's |
| `make -n build-env` after the comment edit | **ok** — the Makefile parses |
| `cargo`, `bun`, `tsc` | not applicable — no Rust or TypeScript touched |
| `cargo test`, `bun test`, `make docs-verify`, image or pool build | **not run**, by this batch's working mode |
