# apid: an API-first management daemon with replaceable UI

> **Current status (PLAN-039/040/060/061/062/066, 2026-09-02): implemented.** The management daemon
> is API-first. Every appliance read, write, authentication operation and action
> is under `/api`; `/healthz` is the listener-only operational exception. The
> built-in UI is a React SPA embedded in `apid` and served at `/_ui/`. `/` serves
> a valid active custom UI and otherwise redirects to `/_ui/`.
>
> The long proposal and measurement history below is retained because it records
> the decisions that produced the API. Any older statement that the built-in UI
> is server-rendered Maud, that `/builtin` is the recovery prefix, that a browser
> cookie cannot authenticate the API, or that the API is read-only is
> superseded by this current-contract note and by
> `pkgs/mosd/apid/openapi.json`.
> The same applies to historical statements below that upload is absent, that activation always chooses the
> newest generation, or that retention is automatically pruned.

## Current shipped contract — **[implemented]**

- `/api` is the only management protocol. Errors are JSON envelopes and the
  subtree owns its own 404/405 responses.
- `GET`/`POST`/`DELETE /api/v1/session` provide setup discovery, password login
  and logout. A signed session cookie authenticates API calls; a session-based
  mutation also requires the per-session `X-CSRF-Token`. Stored bearer tokens
  remain supported for automation and do not require CSRF.
- `GET /api/v1/ui` reports a compact active selection, while
  `GET /api/v1/ui/bundles` lists every retained generation. Authenticated
  `POST /api/v1/ui/bundles` streams a bounded raw ZIP into `/mos/ui`, validates
  and atomically installs it without activation. `PUT /api/v1/ui/active`
  rechecks and selects the exact requested generation; `DELETE` selects the
  built-in UI without deleting installed files. A generation can be deleted
  only while inactive. `/_ui/` remains reachable regardless of custom-bundle
  state and cannot be shadowed.
- `GET /api/v1/network` combines configured intent with an on-demand
  `systemd-networkd` observation obtained by mosd over D-Bus. The observation
  is normalized **at the top level only**. mosd reduces networkd's `Describe`
  document to an interface count and, per interface, a fixed allowlist of
  members — index, name, kind, type, driver, the administrative, operational,
  carrier, address, per-family address and online states, MTU and hardware
  address — renamed into this API's camelCase vocabulary; every other per-link
  member networkd reports is dropped, and apid types what is left. The
  per-interface `addresses`, `dns` and `routes` arrays are **passed through
  verbatim**: only the array's own key is renamed, and its elements keep
  networkd's key names (`Family`, `Address`, `PrefixLength`, `Destination`,
  `Gateway`, `ProtocolString`, ...) and networkd's values, so a route whose
  protocol networkd cannot name reads `ProtocolString: "16"` there. That is
  deliberate: a reader of those arrays is reading systemd's document, not this
  API's vocabulary, and naming those members here would be a second vocabulary
  for the same facts — a design decision, not a normalization. Observation
  failure is explicit and does not hide readable configuration.
- The built-in SPA uses root-relative `/api/...` requests and stores no session
  or bearer credential in browser storage. Its ignored `_out/apid-ui/dist`
  output is generated in the pinned Bun container before Rust checks and
  packaging, then `apid/build.rs` recursively
  embeds the complete tree supplied by the build entry. `index.html` is the
  only stable name; content-hashed route,
  locale and vendor chunks remain independently addressable and cacheable.
- `/`, `/_ui` and `/api` are isolated ownership domains. Misses never fall
  through to another resource root. The shared logical-path validator decodes
  once and rejects repeated/encoded separators, dot components, controls,
  residual escapes and encoded `api`/`ui` aliases before lookup.

## 0. How to read this document

**Status markers.** The discipline is `docs/design/access.md` section 0's;
the marker set is deliberately **not** the same. access.md carries four
markers; this document takes two of them, drops two, and adds one of its own.
Every section below that describes a **mechanism** carries one of:

- **[implemented]** — code exists and is named, by path. (Taken from access.md.)
- **[proposed]** — no code; this document is asking for it. (This document's
  own: access.md records a system that exists, so it never needed a marker for
  "asked for"; this document is mostly asking, so it does.)
- **[not implemented]** — deliberately, no code at all. Prose only. (Taken
  from access.md.)

access.md's `[partial]` is deliberately absent: under this campaign's merge
gates a task that lands short of its section is returned to working rather
than merged, so a subsection that would honestly carry `[partial]` is a
defect to raise, not a state to label. Its `[decided]` is absent because the
decisions this document waits on carry their resolutions inline, in the prose
of the section that needs them.

Where a subsection proposed a mechanism and only part of that mechanism has
since been built, **both** markers appear on its heading, naming which half is
which — access.md's own §0 sets that precedent, *"a section can be
**[decided]** and **[not implemented]** at the same time, and where it is, both
markers appear"* (`docs/design/access.md`). It is not `[partial]` under
another name: `[partial]` would label the subsection as a whole and leave a
reader to work out which sentences are safe, and the point of a marker here is
that a reader never has to. Every such subsection opens with a **What ships**
paragraph that draws the line with citations.

access.md's reason for the discipline applies here unchanged: *"dead code has a
compiler, a test run and a grep-for-callers that can surface it; a security
control that exists only as prose has no mechanism that will ever notice it is
absent"* (`docs/design/access.md`). The marker is therefore attached to
the **section**, not to the document: a section marked **[implemented]** names
code that exists and can be checked against the tree, and a section marked
**[proposed]** names code that does not exist and cannot be. Reading the
document by that rule is the point of the rule. It is no longer safe to read
section 1 as the checkable part and sections 2-9 as the unfalsifiable
remainder: `pkgs/mosd/apid/openapi.json` now records a served API surface, the
handlers behind it are in `pkgs/mosd/apid/src/routes.rs`, and sections 2 and 3
consequently carry markers **per subsection** — 2.1, 2.2 and 2.4 describe
something that partly ships and say so with citations, while 2.3 and 3.2
describe something that does not. A subsection's marker, and the measured
paragraph under it, are what tell the two apart. Section 0 carries no marker:
it describes no mechanism, which is the same exemption access.md states for
its own unmarked sections — *"Sections without a marker (§1, §7, §9's
reasoning, §11) state principles, preferences or history rather than a
mechanism"* (`docs/design/access.md`).

**The tree this document was measured at.** Sections 1, 2 and 3 were last
re-measured against this branch's tree at commit
`f7cb5bad59530fbbc81d93267ac0d1b209652828`, and everything section 1 asserts
and everything the implemented/deferred annotations in sections 2 and 3 assert
was read out of `mosd/apid/openapi.json` and `mosd/apid/src/` at that commit,
not at the `86cd669` this document was originally written against. Sections
4-9 have not been re-measured here and their citations are older. Line numbers
drift, and a `path:line` that resolves is not a `path:line` that is right: a
citation can survive a refactor by landing on unrelated code, which is exactly
what happened to section 1.2's route table between `86cd669` and this
re-measure. A reader on a later tree should re-measure before trusting a line
number; `git show <commit>:<path>` settles a disagreement about what a commit
held.

**What this document settles.** Section 1 settles what exists, so that no later
section invents a surface mos does not have. Sections 2-9 cover the API, the
programmatic authentication, static hosting, where a custom UI lives, the safety
escape back to a built-in UI, trust, phasing, and what the whole direction
forecloses. Where one of them has since been built, the subsection says what
was built and cites it; where it has not, the proposal stands unchanged and is
marked **[proposed]**. A proposal is not deleted because it is unimplemented,
and an implementation is not left labelled as a proposal.

**What this document does not settle.** It does not re-open anything
`docs/design/dashboard.md` decided (see section 1.7): not the live-value
mechanism, not the process architecture, and not whether `com.mos.mosd1` is a
supported contract. It proposes no route handler code, no
markup, and no build tooling. It makes **no hardware claims** — nothing
described or proposed here has been run on a device; every statement about
current behaviour is a reading of source.

## 1. The surface as it exists today — **[implemented]**

Re-measured here's closeout, against the tree that carries
M1-M9. Where this section and a design document disagree, the code is recorded
as the fact and the disagreement is named. This is the section's **third**
measurement: `86cd669` first, `f7cb5ba` second — when the HTTPS router had
grown a reserved `/api` subtree, a reserved `/builtin/` subtree, two more panes
and an asset fallback, and static asset serving, which section 1.6 had recorded
as absent in four independent ways — and this one, at which the write surface
exists, the API accepts JSON request bodies, and a bearer API token is the only
credential `/api/v1/` takes. Nothing is edited away: where a claim this section
carried has been falsified, the falsification is named beside the new
measurement, and every count below is a count of the declarations it cites.

### 1.1 What apid is, and the two constraints that bound every option

apid is a Rust crate named `apid` (`pkgs/mosd/apid/Cargo.toml`), built into a
binary started by a systemd unit as `/usr/bin/apid`
(`pkgs/mosd/dist/apid.service`) after `mosd.service`
(`pkgs/mosd/dist/apid.service`), with its state directory declared as
`StateDirectory=mos/apid` (`pkgs/mosd/dist/apid.service`). The unit sets no
`User=` line (`pkgs/mosd/dist/apid.service`), so the daemon runs as root; the
D-Bus policy file records the same fact from the other side — *"no shipped unit
sets User=, mosd.service owns the name as root, apid.service and the boot
health gate both run as root"* (`pkgs/mosd/dist/com.mos.mosd.conf`).

It binds two listeners, defaulting to `0.0.0.0:443` for HTTPS and `0.0.0.0:80`
for the redirect-only HTTP listener — the two defaults are literals in
`Config::from_env`, `unwrap_or_else(|_| "0.0.0.0:443".to_string())` and
`unwrap_or_else(|_| "0.0.0.0:80".to_string())`
(`pkgs/mosd/apid/src/config.rs`) — and prints exactly one machine-readable
startup line, `APID_LISTENING https=<addr> http=<addr>`
(`pkgs/mosd/apid/src/main.rs`), emitted as
`println!("APID_LISTENING https={https_addr} http={http_addr}");`
(`pkgs/mosd/apid/src/main.rs`), routing everything else to stderr with
`.with_writer(std::io::stderr)` (`pkgs/mosd/apid/src/main.rs`).

