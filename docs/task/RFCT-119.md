# RFCT-119 PLAN-016 M3: the spec-identity check and the oasdiff breaking-change gate

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-26 15:30
- **claimedAt**: 2026-08-26 15:30
- **completedAt**: 2026-08-26 16:20
- **plan**: PLAN-016 (M3)

Two steps in `.gitea/workflows/check.yml`'s existing `rust` job, after
`mosd/hack/check.sh`. The first proves the shipped `--openapi` flag still
prints the committed document. The second turns `docs/design/api.md` §2.1's
breaking-vs-additive lists into a machine check against the base branch.

## Scope

- `.gitea/workflows/check.yml`: two steps appended to the `rust` job. No new
  job, no other job touched, no helper script added to the tree.
- Nothing else. No Rust source, no `openapi.json`, no `mosd/hack/check.sh`,
  no Makefile.

## Why the steps live in the `rust` job

That job has already installed the workspace-MSRV toolchain and built the
workspace by the time `mosd/hack/check.sh` returns, so regenerating the
document costs one incremental link there and a full cold build anywhere
else. The oasdiff step is cheap on its own but reads the same file, and
splitting the two across jobs would mean two checkouts to answer one
question about one file.

## What step one adds over the in-tree test

M1's `the_committed_openapi_document_is_the_generated_one` already compares
`include_str!("../openapi.json")` against the generator's output inside
`cargo test`, and `mosd/hack/check.sh` runs it. This step therefore catches
**no drift that test misses**, and the comment in the workflow says so.

What it does add is coverage of the `--openapi` FLAG PATH: `wants_openapi`
and the early return in `apid`'s `main()`, above daemon initialisation. The
test calls `openapi::document_json()` directly and never goes near argv, so a
flag that stopped being recognised, or that started reaching for the bus or
the key material before it printed, would leave the test green while the
regeneration command every developer is told to run stopped working.

`mosd/hack/check.sh` does `cd "$(dirname "$0")/.."` and runs from `mosd/`;
this step runs from the repository root, which is why it passes
`--manifest-path mosd/Cargo.toml`.

## The pinned oasdiff binary

| | |
|---|---|
| version | **1.29.1** (tag `v1.29.1`) |
| source | `github.com/oasdiff/oasdiff` — the project moved off the `Tufin` org |
| asset | `oasdiff_1.29.1_linux_amd64.tar.gz` |
| sha256 | **`541f7c66c933495fceef24eaf5c48aa66c19069f366f7bd0a60a6a4820c5e533`** |

1.29.1 was the latest release when this landed, confirmed against the
releases API, and the sum was computed from the downloaded asset rather than
copied from anywhere:

```
$ curl -sSfL -o oasdiff.tar.gz \
    https://github.com/oasdiff/oasdiff/releases/download/v1.29.1/oasdiff_1.29.1_linux_amd64.tar.gz
$ sha256sum oasdiff.tar.gz
541f7c66c933495fceef24eaf5c48aa66c19069f366f7bd0a60a6a4820c5e533  oasdiff.tar.gz
$ ./oasdiff --version
oasdiff version 1.29.1
```

The step verifies it with `sha256sum -c -` before unpacking and runs
`--version` afterwards, which is the shape `cargo-deny` and `cargo-nextest`
are pinned with a few steps above.

## Fetching the base spec

The step does its own `git fetch --depth=1 origin "$base"` rather than
setting `fetch-depth: 0` on the job's checkout. The diff reads one path at
one commit; `fetch-depth: 0` would fetch the repository's entire history on
every run of a job whose other five steps do not need a single extra commit.
The base ref comes from `${{ github.base_ref }}`, which is set on
`pull_request` and empty everywhere else.

## The ERR threshold is narrower than §2.1, deliberately and not silently

`oasdiff breaking --fail-on ERR` fails on api.md §2.1's list where oasdiff
rates those changes `error`, which covers removing a route
(`api-path-removed-without-deprecation`), removing a response field
(`response-required-property-removed`), narrowing a type
(`response-body-type-changed`), adding a required request field
(`new-required-request-property`) and removing a success status
(`response-success-status-removed`).

It does **not** cover one item on that list. Removing a documented non-success
response — dropping the `401` from `GET /api/v1/meta`, which changes which
`error.code` a failure emits — is `response-non-success-status-removed`, and
oasdiff rates it `info`:

```
$ oasdiff changelog openapi.json openapi.401-removed.json
1 changes: 0 error, 0 warning, 1 info
info	[response-non-success-status-removed] at openapi.401-removed.json
	in API GET /api/v1/meta
		removed the non-success response with the status `401`
```

