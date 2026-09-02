# PLAN-062 Add uploadable versioned custom UI packages

- **status**: completed
- **createdAt**: 2026-09-02 00:25
- **approvedAt**: 2026-09-02 00:31
- **completedAt**: 2026-09-02 01:27
- **relatedTask**: [UI-007](../task/UI-007.md)

## Context

APID already has most of a safe custom-UI store. It validates staged trees,
rejects irregular entries and hardlinks, requires a root `index.html`, checks
an optional `mos-ui.json`, computes a tree digest, records API compatibility,
renames installation atomically and switches a `current` symlink. It can list
numbered generations internally, delete an inactive generation and recover
from broken active bundles.

The product surface is intentionally smaller. There is no network upload or
archive parser; `PUT /api/v1/ui/active` selects only the newest usable retained
generation; status exposes at most one candidate; activation automatically
prunes to the current and one previous generation; and the built-in UI says no
upload API exists. Operators therefore need a root shell to stage files, even
though SSH is off by default. The API design already parks authenticated,
bounded upload as its Phase 5.

The requested multi-version workflow also changes installation semantics. An
upload should not unexpectedly replace `/`; validation/install and selection
must be separate operations, and retained versions must not disappear through
automatic pruning.

## Proposal

### Package format and host tool

Define `.mos-ui.zip` as a ZIP whose root directly contains `index.html`, a
required `mos-ui.json` and its static tree. Uploaded packages require manifest
schema 1:

```json
{
  "schemaVersion": 1,
  "name": "example-console",
  "version": "1.4.0",
  "immutableDir": "assets",
  "apiVersions": ["v1"]
}
```

`name` and `version` are display/provenance fields, not filesystem paths.
Reject an identical package as already installed and reject a different digest
claiming the same `(name, version)` as a version conflict. Existing manually
installed manifest-less trees remain visible as legacy/unchecked generations,
but the upload path never creates a new one.

Add a Rust workspace crate with shared manifest/path/limit definitions and a
standalone `mos-ui-pack` binary:

- `mos-ui-pack pack <dist> --name ... --version ... --api-version v1 -o ...`
  walks without following symlinks, validates required files and writes sorted
  entries with normalized modes/timestamps for reproducible output;
- `mos-ui-pack inspect <package>` prints the manifest, compressed/expanded
  sizes, entry count and SHA-256 and exits non-zero on any server-side format
  violation;
- the tool does not sign packages or weaken server validation. It prepares a
  transport artifact; authenticated APID remains the authority that installs.

### Bounded upload and atomic install

Add authenticated `POST /api/v1/ui/bundles` with
`Content-Type: application/zip`. A browser sends the selected `File` as the raw
body, so no multipart dependency or filename parsing is needed. Bearer tokens
and browser sessions use the existing credential model; browser requests also
require CSRF.

Stream chunks to a mode-0600 `.part` file under `/mos/ui/staging/<upload-id>/`
and enforce the compressed bound while writing; never collect the body into
RAM. PLAN-061's mount/readiness check is a prerequisite; upload returns a named
storage-unavailable error if `/mos/ui` is not a writable DATA subtree and never
falls back to `/srv`, `/var`, `/tmp` or rootfs. After upload, run ZIP
inspection/extraction in `spawn_blocking` and enforce
all of these defaults while both reading metadata and writing bytes:

- 64 MiB compressed upload;
- 256 MiB total expanded bytes;
- 32 MiB for one file, matching the asset-serving ceiling;
- 4,096 entries, 32 path segments and 240 UTF-8 bytes per logical path;
- at most 100:1 aggregate expansion;
- no absolute/empty/dot/parent/backslash/control/residual-escape names,
  duplicate logical names, encrypted entries, symlinks or other special types.

Extraction creates new files with exclusive create, does not honor archive
permissions, and accounts actual bytes rather than trusting central-directory
sizes. Then reuse the store's tree walk, manifest/API compatibility, mode,
digest, fsync and atomic rename. Allocate the next checked `u64` generation
under the existing UI-selection mutex. Delete the transport ZIP after a
successful install; installed bytes and records are the retained package.
Startup removes only provably inactive staging directories and never a bundle
or upload currently being committed.

Uploading installs but does **not** activate. The old active symlink remains
unchanged on every upload error, incompatibility, interruption or successful
installation. Audit accepted and refused installs without logging archive
content, client filenames or secrets.

### Multi-version API and retention

Use typed JSON resources:

| Method | Path | Meaning |
|---|---|---|
| `GET` | `/api/v1/ui` | active mode and compact selection summary, retained for current clients |
| `GET` | `/api/v1/ui/bundles` | every retained generation with name/version, digest, sizes, compatibility, usability and active flag |
| `POST` | `/api/v1/ui/bundles` | upload and atomically install one ZIP; return `201` with the installed generation |
| `PUT` | `/api/v1/ui/active` | select exactly `{ "generation": N }` after revalidation |
| `DELETE` | `/api/v1/ui/active` | select built-in without deleting packages |
| `DELETE` | `/api/v1/ui/bundles/{generation}` | delete one inactive generation after confirmation |

The existing empty-body `PUT /active` changes to a required typed body; this is
an intentional pre-release v1 cleanup and will be reflected in OpenAPI and all
clients. Selection never accepts a path. It finds an installed numeric
generation, reruns tree digest and compatibility checks, then atomically points
`current` at it.