**Constraint 1 — the pages are server-rendered maud, with no JavaScript build
chain.** The template engine is maud (`pkgs/mosd/apid/Cargo.toml`, resolved to
`maud = "0.27"` at `pkgs/mosd/Cargo.toml`), used directly in the handlers via the
`html!` macro — `use maud::{DOCTYPE, Markup, PreEscaped, html};`
(`pkgs/mosd/apid/src/routes.rs`). The HTTP stack is axum
(`pkgs/mosd/apid/Cargo.toml` → `axum = "0.8"` at `pkgs/mosd/Cargo.toml`) served by
axum-server (`pkgs/mosd/apid/Cargo.toml` → `pkgs/mosd/Cargo.toml`). There is no
JavaScript: `grep -c 'script {' pkgs/mosd/apid/src/routes.rs` returns `0`,
so no `script` element is emitted anywhere. (The `0` this paragraph reported
for `grep -ci '<script\|javascript'` is no longer the answer — that grep returns
`1` now, and the one hit is prose in a doc comment saying the pane ships no
JavaScript, `pkgs/mosd/apid/src/routes.rs`. The substantive claim is
unchanged; the command that evidenced it is not the command to run.) The only
stylesheet is an inline constant introduced as
*"Inline stylesheet shared by every page; no external assets"*
(`pkgs/mosd/apid/src/routes.rs`), whose body runs from
`const STYLE: &str = "\` (`pkgs/mosd/apid/src/routes.rs`) to the line that closes it,
`.saved{background:#dfd;border:1px solid #080;padding:.5rem 1rem;margin-bottom:1rem}";`
(`pkgs/mosd/apid/src/routes.rs`), injected into the page head as
`style { (PreEscaped(STYLE)) }` (`pkgs/mosd/apid/src/routes.rs`). The crate
contains no non-Rust file but its manifest and the generated OpenAPI document
(`find pkgs/mosd/apid -type f ! -name '*.rs'` returns `pkgs/mosd/apid/openapi.json` and
`pkgs/mosd/apid/Cargo.toml`), so there is no bundler input, no `package.json`, and
nothing for a build chain to consume. What a **bundle** installed under
`/mos/ui` may contain is a different question, settled in sections 4 and 5:
apid ships no JavaScript, and since the asset router landed it will serve
JavaScript somebody else built (section 1.6).

**Constraint 2 — TLS is rustls only.** `rustls` is pinned with
`default-features = false` and the `ring`, `std` and `tls12` features
(`pkgs/mosd/Cargo.toml`), `axum-server` takes the `tls-rustls-no-provider`
feature (`pkgs/mosd/Cargo.toml`), certificate generation uses `rcgen` with the
`ring` backend (`pkgs/mosd/Cargo.toml`), and the daemon installs the ring provider
explicitly before anything else runs
(`pkgs/mosd/apid/src/main.rs`). No OpenSSL, and no C TLS stack, appears in
the crate's dependency list (`pkgs/mosd/apid/Cargo.toml`). The workspace also
forbids unsafe code (`pkgs/mosd/Cargo.toml`) and the crate repeats the forbid
locally (`pkgs/mosd/apid/src/main.rs`).

These two constraints bound every option in sections 2-6: an API that requires a
JavaScript toolchain to be usable from the shipped UI, or a TLS feature rustls
does not offer, is not free — it is a change to the posture recorded here.

### 1.2 The route table as shipped

apid declares two routers in `pkgs/mosd/apid/src/routes.rs`. The HTTPS
application router carries the whole surface — the server-rendered pages, the
reserved `/builtin` escape of section 6.3, the `/api` prefix, and an asset
fallback — under one `gate` middleware layer that covers the fallback too. The
plain-HTTP router does one thing: it redirects to HTTPS, deriving the host from
the `Host` header and re-attaching the actual HTTPS port unless it is 443. It
holds no state beyond that port, no auth gate and no access to mosd.

**Declaration order is the precedence rule**, and section 4.1 depends on it:
routes and nests match in the order declared, and the asset service is the
`.fallback`. A bundle that ships a file at `api/v1/settings` therefore cannot
capture API traffic, because the router never consults the fallback for a path
it already matched. The rule is enforced by the dispatch mechanism rather than
by a check somebody has to remember to write.

**The route list itself is not reproduced here.** The surface under `/api` is
specified by `pkgs/mosd/apid/openapi.json`, which CI holds equal to what the
shipped binary prints. Development builds do not promise backward compatibility. A
prose table of routes is a second copy that drifts away from the first; the
schema is the copy that cannot.

### 1.3 How apid reaches mosd

apid never spawns a process and never talks to systemd itself; every system
action goes through mosd. The trait doc states it as a rule: *"The power actions
are here rather than executed locally because mosd owns every system action:
apid never spawns a process and never talks to systemd itself"*
(`pkgs/mosd/apid/src/settings_api.rs`).

**The bus and the interface.** The transport is **D-Bus**, via `zbus`
(`pkgs/mosd/apid/Cargo.toml` → `pkgs/mosd/Cargo.toml`). The proxy declares the
interface `com.mos.mosd1`, the well-known service name `com.mos.mosd`, and the
object path `/com/mos/mosd` (`pkgs/mosd/apid/src/bus_client.rs`). mosd's side
declares the same three: `pub const BUS_NAME: &str = "com.mos.mosd";`
(`pkgs/mosd/mosd/src/bus.rs`),
`pub const OBJECT_PATH: &str = "/com/mos/mosd";`
(`pkgs/mosd/mosd/src/bus.rs`) and the interface attribute, which carries
`name = "com.mos.mosd1"` (`pkgs/mosd/mosd/src/bus.rs`).
Which bus is chosen is configuration: **`APID_BUS`** selects system (the
default) or session — the variable was `WEBD_BUS` when this section was first
written and the daemon's rename carried it — and the match that reads it is
`match std::env::var("APID_BUS").as_deref()`
(`pkgs/mosd/apid/src/config.rs`).

**Every method apid calls today is on one management proxy.** The
`com.mos.mosd1` trait (`pkgs/mosd/apid/src/bus_client.rs`) declares eight
methods and two signals: settings read/write, task lookup, live-state read,
transient root password, WireGuard rotation, reboot, and power-off. APID declares no
`com.mos.Item1` proxy. Application item trees may use direct
`com.mos.<class>[.<suffix>]` names, but MQTT admits them only through exact
package-owned enrollment; they are not a system-control surface.

The **Called from** column is a change in kind rather than in degree. At
`f7cb5ba` every caller was an HTML form handler; now every one of these methods
is also reachable over `/api/v1/`, through the route table in section 1.2,
because M4-M9 gave each of them a JSON surface rather than a second code path
— the API and HTML routes call the same `SettingsApi` methods.

| Proxy method | Declared at | mosd's implementation | Called from |
|---|---|---|---|
| `fn get_settings` | `fn get_settings` (`pkgs/mosd/apid/src/bus_client.rs`) | `async fn get_settings` (`pkgs/mosd/mosd/src/bus.rs`) | the gate's unauthenticated path and every bearer check (`fn access_settings`, `pkgs/mosd/apid/src/routes.rs`), the `/`, `/builtin`, `/setup`, `/login`, `/password`, `/network`, `/hostname`, `/ssh`, `/containers` and `/mqtt` handlers, and the settings read route, `resource_response(state.api.get_settings(&path).await, &path)` (`pkgs/mosd/apid/src/routes.rs`) |
| `fn set_settings` | `fn set_settings` (`pkgs/mosd/apid/src/bus_client.rs`) | `async fn set_settings` (`pkgs/mosd/mosd/src/bus.rs`) | `/setup`, `/password`, `/network`, `/network/peers/*`, `/hostname`, `/ssh/enable`, `/ssh/keys/*`, `/containers/enable`, `/mqtt/enable`, `/builtin/tokens*`, and every `/api/v1/` write — twenty call sites in `pkgs/mosd/apid/src/routes.rs` |
| `fn get_task` | `fn get_task` (`pkgs/mosd/apid/src/bus_client.rs`) | `async fn get_task` (`pkgs/mosd/mosd/src/bus.rs`) | direct fallback for `GET /api/v1/tasks/{id}` when the `TaskChanged` subscription is not provably live or has no record for that id |
| `fn get_state` | `fn get_state` (`pkgs/mosd/apid/src/bus_client.rs`) | `async fn get_state` (`pkgs/mosd/mosd/src/bus.rs`) | five literal live-state paths: `get_state("network")` (`pkgs/mosd/apid/src/routes.rs`), `.get_state("uptime")` (`pkgs/mosd/apid/src/routes.rs`), `get_state("sshd")` (`pkgs/mosd/apid/src/routes.rs`), `get_state("container")` (`pkgs/mosd/apid/src/routes.rs`) and `get_state("mqtt")` (`pkgs/mosd/apid/src/routes.rs`), plus the health probe `get_state(HEALTH_PROBE_PATH)` (`pkgs/mosd/apid/src/routes.rs`) and the passthrough `get_state(&path)` (`pkgs/mosd/apid/src/routes.rs`), which serves any dot-path a client asks for |
| `fn reboot` | `fn reboot` (`pkgs/mosd/apid/src/bus_client.rs`) | `async fn reboot` (`pkgs/mosd/mosd/src/bus.rs`) | `POST /power/reboot` and `POST /api/v1/actions/reboot`, both through `PowerAction::Reboot => api.reboot().await,` (`pkgs/mosd/apid/src/routes.rs`) |
| `fn power_off` | `fn power_off` (`pkgs/mosd/apid/src/bus_client.rs`) | `async fn power_off` (`pkgs/mosd/mosd/src/bus.rs`) | `POST /power/poweroff` and `POST /api/v1/actions/poweroff`, both through `PowerAction::PowerOff => api.power_off().await,` (`pkgs/mosd/apid/src/routes.rs`) |
| `fn set_transient_root_password` | `fn set_transient_root_password` (`pkgs/mosd/apid/src/bus_client.rs`) | `async fn set_transient_root_password` (`pkgs/mosd/mosd/src/bus.rs`) | `POST /ssh/password`, at `app.api.set_transient_root_password(&form.password)` (`pkgs/mosd/apid/src/routes.rs`), and `POST /api/v1/actions/transient-root-password`, at `app.api.set_transient_root_password(&request.password)` (`pkgs/mosd/apid/src/routes.rs`) |
| `fn rotate_wireguard_key` | `fn rotate_wireguard_key` (`pkgs/mosd/apid/src/bus_client.rs`) | `async fn rotate_wireguard_key` (`pkgs/mosd/mosd/src/bus.rs`) | `POST /api/v1/actions/wireguard/{iface}/rotate-key` only (`pkgs/mosd/apid/src/routes.rs`); no HTML pane calls it |

The read surface is wider than it was at `86cd669` — two live-state paths then,
five literal ones now, plus a passthrough that reaches the whole tree — and the
write surface is wider by every dot-path M4-M8 gave a route. The client still
uses one interface and one object path; power is now expressed by the dedicated
management methods rather than an item write.

**What apid does not call, and cannot receive.** `com.mos.mosd1` now serves
thirteen methods, and apid's proxy declares eight. The five it does not declare
are `ReportHealth`, `ForgetService`, `InstallUpdate`, `GetUpdateState`, and
`MarkUpdate`. `ReportHealth` belongs to the boot health gate; the registry and
update members have their own system clients. mqttd is not one of them and has
no policy access to this interface. APID calls
`Reboot` and `PowerOff` directly, so its D-Bus boundary matches its role as the
system-management API.

mosd emits `SettingsChanged` and `TaskChanged`, and apid subscribes to each on
its own dedicated connection.
`SettingsChanged(path, value_json)` fires after every successful settings write
(`pkgs/mosd/mosd/src/bus.rs`), and the proxy declares the matching
`#[zbus(signal)]` member (`pkgs/mosd/apid/src/bus_client.rs`): a dedicated
watcher task subscribes on
its own connection and feeds the auth gate's cache of the `access` subtree,
invalidating it on every change that can touch `access`
(`pub async fn watch_settings_changed`, `pkgs/mosd/apid/src/bus_client.rs`). That is apid's push notification of a
settings change, and its consumer is internal — no change-stream API is served
(§8.3 item 2). mosd exports no `ItemsChanged` signal or Item1 façade; those
members are application-owned under exact enrolled `com.mos.*` names and APID
does not subscribe to them.

`TaskChanged(task_json)` is emitted for queued, running and finished
transitions. It feeds `TaskRegistry`, which serves memory only while the signal
subscription is live and otherwise falls back to `GetTask`. A lapsed running
record is never served as current; if a direct lookup after resubscription
confirms that mosd no longer retains it, apid exposes it as terminal
`interrupted`, so the zero-JavaScript UI cannot refresh forever after a mosd
restart.

**Shape of the client.** All handler code depends on the `SettingsApi` trait
(`pkgs/mosd/apid/src/settings_api.rs`), not on zbus, which is what lets the
route tests substitute an in-memory fake — *"Handlers depend on this trait so
tests can substitute an in-memory fake for the D-Bus client"*
(`pkgs/mosd/apid/src/settings_api.rs`), the fake itself at
`pub struct FakeSettings {` (`pkgs/mosd/apid/src/settings_api.rs`).
The real implementation connects lazily and caches the proxy, and
drops the cache on any call error so the next request reconnects; the
consequence is documented on the struct itself — *"any call error drops the
cache so the next request reconnects. mosd not being up yet therefore surfaces
as per-request errors (502 pages), never as an apid crash"*
(`pkgs/mosd/apid/src/bus_client.rs`), with the cache read at
`async fn proxy` (`pkgs/mosd/apid/src/bus_client.rs`) and dropped at
`async fn reset` (`pkgs/mosd/apid/src/bus_client.rs`). A failed call on the
HTML surface renders a 502 page reading
*"The management daemon is unavailable."*
(`pkgs/mosd/apid/src/routes.rs`), built at `fn bus_error` (`pkgs/mosd/apid/src/routes.rs`);
the same failure on an `/api/` route is §2.4's envelope instead, built at
`fn bus_api_error` (`pkgs/mosd/apid/src/routes.rs`), and the two agree on
the status because they were written to.

**Who else may call.** The shipped D-Bus policy restricts `com.mos.mosd` to
root in both directions — the default context denies both `send_destination` and
`receive_sender` (`pkgs/mosd/dist/com.mos.mosd.conf`) and only `user="root"`
is allowed to own, send and receive (`pkgs/mosd/dist/com.mos.mosd.conf`). The file also carries an
explicit extension point describing the block a future non-root apid would need
(`pkgs/mosd/dist/com.mos.mosd.conf`) and a deliberately deferred per-method
allowlist (`pkgs/mosd/dist/com.mos.mosd.conf`). At `86cd669` this section recorded that
`docs/design/dashboard.md` cited the policy as permitting *"any local process"*
to call it; that disagreement is now closed from the other side — dashboard.md
reads the shipped policy correctly and says *"the D-Bus policy admits only
root"* (`docs/design/dashboard.md`), citing the same lines
(`pkgs/mosd/dist/com.mos.mosd.conf`). The stale reading survives only in
the inventory, which is a snapshot and says so (section
1.7).

### 1.4 Authentication as shipped

**Where the credential lives.** One password, stored as an argon2id PHC string
at the settings dot-path `access.webAdmin.password_hash` — the value apid reads
through `password_hash`, which walks
`.get("webAdmin")` then `.and_then(|admin| admin.get("password_hash"))`
(`pkgs/mosd/apid/src/routes.rs`), typed as
`pub struct WebAdminSettings {` … `pub password_hash: String,`
(`pkgs/mosd/mosd-settings/src/model.rs`). Hashing is argon2id with default
parameters — *"Hash `password` with argon2id default parameters into a PHC
string"* (`pkgs/mosd/apid/src/auth.rs`), implemented at
`pkgs/mosd/apid/src/auth.rs` — and verification parses the PHC string,
`PasswordHash::new(hash)` (`pkgs/mosd/apid/src/auth.rs`), inside
`pub fn verify_password(hash: &str, password: &str) -> bool {`
(`pkgs/mosd/apid/src/auth.rs`). Nothing else in the crate authenticates: there is
no second credential, no user table, and no reference to `access.device` in
`mosd/apid/src/routes.rs` — `grep -n 'access.device' mosd/apid/src/routes.rs`
returns nothing at `f7cb5ba`.

**How a session is established.** `POST /login` verifies the password and, on
success, calls `SessionStore::create` and sets the cookie —
`let cookie = state.sessions.create();` (`pkgs/mosd/apid/src/routes.rs`), set
on the response by `session::session_cookie(&cookie)`
(`pkgs/mosd/apid/src/routes.rs`). `POST /setup` does the same at the end
of the first-run wizard without a login step, at its own
`let cookie = state.sessions.create();` (`pkgs/mosd/apid/src/routes.rs`). The store generates 16 random bytes from
`OsRng`, hex-encodes them as the id, computes an HMAC-SHA256 of that id under
the persistent signing key, records the id with an expiry, and returns
`format!("{id}.{mac}")` as the cookie value
(`pkgs/mosd/apid/src/session.rs`).

**Cookie attributes and expiry.** The cookie is named
`pub const COOKIE_NAME: &str = "apid_session";`
(`pkgs/mosd/apid/src/session.rs`) and is set as
`Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
(`pkgs/mosd/apid/src/session.rs`); logout re-sets the same attributes with
`Max-Age=0` (`pkgs/mosd/apid/src/session.rs`). Server-side the TTL is 24 hours —
`const SESSION_TTL: Duration = Duration::from_secs(24 * 60 * 60);`
(`pkgs/mosd/apid/src/session.rs`) — enforced on every verification, with an
expired entry removed as it is found (`pkgs/mosd/apid/src/session.rs`).
**Sessions live in memory only** — a `HashMap` in the store,
`sessions: Mutex<HashMap<String, Instant>>,`
(`pkgs/mosd/apid/src/session.rs`) — so, as the module doc states, *"an apid
restart logs everyone out"* (`pkgs/mosd/apid/src/session.rs`). The HMAC signing
key, by contrast, is persisted: 32 bytes at `session.key` in the state
directory, generated on first start with mode `.mode(0o600)`
(`pkgs/mosd/apid/src/tls.rs`), called from `write_secret(&key_path, &key)?;`
(`pkgs/mosd/apid/src/tls.rs`).

**What a request carries.** Only the cookie. The gate extracts it from the
`Cookie` header by prefix match — `pub fn cookie_from_headers(headers: &HeaderMap) -> Option<String> {`
(`pkgs/mosd/apid/src/session.rs`), the scan at
`pkgs/mosd/apid/src/session.rs` — and verifies signature-then-liveness
(`pkgs/mosd/apid/src/session.rs`). **What a request carries depends on
which surface it is for.** The HTML panes carry the cookie and nothing else.
`/api/v1/` carries a bearer API token and nothing else.

The sentence this section carried at `f7cb5ba` — *"There is no `Authorization`
header path, no API key, and no token of any kind in the crate"* — is false in
every clause, and it was falsified in two steps. M2 added the
bearer token and the three routes that manage it, so the same task's record
notes that this section's *"There is no `POST /api/v1/tokens` and no
`DELETE /api/v1/tokens/{id}`"* had become false; both are declared today
(`.route(V1_TOKENS_PATH, ...)`, `pkgs/mosd/apid/src/routes.rs`), as is the browser's bootstrap,
`.route(BUILTIN_TOKENS_LEAF, post(builtin_tokens_mint))` (`pkgs/mosd/apid/src/routes.rs`). M9 (2026-08-28) then
**withdrew the cookie from `/api/v1/` entirely**. The `/api/v1/` routes are now
guarded by the `ApiBearer` extractor — `pub(crate) struct ApiBearer;`
(`pkgs/mosd/apid/src/routes.rs`) — whose whole test is
`if bearer_is_stored(state, &parts.headers).await {`
(`pkgs/mosd/apid/src/routes.rs`) and nothing else, and whose token is read out of the
`Authorization` header by `pub fn bearer_from_headers`
(`pkgs/mosd/apid/src/token.rs`). The session cookie still
authenticates the HTML panes, and §3.2's dated note records the window in
which both credentials were accepted.

**The gate.** One middleware, layered over the whole HTTPS router with
`.layer(middleware::from_fn_with_state(state.clone(), gate))`
(`pkgs/mosd/apid/src/routes.rs`), running from
`async fn gate(State(state): State<AppState>, request: Request, next: Next) -> Response {`
(`pkgs/mosd/apid/src/routes.rs`) to `Redirect::to("/login").into_response()`
(`pkgs/mosd/apid/src/routes.rs`). It implements
**five** decisions, two more than at `86cd669`:

1. `/healthz` and the declared `/api/` routes always pass —
   `if path == "/healthz" || is_declared_api_route(path) {`
   (`pkgs/mosd/apid/src/routes.rs`). The API routes answer for themselves in
   §2.4's envelope rather than in the gate's HTML redirect, and which paths
   qualify is decided by `is_declared_api_route`
   (`pkgs/mosd/apid/src/routes.rs`) rather than by a prefix test.
   Since decision 2 exists, this test no longer decides whether anything is
   *released* — every leaf the predicate accepts begins with `/`, so every path
   it accepts decision 2 accepts as well. It is retained rather than folded in
   because the predicate is owned elsewhere.
2. **The rest of the reserved `/api` subtree passes too**, and this one is a
   prefix test — `.is_some_and(|leaf| leaf.is_empty() || leaf.starts_with('/'))`
   (`pkgs/mosd/apid/src/routes.rs`), spelled from `API` so it covers `/api`
   and everything under `/api/` and nothing else. §4.1 rule 1's not-found
   handler answers those paths in §2.4's envelope, so this release is for the
   same reason decision 1 releases a declared route: a request addressed to
   the JSON surface is answered in JSON. Both decisions run **before any
   credential is read**, which is what makes an undeclared path under the
   prefix one answer rather than one answer per credential. A later fix
   added this decision; until it, such a
   path fell through to decisions 4 and 5 and was answered with an HTML
   redirect whenever the request carried no session cookie — which a
   bearer-only client never does. That was a standing contradiction of §4.2's
   *"a request that a developer expected to be JSON never returns HTML with a
   200"*, since the 303 to `/login` is followed to a 200 HTML page.
3. A request carrying a **valid session cookie** passes without any bus call at
   all — `if session::cookie_from_headers(request.headers())`
   (`pkgs/mosd/apid/src/routes.rs`).
4. **Setup mode** — no admin password hash present — only `/setup` passes and
   everything else redirects there (`pkgs/mosd/apid/src/routes.rs`).
   Decision 2 runs above this one, so a device with no admin password still
   answers its reserved subtree rather than bouncing a JSON client to
   `/setup`.
5. **Normal mode** — `/login` and `/setup` pass and everything else redirects
   to `/login` (`pkgs/mosd/apid/src/routes.rs`).

The sentence this section carried at `86cd669` — that the gate calls
`GetSettings("access")` on **every** request, so every request costs at least
one D-Bus round trip — is **no longer true**, and the change was deliberate.
The session check was moved above the bus call — `if session::cookie_from_headers(request.headers())`
(`pkgs/mosd/apid/src/routes.rs`) — so a cookie-authenticated request reaches its
handler without touching mosd, and the source states the reason and its
soundness argument at `pkgs/mosd/apid/src/routes.rs`: *"an authenticated
page load costs one system-bus round trip per request -- fine for one
server-rendered pane, not fine once a custom UI bundle (§4) serves dozens of
static assets per page, none of which need mosd"*.

**The clause that said the `access` read is *"now paid only by an
unauthenticated request"* is itself false since M2, and this is the closeout
correcting it.** The read is `let value = state.api.get_settings("access").await?;`
(`pkgs/mosd/apid/src/routes.rs`), reached through `async fn access_settings`
(`pkgs/mosd/apid/src/routes.rs`), and it has two callers, not one: the gate's
unauthenticated path, and **every bearer check**, because the stored token list
lives under `access` and `fn bearer_is_stored` reads it there —
*"The subtree the gate already reads, which is why §3.2 put the list under
`access` rather than beside it: no second round trip per request"*
(`pkgs/mosd/apid/src/routes.rs`). So a bearer request pays this read too; what
it does not pay is a *second* one. Both callers are served from the gate's
cache when — and only when — the `SettingsChanged` subscription is live
(`pkgs/mosd/apid/src/routes.rs`), which is what makes the cost bounded rather
than per-request. Sections 2 and 3 must not assume the old cost model: an
`/api/v1/` route costs the cached-or-one `access` read its bearer check makes,
plus the one `GetSettings`/`GetState` its handler makes.

**Brute-force accounting.** A single global counter, not per-client, on
access.md §3.3's exponential curve (a later pass replaced the original flat
five-failures/30-seconds rule): the first failure already arms a one-second
window — `const BACKOFF_BASE: Duration = Duration::from_secs(1);`
(`pkgs/mosd/apid/src/auth.rs`) — every consecutive failure doubles it,
`BACKOFF_BASE.as_secs().saturating_mul(factor)`
(`pkgs/mosd/apid/src/auth.rs`), and the curve caps at 300 seconds and never
becomes permanent, `const BACKOFF_MAX: Duration = Duration::from_secs(300);`
(`pkgs/mosd/apid/src/auth.rs`), applied at `pkgs/mosd/apid/src/auth.rs`. Riding out
a window does not reset the run — the elapsed window is cleared *"but the
failure run behind it is deliberately kept"* (`pkgs/mosd/apid/src/auth.rs`)
— and only a successful login does. Admission and accounting are one locked
operation, `pub fn begin_attempt(&mut self) -> bool {`
(`pkgs/mosd/apid/src/auth.rs`): each attempt is charged when it is admitted, so
concurrent submissions cannot share one window, and the doc comment gives the
reason at `pkgs/mosd/apid/src/auth.rs`. The comments state why per-client
tracking was rejected — *"the appliance has one admin password, so per-client
tracking buys nothing against an online guesser"*
(`pkgs/mosd/apid/src/auth.rs`) — and why no permanent lockout threshold is
armed: *"apid has no presence check, so arming a threshold nothing can clear
would let an attacker convert a guessing attempt into a permanent denial of
management"* (`pkgs/mosd/apid/src/auth.rs`). The counter is persisted through
`GuardStore` rather than living in the guard
(`pkgs/mosd/apid/src/auth.rs`).

**TLS material.** The certificate is self-signed and generated on first start
into the state directory: CN `mos`, SANs `DNS:mos`, `DNS:localhost`,
`IP:127.0.0.1` — the certificate is built at `pkgs/mosd/apid/src/tls.rs`, with
the private key written mode `0o600` (`pkgs/mosd/apid/src/tls.rs`, called from
`pkgs/mosd/apid/src/tls.rs`) inside a state directory created mode `0o700`
(`pkgs/mosd/apid/src/tls.rs`). That directory defaults to
`/var/lib/mos/apid` and is overridable by `APID_STATE_DIR`
(`pkgs/mosd/apid/src/config.rs`), and is provided by systemd as
`StateDirectory=mos/apid` (`pkgs/mosd/dist/apid.service`). There is no ACME
client, no certificate rotation, and no way to install an operator-supplied
certificate in `pkgs/mosd/apid/src/tls.rs`.

### 1.5 The model the API must be derived from: mosd's settings and state

An API for this appliance is not a free design: mosd already owns a typed
settings tree and an untyped live-state tree, and both are reachable only
through dot-paths. Sections 2 and 3 must derive from what follows, not invent
alongside it. The first slice of that API is now served and does exactly this:
`GET /api/v1/settings/{path}` passes a dot-path through to `GetSettings` and
hands back what mosd returns (section 1.2), so the model below is the API's
model and not a translation of it.

**Schema version — there is no longer one for the tree.** This paragraph used
to say `SCHEMA_VERSION` is **12**, read-only through the write path, and moved
by a registered `V0→V12` chain. PLAN-070 §5.2.3 retired all three facts: the
version is now **per document** and each starts at **v1**
(`pkgs/mosd/mosd-settings/src/documents.rs`), the chain was deleted with the
single document it migrated, and `schema_version` is **not a key of the
addressed tree** — a path naming it is a path that names nothing, and the write
route answers it with the 404 every other absent root gets.
`GET /api/v1/meta`'s `settingsSchemaVersion` reports the STATE document's
version, read from `mosd_settings` at request time
(`pkgs/mosd/apid/src/routes.rs`) rather than copied; §2.1 says what that member
can and cannot answer now. The standing rule survives the change: **whoever
moves a version constant updates this document in the same change**, because
nothing gates the value — the index check tests membership, not content.

**Persistence.** One document per reconciler as JSON under `/mos/config/` on
DATA, plus the remainder as TOML on STATE at
`pub const DEFAULT_PATH: &str = "/var/lib/mos/settings.toml";`
(`pkgs/mosd/mosd-settings/src/store.rs`); which key lives where is
`docs/design/mosd.md` §5.1a's table. Each document is written atomically
through `Store` — temp file, mode set **before** the rename, fsync, rename,
directory fsync — and a document whose bytes did not change is not rewritten,
so a write to one leaves the others byte-identical. Every settings struct in
`pkgs/mosd/mosd-settings/src/model.rs` carries
`#[serde(deny_unknown_fields)]`, so an unknown key fails the load rather than
being silently dropped, and **an absent `/mos/config/` fails the load too**:
that is the medium being gone, not a document that was never written, and mosd
refuses to start on schema defaults (§5.2.6 / `docs/design/mosd.md` §5.2a).

**The settings subtrees, from `pub struct Settings {`
(`pkgs/mosd/mosd-settings/src/model.rs`):**

The table is derived from `pkgs/mosd/mosd-settings/src/model.rs`; the source
module remains authoritative when fields are added or renamed.

| Dot-path | Type | Declared at | Contents |
|---|---|---|---|
| `hostname` | `String` | `pub hostname: String,` (`pkgs/mosd/mosd-settings/src/model.rs`) | system hostname, default `hostname: "mos".to_string(),` (`pkgs/mosd/mosd-settings/src/model.rs`) |
| `network.<iface>` | `IfaceSettings` | `pub network: BTreeMap<String, IfaceSettings>,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct IfaceSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `kind` (`physical`/`vlan`/`bridge`/`wireguard`, `pub enum IfaceKind {` (`pkgs/mosd/mosd-settings/src/model.rs`)), `dhcp: bool`, and the optional block belonging to the kind: `static` (`address`, `gateway`, `dns[]`) at `pub struct StaticConfig {` (`pkgs/mosd/mosd-settings/src/model.rs`), `vlan` at `pub struct VlanConfig {` (`pkgs/mosd/mosd-settings/src/model.rs`), `bridge` at `pub struct BridgeConfig {` (`pkgs/mosd/mosd-settings/src/model.rs`), `wireguard` at `pub struct WireguardConfig {` (`pkgs/mosd/mosd-settings/src/model.rs`) with its peers at `pub struct WireguardPeer {` (`pkgs/mosd/mosd-settings/src/model.rs`) |
| `access.webAdmin` | `Option<WebAdminSettings>` | `pub web_admin: Option<WebAdminSettings>,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct WebAdminSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `password_hash` only; absent until first-run setup writes it |
| `access.claim` | `Option<ClaimSettings>` | `pub claim: Option<ClaimSettings>,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct ClaimSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `via` (`setup`/`provisioning-document`), `at` (a device-clock label, never a deadline) and `rotationRequired`; **absent on a claimed device means claimed by a provisioning document**, which is `docs/design/access.md` §4.4's argument and not an omission |
| `access.ssh` | `SshSettings` | `pub ssh: SshSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct SshSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `enabled` (default `enabled: false,`, `pkgs/mosd/mosd-settings/src/model.rs`), `port`, `permitRootLogin`, `passwordAuthentication`, `listenAddresses[]`, and `pub authorized_keys: Vec<AuthorizedKey>,` (`pkgs/mosd/mosd-settings/src/model.rs`), entry type `pub struct AuthorizedKey {` (`pkgs/mosd/mosd-settings/src/model.rs`) |
| `access.console` | `ConsoleSettings` | `pub console: ConsoleSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct ConsoleSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `shellEnabled` |
| `access.device` | `DeviceCredentialSettings` | `pub device: DeviceCredentialSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct DeviceCredentialSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `passwordHash` (optional) and `generation`; never a plaintext secret — *"Holds the hash of the per-device password and its revision, never the password itself"* (`pkgs/mosd/mosd-settings/src/model.rs`) |
| `provisioning` | `ProvisioningSettings` | `pub provisioning: ProvisioningSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct ProvisioningSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `state` (`pending` \| `complete`, `pub enum ProvisioningState {` (`pkgs/mosd/mosd-settings/src/model.rs`)), `deviceId`, `seededGeneration` |
| `wifi.client` | `WifiClientSettings` | `pub wifi: WifiSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`) → `pub client: WifiClientSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct WifiClientSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `enabled`, `interface`, `networks[]` (entry `pub struct WifiNetwork {`, `pkgs/mosd/mosd-settings/src/model.rs`) |
| `wifi.ap` | `WifiApSettings` | `pub ap: WifiApSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct WifiApSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `mode` (`off` \| `provisioning` \| `always`, `pub enum ApMode {` (`pkgs/mosd/mosd-settings/src/model.rs`)), `interface`, `ssid`, `psk`, `channel`, `countryCode`, `address`, `holdDownSeconds`, `graceSeconds` |
| `container` | `ContainerSettings` | `pub container: ContainerSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct ContainerSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `enabled` only; false means the Quadlet directory is not bound from STATE and no container unit exists |
| `mqtt` | `MqttSettings` | `pub mqtt: MqttSettings,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct MqttSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | `enabled` (a master switch over both units), `listen` (`address`, `port`, `pub struct MqttListenSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`)), `auth` (`pub struct MqttAuthSettings {`, `pkgs/mosd/mosd-settings/src/model.rs`) |
| `access.apiTokens` | `Vec<ApiToken>` | `pub api_tokens: Vec<ApiToken>,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct ApiToken {` (`pkgs/mosd/mosd-settings/src/model.rs`) | §3.2's token list, added deliberately after this table was written: a stable hex `id`, an operator label, the stored hash and a creation stamp. Never the secret |
| `reset` | `Option<ResetSettings>` | `pub reset: Option<ResetSettings>,` (`pkgs/mosd/mosd-settings/src/model.rs`); type `pub struct ResetSettings {` (`pkgs/mosd/mosd-settings/src/model.rs`) | the staged reset intent (`docs/design/recovery.md` §2.2): `tier` (`configuration` \| `application-data` \| `full-factory`, `pub enum ResetTier {` (`pkgs/mosd/mosd-settings/src/model.rs`)), `requested` (a device-clock label, never a deadline) and `presence` (the mechanism that authorized a presence-gated tier). Absent unless one is waiting; **there is no fourth tier and no spelling of secure wipe parses**, which `docs/design/recovery.md` §2 footnote `[^wipe]` is the reason for |

The last two rows are new since this section was first written, and they are
why section 1.2's route table grew the `/containers` and `/mqtt` panes. Nothing
about the shape changed: two more top-level keys, each with its own reconciler,
each reachable at its own dot-path.

**Two properties of the write path an API author needs.** First, a write is
**validated against the typed tree before it is persisted**: `SetSettings`
builds a candidate, calls `Settings::set` — which deserializes the whole root
into a candidate `Self`, `serde_json::from_value(root)`
(`pkgs/mosd/mosd-settings/src/model.rs`) — and only then calls
`self.store.save(&candidate)?;` (`pkgs/mosd/mosd/src/bus.rs`), so a malformed
write mutates nothing. Second, **the dot-path syntax has no array indexing**:
the model comment says a list is *"Written as a whole JSON array through the
dot-path API"* (`pkgs/mosd/mosd-settings/src/model.rs`), which is exactly why
the SSH pane reads the whole key list — `parse_key_list(&app.api.get_settings("access.ssh").await?)`
(`pkgs/mosd/apid/src/routes.rs`) — edits it in memory with `keys.push(parsed);`
(`pkgs/mosd/apid/src/routes.rs`) or `keys.remove(index);` (`pkgs/mosd/apid/src/routes.rs`), and writes the whole
list back through `async fn write_key_list` (`pkgs/mosd/apid/src/routes.rs`). Every
collection route M5-M6 added does the same read-modify-write, for the same
reason.

**Persistence and application are separate lifecycles.** `SetSettings`
validates and atomically persists the candidate, enqueues a scoped apply, and
returns its task id; it does not wait for reconciliation. One worker serializes
apply execution behind a dedicated apply lock while settings and live-state
reads use the separate data `RwLock`. Pending work is folded by dot-path subtree
subsumption, so two rapid identical submissions share one reconcile and the
surviving record increments `foldedCount`. The bounded record is available at
`GET /api/v1/tasks/{id}` and in `GET /api/v1/tasks`; it carries the operation,
dot-path, source, timestamps, terminal outcome and fold count. Consequently
`PUT /api/v1/settings/{path}` and the transient-root-password action answer
**202** with `{ "taskId": "..." }`: return means persisted and queued, never
"already applied".

**Which reconcilers the queued worker re-runs.** A `SetSettings` task applies every reconciler
whose subtree overlaps the written path —
`if paths_overlap(path, reconciler.subtree()) {`
(`pkgs/mosd/mosd/src/bus.rs`) — where overlap is segment-wise prefix in either
direction and the root matches everything, *"True when `a` and `b` overlap by
dot segments in either direction: one path is a segment-wise prefix of the
other. The root path (`""` or `"."`) matches everything"*
(`pkgs/mosd/mosd/src/bus.rs`), implemented at `pkgs/mosd/mosd/src/bus.rs`.
**Seven** reconcilers are registered in production —
`pkgs/mosd/mosd/src/reconciler/mod.rs` — two more than the five recorded at
`86cd669`, with these name/subtree pairs:

| Reconciler `name()` | `subtree()` | Declared at |
|---|---|---|
| `hostname` | `hostname` | `pkgs/mosd/mosd/src/reconciler/hostname.rs` |
| `network` | `network` | `pkgs/mosd/mosd/src/reconciler/network.rs` |
| `sshd` | `access.ssh` | `pkgs/mosd/mosd/src/reconciler/sshd.rs` |
| `wifiClient` | `wifi.client` | `pkgs/mosd/mosd/src/reconciler/wifi_client.rs` |
| `wifiAp` | `wifi` | `pkgs/mosd/mosd/src/reconciler/wifi_ap.rs` |
| `container` | `container` | `pkgs/mosd/mosd/src/reconciler/container.rs` |
| `mqtt` | `mqtt` | `pkgs/mosd/mosd/src/reconciler/mqtt.rs` |

One row is not a rename. `wifiAp` declares the **whole `wifi` tree** rather
than `wifi.ap`, deliberately: *"The whole `wifi` tree, not just `wifi.ap`: the
conflict check below reads `wifi.client`, so a write there must re-run this
reconciler too"* (`pkgs/mosd/mosd/src/reconciler/wifi_ap.rs`). An API that
reports "which reconcilers a write will re-run" has to read `subtree()` rather
than assume it equals the settings key.

**The live-state tree.** It is a plain `serde_json::Value`, not a typed model —
`state: Value,` (`pkgs/mosd/mosd/src/bus.rs`) — and `GetState` returns the
subtree at a dot-path or, when the dot-path resolves to nothing, `NotFound`
(`pkgs/mosd/mosd/src/bus.rs`) — the name was fdo `InvalidArgs` until
An earlier defect is why apid used to re-read it on the state route. Five kinds of thing write into it, and that
set is the entire read surface an API can expose:

1. **One key per reconciler**, named by `name()` above, holding that
   reconciler's applied result, or `{"error": "..."}` when it failed —
   `record(&mut inner.state, reconciler.name(), result);`
   (`pkgs/mosd/mosd/src/bus.rs`), the failure branch at
   `serde_json::json!({ "error": err.to_string() })`
   (`pkgs/mosd/mosd/src/bus.rs`).
2. **`power`** — `{last_action, requested_by}`, recorded *before* the action so
   the record survives the machine going down
   (`pkgs/mosd/mosd/src/bus.rs`, and *"Always called BEFORE the action: once
   systemd starts tearing the machine down there may be no system left to log
   on"* at `pkgs/mosd/mosd/src/bus.rs`). An `update_warning` key joins the
   two when there is one (`pkgs/mosd/mosd/src/bus.rs`).
3. **`health.<component>`** — `{status, detail}`, written by the `ReportHealth`
   method — `serde_json::json!({ "status": status, "detail": detail }),`
   (`pkgs/mosd/mosd/src/bus.rs`) — with the component count capped
   (`pkgs/mosd/mosd/src/bus.rs`).
4. **`dry_run`** — present only under
   `std::env::var("MOSD_DRY_RUN").is_ok_and(|value| value == "1")`
   (`pkgs/mosd/mosd/src/main.rs`), inserted at
   `state.insert("dry_run".to_string(), Value::Bool(true));`
   (`pkgs/mosd/mosd/src/main.rs`), in which case no reconcilers are
   registered at all (`pkgs/mosd/mosd/src/main.rs`) and the power control is
   a stub (`pkgs/mosd/mosd/src/main.rs`).
5. **`tasks`** — mosd's bounded apply history, updated on every queued, running
   and finished transition and also readable one record at a time through
   `GetTask`.

Of that surface, apid's HTML panes read **five** literal paths today —
`network`, `uptime`, `sshd`, `container` and `mqtt` (section 1.3); `uptime` is
the one this paragraph did not have when it said four, and the status pane
reads it at `.get_state("uptime")` (`pkgs/mosd/apid/src/routes.rs`). A sixth reader
is not a pane: `GET /api/v1/health` probes `get_state(HEALTH_PROBE_PATH)`
(`pkgs/mosd/apid/src/routes.rs`). The whole of the tree is reachable over
HTTP as well, because `GET /api/v1/state/{path}` passes any dot-path straight
through with `resource_response(value, &path)`
(`pkgs/mosd/apid/src/routes.rs`) — which is the one place where
the shipped API is still **wider** than the shipped UI, and section 2.2 is
where that widening is argued for.

**Vocabulary this document inherits from `access.md`.** Sections 4-6 need three
things already settled there and must not restate them differently: the status
markers (`docs/design/access.md`), the core and feature-specific bind mounts
and their STATE/DATA tiers (`docs/design/access.md`) —
and the **survives-what table** for reboot, A/B update and factory reset
(`docs/design/access.md`). Two of its rows bear directly on section 5:
`/home`, `/root` and `/srv` are DATA and survive both a reboot and an A/B
update because RAUC writes only ROOTFS and BOOT
(`docs/design/access.md`), while arbitrary `/etc` edits survive nothing
because `/` is a verity squashfs outside the deliberate bind points
(`docs/design/access.md`). The governing rule for section 5 is stated as a
section heading: *"An unmodelled setting is an unsupported setting"*
(`docs/design/access.md`), argued at `docs/design/access.md`.


### 1.6 Static assets today

**This subsection recorded the opposite of what is now true, and the reversal
is the point.** At `86cd669` it said *apid serves no static asset of any kind,
from anywhere*, and evidenced that absence four ways. Sections 4 and 5 asked
for static hosting; it was built; every one of those four pieces of evidence
has since been falsified by the tree. What follows is the re-measurement, kept
in the same four positions so the change is legible rather than overwritten.

1. **A file-serving path is a module of the crate, not a dependency.** The
   original evidence was the absence of `tower-http` from the dependency list,
   and that absence is still real: the list is
   `pkgs/mosd/apid/Cargo.toml` and contains no `tower-http`; `tower` itself
   appears only under `[dev-dependencies]` (`pkgs/mosd/apid/Cargo.toml`), and
   the workspace pins it with only the `util` feature —
   `tower = { version = "0.5", features = ["util"] }` (`pkgs/mosd/Cargo.toml`) —
   which carries no file-serving service. The conclusion drawn from it does
   not survive: apid serves files through code it owns,
   `mod assets;` (`pkgs/mosd/apid/src/main.rs`), whose three modules are
   `pkgs/mosd/apid/src/assets/serve.rs`, `pkgs/mosd/apid/src/assets/path.rs` and
   `pkgs/mosd/apid/src/assets/mime.rs`.
2. **A file-serving service is constructed, as the router's fallback.**
   `grep -n "ServeDir\|ServeFile" pkgs/mosd/apid/src/*.rs` still returns nothing —
   there is no `nest_service` and no `fallback_service` — but the HTTPS router
   now ends in `.fallback(serve::fallback)` (`pkgs/mosd/apid/src/routes.rs`),
   and that fallback reads files off disk:
   `let body = fs::read(file).ok()?;`
   (`pkgs/mosd/apid/src/assets/serve.rs`), typed and cached by
   `pkgs/mosd/apid/src/assets/mime.rs` and path-checked by
   `pub fn resolve(request_path: &str, bundle_root: &Path) -> Result<PathBuf, Rejection> {`
   (`pkgs/mosd/apid/src/assets/path.rs`).
3. **Nothing is embedded in the binary, and that is still deliberate.**
   `grep -n "include_str!\|include_bytes!" pkgs/mosd/apid/src/*.rs` no longer
   returns nothing, but neither hit is an asset: `pkgs/mosd/apid/src/routes.rs`
   is the module doc **stating** the rule — *"no `include_str!`, no
   `include_bytes!`, no asset directory"* — and
   `include_str!("../openapi.json"),` (`pkgs/mosd/apid/src/tests.rs`) reads the
   committed document so a test can assert the generated one matches it. The built-in UI is still
   markup built by `maud` at request time, and the reason is recorded at
   `pkgs/mosd/apid/src/routes.rs`: dm-verity is the only protection on
   `/usr/bin/apid`, so *"an artifact that is bytes in the binary is behind
   that protection and an artifact that is files on disk would not be"*.
4. **The crate still ships no asset of its own; the assets come from
   `/mos/ui`.** `find pkgs/mosd/apid -type f ! -name '*.rs'` returns
   `pkgs/mosd/apid/Cargo.toml` and `pkgs/mosd/apid/openapi.json` and nothing else, and
   `find pkgs/mosd/apid -type d` returns `pkgs/mosd/apid`, `pkgs/mosd/apid/src`,
   `pkgs/mosd/apid/src/assets`, `pkgs/mosd/apid/src/tests` and `pkgs/mosd/apid/tests` — no
   `assets/`, `static/` or `public/` directory of servable files. What is
   served comes from the bundle store rooted at
   `pub const DEFAULT_ROOT: &str = "/mos/ui";`
   (`pkgs/mosd/apid/src/bundle.rs`), which the router state constructs with
   `bundles: Arc::new(Store::at_default()),` (`pkgs/mosd/apid/src/routes.rs`).

**What the fallback actually does, in order.** `serve::fallback` — declared as
`pub async fn fallback(State(state): State<AppState>, request: Request) -> Response {`
(`pkgs/mosd/apid/src/assets/serve.rs`), body through
`pkgs/mosd/apid/src/assets/serve.rs` — answers 405 with `Allow: GET, HEAD` for
any other method (`pkgs/mosd/apid/src/assets/serve.rs`,
`pkgs/mosd/apid/src/assets/serve.rs`), then hands the path to `respond`
(`pkgs/mosd/apid/src/assets/serve.rs`): a file out of the active bundle when
one resolves (`pkgs/mosd/apid/src/assets/serve.rs`), a 404 when a path guard fired, and otherwise
§4.2's SPA fallback — but only when the client offered HTML explicitly
(`pkgs/mosd/apid/src/assets/serve.rs`) and the final path segment contains
no `.` (`pkgs/mosd/apid/src/assets/serve.rs`). When that fallback finds no
bundle index it serves the built-in UI rather than an error
(`pkgs/mosd/apid/src/assets/serve.rs`), through `built_in`
(`pkgs/mosd/apid/src/assets/serve.rs`), which calls today's `home` pane and
reads nothing under `/mos/ui`.

**The pages themselves are still asset-free.** What the built-in panes need is
inlined: the single stylesheet is a `&str` constant emitted into the page head
by `style { (PreEscaped(STYLE)) }` (`pkgs/mosd/apid/src/routes.rs`), from a constant described in
the source as
*"Inline stylesheet shared by every page; no external assets"*
(`pkgs/mosd/apid/src/routes.rs`). There is still no favicon route, no font and
no image declared in `pkgs/mosd/apid/src/routes.rs`. A request for
`/favicon.ico` no longer ends at the gate, though: it is unauthenticated, so
the gate redirects it to `/login` (`pkgs/mosd/apid/src/routes.rs`), and
authenticated it reaches `serve::fallback`, which either finds
`favicon.ico` in the active bundle or 404s — the `.` in the segment excludes it
from the SPA fallback (`pkgs/mosd/apid/src/assets/serve.rs`).

**Disk paths apid touches.** The list this section gave at `86cd669` —
`/proc/uptime` and its own state directory — has changed in both directions.
`/proc/uptime` is no longer read at all: mosd publishes uptime into the
live-state tree and the status pane reads it through `get_state` (§2.2 item 3).
The state directory is read at `pkgs/mosd/apid/src/tls.rs` and
`let key_path = dir.join("session.key");` (`pkgs/mosd/apid/src/tls.rs`); the bundle store
under `/mos/ui` is the third, read on `GET /` and on every fallback
(`fn active_root`, `pkgs/mosd/apid/src/assets/serve.rs`) and written only
by the deactivate control — `match state.bundles().deactivate() {`
(`pkgs/mosd/apid/src/routes.rs`) — and the install path. The consequence
for sections 4 and 5 is therefore no longer "static hosting is not a matter of
pointing an existing middleware at a directory" — it is that those sections
describe code that exists and must be read as measurements, not proposals.


### 1.7 What the dashboard proposal already settled

`docs/design/dashboard.md` is the merged dashboard proposal — the landing
dashboard, the information architecture behind it, the live-update posture that
supports them, and a phased delivery order (`docs/design/dashboard.md`) —
and this document must not re-decide what it decided. Three things are settled
there and are treated as inputs here. **Live values:** section 5.8 adopts
*"option A — full-page refresh — as the dashboard's only live-value mechanism,
at a 15-second default interval, with a no-JavaScript off switch"*
(`docs/design/dashboard.md`), on the grounds that mosd has no
live-state push signal at all and that a no-JavaScript path must keep working;
it explicitly names what that forecloses — *"Any value meaningful at
sub-15-second resolution"* and *"Client-side UI state"*
(`docs/design/dashboard.md`). **Process
architecture, and the name:** *"mos runs two processes"* — mosd owning device
state and the system bus, apid owning HTTPS, sessions and the UI, and apid not
merged into mosd — and the HTTPS management daemon is named `apid`
(`docs/design/dashboard.md`). **The bus as a contract:** `com.mos.mosd1`
stays served whatever the UI does, because the boot health gate is a second
consumer calling it directly
(`rootfs/overlay/usr/lib/mos/mos-health`), and its
failure path is an A/B rollback. This document therefore assumes a
server-rendered no-JavaScript built-in UI, two processes, a bus that keeps
existing, and the name `apid`; a section below that needs any of those to change
must say so and say why, rather than quietly assuming it.

**Where this section agrees with the earlier inventory, and where that inventory
has gone stale.** the inventory measured the same surface
at commit `d0bcae92656257021bb67bf7db72b8ac5bfb4651` — *"Measured at"*
 — which is **not** this document's base
and is now three re-measures behind it. It **agrees** with everything measured
here about the technology posture — server-rendered maud, zero JavaScript in
apid's own pages, rustls-only TLS, listeners on `0.0.0.0:443` and `0.0.0.0:80`
— and about the shape of the session mechanism and of the settings dot-path
model. It has gone **stale** in six ways, and in each case the tree this
closeout measures is the fact. The document says so about itself: it is *"a snapshot at
`d0bcae9`, not maintained"*, so what
follows is a reading of a snapshot and not a defect in it.

1. **The source positions cited throughout its section 2.1 no longer resolve
   to the routes they name.** Today `GET /` is declared as
   `.route("/", get(serve::root))` (`pkgs/mosd/apid/src/routes.rs`) and the
   handler is `pub async fn root`
   (`pkgs/mosd/apid/src/assets/serve.rs`), with the built-in branch at
   `pub(crate) async fn home` (`pkgs/mosd/apid/src/routes.rs`).
2. **Its route table is missing most of the method+path pairs the shipped
   router declares.** The five SSH routes it predicted —
   `GET /ssh`, `POST /ssh/enable`, `POST /ssh/password`,
   `POST /ssh/keys/add`, `POST /ssh/keys/remove` — exist at
   `pkgs/mosd/apid/src/routes.rs`; the four `/containers` and `/mqtt` pairs
   landed after it (`pkgs/mosd/apid/src/routes.rs`); so did `/password`, the
   two `/network/peers/*` posts and the whole `/builtin` subtree; and so did
   every `/api` pair `fn api_router` now declares
   (`pkgs/mosd/apid/src/routes.rs`). Its own section 8 predicted the first five
   and instructed a re-measure after the `sshweb` merge
.
3. **"Six methods and one signal"** is
   now **twelve** methods and one signal on `com.mos.mosd1` (section 1.3);
   `fn set_transient_root_password` (`pkgs/mosd/apid/src/bus_client.rs`) is
   one of the five apid declares, and is called from the SSH pane at
   `app.api.set_transient_root_password(&form.password)` (`pkgs/mosd/apid/src/routes.rs`)
   and from M7's action route at
   `app.api.set_transient_root_password(&request.password)` (`pkgs/mosd/apid/src/routes.rs`).
4. **"the sole call site is `GetState("network")`"**
 is now eight call sites:
   `get_state("network")` (`pkgs/mosd/apid/src/routes.rs`),
   `.get_state("uptime")` (`pkgs/mosd/apid/src/routes.rs`),
   `get_state("network")` again in the network pane (`pkgs/mosd/apid/src/routes.rs`),
   `get_state("sshd")` (`pkgs/mosd/apid/src/routes.rs`),
   `get_state("container")` (`pkgs/mosd/apid/src/routes.rs`),
   `get_state("mqtt")` (`pkgs/mosd/apid/src/routes.rs`),
   the health probe `get_state(HEALTH_PROBE_PATH)` (`pkgs/mosd/apid/src/routes.rs`)
   and the passthrough `get_state(&path)` (`pkgs/mosd/apid/src/routes.rs`).
5. **Schema version "3"** has stopped being one number at all. It read 4 when
   this section was written, then 7, then 9, then 12 — four re-measures of one
   row — and PLAN-070 §5.2.3 replaced the tree-wide version with one per
   document, each at **v1**
   (`pkgs/mosd/mosd-settings/src/documents.rs`). Which is the same lesson the
   four corrections were already teaching: section 2.1 must serve the number
   rather than document it.
6. **Its section 3.6 quotes a D-Bus policy that permits any local process**
; the shipped policy denies the
   default context in both directions (`pkgs/mosd/dist/com.mos.mosd.conf`) and
   allows root only (`pkgs/mosd/dist/com.mos.mosd.conf`). At `86cd669` this
   list recorded `docs/design/dashboard.md` as carrying the same stale reading;
   it no longer does, and now cites the root-only policy correctly
   (`docs/design/dashboard.md`).

Its navigation-bar count is likewise off, and so was this paragraph's
correction of it — it records *"exactly four links plus a logout button"*
, and `fn shell`
(`pkgs/mosd/apid/src/routes.rs`) now renders **nine** links, from
`a href="/" { "Status" }` (`pkgs/mosd/apid/src/routes.rs`), plus the logout
form `form method="post" action="/logout" {` (`pkgs/mosd/apid/src/routes.rs`):
Status, Network, Hostname, Password, Power, SSH, Containers, MQTT and the
built-in UI escape. `Password` is the one this paragraph did not have when it
said eight. Nothing in its section 9
contradiction table was re-verified here; that table is cited, not carried
forward.

## 2. The API surface — **[implemented]** in part, **[proposed]** for the rest

**Most of this section now ships**, and the two paragraphs that stood here
said the opposite. `pkgs/mosd/apid/openapi.json`
declares `"openapi": "3.1.0"` (`pkgs/mosd/apid/openapi.json`) for a document
titled `"title": "apid"` (`pkgs/mosd/apid/openapi.json`) at
`"version": "v1"` (`pkgs/mosd/apid/openapi.json`), and it declares **forty-six
paths carrying fifty-nine operations** — twenty-five `GET`, twenty-one `POST`,
nine `DELETE` and four `PUT` — beginning at `"/api/v1/actions/change-password"`
(`pkgs/mosd/apid/openapi.json`) and ending at `"/api/versions"`
(`pkgs/mosd/apid/openapi.json`), the whole map opening at `"paths": {`
(`pkgs/mosd/apid/openapi.json`). Its
`components.schemas`, which opens at `"schemas": {` (`pkgs/mosd/apid/openapi.json`), holds **fifty-six** entries, not
the five this paragraph recorded: `"ApiError"`
(`pkgs/mosd/apid/openapi.json`) and `"ApiErrorDetail"`
(`pkgs/mosd/apid/openapi.json`) still, plus the request and response bodies
M4-M8 added. The document is generated from the handlers
rather than written beside them and a test asserts the committed copy is
byte-identical to what the code produces, *"so the spec cannot describe a route
the code does not serve or miss one it does"* (`pkgs/mosd/apid/src/openapi.rs`),
which is why it is quoted here as a measurement rather than as documentation.

**Four read routes, no writes, no actions, no collections** was the state at
`f7cb5ba` and is the sentence the API campaign was written to retire. What ships now is
reads, writes, collections, action verbs and an unauthenticated first-run
route; `fn api_router` declares exactly the same method+path pairs from the
router's side, and the two cannot disagree because the document is generated
from the router.
Each subsection below opens by drawing its own line between what ships and what
is still proposed, and nothing is deleted for being unimplemented: an unbuilt
proposal is still the argument for building it.

### 2.1 Versioning and path shape — **[implemented]** for the shape, both discovery routes and JSON in both directions, **[proposed]** for the dual-major recommendation

**What ships.** The path shape, the version segment, both discovery routes and
JSON in both directions. `/api` is a reserved prefix, `const API: &str = "/api";`
(`pkgs/mosd/apid/src/routes.rs`), nested as `.nest(API, api_router())`
(`pkgs/mosd/apid/src/routes.rs`), and the version is the segment immediately
after it — `const V1_META_PATH: &str = "/v1/meta";`
(`pkgs/mosd/apid/src/routes.rs`). `GET /api/versions` answers unauthenticated
from `const SERVED_VERSIONS: [&str; 1] = ["v1"];`
(`pkgs/mosd/apid/src/routes.rs`) and `const CURRENT_VERSION: &str = "v1";`
(`pkgs/mosd/apid/src/routes.rs`), and `GET /api/v1/meta` answers authenticated
with `ApiMeta` whose `settingsSchemaVersion` is read live from
`settings_schema_version: mosd_settings::STATE_SCHEMA_VERSION,`
(`pkgs/mosd/apid/src/routes.rs`) rather than copied. The served set is an array
on the wire, `"versions"` typed `"type": "array"`
(`pkgs/mosd/apid/openapi.json`), so the dual-major recommendation below has
somewhere to land without a schema change.

**What does not ship.** The served set has exactly one member, so no device
serves two majors today and the dual-major recommendation is untested. There is
no `/api/v2` router. The breaking/additive lists below are a rule for future
changes under a future compatibility commitment, not current development
requirements. CI verifies the generated specification against the binary; it
does not reject changes for breaking compatibility with the base branch.

The clause that stood here — that **"JSON in" does not ship**, no route under
the prefix accepting a request body of any kind — is false as of M4 and was
falsified once more by every milestone after it. Seventeen operations take a
JSON body today, each as a `Result` so a malformed one is §2.4's `400
request_invalid` rather than axum's own rejection. Both directions this section
asks for now exist.

**Shape.** `/api/v1/<...>`. JSON in, JSON out, `Content-Type: application/json`
in both directions. The **thirty-two** existing HTML method+path pairs
(section 1.2) keep their method, their path and their behaviour unchanged; that
count was twenty-six when this paragraph was written, and the six added since
are `/password`, the two `/network/peers/*` posts and the three `/builtin`
posts, none of which is under `/api`. The prefix is reserved
**structurally** rather than by convention: the nest claims `/api`, `/api/x` and
`/api/x/y`, the explicit `.route("/api/", any(api_not_found))`
(`pkgs/mosd/apid/src/routes.rs`) claims the one spelling the nest does not, and
axum matches declared routes before the asset fallback, so no installed bundle
can occupy any part of it — *"no bundle can occupy the prefix and no route
under it can be reached by anything but a declaration here"*
(`pkgs/mosd/apid/src/routes.rs`).

**The version lives in the path segment immediately after `/api/`.**
Recommended, for three reasons that are properties of this codebase rather than
general taste:

1. The gate already dispatches on `let path = request.uri().path();`
   (`pkgs/mosd/apid/src/routes.rs`). A version check is the same string operation
   the one existing middleware already performs, so it needs no new extractor
   and no new failure mode in the layer that guards everything
   (`pkgs/mosd/apid/src/routes.rs`). This is now measurable rather than
   predicted: the shipped gate tests membership with `is_declared_api_route`
   (`pkgs/mosd/apid/src/routes.rs`), a pure string operation over the same
   constants the router declares.
2. axum registers routes by path (`pkgs/mosd/apid/src/routes.rs`). A second
   major version is a second `Router` under `/api/v2`, served from the same
   process and the same listener, with no per-handler branching and no shared
   handler that has to ask which version called it. `api_router()`
   (`pkgs/mosd/apid/src/routes.rs`) is the first of those routers and shows
   the shape.
3. It survives `curl` and a browser address bar with no header plumbing. That
   matters concretely here: SSH is off by default and stays off until an
   authenticated admin action (`pkgs/mosd/mosd-settings/src/model.rs`,
   `docs/design/access.md` §4.1), so for most devices the only tool an operator
   has against the appliance is whatever they can type on another machine.

**What that forecloses.** Per-resource versioning: `/api/v1/settings/...` and
`/api/v1/state/...` move together or not at all, so a breaking change to one
resource bumps the version of every resource. A `v2` duplicates the whole route
tree even for the routes that did not change. And the version string ends up
embedded in every URL a client has stored — a CI job pins `v1` in its
configuration rather than in a header it could strip — which is a migration cost
paid by every caller, not by apid.

**Rejected: a media-type header** (`Accept: application/vnd.mos.v1+json`). It is
invisible in a log line, invisible in an address bar, and it requires the client
to set the header correctly before it can discover that it set it wrong.
**Rejected: a query parameter** (`?v=1`). It would in fact survive the HTTP→HTTPS
redirect, which preserves path *and* query —
`let path = request.uri().path_and_query().map_or("/", |pq| pq.as_str());`
(`pkgs/mosd/apid/src/routes.rs`) — that is not the objection. The
objection is that an absent parameter must default to something, and the only
safe default is to refuse, which turns a forgotten parameter into an error on a
path that otherwise looks correct. An unknown path prefix is a 404 that names
itself.

**Historical versioning proposal; not required during system development.**
Backward compatibility is required only when explicitly requested. The following
classification records the earlier proposal and does not mandate a version bump
or an adapter for current changes. Under that proposal, `v1` → `v2` happens on a change that can
break a *correct* v1 client, and the two lists are exhaustive:

- **Breaking, bumps the version:** removing a route; removing a response field;
  narrowing a field's type or its accepted value set; adding a required request
  field; changing the success status code of an existing outcome; changing which
  `error.code` (§2.4) an existing failure emits.
- **Additive, does not bump:** a new route; a new response field; a new
  *optional* request field; a new `error.code` for a failure that previously had
  no distinct code; a new value in an enum the client was told to treat as open.

That last item is only safe if the obligation is stated as a rule the client
must obey, not as an aspiration: **a v1 client must ignore response fields it
does not recognise, and must treat an unrecognised `error.code` as its HTTP
status class.** A client that hard-fails on an unknown field converts every
additive change into a breaking one, and then the version number is no longer
carrying the contract — apid is. This document states the rule here so that a
later argument about whether some change was breaking has a written answer.

**How a client discovers the version it is talking to.** Two endpoints, and they
answer different questions.

| Route | Auth | Response | Answers |
|---|---|---|---|
| `GET /api/versions` | **none** | `{"versions":["v1"],"current":"v1"}` | "which major versions does this device serve?" |
| `GET /api/v1/meta` | bearer API token | `{"api":"v1","settingsSchemaVersion":1,"daemon":"apid"}` | "what am I talking to, in detail?" |

Both rows ship. The first is declared as `.route(VERSIONS_PATH, get(api_versions))`
(`pkgs/mosd/apid/src/routes.rs`) and handled at `pub(crate) async fn api_versions`
(`pkgs/mosd/apid/src/routes.rs`); the second as
`.route(V1_META_PATH, get(api_v1_meta))` (`pkgs/mosd/apid/src/routes.rs`), handled at
`pub(crate) async fn api_v1_meta` (`pkgs/mosd/apid/src/routes.rs`). The `meta` row's
`settingsSchemaVersion` was written as `4` here when this section was drafted,
corrected to `6`, reached **12**, and is **1** today, which is the whole
argument for reading it from `mosd_settings` at request time rather than
documenting a number: the value in this table is an illustration and the device
is the source. It went *backwards* because PLAN-070 §5.2.3 replaced the one
tree-wide version with one per document, each starting at v1 — see below. The `Auth`
column moved too — since M9 the credential on the second row is a bearer API
token and a session cookie is not one (§1.4, §3.2).

**`versions` is a set, and this document calls it the *served set*.** The field
is an array rather than a string because the answer can legitimately have more
than one member — see the dual-major recommendation at the end of this section —
and `current` names the member a client with no preference should use.
`current` is always a member of `versions`. **No other section of this document
may treat "the version apid serves" as a single value:** §6.1's
bundle-compatibility check tests **membership in the served set**, not equality
with `current`, and both sections use the phrase *served set* to mean this
array. A client that reads only `current` and ignores `versions` will conclude
that a device it can still talk to is one it cannot.

`settingsSchemaVersion` carries the **STATE document's** version
(`pub const STATE_SCHEMA_VERSION: u32 = 1;`,
`pkgs/mosd/mosd-settings/src/documents.rs`; **12** before PLAN-070, **9** at an
earlier re-measure, **6** at `f7cb5ba` and **4** when this paragraph was
written). **It is not the API version and the two must never be conflated.**

**And since PLAN-070 §5.2.3 it is no longer "the" schema version, because there
is not one.** Settings are stored as one JSON document per reconciler under
`/mos/config/` plus the remainder on STATE
(`pkgs/mosd/mosd-settings/src/documents.rs`), each carrying its own
`schema_version` and each starting at v1; the registered `V0→V12` migration
chain was deleted with the single document it migrated, and `schema_version` is
not a key of the addressed tree any more. This member therefore reports the one
document that is still one document. **A client that needs to know whether it
understands a particular subtree's body cannot get that from this number**, and
nothing has been added to give it to them — recorded here as the honest state
rather than papered over. The shipped handler
does exactly what this paragraph asks — the doc comment on it says
*"`settingsSchemaVersion` is read from `mosd_settings` and never copied: the
number a client uses to decide whether it understands a settings body has
exactly one source"* (`pkgs/mosd/apid/src/routes.rs`). The API version is the
shape of this HTTP contract. Either can move without the other, and a client
that writes settings-shaped bodies (§2.2) needs both.

**Why `/api/versions` is unauthenticated, and what that costs.** Section 6 of
this document requires a UI to be able to detect that it cannot talk to the API
version it found. That check has to run *before* the UI has a credential: a UI
installed on DATA survives the A/B update that replaced apid
(`docs/design/access.md`), and on a factory-fresh device there is no
`access.webAdmin` at all (`pkgs/mosd/mosd-settings/src/model.rs`), so the
gate is in setup mode and redirects everything except `/setup`
(`pkgs/mosd/apid/src/routes.rs`). An authenticated probe cannot answer the
question it exists to answer. **This shipped as written**, and the handler's
doc comment gives the same reasoning back: *"a factory-fresh
device has no `access.webAdmin` and redirects everything else to `/setup`, and
a UI that survived the update it is incompatible with has to be able to say
so"* (`pkgs/mosd/apid/src/routes.rs`); the gate hands the route off above its own
bus call at `pkgs/mosd/apid/src/routes.rs`. The cost is an unauthenticated
fingerprint: anyone who can reach port 443 (`pkgs/mosd/apid/src/config.rs`)
learns which API major versions this device speaks. The appliance already
answers `/healthz` with the literal `"ok"` unauthenticated
(`pkgs/mosd/apid/src/routes.rs`, released by the gate at
`if path == "/healthz" || is_declared_api_route(path) {` (`pkgs/mosd/apid/src/routes.rs`)),
so this is one more bit on a
listener that already identifies itself — it is not zero, and it is exactly why
the shipped response carries a version list and nothing else: not the hostname,
not the device identity (`pkgs/mosd/mosd-settings/src/model.rs`), not a
build string.

**Historical cross-release proposal; not a current compatibility promise.** The
honest starting point is that **there is no apid patch release independent of an
image update.** The binary is `ExecStart=/usr/bin/apid`
(`pkgs/mosd/dist/apid.service`), and `/` is a verity-protected squashfs
(`docs/design/access.md`); RAUC writes only the ROOTFS and BOOT slots
(`docs/design/access.md`). Every
change to apid therefore arrives as an A/B image update, and "patch release"
can only mean "an image in which apid changed additively". With that said, two
promises, and they are not the same promise:

- **Within a major version, across any image:** every route that existed keeps
  its path, its method, its success status code and its response fields.
  Additions per the list above are permitted. A client written against the first
  `v1` image works against every later `v1` image.
- **Across a major version bump:** nothing is promised except that
  `GET /api/versions` still answers and still lists what is served. **apid should
  serve the outgoing major version alongside the new one for at least one image
  generation.** The reason is specific to this appliance: the UI that a version
  bump breaks is installed on DATA and *survived* the update that broke it,
  and the operator's route to fixing it may be
  that same UI (`docs/design/access.md`). The cost is two route trees in one binary, two sets of handlers
  that must both keep behaving, and a deprecation the project has to actually
  execute rather than carry forever. Sequencing that is §8's, not this
  section's; what this section records is the consequence of *not* doing it — a
  single-version-at-a-time apid makes the §6 escape the only recovery from a
  version bump, which is a much larger promise for §6 to keep. **While both are
  served, the served set has two members** — `GET /api/versions` answers
  `{"versions":["v1","v2"],"current":"v2"}` — and a bundle built against `v1`
  stays compatible for exactly that generation. That is the entire content of
  the recommendation, and it is why §6.1's deactivation trigger is written
  against the set and fires only on an empty intersection: a check written as
  equality against `current` would deactivate precisely the bundles this
  recommendation exists to protect.

### 2.2 Resource model — **[implemented]** for the two read-only roots and redaction, **[proposed]** for writes, actions and collections

**What ships.** Two of the three roots below exist, read-only. The settings
root is `const V1_SETTINGS_ROUTE: &str = "/v1/settings/{*path}";`
and is declared and handled in `pkgs/mosd/apid/src/routes.rs` by
`api_v1_settings`, whose whole body is
`resource_response(state.api.get_settings(&path).await, &path)`
(`pkgs/mosd/apid/src/routes.rs`) — the dot-path passthrough this section asks
for, with no second model beside it. The live-state root is the same shape,
`const V1_STATE_ROUTE: &str = "/v1/state/{*path}";`
(`pkgs/mosd/apid/src/routes.rs`), ending in
`resource_response(value, &path)`
(`pkgs/mosd/apid/src/routes.rs`). Both answer `ResourceValue`
(`pkgs/mosd/apid/src/routes.rs`), which carries a
`serde(transparent)` attribute (`pkgs/mosd/apid/src/routes.rs`) so the body is
mosd's value and not a wrapper around it.

**Redaction ships, and it ships wider than this section proposed.** The
structural redactor is `pkgs/mosd/apid/src/redact.rs`, its denylist is
`const SECRET_FIELDS: [&str; 5] = ["psk", "passwordHash", "password_hash", "hash", "privateKey"];`
(`pkgs/mosd/apid/src/redact.rs`) — the four field names named below, plus
the `privateKey` added as a fail-closed guard for a field no shipped
schema carries — and
the sentinel is `pub const REDACTED: &str = "<redacted>";`
(`pkgs/mosd/apid/src/redact.rs`). It walks objects and arrays at any depth
(`pkgs/mosd/apid/src/redact.rs`) and also reads the requested dot-path, so
that a request naming a secret field directly is caught even though the body
has no field name left in it (`pkgs/mosd/apid/src/redact.rs`). The
fail-open property this section names as a residual risk is stated by the
module itself — *"The list is fail-open: a secret-bearing field under a name it
does not carry is served"* (`pkgs/mosd/apid/src/redact.rs`) — and the
mitigation this section asks for, a test rather than a hope, is named there
too (`pkgs/mosd/apid/src/redact.rs`). **The difference from what is proposed
below:** this section states redaction as a rule of the *settings* root, and
the shipped redactor is applied to the live-state root as well, on the reasoning
that mosd's state tree is untyped and *"a denylist that covers one root while
the other serves them verbatim is a hole with a tested-looking lid"*
(`pkgs/mosd/apid/src/redact.rs`). That is wider than proposed and is recorded
here rather than quietly accepted.

**What does not ship.** No `PUT`, anywhere: the two roots are `GET` only, so
the write half of every row below is a proposal. The `/api/v1/actions/<verb>`
root exists and holds exactly one verb, added deliberately:
`"/api/v1/actions/wireguard/{iface}/rotate-key"`
(`pkgs/mosd/apid/openapi.json`), a `POST` that draws a WireGuard interface
a new private key and answers its public half. It is a route and not a settings
write because *"An action and not a settings write, because there is no setting
to write"* (`pkgs/mosd/apid/src/routes.rs`) — the key lives in a file on
STATE the settings tree does not describe.
None of the three verbs §2.3 proposes — `reboot`, `poweroff`,
`transient-root-password` — is served: the published document lists five
operations and the other four are the two resource roots, `/api/v1/meta` and
`/api/versions` (`pkgs/mosd/apid/openapi.json`). Neither collection
resource exists. The rule that a `PUT`
carrying `"<redacted>"` is refused at 422 is discharged deliberately —
the source says so directly, *"the write route refuses any body that carries
it, at 422, rather than storing it"*
(`pkgs/mosd/apid/src/routes.rs`). And `GET /api/v1/state/{path}` today
exposes the whole live-state tree to any authenticated caller, which is wider
than the HTML panes read (section 1.5).

Derived from `pkgs/mosd/mosd-settings/src/model.rs` and `pkgs/mosd/mosd/src/bus.rs`,
re-measured at `f7cb5ba`, when the crates still sat above `pkgs/`.
Nothing here invents a model alongside mosd's; where
the settings tree and a sensible REST resource genuinely disagree, the
disagreement is named and the choice is costed.

**Four roots, because execution records are not settings, state, or actions.**

| Root | Backed by | Methods | Why it is separate |
|---|---|---|---|
| `/api/v1/settings/<dot-path>` | the typed `Settings` tree (`pkgs/mosd/mosd-settings/src/model.rs`) via `GetSettings` and `SetSettings` — `get_settings` (`pkgs/mosd/mosd/src/bus.rs`) and `set_settings` (`pkgs/mosd/mosd/src/bus.rs`) | `GET`, `PUT` | typed, validated, persisted to `/var/lib/mos/settings.toml` (`pkgs/mosd/mosd-settings/src/store.rs`), survives reboot and A/B update (`docs/design/access.md`) |
| `/api/v1/state/<dot-path>` | the live-state tree via `GetState` — `get_state` (`pkgs/mosd/mosd/src/bus.rs`) | `GET` only | an untyped `Value` (`pkgs/mosd/mosd/src/bus.rs`), in memory, written only from inside mosd by the five writers section 1.5 names |
| `/api/v1/actions/<verb>` | dedicated `Reboot`, `PowerOff`, and `SetTransientRootPassword` methods on `com.mos.mosd1` (`pkgs/mosd/mosd/src/bus.rs`) | `POST` only | not state at all — see §2.3 |
| `/api/v1/tasks`, `/api/v1/tasks/<id>` | mosd's bounded apply queue, mirrored by apid from `TaskChanged` with `GetTask` fallback | `GET` only | an execution lifecycle for a persisted write; queued/running is not yet applied, finished carries the outcome |

The split is mosd's, not a stylistic preference. The two trees have different
types (`settings: Settings` and `state: Value`, `pkgs/mosd/mosd/src/bus.rs`),
different mutability (`SetSettings` exists; there is no `SetState` anywhere in
the proxy trait, `pkgs/mosd/apid/src/bus_client.rs`, nor in mosd's interface
impl, `pkgs/mosd/mosd/src/bus.rs`), and different lifetimes (the settings tree
is saved atomically on every write, `pkgs/mosd/mosd/src/bus.rs`; the live-state
tree is a field of `Inner` that starts empty or as `{"dry_run": true}`,
`pkgs/mosd/mosd/src/bus.rs`, `pkgs/mosd/mosd/src/main.rs`). An API that merged
them would have to decide on every request which half a path belonged to.

**The dot-path is the resource identifier, verbatim.** `GET
/api/v1/settings/access.ssh` returns exactly what `GetSettings("access.ssh")`
returns (`pkgs/mosd/mosd/src/bus.rs`). `PUT /api/v1/settings/hostname` with
body `"router"` performs exactly one `SetSettings("hostname", "\"router\"")` call, which parses
the JSON and writes it at the path (`pkgs/mosd/mosd/src/bus.rs`). This is
the recommendation, and the
alternative it rejects is the interesting part.

**Rejected: hand-shaped REST nouns that do not map onto the tree** (`GET
/api/v1/ssh`, `PATCH /api/v1/network/eth0`). What it costs is not extra code —
it is a second model that has to be kept in sync with `model.rs` by hand. Every
field added to `Settings` is invisible over the API until someone also adds it
to the resource layer, and a field that is invisible over the API is, by this
project's own rule, unsupported: *"An unmodelled setting is an unsupported
setting"* (`docs/design/access.md`). Hand-shaped nouns reproduce exactly
that failure one layer up, where neither the compiler nor the model's
`deny_unknown_fields` guards can notice the omission. The passthrough cannot
drift, because there is nothing to drift from.

**What the passthrough costs, stated plainly.** The API becomes exactly as
capable as the bus, including the bus's limits:

- **No array indexing.** The dot-path syntax has none; the model says a list is
  *"Written as a whole JSON array through the dot-path API"*
  (`pkgs/mosd/mosd-settings/src/model.rs`). Every client that wants to add
  one SSH key must read `access.ssh.authorizedKeys`, append, and write the whole
  list back — which is precisely what the HTML pane does today
  (`pkgs/mosd/apid/src/routes.rs`). Two clients doing that concurrently
  lose one of the two writes, with no mechanism that notices.
- **Whole-subtree writes are all-or-nothing.** `Settings::set` deserializes the
  entire root into `Settings` after the write and rejects the result if it does
  not fit (`pkgs/mosd/mosd-settings/src/model.rs`), and every struct carries
  `#[serde(deny_unknown_fields)]`, so a `PUT` of a subtree with one extra key
  fails the whole write. That is a good property — it is also a surprising one
  for a client that expected a merge.
- **A key holding a dot is addressed with a quoted segment.** apid accepts an
  interface name containing `.` — `^[a-zA-Z0-9._-]{1,15}$`
  (`pkgs/mosd/apid/src/routes.rs`) — and until later the
  dot-path split through it, so `network.eth0.100` addressed a field named `100`
  inside `IfaceSettings` rather than the interface `eth0.100`. That was fixed in
  the path lexer, not in the API. A segment is now either bare or double-quoted,
  *"in which `.` is an ordinary character"*
  (`pkgs/mosd/mosd-settings/src/path.rs`), so the VLAN sub-interface is
  `GET`/`PUT /api/v1/settings/network."eth0.100".dhcp`. *"The spelling is TOML's
  own quoted-key syntax"* (`pkgs/mosd/mosd-settings/src/path.rs`) — the
  notation the store was already writing for such a key — so `settings.toml` on
  STATE and an API path are spelled the same way. One lexer serves both
  directions: *"Reads and writes share [`split_path`]: a path that resolves for
  `get` is spelled exactly the way it is spelled for `set`"*
  (`pkgs/mosd/mosd-settings/src/path.rs`), and a client composing a
  path spells a segment *"bare when it can be, quoted when it contains a `.`"*
  (`pkgs/mosd/mosd-settings/src/path.rs`).

  Two residues a client is still owed. **The unquoted spelling did not become an
  alias**: `network.eth0.100` against a tree that declares `eth0` still fails,
  and against schema v7 the field list it names is longer — measured
  2026-08-28, `Settings::set` returns `Validation { path: "network.eth0.100",
  message: "unknown field `100`, expected one of `kind`, `dhcp`, `static`,
  `vlan`, `bridge`, `wireguard`" }`, which reaches a client as §2.4's
  `settings_rejected` and not as a 502. **A key containing a double quote has no
  spelling at all**, and schema v7 closes that hole from the other side rather
  than leaving it as an addressing gap: *"Refuse a `network` map key the kernel
  could not name an interface"* (`pkgs/mosd/mosd-settings/src/model.rs`)
  runs on the write path, which makes such a key structurally impossible instead
  of merely unaddressable.

**The exception: two collection resources, added deliberately.** The dot-path
model fails outright for the two arrays in the tree, because a per-item delete
cannot be expressed as a settings write at all. Both get a named collection:

| Collection | Underlying dot-path | Item identity | Routes |
|---|---|---|---|
| SSH authorized keys | `access.ssh.authorizedKeys` — `authorizedKeys` (`pkgs/mosd/mosd-settings/src/model.rs`) | SSH fingerprint | `GET`/`POST /api/v1/ssh/authorized-keys`, `DELETE /api/v1/ssh/authorized-keys/{fingerprint}` |
| WiFi client networks | `wifi.client.networks` — `networks` (`pkgs/mosd/mosd-settings/src/model.rs`) | `ssid` | `GET`/`POST /api/v1/wifi/client/networks`, `DELETE /api/v1/wifi/client/networks/{ssid}` |

**Identity is never a list index.** The reason is already recorded in the crate,
and it is the reason here too: *"an index is only meaningful against the list the
operator was looking at, so a key added or removed by another session between the
render and the submit would slide it onto a different key and delete something
nobody asked to delete"* (`pkgs/mosd/apid/src/routes.rs`). A `DELETE` whose
identifier matches nothing is an error, not a silent success, for the reason the
same comment gives: *"'removed' when nothing was removed is how an operator ends
up believing access was withdrawn while the key still grants root."*

**What the exception costs.** There are now two ways to write the same state:
`PUT /api/v1/settings/access.ssh.authorizedKeys` and `DELETE
/api/v1/ssh/authorized-keys/{fingerprint}`. A client using the first can produce
a list the second would have rejected. The floor is the same either way, because
both end at `SetSettings` → `Settings::set` → `store.save`
(`pkgs/mosd/mosd/src/bus.rs`), and the collection route additionally runs
`validate_authorized_keys` first — the same validator mosd runs before rendering
the file (`pkgs/mosd/apid/src/routes.rs`). So the difference is the quality
of the error message, not whether a bad list can be written. That is an
acceptable cost and it is named rather than hidden. The passthrough route must
**not** be removed for these two paths: removing it would make the collection the
only way in, and a client that needs to replace a whole list atomically would
have to issue N deletes and M posts with no atomicity at all.

**Redaction is a rule of this root, not of a handler.** As of `86cd669`,
`GetSettings("access")` returns the subtree verbatim
(`pkgs/mosd/mosd/src/bus.rs`), and the admin hash lives under it as
`password_hash` (`pkgs/mosd/mosd-settings/src/model.rs`). A settings
passthrough with no redaction therefore hands the admin password hash — and
`access.device.passwordHash`, `wifi.ap.psk` and every
`wifi.client.networks[].psk` — to any authenticated API caller. The
rule: **every `GET` under `/api/v1/settings/` passes the value through a
structural redactor before serialising it**, replacing the value of any field
named `password_hash`, `passwordHash`, `psk`, or `hash` — anywhere in the tree,
at any depth — with the sentinel `"<redacted>"`. It must be structural rather
than a list of dot-paths, because the two `psk` fields sit inside arrays and the
dot-path syntax cannot name them (`pkgs/mosd/mosd-settings/src/model.rs`).
The residual risk is stated: this is a denylist, so a future secret-bearing field
under a name not on it is exposed by default. That is a fail-open design and the
mitigation is a test, not a hope. A redacted field is
**read-only through the API**: a `PUT` whose body contains `"<redacted>"` is
rejected at 422 rather than written, because writing the sentinel would silently
destroy the credential.

**The resource inventory.** Every subtree in section 1.5's table, mapped:

| Concern | API resource | Backing | Notes |
|---|---|---|---|
| System / identity | `GET /api/v1/settings/provisioning` | `ProvisioningSettings` (`pkgs/mosd/mosd-settings/src/model.rs`) | `state`, `deviceId`, `seededGeneration`; written by first-boot provisioning, not by an operator |
| Schema version | `GET /api/v1/meta` | `STATE_SCHEMA_VERSION` (`pkgs/mosd/mosd-settings/src/documents.rs`) | one version per document since PLAN-070 §5.2.3, and this member reports the STATE document's; `schema_version` is not a key of the tree, so `/api/v1/settings/schema_version` is a **404** and there is nothing to write |
| Hostname | `GET`/`PUT /api/v1/settings/hostname` | `String` (`pkgs/mosd/mosd-settings/src/model.rs`) | body is a bare JSON string; reconciled by `hostname` (`pkgs/mosd/mosd/src/reconciler/hostname.rs`) |
| Network | `GET`/`PUT /api/v1/settings/network`, `.../network.<iface>` | `BTreeMap<String, IfaceSettings>` (`pkgs/mosd/mosd-settings/src/model.rs`) | an entry's `kind` selects which of the `vlan`, `bridge` and `wireguard` blocks is meaningful; a key holding a `.` is addressed with a quoted segment (above) |
| WiFi station | `GET /api/v1/settings/wifi.client`, `PUT /api/v1/settings/wifi.client.enabled` + the networks collection | `WifiClientSettings` (`pkgs/mosd/mosd-settings/src/model.rs`) | switch body is a bare JSON boolean; returns 202 with an apply task; the parent subtree and interface remain read-only through this route; `psk` redacted on read |
| WiFi AP | `GET`/`PUT /api/v1/settings/wifi.ap` | `WifiApSettings` (`pkgs/mosd/mosd-settings/src/model.rs`) | `psk` redacted on read; `mode` is `off`/`provisioning`/`always` |
| SSH enable state and policy | `GET`/`PUT /api/v1/settings/access.ssh`, `.../access.ssh.enabled` | `SshSettings` (`pkgs/mosd/mosd-settings/src/model.rs`) | default `enabled: false` |
| SSH keys | the authorized-keys collection above | `access.ssh.authorizedKeys` | **every key is a root key** (`docs/design/access.md` §4.1, `pkgs/mosd/apid/src/routes.rs`); the API response must carry that sentence in a `notice` field for the same reason the pane must carry it |
| Transient root password | `POST /api/v1/actions/transient-root-password` | `set_transient_root_password` (`pkgs/mosd/mosd/src/bus.rs`) | an action, not a setting — see §2.3 |
| Web admin credential | `GET /api/v1/settings/access.webAdmin` (redacted), `PUT` refused | `WebAdminSettings` (`pkgs/mosd/mosd-settings/src/model.rs`) | see §3.2 for why the API does not offer a password change in phase 1 |
| Console | `GET`/`PUT /api/v1/settings/access.console` | `ConsoleSettings` (`pkgs/mosd/mosd-settings/src/model.rs`) | only the `debug` image ships the shell at all (`pkgs/mosd/mosd-settings/src/model.rs`) |
| Power | `POST /api/v1/actions/reboot`, `.../poweroff` | dedicated `Reboot` / `PowerOff` methods on `com.mos.mosd1` | actions — see §2.3 |
| Reconciler results | `GET /api/v1/state/<name>` for `hostname`, `network`, `sshd`, `wifiClient`, `wifiAp`, `container`, `mqtt` | one key per reconciler (`pkgs/mosd/mosd/src/bus.rs`) | an entry is either the applied result or `{"error": "..."}`; the API passes both through unchanged |
| Apply tasks | `GET /api/v1/tasks`, `GET /api/v1/tasks/{id}` | mosd's bounded in-memory apply queue and apid's signal-fed registry | `queued`/`running` are non-terminal; `finished` carries `succeeded`, `failed`, or the apid-inferred `interrupted` after restart/history loss |
| Last power request | `GET /api/v1/state/power` | the keys `last_action` and `requested_by` (`pkgs/mosd/mosd/src/bus.rs`) | recorded *before* the action, so it survives the machine going down |
| Updates | `GET /api/v1/update` + `POST /api/v1/update/{check,fetch,install,mark,rollback,reboot-override,clear-suppression,config}` (`pkgs/mosd/apid/src/update_api.rs`) | `GetUpdateState` / `CheckUpdate` / `FetchUpdate` / `InstallUpdate` / `MarkUpdate` / `SetRebootOverride` / `ClearUpdateSuppression` / `SetUpdateConfig` on `com.mos.mosd1` | the lifecycle cluster of `docs/design/updates.md`; policy refusals answer **409** `policy_refused`, the one mapping the cluster adds. `clear-suppression` lifts PLAN-071 §6's automatic-install refusal on one named version — a manual install of that version was never refused. **`config` is the one write in the cluster** and the only route that changes what the device does unattended: it takes a *patch* of the operator document, not the resolved policy, and splits its refusals three ways — **422** the patch is wrong, **409** the document already on the device does not load, **500** the disk (`docs/design/updates.md` §3.4) |
| Health | `GET /api/v1/state/health` and `GET /api/v1/health` | the `health` subtree, one key per component (`pkgs/mosd/mosd/src/bus.rs`) | the two are different questions — see §2.4 |
| Dry-run marker | `GET /api/v1/state/dry_run` | set from `std::env::var("MOSD_DRY_RUN")` (`pkgs/mosd/mosd/src/main.rs`) and inserted at `pkgs/mosd/mosd/src/main.rs` | in that mode no reconcilers are registered at all (`pkgs/mosd/mosd/src/main.rs`), so every other state key is absent |

**Where the settings tree and a sensible REST resource genuinely disagree, and
what was chosen.** Three cases, all decided toward the tree:

1. **SSH is one resource in the tree and two concerns to an operator** —
   "is sshd running" (`access.ssh.enabled`) and "who may log in"
   (`access.ssh.authorizedKeys`). REST wants two resources with different
   lifecycles. Chosen: the tree, plus the keys collection as the single
   exception. Cost: `PUT /api/v1/settings/access.ssh` can flip `enabled` and
   replace the key list in one indivisible write, which is convenient and is
   also a way to lock yourself out in one request.
2. **`hostname` is a bare scalar at the root.** REST wants
   `/api/v1/system` with `{"hostname": ...}`. Chosen: the tree, so the body of
   `PUT /api/v1/settings/hostname` is the bare JSON string `"router"` — which is
   valid JSON and which some HTTP clients make awkward to send. Cost: named,
   accepted; the alternative would have been the first hand-shaped noun and
   there would then be an argument about the second.
3. **Uptime is a top-level live-state scalar.** The status pane used to read
   `/proc/uptime` in apid — one of the disk paths apid touched (section 1.6) —
   which contradicted the rule the crate states about itself: *"mosd owns
   every system action: apid never spawns a process and never talks to
   systemd itself"* (`pkgs/mosd/apid/src/settings_api.rs`). **Chosen: mosd
   publishes it**, and it now does: `GetState` refreshes the live-state key
   `uptime` (whole seconds since boot, a bare JSON number read from mosd's own
   `/proc/uptime`) on every call before resolving the requested path, so the
   value a read observes is never a stale cached counter, and
   `GET /api/v1/state/uptime` serves it like every other system fact. The
   refresh point is the read itself rather than a timer, because a timer is a
   staleness bound somebody has to choose and defend; apid's `/proc` reader is
   deleted and the status pane renders `get_state("uptime")`.

### 2.3 Operation inventory — superseded by the published schema

This subsection held a row-per-route inventory pairing each server-rendered
form post with the API route that would replace it. It was written when the
API surface was four `GET` paths, so every "API equivalent" column named a
route that did not exist.

That is no longer the state of the tree. `pkgs/mosd/apid/openapi.json`
specifies every path the surface serves — the settings write, task reads, the
action verbs and the collection routes the inventory anticipated, and the
update, storage, diagnostics, telemetry, time and recovery surfaces that came
after it. It is generated from the code and gated in CI, so it answers "which
operations exist" without a second copy to keep in step, and this document does
not restate the count.

What the schema does not carry, and this document therefore keeps, is why the
surface has the shape it does: the resource model of section 2.2, the error
contract of section 2.4, and the phasing of section 8.

**Actions, not resources.** Three operations are verbs with no state to `GET`
and no idempotency to promise: `reboot`, `poweroff` and
`transient-root-password`. They live under `/api/v1/actions/<verb>`, `POST`
only, and the namespace is named `actions` precisely so that no reader expects
a `GET` to work there. This mirrors the decision already taken in the HTML
router, where no `GET` handler exists for either power action or for any of the
SSH mutations, so that a browser prefetch, a crawler or a mis-clicked link
cannot power the appliance off.

**Decision 1: the archive format for the upload transport.** The obvious tar
and zip candidates split exactly along the no-C-dependency line that the
workspace ban list enforces.

**Decision 2: authorisation for installing a bundle.** The only credential in
the crate today is the single webAdmin password, and an operation that installs
content served from the management origin needs its own answer rather than that
default. Until both decisions exist the `/mos/ui` bundle store stays
route-less — deliberately, not by oversight — even though the store itself is
complete: layout, validation, atomic activation, deactivation, generation
tracking and a status read. Installation stays out of band until then: write
into `/mos/ui` and restart apid.

**One behaviour change the API makes, named because it is a change.** Removing
an SSH key by an identifier that matches nothing answers **422** on the HTML
path. For a `DELETE` on a collection resource that is a **404** — the
identified item does not exist — and the API uses 404. The HTML path is not
changed by this document.

### 2.4 Error shape — **[implemented]** for the envelope, all seventeen of the codes it names, five more it never proposed, and case 3's health route

**What ships.** The envelope exists, in both the code and the published schema.
`ApiError` is a one-field struct wrapping `ApiErrorDetail`
(`pub(crate) struct ApiError {`, `pkgs/mosd/apid/src/routes.rs`; payload at
`pub(crate) struct ApiErrorDetail {`, `pkgs/mosd/apid/src/routes.rs`), the schema records
it as `"required": [ "error" ]` (`pkgs/mosd/apid/openapi.json`), and every
failure under the prefix is built through it. `Retry-After` ships on exactly
one class: `const RETRY_AFTER_SECONDS: &str = "5";`
(`pkgs/mosd/apid/src/routes.rs`), attached only when the status is 503
(`pkgs/mosd/apid/src/routes.rs`). The recommendation this section makes —
translate the classification, pass mosd's message through verbatim, always say
which side it came from — ships as `fn bus_api_error`
(`pkgs/mosd/apid/src/routes.rs`), which matches on the concrete
`zbus::Error::MethodError` before the conversion flattens it and maps the five
error names declared at `const MOSD_NOT_FOUND: &str = "com.mos.mosd1.Error.NotFound";`
(`pkgs/mosd/apid/src/routes.rs`) — two
interface-scoped (`com.mos.mosd1.Error.NotFound`, `com.mos.mosd1.Error.ReadOnly`,
coined by mosd because the fdo vocabulary cannot separate a missing dot-path or
a read-only one from a bad value) and three standard fdo names. The source
states the rule in the same words this section chose: *"The classification is
translated and the message is not"* (`pkgs/mosd/apid/src/routes.rs`).

**The envelope, field by field against what ships.** Four differences, each a
finding rather than a thing to quietly align:

| Field | Proposed below | In `pkgs/mosd/apid/openapi.json` | Difference |
|---|---|---|---|
| `error` | the only top-level member | `"required": [ "error" ]` (`pkgs/mosd/apid/openapi.json`) | none |
| `code` | *"stable machine token; an OPEN set"* | `"type": "string"` (`pkgs/mosd/apid/openapi.json`), required | none in shape. The **open set** is stated only in the description (`pkgs/mosd/apid/openapi.json`); nothing in the schema expresses it, so a generated client learns the rule only if a human reads the prose |
| `message` | *"human-readable; not for matching on"* | `"type": "string"` (`pkgs/mosd/apid/openapi.json`), required | none |
| `source` | `"apid" \| "mosd"`, an enum of exactly two | `"type": "string"` (`pkgs/mosd/apid/openapi.json`), required, **no `enum`** | **a real difference.** The Rust type admits only two values, because `ApiError` is constructed by exactly two constructors, `ApiError::apid`, which passes `Self::new(code, message, "apid")`
(`pkgs/mosd/apid/src/routes.rs`), and `ApiError::mosd`, which passes
`Self::new(code, message, "mosd")` (`pkgs/mosd/apid/src/routes.rs`). The published contract does not say so, so a client generated from the document gets an unconstrained string and cannot exhaustively match on it |
| `path` | OPTIONAL, present only when the failure names a dot-path | `"type": [ "string", "null" ]` (`pkgs/mosd/apid/openapi.json`), **absent from `required`** | **a real difference, in the opposite direction.** The schema admits an explicit `null`; the wire never carries one, because the field carries a `serde(skip_serializing_if = "Option::is_none")` attribute (`pkgs/mosd/apid/src/routes.rs`) and is therefore omitted rather than nulled — which is the behaviour this section asks for and the source's own doc comment defends (`pkgs/mosd/apid/src/routes.rs`). The schema is wider than the implementation, so a client that handles `null` is handling a case the device does not produce |

**The code table against what ships, re-audited here's closeout.** The
snapshot that stood here recorded eleven rows, nine shipping and two not, and
it is out of date in both directions. A later pass flagged that its heading count
and its two `no` rows had been overtaken and correctly refused to correct a
count over a table it had not re-audited; this is the audit.

The measurement is every `ApiError::apid(` and `ApiError::mosd(` construction
in `pkgs/mosd/apid/src/routes.rs` — **fifty-seven call sites carrying
twenty-two distinct codes**. Against that:

- **All seventeen codes this section's table below names now ship.** The two
  this snapshot recorded as **not** shipping — `request_invalid` and
  `validation_failed` — both do, and both stopped being hypothetical for the
  same reason: routes under `/api` accept request bodies now, so a body can be
  malformed and apid's own validators can reject one.
- **Five codes ship that this section never proposed**, each added by a
  milestone that needed a name for a condition the table had none for:
  `settings_invalid` (five sites: a stored list that does not parse, which is
  an error rather than an empty list wherever a write follows —
  `pkgs/mosd/apid/src/routes.rs`, `pkgs/mosd/apid/src/routes.rs`, `pkgs/mosd/apid/src/routes.rs`,
  `pkgs/mosd/apid/src/routes.rs`, `pkgs/mosd/apid/src/routes.rs`), `already_configured`
  (`pkgs/mosd/apid/src/routes.rs`), `mint_failed` (`pkgs/mosd/apid/src/routes.rs`,
  `pkgs/mosd/apid/src/routes.rs`), `hash_failed` (`pkgs/mosd/apid/src/routes.rs`) and
  `hashing_failed` (`pkgs/mosd/apid/src/routes.rs`). They are additive under §2.1 — a
  new `error.code` for a failure that previously had no distinct code — and
  they are listed here rather than folded into the table below because that
  table is this section's *proposal* and these were not proposed.

Two of the seventeen came from splitting `settings_rejected`:
`settings_not_found` and `settings_read_only`, added additively when mosd
stopped collapsing `NotFound`, `ReadOnly` and `Validation` into one
`InvalidArgs`. A third, `method_not_allowed`, was added when a wrong method on
a declared route stopped being answered by the framework's bare 405 and started
answering this section's envelope.

| `code` | Ships? | Where |
|---|---|---|
| `not_authenticated` | **yes**, 401 | `ApiError::apid("not_authenticated", message.to_string())` (`pkgs/mosd/apid/src/routes.rs`). Raised by the bearer extractor (`pkgs/mosd/apid/src/routes.rs`), and since M9 by nothing else: the 401 means *"this route accepts a bearer API token only; a session cookie is not a credential here, and a browser mints its first token at POST /builtin/tokens"* (`pkgs/mosd/apid/src/routes.rs`) |
| `not_found` | **yes**, 404 | `ApiError::apid("not_found", format!("no API route at {}", uri.path()))` (`pkgs/mosd/apid/src/routes.rs`), from the reserved subtree's fallback |
| `method_not_allowed` | **yes**, 405 with `Allow` | `"method_not_allowed",` (`pkgs/mosd/apid/src/routes.rs`), inside `fn api_method_not_allowed` (`pkgs/mosd/apid/src/routes.rs`), reached through the one `.method_not_allowed_fallback(api_method_not_allowed)` (`pkgs/mosd/apid/src/routes.rs`) that covers every route in `api_router` |
| `request_invalid` | **yes**, 400 — this snapshot said **no** | emitted by each JSON-body route that reports a rejected body and by the shared `json_body` reader in `pkgs/mosd/apid/src/routes.rs`. It could not ship when this row was written because no route took a body; ten do now (section 1.2) |
| `validation_failed` | **yes**, 422 — this snapshot said **no** | the most-used code in the crate, emitted throughout `pkgs/mosd/apid/src/routes.rs`. The four validators the row below names are all reachable from `/api/v1/` now: `valid_hostname` through the settings write, `validate_iface` through `POST /api/v1/setup`, and `validate_transient_password` and `parse_authorized_key` through their action and collection routes |
| `wrong_password` | **yes**, 403 | `"wrong_password",` (`pkgs/mosd/apid/src/routes.rs`), on `POST /api/v1/actions/change-password` |
| `settings_not_found` | **yes**, 404 | `ApiError::mosd("settings_not_found", message)` (`pkgs/mosd/apid/src/routes.rs`), on `MOSD_NOT_FOUND` (`pkgs/mosd/apid/src/routes.rs`); also raised by apid itself for an absent collection item (`pkgs/mosd/apid/src/routes.rs`). The live-state route no longer raises it directly: mosd names the condition and the classifier above answers it |
| `settings_read_only` | **yes**, 409 | `ApiError::mosd("settings_read_only", message)` (`pkgs/mosd/apid/src/routes.rs`), on `MOSD_READ_ONLY` (`pkgs/mosd/apid/src/routes.rs`); also raised by apid's own write refusal (`pkgs/mosd/apid/src/routes.rs`) |
| `settings_rejected` | **yes**, 422 | `ApiError::mosd("settings_rejected", message)` (`pkgs/mosd/apid/src/routes.rs`), on `FDO_INVALID_ARGS` (`pkgs/mosd/apid/src/routes.rs`) |
| `settings_io` | **yes**, 500 | `ApiError::mosd("settings_io", message)` (`pkgs/mosd/apid/src/routes.rs`), on `FDO_IO_ERROR` (`pkgs/mosd/apid/src/routes.rs`) |
| `mosd_failed` | **yes**, 500 | `ApiError::mosd("mosd_failed", message)` (`pkgs/mosd/apid/src/routes.rs`), on `FDO_FAILED` (`pkgs/mosd/apid/src/routes.rs`) |
| `mosd_unreachable` | **yes**, 503 with `Retry-After` | `ApiError::apid("mosd_unreachable", format!("{err:#}"))` (`pkgs/mosd/apid/src/routes.rs`), exhaustive over everything the five names above do not match — `_ => mosd_unreachable(err),` (`pkgs/mosd/apid/src/routes.rs`) and again at `pkgs/mosd/apid/src/routes.rs` |
| `mosd_timeout` | **yes**, 504 without `Retry-After` | a five-second bounded connection or method call elapsed; the message states that a write may still be running |
| `task_not_found` | **yes**, 404 | `GET /api/v1/tasks/{id}` names no retained task and apid has no pre-lapse record from which to infer an interrupted terminal outcome |
| `ssid_exists` | **yes**, 409 | `"ssid_exists",` (`pkgs/mosd/apid/src/routes.rs`) |
| `key_exists` | **yes**, 409 | `"key_exists",` (`pkgs/mosd/apid/src/routes.rs`) |
| `peer_exists` | **yes**, 409 | `"peer_exists",` (`pkgs/mosd/apid/src/routes.rs`) |
| `token_limit_reached` | **yes**, 409 | `"token_limit_reached",` (`pkgs/mosd/apid/src/routes.rs`) |
| `key_limit_reached` | **yes**, 409 | `"key_limit_reached",` (`pkgs/mosd/apid/src/routes.rs`) |

**What now ships that did not.** `GET /api/v1/health` exists, additively: a
new path in `pkgs/mosd/apid/openapi.json` and a new route in `api_router`,
with no shipped route changing its path, its method, its success status code or
its response fields. Case 3 below is annotated with what was built. The concern
its last paragraph raises — that a dead mosd would stop the one endpoint that
reports a dead mosd from answering — was resolved a different way and is
recorded below.

A wrong method on a declared route now answers this envelope too. It did not
before: measured at `8f080dc`, every declared `/api/` route answered a wrong
method with a bare `405` carrying axum's own `Allow` header, no body and no
`Content-Type` at all, so the one shape below held for every failure except
that one.

**One shape, for every failure on every `/api/v1/` route.**

```
{
  "error": {
    "code":    string,   // stable machine token; an OPEN set (see 2.1)
    "message": string,   // human-readable; not for matching on
    "source":  "apid" | "mosd",
    "path":    string    // OPTIONAL: the settings dot-path at fault
  }
}
```

Example, from a real rejection measured against `mosd-settings` on 2026-08-28
(§2.2's unquoted spelling, which is still an error and must not read as an
outage):

```
HTTP/1.1 422 Unprocessable Content
Content-Type: application/json

{
  "error": {
    "code": "settings_rejected",
    "message": "invalid settings value at `network.eth0.100`: unknown field `100`, expected one of `kind`, `dhcp`, `static`, `vlan`, `bridge`, `wireguard`",
    "source": "mosd",
    "path": "network.eth0.100"
  }
}
```

| `code` | HTTP | `source` | Raised when |
|---|---|---|---|
| `not_authenticated` | 401 | apid | no bearer token, or one that does not verify (§3.2) |
| `not_found` | 404 | apid | unknown route, or a collection item that does not exist |
| `method_not_allowed` | 405 | apid | a declared route was called with a method it does not serve; the response carries `Allow` naming the methods it does |
| `request_invalid` | 400 | apid | the body is not JSON, or not the shape the route takes |
| `validation_failed` | 422 | apid | apid's own validators rejected it: `valid_hostname` (`pkgs/mosd/apid/src/routes.rs`), `validate_iface` (`pkgs/mosd/apid/src/routes.rs`), `validate_transient_password` (`pkgs/mosd/apid/src/routes.rs`), `parse_authorized_key` (`pkgs/mosd/mosd-settings/src/authorized_key.rs`, called from apid), and the change-password floor |
| `wrong_password` | 403 | apid | the current password in a change-password request does not verify; the session is valid, the credential is not |
| `settings_not_found` | 404 | mosd | the dot-path does not resolve: mosd answered `com.mos.mosd1.Error.NotFound` |
| `settings_read_only` | 409 | mosd | the dot-path exists and rejects writes: mosd answered `com.mos.mosd1.Error.ReadOnly` |
| `settings_rejected` | 422 | mosd | mosd answered fdo `InvalidArgs` (`pkgs/mosd/mosd/src/bus.rs`) |
| `settings_io` | 500 | mosd | mosd answered `IOError` (`pkgs/mosd/mosd/src/bus.rs`) |
| `mosd_failed` | 500 | mosd | mosd answered `Failed` (`pkgs/mosd/mosd/src/bus.rs`) |
| `mosd_unreachable` | **503** | apid | the call could not be made at all |
| `mosd_timeout` | **504** | apid | the bounded mosd call elapsed; the operation may still be running |
| `task_not_found` | 404 | mosd | no retained task has that id |
| `ssid_exists` | 409 | apid | a stored WiFi network already carries the posted SSID |
| `key_exists` | 409 | apid | a stored authorized key already carries the posted public key, compared on the canonical key text so a relabel is not a new key |
| `peer_exists` | 409 | apid | a stored WireGuard peer of that tunnel already carries the posted public key |
| `token_limit_reached`, `key_limit_reached` | 409 | apid | the collection already holds its maximum; the bound is read before the write from `mosd_settings::MAX_TOKENS` and `mosd_settings::MAX_KEYS` |

**The collection identifier contract, in three clauses.** The last four rows are
the third of them, and the three are stated together because a collection route
has to answer all three and the next one added must not have to reconstruct the
rule from precedent:

> On any API collection or item route: an identifier that names **no item** is
> **404**; an identifier that is **malformed** — a fingerprint that is not a
> fingerprint, a public key that is not 32 bytes of base64 — is **422**; and an
> identifier that **duplicates** one the collection already holds is **409**,
> with a per-collection code.

The reasoning for each, so the clause can be applied rather than pattern-matched.
"Well-formed but absent" and "not well formed" are different conditions and must
not share a status, which is what separates the first two. A **duplicate** is
neither: the body is well formed and nothing about it is wrong, and what refuses
it is the collection's current state — which is what 409 means, and what
`settings_read_only` two rows above already spends it on.

**The duplicate clause is decided by the route, before the shared validator
runs, and never by reading the validator's message.** Every one of these
collections has a validator that also refuses a duplicate, and must: the
settings file is writable without apid, so the reconciler stays the boundary.
But those validators refuse a duplicate, an over-long list and a malformed entry
as one error, so recovering *which* from its wording would be a parser for prose
that breaks when the prose is reworded. Where the check needs a bound rather
than a comparison, the bound is **exported** rather than inferred — that is what
`MAX_TOKENS` and `MAX_KEYS` are public for.

**The HTML panes are not changed by this clause**, exactly as they are not
changed by the 404 one: a form's body is a re-rendered page carrying the message
in an error box, no consumer on that path reads the status, and the message
already asks for the re-submit that 422 means on a form.

**The question that matters: does the API surface mosd's errors or translate
them? Recommendation: translate the classification, pass the message through
verbatim, and always say which side it came from.**

The reason is what the HTML path does today, which is neither. It **flattens**:
`BusSettings` converts every `zbus::Error` to `anyhow::Error` with `err.into()`
(`pkgs/mosd/apid/src/bus_client.rs`), and every form handler renders one page for the result — `bus_error`,
HTTP **503** with `Retry-After`, body *"The management daemon is unavailable."*
(`pkgs/mosd/apid/src/routes.rs`, message at `pkgs/mosd/apid/src/routes.rs`). So a settings value mosd
rejected as invalid is reported to the operator as the daemon being down:
`network_submit` returns `bus_error` when the settings write fails
(`pkgs/mosd/apid/src/routes.rs`), and `write_key_list` does the same
(`pkgs/mosd/apid/src/routes.rs`). The VLAN example above is exactly this — a rejection that reads
as an outage.

The distinction is not lost by mosd and it is not lost by D-Bus; it is lost by
apid. mosd classifies deliberately, mapping `SettingsError` onto three distinct
fdo error names (`pkgs/mosd/mosd/src/bus.rs`), and zbus carries the name back:
the pinned `zbus` 5.19.0 (`pkgs/mosd/Cargo.lock`) has
`Error::MethodError(OwnedErrorName, Option<String>, Message)` as a distinct
variant from its transport errors. Recovering the classification is therefore a
matter of matching on the `zbus::Error` before converting it, at the six call
sites named above — one change, in one file. Sequencing it is §8's.

**Why translate rather than pass the fdo error through.** Passing it through
means the client has to know D-Bus to use an HTTP API, and it means the wire
format of the API is set by a dependency of a dependency. Worse, the messages
are anyhow chains built by mosd with `{err:#}` (`pkgs/mosd/mosd/src/bus.rs`).
mosd carries a contract that one of them — the transient-password path — never
echoes the password (`pkgs/mosd/mosd/src/bus.rs`, restated in
`pkgs/mosd/apid/src/settings_api.rs`),
but that contract is stated for that one method. Making the HTTP body a verbatim
copy of every chained message from every method extends a one-method promise
across the whole interface, silently, and the extension is not written down
anywhere. **Translating the classification while copying the message keeps the
same exposure the HTML path already has** — the pane already shows mosd's message
text in an error box (`pkgs/mosd/apid/src/routes.rs`) — without
widening it.

**And the failure mode of the choice this rejects.** If the API translated the
message too — replacing mosd's text with apid's own phrasing per code — then
every message mosd learns to produce is invisible until apid is taught it. The
"unknown field `100`, expected `dhcp` or `static`" string in the example above
comes from serde, through `SettingsError::Validation`
(`pkgs/mosd/mosd-settings/src/model.rs`),
and no phrasing apid could have pre-written would have told the caller which
field was wrong. A client debugging a rejected write would be reduced to
guessing. That is the failure mode, and it is why `message` is passed through.

**The three cases the task names.**

1. **Validation failures.** Two `source` values, deliberately. `source: "apid"`
   means apid's own validator rejected the request before any bus call — the
   caller can fix it locally, and the write definitely did not happen.
   `source: "mosd"` means mosd's typed tree rejected it; the write also did not
   happen (`Settings::set` is documented as leaving settings unchanged on error,
   `pkgs/mosd/mosd-settings/src/model.rs`, and `store.save` runs only after
   the candidate validates, `pkgs/mosd/mosd/src/bus.rs`), but the rule that
   rejected it is not one apid knows. Both are 422. Knowing which is which is
   what tells a client whether re-reading this document will help.
2. **Bus unavailable.** `mosd_unreachable`, **503**, with `Retry-After: 5`. 503
   rather than today's 502 because apid itself is up and answering — 503 says
   "this server, temporarily", which is exactly what the connection cache makes
   true: the proxy is dropped after any failed call so the next request
   reconnects (`pkgs/mosd/apid/src/bus_client.rs`). **This shipped**:
   `mosd_unreachable` answers 503 (`pkgs/mosd/apid/src/routes.rs`) with
   `Retry-After` attached (`pkgs/mosd/apid/src/routes.rs`). The cost this
   paragraph once named — the HTML path answering 502 for the same underlying
   failure — is closed: `bus_error` answers **503 with `Retry-After` too**
   (`pkgs/mosd/apid/src/routes.rs`), so one appliance reports one
   outage one way on both surfaces.
   A call that connected but crossed the five-second bound is different:
   `mosd_timeout`, **504**, with no `Retry-After`; its message explicitly says
   that a mutating operation may still be running.
3. **mosd down entirely, distinguished from "everything is fine".** This is the
   case that must not be got wrong, because apid surviving a dead mosd is an
   existing design property, stated in the crate: *"mosd not being up yet
   therefore surfaces as per-request errors (502 pages), never as an apid
   crash"* (`pkgs/mosd/apid/src/bus_client.rs`). The trap is already in the tree:
   `/healthz` returns before any check (`pkgs/mosd/apid/src/routes.rs`) and
   answers the literal `"ok"` (`pkgs/mosd/apid/src/routes.rs`), so **an appliance whose mosd is dead
   answers `/healthz` with `ok`**. A monitor polling it sees a healthy device.
   `/healthz` cannot be fixed, because the boot health gate depends on exactly
   that behaviour (`rootfs/overlay/usr/lib/mos/mos-health`) — its
   comment says so in as many words: *"/healthz is apid's existing endpoint and
   bypasses its auth gate"* (`rootfs/overlay/usr/lib/mos/mos-health`).

   So the API adds a second, differently-scoped endpoint:

   ```
   GET /api/v1/health          (authenticated)

   200 {"apid": "ok", "mosd": "ok",          "checkedAt": <uptime seconds>}
   200 {"apid": "ok", "mosd": "unreachable", "detail": "<message>"}
   ```

   **This shipped**, with `checkedAt` a bare JSON **number** rather than the
   string this sketch drew. The type is settled by what apid can read: there is
   no trusted wall clock anywhere in the crate — §3.2's expiry paragraph is the
   argument — and the one clock there is, §2.2 item 3's `uptime`, is already
   *"whole seconds since boot, a bare JSON number"* everywhere else it appears.
   Stamping the health answer any other way would have given one appliance two
   spellings of one number. Both optional members are omitted rather than sent
   null, the rule `path` already follows in the envelope above.
   It returns **200 in both cases**, because the request succeeded and the answer
   is the body — a 503 here would be indistinguishable from the endpoint itself
   being unavailable, which is the confusion it exists to remove. `mosd` is
   determined by making one real call (`GetSettings("")` is the cheapest that
   proves the bus round trip), not by inspecting a cached flag. **One call is
   what shipped, and it is `GetState("uptime")` rather than the call named
   here**: it proves the same round trip, it is cheaper still — mosd answers
   with one integer rather than serialising the whole settings tree for a
   liveness ping — and it is the only call that also yields `checkedAt`, so the
   alternative was two round trips for one question. The cached flag stayed
   ruled out, `access_cache` included, which is the substance of the sentence
   this one annotates. A client's rule
   is therefore explicit: **`/healthz` answers "is apid's listener up"; only
   `/api/v1/health` answers "is this appliance manageable".** Both sentences are
   true and neither implies the other.

   One consequence was stated here as a requirement on a future health route:
   at `86cd669` the gate called `GetSettings("access")` on **every** request and
   returned `bus_error` when it failed, so a dead mosd would have failed every
   authenticated API route before its handler ran — including the health route
   itself — and this paragraph asked for an exemption. **The shipped gate
   resolves it more broadly than asked.** Every declared `/api/` route is handed
   off above the bus call (`pkgs/mosd/apid/src/routes.rs`), and a request with a
   valid session cookie is handed off above it too
   (`pkgs/mosd/apid/src/routes.rs`), so no API route depends on the gate's
   settings read at all. A health route added later inherits that exemption
   rather than needing one written for it, and the four routes that exist today
   already answer a dead mosd with `mosd_unreachable` from their own handlers
   rather than with the gate's 502.

   **Re-verified when the route was built, and it held.** No exemption was
   written for the health route and none was needed: the gate's test is a
   membership test over the routes the API declares, so the route joined the
   same list `/api/versions` and `/api/v1/meta` are in and inherited the
   handoff. What that list is *for* is worth restating, because "declared" is
   doing the work — it hands off exactly what the router serves and nothing
   else, so a path the gate releases must be a path a route answers, and the
   arm added for the health route is the same arm every other declared route
   has rather than a special case written around one.

## 3. Authentication for a programmatic client — **[proposed]**

§3.1 is a reading of the tree, re-measured at `f7cb5ba`, and is marked
**[implemented]** because it describes shipped mechanics. §3.2 and §3.3 are the
proposal and remain unbuilt.

**What the shipped API authenticates with, since it is not what §3.2 asks
for.** The four `/api` routes exist and three of them are guarded, and the
credential is the **browser session cookie** — the very mechanism §3.1
enumerates seven objections to. The guard is an extractor rather than
middleware, `pub(crate) struct ApiBearer;` (`pkgs/mosd/apid/src/routes.rs`),
whose whole test since M9 is
`if bearer_is_stored(state, &parts.headers).await {`
(`pkgs/mosd/apid/src/routes.rs`); its rejection is §2.4's envelope with a
401 rather than the gate's HTML redirect
(`pkgs/mosd/apid/src/routes.rs`). The gate hands the declared `/api` routes
off to it with `is_declared_api_route(path)`
(`pkgs/mosd/apid/src/routes.rs`, predicate). There is no bearer
token, no `Authorization` header path and no second credential anywhere in the
crate (section 1.4).

That is a deliberate phase-1 position and not an oversight, and it is worth
being exact about which of §3.1's objections it does and does not answer.
**Answered:** objection 1, the sharpest — a script that fails to authenticate
against `/api/v1/meta` now gets a **401 with a JSON body** rather than a
redirect to a 200 HTML page, because the extractor runs for exactly the
handlers that name it and the gate never sees the request. The source states
the reason in those terms: *"A client that follows that redirect lands on `GET
/login`, which answers 200 with an HTML page, so a script reads the whole
exchange as success"* (`pkgs/mosd/apid/src/routes.rs`). **Unanswered:**
objections 2 through 7 in full. Obtaining the credential still means posting a
URL-encoded form to `/login` and parsing `Set-Cookie`; it still dies on an apid
restart and therefore on every A/B update; it still expires 24 hours after
issue without renewal; it is still one credential identifying a human, so a
script still holds the operator's password and there is still no unit of
revocation smaller than "everyone"; and a script retrying with a stale password
still walks the global backoff curve and holds the human out. §3.2 is what
those six need, and none of it exists.

### 3.1 Browser session versus programmatic client — **[implemented]**

Section 1.4 measured the session mechanism as shipped. This section says what is
wrong with it *for a script*, in mechanics rather than in principle. "It is for
browsers" is not an argument; these seven are, and each is a property of the
code at `f7cb5ba`.

1. **Authentication failure is a redirect, not a 401 — so the default client
   sees success.** The gate answers an unauthenticated request with
   `Redirect::to("/login").into_response()` (`pkgs/mosd/apid/src/routes.rs`), a
   303/307-class response. A client that follows redirects — which is the
   default for `curl -L`, for Python `requests`, and for most HTTP libraries —
   ends up at `GET /login`, which the gate lets through
   (`pkgs/mosd/apid/src/routes.rs`) and which returns **200 OK** with an HTML
   form (`pkgs/mosd/apid/src/routes.rs`). A script that checks the status
   code and stops there concludes its request succeeded. This is the sharpest of
   the seven: every other item makes the client's life harder, and this one makes
   it *wrong*. **It is the one item the shipped `/api` routes answer**, and only
   for those four paths: the `ApiSession` extractor returns a 401 envelope
   instead (`pkgs/mosd/apid/src/routes.rs`). Every other path on the daemon
   still redirects.
2. **Obtaining the credential means emulating three browser behaviours.**
   `POST /login` takes `Form(form): Form<LoginForm>,`
   (`pkgs/mosd/apid/src/routes.rs`) — axum's URL-encoded extractor, imported at
   `pkgs/mosd/apid/src/routes.rs`, not JSON — answers **302 to `/`**
   (`pkgs/mosd/apid/src/routes.rs`), and delivers the credential in a
   `Set-Cookie` header (`pkgs/mosd/apid/src/routes.rs`, value built at
   `pkgs/mosd/apid/src/session.rs`). A client must
   therefore URL-encode rather than serialise JSON, *not* follow the redirect,
   and parse a `Set-Cookie` header. None of those is hard; all three are the
   client pretending to be something it is not.
3. **The credential does not survive a restart of the daemon that issued it.**
   Sessions live in a `HashMap` in memory (`pkgs/mosd/apid/src/session.rs`) and the
   module says so: *"an apid restart logs everyone out"*
   (`pkgs/mosd/apid/src/session.rs`). Since apid ships inside the verity rootfs
   (`pkgs/mosd/dist/apid.service`, `docs/design/access.md`), **every A/B
   image update invalidates every session**. A cron job's credential expires
   whenever the fleet is updated, and per item 1 the job's next run gets a 200
   and an HTML page.
4. **The TTL is fixed at 24 hours and is not renewed by use.** The expiry is
   stamped once at creation (`pkgs/mosd/apid/src/session.rs`, TTL) and
   `verify` only compares against it — it never extends it
   (`pkgs/mosd/apid/src/session.rs`). A long-running client is logged out
   mid-operation exactly 24 hours in, with no warning in any response before
   that point.
5. **The expiry is monotonic, not absolute.** `Instant` (`session.rs`)
   is a monotonic clock. A client cannot compute when its session dies from
   anything the server told it, because nothing on the wire carries the
   server's notion of now.
6. **There is exactly one credential, and it identifies a human.** The only
   thing the crate authenticates against is
   the admin hash, read through `password_hash` (`pkgs/mosd/apid/src/routes.rs`); there is
   no second credential, no user table, and no reference to `access.device` in
   the route module (section 1.4). A script therefore holds the operator's
   password. Revoking the script means changing that password, which logs the
   operator out too — there is no smaller unit of revocation than "everyone".
7. **A misconfigured script locks the operator out, repeatedly.** The login
   backoff is a single global counter, not per-client, by explicit design:
   *"the appliance has one admin password, so per-client tracking buys nothing
   against an online guesser"* (`pkgs/mosd/apid/src/auth.rs`). Each consecutive
   failure doubles the wait before the next attempt is accepted, from one second
   to a five-minute cap (`pkgs/mosd/apid/src/auth.rs`), and the
   window rejects **every** login attempt while it holds
   (`pkgs/mosd/apid/src/auth.rs`; the 429 at
   `pkgs/mosd/apid/src/routes.rs`). A script retrying with a
   stale password holds the human admin out of the web UI indefinitely. That
   comment's reasoning is sound *for one password*; adding a second class of
   credential is what makes it stop being sound, which §3.2 has to answer.

Items 6 and 7 are the ones that cannot be fixed by making the session mechanism
nicer. They are consequences of there being one credential.

### 3.2 The proposal: a bearer API token — **[proposed]**

<!-- The two paragraphs this note replaces read "What ships: none of it" and
     "This section is the answer to that, and it is unbuilt". Both were true
     when written and neither is now. The API campaign built this section: M2
 shipped the token, M9 closed the window below. -->

**What ships: this section, as written.** The bearer token exists, is minted,
is stored hashed under `access.apiTokens`, and is the only credential
`/api/v1/` accepts. The extractor is `pub(crate) struct ApiBearer;`
(`pkgs/mosd/apid/src/routes.rs`) and its whole test is
`if bearer_is_stored(state, &parts.headers).await {`
(`pkgs/mosd/apid/src/routes.rs`). Everything below this note is the design
as it was proposed; it is now also the description of what runs.

**Dated note: the dual-credential window, and its close.**

There was a period in which the "**only** accepted credential" sentence below
was false, and it was false on purpose. It is recorded here rather than
quietly repaired, because a reader who finds the sentence and a tree that
disagreed with it deserves the dates rather than an inference.

| | |
|---|---|
| **Opened** | 2026-08-28, Amendment 1, decision 1 — "dual-credential with an in-plan cutover" |
| **What was true in it** | `/api/v1/` accepted a bearer **or** the session cookie, through an extractor then named `ApiSession`. The three token routes never accepted the cookie: Amendment 1 preserved the credentials of routes that had already shipped, and those had not. |
| **Why it was opened** | Removing the cookie in the same milestone that added the bearer would have broken a client that existed, on a surface with no other way in. The amendment made the widening additive and named its own end. |
| **Closed** | 2026-08-28, **M9** |
| **What closed it** | The cookie's acceptance was removed from `/api/v1/`. `ApiSession` and `ApiBearer` then proved the same thing and are one type, which is why only `ApiBearer` appears above. |

Three things the cutover deliberately did **not** change, because §3.2 designs
each of them the way it does on purpose:

1. **`POST /builtin/tokens` and `POST /builtin/tokens/revoke` keep the session
   cookie.** They are the bootstrap and they are not `/api/v1/` routes. Without
   them no first token could exist — see the bootstrap paragraph below, which
   is why that paragraph says the resolution is a path rather than an exception.
2. **`POST /api/v1/setup` stays unauthenticated.** M8 made it the device's one
   unauthenticated write and M9 does not touch it. It is the one route under
   the prefix that names no credential extractor at all.
3. **The HTML panes keep the cookie.** Nothing about the browser surface
   changed.

And one thing it guarantees, which is the whole reason the window had to close
rather than lapse: a cookie presented to an `/api/v1/` route is a **401 with
§2.4's envelope**, never a 303 to `/login`. §3.1's trap is that the redirect
lands on a 200 HTML page, so a script reads the exchange as success; a client
that has not noticed the cutover gets something it can parse instead. It is
asserted in the unit tests and against a live server in `apid`'s end-to-end
test.

**One mechanism.** A long-lived, revocable bearer token, minted by an
authenticated admin, stored hashed in the settings tree, sent in an
`Authorization` header. It is the **only** accepted credential on `/api/v1/`
routes: the session cookie authenticates the HTML pages and nothing else. **That
sentence has no exception, including for the bootstrap** — see the bootstrap
paragraph below.

**What a client sends on the wire.**

```
GET /api/v1/settings/access.ssh HTTP/1.1
Host: mos
Authorization: Bearer mos_3f2a9c41_9d4e...c7   (id . secret, see below)
Accept: application/json
```

Nothing else. No cookie, no custom header, no signature, no timestamp. The token
is opaque to the client.

**The token's shape, and why it is not one opaque blob.** The token is
`mos_<id>_<secret>`: an 8-byte hex `id` that is **not** secret, and a 32-byte
hex `secret` from `OsRng`. The crate already has both halves of this idea —
the session cookie is `<id>.<mac>` with a 16-byte `OsRng` id
(`pkgs/mosd/apid/src/session.rs`) — and the reason to keep the id visible is
mechanical: with N tokens stored, an opaque blob forces apid to hash the
presented secret and compare against all N entries on every request, while an
embedded id is one lookup and one comparison. 32 bytes is 256 bits, double the
session id's 128 (`pkgs/mosd/apid/src/session.rs`), because unlike a session this
credential is not going to expire on its own.

**Where the credential is stored: the settings tree, on STATE, hashed.**
The store is `access.apiTokens`, an array whose items are
`{id, name, hash, created}` — the naming follows the tree's existing
convention of camelCase renames for multi-word keys (`webAdmin`,
`authorizedKeys`, `passwordHash`;
`pkgs/mosd/mosd-settings/src/model.rs`). Five reasons, and the
tier is chosen rather than inherited:

1. **It is the tier that matches the credential's required lifetime.** The
   settings tree is `/var/lib/mos/settings.toml`
   (`pkgs/mosd/mosd-settings/src/store.rs`), mounted from `/mnt/state/mos` by
   `var-lib-mos.mount` — **STATE** (`docs/design/access.md`). Per the
   survives-what table it survives a reboot and an A/B update and does not
   survive a whole-disk reflash (`docs/design/access.md`). That is exactly
   right for an API token: a script must keep working across an image update
   (item 3 of §3.1 is the bug being fixed), and a decommissioning reflash must
   take the credential with it.
2. **DATA would be the wrong tier, and specifically worse.** `/home`, `/root`
   and `/srv` also survive a reboot and an A/B update
   (`docs/design/access.md`), so on lifetime alone they would do. But the
   same row records that on a reflash DATA is *"replaced by the image's fresh
   DATA filesystem — but see §9.2: blocks beyond the flashed extent are
   *unreachable*, not erased"*. A credential whose bytes may physically remain
   after the operation an operator performs to decommission a device is the
   wrong tier for a credential, and this is the reason to say so out loud rather
   than default to STATE by habit.
3. **Anything else is unmodelled state.** *"An unmodelled setting is an
   unsupported setting"* (`docs/design/access.md`). apid's own state
   directory `/var/lib/mos/apid` (`pkgs/mosd/apid/src/config.rs`,
   `pkgs/mosd/dist/apid.service`) is on the same STATE bind and would satisfy
   reason 1 — but a credential granting full management access that mosd does not
   know about gets no row in the survives-what table, no validation, and no
   backup story, and it sits outside the one place this project has decided
   credentials live.
4. **It costs zero extra bus round trips.** The gate already calls
   `GetSettings("access")` on **every** request
   (`pkgs/mosd/apid/src/routes.rs`) and `apiTokens` is a child of `access`, so
   the subtree the token check needs is already in hand at the moment the check
   runs. A sibling root (`apiTokens` at the top level) would have added a second
   `GetSettings` per request. This is why the path is under `access` and not
   beside it.
5. **It is symmetric with the two credentials already there.** `webAdmin` holds
   an argon2id PHC hash (`pkgs/mosd/mosd-settings/src/model.rs`) and
   `access.device` holds a hash and a generation and *"never holds a plaintext
   secret"* (`pkgs/mosd/mosd-settings/src/model.rs`). `apiTokens` holds hashes.

The cost of reason 1 is stated in §2.2 and is not hypothetical: anything that
can read the settings tree can read the token hashes. `GetSettings` returns the
subtree verbatim (`pkgs/mosd/mosd/src/bus.rs`), so the API's redaction rule
(§2.2) must cover `hash` as well as `password_hash`, and the D-Bus policy —
root-only in both directions (`pkgs/mosd/dist/com.mos.mosd.conf`) — is what
keeps everything else out. Since anyone who is root has already won (§3.3), this
costs nothing new; it is recorded because "the hashes are readable" is the kind
of sentence that should be written down before someone discovers it.

**The hash: SHA-256, not argon2id, deliberately.** `access.webAdmin` uses
argon2id (`pkgs/mosd/apid/src/auth.rs`) because a human chose that password and
an offline attacker with the hash can guess it. A token is 256 bits from `OsRng`
and there is nothing to guess; a work factor would buy no security and would be
paid on **every API request**, where the password's is paid once per login. The
`sha2` crate is already a dependency (`pkgs/mosd/apid/Cargo.toml`, used by
`pkgs/mosd/apid/src/session.rs`), so this adds nothing to the dependency list.
The comparison must be constant-time — the crate already contains the right
primitive, `Mac::verify_slice` — `verify_slice` (`pkgs/mosd/apid/src/session.rs`), and a `String`
`==` on hex digests is what must not be written. To be honest about the size of
that requirement: a timing leak on a *stored digest* is not a practical attack,
because learning the digest does not yield a preimage. Constant-time is required
anyway, because deciding it site-by-site is how the one site where it mattered
gets missed.

**How a token is created.** `POST /api/v1/tokens`, body `{"name": "ci-deploy"}`,
authenticated by an existing **bearer token** — a session cookie presented to
this route is a `401`, per the rule above — response `201` with
`{"id": "...", "name": "...", "token": "mos_..."}`. **The plaintext appears in
that response and nowhere else, ever**: only the hash is stored, so a lost token
is replaced, not recovered. That is the same posture `access.device` already
takes (`pkgs/mosd/mosd-settings/src/model.rs`).

**The bootstrap, and the resolution is a path rather than an exception.** The
first token cannot be minted with a token, and the answer is the browser
session — but it does not reach `/api/v1/` to give it. The first token is minted
at **`POST /builtin/tokens`**: an HTML form POST under §6.3's reserved built-in
prefix, authenticated by the session cookie, served by the built-in UI's mint
pane (§8.1's capability (iii)), answering with an HTML page that displays the
plaintext once. It is not an `/api/v1/` route, it carries no JSON, and it is not
part of the `v1` contract §2.1 versions — a change to it is a change to the HTML
surface, which §8.1 already establishes carries no version promise. Its sibling
`POST /builtin/tokens/revoke` gives the built-in UI §8.1's capability (iii) in
full, so an operator holding only a browser can revoke a leaked token without
first holding another one.

Two properties of that route are load-bearing, and neither is optional:

1. **It is POST-only, and no GET form of the mint may ever exist** — not as a
   convenience, not as a redirect target, not as a debugging affordance.
   `SameSite=Lax` (`pkgs/mosd/apid/src/session.rs` at `86cd669`) withholds the
   cookie from a cross-site form POST and **permits** it on a top-level
   cross-site GET navigation, so a GET mint would be a permanent-credential
   factory reachable from any link an operator clicks.
2. **`SameSite=Lax` is the entire defence, and it is a cross-site defence
   only.** It is the only CSRF-relevant mechanism the crate has:
   `grep -ni csrf mosd/apid/src/*.rs` returns nothing at `86cd669` (§1.2), and
   the per-action confirm tokens are compile-time constants rather than CSRF
   tokens — §3.3 records why they must not be counted. **This document does not
   propose adding a CSRF token**, and what that costs is a same-origin attacker,
   which §3.3 names as attack 5 rather than leaving to inference.

The alternatives to a form POST were worse: minting over SSH needs SSH, which is
off by default and stays off until an authenticated admin action through the web
UI (`pkgs/mosd/mosd-settings/src/model.rs`, `docs/design/access.md` §4.1), so
it is circular; and minting at first-run setup means `POST /setup` returns a
credential the operator did not ask for and may never rotate.
`POST /api/v1/setup` (§2.3) does return one, because a caller who drove
first-run setup over the API demonstrably wants API access — but the browser
wizard does not. The rejected shape was the obvious one: leave the mint at
`POST /api/v1/tokens` and let it accept a cookie there. It is rejected because it
puts a permanent-credential factory inside the one surface §3.3 can make its
strongest statement about, and that statement is worth more than the saved
route.

What this costs, named: **no token can be created on a device whose built-in UI
is broken.** That is precisely the situation §6 exists for, and it makes the
token lifecycle a dependent of §6's escape rather than an alternative to it.

**More than one, and revocation.** `access.apiTokens` is a list. Revocation is
`DELETE /api/v1/tokens/{id}`, and `GET /api/v1/tokens` lists `{id, name,
created}` — never the hash, never the plaintext. Multiple tokens is not a
convenience: it is the fix for §3.1 item 6, because with one credential there is
no revocation smaller than "everyone". Revocation takes effect on the **next
request**, since the token set is read per request from the `GetSettings`
call the gate already makes.

Two costs, both inherited from the tree rather than introduced here:

- Mint and revoke are read-modify-write of the whole array, because the dot-path
  syntax has no array indexing (`pkgs/mosd/mosd-settings/src/model.rs`) —
  the same pattern the SSH key pane uses (`pkgs/mosd/apid/src/routes.rs`).
  Two concurrent mints lose one token, silently.
- Identity is the `id`, never a list position, for the reason recorded at
  `pkgs/mosd/apid/src/routes.rs`: an index is meaningful only against the
  list the caller last read, and a concurrent change slides it onto a different
  entry. A `DELETE` whose id matches nothing is a 404, not a silent success.

**Expiry: none in phase 1, and that is a decision, not an omission.** An
absolute expiry needs a wall clock, and nothing in the crate reads one —
`SessionStore` uses `Instant` throughout (`pkgs/mosd/apid/src/session.rs`,
`pkgs/mosd/apid/src/session.rs`), which is monotonic and cannot express a deadline that survives a reboot.
Adding an `expiresAt` before there is a trusted wall clock would produce a field
that is either unenforced or enforced against a clock that resets. So: tokens do
not expire, and **revocation is the entire lifecycle**. The cost is blunt — a
token that leaks and is forgotten works forever, and nothing in the system will
ever remind anyone it exists beyond its appearance in `GET /api/v1/tokens`.

**Relation to `access.webAdmin`: coexists. It does not replace it and does not
derive from it.**

- **Not derived.** A token computed from the password hash would make every
  token equal, which makes revoking one impossible, and would tie the token's
  fate to a password rotation. Both defeat the purpose.
- **Not a replacement.** `POST /setup` and `POST /login` remain the only
  bootstrap (see above), and the built-in UI is a server-rendered
  no-JavaScript browser client by `docs/design/dashboard.md`'s own decision
  (`docs/design/dashboard.md`), which has no use for a bearer token.
- **Coexisting means two credentials at one privilege level** — and there is
  only one privilege level, because apid runs as root (`pkgs/mosd/dist/apid.service`
  sets no `User=`; `pkgs/mosd/dist/com.mos.mosd.conf` records the same
  from the other side) and every route it serves is behind the same gate
  (`pkgs/mosd/apid/src/routes.rs`). A token can do everything the operator can do
  over the API. There are no scopes in phase 1, and inventing them would mean a
  per-method allowlist that the D-Bus policy already contemplates and
  deliberately deferred (`pkgs/mosd/dist/com.mos.mosd.conf`) — this document
  does not reopen that.

Two consequences of coexistence that must be stated in the UI, not just here:

1. **Changing the admin password does not revoke any token.** That is deliberate
   — a human rotating their own password must not break every script — and it
   means "I changed my password" is not a containment action. The UI's password
   pane has to say so.
2. **§3.1 item 7 changes meaning.** The `auth.rs` comment's reasoning —
   per-client tracking buys nothing because there is one password — held because
   there was one credential. With tokens there are N, and the global backoff
   curve (`pkgs/mosd/apid/src/auth.rs`) still gates only the login POST
   (`pkgs/mosd/apid/src/routes.rs`). Bearer verification is **not** rate
   limited and should not be: 256 bits of `OsRng` is not guessable online, and a
   shared counter on the token path would let anyone with a bad token lock out
   every script. The comment is not wrong; it is now scoped to the password path
   and this document records that scoping.

### 3.3 Threat model, and what it does not protect against — **[proposed]**

**What ships.** The transport paragraph below is a measurement and still holds
at `f7cb5ba`; everything that reasons about a bearer token is a proposal about
a credential that does not exist. Read the two apart: where this section says
"a network peer without the token gets a 401", the shipped device gives a 401
to a peer without a **session cookie** on the three guarded `/api` routes
(`pkgs/mosd/apid/src/routes.rs`) and a redirect to `/login` everywhere else
(`pkgs/mosd/apid/src/routes.rs`) — and the CORS argument below, which depends on
the credential being a header rather than a cookie, **does not hold for the
shipped API at all**: a cookie is exactly what a browser attaches
automatically, and the mitigation the device actually has against a cross-site
call is the `SameSite=Lax` attribute (`pkgs/mosd/apid/src/session.rs`) and not
the absence of CORS headers. That gap is the strongest single argument for
building §3.2, and it is recorded here rather than left for a reader to derive.

**What the transport actually is.** rustls with the `ring` provider
(`pkgs/mosd/Cargo.toml`, installed explicitly at `pkgs/mosd/apid/src/main.rs`),
carrying a **self-signed certificate apid generates on first start**: CN `mos`,
SANs `DNS:mos`, `DNS:localhost` and the v4 loopback
(`pkgs/mosd/apid/src/tls.rs`, SAN construction), private key mode
`0o600` in a state directory created mode `0o700`.
There is no ACME client, no rotation and no way to install an operator-supplied
certificate anywhere in that file. Three things follow immediately:

- No client has a trust anchor for it. Verification is trust-on-first-use or
  nothing.
- The SAN list does not include the device's LAN address. An operator reaching
  the appliance at `https://192.168.1.50/` fails hostname verification even
  before the trust question, so the practical instruction to every client is
  "disable verification" — which is the instruction that makes item 1 below
  work.
- Certificate pinning is possible but has no supported lifecycle: nothing
  rotates the certificate, and nothing tells a client it changed.

**What the design does protect against.** A passive observer who did not see
the token being issued cannot read it later, because the channel is TLS. A
network peer without the token gets a 401 on every `/api/v1/` route. A
cross-site page in the operator's browser cannot call the API at all: browsers do
not attach `Authorization` headers to cross-origin requests, and a `fetch` that
sets one triggers a CORS preflight that apid answers with nothing — **apid sends
no CORS headers, deliberately** — so the browser blocks it. Choosing bearer-only
authentication for `/api/v1/` is what buys that, and it is the main reason §3.2
says "one mechanism" rather than "token or cookie".

That choice has a cost for whoever builds the replacement UI (§5): **a UI served
from a different origin — a developer's dev server on a laptop — cannot call the
API from the browser.** The workaround is a proxy in the dev server, not a CORS
relaxation, and this document recommends against ever adding
`Access-Control-Allow-Origin` because the moment it exists, the argument becomes
about which origins rather than whether. A second cost: a browser UI that needs
a token has to hold it in JavaScript, where an XSS can read it — strictly worse
than the `HttpOnly` cookie (`pkgs/mosd/apid/src/session.rs`) for that one
property. The built-in UI is unaffected because it is no-JavaScript by decision
(`docs/design/dashboard.md`).

**What it does not protect against.** Five attacks, concretely.

1. **An active on-path attacker on the LAN captures the token on first use.**
   Because the certificate is self-signed with SANs that do not match the
   address operators actually use (`pkgs/mosd/apid/src/tls.rs`), every client
   is configured to skip verification — the shipped boot health probe does
   exactly that, `curl -k` with a `wget --no-check-certificate` fallback
   (`rootfs/overlay/usr/lib/mos/mos-health`). An attacker who
   can answer for the device's address terminates TLS with their own
   certificate, and the client, told to accept anything, hands over the bearer
   token in the first request. Nothing in this design stops that. The mitigation
   that would — an operator-installed certificate, or a documented pin — does
   not exist in `mosd/apid/src/tls.rs` at `f7cb5ba` either.
2. **A stolen token is full management access, indefinitely.** There is no
   expiry (§3.2), no binding to a client address, and no binding to a request.
   A token exfiltrated from a CI secret store, a laptop backup or a shell
   history reboots the appliance, enables SSH
   (`PUT /api/v1/settings/access.ssh.enabled`), adds a root key
   (`POST /api/v1/ssh/authorized-keys` — *"Every authorized key is a root key"*,
   `pkgs/mosd/apid/src/routes.rs`) and is then no longer needed. Detection is not
   addressed either: nothing in the crate logs which credential served a
   request, and mosd records only the D-Bus sender for power actions
   (`pkgs/mosd/mosd/src/bus.rs`, sender resolved at `pkgs/mosd/mosd/src/bus.rs`), which is apid for every request apid makes.
3. **Replay.** A bearer token *is* replay: every authenticated request carries
   a byte-identical credential. There is no nonce, no request signing and no
   TLS channel binding. An attacker who captured one request under item 1 can
   repeat it forever. This is an accepted property of bearer authentication and
   is named because "we use TLS" is not an answer when item 1 shows the TLS is
   unverified.
4. **Phishing the operator on a hostile LAN.** Nothing authenticates the name
   `mos` to a client. Anything on the LAN that answers to it presents a
   self-signed certificate an operator has been *trained* to click through,
   because the real device presents one too. The captured password is then used
   at `POST /login` on the real device to mint a token via §3.2's bootstrap
   path. This is not a weakness the token introduces — it is the existing
   password's — but a design that adds a permanent credential mintable from that
   password must count it.
5. **A same-origin page mints a permanent token with the operator's cookie.**
   §3.2's bootstrap is a cookie-authenticated form POST at
   `POST /builtin/tokens`, and its defence is `SameSite=Lax`
   (`pkgs/mosd/apid/src/session.rs`) and nothing else, because there is no CSRF
   token in the crate at `f7cb5ba` — `grep -ni csrf mosd/apid/src/*.rs` returns
   nothing (§1.2). **`Lax` is a cross-site control and says nothing about a
   request issued from the device's own origin.** After §4 and §5 land, the
   device's own origin serves an operator-supplied bundle out of `/mos/ui`
   (§5.2), whose installation §7.4 recommends **not** requiring a signature for.
   So a hostile or XSS-compromised bundle, running at `https://<device>/` with
   the operator's session cookie attached by the browser, can submit that form
   and read the plaintext out of the response. **What is new here is not
   privilege — it is persistence.** The same bundle can already drive every
   other form pane the operator's cookie reaches: reboot, enable SSH, add a root
   key (`pkgs/mosd/apid/src/routes.rs`). But a minted token survives deactivating
   the bundle (§6.3), survives the A/B update that replaces apid (§3.2 reason 1),
   and is not revoked by an admin password change (§3.2 consequence 1). So
   *"deactivate the bundle"* is not a containment action, exactly as
   *"change your password"* is not. **Nothing in this design stops
   it, and a CSRF token would not either**: a same-origin script reads the form,
   and the token in it, straight out of the page. The control that would is an
   authorisation boundary between a served bundle and the built-in prefix; §4.1's
   precedence rule protects that prefix from being **shadowed**, not from being
   **called**. Naming it is what this section can do; §7.4's no-signing
   recommendation is where the decision that produces it lives.

**Anyone with SSH is already root, so none of this applies to them.** Every
authorized key is a root key (`docs/design/access.md` §4.1, and the sentence the
pane is tested to carry, `pkgs/mosd/apid/src/routes.rs`); apid runs as root
(`pkgs/mosd/dist/apid.service`); the D-Bus policy allows root to own, send and
receive (`pkgs/mosd/dist/com.mos.mosd.conf`). A root shell reads
`/var/lib/mos/settings.toml` directly, reads
`session.key` in that directory (`pkgs/mosd/apid/src/tls.rs`), and calls
`com.mos.mosd1` without going through apid at all. **The API token's threat
model is entirely about the network channel**; it adds nothing against local
root and it is not intended to.

**CSRF, now that form posts and an API coexist.** There is no CSRF token
anywhere in the crate — `grep -ni csrf mosd/apid/src/*.rs` returns nothing at
`f7cb5ba` (section 1.2) — and the picture after this proposal is:

- **Under this proposal the API path has no CSRF exposure**, because a bearer
  header is not something a browser attaches on a cross-site request. This is a
  property of the choice, not an added control — and it would be unconditional,
  because no `/api/v1/` route would accept a cookie at all. The mint that would
  have been the exception is `POST /builtin/tokens`, an HTML form on the form
  path (§3.2); a cookie presented to `/api/v1/tokens` would be a `401`.
  **None of that is true of the shipped API**, whose credential *is* the cookie
  (`pkgs/mosd/apid/src/routes.rs`), so today the four `/api` routes sit
  behind exactly the same `SameSite=Lax` control as the form panes. They are
  all `GET`, which is what keeps the exposure to reads rather than writes, and
  that is a consequence of phase 1 having no writes rather than a control.
- **The form path is covered for POST by `SameSite=Lax`**
  (`pkgs/mosd/apid/src/session.rs`), which withholds the cookie from cross-site
  form submissions. That is a real control and it is the only one.
- **One form-path route now mints a permanent credential, and that changes what
  `SameSite=Lax` is being asked to hold.** Against a cross-site attacker it
  holds `POST /builtin/tokens` exactly as it holds `/ssh/keys/add`, and §3.2
  makes the POST-only rule explicit for that reason. Against a **same-origin**
  attacker — a bundle apid itself serves — it holds nothing, and the credential
  it fails to hold outlives both the bundle and the password. That is attack 5
  above. It is named here rather than mitigated, because the mitigation is an
  authorisation boundary this document does not have and §7.4 deliberately did
  not buy.
- **The per-action confirm tokens are not CSRF tokens and must not be counted as
  such.** `PowerAction::confirm_token` returns the constant strings `"reboot"`
  and `"poweroff"` (`pkgs/mosd/apid/src/routes.rs`) and
  `TRANSIENT_CONFIRM_TOKEN` is the literal `"set-transient-password"`
  (`pkgs/mosd/apid/src/routes.rs`). They are not secret, not per-session and not
  unpredictable; the source describes their purpose accurately as stopping a
  submit without a ticked checkbox — *"The submit button alone is not enough:
  the checkbox has to be ticked as well"* (`pkgs/mosd/apid/src/routes.rs`). They stop a mis-click and a prefetch. Against a
  cross-site attacker they add nothing, and the form path holds because
  `SameSite=Lax` holds.

**One denial-of-service note, narrowed twice since it was written.** This
paragraph said the gate calls `GetSettings("access")` on **every** request
before deciding anything, so an unauthenticated flood costs one D-Bus round
trip per request against the single lock mosd holds over both trees
(`pkgs/mosd/mosd/src/bus.rs`). At `f7cb5ba` the bus call is paid
only by a request **without** a valid session cookie
(`pkgs/mosd/apid/src/routes.rs`), so an authenticated flood no longer
reaches mosd through the gate. The unauthenticated path has since been
narrowed too: while the `SettingsChanged` subscription is live (§1.3), the
gate serves the `access` subtree from an in-process cache and pays the bus
round trip only to refill after a change; only when the subscription is not
live — mosd down, stream lapsed — does every unauthenticated request still
reach mosd, which is the deliberate fail-fresh fallback and not a cost that
can be removed. `GET /api/versions` is cheaper still:
the gate hands it off above the bus call entirely
(`pkgs/mosd/apid/src/routes.rs`) and its handler makes no mosd call
(`pkgs/mosd/apid/src/routes.rs`), so it is an unauthenticated route that
costs no round trip at all. Adding an API does not create the flood problem,
but it adds routes that are attractive to automate against. This design does
not solve it.

## 4. Static hosting

Section 1.6 measured the starting point at `86cd669`: apid served no static
asset of any kind, from anywhere, and the only disk paths it read at all were
`/proc/uptime` (read in apid then; mosd publishes uptime now — §2.2 item 3)
and its own state directory (`pkgs/mosd/apid/src/tls.rs`). Everything in this section was therefore
new code rather than a configuration change to something that existed, and it
was marked **[proposed]** throughout for that reason. §8.2 phase 4 has since
landed; the paragraphs below say where.

**The markers in §§4, 5 and 6 are carried per subsection, and the section
headings carry none.** A section-level mark is a claim about every subsection
under it, and §0's `[implemented]` obliges each marked subsection to name its
own code **by path**, so the mark can only be checked where the path is. §0
already exempts sections that describe no mechanism from carrying a marker; the
mechanisms here are the subsections', and each of them carries its own. A
reader who wants the section's status reads four marks rather than one, and
none of the four can be true on another's evidence.

**§§4-6's citations are re-measured at `0d4f3c6`; the rest of the document
remains measured at `86cd669` per §0.** The reason for the asymmetry is the
markers: a subsection claiming `[implemented]` names code a reader is expected
to open **today**, so a citation in it that only resolves under
`git show 86cd669:<path>` is not evidence. Sections that remain `[proposed]`
carry no such obligation and were left on §0's anchor. Where a sentence below
states a fact about `86cd669` that phase 4 has since changed, the sentence is
bound to its period and what landed is stated beside it, rather than restated.

**A path is evidence of code. Evidence of code is not evidence of a booted
device.** Every mechanism in §§4, 5 and 6 is **host- and container-tested and
none of it is exercised on hardware**: the Rust is one `cargo nextest` run on
the build host against temporary directories, and the image assertions run
against an assembled image and a fixture root, not against a board. The
accurate statement of the surrounding position, because both overstatements are
wrong: hardware **has** booted — a **legacy (pre-verity)** image reached the `mos login:` prompt
on a real CX3576-Z, and the repart/maskrom and SPL-hash investigations ran
against a real board — while the **verity** stack these sections land in (verity
root, A/B, `rauc install`, and apid itself) has **never** run on hardware.
*"Never booted"* and *"verified on device"* are both false. `[implemented]`
here means what §0 says it means and nothing more, and §6.3's *"No hardware
claim is made anywhere in this section"* stays true.

### 4.1 Routing between API and assets — **[implemented]**

**Implemented at `pkgs/mosd/apid/src/routes.rs`** — `app` structurally owns the
three product namespaces: `/api` is the versioned management API with its own
JSON fallback, `/_ui` is the built-in SPA with its own embedded-tree fallback,
and all remaining UI paths belong to the active custom bundle at `/`.
`/healthz` remains one explicit operational probe outside asset resolution.
The custom side is `pkgs/mosd/apid/src/assets/serve.rs`; the built-in side is
`pkgs/mosd/apid/src/assets/builtin.rs`. A miss inside one namespace is terminal
and never causes lookup in another resource tree.

Axum 0.8 does not make the trailing-root spellings of a nested router
interchangeable, so `/api/` and `/_ui/` remain explicit declarations. The path
layer in `pkgs/mosd/apid/src/assets/path.rs` closes the former leading-separator
gap as well: it requires one prefix-stripped relative key, decodes exactly once
and rejects repeated or encoded separators, empty/dot components, controls,
backslashes and residual escapes. At the root custom-UI boundary it also rejects
a decoded first component equal to `api` or `ui`; therefore `//api/versions`,
`/%61pi/versions` and equivalent aliases are 404 rather than another spelling
of a bundle file. Segment-aware matching leaves `/ui`, `/apiary` and `/uikit` valid.

**The precedence rule.** One request arrives; apid decides in this order, and
the order is total — no request is ever ambiguous:

1. **`/api` — a reserved subtree.** Declared operations answer normally and
   every miss below the prefix uses the API's JSON 404. No API request reaches
   an asset resolver.
2. **`/_ui` — the built-in resource tree.** It serves only the compile-time
   embedded VFS and owns its own SPA fallback and 404 behavior.
3. **`/healthz` — the operational exception.** It is a direct liveness route,
   not a fourth asset tree.
4. **`/` and every remaining UI path — the custom resource tree.** Exact `/`
   serves the active custom index or redirects to `/_ui/`; the fallback never
   reads the built-in VFS.

**Why this order rather than any other.** Rule 1 is not a convention that has
to be policed; it is the shape axum's router already has. As of `86cd669` the
HTTPS router matched its fifteen `.route()` declarations and declared **no
fallback at all** — the only `.fallback` in the file belonged to the HTTP
redirect router, which is why an unmatched path was then answered by the gate's
redirect to `/login` or by axum's default not-found (section 1.6). The HTTPS
router now declares `.fallback(serve::fallback)` of its own. Adding the asset service as the *fallback* therefore means declared
routes win **structurally**: a bundle that ships a file
at `api/v1/settings` cannot capture API traffic, because the router never
consults the fallback for a path it matched. A rule enforced by the dispatch
mechanism is worth more than a rule enforced by a check somebody can forget to
write.

**Why the `/api/v1` prefix, and what the alternatives cost.**

| Option | Rejected because |
|---|---|
| **Content negotiation on the same paths** (`Accept: application/json` selects the API) | The reserved set becomes invisible in the URL: you cannot tell from a request line whether it is an API call or an asset fetch, which makes both logs and `curl` reproduction ambiguous. A `fetch()` that forgets its `Accept` header silently receives HTML. |
| **A second listener on its own port** | Two TLS configurations, two firewall rules, and the self-signed certificate would have to be accepted twice by the browser — it is generated once into the state directory with SANs `DNS:mos`, `DNS:localhost`, `IP:127.0.0.1` (`pkgs/mosd/apid/src/tls.rs`). The two listeners that exist at `86cd669` are 443 and a redirect-only 80 (`pkgs/mosd/apid/src/config.rs`, `pkgs/mosd/apid/src/routes.rs`); a third is a real operational cost for no isolation gain, since both would be served by the same root process. |
| **A subdomain** (`api.mos`) | The certificate carries three SANs and no wildcard (`pkgs/mosd/apid/src/tls.rs`), and the appliance provides no DNS. A new name means a new SAN, a new way for the name to fail to resolve, and a second certificate-trust prompt. |
| **`/api/v1` prefix** | **Chosen.** One origin, one certificate, one listener, and the reserved set is legible in every URL. |

**What it costs, stated plainly.** The prefix `/api` is burned permanently: a
custom UI can never serve a page or an asset at `/api/anything`, and it never
gets that path back. That is the price of rule 1 being structural. It is
cheap here only because the reserved set is small and is written down.

**The earlier server-rendered page routes no longer exist.** Product pages now
live in the React SPA and use `/api/v1/...`; only `/healthz` remains a declared
non-API, non-asset path. This releases names such as `/network` and `/login` to
an active custom SPA without weakening `/api` or `/_ui` ownership.

**`/` is the one that matters, and it must not be waved past.** A replaceable UI
whose index cannot be served at the site root is not replaceable in any useful
sense — an SPA mounted at a subpath needs a base href and a rewrite of every
absolute URL it emits, and the operator's bookmark still lands on the built-in
status pane. So `/` is the single exception to rule 3:

- `GET /` serves the **active bundle's `index.html` when a bundle is active**
  and its index is readable (section 5.3's definition of active);
- otherwise `GET /` redirects to `/_ui/`.

`/` is therefore conditional and `/_ui` is unconditional. The custom bundle can
never shadow or replace `/_ui`, including by placing an `_ui/` directory inside
its own tree.

### 4.2 SPA fallback — **[implemented]**

**Implemented at `pkgs/mosd/apid/src/assets/serve.rs`** — `fallback` and `respond`,
with condition 1 costing no code (it is 4.1's mounting), condition 2 the method
check, conditions 3 and 4 the `offers_html` and `ends_in_a_route_segment`
predicates, and condition 5 whether `serve_index` produced anything. Each
condition has its own test in `pkgs/mosd/apid/src/tests.rs`.

**Condition 3 is implemented strictly, and the cost is stated rather than
hidden.** *"The request's `Accept` header must offer `text/html`"* is read as
`text/html` or `text/*` **explicitly**; `*/*` is not an offer and neither is an
absent header. Read permissively, a `fetch()` that sets no `Accept` at all —
whose default is `*/*` — would receive 200 and HTML, which is precisely the
failure this subsection's acceptance property names. The cost:
`curl https://<device>/settings/network` gets a 404 where a browser at the same
URL gets the application. No browser navigation is affected, and `GET /` is a
declared route with no `Accept` condition, so a bare `curl` of the device root
still gets the bundle's index.

**Condition 4 also rejects a `%` in the final segment**, because a `%` that
survives §4.4's single decode is a hard rejection there and never reaches this
predicate; reading a residual `%` as an asset can only produce a 404, never HTML
for something that was a filename.

A single-page application needs a **200 with `index.html`** for a path its
client-side router owns, because a 404 stops the application from booting. The
danger is the mirror image: if that fallback is applied indiscriminately, every
mistyped API call and every missing asset returns 200 with HTML. A `fetch()`
then parses HTML as JSON and reports a parse error at the wrong layer; a missing
script tag returns HTML and the browser reports `Uncaught SyntaxError:
Unexpected token '<'`. Both symptoms point away from the actual cause, which is
that the file is not there.

**The rule.** `index.html` is served, with status **200**, only when **every**
one of these holds:

1. **The path is not reserved.** Guaranteed structurally by 4.1 — a request
   under `/api/`, under the section 6.3 prefix, or matching a declared route,
   never reaches the asset router at all. Nothing here has to re-check it.
2. **The method is `GET` or `HEAD`.** A `POST`, `PUT`, `PATCH` or `DELETE` that
   reaches the asset router is a client error and gets **405**, never HTML.
3. **The client asked for HTML.** The request's `Accept` header must offer
   `text/html`. A browser navigation does; a `fetch()` with
   `Accept: application/json` does not, and gets **404**. This is the condition
   that separates a navigation from a data call when both are `GET`.
4. **The final path segment contains no `.`.** `/settings/network` falls back;
   `/assets/app.a1b2c3.js` does not, and gets **404** with an empty body. A
   client-side route is a name; an asset is a filename. This is a heuristic and
   it is named as one — a UI with a route literally called `/v1.2/report` would
   get a 404 where it wanted a fallback. The alternative heuristics are worse: a
   list of known asset extensions goes stale the first time a customer ships a
   format nobody predicted, and no heuristic at all is the failure this
   subsection exists to prevent.
5. **A bundle is active and its `index.html` is readable.** If it is not, this
   is not a 404 and not a 500 — it is section 6.1 failure class 2 or 4, and the
   response is the **built-in UI**, not an error page.

**Why 404s inside `/api/` are the API's own.** Condition 1 means the `/api/`
subtree answers its own misses. That 404 must carry the API error shape rather
than an empty body, so a client that mistypes a path gets the same
machine-readable envelope as every other API error. The shape belongs to section
2.4 and is **not specified here**.

**The gate contradicted this rule until later**. Condition 1 makes the subtree answer its own misses, but the gate
only handed *declared* routes to it; an undeclared path under the prefix fell
through to the HTML branches and was answered with a 303 to `/login` whenever
the request carried no valid session cookie — which a bearer-only client never
does, so the whole API-client population saw the redirect and only a browser
saw the envelope. §2.3's decision 2 releases the reserved subtree before any
credential is read, so the answer is this envelope for every credential and for
none.

**The property to test.** After this rule, a request that a developer expected
to be JSON never returns HTML with a 200. That is one integration test per
condition, and it is the test that keeps 4.2 from silently regressing.

### 4.3 MIME and caching — **[implemented]**

**Implemented at `pkgs/mosd/apid/src/assets/mime.rs`** — the fixed extension
allowlist (`.wasm` and `.webmanifest` in it from the start, `pkgs/mosd/apid/src/assets/mime.rs`), the
`octet-stream` fallback, `nosniff`, and the three cache classes with their
header values (`pkgs/mosd/apid/src/assets/mime.rs`). The headers are attached to every response the asset
router builds by `asset_response` in `pkgs/mosd/apid/src/assets/serve.rs`, and the
`/api/` subtree's own 404 carries `no-store` from the same enum
(`pkgs/mosd/apid/src/routes.rs`). The immutable class is read per request from
the served tree's `mos-ui.json` (`serve.rs`, `immutable_dir`), because the
store validates the manifest at install time but exposes only its name and
version afterwards — a public accessor for `immutableDir` is the clean fix and
belongs to whoever next owns §5.3.

**How a content type is decided.** From the filename extension, through a
**fixed allowlist compiled into apid** — not through a general-purpose guesser
and never by sniffing content.

The alternative would be `mime_guess`, which is what `tower_http`'s `ServeDir`
uses: it calls `mime_guess::from_path` and falls back to
`application/octet-stream`
(`tower-http-0.6.11/src/services/fs/serve_dir/open_file.rs`, in the
registry copy of the version pinned at `pkgs/mosd/Cargo.lock`). A fixed
table is preferred because the appliance serves a handful of extensions and a
generated MIME database is a large dependency for that, and because the table
being *ours* means the unknown-extension behaviour is a decision rather than a
default.

**The unknown extension, which is the security-relevant half.** An unknown or
absent extension is served as `application/octet-stream` **together with
`X-Content-Type-Options: nosniff`**, and `nosniff` is sent on **every** asset
response, not only the unknown ones. Without it a browser may sniff an uploaded
file as HTML and execute it on the management origin — which turns "upload a UI
bundle" into stored cross-site scripting against the same origin that holds the
session cookie (`apid_session`, `Path=/; HttpOnly; Secure; SameSite=Lax`,
`pkgs/mosd/apid/src/session.rs`). The cookie is `HttpOnly`, so script
cannot read it, but same-origin script does not need to read it: it can issue
authenticated requests directly.

**What the allowlist costs.** A customer shipping a format the table does not
know gets `application/octet-stream`, and for two formats that is not a cosmetic
degradation:

- **`.wasm`** — `WebAssembly.instantiateStreaming` requires
  `application/wasm` and fails outright on `octet-stream`.
- **`.webmanifest`** — an installable web app will not install.

The table lives inside the verity-covered image (section 6.2), so a customer
**cannot extend it on device**; growing it is an A/B update. That is a real
constraint and it is the reason the fallback is `octet-stream` rather than a
refusal: an unrecognised file is still downloadable, and the failure is legible
rather than silent. The initial table should therefore carry `.wasm` and
`.webmanifest` from the start, precisely because they are the two that break
rather than degrade.

**The caching posture.** Three classes, and the boundaries between them are
mechanical:

| Class | Header | Why |
|---|---|---|
| **Every HTML document**, including `index.html` and the SPA fallback | `Cache-Control: no-store` | The index is the only document that names the hashed asset filenames. A cached index means a new bundle is invisible no matter how correctly its assets are named. `no-store`, not `no-cache`: `no-cache` still permits a stored copy revalidated by a validator apid may not emit. |
| **Every `/api/` response** | `Cache-Control: no-store` | Management responses reflect device state and must never be replayed from a browser's disk cache on an operator's laptop. |
| **Files under a directory the bundle manifest declares immutable** | `Cache-Control: public, max-age=31536000, immutable` | Safe **only** because the filename changes when the content changes. |
| **Everything else** | `Cache-Control: no-cache` | Revalidate before reuse. Not `no-store`, so a validator can still save the transfer. |

**The immutable class is opt-in, and that is deliberate.** apid cannot verify
that a customer content-hashed their filenames, and a year-long `immutable` on a
file whose name is stable is unrecoverable from the server side — the browser
will not even ask. So immutability is **declared by the bundle's manifest**
(section 5.3) for a named directory, and the default for an undeclared bundle is
`no-cache` for everything. A customer who does not hash their filenames gets a
revalidation round trip per asset and a correct UI; a customer who does gets the
fast path by saying so.

**What `ServeDir` would give us if adopted, and why it is not enough.** At
version 0.6.11 it sets `Last-Modified`
(`tower-http-0.6.11/src/services/fs/serve_dir/future.rs`) and **nothing
else**: `grep -n "CACHE_CONTROL\|ETAG"` over
`tower-http-0.6.11/src/services/fs/serve_dir/` returns no match. So the entire
caching posture above is a layer apid must add regardless of whether the
file-serving itself is borrowed. Note also that `tower-http` is **not a
dependency of the crate** (`pkgs/mosd/apid/Cargo.toml`; section 1.6, evidence
1) — see 4.4 for what adopting it actually involves.

**What an operator sees after uploading a new bundle.** This is the acceptance
criterion for the whole subsection, and it is worth stating as one:

> An operator who uploads a bundle and reloads the page **must see the new UI
> without clearing the browser cache, without a hard refresh, and without an
> incognito window.** If that is not true, this subsection is wrong.

The rule above satisfies it by construction: the reload fetches `index.html`
fresh because it is `no-store`; that index names the new bundle's asset
filenames; those are fetched because they are new names, or revalidated because
the default is `no-cache`. Only the opt-in immutable class can be stale, and
only for filenames the customer promised would change.

The failure this prevents is not a caching bug — it is a **support** bug. An
operator who uploads a fix, reloads, sees the old UI and concludes the upload
failed will re-upload, then reboot, then open a ticket, and every one of those
actions is aimed at the wrong layer. Section 5.3's "what is installed right now?"
read is the other half of the same defence: it answers from the served tree, so
it disagrees with the browser and tells the operator where to look.

### 4.4 Path traversal — **[implemented]**

**Implemented at `pkgs/mosd/apid/src/assets/path.rs`** — `resolve`, a pure function
from a request target and an already-resolved bundle root, performing rules 1-5
in order, with one test per guard and the five requests §8.2 phase 4 acceptance
2 names among them. The **primary** defence rule 5 chooses — install-time
rejection of any entry that is not a regular file or a directory — is
`validate_tree` in `pkgs/mosd/apid/src/bundle.rs` (§5.3 requirement 2). No `unsafe`
was added and no dependency was added; `#![forbid(unsafe_code)]` is still at
`pkgs/mosd/apid/src/main.rs`.

**Two rejections beyond the five rules, both flagged rather than folded in.**
Neither loses behaviour the rules require, and both were reported deliberately:

- **A `%` that survives the single decode is rejected outright**
  (`Rejection::ResidualEscape`). Rule 2 forbids a second decode pass, so
  `/%252e%252e%2fetc%2fpasswd` decodes once to `%2e%2e/etc/passwd`, whose
  components are all ordinary names — rules 1 and 3 do **not** fire and the
  honest lexical answer is a plain miss, which §4.2's five conditions then all
  admit. A literal reading of §4.2 and §4.4 together therefore returns
  `200 text/html` for a string §8.2 phase 4 acceptance 2 requires to be a 404.
  Rejecting the residual escape makes that acceptance hold structurally. The
  cost: a bundle cannot ship a filename containing a literal `%`.
- **A backslash is rejected**, on rule 4's own reasoning. On Linux `\` is an
  ordinary filename character and on Windows it is a separator; rule 4 rejects
  NUL explicitly rather than relying on a platform's errno, on the ground that
  *"an accident is not a rule"*, and the same argument covers a byte whose
  meaning is platform-dependent. No asset in a bundle needs one.

Only a plain miss is eligible for §4.2's fallback
(`Rejection::eligible_for_fallback`); every guard that fires answers 404, so a
request the rules rejected can never come back as `200 text/html`.

**What a successful traversal reaches, first, because it sets the stakes.**
apid runs as **root** — `pkgs/mosd/dist/apid.service` sets no `User=` line
(`pkgs/mosd/dist/apid.service`). Its `[Service]` section sandboxes the daemon
in the directions a root network listener can afford, `PrivateTmp=` and
`ProtectHome=` among them (`pkgs/mosd/dist/apid.service`), but there is no
`ProtectSystem=`, no `ReadOnlyPaths=` and no `RootDirectory=`, so nothing
narrows what the process may **read**. The D-Bus policy records the privilege
from the other side — *"no shipped unit sets User=, mosd.service owns the name
as root, apid.service and the boot health gate both run as root"*
(`pkgs/mosd/dist/com.mos.mosd.conf`). A traversal is therefore an arbitrary
file read **as root**, and the reachable set includes at least:

- **`/var/lib/mos/settings.toml`** (`pkgs/mosd/mosd-settings/src/store.rs`) — the
  whole settings tree, including the argon2id webAdmin hash
  (`pkgs/mosd/apid/src/routes.rs`) and every authorized SSH key.
- **`/var/lib/mos/shadow`**, which is what `/etc/shadow` is a symlink to
  (`docs/design/ro-root.md`).
- **`/etc/ssh/`** — the sshd host private keys, bound from STATE
  (`docs/design/access.md`).
- **apid's own state directory**, `/var/lib/mos/apid` by default
  (`pkgs/mosd/apid/src/config.rs`): the TLS private key, mode `0o600`
  (`pkgs/mosd/apid/src/tls.rs`), and **`session.key`**, the 32-byte HMAC
  signing key (`pkgs/mosd/apid/src/tls.rs`).

That last one is the escalation nobody should have to discover during an
incident. A session cookie is `<id>.<hmac>` where the MAC is HMAC-SHA256 of the
id under the persistent signing key (`pkgs/mosd/apid/src/session.rs`). **Reading
`session.key` lets an attacker mint a valid session cookie**, which converts a
file-read primitive into full administrative access without ever guessing the
password.

**And the read-only rootfs does not help.** This must be said explicitly,
because it is the assumption a reader of `docs/design/ro-root.md` will carry in:
**dm-verity protects integrity, not confidentiality.** The squashfs and its hash
tree (`docs/design/ro-root.md`) guarantee that `/` cannot be *modified*.
A traversal does not modify anything. The whole security story of the device is
orthogonal to this attack, and every secret listed above lives on STATE, outside
verity's coverage by design.

**The rules, stated as rules rather than delegated to a framework.**

1. **Reject before touching the filesystem.** Percent-decode the request path
   **once**, parse the result into path components, and require every component
   to be an ordinary name. A `..` component → reject. A root or prefix
   component → reject. A `.` component → skip. Never build the path by string
   concatenation onto the bundle root.
2. **Decode exactly once, and validate the decoded form.** Both halves matter,
   and in this order. A second decode pass after validation turns `%252e%252e`
   back into `..`; validating the *raw* string for a literal `..` lets
   `%2e%2e%2f` through, because `%2f` decodes to `/` and the segment only
   becomes a `..` component after decoding. The component parse must therefore
   run on the decoded bytes and the decode must not be repeated.
3. **Absolute paths.** An HTTP request target always begins with `/`. Strip
   **all** leading separators, then require every remaining component to be an
   ordinary name — so a root component appearing anywhere, not only at the
   front, is a rejection.
4. **NUL.** `%00` decodes to a NUL byte. A NUL cannot truncate a Rust path the
   way it truncates a C string, and the eventual syscall would return `EINVAL`.
   Reject it **explicitly, at the same place as `..`**, rather than relying on
   that: relying on the syscall makes the answer depend on the platform's errno
   and on a library's mapping of it. For reference, `tower_http` does arrive at
   the right answer by that route — it maps `ErrorKind::InvalidInput` to
   `InvalidFilename`
   (`tower-http-0.6.11/src/services/fs/serve_dir/open_file.rs`, comment:
   *"Only applies to NULL bytes"*) and then to a 404
   (`tower-http-0.6.11/src/services/fs/serve_dir/future.rs`) — but that is a
   404 reached by accident, and an accident is not a rule.
5. **Symlinks — the case rules 1-4 do not cover, and the one that matters most
   here.** Lexical validation proves the *requested path* escapes nothing. It
   proves nothing about what the kernel does when it resolves that path.
   `tower_http` 0.6.11 performs **no canonicalisation at all**: `grep -rn
   "canonicalize\|symlink_metadata\|read_link"` over
   `tower-http-0.6.11/src/` returns no match, and `build_and_validate_path`
   (`tower-http-0.6.11/src/services/fs/serve_dir/mod.rs`) is purely
   lexical — it rejects `Component::ParentDir`, `RootDir` and `Prefix`
   and then simply pushes the remaining names onto the base path.

   A bundle is **operator-supplied content**, and planting a symlink inside one
   is trivial. `ui/leak -> /var/lib/mos/settings.toml` inside a bundle is
   served, in full, by a purely lexical checker. Three mitigations, in order of
   strength:

   | Mitigation | Strength | Cost |
   |---|---|---|
   | **Reject symlinks at install time** — the unpacker refuses any entry that is not a regular file or a directory (section 5.3) | Removes the class from the tree entirely | None beyond the check; composes with a bundle that is immutable after activation |
   | **`openat2(2)` with `RESOLVE_BENEATH \| RESOLVE_NO_SYMLINKS`** | Strongest — the kernel enforces it, per-open, with no race | Needs Linux ≥ 5.6, and a raw syscall. **The workspace forbids unsafe code** (`pkgs/mosd/Cargo.toml`, repeated locally at `pkgs/mosd/apid/src/main.rs`), so this means a new dependency carrying `unsafe`, inside the root-privileged daemon, subject to the audit `pkgs/mosd/hack/check.sh` runs |
   | **Canonicalise the opened path and assert it starts with the resolved bundle root** | Safe Rust, no new dependency | One extra syscall per request; TOCTOU-racy in principle, though the race requires mutating the bundle tree between the check and the open, which section 5.3's activate-by-rename makes unreachable for the install path |

   **Chosen: install-time rejection as the primary defence, canonicalise-and-
   assert at serve time as defence in depth.** Both are safe Rust and neither
   adds a dependency. `openat2` is genuinely stronger, and it is refused here
   for one reason worth writing down: buying it costs an `unsafe`-carrying
   dependency in a daemon that runs as root, and that is a worse trade against
   *this* threat than two cheap layers that each close it independently.

   One consequence to carry into 5.3: the assertion is made against the
   **resolved** bundle root, not against the `/mos/ui/current` symlink itself.
   That pointer is appliance-managed and lives outside every bundle tree; the
   "no symlinks" rule applies to bundle *contents*.

**On depending on a library, and what happens if its behaviour changes.**
`tower-http` is not a dependency of the crate — its manifest lists none
(`pkgs/mosd/apid/Cargo.toml`, section 1.6 evidence 1). The copy at
`pkgs/mosd/Cargo.lock` is version **0.6.11**, pulled in by the
**dev-dependency** `reqwest` (`pkgs/mosd/apid/Cargo.toml`), and it is built
**without the `fs` feature**: its
dependency list in the lockfile (`pkgs/mosd/Cargo.lock`) contains no
`tokio`, `mime_guess`, `httpdate` or `http-range-header`, all of which `fs`
requires
(`tower-http-0.6.11/Cargo.toml`). **`ServeDir` is therefore not
compiled today**, and adopting it is a manifest change and a new feature
surface, not a flag flip.

If it is adopted, two things follow:

- **Pin it exactly**, the way `tough` is pinned for a comparable reason
  (`pkgs/mosd/Cargo.toml`).
- **Own the traversal test in our crate, not in theirs.**
  `build_and_validate_path` is a private function with no stability promise. A
  refactor that moved the decode after the component parse would silently
  reopen rule 2, and a version bump that changed the symlink posture would
  silently change rule 5 — and in both cases nothing in this repository would
  notice. The test is one integration test asserting a 404 for each of:
  `/../../etc/passwd`, `/%2e%2e%2fetc%2fpasswd`, `/%252e%252e%2fetc%2fpasswd`,
  a path containing `%00`, and a request that resolves through a symlink
  planted in a temporary bundle root. The crate already has the machinery:
  a `tests/` directory (section 1.6, evidence 4) and `tower` and `tempfile` as
  dev-dependencies (`pkgs/mosd/apid/Cargo.toml`).

## 5. Where a custom UI lives

Markers are per subsection here too, for the reason §4 states; §4's note on
what `[implemented]` means in §§4-6, and on the hardware position it must not
be read as, governs this section unchanged.

### 5.1 Why it cannot live in the rootfs — **[implemented]**

`/` is a zstd-compressed squashfs covered by a dm-verity hash tree carried in
the same file (`docs/design/ro-root.md`), mounted read-only by the kernel
from `dm-mod.create=` with no fstab entry that could ever remount it — the
fstab template says so in as many words: *"there is no remount to perform and no
entry that could ever succeed in rewriting it"*
(`rootfs/overlay/etc/fstab.in`; `docs/design/ro-root.md`) — so a
write there does not fail a permission check, it fails a cryptographic one. And
the slot is replaced **wholesale** by an A/B update: RAUC installs the entire
`rootfs.img` into the raw `rootfs-a`/`rootfs-b` slot
(`pkgs/rauc/system.conf.in`, `pkgs/rauc/manifest.raucm.in`), so anything
written into a rootfs would be gone at the next update even if writing it were
possible.

### 5.2 The location, and the bind — **[implemented]**

**Implemented at `pkgs/mosd/apid/src/bundle.rs`** — `DEFAULT_ROOT` is
`/mos/ui`, and the layout beneath it is `bundles/<generation>/`, `current`,
`records/`, `.staging-<generation>/` and `.trash-<generation>/`, and the modes
are `DIR_MODE` `0755` and `FILE_MODE` `0644`, applied to the root and
to everything under it. The storage initializer creates `/mnt/data/mos/ui`
before `mos.mount` binds `/mnt/data/mos` onto `/mos`. The verifier checks both
that DATA is mounted at `/mnt/data` and that the public `/mos` bind is backed by
`/mnt/data/mos`.

**The path is `/mos/ui/`.**

**The bind is deliberate.** DATA itself is mounted only at the internal backing
path `/mnt/data`. `mos-data-layout.service` validates and creates the direct
`mos` and `srv` children, then `mos.mount` exposes `/mnt/data/mos` at `/mos` and
`srv.mount` exposes `/mnt/data/srv` at `/srv`. This keeps appliance state out of
the operator namespace while both share the growable DATA filesystem. There is
no compatibility symlink or migration layout in development images.

`/home` and `/root` remain separate binds from `/mos/home` and `/mos/root`.
DATA is the only partition carrying `x-systemd.growfs`, on its `/mnt/data`
fstab entry, so a bundle root under `/mos/ui` has no ceiling short of the disk.
The image verifier asserts every involved mountpoint and exact bind source.

**Ownership and permissions: `root:root`, mode `0755` on `/mos/ui` and on the
directories beneath it, `0644` for files.**

- apid runs as root — the unit sets no `User=` line
  (`pkgs/mosd/dist/apid.service`) — so it can write
  regardless of what the mode says.
- **The mode is chosen for the daemon apid is meant to become, not the one it
  is.** mos runs two processes with a real privilege boundary
  (`docs/design/dashboard.md`), and nothing about serving a bundle root
  requires the API daemon to stay root. A root-owned, world-readable bundle root
  is the shape that survives that change without a migration: the serving path
  needs only read, and the install path is privileged anyway.
- **Not `0700`.** Content served to an authenticated browser is not a secret,
  and `0700` would force a group or an ownership change the day apid stops
  being root.
- **The owner is not pinned to a numeric uid**, unlike `/mos/home/mos`
  (`rootfs/overlay/usr/lib/mos/mos-seed-home`), because
  root is `0` on every image that will ever exist. If a future `apid` account
  owns this tree instead, that uid **must** be pinned by number for exactly the
  reason `mos-seed-home` documents — the directory outlives the rootfs that
  created it.
- **Explicitly not under `/mos/home` or `/mos/root`.** Those are the bind
  sources for operator-owned trees (`/mos/home/mos` is uid 1000, mode `0700`;
  `rootfs/overlay/usr/lib/mos/mos-seed-home`). A UI bundle is
  appliance state, not a user's file, and mixing the two would make "delete my
  files" and "remove the UI" the same gesture.

### 5.3 Install and removal — **[implemented]**

**Implemented at `pkgs/mosd/apid/src/bundle.rs`** — `Store::activate` performs the
five steps in this subsection's order (`pkgs/mosd/apid/src/bundle.rs`), `validate_tree` enforces the
three requirements a bundle has, `deactivate` and `delete`
are the two operations this subsection refuses to conflate, `prune`
keeps the current generation and the previous one, and `Store::status`
is the *"what is installed right now?"* read, answering from the served tree
with `NO_CUSTOM_BUNDLE` as the named answer for "no bundle active". The module
contains no HTTP.

**The one step with no code, named precisely.** Step 1's *unpack* is not in the
tree: `activate` takes an already-staged `.staging-<generation>/` and the
comment at the head of it says so — *"Step 1 is the operator's or the upload
path's"*. That is not a shortfall against this subsection, which leaves the
archive-format choice open, and against §8.2, which
gives phase 4 the whole mechanism **except** the request that delivers the
archive and gives that request to phase 5. The two install paths that exist
today are both local: an operator stages a tree and an activate operation runs,
or `startup::discover` picks up a staged directory at start-up. The endpoint
that exposes the status read likewise belongs to §2.

**Two behaviours worth reading back, because both look like something they are
not.** A `mos-ui.json` that does not parse costs the bundle §4.3's opt-in
immutable cache class and nothing else — it is not §6.1 class 3, which is the
recorded **digest** mismatching. And a tree an operator drops into
`bundles/<n>` by hand and points `current` at has no activation record, so it
reads as *"active, unchecked"* rather than as corrupt; this subsection writes
class 3 as the digest *recorded at activation*, so that is in scope by
construction, and such a tree is still subject to §6.1 classes 1, 2 and 4 at the
asset router on every request. A **corrupted** record is currently
indistinguishable from an absent one (`read_record` ends in `.ok()`), which
lets an operator with a root shell who corrupts both the tree and its record
escape the start-up check; that is reported, not closed, and belongs to whoever
next owns this subsection.

**What a bundle IS.** On disk, a **directory tree**. Its requirements:

1. **Exactly one `index.html` at the root of the tree.** This is what section
   6.1's second failure class checks and what 4.1's `/` exception and 4.2's
   fallback both resolve to.
2. **No entry that is not a regular file or a directory.** No symlinks, no
   hardlinks, no device nodes, no FIFOs, no sockets. This is 4.4 rule 5's
   primary mitigation and it is enforced at unpack, on the staged tree, before
   anything is reachable.
3. **Optionally `mos-ui.json` at the root**, declaring at least: a `name`, a
   `version`, the directory whose contents may be cached `immutable` (4.3), and
   **the API version range the bundle was built against** (section 6.1, class
   5). A bundle **without** a manifest is valid — it is simply activated with
   nothing cached immutably and with the compatibility check recorded as *not
   run*. Degradation, not rejection.

The **transport** form is an archive, because a browser upload is one request
carrying one file; the **installed** form is the directory. The archive is a
wire format and nothing on disk keeps it. Which archive format is a dependency
question rather than a design question — `pkgs/mosd/hack/check.sh` runs
`cargo deny check licenses bans advisories` and `pkgs/mosd/deny.toml` contains no ban
on crates that build C, so the workspace's pure-Rust posture is upheld by
**convention and review**, not by a gate: the only mechanical record of it is
the `tough` pin comment (`pkgs/mosd/Cargo.toml`). The choice is therefore
between an uncompressed tar and a pure-Rust inflate, and is not settled here.

**How the write is made atomic.** Five steps, and the ordering is the mechanism:

1. **Unpack into `/mos/ui/.staging-<generation>/`** — a dot-prefixed name, on
   the **same filesystem** as the target so that step 3's `rename(2)` is atomic
   rather than a copy.
2. **Validate the staged tree completely** — `index.html` present and readable,
   no non-regular entries, manifest parses if present, declared API range
   checked against the version apid serves. Validation runs on the **staged**
   tree and never on the live one, so a rejected bundle has touched nothing an
   operator can see.
3. **`fsync` the staged tree and its parent directory, then
   `rename("/mos/ui/.staging-N", "/mos/ui/bundles/N")`.** The `fsync` is not
   ceremony: without it a power cut can leave a `current` pointer resolving to a
   tree whose data never reached the disk, which is exactly failure class 3 and
   exactly the failure mode the appliance's whole A/B story exists to avoid.
4. **Flip the active pointer.** `/mos/ui/current` is a **symlink** to
   `bundles/N`. It is replaced by creating the new symlink under a temporary
   name and `rename`-ing it over the old one — `rename(2)` over an existing
   symlink is atomic, so there is **no instant at which `current` is absent**.
   A reader either sees the old bundle or the new one.
5. **Prune.** Keep the current generation and the previous one; delete older
   ones.

**A half-uploaded bundle is never served** because nothing under
`/mos/ui/bundles/` is ever the active tree until step 4, the staging directory
is never under `bundles/`, and the asset router resolves `current` and refuses
anything outside the tree it resolves to (4.4 rule 5). The three steps are
independent: unpack can fail, validation can reject, and the rename can be
interrupted, and in each case the previously active bundle is still the active
bundle.

**Keeping two generations** is what makes deactivate-and-reactivate cheap, and
it costs two copies of a bundle on DATA. That is the cheapest place on the
device to spend it: DATA grows to fill the disk
(`rootfs/overlay/etc/fstab.in`) and is already the tier chosen for
unbounded operator data over a 64 MiB STATE, for exactly this kind of reason
(`rootfs/overlay/etc/systemd/system/home.mount`).

**Removal is two operations, and conflating them is a mistake.**

- **Deactivate** — remove the `current` symlink. The bundle stays on disk. The
  device falls back to the built-in UI. This is fast, reversible, and it is
  **the same operation as section 6.3's escape**, which is why it is specified
  here rather than invented there.
- **Delete** — `rename` the bundle directory to `/mos/ui/.trash-<generation>`,
  then unlink recursively. **Never unlink the tree `current` points at**:
  deactivate first, then delete, so a delete interrupted midway cannot leave
  `current` resolving to a partially-removed tree.

**"What is installed right now?"** must be answered **from the served tree, not
from a record of what was uploaded** — otherwise the answer is a claim about the
past rather than a fact about the present, and it will agree with the operator's
expectation at exactly the moment it should disagree. The read resolves
`/mos/ui/current` and reports:

- the generation it resolves to, or **the literal statement that no custom
  bundle is active and the built-in UI is being served** — that state must be a
  named answer, never an empty field;
- the manifest's `name` and `version` if a manifest is present, and *"no
  manifest"* if not;
- whether `index.html` exists and is readable **right now**;
- the digest recorded at activation, and whether it still matches — which is
  how failure class 3 becomes visible (section 6.1);
- whether the compatibility check ran at activation, and its result.

The endpoint's path and response shape belong to section 2 and are **not
specified here**.

### 5.4 Survives-what — **[implemented]**

**Implemented at `pkgs/mosd/apid/src/bundle.rs` and `pkgs/mosd/apid/src/startup.rs`** for
the row that is load-bearing. The third row's mechanism is the `current`
symlink under `/mos/ui` on DATA — created by `Store::point_current_at`, removed
by `Store::deactivate` — and it survives a restart because nothing re-creates
it: `startup::discover` re-reads the pointer on every start and answers "no
bundle" when it is absent. Rows 1 and 2 rest on configuration this campaign did
not change and which is cited in the table itself. **No row's persistence is
exercised on hardware**, and the A/B and factory-reset columns rest on reading
`pkgs/rauc/system.conf.in` rather than on a test — §4's note governs.

Same framing, same columns and same honesty as `docs/design/access.md` §10.4
(`docs/design/access.md`); this table extends that vocabulary rather
than introducing a second one.

| What | Reboot | A/B update | Factory reset |
|---|---|---|---|
| **Custom UI bundles and the `current` pointer** (`/mos/ui`, DATA) | **yes** | **yes** — RAUC writes only the raw `rootfs` slot and the vfat `boot` slot (`pkgs/rauc/system.conf.in`) and never touches DATA | **no**. Not implemented today (`docs/design/access.md`); a whole-disk reflash is the closest real operation, and it replaces DATA with the image's fresh filesystem — with §9.2's precision applying unchanged: blocks beyond the flashed extent are **unreachable, not erased** (`docs/design/access.md`) |
| **The built-in UI** (compiled into `/usr/bin/apid`, inside the verity squashfs) | **yes** | **replaced, which is the point** — the new slot carries the new image's built-in UI, and there is no state to migrate because there is no state | **yes** — a reflash writes an image that contains it. This is the one row a factory reset **restores** rather than destroys, and that asymmetry is the whole of section 6 |
| **The active/inactive choice alone** (`current` removed, bundles kept on disk) | **yes** | **yes** | **no** — the pointer is on DATA with the bundles it points at |

**The third row is load-bearing.** Section 6.3's escape is the removal of
`current`; if that removal did not survive a reboot, an operator who escaped a
broken UI would be back inside it after the next power cycle, and the escape
would not be an escape.

**One honesty the columns cannot express.** A bundle that survives an A/B
update is a bundle that is now talking to a **newer API**. Every "yes" above is
a statement about **bytes**, not about function: the bundle is intact and may
nonetheless be broken, and no file-level property of it changed. That is section
6.1's fifth failure class, and it is the reason section 6.1 requires the
compatibility check to re-run at apid start-up rather than only at install —
the first boot into the new slot is the only moment at which anything on the
device is in a position to notice.

## 6. The safety requirement: the built-in UI and the escape

Markers are per subsection here too; §4's note on what `[implemented]` means in
§§4-6, and on the hardware position it must not be read as, governs this
section unchanged. §6.3's own *"No hardware claim is made anywhere in this
section"* is unaffected by it and stays true.

> **A device whose custom UI is broken, half-uploaded or incompatible must
> remain manageable, and the path back must not depend on why it broke.**

This is a **constraint on sections 4 and 5**, not a recovery bolted onto them.
Every mechanism above was chosen so that this section could be short: assets are
the router's fallback rather than its front door (4.1), so no bundle can shadow
a management path; activation is a rename of an already-validated tree (5.3), so
a half-written bundle is never reachable; the active pointer is one symlink
(5.3), so deactivation is one atomic operation. A UI mechanism that can brick
management is worse than no customisation at all, and the way to avoid building
one is to design the mechanism around this requirement rather than to design a
mechanism and then ask what happens when it fails.

### 6.1 What "broken" covers — **[implemented]**

**Implemented across two layers, which is this subsection's own "detected
when" column.** Classes 1, 2 and 4 are the asset router's, per request, in
`pkgs/mosd/apid/src/assets/serve.rs` — `active_root` answers class 1, `serve_index`
answers class 2 and class 4's index half with the built-in UI, and class 4's
inner-asset half is a 404 for that file and nothing else. Classes 3 and 5 are
start-up's, in `pkgs/mosd/apid/src/startup.rs` — `recheck` re-checks the digest
recorded at activation and evaluates the declared range against
`SERVED_API_VERSIONS` as a **set intersection**, deactivating only on an empty
one and logging the declared range and the served set together. All five
classes are constructed end to end in `pkgs/mosd/apid/src/tests/broken_classes.rs`,
each asserting a distinct state the mechanism reported so that no class can
pass for another's reason, with the set of classes that ran diffed against the
set declared.

**The constraint is implemented as a constraint, not as care.**
`startup::discover` is called from `pkgs/mosd/apid/src/main.rs`, after both
listeners bind (`pkgs/mosd/apid/src/main.rs`) and after `APID_LISTENING` is printed. It
has **no error variant**: every outcome — an unreadable disk, a garbage
manifest, an absent `/mos/ui` — is a `BundleState`, and the work runs on the
blocking pool so that a panic raised below it arrives as a `JoinError` and
becomes a state rather than an unwind through `main`.

**The five classes are disjoint as detectors, not as fixtures.** Classes 2 and
4 are reachable only by a mutation outside the install path, and any such
mutation also moves the tree off its recorded digest — so a class-2 or class-4
tree read at the next start-up is class 3, and the device self-heals to the
built-in UI. That is this subsection's own *"a corruption introduced mid-life is
detected at the next restart"* doing its job; it is recorded because a suite
that drove every fixture through start-up would demonstrate class 3 twice and
report five.

**Class 4's `EACCES` half is not exercised by a root test runner**, which is
what this repository's checks run as: a mode of `0o000` reads straight through
`CAP_DAC_OVERRIDE`. The suite verifies its own construction with the same call
the mechanism makes and substitutes a UNIX socket when the mode did not take,
and the failed-`open` arm proper was run under `setpriv`. Named rather than
claimed.

Five classes. The first four are visible in the filesystem; the fifth is not,
and it is the one that decides the shape of the rest.

| # | Class | Detected by | Detected when | Response |
|---|---|---|---|---|
| 1 | **No bundle installed.** `/mos/ui/current` absent | The asset router, `stat`/`readlink` returning `ENOENT` | Every request, cost of one syscall | Serve the built-in UI. **This is not an error** — it is the shipped state of every device, and it must not be logged as one |
| 2 | **A bundle with no `index.html`**, or whose index is a directory | Install-time validation (5.3 step 2), re-checked at activation | Before the bundle is ever reachable | Rejected at install. If it somehow reaches serving — the tree was mutated outside the install path — the SPA fallback has nothing to return and serves the **built-in UI**, not a 404 and not a 500 |
| 3 | **A malformed or half-written bundle** | Digest recorded at activation, re-checked | apid start-up and activation — **not** per request | Deactivate and serve the built-in UI, logging the mismatch |
| 4 | **A bundle whose files are unreadable** (`EACCES`, `EIO`) | The asset router, at `open` | Every request | **Asymmetric — see below** |
| 5 | **A UI that renders perfectly and cannot talk to any API version apid serves** | Nothing in the filesystem. See below | Activation, **and again at every apid start-up** | Refuse to activate, or deactivate, and say why — **only when the bundle's declared range and §2.1's served set have no member in common** |

**Class 3 is not reachable through the install path, and the two ways it *is*
reachable must be named.** Activation is a rename of a validated tree (5.3), so
the installer cannot produce it. It can arrive by a **power cut** — closed by
the `fsync`-before-rename in 5.3 step 3 — or by an **operator writing into
`/mos/ui` over a root shell**, which cannot be prevented on a device that offers
one and must therefore be *detected*. The honest cost: re-hashing a whole tree
on every request is not affordable, so the digest is checked at activation and
at start-up only. **A corruption introduced mid-life is detected at the next
restart, not immediately.** That is a real gap and it is stated rather than
papered over; the alternative — a filesystem watch — trades a permanent cost
for a case an operator caused with a root shell.

**Class 4 is asymmetric, and the asymmetry is deliberate.** An unreadable
**`index.html`** falls back to the built-in UI. An unreadable **inner asset**
returns 404 for that asset and nothing else changes. A UI missing one image is
still a working UI, and swapping the whole interface out from under an operator
mid-session because one file failed to open would be a worse outcome than the
missing image. **The fallback trigger is the index, not any file.**

**Class 5, the hard one.** Every file-level check passes. Every asset returns
200. The operator sees a rendered, professional-looking page on which every
button fails. No amount of inspecting the filesystem finds anything wrong,
because nothing is wrong with the filesystem.

*Who detects it.* Three candidate detectors, and only one of them actually
works:

- **The bundle itself.** It knows what it was built for. But a bundle that
  cannot talk to the API cannot be trusted to report that it cannot, and a
  bundle broken badly enough not to execute reports nothing at all. Necessary,
  never sufficient.
- **apid, at activation, from the manifest.** The bundle declares the API
  version range it was built against (5.3), and apid refuses to activate a
  bundle whose declared range and apid's **served set** have **no member in
  common**. The served set is the `versions` array of `GET /api/versions`
  (§2.1); **the relation is set intersection, not equality**, and the trigger
  is an *empty* intersection and nothing else. §2.1 recommends that apid serve
  the outgoing major version alongside the new one for at least one image
  generation, precisely so that a bundle built against the outgoing version
  keeps working across the update; a check written as equality against the
  served set's `current` member would reject exactly those bundles. **This
  is the one that works**, because it runs *before* the bundle is ever served
  and does not depend on the bundle executing. Its cost is honest and bounded:
  it depends on the manifest being present and truthful. A bundle with no
  manifest cannot be checked, so the correct behaviour is to activate it and
  **record that it was activated unchecked** (5.3's read reports exactly this).
- **apid, at request time, from a version the client sends.** This prevents
  nothing. It makes the failure **legible** — a client whose expected version
  does not match gets a distinguishable error instead of a confusing one — and
  legibility is what an operator staring at a broken page actually needs.

*The case that escapes activation-time checking, and how it is closed.* The
bundle was checked against the API version apid served **then**. An A/B update
replaces the rootfs and therefore the API, the bundle survives on DATA (5.4),
and nothing re-runs the check. **So the compatibility check must re-run at apid
start-up, not only at install.** On the first boot into the new slot, apid
re-evaluates every activated bundle's declared range against its **served set**
and deactivates a bundle **only when that intersection is empty**, logging both
the declared range and the served set it was compared against. A bundle whose
range still contains any served member stays active — **including one that
matches only the outgoing major**, which is §2.1's dual-major recommendation
doing the work it exists for. That is the mechanism that closes the gap
section 5.4's table opens.

*Why the exact relation carries more weight here than anywhere else in this
document.* This is the safety section, and class 5's response is the only one
that removes a working interface without the operator asking for it. **An
escape hatch that fires on the wrong condition is worse than one that does not
exist, because the operator will trust it**: they are told the bundle was
incompatible, they believe it, and the bundle that was in fact fine is gone
along with the reason to look further. Equality against a single version is
that wrong condition, and the deactivation it produces is indistinguishable —
from the operator's side — from a correct one. Recording the served set in the
log line is what makes the two distinguishable after the fact.

*One constraint on where that evaluation may happen, and it is not negotiable.*
apid's `main` propagates every startup step with `?` —
`config::Config::from_env()?` (`pkgs/mosd/apid/src/main.rs`),
`tls::ensure_state_dir(...)`,
`tls::load_or_generate_certificate(...)?`,
`tls::load_or_generate_session_key(...)?` — all **before** the
listeners bind in `pkgs/mosd/apid/src/main.rs`, and the unit is `Restart=on-failure`
(`pkgs/mosd/dist/apid.service`). A startup error therefore becomes a **crash loop
with no listener bound**, which is precisely the failure this section exists to
prevent. **Bundle discovery and evaluation must happen after the listeners bind
and after `APID_LISTENING` is printed (`pkgs/mosd/apid/src/main.rs`), and every
possible outcome must be a state the daemon holds, never an error it returns.**
A bundle must not be able to stop apid from listening. That is the actual safety
property, and it is stronger than any escape path.

The concrete shape of the version token, the handshake header and the error body
belongs to sections 2 and 3; the shape of the served set is fixed by §2.1's
`GET /api/versions` and is not re-specified here. This section states the
**requirement** only.

### 6.2 The built-in default UI, inside verity — **[implemented]**

The built-in UI is a React/Vite SPA whose generated output is
`_out/apid-ui/dist`. It is reachable unconditionally at `/_ui` and `/_ui/`;
safe extensionless paths below `/_ui/` use its own `index.html`, while exact
assets and misses never consult `/mos/ui`. When no usable custom bundle is
active, `GET /` redirects to this recovery UI rather than copying its bytes into
the root namespace.

**Where it lives in the image: it is a virtual tree inside one binary.**
`pkgs/mosd/apid/build.rs` requires the absolute generated directory through
`MOS_APID_UI_DIST_DIR`, recursively walks it, rejects symlinks, non-files and
unsafe logical names, requires `index.html`, sorts the paths, copies accepted
bytes into Cargo's `OUT_DIR`, and generates an `include_bytes!` table there.
`pkgs/mosd/apid/src/assets/builtin.rs` includes that table and performs binary
search lookup. The running device reads no built-in UI directory, archive or
locale endpoint; every hashed JavaScript, CSS and imported asset is covered by
the same `apid` binary as the stable HTML entry.

The frontend producer always uses the repository's pinned Bun container before
the Rust/image build and leaves the result in ignored `_out/apid-ui/dist`.
`pkgs/mosd/apid/ui/build.sh` mounts only UI source at `/source:ro`, copies it to
the writable `_out/apid-ui/work` mount, and confines dependency installation,
code generation, compiler metadata and Vite output to that build root. Complete
target and package-producer builds invoke it before Cargo, mount the resulting
tree at `/build/apid-ui:ro`, and pass that absolute path explicitly. Their
repository source mount is also read-only; `CARGO_TARGET_DIR` is a separate
writable mount. `pkgs/mosd/apid/ui/run.sh` reuses the same container path in
check mode for install, lint, typecheck, tests and a fresh production build.
Cargo separately fails closed if the generated tree lacks the entry or contains
a path the embedded VFS cannot safely name. There is no fixed file count,
committed build output or Rust source edit when a content hash changes.

The VFS keeps each asset independently addressable and cacheable. The stable
entry and SPA fallbacks are `no-store`; Vite's content-hashed `assets/` output
is immutable for one year; any other embedded file is `no-cache`. MIME remains
a fixed allowlist and every built-in response carries `nosniff`, CSP and a
no-referrer policy. Route components and the Simplified Chinese catalog are
lazy chunks, but remain local, verity-covered resources.

**How it gets there.** The `mosd` producer builds `apid` and packs it as the
`mos-apid` package: `/usr/bin/apid` mode `0755`,
`/usr/lib/systemd/system/apid.service`, and the
`multi-user.target.wants/apid.service` symlink **as payload** rather than as a
`systemctl enable` anything runs (`pkgs/mosd/deb/mosd/Dockerfile`). The
composition installs that package out of the pool, and the
binary is then part of the tree that `rootfs/build.sh` packs into the
squashfs and covers with the dm-verity hash tree
(`docs/design/ro-root.md`).

**What guarantees an upload path can never write to it.** Three layers, and
naming which one is load-bearing matters more than the count:

1. **Load-bearing: dm-verity.** `/` is a squashfs assembled by the kernel from
   `dm-mod.create=` and mounted read-only, with no fstab entry that could remount
   it (`rootfs/overlay/etc/fstab.in`, `docs/design/ro-root.md`). A
   write to `/usr/bin/apid` fails at the block layer, not at a permission check.
   **This holds even though apid runs as root** — the unit sets no `User=` line
   (`pkgs/mosd/dist/apid.service`), so root is exactly what would be writing,
   and it still cannot. Nothing an operator uploads can reach the built-in UI,
   because nothing on the running system can.
2. **Real but not load-bearing: the bundle root is on a different filesystem.**
   `/mos/ui` is on DATA (5.2), every install-path write is confined to it, and
   4.4's canonicalise-and-assert bounds the *read* path to the same resolved
   tree.
3. **Absent, and named as absent: there is no systemd sandboxing.**
   `pkgs/mosd/dist/apid.service` is the entire `[Service]` section — `Type=`,
   `ExecStart=`, `Restart=`, `StateDirectory=`. No `ProtectSystem=`, no
   `ReadWritePaths=`, no `ReadOnlyPaths=`. So layer 1 is not merely the
   strongest layer, it is the **only** one protecting the binary, and off a
   verity root there is nothing at all — which is not hypothetical, because
   `APID_STATE_DIR` exists precisely so the daemon runs off-device
   (`pkgs/mosd/apid/src/config.rs`) and that is how the crate's tests run. This
   is a real gap, and is not counted as covered here.

**A customer's own UI still owns its toolchain.** A custom bundle remains an
opaque, validated directory under `/mos/ui`; whether a customer produced it
with a bundler, compiler, Makefile or by hand is invisible to the device. The
built-in SPA's build chain is a repository concern and does not become a
runtime dependency or a requirement imposed on custom bundles.

### 6.3 The deterministic way to reach it — **[implemented]**

**Implemented at `pkgs/mosd/apid/src/routes.rs`** — `/_ui` is a nested router
that claims the complete built-in namespace and never consults `/mos/ui`.
Both `/_ui` and `/_ui/` answer the stable embedded entry; descendants are handled
only by `pkgs/mosd/apid/src/assets/builtin.rs`. The root custom UI cannot shadow
this prefix even if its bundle contains an identically named `ui/` tree.

Deactivation is now an authenticated, CSRF-protected API action at
`DELETE /api/v1/ui/active`, not a form under the recovery prefix. The built-in
System page calls that API and the unconditional `/_ui/` URL remains usable
whether the custom bundle is active, absent or malformed. A crawler or ordinary
GET cannot change the active UI.

The requirement, restated as a test the mechanism must pass:

> **There is one documented action whose outcome does not depend on why the
> custom UI failed.** If the operator has to know the cause in order to choose
> the action, the mechanism has already failed.

Three candidates, evaluated.

**(A) A reserved path the asset router can never shadow.** A prefix — call it
`/_ui/` — served by the built-in VFS. 4.1's precedence rule makes it
unshadowable **structurally**: axum matches declared routes before consulting
the fallback, so no bundle content can occupy the prefix, and this is true
because of how dispatch works rather than because of a check.

- **Deterministic for classes 1-4: yes.** The built-in handlers do not read
  `/mos/ui` at all, so no bundle state — absent, corrupt, unreadable, wrong
  version — can affect them.
- **Class 5: yes, by definition.** Class 5 means the UI *renders*, so the
  listener is up and the prefix answers.
- **Costs.** It burns a path prefix permanently, and it only helps an operator
  who knows the URL. The product and UI-selection response therefore document
  `/_ui/` as the recovery address. The cost that must not be glossed: **(A) is a
  way *in*, not a way *out*.** It deactivates nothing, so the next navigation
  to `/` still selects the custom bundle.

**(B) An override that disables the custom UI and survives a reboot.** Removing
`/mos/ui/current` — 5.3's *deactivate*.

- **Deterministic: yes, and it is the way *out*.** Afterwards `/` redirects to
  the built-in `/_ui/`, by 4.1's `/` rule.
- **Survives a reboot: yes.** The pointer is on DATA, and 5.4's third row
  asserts exactly this.
- **Cost, and it is decisive:** it requires an action the operator can only take
  through the API or a shell — that is, it **presupposes the access that may be
  broken**. It cannot be the only mechanism.

**(C) A boot-time or hardware escape** — a kernel cmdline flag, a recovery
button.

- **Rejected.** The cmdline is generated into the verity target
  (`docs/design/ro-root.md`) and is not operator-editable on a device, and
  `docs/design/uboot-ab-handshake.md` records that this board ships no
  `button recovery` and no `PREBOOT` rockusb entry. There is no shipped hardware
  escape to hang this on; inventing one is a bootloader change, not a daemon
  change, and it would be a large cost for a case (A) and (B) already cover.

**Chosen: (A) and (B) together, and neither alone.** (A) is the way in and
depends on nothing but the listener; (B) is the way out and becomes reachable
once (A) is. Concretely: **the built-in UI at `/_ui/` carries a System action
that performs authenticated API operation (B).** One documented action — *go
to `https://<device>/_ui/`* — reaches a working UI regardless of which of the five
classes occurred, and the deactivate action returns `/` to that UI. **The
operator never has to diagnose anything**, which is the test this subsection
opened with.

**What if the operator cannot reach the API either?** The unflattering version,
because a comfortable one here would be worthless:

- **Under this design, a bad bundle cannot take the listener down.** 6.1's
  constraint puts bundle discovery and evaluation *after* the listeners bind
  (`pkgs/mosd/apid/src/main.rs`) and makes every bundle outcome a state rather
  than an error return. So the realistic causes of an unreachable API — a crash
  loop, a bind failure, a network misconfiguration — are **not caused by the UI
  mechanism**. That is the actual safety claim, and it is stronger than any
  escape path, because it means the escape path is rarely the thing standing
  between the operator and the device.
- **If the listener is down anyway, the escape is a shell, and
  `docs/design/access.md` §9.1 is blunt about what that is worth.** SSH is off
  by default (`pkgs/mosd/mosd-settings/src/model.rs`, `enabled: false`), root
  is passwordless-locked, and the serial console does spawn a getty that has *no
  account which will accept a credential* (`docs/design/access.md`). An
  operator who enabled SSH and installed a key **before** the failure can
  `rm /mos/ui/current` and restart apid — that is a real path, and it is exactly
  as available as SSH was, which is: only if it was arranged in advance. An
  operator who did not is in §9.1's position, and the only remedy is a
  whole-disk reflash (`docs/design/access.md`) — which also clears the
  bundle, because DATA is replaced.
- **The honest summary: this design does not add a new way to be locked out,
  and it does not remove the existing one.** §9.1's lockout is unchanged by
  everything in sections 4-6. That is the accurate claim and the strongest one
  available; anything stronger would be a claim about SSH defaults or about
  recovery hardware, and neither is this document's to make.

**No hardware claim is made anywhere in this section.** Nothing described here
has been run on a device; every statement is a reading of source, of a unit
file, or of a design document, and each is cited as such.

### 6.4 Why this is the same reasoning that split mosd and apid — **[implemented]**

The marker refers to the split itself, which exists: two units
(`pkgs/mosd/dist/mosd.service` → `/usr/bin/mosd`, `pkgs/mosd/dist/apid.service` →
`/usr/bin/apid`), two binaries delivered as two separate packages — `mosd` and
`mos-apid` from one producer (`pkgs/mosd/deb/mosd/Dockerfile`) — ordered
`After=network.target
mosd.service` (`pkgs/mosd/dist/apid.service`). What this subsection adds is the
argument, not a mechanism.

**The reasoning, and the code it rests on.** mosd treats first-boot
provisioning as a hard failure on purpose, and the code says why in as many
words: *"Hard failure on purpose: an unwritable STATE means no device identity
and no device credential, so there is no usable device to serve. A loud exit is
better than a daemon that quietly serves an unprovisioned tree the operator
cannot log in to."* (`pkgs/mosd/mosd/src/main.rs`, with the `?`).
A single-process design would make that exit take the UI with it: a provisioning
failure would leave a device with no diagnostic surface at all, reachable only
by serial console. Two processes are what keep the exit loud and the device
still explainable.

**The principle, stated once: the component that explains a failure must not be
the component that failed.** dashboard.md applies it to processes — mosd may
exit hard *because* apid is a different process and survives to render the 502
page *"The management daemon is unavailable."* (`pkgs/mosd/apid/src/routes.rs`,
reachable because the bus client connects lazily and drops its cache on error,
`pkgs/mosd/apid/src/bus_client.rs`).

**Section 6 applies the same principle one layer up, to the UI.** The custom UI
may fail *because* the built-in UI is a different artifact with a different
lifecycle at every level:

| | Custom UI | Built-in UI |
|---|---|---|
| Form | A directory tree unpacked at runtime (5.3) | Compiled into the binary (6.2) |
| Filesystem | DATA, writable (5.2) | Verity squashfs, unwritable by anything (6.2 layer 1) |
| Changed by | An operator's upload | An A/B update only |
| Reached at | `/`, and only when active (4.1) | A reserved prefix the asset router structurally cannot serve (6.3 option A) |

Four independent axes. A failure on any one of them leaves the other artifact
untouched, which is the same shape as two processes with a privilege boundary
between them — one layer up.

**What it would mean to get this wrong.** Exactly the merge dashboard.md
refused, in UI form: a device where the only way to see that the UI is broken is
the broken UI. The concrete version is tempting and should be named so nobody
proposes it later: *ship the built-in UI as a bundle at `/mos/ui/builtin` and
serve both through one asset pipeline.* It looks cheaper — one code path instead
of two rendering strategies, and the default UI becomes replaceable by the same
mechanism as everything else. It is the same trade dashboard.md scored and
rejected: a DATA-level fault — a bad unpack, a filesystem error, an
`rm -rf /mos/ui` — would take **both** UIs at once, and the operator's
diagnostic surface would then have precisely the single point of failure as the
thing being diagnosed. It converts a recoverable failure into
`docs/design/access.md` §9.1's unrecoverable one, for the sake of one fewer code
path.

**One asymmetry, because the analogy is not perfect and pretending otherwise
would weaken it.** mosd's hard exit is a *choice its authors made*, in a failure
mode they enumerated. A custom UI's failure is *imposed by an operator's upload*,
in failure modes nobody enumerated. That makes section 6's requirement
**stricter** than dashboard.md's, not looser: mosd's fallback may be conditioned
on recognising the failure, because the set of failures is known. A bundle's
cannot be. Which is exactly why 6.3 requires a mechanism whose outcome does not
depend on the cause, and why 6.1's constraint forbids the daemon from ever
turning a bundle problem into a startup error.

## 7. Trust: who may install a UI — **[proposed]**

Section 5.3 specifies the on-disk install mechanism and takes no position on
authorisation. This section answers that question, and it answers it against the
channels that exist rather than against the ones a security review would like to
exist.

### 7.1 The channels that actually exist — **[implemented]**

Measured at `86cd669`. The marker is **[implemented]** because every row below is
a reading of the shipped tree, including the rows that record an **absence** —
an absence measured four ways is a fact about the device, not a proposal.

| Channel | Exists at `86cd669`? | Reaches `/mos/ui`? | Credential | Signed? |
|---|---|---|---|---|
| **The API upload path** | **no** — `grep -rn Multipart pkgs/mosd/` returns nothing; §5.3's transport is proposed and the request that drives it belongs to §2.3/§3 | would, by construction | §3.2's bearer token, or an authenticated session (§3.2's bootstrap) | nothing exists to sign against — see 7.3 |
| **SSH** | **yes**, but **off by default on both image profiles** (`pkgs/mosd/mosd-settings/src/model.rs`; `docs/design/access.md`), enabled only by an authenticated admin action through apid | **yes** — a shell writes the directory directly, with no involvement from apid at all | an authorized key, **every one of which is a root key** (`docs/design/access.md`; the pane says so and a test asserts the sentence, `pkgs/mosd/apid/src/routes.rs`, `pkgs/mosd/apid/src/tests.rs`) | n/a |
| **A RAUC bundle** | **yes**, as an update mechanism | **no.** RAUC declares four slots — `rootfs.0` (`pkgs/rauc/render-config.sh`), `rootfs.1`, `boot.0` and `boot.1`. DATA is not among them, and the survives-what table records the same from the other side (`docs/design/access.md`; §5.4) | n/a | **yes** — CMS, verified by `rauc` against `/etc/rauc/keyring.pem`, `plain` format refused (`pkgs/rauc/system.conf.in`) |
| **A factory image** | **yes**, but it ships DATA **empty.** In `build/src/mkimage-cx3576.ts`, `dataImg` is created with `makeExt4` without a `seedDir`, then written into the image. Nothing mounts it and nothing copies into it. From the verifier's side the consequence is that an assertion about `/mos/ui` becomes owed only if the image ever ships something under `/mos/ui` | not today; it would need new work in the image pipeline | n/a | the image is not signed; the **bundle** built from it is |
| **The serial console** | **yes** — a getty spawns on both profiles | **no.** It *"has no account that will accept a credential"* (`docs/design/access.md`) | none that works | n/a |

**The count that matters.** Of five candidate channels, exactly **one reaches
`/mos/ui` on a shipped device today, and it is root**. A RAUC bundle
structurally cannot: it can replace the *built-in* UI, because that is compiled
into `/usr/bin/apid` inside the rootfs slot (§6.2), and it cannot install a
custom one. A factory image could, but does not. The console cannot. **The only
new channel this proposal creates is the API upload path**, and every trust
question in this section is about that one row.

### 7.2 The honest baseline: anyone with SSH is already root — **[implemented]**

`docs/design/access.md` §4.1 states it without qualification: *"Every authorized
key is a root key"*, and `mos` is *"a persistent working directory and a non-root
default shell, **not a lesser privilege level**"*
(`docs/design/access.md`). apid runs as root — the unit sets no `User=` line
(`pkgs/mosd/dist/apid.service`), and the D-Bus policy records the same fact from
the other side (`pkgs/mosd/dist/com.mos.mosd.conf`), with root allowed to own,
send and receive (`pkgs/mosd/dist/com.mos.mosd.conf`).

So an operator with SSH:

- writes `/mos/ui/bundles/N` and re-points `current` with two shell commands,
  bypassing every validation §5.3 specifies — no unpack check, no manifest
  parse, no digest, no compatibility check;
- and **does not need to**. They read `/var/lib/mos/settings.toml` directly, they
  read `/var/lib/mos/apid/session.key` and mint a valid session cookie (§4.4,
  `pkgs/mosd/apid/src/session.rs`), and they call `com.mos.mosd1` without going
  through apid at all.

**A signature on a UI bundle stops none of that.** A verifier is code that runs
on the device; the person with root owns the device's code, the keyring it would
check against, and the daemon that would do the checking. Any scheme whose
threat model includes local root is describing a property it cannot have. §3.3
reaches the same conclusion for the API token — *"Anyone with SSH is already
root, so none of this applies to them"* — and this section does not weaken it.

Note also that §6.1 has **already accepted** the consequence: failure class 3
names *"an operator writing into `/mos/ui` over a root shell"* as one of the two
ways a corrupt bundle arrives, and the response is **detection at the next
restart, not prevention**. A signature checked at activation says nothing about
a tree mutated afterwards, and re-verifying one per request has exactly the cost
§6.1 already rejected for re-hashing.

The real question is therefore narrower than "should bundles be signed", and
stating it narrowly is what makes it answerable:

> **Does the API upload path need a signature that the SSH path structurally
> cannot have — and if so, what does that signature buy that the credential on
> the upload request does not already imply?**

### 7.3 The signing machinery this project already has, having read it — **[implemented]**

Two independent bodies of signing code exist in this repository. **Neither is
reusable here**, and the reasons are different, which is why the answer has to
come from reading them rather than from their names.

**RAUC's CMS bundle signature.** Bundles are signed at build time by
`rauc bundle` with the material `make os-devkeys` generates (`Makefile` →
`pkgs/rauc/gen-dev-keys.sh`): an OpenSSL CA plus a signer certificate, explicitly
**development-only**, gitignored, and carrying a banner that says so
(`pkgs/rauc/gen-dev-keys.sh`). On device, verification is `rauc`'s,
against `/etc/rauc/keyring.pem`, with `plain`-format bundles refused by
configuration (`pkgs/rauc/system.conf.in`). Three reasons it does not
transfer:

1. **The trust anchor does not exist on any device.** The keyring is *"NOT
   shipped by this task and NOT in git"*, and *"until
   one is installed, `rauc install` on device fails closed"*
   (`pkgs/rauc/system.conf.in`). The
   image verifier asserts only that no keyring is baked into the packed root,
   and records why in as many words: *"Absence is the shipped state; rauc
   install fails closed until one is provisioned"*
   (`verify/src/checks-root.ts`). A UI-bundle verifier would need an
   anchor that no shipped device has.
2. **The verification is `rauc`'s, not ours.** No Rust in this workspace verifies
   a CMS signature — `pkgs/mosd/apid/Cargo.toml` carries no signature crate
   (`rustls` and `rcgen` are TLS, `sha2` is a bare digest). Reusing it means
   shelling out to `rauc`, and the crate's own rule forbids precisely that:
   *"mosd owns every system action: apid never spawns a process and never talks
   to systemd itself"* (`pkgs/mosd/apid/src/settings_api.rs`).
3. **The key hierarchy is the wrong one even if it were reachable.** It is the
   fleet's OS-image signer. Signing a customer's HTML with the key that
   authorises a kernel and rootfs replacement makes the two operations equally
   trusted, which is backwards.

**The TUF skeleton (`pkgs/rauc-sign`).** `rauc-sign` is its own
cargo workspace of exactly one member, extracted from the mosd workspace by
The split means the two dependency graphs are separate and `cargo clippy
--workspace` run from `pkgs/mosd/` no longer reaches this crate
(`pkgs/rauc-sign/Cargo.toml`). It is built on `tough` pinned at
`=0.18.0` (`pkgs/rauc-sign/Cargo.toml`). It is **build-host tooling**: it *"runs on a build
host, never on a device, and its output is static content"*
(`pkgs/rauc-sign/README.md`). It is not installed into the image at all —
`grep -rn "mos-sign\|update/sign" os/` returns nothing at `86cd669`. And its
README names the missing half without being asked: the **on-device Uptane
client** is named as *"Explicitly out of scope for the whole crate"*
(`pkgs/rauc-sign/README.md`). Its own README also records that RAUC's CMS signature
*"is a separate key hierarchy"* (`pkgs/rauc-sign/README.md`), so the two bodies of
machinery do not compose with each
other either.

**The conclusion, from reading rather than from the names: at `86cd669` there is
no on-device signature verification of anything, for anything.** The repository
half of a signing story exists; the device half does not. A signed UI bundle
would be the **first** artifact this device ever verified, and it would have to
bring its own verifier, its own dependency and its own trust anchor with it.

### 7.4 Recommendation — **[proposed]**

> **The API upload path is authorised by §3.2's bearer token or by an
> authenticated session. The bundle is not signed in phase 1. The budget that a
> signing scheme would consume is spent on validation, blast-radius reduction
> and the §6 escape instead.**

**The reason, in one sentence.** A bundle signature would have to be checked by
a verifier the device does not have, against an anchor the device does not ship,
in order to constrain an operator who — holding the credential that authorises
the upload — can already add a root key and power the appliance off; so in phase
1 it removes nothing an attacker can do, and it charges a key ceremony to an
operator who wants to serve one HTML file.

The argument in full, as three claims that can each be checked:

1. **A signature and the upload credential authorise the same blast radius.** A
   caller holding a token can `POST /api/v1/actions/poweroff`,
   `PUT /api/v1/settings/access.ssh.enabled` and
   `POST /api/v1/ssh/authorized-keys` (§2.3) — and the last of those is a root
   key (`pkgs/mosd/apid/src/routes.rs`). §3.2 states there are **no scopes in
   phase 1**. An attacker who can upload a bundle can already install a root
   key; requiring them to sign the bundle does not take the root key away.
2. **A signature does not defend what a bundle actually threatens.** A bundle's
   blast radius is *content served on the management origin*. What bounds it is
   §4.3's `nosniff` on every response plus a fixed MIME allowlist, §4.4's
   install-time rejection of non-regular entries, and §5.3's validate-then-
   rename — and every one of those bounds a signed bundle and an unsigned bundle
   **identically**. A signature attests who built the artifact, not what it does,
   and in the phase-5 population the builder and the uploader are the same
   person.
3. **The threat signing answers is a supply chain mos does not have.** Signing
   pays when an artifact travels: a vendor builds it, a mirror carries it, a
   fleet installs it. Today the bundle goes from the operator's laptop to the
   operator's own device over one TLS connection. Building for the distribution
   model before it exists produces key material nobody rotates.

**What this leaves open — three items, none of them hidden.**

- **A stolen token installs a UI, and the UI outlives the revocation.** §3.3
  item 2 already records that a stolen token is full management access
  indefinitely. What this section adds is worse in one specific way:
  **`DELETE /api/v1/tokens/{id}` does not deactivate a bundle that token
  installed.** The bundle is on DATA and survives an A/B update (§5.4), so
  revocation removes the attacker's ability to upload *again* and removes
  nothing they already uploaded. The mitigation is not a signature — it is that
  §5.3's *"what is installed right now?"* read answers **from the served tree**,
  so a suspected compromise has one place to look. A revocation runbook must
  therefore say *"and check `/mos/ui/current`"*.
- **There is no provenance record at all.** After an upload, nothing on the
  device says who uploaded it, from where, or when. §3.3 already records that
  nothing in the crate logs which credential served a request. §5.3's read
  reports the digest and the manifest — both of which the uploader chose. So
  "which bundle is this?" is answerable and "who put it here?" is not.
- **An on-path attacker under §3.3 item 1 can substitute a bundle.** The
  certificate is self-signed with SANs that do not match the address operators
  actually use (`pkgs/mosd/apid/src/tls.rs`), so clients are configured to skip
  verification and the token is captured on first use. **Of the three items,
  this is the only one a signature would close**, and it would close it only
  because the anchor would have been provisioned out of band — which is the same
  out-of-band channel that would have fixed the certificate.

**What would trigger revisiting — four conditions, each mechanically
checkable.**

1. **A production keyring is provisioned on devices.**
   `pkgs/rauc/system.conf.in` records that this is out of scope and that
   `rauc install` fails closed until it happens. The moment it does, a trust
   anchor and an anchor-provisioning process both exist, and the marginal cost
   of a second verifier collapses. Check: `test -f /etc/rauc/keyring.pem` on a
   shipped image.
2. **A bundle is distributed by anyone other than the operator who installs
   it** — a vendor UI, a partner skin, a marketplace. That is claim 3's
   condition, stated as an event rather than as a worry.
3. **Scopes arrive.** If §3.2's "no scopes in phase 1" is revisited so that a
   token can upload a UI *without* being able to add a root key, claim 1 stops
   holding and a signature starts buying a real difference. Note the cost of
   that path: scopes need the per-method D-Bus allowlist that
   `pkgs/mosd/dist/com.mos.mosd.conf` deliberately deferred.
4. **The on-device Uptane client is implemented and shipped**, verifying from
   anchors baked into the image (`pkgs/rauc-sign/README.md`). Once a device
   verifies TUF metadata for one artifact class, extending it to a second is
   incremental rather than novel.

**And what signing would cost, priced now so that the decision is not
re-litigated from zero.** If it is adopted:

- **Key material and custody.** A signing key pair, and a device-side trust
  anchor. The private half is held by whoever builds the UI — for the customer
  shipping their own HTML, that is the **customer**. So either mos signs
  customer bundles, and mos becomes a signing service and an approval
  bottleneck, or each device trusts a per-customer anchor that somebody must
  provision. Provisioning that anchor is itself a privileged operation over the
  same channel whose trust is in question. **That circularity is the real cost**,
  and it is why this is not a small feature.
- **Where the anchor lives.** It is a credential, so §3.2's reason 1 applies
  unchanged: the settings tree on STATE, which means a schema bump and a
  migration (§8.2 phase 2 shows the shape), not a file dropped into `/etc` —
  *"An unmodelled setting is an unsupported setting"*
  (`docs/design/access.md`).
- **Code and dependency.** A signature verifier inside a root-privileged,
  network-facing daemon, plus whatever crate carries it. `pkgs/mosd/deny.toml` bans no
  C-building crate and `pkgs/mosd/hack/check.sh` checks only licenses, bans and
  advisories, so the workspace's pure-Rust posture would be upheld by
  review rather than by a gate at exactly the moment it mattered most.
- **Operator cost.** The operator who wants to serve one HTML file now needs a
  key, a signing step, and a way to get an anchor onto a device. §6.2's
  asymmetry — *"A customer's own UI is their toolchain, not ours"* — stops being
  true the moment mos mandates a step inside that toolchain.

**Where phase 1 spends instead — five controls, all already specified above,
none of which needs a key.**

1. Install-time rejection of every entry that is not a regular file or a
   directory (§5.3 requirement 2; §4.4 rule 5's primary mitigation).
2. Canonicalise-and-assert against the resolved bundle root at serve time
   (§4.4).
3. `X-Content-Type-Options: nosniff` on every asset response plus a fixed MIME
   allowlist, so an uploaded file cannot be sniffed into HTML on the management
   origin (§4.3).
4. Validate-then-rename, so a rejected bundle is never reachable and the
   previously active bundle stays active (§5.3).
5. The built-in UI at a prefix the asset router **structurally** cannot shadow
   (§4.1 rule 1, §6.3 option A), so a hostile bundle cannot hide the control
   that removes it.

**And one control that is absent and must not be counted as present.**
`pkgs/mosd/dist/apid.service` is the whole `[Service]` section. It sandboxes
the daemon in the directions that cost nothing to a root network listener —
`NoNewPrivileges=`, `ProtectHome=`, `PrivateTmp=`, `MemoryDenyWriteExecute=`,
`RestrictAddressFamilies=` — and it carries no `ProtectSystem=` and no
`ReadWritePaths=` (§6.2 layer 3). So nothing at the process level bounds what
the upload handler can write, and dm-verity does not help, because §4.4 already
established that verity protects integrity and not confidentiality and a write
outside `/` is not a write to `/`. The fix belongs in
`pkgs/mosd/dist/apid.service`, and **this section endorses it as the concrete
substitute for signing** — it is cheaper, it needs no key material, and it bounds a real
class of bugs rather than attesting an authorship nobody disputes.

**Recommendation, restated in one line, because a section like this must end
with an answer and not with a survey: do not sign UI bundles in phase 1;
authorise the upload with §3.2's token, spend the effort on `ProtectSystem=`
and `ReadWritePaths=` in `pkgs/mosd/dist/apid.service`, and revisit the moment any
one of the four triggers above becomes true.**

## 8. Migration and phasing — **[proposed]**

### 8.1 What happens to today's server-rendered pages — **[proposed]**

**First, the fact this subsection is a decision about.** Measured at `86cd669`:
apid's pages are `maud` `html!` expansions compiled into the `apid` binary, with
one inline stylesheet constant and no external asset of any kind
(`pkgs/mosd/apid/src/routes.rs`; §1.1 constraint 1 and §1.6
evidence it four ways). There is no build chain to retire and no asset directory
to move.

**And the question §6.2 leaves for this section, answered concretely: yes, the
built-in UI that §6.2 says ships inside verity IS today's maud pages.** §6.2
measures exactly that — the built-in UI is compiled into the `apid` binary —
and identifies how it gets inside the verity squashfs
(`pkgs/mosd/deb/mosd/Dockerfile` packs it as `mos-apid`;
`rootfs/build.sh` composes and packs the root). No second
artifact is proposed anywhere in §6 and none is needed. What this section adds
is not a new artifact; it is **where those pages are reachable, and when they
move**.

Three options, all three costed, one chosen.

| Option | What it means | What it costs | Verdict |
|---|---|---|---|
| **A — they become the default static UI** | render the maud output into a bundle, ship it at `/mos/ui/builtin`, and serve built-in and custom through one asset pipeline | §6.4 names this exact proposal — *"ship the built-in UI as a bundle at `/mos/ui/builtin` and serve both through one asset pipeline"* — and rejects it, because a DATA-level fault (a bad unpack, a filesystem error, an `rm -rf /mos/ui`) takes **both** UIs at once and converts a recoverable failure into `docs/design/access.md` §9.1's unrecoverable one | **Rejected**, and recorded here only so that §8 does not reintroduce by scheduling what §6.4 rejected by argument |
| **B — they remain, as the built-in fallback alongside a custom UI** | the maud handlers keep existing and keep being compiled into the binary; they become reachable at §6.3's reserved prefix; `/` becomes conditional per §4.1 | two rendering strategies in one binary, indefinitely; and every new management capability must be built twice — a maud pane and an API route — or the built-in UI falls behind the API | **Chosen** |
| **C — they are retired** | delete the maud handlers once a default bundle exists | §6 loses its fallback entirely: a device with a broken bundle has nothing to fall back to, which is the requirement §6 opens with. It also strands §3.2's token bootstrap, which is specified as *"a new pane in the built-in UI"* and is the only non-circular way to mint the first token | **Rejected** — it deletes the mechanism §6 exists to provide |

**Option B's cost is real and this section pays it down rather than waving at
it.** "Every capability twice" is only true if the built-in UI is required to
reach parity with the custom one. It is not, and saying what it *is* required to
do is the decision that makes B affordable:

> **After phase 4, the built-in UI's job is recovery, not management.** It must
> be able to (i) report which bundle is active, answering from the served tree
> (§5.3); (ii) deactivate it (§6.3 option B); (iii) mint and revoke an API token
> (§3.2's bootstrap); (iv) set the hostname and configure one interface; and
> (v) enable SSH and add an authorized key. Those five make a device
> recoverable. **Any capability beyond those five may live only in the API and
> in whatever UI a site builds on it**, and the built-in UI falling behind on
> them is not a defect.

Items (iv) and (v) already ship through the hostname, network, and SSH handlers
in `pkgs/mosd/apid/src/routes.rs`. Items (i), (ii) and (iii) are new panes, and
they are the only built-in-UI work any phase below schedules.

**One contradiction between sibling sections, named here and reconciled here
rather than by editing either.** §2.1 says *"existing HTML paths (section 1.2)
keep their method, their path and their behaviour unchanged"* — nineteen of
them when that sentence was written, twenty-six at `f7cb5ba`.
§4.1 says the built-in status pane at `GET /` *"moves under section 6.3's
reserved prefix"*, and that the other legacy pane paths stay reserved *"until
the phasing in section 8 moves each pane onto the API and deletes its route"*.
Both sentences cannot be true forever.

The reconciliation costs nothing, because the two sentences are promises about
**different contracts**:

- **§2.1's promise belongs to the API**, and it is true of the phase it was
  written for: introducing `/api/v1` disturbs no existing path, because `/api/`
  is a prefix nothing serves (§2.1, §4.1 rule 1). Phases 2 and 3 below keep it
  exactly.
- **The HTML page paths are not the API and carry no version promise at all** —
  no `/api/versions` lists them, no compatibility rule in §2.1 governs them, and
  a browser bookmark is not a client in §2.1's sense. §2.1's breaking-change
  list governs `/api/v1` only, so nothing phase 4 does to `/` is a `v1` break.
- **Therefore `/` moves in phase 4**, deliberately and as a change to the HTML
  surface, and §4.1's other thirteen reserved paths are released only when a
  phase moves the corresponding pane onto the API — which, given the five-item
  scope above, is **most of them never**. §4.1 expected §8 to schedule that
  shrinkage; the honest answer is that the shrinkage is smaller than §4.1
  assumed, and §4.1's "thirteen paths a custom UI cannot use" is close to
  permanent. That is a cost, it belongs to §9, and it is recorded there.

What phase 4 **does** owe is a release note: `GET /` changes meaning on the A/B
update that lands it, with no operator action, for every device that later
activates a bundle.

### 8.2 The phases — **[proposed]**

Six phases. The shape of the table is `docs/design/access.md` §8's — Phase /
Scope / Campaign / Status — so that this project's design documents can be read
side by side (`docs/design/access.md`).

**The test each phase had to pass to be a phase:** *shippable on its own*, which
this document reads strictly — an operator must be able to do something after it
that they could not do before it, on a device carrying only that phase and its
predecessors. A step that is only meaningful once the next one lands is not a
phase and has been folded into its successor.

| Phase | Scope | Campaign | Status |
|---|---|---|---|
| 1 | Recover the error classification apid discards: `bus_client.rs` stops flattening `zbus::Error`; optionally split mosd's `to_fdo` | — | **not started** |
| 2 | `/api/v1` read-only, plus §3.2's bearer token, `access.apiTokens`, and the schema move to v5 | — | **not started** |
| 3 | `/api/v1` writes, collections and actions; `POST /api/v1/setup` | — | **not started** |
| 4 | Static hosting and the whole custom-UI lifecycle (§4, §5, §6) — with **no** upload route | `l1-o7ee8v0o-20260820142702-ui` | **landed** — §§4-6 carry per-subsection `[implemented]` markers; §4's preamble records the landing |
| 5 | The upload path: the request that delivers a bundle archive over HTTPS | — | **not started** |
| 6 | The update-upload UI — `docs/design/dashboard.md` §8 phase **4e** | — | **not started** |

At the time this table was written nothing in it had an owning campaign: the
campaign that produced it (`l1-o7ee8v0o-20260819152142-api`) produced a design
document and no product code, and the "Campaign" column was left honest rather
than filled with a name that did not exist. Phase 4's row has since been
updated in place with the campaign that landed it, and the remaining rows are
still unowned. Phase 2's row stays **not started**, but its gate is open: the
rollback question a schema bump raises is decided, and the decision is the
tolerant load path. `Store::load` no longer refuses a `schema_version` newer
than it supports — `load_with_report`
(`pkgs/mosd/mosd-settings/src/store.rs`) strips the keys this schema does not
know and parses what remains, and a document a future schema *reshaped* rather
than extended falls back to `Settings::default()`, reported rather than
returned as an error. The accepted cost is that the reshaped case abandons the
admin credential and returns the device to setup mode, which is why mosd logs
the report at `error!` level. The rule that follows for schema authors: prefer
additive bumps; a reshaping bump forfeits settings on rollback and must say
so.

---

#### Phase 1 — recover the error classification, before any API exists

**What ships.** The HTML path stops flattening every `zbus::Error` into one
502. `BusSettings` converts with `err.into()` at four call sites
(`pkgs/mosd/apid/src/bus_client.rs`) and `zbus` 5.19.0
(`pkgs/mosd/Cargo.lock`) carries the distinction in
`Error::MethodError(OwnedErrorName, ...)`. The phase matches on it, carries
the fdo error name into a typed error, and teaches the HTML handlers to stop
rendering `bus_error` (`pkgs/mosd/apid/src/routes.rs`) for a value mosd
merely rejected. Optionally in the same phase, mosd's `to_fdo`
— since renamed `to_bus_error` (`pkgs/mosd/mosd/src/bus.rs`) — stops collapsing `NotFound`, `ReadOnly` and
`Validation` (`pkgs/mosd/mosd-settings/src/error.rs`) into one
`InvalidArgs`. That option has since been exercised, before v1 froze: the
mapping (now `to_bus_error`) names `NotFound` and `ReadOnly` with the
interface-scoped error names `com.mos.mosd1.Error.NotFound` and
`com.mos.mosd1.Error.ReadOnly`, and §2.4's table carries `settings_not_found`
(404) and `settings_read_only` (409) beside `settings_rejected`.

**What an operator can do that they could not before.** Submit an invalid CIDR
on `/network` and be told **why**. Today `network_submit` returns `bus_error` when
the settings write fails (`pkgs/mosd/apid/src/routes.rs`), and `write_key_list`
does the same (`pkgs/mosd/apid/src/routes.rs`), so a rejected value is reported to the operator as
*"The management daemon is unavailable."* — an outage message for a typo. §2.4
calls this out with the VLAN example. **This phase is a visible bug fix that
needs no API at all.**

**Acceptance.** A route test in which the in-memory `SettingsApi` fake
(`pkgs/mosd/apid/src/settings_api.rs`) returns a mosd validation error
renders mosd's message in the pane and does **not** render the 502 page; and a
test in which the fake returns a transport failure still renders the 502 page.
Both directions, because a test that only proves the new path leaves the old one
unasserted.

**What is explicitly still missing.** There is no API. Nothing about static
hosting. `/healthz` still answers `ok` while mosd is dead (§2.4 case 3), because
it must (`rootfs/overlay/usr/lib/mos/mos-health`).

**Why this is first and not folded into phase 2.** Two reasons, and the second
is the load-bearing one. First, §2.4's *whole error table* depends on
recovering the fdo error name, and §2.4 is not implementable until it is —
which apid now does, by downcasting to the concrete `zbus::Error`
(`pkgs/mosd/apid/src/routes.rs`) and mapping `FDO_INVALID_ARGS`,
`FDO_IO_ERROR` and `FDO_FAILED` onto three distinct API error codes. Second:
§2.1's breaking-change list makes *"changing
which `error.code` an existing failure emits"* a **major-version bump**. Landing
the classification before `v1` freezes is the difference between a refactor and
a `v2`. If `to_fdo`'s three collapsed cases are split *after* v1 ships,
`settings_rejected` splitting into three codes is either a version bump or a
contract that permanently misreports two of the three.

---

#### Phase 2 — `/api/v1` read-only, and the credential that reaches it

**What ships.** `GET /api/versions` (unauthenticated, §2.1),
`GET /api/v1/meta`, `GET /api/v1/settings/<dot-path>` behind §2.2's structural
redactor, `GET /api/v1/state/<dot-path>`, `GET /api/v1/health` with the
gate exemption §2.4 requires, §2.4's error envelope on every failure, and §3.2
entire: `access.apiTokens` in the settings model, `POST`/`GET`/
`DELETE /api/v1/tokens`, SHA-256 hashes compared in constant time, and the mint
pane in the built-in UI that §3.2's bootstrap depends on.

**The one thing in this phase that touches an already-deployed device, named
because it is the highest-consequence detail in the whole plan — and measured by
running it, not by reading.** `access.apiTokens` is a new field in a tree whose
every struct carries `#[serde(deny_unknown_fields)]` (§1.5, e.g.
`pkgs/mosd/mosd-settings/src/model.rs`), so `SCHEMA_VERSION` must move 4 → 5
(`pkgs/mosd/mosd-settings/src/model.rs`).

**The obvious answer — "add a `MigrateV4ToV5` whose `down` drops the field" — does
not work, and this document asserted it before checking.** Four cases were
executed against `mosd-settings` at `86cd669`, through a throwaway integration
test run under `cargo test -p mosd-settings` and deleted afterwards; the strings
below are the run's actual output.

1. **The A/B rollback itself.** Today's binary *is* the "old" (v4) binary, so
   loading a tree stamped `schema_version = 5` carrying `access.apiTokens` is
   exactly the rollback. `Store::load` answers:

   ```
   settings migration error: on-disk schema_version 5 is newer than supported 4
   ```

   That is the guard at `pkgs/mosd/mosd-settings/src/store.rs`, and it returns
   **before `migrate` is ever called** (`pkgs/mosd/mosd-settings/src/store.rs`). No migration of any direction
   participates in the decision.
2. **Adding the field without bumping the version** fails differently and just
   as hard:

   ```
   settings parse error: TOML parse error at line 4, column 10
     |
   4 | [[access.apiTokens]]
     |          ^^^^^^^^^
   unknown field `apiTokens`, expected one of `webAdmin`, `ssh`, `console`, `device`
   ```

   So there is **no version-stamping trick that makes a new field additive** for
   an older binary: `deny_unknown_fields` rejects it whether or not the version
   moved.
3. **Could the old binary run the v5 `down` step even if it tried?** No — the
   step ships inside the v5 binary:

   ```
   settings migration error: no migration targeting schema version 5
   ```
4. **The `down` direction does work for a version that exists** — `migrate(4, 3)`
   succeeds and rewrites `schema_version` to `3` — which is what made the wrong
   answer plausible. It is reachable only from an explicit caller with
   `from > to`, and **the only such callers in the tree are tests**
   (`pkgs/mosd/mosd-settings/tests/settings.rs`).
   `pkgs/mosd/mosd-settings/src/store.rs` is the sole
   production caller of `migrate` and it can only ever walk **upward**.

**What follows, corrected.** An A/B rollback into a phase-1 slot after a token
has been minted does not degrade — it **fails the settings load**, and
`pkgs/mosd/mosd/src/main.rs` propagates that with `?`, so mosd exits. Under
`Restart=on-failure` (`pkgs/mosd/dist/mosd.service`) that is a crash loop, and
because apid's gate calls `GetSettings("access")` on **every** request
(`pkgs/mosd/apid/src/routes.rs`) the whole appliance answers the 502 page *"The
management daemon is unavailable."* (`pkgs/mosd/apid/src/routes.rs`). **The
appliance's own recovery mechanism becomes the thing that breaks management** —
the conclusion this document originally reached for the wrong reason.

**And it is pre-existing, not something this phase invents.** The same guard
applies to the v3 → v4 bump that already shipped: a device updated to
schema v4 and then rolled back to a v3 binary hits `store.rs` identically.
So this is a live property of the shipped A/B story that phase 2 would be the
next thing to trigger, not a cost of the API. It is **larger than this
document** and is not solved here; what phase 2 owes is to not ship until it
has an answer, because "mint a token, then roll back" is a
plausible sequence and not an exotic one. Every later phase that changes the
settings model inherits the same constraint.

**What an operator can do that they could not before.** Read the entire device
with one header and no browser emulation. §3.1's items 1 through 5 are fixed for
reads in this phase: an unauthenticated call gets a **401 with a body**, not a
303 that a redirect-following client reports as success; the credential survives
an A/B update, because it is on STATE rather than in a `HashMap`
(`pkgs/mosd/apid/src/session.rs`); and it does not expire at 24 hours.

**Acceptance.** Four checks, each of which fails loudly if the phase is wrong:

1. `curl -H 'Authorization: Bearer …' https://<device>/api/v1/settings/access`
   returns JSON in which `webAdmin.password_hash` and every
   `apiTokens[].hash` are the literal `"<redacted>"`.
2. The same request with **no** `Authorization` header returns **401** carrying
   §2.4's envelope with `code: "not_authenticated"` — **not** a redirect to
   `/login`. This is §3.1 item 1, and it is the single check that proves the
   phase did the thing it exists to do.
3. With mosd stopped, `GET /api/v1/health` answers
   `200 {"apid":"ok","mosd":"unreachable", …}` while `GET /healthz` still
   answers the literal `ok` — the two endpoints disagreeing is the correct
   result (§2.4 case 3).
4. **The rollback check, and it is a gate on the phase rather than a test of
   it.** A settings tree written by a phase-2 binary, with at least one token
   minted, is loaded by a phase-1 binary. Measured at `86cd669` this fails with
   `on-disk schema_version 5 is newer than supported 4`, and no migration
   changes that. **Phase 2 does not ship until that load succeeds or until the
   project has accepted, in writing, that minting a token forfeits rollback.**
   Either resolution is legitimate; shipping without choosing one is not.

**What is explicitly still missing.** No writes — a script can observe and not
change. No static hosting, no bundles, no upload. No expiry on a token (§3.2),
so revocation is the entire lifecycle. No scopes: a read-only
token is not expressible, and a token minted here can do everything phase 3
later adds.

**Shippable on its own: yes.** Read-only automation is the single most useful
thing a headless appliance with SSH off by default can offer a fleet operator,
and it is useful with zero write routes.

---

#### Phase 3 — writes, collections and actions

**What ships.** `PUT /api/v1/settings/<dot-path>`, the two collection resources
§2.2 adds deliberately (`/api/v1/ssh/authorized-keys` and
`/api/v1/wifi/client/networks`), `/api/v1/actions/{reboot,poweroff,
transient-root-password}`, `POST /api/v1/setup`, and §2.3's one named behaviour
change — a `DELETE` whose identifier matches nothing is **404**, where the HTML
path answers 422 (`pkgs/mosd/apid/src/routes.rs`). The HTML path is not
changed.

**What an operator can do that they could not before.** Provision a
factory-fresh device entirely from a script. `POST /api/v1/setup` is
unauthenticated by necessity — it is the only route the gate lets through in
setup mode (`pkgs/mosd/apid/src/routes.rs`) — and it returns a token (§2.3),
so everything after it is one credential. Today that sequence requires a human,
a browser and the first-run wizard.

**Acceptance.** A single scripted run, with `curl` only and no browser, takes a
device from first boot to: configured hostname, one static interface, SSH
enabled and one authorized key installed. Every failure along the way carries a
distinguishable `error.code` with the correct `source`, which is the property
phase 1 made possible: an invalid CIDR is `validation_failed` from `apid`, a
value mosd's typed tree rejected is `settings_rejected` from `mosd`, and a dead
mosd is `mosd_unreachable` — three outcomes that are one 502 page today.

**What is explicitly still missing.** The UI story has not started: every path
in §1.2 works exactly as it did, `/` is still the maud status pane, and there is
no way to install a UI. §2.4 records a live inconsistency this phase creates and
does not resolve — the API answers **503** for an unreachable mosd while the
HTML path answers **502** (`pkgs/mosd/apid/src/routes.rs`), so one appliance
reports one outage two ways until someone changes both. That is deliberate: §2.4
says changing only the API is the wrong half of the trade, and this phase does
the API half because the HTML half is a user-visible change to a shipped page.

**This is the phase at which `/api/v1` acquires a client**, and therefore the
phase at which every cost in §9 starts being paid rather than contemplated.

---

#### Phase 4 — static hosting and the custom-UI lifecycle, with no upload route

**This phase has landed.** It was executed as campaign
`l1-o7ee8v0o-20260820142702-ui` and merged at `0d4f3c6`. §§4, 5 and 6 carry
per-subsection `[implemented]` markers naming the code, and §4's note there
states what those markers do and do not claim — in particular that none of this
is exercised on hardware. The paragraphs below are kept as written, with what
the implementation settled differently recorded beside each claim rather than
substituted for it.

**What ships.** §4, §5 and §6 in their entirety, **except** the request that
delivers the archive. Concretely: the asset router mounted as the HTTPS
router's fallback so that declared routes win structurally (§4.1 rule 1); the
SPA fallback under §4.2's five conditions; §4.3's MIME allowlist, `nosniff` and
three-class caching posture; §4.4's traversal rules with install-time symlink
rejection and canonicalise-and-assert; `/mos/ui` with the
`bundles/<generation>` plus `current` symlink layout (§5.2, §5.3); validation,
`fsync`-before-rename activation, digest, optional `mos-ui.json`, deactivate and
delete (§5.3); §6.3's reserved built-in prefix carrying the deactivate control;
and §6.1's compatibility check at activation **and again at every apid
start-up**.

Installation in this phase is **local**: an operator places a tree on the device
and calls an activate operation, or apid picks up a staged directory. No
multipart handler, no archive dependency, no new network-reachable write.

**§6.1's constraint is part of the scope and not an implementation detail.**
Bundle discovery and evaluation must happen **after** the listeners bind and
after the startup marker is printed, and every bundle outcome must be a state
the daemon holds rather than an error it returns — because `main` propagates
startup steps with `?` (`pkgs/mosd/apid/src/main.rs`) under
`Restart=on-failure` (`pkgs/mosd/dist/apid.service`), so a bundle that could fail
startup would produce a crash loop with no listener bound. **The marker is
`APID_LISTENING`, not `WEBD_LISTENING` as this phase and §6.1 were written**;
the rename moved the string as well as the paths. As landed,
`pkgs/mosd/apid/src/main.rs` binds both listeners, prints the marker, and
calls `startup::discover` with no error variant to propagate.

**What an operator can do that they could not before.** Ship their own UI. For
the population that has SSH — which per §7.2 is root — this is the whole
feature, delivered without a single new network-reachable write path.

**Acceptance.** Four, and the first is §6.3's own test:

1. For **each** of §6.1's five failure classes, one documented action —
   navigate to `https://<device>/builtin/` — reaches a working UI, and one
   control there deactivates the bundle. **The operator diagnoses nothing.** A
   class that requires knowing the cause fails the phase.
2. §4.4's traversal suite as tests **in this repository**, not in a
   dependency's: `/../../etc/passwd`, `/%2e%2e%2fetc%2fpasswd`,
   `/%252e%252e%2fetc%2fpasswd`, a path containing `%00`, and a request
   resolving through a symlink planted in a temporary bundle root — 404 for
   every one (§4.4).
3. §4.3's operator criterion: a replaced bundle is visible on a plain reload,
   with no cache clear, no hard refresh and no incognito window.
4. A bundle activated against API `v1`, then an A/B update to an image serving
   only `v2`, deactivates itself on first boot into the new slot and says why —
   §6.1 class 5, which §5.4 records is the one failure no file-level property
   can see.

**How the four acceptances were met, and by what.** Recorded because an
acceptance is worth what its evidence is worth:

1. Met by `pkgs/mosd/apid/src/tests/broken_classes.rs`: each of §6.1's five classes
   is constructed end to end, the one navigation to `/builtin/` reaches a
   working UI from every one of them, the control there deactivates the bundle,
   each class asserts a **distinct** state the mechanism reported so none can
   pass for another's reason, and the set of classes that ran is diffed against
   the set declared. Class 4's `EACCES` arm needs a non-root runner and was run
   under `setpriv`; the repository's own checks run as root.
2. Met by `pkgs/mosd/apid/src/assets/path.rs`'s per-guard suite, in this repository
   and not in a dependency's. `/%252e%252e%2fetc%2fpasswd` is a 404 by an
   explicit rejection rather than by a miss — see §4.4's two rejections beyond
   the five rules.
3. Met at the **header** level only: the three cache classes and `nosniff` are
   asserted on every asset response
   (`pkgs/mosd/apid/src/assets/mime.rs`, `pkgs/mosd/apid/src/tests.rs`). No browser was
   driven, so what is proved is that the headers the criterion rests on are the
   ones sent.
4. Met by re-evaluating an activated bundle against a **different** served set —
   `evaluate` takes the set as a parameter for exactly this case — so the
   deactivation and the log line carrying both sets are proved. **No A/B update
   was performed**: no image was built for a second served set and no
   `rauc install` ran. The mechanism is proved; the update that would exercise
   it is not.

**What is explicitly still missing.** Installing a UI **without** a shell —
which means without SSH, which is off by default
(`pkgs/mosd/mosd-settings/src/model.rs`), which means on a default device
this phase's feature is unreachable. And nothing is signed (§7).

**Shippable on its own: yes, and this is the phase most likely to be argued
about, so the argument is answered here.** The objection is that it is half a
feature. It is not: the mechanism is complete and only the transport is manual,
and §7.1 measured that **SSH is the only channel that reaches `/mos/ui` on a
shipped device today anyway** — this phase does not withhold a channel, it uses
the one that exists. It also front-loads every genuinely hard part — traversal,
MIME sniffing, cache correctness, the escape, the start-up compatibility
re-check — into a phase whose exposed population already has root, so a bug in
any of them is a bug in front of people who could have caused it by hand.

---

#### Phase 5 — the upload path

**What ships.** The request that drives §5.3: a file-receiving authenticated
route (no multipart handler exists anywhere in the crate — `grep -rn Multipart
pkgs/mosd/` returns nothing at `86cd669`), the archive-format dependency §5.3
declines to settle, a bound on upload size, and §7's authorisation decision
in force — bearer token or authenticated session, no signature.

**What an operator can do that they could not before.** Install a UI on a device
with SSH off. That is every device by default, on both image profiles
(`pkgs/mosd/mosd-settings/src/model.rs`, `docs/design/access.md`), so
this phase is what turns phase 4 from a capability for people with shells into a
product feature.

**Acceptance.**

1. A bundle uploaded over HTTPS with a bearer token is the active UI on the next
   page load.
2. A bundle containing a symlink is rejected at unpack with §2.4's envelope, and
   the previously active bundle is **still active** — §5.3's independence
   property, tested rather than asserted.
3. An interrupted upload leaves nothing under `/mos/ui/bundles/` and no
   `current` pointing at anything new.
4. Uploading a bundle whose declared API range excludes the served version is
   refused at activation with a legible reason (§6.1 class 5, activation half).

**What is explicitly still missing.** Provenance: nothing records who uploaded
what (§7.4). Expiry on the credential that authorised it (§3.2).
Signing (§7.4, and its four triggers).

**This is the phase §7 is about**, and the phase boundary is where §7 becomes
checkable: before it, the only channel to `/mos/ui` is already root; after it,
there is a network-reachable one. If §7's recommendation is ever revisited, this
is the phase whose scope changes, and nothing earlier is affected.

---

#### Phase 6 — the update-upload UI: `docs/design/dashboard.md` §8 phase 4e

**The parked item, located and quoted rather than paraphrased.** It is phase
**4e** of `docs/design/dashboard.md` §8.2: *"**Install a bundle, with progress**
— an upload path and a place to put the bundle. The caller and progress surface
exist: `InstallUpdate` hands a bundle path to RAUC's D-Bus
`InstallBundle`, `GetUpdateState` reads progress back. Today: no upload route"*
(`docs/design/dashboard.md`). It is gap row **4**, restated at
`docs/design/dashboard.md` and originally measured at
the inventory.

**Re-measured at `d9c5c9e`, one of the original three "today" claims holds:**
`grep -rn Multipart pkgs/mosd/` returns nothing; the caller and progress
claims are dated — both were built — leaving the upload path alone parked.

**It belongs after phase 5, and the reason is mechanical rather than a
preference.** Phase 5 builds three of the four things 4e needs and they are the
three that are apid's: a file-receiving authenticated route, a staged write onto
a persistent tier that is validated before it becomes live, and a progress
surface an operator can watch. What 4e adds beyond phase 5 is **mosd** work — a
bus method and a `rauc install` caller, neither of which exists — plus a staging
location constrained by size: a bundle staged for `rauc install` is ~72 MiB
against a 64 MiB STATE
(`boards/cx3576/board.env`), so it must stage on DATA — the same tier
§5.2 chose for `/mos/ui`, for the same reason, and it is the only partition
carrying `x-systemd.growfs` (`rootfs/overlay/etc/fstab.in`).

**One asymmetry between this phase and phase 5 that makes §7 concrete rather
than abstract.** The update-upload path **is** signature-checked and the
UI-upload path is not. `rauc` verifies the CMS signature against
`/etc/rauc/keyring.pem` and mos refuses `plain`-format bundles by configuration
(`pkgs/rauc/system.conf.in`), and dashboard.md's own row states the
constraint that goes with it: *"**no "install this file anyway" affordance may
be added**"* (`docs/design/dashboard.md`). The asymmetry is correct, and it
is what §7's recommendation actually says: **mos requires a signature on the
artifact whose compromise is a kernel, and does not require a key ceremony for
the artifact whose compromise is a web page on an origin the operator already
controls.** §7 is not a general posture against signing; it is a line drawn at a
specific place, and it is drawn here so a later reader does not generalise it.

**One prerequisite outside this document's scope, named rather than assumed
away.** No keyring is shipped and none is in git
(`pkgs/rauc/system.conf.in`, `verify/src/checks-root.ts`), so until
production keyring provisioning happens, `rauc install` **fails closed** and
this phase's acceptance cannot be demonstrated on a shipped image at all.

**What is explicitly still missing after phase 6.** Everything in 8.3.

### 8.3 What is deliberately not phased — **[proposed]**

Four items that a reader will look for and not find above. Each is deferred for
a reason that already exists in this document, and each is named so that its
absence is a decision rather than an oversight.

1. **Token expiry.** Needs a wall clock apid does not read — `SessionStore` uses
   `Instant` throughout (`pkgs/mosd/apid/src/session.rs`), which is
   monotonic and cannot express a deadline surviving a reboot (§3.2). It is not
   phased because the prerequisite is not scheduled anywhere.
2. **A change-stream API.** The `SettingsChanged` subscription itself now
   exists — the proxy declares the `#[zbus(signal)]` member and a watcher
   feeds the auth gate's access cache with it (§1.3) — but no route serves
   the events onward: a client that wants to know a setting moved still
   polls. `docs/design/dashboard.md` §8 phase 3 already claims the change
   stream for the UI side, and this document does not schedule work another
   campaign's phasing owns.
3. **Scopes on API tokens.** §3.2 states there are none in phase 1 and that
   inventing them means the per-method D-Bus allowlist
   `pkgs/mosd/dist/com.mos.mosd.conf` deliberately deferred. Adding a phase
   here would reopen that deferral by the back door.
4. **Bundle signing.** §7.4, with four stated triggers. It is not phase 7 in
   waiting; it is a decision with reconsideration conditions attached, and
   scheduling it would be a way of pretending the conditions were already met.

## 9. What API-first forecloses — **[proposed]**

Sections 2 through 8 argue for a direction. This section is the price list. Each
item names **the cost**, and then says plainly whether the design **mitigates**
it, **partly mitigates** it, or merely **accepts** it — because a cost that is
listed and then quietly declared solved is worse than one that was never listed.

Every "today" claim below is measured at `86cd669`, as §1 is.

**1. mosd's settings model becomes a published wire format.** §2.2 makes the
dot-path the resource identifier verbatim, and rejects hand-shaped REST nouns
for a good reason — a second model drifts and nothing notices. The cost of the
choice it made instead is that `access.ssh.authorizedKeys` is now a **public
path in an HTTP contract**, and renaming or restructuring anything in
`pkgs/mosd/mosd-settings/src/model.rs` is a breaking change to that contract. The
on-disk tree has a mechanism for exactly this — a per-document schema version
with an additive-bump rule and a tolerant load in the rollback direction
(`pkgs/mosd/mosd-settings/src/documents.rs`,
`pkgs/mosd/mosd-settings/src/store.rs`) — and **there is no equivalent for the
API's view of it**. A v1→v2
bump of one document moves a path a `v1` client hard-coded, and the client
learns about it by breaking.

*Partly mitigated, and the mitigation is detection rather than continuity.*
§2.1 puts `settingsSchemaVersion` in `GET /api/v1/meta` and forbids conflating
it with the API version, so a client can **notice** that the tree moved. Noticing
is not the same as continuing to work. This is the sharpest item on the list
because it is the one the passthrough decision buys directly.

**2. A second public contract, to keep compatible forever.** Before this
document, apid had one surface and it had no compatibility promise: it is HTML
rendered for a human, and a pane can be redesigned between images. After phase
3 there is `/api/v1`, with §2.1's exhaustive breaking/additive lists, a client
obligation to ignore unknown fields, and a recommendation that apid **serve the
outgoing major version alongside the new one for at least one image
generation** — two route trees in one binary and a deprecation the project has
to actually execute.

*Accepted.* §2.1's rules are the mitigation for *ambiguity*, not for the cost
itself: they make it decidable whether a change is breaking, which is what stops
the argument, and they do not make any of it free.

**3. What becomes harder to change once `/api/v1` has a client — three concrete
instances, not a generality.**

- **Splitting mosd's `to_fdo`.** `NotFound`, `ReadOnly` and
  `Validation` (`pkgs/mosd/mosd-settings/src/error.rs`) to stop collapsing into
  one `InvalidArgs` (`pkgs/mosd/mosd/src/bus.rs`). §2.4 emitted a single
  `settings_rejected` for all three as a result, and §2.1 makes *"changing which
  `error.code` an existing failure emits"* a major-version bump. So after v1
  ships, this improvement costs a `v2` — which is why the split landed before
  the freeze (§8.2 phase 1, §2.4).
- **The VLAN dot-path limit — since closed, and closed additively.**
  `valid_iface_name` permits `.` — `^[a-zA-Z0-9._-]{1,15}$`
  (`pkgs/mosd/apid/src/routes.rs`) — while `split_path` split on it
  unconditionally, so `network.eth0.100` could not be addressed. Schema v7
  gave the lexer quoted segments, *"in which `.` is an ordinary character"*
  (`pkgs/mosd/mosd-settings/src/path.rs`); §2.2 records the spelling that
  ships. The entry stays because its point held and was then tested: the fix did
  reach the published contract, and it reached it as an **additive** change
  under §2.1's rules — no route, method, status code or field was removed, and a
  previously-failing path merely started succeeding — so it cost no `v2`. The
  classification was worked through row by row when the change landed.
- **Uptime.** §2.2 chose that mosd should publish it into the live-state tree
  rather than apid keep reading `/proc/uptime`, and that choice has since
  landed (§2.2 item 3): the representation — a top-level `uptime` scalar of
  whole seconds — is now the published one, which is exactly why choosing it
  before v1 froze mattered.

*Mitigated by phase ordering, and only for the first.* §8.2 phase 1 does the
error-classification work **before** v1 freezes, deliberately and for exactly
this reason. The other two are accepted.

**4. The no-JavaScript-toolchain posture, under pressure it has not yet felt.**
§1.1 measures the posture four ways and §6.2 states it as a promise: mos ships
no bundler, pins no framework version, offers no build integration, and *"takes
no position on what a customer's UI is written in"*. The moment customers ship
SPAs against `/api/v1`, "how do I build against your API" becomes a support
question whose honest answer is "we have no toolchain and will not have one" —
and that answer is stable exactly as long as nobody with leverage asks. The
pressure is not for a bundler in the image; it is for a reference client, a
typed SDK, an example app, and each of those is a thing that has to track the
API forever.

*Accepted, and it is a posture rather than a mechanism, which is the honest
characterisation.* §6.2 supplies the sentence to hold the line with — *"the
artifact we guarantee will keep working forever is the one with no build
chain"* — and there is no compiler, test or verifier assertion that will notice
the day the line moves. Contrast §1.1's constraints, which **are** mechanically
checkable. This one is not, and pretending otherwise would be the failure §0's
status markers exist to prevent.

**5. Every bug report now needs "whose UI?", and the reproduction case is a
bundle mos does not have.** Before, a defect report described the shipped pages
and was reproducible from the image. After phase 5, it may describe a customer's
SPA calling `/api/v1` in a way nobody tested, on a device whose active bundle is
not in any repository. Support cannot reproduce it, cannot read its source, and
cannot rebuild it.

*Mitigated more than the others on this list, and deliberately.* §5.3's *"what
is installed right now?"* read answers **from the served tree** — active
generation or the literal statement that none is active, manifest name and
version or *"no manifest"*, whether `index.html` is readable right now, whether
the digest still matches, and whether the compatibility check ran. That is the
first triage question answered in one call. §6.3's escape answers the second:
*"go to `https://<device>/builtin/`"* is a valid instruction regardless of which
of §6.1's five classes occurred, so support does not have to diagnose before it
can help. Those two mechanisms exist for this cost specifically.

**6. The testing surface multiplies, and it multiplies in the daemon that must
never fail to bind.** Today apid's tests are handler tests against an in-memory
`SettingsApi` fake (`pkgs/mosd/apid/src/settings_api.rs`) plus an
end-to-end suite on a private bus. After phase 5 the matrix is (every operation
× HTML and JSON) × (bundle absent, present, corrupt, unreadable, incompatible)
× (every major version served), plus §4.4's five traversal cases, §4.2's five
fallback conditions, §4.3's cache criterion, and §6.1's start-up re-check — and
that last one runs on the startup path of a daemon under `Restart=on-failure`
(`pkgs/mosd/dist/apid.service`).

*Partly mitigated.* §8.2's phasing adds no bundle dimension at all until phase
4, and §6.1's constraint — evaluation strictly after the listeners bind
(`pkgs/mosd/apid/src/main.rs`), every outcome a state and never an error
return — is what keeps the worst version of this cost, a bundle that crash-loops
the daemon, out of reach. The volume of tests is accepted.

**7. The read-only-rootfs story acquires a writable, operator-supplied,
network-reachable directory.** `docs/design/ro-root.md` describes a device whose
executable surface is a verity-covered squashfs. After phase 5, a **root**
process with no sandboxing unpacks operator-supplied archives onto DATA and
serves them on the management origin. What weakens is not verity's guarantee —
`/` is exactly as protected as it was — but the sentence a reader carries away
from ro-root.md: *"the whole rootfs is verified"* stays true, and *"everything
this device serves is verified"* stops being true.

*Partly mitigated, and the unmitigated half is named precisely.* Mitigated:
§4.4's install-time rejection of non-regular entries plus canonicalise-and-
assert; §4.3's `nosniff` and fixed MIME table, which is what stops an uploaded
file being sniffed into HTML on the origin that holds `apid_session`
(`pkgs/mosd/apid/src/session.rs`); §6.2 layer 1, which keeps the built-in
UI unwritable by anything including root. **Not mitigated:** the process-level
bound. `pkgs/mosd/dist/apid.service` sandboxes the daemon in several
directions but carries no `ProtectSystem=` and no `ReadWritePaths=`
(§6.2 layer 3), so a
traversal or an unpack bug is an arbitrary **root** write, and §4.4 already
established that dm-verity does not help because it protects integrity, not
confidentiality, and because the interesting targets — the settings tree,
`/var/lib/mos/shadow`, `/etc/ssh/`, and `session.key` — are all on STATE,
outside verity's coverage by design. The fix belongs in the unit file, and §7.4
endorses it as the concrete substitute for a signing scheme.

**8. CSRF and the cookie path, once forms and an API coexist.** There is no CSRF
token anywhere in the crate — `grep -ni csrf mosd/apid/src/*.rs` returns nothing
at `86cd669` — and §3.3's account is that the API path has no CSRF exposure
because browsers do not attach `Authorization` cross-site, while the form path
holds on `SameSite=Lax` alone (`pkgs/mosd/apid/src/session.rs`). **The seam is
§3.2's bootstrap.** §3.2 says the bearer token is *"the **only** accepted
credential on `/api/v1/` routes"* and then that *"an authenticated session
cookie may mint a token"* — and a mint is the creation of a permanent credential
that no password change revokes (§3.2's consequence 1). If that mint is
reachable at an `/api/v1/` path with cookie authentication, `SameSite=Lax` is
the only control standing between a cross-site page and a permanent credential,
and `Lax` withholds the cookie from cross-site **form POSTs** while permitting
it on top-level cross-site **GET** navigations — so the mint must be a POST and
there must never be a GET form of it.

*Not mitigated as written; the design does not currently say enough to be
checked.* This is a property of the cookie path, not a cost of API-first as
such, and §3.2 settles it by putting the mint at `POST /builtin/tokens` — a
POST-only form path outside `/api/v1/`, with no GET form of it — before
phase 2 ships.

**9. Paths and tables that are burned permanently.** Three, all small, all
irreversible:

- `/api` is reserved forever (§4.1). A custom UI can never serve anything at
  `/api/anything` and never gets the prefix back.
- The **thirteen** legacy pane paths stay reserved (§4.1's list). §4.1 expected
  §8 to schedule their release; §8.1 answers that the built-in UI's post-phase-4
  job is five recovery capabilities, so **most of those paths are reserved
  permanently**, and §4.1's "until section 8 moves each pane onto the API" is
  smaller than it reads.
- §4.3's MIME allowlist lives inside the verity image, so **a customer cannot
  extend it on device** — a format the table does not know is an A/B update
  away, and two of them (`.wasm`, `.webmanifest`) break rather than degrade.

*Accepted, all three.* What makes them acceptable is only that they are small
and written down; §4.1 and §4.3 each say so at the point of the decision.

**10. Two credentials at one privilege level, and no unit of revocation smaller
than "everything".** §3.2 records that apid runs as root and every route sits
behind one gate (`pkgs/mosd/dist/apid.service`,
`pkgs/mosd/apid/src/routes.rs`), so a token can do everything the operator can do
over the API. "Give my CI a token that can read state but not reboot the
appliance" is not expressible in phase 1, and making it expressible later means
reopening the per-method D-Bus allowlist that
`pkgs/mosd/dist/com.mos.mosd.conf` deliberately deferred and that
`docs/design/dashboard.md` §6.3.2 costed.

*Accepted.* §3.2 gained a real revocation granularity over §3.1 item 6 — N
tokens instead of one password — and gained no **authority** granularity at all.
Those are different axes and this document only moved one of them.

**11. A denial-of-service surface that already exists acquires attractive
targets.** The gate used to call `GetSettings("access")` on every
unauthenticated request, against the single lock mosd holds over both trees
(`pkgs/mosd/mosd/src/bus.rs`); an API is a thing scripts hammer by design,
and §3.2 makes the read structural by *depending* on it being there.

*Mitigated since, exactly the way the acceptance note predicted.* This item
was accepted with *"caching it requires `SettingsChanged` and is not a local
change"* — and that is the change that landed: the proxy subscribes to
`SettingsChanged` (§1.3) and the gate serves `access` from an in-process
cache while the subscription is live, invalidated on every relevant change
and on apid's own access writes, falling back to the per-request read
whenever freshness is in any doubt (§3.3's narrowed note has the details).
An unauthenticated flood now contends with mosd's lock only while that
fallback is active.

**What this does not foreclose, stated because a price list with no floor is
not trustworthy either.** It does not reopen `docs/design/dashboard.md` §6.6's
two-process recommendation — §6.4 depends on it. It does not
reopen §5.8's full-page-refresh decision for the built-in UI. It does not add a
new way to be locked out: §6.3 establishes that a bad bundle cannot take the
listener down, and that `docs/design/access.md` §9.1's existing lockout is
unchanged by everything in §4 through §6. And it does not make the appliance
depend on JavaScript anywhere: the built-in UI stays server-rendered maud with
no build step (§6.2, §8.1 option B), so a device with no custom bundle is
byte-for-byte the posture §1.1 measured.