Lowering the threshold to WARN does not catch it either — it is INFO, not
WARN — and would fail changes §2.1 explicitly calls additive. So the
threshold stays at ERR, api.md's written list stays the contract, and the
workflow comment states the gap rather than implying the tool decides
everything.

## Proofs, run by hand because CI cannot be run from here

Both step bodies were extracted verbatim from the committed YAML and executed.

### Step one, on the current tree

In the pinned `localhost/mos-build-rust` image, from the repository root:

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.63s
     Running `mosd/target/debug/apid --openapi`
mosd/apid/openapi.json matches apid --openapi
```

### Step two, breaking: a removed response field

`error.source` was removed from `ApiErrorDetail` — api.md §2.1's "removing a
response field" — in a copy written outside the repository, and pushed to a
scratch remote as the PR branch against a base that carries the real spec.
The step body ran against a genuine `--depth=1` clone:

```
From file:///tmp/oasgate/upstream
 * branch            trunk      -> FETCH_HEAD
/tmp/tmp.A0ZgGLEgiw/oasdiff.tar.gz: OK
oasdiff version 1.29.1
base: trunk at 15cddba
9 changes: 9 error, 0 warning, 0 info
error	[response-required-property-removed] at mosd/apid/openapi.json
	in API GET /api/v1/meta
		removed the required property `error/source` from the response with the `401` status

error	[response-required-property-removed] at mosd/apid/openapi.json
	in API GET /api/v1/settings/{path}
		removed the required property `error/source` from the response with the `401` status

error	[response-required-property-removed] at mosd/apid/openapi.json
	in API GET /api/v1/settings/{path}
		removed the required property `error/source` from the response with the `422` status

...four more, one per remaining documented failure status...

error: the changes above are breaking under docs/design/api.md §2.1.
       A correct v1 client can be broken by them, so they need a new
       version path rather than an edit to this one.
rc=1
```

Removing the route instead — §2.1's first item — is the same verdict from a
different rule:

```
1 changes: 1 error, 0 warning, 0 info
error	[api-path-removed-without-deprecation]
	in API GET /api/v1/meta
		api path removed without deprecation
rc=1
```

### Step two, additive: a new response field

A new optional `buildCommit` property on `ApiMeta`, same harness:

```
base: trunk at 15cddba
No breaking changes to report, but the specs are different.
Run 'oasdiff diff' to see structural differences.
rc=0
```

### Step two, both skips

A `push` event, where `github.base_ref` is empty:

```
skipped: no base branch on a push event, so there is
         no committed spec to diff mosd/apid/openapi.json against.
rc=0
```

A `pull_request` whose base branch predates the spec — the case this
milestone itself lands in:

```
From /tmp/oasgate/upstream
 * branch            trunk      -> FETCH_HEAD
skipped: trunk carries no mosd/apid/openapi.json, so every path in this
         spec is new and nothing can have been broken.
rc=0
```

Both print. Neither exits 0 in silence, which is the only thing that
distinguishes a skip from a check that passed.

No modified spec was ever written inside the repository: the copies live in
`/tmp` and in a scratch git remote under `/tmp/oasgate`.

## Acceptance

- Both steps are in the `rust` job, after `mosd/hack/check.sh`. The
  `offline-suites` and `os-verify` jobs are byte-identical to before.
- oasdiff is pinned by version and sha256 and verified with `sha256sum -c -`.
- The gate fails on a §2.1-breaking change and passes on an additive one.
- Both skip paths print their reason.
- `bash docs/verify-index.sh` exits 0.

## Known gaps

- `response-non-success-status-removed` is INFO, so that one §2.1 item is not
  mechanised. Documented above and in the workflow comment.
- `cargo test --workspace --locked` failed once on
  `apid tests::the_audit_trail_records_the_login_lifecycle_and_never_the_password`
  with `left: 401, right: 429` — the login rate limiter answering a request
  the test expected to reach authentication. It passed on the next four full
  runs, including three consecutive `-p apid --bin apid` runs, and this task
  changes only YAML and markdown, so it is a pre-existing order- or
  load-sensitive flake and not a regression from here. Out of PLAN-016's
  scope to fix; recorded so the next reader of a red run has seen it before.
- The steps have not run on a real Gitea runner; they were exercised by
  extracting the committed step bodies and running them here. The runner-side
  variables they depend on are `github.base_ref` and `github.event_name`,
  both of which Gitea Actions populates the same way GitHub does.

## Dependencies

- Follows RFCT-117 (the `--openapi` flag and the committed document) and
  RFCT-118 (the read-only slice the spec now covers).