Remove automatic two-generation pruning. Refuse a 33rd retained generation
until the operator deletes one, and refuse an upload that cannot preserve a
128 MiB DATA headroom after worst-case extraction. Never silently delete a
version to make room. PLAN-049 may later replace the fixed headroom with a
global reservation policy.

Map oversized bodies to 413, invalid ZIP/tree/manifest to 422, duplicate,
version conflict, incompatibility or retained-count exhaustion to 409, and
insufficient DATA headroom to 507. All use the existing path-free API error
envelope. Unexpected filesystem errors are logged server-side and return a
generic 500.

### Built-in UI workflow

Add `/_ui/system/ui` and keep a compact current-selection summary on System.
The dedicated page contains:

- built-in/custom current state and permanent `/_ui/` recovery link;
- a file picker/drop zone accepting one `.zip`, with client-side size hint but
  server-side authority;
- upload byte progress followed by separate validating/installing phases;
- a retained-version table showing name, version, generation, digest status,
  API compatibility, size and active state;
- explicit Activate, Return to built-in and Delete actions. Delete is disabled
  for the active generation and requires a named confirmation.

Use the existing shadcn `base-nova` + Base UI primitives, Spectrum tokens,
light/dark/system themes and typed English/Simplified Chinese catalogs. Upload
must remain usable by keyboard, announce progress/errors, preserve a selected
file after a recoverable validation error and never navigate away from
`/_ui/` when activating a custom root.

### Test and delivery sequence

1. RED store/API tests for selecting a non-newest generation and for install
   without autoactivation or pruning.
2. Archive corpus tests for traversal, encoded separators, absolute paths,
   duplicates, symlinks, encrypted/special entries, size/count/depth/ratio
   bombs, truncated uploads and power-loss staging.
3. Store tests for duplicate/version conflict, generation overflow, capacity,
   active-delete refusal, revalidation and atomic pointer preservation.
4. Auth/CSRF/error-envelope/OpenAPI/e2e tests, including streaming memory
   behavior and an upload whose active predecessor survives every refusal.
5. Packaging-tool reproducibility and pack/inspect parity tests using the same
   malicious corpus.
6. Frontend query/mutation, progress, keyboard/a11y, bilingual and theme tests;
   regenerate the embedded tree and update both UI guides plus user/API docs.

## Risks

- ZIP is hostile input reachable over the network. Bounds must be enforced on
  actual streamed/extracted bytes, and extraction must run off the async
  scheduler and beneath a private staging root.
- An authenticated administrator can install arbitrary same-origin JavaScript.
  That is the purpose of custom UI and equivalent to granting control of the
  management client; the UI must state this clearly. It does not grant server
  code execution, filesystem paths or an authentication bypass.
- Unsigned UI packages lack publisher provenance. The accepted authority is
  the authenticated local administrator and the audit event. OS update bundles
  remain separately RAUC-signed; no “install anyway” crossover is allowed.
- Retaining multiple expanded trees consumes DATA shared with updates,
  containers, applications and user files. Per-package bounds, count limit,
  headroom refusal and explicit deletion prevent silent eviction but do not
  replace PLAN-049's global quota policy.
- Changing `PUT /active` from empty to typed JSON can break an early external
  client. Keeping the old “newest” behavior would make exact selection
  ambiguous; the proposal chooses the explicit contract and documents the
  break.
- The packaging tool and server can drift. Sharing schema/path/limit code and
  replaying one malicious corpus against both keeps the server authoritative
  and the tool predictive.

## Scope

In scope: package schema; Rust packaging CLI/shared crate; raw streaming ZIP
upload; archive limits and extraction; APID store/list/install/select/delete;
multi-version retention; auth, CSRF and audit; OpenAPI; `/_ui/system/ui`;
i18n/themes/a11y; embedded frontend build; test corpus; current API, design,
development and user documentation; `/mos/ui` integration after PLAN-061
Phase A.

Out of scope: UI-package signing or marketplace distribution; remote URL
download; automatic activation; auto-update; delta packages; arbitrary server
executables/systemd units; OS update upload; application catalog packages;
global DATA quotas beyond the local bounds; Phase-B DATA mount migration.

## Alternatives

1. **Keep shell-only staging.** Safe but unavailable on default devices and
   does not meet the page-upload requirement; rejected.
2. **Multipart upload.** Useful for side metadata, but all authoritative
   metadata is inside the package and multipart adds another parser; raw ZIP
   is selected.
3. **Upload an unpacked file tree.** Browser directory semantics are
   inconsistent and atomic validation is harder; rejected.
4. **Automatically activate a successful upload.** Fewer clicks, but a trial
   package unexpectedly replaces `/`; rejected in favor of explicit selection.
5. **Keep only current and previous.** Existing behavior bounds storage but
   deletes versions the operator expects to choose; rejected.
6. **Retain original ZIP plus extracted tree.** Improves export but nearly
   doubles storage. The deterministic host package remains the source artifact;
   APID retains the verified installed tree and digest only.
7. **Require signatures now.** Strong publisher provenance, but key lifecycle,
   revocation and marketplace trust are not defined. Local authenticated admin
   authority is selected for this slice; RAUC signature policy is unchanged.

## Annotations

- 2026-09-02: Created after the user requested browser ZIP upload, a provided
  package tool, multiple retained custom UI versions and explicit selection.
- 2026-09-02: User approved the default package, streaming upload,
  install-without-activation, explicit selection and retention contracts.
- 2026-09-02: Delivered the shared pack/inspect library and CLI, bounded APID
  upload and lifecycle API, built-in UI workflow, embedded build and guides.
