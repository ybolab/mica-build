# RFCT-166 PLAN-019 M2: podman and rauc move under os/pkgs/

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-019 (M2)

The first move of the campaign, and the one chosen to go first because it is
the one whose first path segment survives it. `os/podman/` and `os/update/rauc/`
both become children of `os/pkgs/`, so every gated citation into them keeps `os`
as its first segment and stays in scope for `docs/verify-citations.sh` through
the whole edit. Nothing about that is true of the two moves that follow, which
is why they were sequenced after it.

`os/pkgs/README.md` is created here, stating the directory's organising rule
before its last two members arrive: a child of `os/pkgs/` holds source this
repository compiles into a shipped artefact.

## Scope

| file | change |
| --- | --- |
| `os/podman/**` | `git mv` to `os/pkgs/podman/**` |
| `os/update/rauc/**` | `git mv` to `os/pkgs/rauc/**`; `os/update/` has no tracked children left and is gone |
| `os/pkgs/README.md` | new; the organising rule, migration row 13 |
| `.gitignore` | the rauc block and the `out-*`/lock rules |
| `Makefile` | `os-devkeys`, `os-rauc`, `podman`, and the help line |
| `os/build/src/**`, `os/verify/src/**` | path constants, including six built from segments |
| `os/rootfs/**`, `os/build-env/**`, `os/tests/**` | scripts, stages and overlay templates |
| `os/boards/*/board.env` | comment headers |
| `docs/design/{api,dashboard,boards}.md` | 18 gated citations, prefix-only |

## The asymmetry that made this two moves rather than one

The two trees do not move the same distance, and the arithmetic in their own
scripts is what records it.

`os/pkgs/rauc` sits at the same depth as `os/update/rauc`, so every rauc path
expression is byte-identical after the move: `build.sh`'s `REPO_ROOT` (three
levels up), its `LAYOUT_ENV` reach into `os/boards`, `render-config.sh`'s
`REPO_ROOT`, and its `shellcheck source=` directive.

`os/pkgs/podman` is one level *deeper* than `os/podman` was. Both statements of
that arithmetic changed: the comment above `podman/build.sh`'s `REPO_ROOT` and
the error message below it now say three levels rather than two. A move that
changes a script's depth changes every prose statement of that depth too, and
the comment is the half a test will not catch.

## The consumer class a string grep cannot see

Six consumers build their path from segments rather than writing it as one
string, so `git grep -F 'os/podman'` never reaches them:

- `os/build/src/bundle.ts`, `bundle-cli.ts`, `toolsets.ts` — `join(OS_DIR, 'update', 'rauc', ...)`
- `os/verify/src/smoke-pins.ts` — `join(OS_DIR, 'podman', ...)`
- `os/build/src/tools.test.ts` and one more test expectation — escaped regex
  literals inside `.toThrow(/.../)`, where the separator is spelled `\/`

This class is the reason PLAN-019's proof obligation is five sweeps rather than
one grep, and it recurred at M4.

## Measurements

- `docs/verify-citations.sh`: 902/902 before and after, with the 355 quoted /
  547 resolution-only split and every skip bucket unchanged.
- The 18 rewritten citations are prefix-only: no line number moved and no quoted
  fragment was retouched.
- `git ls-files os/update` returned 8 paths before the move and 0 after.

## Reported, not acted on

- `os/pkgs/rauc/build.sh:63` pins `--builder default` while its
  `FROM localhost/mos-build-*` stages need that image family reachable from
  whichever builder runs them, so the rootfs/rauc chain is unrunnable on this
  host. Carried forward from RFCT-163; not this milestone's defect.
