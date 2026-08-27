# apid: an API-first management daemon with replaceable UI

> **Status:** proposal. This document proposes that the management daemon become
> **API-first** — that every management operation be reachable over a documented
> HTTP API, and that the human interface become one client of that API rather
> than the only way in, so a site can replace it without forking the daemon.
> The audience is whoever builds or replaces the mos management UI, and whoever
> has to script the appliance without a browser. Sections 2-9 are the proposal;
> section 1 is not a proposal at all — it is the measured surface those
> sections must be derived from.

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

access.md's reason for the discipline applies here unchanged: *"dead code has a
compiler, a test run and a grep-for-callers that can surface it; a security
control that exists only as prose has no mechanism that will ever notice it is
absent"* (`docs/design/access.md:37-40`). This document is mostly **[proposed]**,
and marking it so is the point — a reader must be able to tell section 1 (which
can be checked against the tree) from sections 2-9 (which cannot, because there
is nothing to check yet). Section 0 carries no marker: it describes no
mechanism, which is the same exemption access.md states for its own unmarked
sections (`docs/design/access.md:63-64`).

**The commit this document was measured at.** Every factual claim in section 1
was read out of the tree at commit
`86cd669fa71889577f7e1ab1fab0e0e09a463dcf`, this branch's merge base with
`main`, and the citations under those claims are that commit's unless the
sentence around them says otherwise. Line numbers drift, and a citation whose
file was renamed or whose quoted text moved has been re-pointed at the current
tree rather than left dangling. A reader on a later tree should re-measure
before trusting a line number; for anything pinned to `86cd669`,
`git show 86cd669:<path>` settles a disagreement.

**What this document settles.** Section 1 settles what exists, so that no later
section invents a surface mos does not have. Sections 2-9 propose the API, the
programmatic authentication, static hosting, where a custom UI lives, the safety
escape back to a built-in UI, trust, phasing, and what the whole direction
forecloses.

**What this document does not settle.** It does not re-open anything
`docs/design/dashboard.md` decided (see section 1.7): not the live-value
mechanism, not the process architecture, and not whether `com.mos.mosd1` is a
supported contract. It proposes no route handler code, no
markup, and no build tooling. It makes **no hardware claims** — nothing
described or proposed here has been run on a device; every statement about
current behaviour is a reading of source.

## 1. The surface as it exists today — **[implemented]**

Measured at `86cd669`, as stated in section 0. Where this section and a design
document disagree, the code is recorded as the fact and the disagreement is
named.

### 1.1 What apid is, and the two constraints that bound every option

apid is a Rust crate named `apid` (`mosd/apid/Cargo.toml:2`), built into a
binary started by a systemd unit as `/usr/bin/apid`
(`mosd/dist/apid.service:14`) after `mosd.service`
(`mosd/dist/apid.service:3-4`), with its state directory declared as
`StateDirectory=mos/apid` (`mosd/dist/apid.service:16`). The unit sets no
`User=` line (`mosd/dist/apid.service:1-42`), so the daemon runs as root; the
D-Bus policy file records the same fact from the other side — *"no shipped unit
sets User=, mosd.service owns the name as root, apid.service and the boot
health gate both run as root"* (`mosd/dist/com.mos.mosd.conf:11-13`).

It binds two listeners, defaulting to `0.0.0.0:443` for HTTPS and `0.0.0.0:80`
for the redirect-only HTTP listener (`mosd/apid/src/config.rs:34-37`), and
prints exactly one machine-readable startup line,
`APID_LISTENING https=<addr> http=<addr>` (`mosd/apid/src/main.rs:18`, emitted
at `:172`), routing everything else to stderr
(`mosd/apid/src/main.rs:143-144`).

**Constraint 1 — the pages are server-rendered maud, with no JavaScript build
chain.** The template engine is maud (`mosd/apid/Cargo.toml:19`, resolved to
`maud = "0.27"` at `mosd/Cargo.toml:66`), used directly in the handlers via the
`html!` macro (`mosd/apid/src/routes.rs:29`). The HTTP stack is axum
(`mosd/apid/Cargo.toml:15` → `axum = "0.8"` at `mosd/Cargo.toml:45`) served by
axum-server (`mosd/apid/Cargo.toml:16` → `mosd/Cargo.toml:46`). There is no
JavaScript: `grep -ci '<script\|javascript' mosd/apid/src/routes.rs` returns
`0`, and the only stylesheet is an inline constant
(`mosd/apid/src/routes.rs:727-734`) injected into the page head as
`style { (PreEscaped(STYLE)) }` (`mosd/apid/src/routes.rs:738`). The crate
contains no non-Rust file but its manifest and the generated OpenAPI document
(`find mosd/apid -type f ! -name '*.rs'` returns `mosd/apid/openapi.json` and
`mosd/apid/Cargo.toml`), so there is no bundler input, no `package.json`, and
nothing for a build chain to consume.

**Constraint 2 — TLS is rustls only.** `rustls` is pinned with
`default-features = false` and the `ring`, `std` and `tls12` features
(`mosd/Cargo.toml:61`), `axum-server` takes the `tls-rustls-no-provider`
feature (`mosd/Cargo.toml:46`), certificate generation uses `rcgen` with the
`ring` backend (`mosd/Cargo.toml:62`), and the daemon installs the ring provider
explicitly before anything else runs
(`mosd/apid/src/main.rs:146-147`). No OpenSSL, and no C TLS stack, appears in
the crate's dependency list (`mosd/apid/Cargo.toml:11-31`). The workspace also
forbids unsafe code (`mosd/Cargo.toml:11`) and the crate repeats the forbid
locally (`mosd/apid/src/main.rs:27`).

These two constraints bound every option in sections 2-6: an API that requires a
JavaScript toolchain to be usable from the shipped UI, or a TLS feature rustls
does not offer, is not free — it is a change to the posture recorded here.

### 1.2 The route table as shipped

There are **two** routers in `mosd/apid/src/routes.rs`.

The **HTTPS application router** is `app()` at `mosd/apid/src/routes.rs:43-68`.
Every route it declares is listed below; the `gate` middleware is layered over
all of them at `mosd/apid/src/routes.rs:66`.

| Method + path | Route line | Handler | Kind | What it does | mosd calls |
|---|---|---|---|---|---|
| `GET /` | `:45` | `home` (`:578`) | GET page | Status pane: hostname, uptime parsed from `/proc/uptime` (`:581-583`), and the live-state `network` subtree pretty-printed per interface (`:596-611`) | `GetSettings("hostname")` (`:579`), `GetState("network")` (`:580`) |
| `GET /setup` | `:46` | `setup_form` (`:339`) | GET page | First-run wizard: admin password, optional hostname, optional single interface | `GetSettings("access")` (`:340`), `GetSettings("hostname")` (`:347`) |
| `POST /setup` | `:46` | `setup_submit` (`:381`) | HTML form POST | 409 when already configured (`:388`), 400 on a bad password (`:398`, `:408`), 422 on a bad hostname or interface (`:417`, `:429`), 500 if hashing fails (`:438`); on success writes and issues a session cookie, then redirects to `/` (`:469-474`) | `GetSettings("access")` (`:382`), `SetSettings("access.webAdmin", …)` (`:442`), `GetSettings("hostname")` (`:446`), `SetSettings("hostname", …)` (`:453`), `SetSettings("network.<iface>", …)` (`:463`) |
| `GET /login` | `:47` | `login_form` (`:486`) | GET page | One password field | none |
| `POST /login` | `:47` | `login_submit` (`:499`) | HTML form POST | 429 while the login guard is locked (`:502`), 401 on a wrong password (`:528`); on success sets the session cookie | `GetSettings("access")` (`:510`) |
| `POST /logout` | `:48` | `logout` (`:535`) | HTML form POST | Drops the server-side session and clears the cookie | none |
| `GET /network` | `:49` | `network_form` (`:698`) | GET page | One form per configured interface plus an add-interface form; `?saved=1` renders a banner | `GetSettings("network")` (`:699`) |
| `POST /network` | `:49` | `network_submit` (`:708`) | HTML form POST | 422 with the pane re-rendered on an invalid interface name or CIDR (`:718`); on success redirects to `/network?saved=1` (`:731`) | `GetSettings("network")` on the error path (`:713`), `SetSettings("network.<iface>", …)` (`:726`) |
| `GET /hostname` | `:50` | `hostname_form` (`:757`) | GET page | One text input pre-filled with the current hostname | `GetSettings("hostname")` (`:758`) |
| `POST /hostname` | `:50` | `hostname_submit` (`:908`) | HTML form POST | 422 on an invalid name (`:915`); on success redirects to `/hostname?saved=1` (`:927`) | `SetSettings("hostname", …)` (`:922`) |
| `GET /power` | `:51` | `power_form` (`:853`) | GET page | Two confirmation forms, each with a required checkbox carrying an action-specific token (`:790-796`) | none |
| `POST /power/reboot` | `:55` | `power_reboot` (`:896`) → `power_submit` (`:869`) | HTML form POST | 422 when the confirm token does not match (`:870-878`); otherwise **202 Accepted** (`:890`) with the D-Bus call spawned on a detached task so the response goes out first (`:879-888`) | a write to the `/Actions/reboot` item over the `com.mos.Item1` proxy (`mosd/apid/src/bus_client.rs:33`, path at `:40`, call at `:189-191`) |
| `POST /power/poweroff` | `:56` | `power_poweroff` (`:900`) → `power_submit` (`:869`) | HTML form POST | Same shape | a write to the `/Actions/poweroff` item over the `com.mos.Item1` proxy (`mosd/apid/src/bus_client.rs:33`, path at `:41`, call at `:193-195`) |
| `GET /ssh` | `:57` | `ssh_form` (`:1200`) | GET page | SSH pane: stored `access.ssh` settings, the authorized-key list, and the sshd reconciler's live state | `GetSettings("access.ssh")` (`:1035`), `GetState("sshd")` (`:1045`) |
| `POST /ssh/enable` | `:61` | `ssh_enable` (`:1216`) | HTML form POST | Writes the checkbox state and redirects to `/ssh?saved=1` (`:1225`) | `SetSettings("access.ssh.enabled", …)` (`:1220`) |
| `POST /ssh/password` | `:62` | `ssh_password` (`:1261`) | HTML form POST | Sets a **transient** root password after a confirm token and a length check (`:1240-1259`) | `SetTransientRootPassword()` (`:1272`) |
| `POST /ssh/keys/add` | `:63` | `ssh_key_add` (`:1284`) | HTML form POST | Parses and validates one public key, then rewrites the whole list; 422 on a rejected key (`:1085`) | `GetSettings("access.ssh")` (`:1062`), `SetSettings("access.ssh.authorizedKeys", …)` (`:1075`) |
| `POST /ssh/keys/remove` | `:64` | `ssh_key_remove` (`:1317`) | HTML form POST | Removes one key and rewrites the whole list | same as add |
| `GET /healthz` | `:65` | `healthz` (`:153`) | neither — plain text | Returns the literal `ok` | none |

**Kinds, counted.** Of the nineteen method+path pairs above — declared by
fifteen `.route()` calls (`mosd/apid/src/routes.rs:45-65`) — seven are GET
pages, eleven are HTML form POSTs, and one (`/healthz`) is neither: it returns a
bare string (`mosd/apid/src/routes.rs:153-155`). **There is no route in this router that
returns JSON, and none that accepts a JSON request body** — every mutating
handler takes `Form<...>`, axum's URL-encoded form extractor
(`mosd/apid/src/routes.rs:8`, and each handler signature, e.g. `:381`, `:708`,
`:1284`). That absence is the whole reason sections 2 and 3 exist.

**Two deliberate absences, both commented in the source.** No `GET` handler
exists for either power action (`mosd/apid/src/routes.rs:52-54`) or for any of
the four SSH mutations (`mosd/apid/src/routes.rs:58-60`), so a browser prefetch,
a crawler or a mis-clicked link cannot power the appliance off or enable SSH.
And there is no CSRF token anywhere in the crate (`grep -ni csrf
mosd/apid/src/*.rs` returns nothing at `86cd669`); the mitigations that exist
are the `SameSite=Lax` cookie attribute (section 1.4) and the per-action confirm
token on power (`mosd/apid/src/routes.rs:870`) and on the transient password
(`mosd/apid/src/routes.rs:948`).

**The second router.** `redirect_app()` at `mosd/apid/src/routes.rs:72-76` is
the router served on the **HTTP** listener. It declares no routes at all — only
a fallback (`:74`) — and answers every request with a 308 Permanent Redirect to
the HTTPS origin, deriving the host from the `Host` header with any port
stripped and re-attaching the actual HTTPS port unless it is 443
(`mosd/apid/src/routes.rs:78-95`). It carries no state beyond that port
(`:75`), no auth gate, and no access to mosd. Both routers are wired in
`main` — `routes::app(state)` on the rustls listener and
`routes::redirect_app(https_addr.port())` on the plain one
(`mosd/apid/src/main.rs:78-83`).

### 1.3 How apid reaches mosd

apid never spawns a process and never talks to systemd itself; every system
action goes through mosd. The trait doc states it as a rule: *"The power actions
are here rather than executed locally because mosd owns every system action:
apid never spawns a process and never talks to systemd itself"*
(`mosd/apid/src/settings_api.rs:10-12`).

**The bus and the interface.** The transport is **D-Bus**, via `zbus`
(`mosd/apid/Cargo.toml:31` → `mosd/Cargo.toml:28`). The proxy declares the
interface `com.mos.mosd1`, the well-known service name `com.mos.mosd`, and the
object path `/com/mos/mosd` (`mosd/apid/src/bus_client.rs:15-19`). mosd's side
declares the same three: `BUS_NAME` (`mosd/mosd/src/bus.rs:25`), `OBJECT_PATH`
(`mosd/mosd/src/bus.rs:27`) and the interface attribute
(`mosd/mosd/src/bus.rs:510`). Which bus is chosen is configuration: `WEBD_BUS`
selects system (the default) or session (`mosd/apid/src/config.rs:41-45`).

**Every method apid calls today — five, across two proxy traits.** The
`com.mos.mosd1` trait (`mosd/apid/src/bus_client.rs:20-25`) declares four; the
power actions are the fifth, `SetValue` on the `com.mos.Item1` trait
(`mosd/apid/src/bus_client.rs:33-36`), written to one action item per verb and
so listed once per verb below:

| Proxy method | Line | mosd's implementation | Called from |
|---|---|---|---|
| `get_settings(path) -> String` | `bus_client.rs:21` | `mosd/mosd/src/bus.rs:249` | the gate (`routes.rs:131`) and the `/`, `/setup`, `/login`, `/network`, `/hostname`, `/ssh` handlers |
| `set_settings(path, value_json)` | `bus_client.rs:22` | `mosd/mosd/src/bus.rs:258` | `/setup`, `/network`, `/hostname`, `/ssh/enable`, `/ssh/keys/*` |
| `get_state(path) -> String` | `bus_client.rs:23` | `mosd/mosd/src/bus.rs:274` | two paths only: `GetState("network")` (`routes.rs:580`) and `GetState("sshd")` (`routes.rs:1045`) |
| `set_value` on `/Actions/reboot` | `bus_client.rs:35`, path at `:40` | `mosd/mosd/src/tree.rs:500` → `mosd/mosd/src/actions.rs:101` | `POST /power/reboot` (`routes.rs:1259`) |
| `set_value` on `/Actions/poweroff` | `bus_client.rs:35`, path at `:41` | `mosd/mosd/src/tree.rs:500` → `mosd/mosd/src/actions.rs:102` | `POST /power/poweroff` (`routes.rs:1260`) |
| `set_transient_root_password(password)` | `bus_client.rs:24` | `mosd/mosd/src/bus.rs:365` | `POST /ssh/password` (`routes.rs:1272`) |

**What apid does not call, and cannot receive.** mosd exposes a seventh method,
`ReportHealth` — `report_health` (`mosd/mosd/src/bus.rs:550`), which the proxy does not declare
(`mosd/apid/src/bus_client.rs:14-21`); its caller in the tree is the boot health
gate, not apid. mosd also emits two signals, and apid subscribes to neither.
`SettingsChanged(path, value_json)` fires after every successful settings write
(`mosd/mosd/src/bus.rs:531-533`, declared at `:727-728`); `ItemsChanged` fires
once per accumulated batch of item-tree changes, declared on `com.mos.Item1`
(`mosd/mosd/src/tree.rs:431`, `:441-442`), served at the service root (`:35`). The
proxy declares **no** `#[zbus(signal)]` member for
either (`mosd/apid/src/bus_client.rs:14-21`), so apid has no push notification
of a settings change from any source, including itself.

**Shape of the client.** All handler code depends on the `SettingsApi` trait
(`mosd/apid/src/settings_api.rs:13-31`), not on zbus, which is what lets the
route tests substitute an in-memory fake (`mosd/apid/src/settings_api.rs:3-4`,
`:35-47`). The real implementation connects lazily and caches the proxy, and
drops the cache on any call error so the next request reconnects; the documented
consequence is that mosd being down surfaces as per-request errors rather than a
crash (`mosd/apid/src/bus_client.rs:23-26`, `:42-59`). A failed call renders a
502 page reading *"The management daemon is unavailable."*
(`mosd/apid/src/routes.rs:650-660`, message at `:656`).

**Who else may call.** The shipped D-Bus policy restricts `com.mos.mosd` to
root in both directions — the default context denies both `send_destination` and
`receive_sender` (`mosd/dist/com.mos.mosd.conf:69-72`) and only `user="root"`
is allowed to own, send and receive (`:74-78`). The file also carries an
explicit extension point describing the block a future non-root apid would need
(`mosd/dist/com.mos.mosd.conf:32-46`) and a deliberately deferred per-method
allowlist (`:48-61`). Note that `docs/design/dashboard.md:1317-1320` cites this
file as permitting *"any local process"* to call it; at `86cd669` that is no
longer true — the code wins, and the policy is root-only.

### 1.4 Authentication as shipped

**Where the credential lives.** One password, stored as an argon2id PHC string
at the settings dot-path `access.webAdmin.password_hash` — the value apid reads through
`password_hash` (`mosd/apid/src/routes.rs:637-643`), typed at
`mosd/mosd-settings/src/model.rs:164-168`. Hashing is argon2id with
default parameters (`mosd/apid/src/auth.rs:13-19`) and verification parses the
PHC string (`mosd/apid/src/auth.rs:22-26`). Nothing else in the crate
authenticates: there is no second credential, no user table, and no reference to
`access.device` in `mosd/apid/src/routes.rs`.

**How a session is established.** `POST /login` verifies the password and, on
success, calls `SessionStore::create` and sets the cookie
(`mosd/apid/src/routes.rs:499-534`). `POST /setup` does the same at the end of
the first-run wizard without a login step (`mosd/apid/src/routes.rs:469-474`).
The store generates 16 random bytes from `OsRng`, hex-encodes them as the id,
computes an HMAC-SHA256 of that id under the persistent signing key, records the
id with an expiry, and returns `<id>.<mac>` as the cookie value
(`mosd/apid/src/session.rs:44-55`).

**Cookie attributes and expiry.** The cookie is named `apid_session`
(`mosd/apid/src/session.rs:18`) and is set as
`Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
(`mosd/apid/src/session.rs:103`); logout re-sets the same attributes with
`Max-Age=0` (`mosd/apid/src/session.rs:108`). Server-side the TTL is 24 hours
(`mosd/apid/src/session.rs:19`), enforced on every verification, with an expired
entry removed as it is found (`mosd/apid/src/session.rs:66-79`). **Sessions live
in memory only** — a `HashMap` in the store (`mosd/apid/src/session.rs:26`) —
so, as the module doc states, *"an apid restart logs everyone out"*
(`mosd/apid/src/session.rs:5-6`). The HMAC signing key, by contrast, is
persisted: 32 bytes at `session.key` in the state directory, generated on first
start with mode `0o600` (`mosd/apid/src/tls.rs:37`, called from `:100`).

**What a request carries.** Only the cookie. The gate extracts it from the
`Cookie` header by prefix match (`mosd/apid/src/session.rs:99-111`) and verifies
signature-then-liveness (`mosd/apid/src/session.rs:57-79`). There is no
`Authorization` header path, no API key, and no token of any kind in the crate.

**The gate.** One middleware, layered over the whole HTTPS router
(`mosd/apid/src/routes.rs:66`), implements three modes
(`mosd/apid/src/routes.rs:126-151`): `/healthz` always passes (`:128-130`);
in **setup mode** — no admin password hash present — only `/setup` passes and
everything else redirects there (`:135-140`); in **normal mode** `/login` and
`/setup` pass and everything else requires a valid session cookie or redirects
to `/login` (`:141-150`). Note the gate calls `GetSettings("access")` on
**every** request (`mosd/apid/src/routes.rs:131`), so every request costs at
least one D-Bus round trip.

**Brute-force accounting.** A single global counter, not per-client, on
access.md §3.3's exponential curve (RFCT-081 replaced the original flat
five-failures/30-seconds rule): the first failure already arms a one-second
window, every consecutive failure doubles it, and the curve caps at 300
seconds and never becomes permanent (`mosd/apid/src/auth.rs`, `backoff_for`
and `LoginGuard`). Riding out a window does not reset the run — only a
successful login does. Admission and accounting are one locked operation
(`LoginGuard::begin_attempt`): each attempt is charged when it is admitted,
so concurrent submissions cannot share one window. The comments state why
per-client tracking was rejected — *"the appliance has one admin password, so
per-client tracking buys nothing against an online guesser"* — and why no
permanent lockout threshold is armed (apid has no physical-presence release
to clear one with).

**TLS material.** The certificate is self-signed and generated on first start
into the state directory: CN `mos`, SANs `DNS:mos`, `DNS:localhost`,
`IP:127.0.0.1` — the certificate is built at `mosd/apid/src/tls.rs:59-67`, with
the private key written mode `0o600` (`mosd/apid/src/tls.rs:37`, called from
`:78`) inside a state directory created mode `0o700`
(`mosd/apid/src/tls.rs:24`). That directory defaults to
`/var/lib/mos/apid` and is overridable by `APID_STATE_DIR`
(`mosd/apid/src/config.rs:38-40`), and is provided by systemd as
`StateDirectory=mos/apid` (`mosd/dist/apid.service:16`). There is no ACME
client, no certificate rotation, and no way to install an operator-supplied
certificate in `mosd/apid/src/tls.rs`.

### 1.5 The model the API must be derived from: mosd's settings and state

An API for this appliance is not a free design: mosd already owns a typed
settings tree and an untyped live-state tree, and both are reachable only
through dot-paths. Sections 2 and 3 must derive from what follows, not invent
alongside it.

**Schema version.** `SCHEMA_VERSION` is **4**, declared at
`mosd/mosd-settings/src/model.rs:11` and stamped into every default tree
(`mosd/mosd-settings/src/model.rs:37`). It is **read-only through the write
path**: a write whose first path segment is `schema_version` is rejected
(`mosd/mosd-settings/src/model.rs:362-364`), and a whole-tree write that would
change it is rejected too (`:372-374`). Documents are migrated forward and
backward through a registered chain (`mosd/mosd-settings/src/migration.rs:46-57`,
public entry point at `:89`).

**Persistence.** TOML at `/var/lib/mos/settings.toml`
(`mosd/mosd-settings/src/store.rs:67`), written atomically through `Store`
(`mosd/mosd-settings/src/store.rs:69-73`). Every struct in the model carries
`#[serde(deny_unknown_fields)]` (for example
`mosd/mosd-settings/src/model.rs:15`, `:49`, `:78`, `:128`, `:139`, `:154`,
`:170`, `:195`, `:205`, `:230`, `:247`, `:308`, `:319`), so an unknown key
fails the load rather than being silently dropped.

**The settings subtrees, from `struct Settings`
(`mosd/mosd-settings/src/model.rs:16-32`):**

| Dot-path | Type | Declared at | Contents |
|---|---|---|---|
| `schema_version` | `u32` | `model.rs:18` | read-only, value 4 |
| `hostname` | `String` | `model.rs:20` | system hostname, default `"mos"` (`model.rs:38`) |
| `network.<iface>` | `IfaceSettings` | `model.rs:22`, type at `:309-315` | `dhcp: bool`, optional `static` block (`address`, `gateway`, `dns[]`) at `:320-329` |
| `access.webAdmin` | `Option<WebAdminSettings>` | `model.rs:52-53`, type at `:68-71` | `password_hash` only; absent until first-run setup writes it |
| `access.ssh` | `SshSettings` | `model.rs:55-56`, type at `:79-106` | `enabled` (default `false`, `:110-112`), `port`, `permitRootLogin`, `passwordAuthentication`, `listenAddresses[]`, `authorizedKeys[]` (`:105`, entry type at `:129-135`) |
| `access.console` | `ConsoleSettings` | `model.rs:58-59`, type at `:140-145` | `shellEnabled` |
| `access.device` | `DeviceCredentialSettings` | `model.rs:61-62`, type at `:155-166` | `passwordHash` (optional) and `generation`; never a plaintext secret (`:149-152`) |
| `provisioning` | `ProvisioningSettings` | `model.rs:27-28`, type at `:171-180` | `state` (`pending` \| `complete`, `:185-191`), `deviceId`, `seededGeneration` |
| `wifi.client` | `WifiClientSettings` | `model.rs:198-199`, type at `:206-216` | `enabled`, `interface`, `networks[]` (entry at `:231-243`) |
| `wifi.ap` | `WifiApSettings` | `model.rs:200-201`, type at `:248-275` | `mode` (`off` \| `provisioning` \| `always`, `:296-304`), `interface`, `ssid`, `psk`, `channel`, `countryCode`, `address`, `holdDownSeconds`, `graceSeconds` |

**Two properties of the write path an API author needs.** First, a write is
**validated against the typed tree before it is persisted**: `SetSettings`
builds a candidate, calls `Settings::set` — which deserializes the whole root
into a candidate `Self` (`mosd/mosd-settings/src/model.rs:465-469`) — and only then
calls `store.save` (`mosd/mosd/src/bus.rs:430-435`), so a malformed write
mutates nothing. Second, **the dot-path syntax has no array indexing**: the
model comment says a list is *"Written as a whole JSON array through the
dot-path API"* (`mosd/mosd-settings/src/model.rs:311`), which is exactly why
the SSH pane reads the whole key list, edits it in memory, and writes the whole
list back (`mosd/apid/src/routes.rs:1061-1080`).

**Which reconcilers a write re-runs.** `SetSettings` re-applies every reconciler
whose subtree overlaps the written path (`mosd/mosd/src/bus.rs:205-210`), where
overlap is segment-wise prefix in either direction and the root matches
everything (`mosd/mosd/src/bus.rs:27-42`). Five reconcilers are registered in
production (`mosd/mosd/src/reconciler/mod.rs:28-36`), with these
name/subtree pairs:

| Reconciler `name()` | `subtree()` | Declared at |
|---|---|---|
| `hostname` | `hostname` | `mosd/mosd/src/reconciler/hostname.rs:52-58` |
| `network` | `network` | `mosd/mosd/src/reconciler/network.rs:100-106` |
| `sshd` | `access.ssh` | `mosd/mosd/src/reconciler/sshd.rs:387-393` |
| `wifiClient` | `wifi.client` | `mosd/mosd/src/reconciler/wifi_client.rs:453-459` |
| `wifiAp` | `wifi.ap` | `mosd/mosd/src/reconciler/wifi_ap.rs:718-724` |

**The live-state tree.** It is a plain `serde_json::Value`, not a typed model
(`mosd/mosd/src/bus.rs:52-53`), and `GetState` returns the subtree at a dot-path
or `InvalidArgs` (`mosd/mosd/src/bus.rs:538-542`). Four kinds of thing write into
it, and that set is the entire read surface an API can expose:

1. **One key per reconciler**, named by `name()` above, holding that
   reconciler's applied result, or `{"error": "..."}` when it failed
   (`mosd/mosd/src/bus.rs:437-441`, `:453-455`).
2. **`power`** — `{last_action, requested_by}`, recorded *before* the action so
   the record survives the machine going down (`mosd/mosd/src/bus.rs:188-192`).
3. **`health.<component>`** — `{status, detail}`, written by the `ReportHealth` method
   (`mosd/mosd/src/bus.rs:546`, `:550`).
4. **`dry_run`** — present only when `MOSD_DRY_RUN=1`
   (`mosd/mosd/src/main.rs:18`, `:145`, `:227-228`), in which case no reconcilers are
   registered at all (`:71-75`) and the power control is a stub (`:78-82`).

Of that surface, apid reads exactly two paths today: `network` and `sshd`
(section 1.3). The rest is reachable over the bus and unexposed over HTTP.

**Vocabulary this document inherits from `access.md`.** Sections 4-6 need three
things already settled there and must not restate them differently: the status
markers (`docs/design/access.md:23-30`), the **eight bind mounts** the image
ships and their STATE/DATA tiers (`docs/design/access.md:476-492`), and the
**survives-what table** for reboot, A/B update and factory reset
(`docs/design/access.md:500-508`). Two of its rows bear directly on section 5:
`/home`, `/root` and `/srv` are DATA and survive both a reboot and an A/B update
because RAUC writes only ROOTFS and BOOT (`docs/design/access.md:505`), while
arbitrary `/etc` edits survive nothing because `/` is a verity squashfs outside
the eight bind points (`docs/design/access.md:506`). The governing rule for
section 5 is stated at `docs/design/access.md:468-474`: *"An unmodelled setting
is an unsupported setting."*

### 1.6 Static assets today

**apid serves no static asset of any kind, from anywhere.** This is an absence,
so it is evidenced four ways, all measured at `86cd669`:

1. **No static-file middleware is a dependency.** The crate's dependency list is
   `mosd/apid/Cargo.toml:11-29` and contains no `tower-http`; `tower` itself
   appears only under `[dev-dependencies]` (`mosd/apid/Cargo.toml:31-34`). The
   workspace pins `tower` with only the `util` feature (`mosd/Cargo.toml:46`),
   which carries no file-serving service.
2. **No file-serving service is constructed.** `grep -n "ServeDir\|ServeFile"
   mosd/apid/src/*.rs` returns nothing, and the HTTPS router
   (`mosd/apid/src/routes.rs:44-68`) declares no `nest_service`, no
   `fallback_service` and no `fallback` at all — the only `fallback` in the file
   is the HTTP redirect router's (`mosd/apid/src/routes.rs:74`).
3. **Nothing is embedded in the binary.** `grep -n "include_str!\|include_bytes!"
   mosd/apid/src/*.rs` returns nothing.
4. **There is no asset to serve.** The crate contains no non-Rust file other
   than its manifest (`find mosd/apid -type f ! -name '*.rs'` returns
   `mosd/apid/Cargo.toml`), and the crate has no `assets/`, `static/` or
   `public/` directory (`find mosd/apid -type d` returns `mosd/apid`,
   `mosd/apid/src` and `mosd/apid/tests`).

What the pages need instead is inlined: the single stylesheet is a `&str`
constant emitted into the page head (`mosd/apid/src/routes.rs:741-746`), from a
constant described in the source as *"Inline stylesheet shared by every page; no
external assets"* (`mosd/apid/src/routes.rs:719`). There is no favicon route, no font,
and no image: a request for `/favicon.ico` matches nothing in
`mosd/apid/src/routes.rs:44-68`, so it is answered by the gate — a redirect to
`/login` when unauthenticated (`mosd/apid/src/routes.rs:149`), and otherwise
axum's default not-found.

The consequence for section 4 is concrete rather than stylistic: static hosting
is not a matter of pointing an existing middleware at a directory. Nothing in
the crate reads a file off disk to serve it today, and the only disk paths it
touches at all are `/proc/uptime` (`mosd/apid/src/routes.rs:1216`) and its own
state directory (`mosd/apid/src/tls.rs:48-49`, `:86`).

### 1.7 What the dashboard proposal already settled

`docs/design/dashboard.md` is the merged dashboard proposal — the landing
dashboard, the information architecture behind it, the live-update posture that
supports them, and a phased delivery order (`docs/design/dashboard.md:3-5`) —
and this document must not re-decide what it decided. Three things are settled
there and are treated as inputs here. **Live values:** section 5.8 adopts
*"option A — full-page refresh — as the dashboard's only live-value mechanism,
at a 15-second default interval, with a no-JavaScript off switch"*
(`docs/design/dashboard.md:1305-1306`), on the grounds that mosd has no
live-state push signal at all and that a no-JavaScript path must keep working;
it explicitly names what that forecloses, including any sub-15-second value and
all client-side UI state (`docs/design/dashboard.md:1304-1315`). **Process
architecture, and the name:** *"mos runs two processes"* — mosd owning device
state and the system bus, apid owning HTTPS, sessions and the UI, and apid not
merged into mosd — and the HTTPS management daemon is named `apid`
(`docs/design/dashboard.md:8-10`). **The bus as a contract:** `com.mos.mosd1`
stays served whatever the UI does, because the boot health gate is a second
consumer calling it directly
(`os/rootfs/overlay-v2/usr/lib/mos/mos-health:47-48`, `:209-213`), and its
failure path is an A/B rollback. This document therefore assumes a
server-rendered no-JavaScript built-in UI, two processes, a bus that keeps
existing, and the name `apid`; a section below that needs any of those to change
must say so and say why, rather than quietly assuming it.

**Where this section agrees with the earlier inventory, and where that inventory
has gone stale.** `docs/research/mos-ui-inventory.md` measured the same surface
at commit `d0bcae92656257021bb67bf7db72b8ac5bfb4651`
(`docs/research/mos-ui-inventory.md:7`), which is **not** this document's base.
It **agrees** with everything measured here about the technology posture —
server-rendered maud, zero JavaScript, rustls-only TLS, listeners on
`0.0.0.0:443` and `0.0.0.0:80` — and about the shape of the session mechanism
and of the settings dot-path model. It has gone **stale** in six ways, and in
each case the tree at `86cd669` is the fact:

1. **Line numbers throughout its section 2.1 no longer resolve.** It cites
   `GET /` at route `:42` and handler `:566`; at `86cd669` those are
   `mosd/apid/src/routes.rs:45` and `:578`.
2. **Its route table is missing five routes.** `GET /ssh`, `POST /ssh/enable`,
   `POST /ssh/password`, `POST /ssh/keys/add` and `POST /ssh/keys/remove` all
   exist at `mosd/apid/src/routes.rs:57-64`. Its own section 8 predicted exactly
   this and instructed a re-measure after the `sshweb` merge
   (`docs/research/mos-ui-inventory.md:616-631`) — which is the merge this
   document's base commit is.
3. **"Six methods and one signal"** (`docs/research/mos-ui-inventory.md:367`) is
   now seven methods: `SetTransientRootPassword` exists at
   `mosd/mosd/src/bus.rs:283` and apid calls it
   (`mosd/apid/src/bus_client.rs:20`, `mosd/apid/src/routes.rs:1272`).
4. **"the sole call site is `GetState("network")`"**
   (`docs/research/mos-ui-inventory.md:373`) is now two call sites; `GetState("sshd")`
   is at `mosd/apid/src/routes.rs:1045`.
5. **Schema version "3"** (`docs/research/mos-ui-inventory.md:397`) is now
   **4** (`mosd/mosd-settings/src/model.rs:11`).
6. **Its section 3.6 quotes a D-Bus policy that permits any local process**
   (`docs/research/mos-ui-inventory.md:344-355`); the shipped policy at
   `86cd669` denies the default context in both directions and allows root only
   (`mosd/dist/com.mos.mosd.conf:63-72`). `docs/design/dashboard.md:1317-1320`
   carries the same stale reading.

Its navigation-bar count is likewise off by one — it records *"exactly four
links plus a logout button"* (`docs/research/mos-ui-inventory.md:65`), and
`shell()` now renders five plus the logout form
(`mosd/apid/src/routes.rs:180-189`). Nothing in its section 9 contradiction
table was re-verified here; that table is cited, not carried forward.

## 2. The API surface — **[proposed]**

Nothing in this section exists. Section 1 measured the surface at `86cd669`
and found nineteen method+path pairs of which **none** return or accept JSON
(section 1.2); this section proposes the one that should. Every claim below
about what apid or mosd does *today* is anchored to `86cd669` and cited;
everything else is a proposal and is marked as one.

### 2.1 Versioning and path shape — **[proposed]**

**Shape.** `/api/v1/<...>`. JSON in, JSON out, `Content-Type: application/json`
in both directions. The nineteen existing paths (section 1.2) keep their method,
their path and their behaviour unchanged; `/api/` is a prefix nothing currently
serves — the HTTPS router declares no route under it and no fallback at all
(`mosd/apid/src/routes.rs:115-192`), so at `86cd669` every `/api/...` request is handled
by the gate, which redirects it to `/login` when unauthenticated
(`mosd/apid/src/routes.rs:719`) and otherwise falls through to axum's default
not-found. The API prefix is therefore free.

**The version lives in the path segment immediately after `/api/`.**
Recommended, for three reasons that are properties of this codebase rather than
general taste:

1. The gate already dispatches on `request.uri().path()`
   (`mosd/apid/src/routes.rs:669`). A version check is the same string operation
   the one existing middleware already performs, so it needs no new extractor
   and no new failure mode in the layer that guards everything
   (`mosd/apid/src/routes.rs:191`).
2. axum registers routes by path (`mosd/apid/src/routes.rs:115-192`). A second
   major version is a second `Router` under `/api/v2`, served from the same
   process and the same listener, with no per-handler branching and no shared
   handler that has to ask which version called it.
3. It survives `curl` and a browser address bar with no header plumbing. That
   matters concretely here: SSH is off by default and stays off until an
   authenticated admin action (`mosd/mosd-settings/src/model.rs:110-112`,
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
redirect, which preserves path *and* query
(`mosd/apid/src/routes.rs:632-637`) — that is not the objection. The
objection is that an absent parameter must default to something, and the only
safe default is to refuse, which turns a forgotten parameter into an error on a
path that otherwise looks correct. An unknown path prefix is a 404 that names
itself.

**What a version bump means.** `v1` → `v2` happens only on a change that can
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
| `GET /api/v1/meta` | required | `{"api":"v1","settingsSchemaVersion":4,"daemon":"apid"}` | "what am I talking to, in detail?" |

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

`settingsSchemaVersion` carries mosd's `SCHEMA_VERSION`
(`mosd/mosd-settings/src/model.rs:11`, value **4** at `86cd669`). **It is not
the API version and the two must never be conflated.** The schema version is the
shape of the tree on disk (`mosd/mosd-settings/src/store.rs:67`), moved by a
registered migration chain (`mosd/mosd-settings/src/migration.rs:46-57`, entry
point at `:89`) and read-only through the write path
(`mosd/mosd-settings/src/model.rs:362-364`, `:372-374`). The API version is the
shape of this HTTP contract. Either can move without the other, and a client
that writes settings-shaped bodies (§2.2) needs both.

**Why `/api/versions` is unauthenticated, and what that costs.** Section 6 of
this document requires a UI to be able to detect that it cannot talk to the API
version it found. That check has to run *before* the UI has a credential: a UI
installed on DATA survives the A/B update that replaced apid
(`docs/design/access.md:505`), and on a factory-fresh device there is no
`access.webAdmin` at all (`mosd/mosd-settings/src/model.rs:52-53`), so the gate
is in setup mode and redirects everything except `/setup`
(`mosd/apid/src/routes.rs:701-706`). An authenticated probe cannot answer the
question it exists to answer. The cost is an unauthenticated fingerprint:
anyone who can reach port 443 (`mosd/apid/src/config.rs:34-37`) learns which API
major versions this device speaks. The appliance already answers `/healthz` with
the literal `ok` unauthenticated (`mosd/apid/src/routes.rs:674`, `:722-724`),
so this is one more bit on a listener that already identifies itself — it is not
zero, and it is exactly why the response carries a version list and nothing
else: not the hostname, not the device identity
(`mosd/mosd-settings/src/model.rs:281-283`), not a build string.

**What apid promises across a patch release versus an A/B image update.** The
honest starting point is that **there is no apid patch release independent of an
image update.** The binary is `/usr/bin/apid` (`mosd/dist/apid.service:14`), and
`/` is a verity-protected squashfs (`docs/design/access.md:468-474`); RAUC
writes only the ROOTFS and BOOT slots (`docs/design/access.md:504`). Every
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
  bump breaks is installed on DATA and *survived* the update that broke it
  (`docs/design/access.md:505`), and the operator's route to fixing it may be
  that same UI. The cost is two route trees in one binary, two sets of handlers
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

### 2.2 Resource model — **[proposed]**

Derived from `mosd/mosd-settings/src/model.rs` and `mosd/mosd/src/bus.rs` as
measured at `86cd669`, with one exception this preamble has to name rather
than leave its own rows to contradict it: the two rows describing
`/api/v1/actions/<verb>` cite `mosd/mosd/src/actions.rs`, a file that did not
exist at `86cd669`, and they — together with this section's two
`SetTransientRootPassword` citations — are measured at `d599cad` instead.
Every other line citation in this section has been re-measured against the
current tree. Nothing here invents a model alongside mosd's; where the settings
tree and a sensible REST resource genuinely disagree, the disagreement is named
and the choice is costed.

**Three roots, because mosd has three things and not one.**

| Root | Backed by | Methods | Why it is separate |
|---|---|---|---|
| `/api/v1/settings/<dot-path>` | the typed `Settings` tree (`mosd/mosd-settings/src/model.rs:16`) via `GetSettings` and `SetSettings` — `get_settings` (`mosd/mosd/src/bus.rs:513`) and `set_settings` (`:522`) | `GET`, `PUT` | typed, validated, persisted to `/var/lib/mos/settings.toml` (`mosd/mosd-settings/src/store.rs:67`), survives reboot and A/B update (`docs/design/access.md:504`) |
| `/api/v1/state/<dot-path>` | the live-state tree via `GetState` — `get_state` (`mosd/mosd/src/bus.rs:538`) | `GET` only | an untyped `Value` (`mosd/mosd/src/bus.rs:53`), in memory, written only from inside mosd by the four writers section 1.5 names |
| `/api/v1/actions/<verb>` | the `/Actions/reboot` and `/Actions/poweroff` items (`mosd/mosd/src/actions.rs:46-47`), and `SetTransientRootPassword` — `set_transient_root_password` (`mosd/mosd/src/bus.rs:703`) | `POST` only | not state at all — see §2.3 |

The split is mosd's, not a stylistic preference. The two trees have different
types (`settings: Settings` and `state: Value`, `mosd/mosd/src/bus.rs:52-53`),
different mutability (`SetSettings` exists; there is no `SetState` anywhere in
the proxy trait, `mosd/apid/src/bus_client.rs:20-25`, nor in mosd's interface
impl, `mosd/mosd/src/bus.rs:510-725`), and different lifetimes (the settings tree
is saved atomically on every write, `mosd/mosd/src/bus.rs:434`; the live-state
tree is a field of `Inner` that starts empty or as `{"dry_run": true}`,
`mosd/mosd/src/bus.rs:63-64`, `mosd/mosd/src/main.rs:90-93`). An API that merged
them would have to decide on every request which half a path belonged to.

**The dot-path is the resource identifier, verbatim.** `GET
/api/v1/settings/access.ssh` returns exactly what `GetSettings("access.ssh")`
returns (`mosd/mosd/src/bus.rs:513-517`). `PUT /api/v1/settings/hostname` with
body `"router"` performs exactly one `SetSettings("hostname", "\"router\"")` call, which parses
the JSON and writes it at the path (`mosd/mosd/src/bus.rs:528-530`). This is
the recommendation, and the
alternative it rejects is the interesting part.

**Rejected: hand-shaped REST nouns that do not map onto the tree** (`GET
/api/v1/ssh`, `PATCH /api/v1/network/eth0`). What it costs is not extra code —
it is a second model that has to be kept in sync with `model.rs` by hand. Every
field added to `Settings` is invisible over the API until someone also adds it
to the resource layer, and a field that is invisible over the API is, by this
project's own rule, unsupported: *"An unmodelled setting is an unsupported
setting"* (`docs/design/access.md:535`). Hand-shaped nouns reproduce exactly
that failure one layer up, where nothing — no compiler, no
`deny_unknown_fields` (`mosd/mosd-settings/src/model.rs:15`, `:49`, `:78`, and
ten more) — will ever notice the omission. The passthrough cannot drift, because
there is nothing to drift from.

**What the passthrough costs, stated plainly.** The API becomes exactly as
capable as the bus, including the bus's limits:

- **No array indexing.** The dot-path syntax has none; the model says a list is
  *"Written as a whole JSON array through the dot-path API"*
  (`mosd/mosd-settings/src/model.rs:311`). Every client that wants to add
  one SSH key must read `access.ssh.authorizedKeys`, append, and write the whole
  list back — which is precisely what the HTML pane does today
  (`mosd/apid/src/routes.rs:2558-2571`). Two clients doing that concurrently
  lose one of the two writes, with no mechanism that notices.
- **Whole-subtree writes are all-or-nothing.** `Settings::set` deserializes the
  entire root into `Settings` after the write and rejects the result if it does
  not fit (`mosd/mosd-settings/src/model.rs:367-371`), and every struct carries
  `#[serde(deny_unknown_fields)]`, so a `PUT` of a subtree with one extra key
  fails the whole write. That is a good property — it is also a surprising one
  for a client that expected a merge.
- **A dot in a value collides with a dot in the path.** Verified at `86cd669`:
  apid accepts an interface name containing `.`
  (`mosd/apid/src/routes.rs:806-811` permits `.`, `_` and `-`), but `split_path`
  splits on `.` unconditionally (`mosd/mosd-settings/src/path.rs:26-32`), so
  `network.eth0.100` — a VLAN sub-interface — lands as a field named `100`
  inside `IfaceSettings` and is rejected by `deny_unknown_fields`
  (`mosd/mosd-settings/src/model.rs:405-407`). Running `Settings::set` against a
  default tree with that path returns `Validation { path: "network.eth0.100",
  message: "unknown field `100`, expected `dhcp` or `static`" }`. This is a
  **pre-existing** limit of the dot-path model, not one the API introduces — the
  HTML form has it too — but an API that adopts the dot-path adopts it, and a
  client must be told rather than left to discover it as a 502 (§2.4).

**The exception: two collection resources, added deliberately.** The dot-path
model fails outright for the two arrays in the tree, because a per-item delete
cannot be expressed as a settings write at all. Both get a named collection:

| Collection | Underlying dot-path | Item identity | Routes |
|---|---|---|---|
| SSH authorized keys | `access.ssh.authorizedKeys` — `authorizedKeys` (`mosd/mosd-settings/src/model.rs:202-203`) | SSH fingerprint | `GET`/`POST /api/v1/ssh/authorized-keys`, `DELETE /api/v1/ssh/authorized-keys/{fingerprint}` |
| WiFi client networks | `wifi.client.networks` — `networks` (`mosd/mosd-settings/src/model.rs:313`) | `ssid` | `GET`/`POST /api/v1/wifi/client/networks`, `DELETE /api/v1/wifi/client/networks/{ssid}` |

**Identity is never a list index.** The reason is already recorded in the crate,
and it is the reason here too: *"an index is only meaningful against the list the
operator was looking at, so a key added or removed by another session between the
render and the submit would slide it onto a different key and delete something
nobody asked to delete"* (`mosd/apid/src/routes.rs:2569-2572`). A `DELETE` whose
identifier matches nothing is an error, not a silent success, for the reason the
same comment gives: *"'removed' when nothing was removed is how an operator ends
up believing access was withdrawn while the key still grants root."*

**What the exception costs.** There are now two ways to write the same state:
`PUT /api/v1/settings/access.ssh.authorizedKeys` and `DELETE
/api/v1/ssh/authorized-keys/{fingerprint}`. A client using the first can produce
a list the second would have rejected. The floor is the same either way, because
both end at `SetSettings` → `Settings::set` → `store.save`
(`mosd/mosd/src/bus.rs:430-435`), and the collection route additionally runs
`validate_authorized_keys` first — the same validator mosd runs before rendering
the file (`mosd/apid/src/routes.rs:1885-1889`). So the difference is the quality
of the error message, not whether a bad list can be written. That is an
acceptable cost and it is named rather than hidden. The passthrough route must
**not** be removed for these two paths: removing it would make the collection the
only way in, and a client that needs to replace a whole list atomically would
have to issue N deletes and M posts with no atomicity at all.

**Redaction is a rule of this root, not of a handler.** As of `86cd669`,
`GetSettings("access")` returns the subtree verbatim
(`mosd/mosd/src/bus.rs:182-186`), and the admin hash lives under it as
`password_hash` (`mosd/mosd-settings/src/model.rs:167-168`). A settings
passthrough with no redaction therefore hands the admin password hash — and
`access.device.passwordHash` (`:158-163`), `wifi.ap.psk` (`:260-261`) and every
`wifi.client.networks[].psk` (`:235-236`) — to any authenticated API caller. The
rule: **every `GET` under `/api/v1/settings/` passes the value through a
structural redactor before serialising it**, replacing the value of any field
named `password_hash`, `passwordHash`, `psk`, or `hash` — anywhere in the tree,
at any depth — with the sentinel `"<redacted>"`. It must be structural rather
than a list of dot-paths, because the two `psk` fields sit inside arrays and the
dot-path syntax cannot name them (`mosd/mosd-settings/src/model.rs:213-214`).
The residual risk is stated: this is a denylist, so a future secret-bearing field
under a name not on it is exposed by default. That is a fail-open design and the
mitigation is a test, not a hope. A redacted field is
**read-only through the API**: a `PUT` whose body contains `"<redacted>"` is
rejected at 422 rather than written, because writing the sentinel would silently
destroy the credential.

**The resource inventory.** Every subtree in section 1.5's table, mapped:

| Concern | API resource | Backing | Notes |
|---|---|---|---|
| System / identity | `GET /api/v1/settings/provisioning` | `ProvisioningSettings` (`model.rs:171-180`) | `state`, `deviceId`, `seededGeneration`; written by first-boot provisioning, not by an operator |
| Schema version | `GET /api/v1/meta` | `SCHEMA_VERSION` (`model.rs:11`) | read-only; a write to `schema_version` is rejected by mosd (`model.rs:362-364`) so the API does not expose one |
| Hostname | `GET`/`PUT /api/v1/settings/hostname` | `String` (`model.rs:20`) | body is a bare JSON string; reconciled by `hostname` (`mosd/mosd/src/reconciler/hostname.rs:52-58`) |
| Network | `GET`/`PUT /api/v1/settings/network`, `.../network.<iface>` | `BTreeMap<String, IfaceSettings>` (`model.rs:22`, `:309-315`) | see the VLAN dot collision above |
| WiFi station | `GET`/`PUT /api/v1/settings/wifi.client` + the networks collection | `WifiClientSettings` (`model.rs:206-216`) | `psk` redacted on read |
| WiFi AP | `GET`/`PUT /api/v1/settings/wifi.ap` | `WifiApSettings` (`model.rs:248-275`) | `psk` redacted on read; `mode` is `off`/`provisioning`/`always` (`:296-304`) |
| SSH enable state and policy | `GET`/`PUT /api/v1/settings/access.ssh`, `.../access.ssh.enabled` | `SshSettings` (`model.rs:79-106`) | default `enabled: false` (`:110-112`) |
| SSH keys | the authorized-keys collection above | `access.ssh.authorizedKeys` | **every key is a root key** (`docs/design/access.md` §4.1, `mosd/apid/src/routes.rs:1762`); the API response must carry that sentence in a `notice` field for the same reason the pane must carry it |
| Transient root password | `POST /api/v1/actions/transient-root-password` | `set_transient_root_password` (`mosd/mosd/src/bus.rs:703`) | an action, not a setting — see §2.3 |
| Web admin credential | `GET /api/v1/settings/access.webAdmin` (redacted), `PUT` refused | `WebAdminSettings` (`model.rs:68-71`) | see §3.2 for why the API does not offer a password change in phase 1 |
| Console | `GET`/`PUT /api/v1/settings/access.console` | `ConsoleSettings` (`model.rs:140-145`) | only the `debug` image ships the shell at all (`model.rs:141-142`) |
| Power | `POST /api/v1/actions/reboot`, `.../poweroff` | the `/Actions/reboot`/`/Actions/poweroff` items (`mosd/mosd/src/actions.rs:46-47`) | actions — see §2.3 |
| Reconciler results | `GET /api/v1/state/<name>` for `hostname`, `network`, `sshd`, `wifiClient`, `wifiAp` | one key per reconciler (`mosd/mosd/src/bus.rs:437-441`, `:453-455`) | an entry is either the applied result or `{"error": "..."}`; the API passes both through unchanged |
| Last power request | `GET /api/v1/state/power` | the keys `last_action` and `requested_by` (`mosd/mosd/src/bus.rs:191-192`) | recorded *before* the action, so it survives the machine going down |
| Health | `GET /api/v1/state/health` and `GET /api/v1/health` | the `health` subtree, one key per component (`mosd/mosd/src/bus.rs:546`) | the two are different questions — see §2.4 |
| Dry-run marker | `GET /api/v1/state/dry_run` | present only under `MOSD_DRY_RUN=1` (`mosd/mosd/src/main.rs:18`, `:145`, `:227-228`) | in that mode no reconcilers are registered at all (`:71-75`), so every other state key is absent |

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
3. **Uptime is not in either tree.** `GET /` reads `/proc/uptime` in apid
   (`mosd/apid/src/routes.rs:1223`) — one of only two disk paths apid touches
   outside its own state directory (section 1.6). Exposing it over the API means
   either apid keeps reading it, which contradicts the rule the crate states
   about itself — *"mosd owns every system action: apid never spawns a process
   and never talks to systemd itself"* (`mosd/apid/src/settings_api.rs:10-12`) —
   or mosd publishes it into the live-state tree and the API reads it there.
   **Chosen: mosd publishes it**, and until it does, uptime has no API
   representation. Cost: the API is missing a field the HTML status pane shows,
   until a mosd change lands.

### 2.3 Operation inventory: today's form posts, tomorrow's API — **[proposed]**

Input is section 1.2's route table, measured at `86cd669`. One row per
method+path that exists today.

| Today (at `86cd669`) | Form POST? | API equivalent | Request → response |
|---|---|---|---|
| `GET /` (`routes.rs:45`) | — | **none, deliberately.** It is a rendering, not data. Its inputs are `GET /api/v1/settings/hostname`, `GET /api/v1/state/network`, and uptime (which has none — §2.2) | — |
| `GET /setup` (`:46`) | — | **none** — a form. Its data is `GET /api/versions` plus the 409 condition below | — |
| `POST /setup` (`:381`) | yes | `POST /api/v1/setup` | `{"password": "...", "hostname": "...", "network": {...}}` → `201` with `{"token": "..."}` (§3.2), `409` when already configured (`:386-395`), `422` on any validation failure. **Unauthenticated by necessity** — it is the only route the gate lets through in setup mode (`:135-140`) |
| `GET /login` (`:47`) | — | **none** — a form | — |
| `POST /login` (`:499`) | yes | **none for the API.** §3.2 authenticates with a bearer token, not a session; minting a token is `POST /api/v1/tokens`, which is a different operation with a different lifecycle | — |
| `POST /logout` (`:535`) | yes | **none.** The API has no session to drop. The nearest operation is `DELETE /api/v1/tokens/{id}`, which is revocation, not logout — it is permanent and it affects every holder of that token, not one browser | — |
| `GET /network` (`:698`) | — | `GET /api/v1/settings/network` | → `{"eth0": {"dhcp": true}, ...}` |
| `POST /network` (`:708`) | yes | `PUT /api/v1/settings/network.<iface>` | `{"dhcp": true}` or `{"dhcp": false, "static": {"address": "...", "gateway": "...", "dns": [...]}}` → `204`; `422` on an invalid name or CIDR (apid's own validators, `:273-281`) |
| `GET /hostname` (`:757`) | — | `GET /api/v1/settings/hostname` | → `"mos"` |
| `POST /hostname` (`:908`) | yes | `PUT /api/v1/settings/hostname` | `"router"` → `204`; `422` from `valid_hostname` (`:262-270`) |
| `GET /power` (`:853`) | — | **none** — a confirmation form. Its only content is two constant tokens (`:790-796`) | — |
| `POST /power/reboot` (`:896`) | yes | `POST /api/v1/actions/reboot` | `{}` → **`202 Accepted`**, matching today (`:890`) |
| `POST /power/poweroff` (`:900`) | yes | `POST /api/v1/actions/poweroff` | `{}` → **`202 Accepted`** |
| `GET /ssh` (`:1200`) | — | `GET /api/v1/settings/access.ssh` + `GET /api/v1/state/sshd` | two calls, because the pane merges two trees (`:1034-1058`) |
| `POST /ssh/enable` (`:1216`) | yes | `PUT /api/v1/settings/access.ssh.enabled` | `true` → `204` |
| `POST /ssh/password` (`:1261`) | yes | `POST /api/v1/actions/transient-root-password` | `{"password": "..."}` → `204`; `422` from `validate_transient_password` (`:1240-1255`) |
| `POST /ssh/keys/add` (`:1284`) | yes | `POST /api/v1/ssh/authorized-keys` | `{"key": "<type> <blob> [comment]"}` → `201` with the parsed entry and its fingerprint; `422` on a rejected key |
| `POST /ssh/keys/remove` (`:1317`) | yes | `DELETE /api/v1/ssh/authorized-keys/{fingerprint}` | → `204`; `404` when nothing matches (`:1329-1335` is a 422 today; see below) |
| `GET /healthz` (`:65`, `:153`) | — | **none, and it must not change.** See below | — |
| every path on the HTTP listener (`:72-76`) | — | unchanged: 308 to the HTTPS origin (`:78-95`), API paths included | — |

**Actions, not resources.** Three operations are verbs with no state to `GET`
and no idempotency to promise: `reboot`, `poweroff` and
`transient-root-password`. They live under `/api/v1/actions/<verb>`, `POST`
only, and the namespace is named `actions` precisely so that no reader expects a
`GET` to work there. This mirrors a decision already made in the HTML router and
commented in the source: no `GET` handler exists for either power action
(`mosd/apid/src/routes.rs:159-161`) or for any of the four SSH mutations
(`:58-60`), *"so a browser prefetch, a crawler or a mis-clicked link cannot power
the appliance off"*.

The **confirmation token** that guards the three form posts today
(`mosd/apid/src/routes.rs:1674`, and `TRANSIENT_CONFIRM_TOKEN` at `:1766`) does
**not** carry over to the API. It is a constant string, not a secret and not
per-session; it exists to stop a mis-click on a rendered page. There is no
mis-click on a `POST` a script constructed, and requiring a client to send a
constant it read out of this document is a ritual, not a control. What replaces
it is nothing: the bearer token (§3.2) *is* the authorisation, and a caller who
holds it and posts to `/api/v1/actions/poweroff` meant it. This is a real
reduction in friction and it is stated as such — a script with a token can power
the appliance off in one request with no second step.

`POST /api/v1/actions/reboot` returns **202**, not 204, for the same reason the
form path does: the D-Bus call is spawned on a detached task so the response
goes out before the machine goes down (`mosd/apid/src/routes.rs:1693-1707`). 202
is the honest code — the request was accepted, and whether it completed is not
knowable over the connection that asked.

**Operations with no API equivalent, and why.**

- **The seven `GET` pages.** They are renderings. Their data is covered by
  `settings` and `state` reads; the markup is not an API concern. §5 and §6 own
  what replaces them.
- **`POST /login` and `POST /logout`.** A session is a browser mechanism (§3.1).
  Their nearest API operations — minting and revoking a token — differ in
  lifetime, in count and in blast radius, so calling them equivalents would
  mislead.
- **`GET /healthz`** — declared at `mosd/apid/src/routes.rs:176` and answering
  at `:722-724`. It keeps its path, its unauthenticated exemption (`:674`) and
  its literal `ok` body,
  unchanged and unversioned, because it has a real consumer with a real failure
  path: the boot health gate probes `https://127.0.0.1/healthz` with curl and
  falls back to wget (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:219-232`),
  and the image verifier asserts an HTTP client for that probe exists
  (`os/verify/src/checks-system.ts:461-470`). Moving it under `/api/v1/` would put a
  version bump in the path of the boot gate whose failure is an A/B rollback
  (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:257-260`).
  **But it answers a narrower question than its name suggests, and the API must
  not repeat the mistake.** `/healthz` returns before any check
  (`mosd/apid/src/routes.rs:674`), so it answers `ok` on an appliance whose
  mosd is dead. `GET /api/v1/health` is the API's health endpoint and reports
  both halves — see §2.4.
- **A password change.** `access.webAdmin.password_hash` is written by exactly
  one handler, `setup_submit`, which writes the hash at
  `mosd/apid/src/routes.rs:1024`, and
  there is no change-password route anywhere in the crate. The API does not
  invent one: it would be the first operation the API offers that the UI does
  not, and it needs a decision about whether changing the password revokes
  tokens (§3.2 says it does not).
- **`ReportHealth`.** mosd exposes it (`mosd/mosd/src/bus.rs:231`) and apid does
  not declare it on the proxy (`mosd/apid/src/bus_client.rs:20-25`). The API does
  not expose it either: its caller is the boot health gate, a root-local process
  that already has the bus, and turning it into an HTTP write would let any token
  holder forge a component's health status.

**One behaviour change the API should make, named because it is a change.**
`ssh_key_remove` answers **422** when the identifier matches nothing
(`mosd/apid/src/routes.rs:2590-2596`, via `ssh_error` at `:1893-1902`). For a
`DELETE` on a collection resource that is a **404** — the identified item does
not exist. The API uses 404. The HTML path is not changed by this document.

### 2.4 Error shape — **[proposed]**

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

Example, from a real rejection verified against `mosd-settings` at `86cd669`
(the VLAN case of §2.2):

```
HTTP/1.1 422 Unprocessable Content
Content-Type: application/json

{
  "error": {
    "code": "settings_rejected",
    "message": "invalid settings value at `network.eth0.100`: unknown field `100`, expected `dhcp` or `static`",
    "source": "mosd",
    "path": "network.eth0.100"
  }
}
```

| `code` | HTTP | `source` | Raised when |
|---|---|---|---|
| `not_authenticated` | 401 | apid | no bearer token, or one that does not verify (§3.2) |
| `not_found` | 404 | apid | unknown route, or a collection item that does not exist |
| `request_invalid` | 400 | apid | the body is not JSON, or not the shape the route takes |
| `validation_failed` | 422 | apid | apid's own validators rejected it: `valid_hostname` (`routes.rs:262-270`), `validate_iface` (`:273-281`), `validate_transient_password` (`:1240-1255`), `parse_authorized_key` (`:1288`) |
| `settings_rejected` | 422 | mosd | mosd answered fdo `InvalidArgs` (`mosd/mosd/src/bus.rs:489-491`, `:529`, `:541`) |
| `settings_io` | 500 | mosd | mosd answered `IOError` (`mosd/mosd/src/bus.rs:492`) |
| `mosd_failed` | 500 | mosd | mosd answered `Failed` (`mosd/mosd/src/bus.rs:493-495`, `:507`, `:258`, `:272`) |
| `mosd_unreachable` | **503** | apid | the call could not be made at all |

**The question that matters: does the API surface mosd's errors or translate
them? Recommendation: translate the classification, pass the message through
verbatim, and always say which side it came from.**

The reason is what the HTML path does today, which is neither. It **flattens**:
`BusSettings` converts every `zbus::Error` to `anyhow::Error` with `err.into()`
(`mosd/apid/src/bus_client.rs:159`, and the same line at `:170`, `:181`,
`:206`), and every form handler renders one page for the result — `bus_error`,
HTTP **502**, body *"The management daemon is unavailable."*
(`mosd/apid/src/routes.rs:650-660`, message at `:656`). So a settings value mosd
rejected as invalid is reported to the operator as the daemon being down:
`network_submit` returns `bus_error` when the settings write fails
(`mosd/apid/src/routes.rs:1532-1538`), and `write_key_list` does the same
(`:1075-1077`). The VLAN example above is exactly this — a rejection that reads
as an outage.

The distinction is not lost by mosd and it is not lost by D-Bus; it is lost by
apid. mosd classifies deliberately, mapping `SettingsError` onto three distinct
fdo error names (`mosd/mosd/src/bus.rs:156-166`), and zbus carries the name back:
the pinned `zbus` 5.19.0 (`mosd/Cargo.lock:2907-2908`) has
`Error::MethodError(OwnedErrorName, Option<String>, Message)` as a distinct
variant from its transport errors. Recovering the classification is therefore a
matter of matching on the `zbus::Error` before converting it, at the six call
sites named above — one change, in one file. Sequencing it is §8's.

**Why translate rather than pass the fdo error through.** Passing it through
means the client has to know D-Bus to use an HTTP API, and it means the wire
format of the API is set by a dependency of a dependency. Worse, the messages
are anyhow chains built by mosd with `{err:#}` (`mosd/mosd/src/bus.rs:507`).
mosd carries a contract that one of them — the transient-password path — never
echoes the password (`mosd/mosd/src/bus.rs:499-507`, restated in
`mosd/apid/src/bus_client.rs:201-203` and `mosd/apid/src/settings_api.rs:26-30`),
but that contract is stated for that one method. Making the HTTP body a verbatim
copy of every chained message from every method extends a one-method promise
across the whole interface, silently, and the extension is not written down
anywhere. **Translating the classification while copying the message keeps the
same exposure the HTML path already has** — the pane already shows mosd's message
text in an error box (`mosd/apid/src/routes.rs:786-789`, `:1230`, `:1250`) — without
widening it.

**And the failure mode of the choice this rejects.** If the API translated the
message too — replacing mosd's text with apid's own phrasing per code — then
every message mosd learns to produce is invisible until apid is taught it. The
"unknown field `100`, expected `dhcp` or `static`" string in the example above
comes from serde, through `SettingsError::Validation`
(`mosd/mosd-settings/src/model.rs:465-469`, `mosd/mosd-settings/src/error.rs:16`),
and no phrasing apid could have pre-written would have told the caller which
field was wrong. A client debugging a rejected write would be reduced to
guessing. That is the failure mode, and it is why `message` is passed through.

**The three cases the task names.**

1. **Validation failures.** Two `source` values, deliberately. `source: "apid"`
   means apid's own validator rejected the request before any bus call — the
   caller can fix it locally, and the write definitely did not happen.
   `source: "mosd"` means mosd's typed tree rejected it; the write also did not
   happen (`Settings::set` is documented as leaving settings unchanged on error,
   `mosd/mosd-settings/src/model.rs:348-349`, and `store.save` runs only after
   the candidate validates, `mosd/mosd/src/bus.rs:200-203`), but the rule that
   rejected it is not one apid knows. Both are 422. Knowing which is which is
   what tells a client whether re-reading this document will help.
2. **Bus unavailable.** `mosd_unreachable`, **503**, with `Retry-After: 5`. 503
   rather than today's 502 because apid itself is up and answering — 503 says
   "this server, temporarily", which is exactly what the connection cache makes
   true: the proxy is dropped after any failed call so the next request
   reconnects (`mosd/apid/src/bus_client.rs:75-78`, `:56-59`). The cost is
   named: the HTML path returns 502 for the same underlying failure
   (`mosd/apid/src/routes.rs:650-660`), so until §8 changes both, one appliance
   reports one outage two ways. Changing only the API is the wrong half of that
   trade and this section says so.
3. **mosd down entirely, distinguished from "everything is fine".** This is the
   case that must not be got wrong, because apid surviving a dead mosd is an
   existing design property, stated in the crate: *"mosd not being up yet
   therefore surfaces as per-request errors (502 pages), never as an apid
   crash"* (`mosd/apid/src/bus_client.rs:76-78`). The trap is already in the tree:
   `/healthz` returns before any check (`mosd/apid/src/routes.rs:674`) and
   answers the literal `ok` (`:722-724`), so **an appliance whose mosd is dead
   answers `/healthz` with `ok`**. A monitor polling it sees a healthy device.
   `/healthz` cannot be fixed, because the boot health gate depends on exactly
   that behaviour (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:219-231`) — its
   comment says so in as many words: *"/healthz is apid's existing endpoint and
   bypasses its auth gate"* (`:218`).

   So the API adds a second, differently-scoped endpoint:

   ```
   GET /api/v1/health          (authenticated)

   200 {"apid": "ok", "mosd": "ok",          "checkedAt": "<uptime seconds>"}
   200 {"apid": "ok", "mosd": "unreachable", "detail": "<message>"}
   ```

   It returns **200 in both cases**, because the request succeeded and the answer
   is the body — a 503 here would be indistinguishable from the endpoint itself
   being unavailable, which is the confusion it exists to remove. `mosd` is
   determined by making one real call (`GetSettings("")` is the cheapest that
   proves the bus round trip), not by inspecting a cached flag. A client's rule
   is therefore explicit: **`/healthz` answers "is apid's listener up"; only
   `/api/v1/health` answers "is this appliance manageable".** Both sentences are
   true and neither implies the other.

   One consequence worth stating, because it is already true at `86cd669` and
   the API inherits it: the gate calls `GetSettings("access")` on **every**
   request (`mosd/apid/src/routes.rs:704`) and returns `bus_error` when it fails
   (`:133`). So when mosd is down, every authenticated API route fails with
   `mosd_unreachable` before its handler runs, including `GET /api/v1/health`
   itself. The health route must therefore be exempt from the gate's settings
   read in the same way `/healthz` is exempt from the gate entirely
   (`:128-130`) — otherwise the one endpoint that exists to report a dead mosd is
   the one endpoint a dead mosd prevents from answering.

## 3. Authentication for a programmatic client — **[proposed]**

§3.1 is a reading of the tree at `86cd669` and is marked **[implemented]**
because it describes shipped mechanics. §3.2 and §3.3 are the proposal.

### 3.1 Browser session versus programmatic client — **[implemented]**

Section 1.4 measured the session mechanism as shipped. This section says what is
wrong with it *for a script*, in mechanics rather than in principle. "It is for
browsers" is not an argument; these seven are, and each is a property of the
code at `86cd669`.

1. **Authentication failure is a redirect, not a 401 — so the default client
   sees success.** The gate answers an unauthenticated request with
   `Redirect::to("/login")` (`mosd/apid/src/routes.rs:712`), a 303/307-class
   response. A client that follows redirects — which is the default for `curl
   -L`, for Python `requests`, and for most HTTP libraries — ends up at `GET
   /login`, which the gate lets through (`:141-143`) and which returns
   **200 OK** with an HTML form (`:486-497`). A script that checks the status
   code and stops there concludes its request succeeded. This is the sharpest of
   the seven: every other item makes the client's life harder, and this one makes
   it *wrong*.
2. **Obtaining the credential means emulating three browser behaviours.**
   `POST /login` takes `Form<LoginForm>` — axum's URL-encoded extractor
   (`mosd/apid/src/routes.rs:21`, `:1101`), not JSON — answers **302 to `/`**
   (`:520-524`), and delivers the credential in a `Set-Cookie` header
   (`:521`, value built at `mosd/apid/src/session.rs:102-103`). A client must
   therefore URL-encode rather than serialise JSON, *not* follow the redirect,
   and parse a `Set-Cookie` header. None of those is hard; all three are the
   client pretending to be something it is not.
3. **The credential does not survive a restart of the daemon that issued it.**
   Sessions live in a `HashMap` in memory (`mosd/apid/src/session.rs:32`) and the
   module says so: *"an apid restart logs everyone out"*
   (`mosd/apid/src/session.rs:5-6`). Since apid ships inside the verity rootfs
   (`mosd/dist/apid.service:14`, `docs/design/access.md:468-474`), **every A/B
   image update invalidates every session**. A cron job's credential expires
   whenever the fleet is updated, and per item 1 the job's next run gets a 200
   and an HTML page.
4. **The TTL is fixed at 24 hours and is not renewed by use.** The expiry is
   stamped once at creation (`mosd/apid/src/session.rs:59`, TTL at `:19`) and
   `verify` only compares against it — it never extends it
   (`mosd/apid/src/session.rs:72-88`). A long-running client is logged out
   mid-operation exactly 24 hours in, with no warning in any response before
   that point.
5. **The expiry is monotonic, not absolute.** `Instant` (`session.rs:10`, `:53`)
   is a monotonic clock. A client cannot compute when its session dies from
   anything the server told it, because nothing on the wire carries the
   server's notion of now.
6. **There is exactly one credential, and it identifies a human.** The only
   thing the crate authenticates against is
   the admin hash, read through `password_hash` (`mosd/apid/src/routes.rs:637-643`); there is
   no second credential, no user table, and no reference to `access.device` in
   the route module (section 1.4). A script therefore holds the operator's
   password. Revoking the script means changing that password, which logs the
   operator out too — there is no smaller unit of revocation than "everyone".
7. **A misconfigured script locks the operator out, repeatedly.** The login
   backoff is a single global counter, not per-client, by explicit design:
   *"the appliance has one admin password, so per-client tracking buys nothing
   against an online guesser"* (`mosd/apid/src/auth.rs:52-53`). Each consecutive
   failure doubles the wait before the next attempt is accepted, from one second
   to a five-minute cap (`mosd/apid/src/auth.rs:13`, `:16`, `:40-47`), and the
   window rejects **every** login attempt while it holds (`:102-108`, `:124-133`;
   the 429 at `mosd/apid/src/routes.rs:1114-1123`). A script retrying with a
   stale password holds the human admin out of the web UI indefinitely. That
   comment's reasoning is sound *for one password*; adding a second class of
   credential is what makes it stop being sound, which §3.2 has to answer.

Items 6 and 7 are the ones that cannot be fixed by making the session mechanism
nicer. They are consequences of there being one credential.

### 3.2 The proposal: a bearer API token — **[proposed]**

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
(`mosd/apid/src/session.rs:51-61`) — and the reason to keep the id visible is
mechanical: with N tokens stored, an opaque blob forces apid to hash the
presented secret and compare against all N entries on every request, while an
embedded id is one lookup and one comparison. 32 bytes is 256 bits, double the
session id's 128 (`mosd/apid/src/session.rs:52`), because unlike a session this
credential is not going to expire on its own.

**Where the credential is stored: the settings tree, on STATE, hashed.**
The store is `access.apiTokens`, an array whose items are
`{id, name, hash, created}` — the naming follows the tree's existing
convention of camelCase renames for multi-word keys (`webAdmin`,
`authorizedKeys`, `passwordHash`;
`mosd/mosd-settings/src/model.rs:52`, `:104`, `:159`). Five reasons, and the
tier is chosen rather than inherited:

1. **It is the tier that matches the credential's required lifetime.** The
   settings tree is `/var/lib/mos/settings.toml`
   (`mosd/mosd-settings/src/store.rs:67`), mounted from `/mnt/state/mos` by
   `var-lib-mos.mount` — **STATE** (`docs/design/access.md:489`). Per the
   survives-what table it survives a reboot and an A/B update and does not
   survive a whole-disk reflash (`docs/design/access.md:504`). That is exactly
   right for an API token: a script must keep working across an image update
   (item 3 of §3.1 is the bug being fixed), and a decommissioning reflash must
   take the credential with it.
2. **DATA would be the wrong tier, and specifically worse.** `/home`, `/root`
   and `/srv` also survive a reboot and an A/B update
   (`docs/design/access.md:505`), so on lifetime alone they would do. But the
   same row records that on a reflash DATA is *"replaced by the image's fresh
   DATA filesystem — but see §9.2: blocks beyond the flashed extent are
   *unreachable*, not erased"*. A credential whose bytes may physically remain
   after the operation an operator performs to decommission a device is the
   wrong tier for a credential, and this is the reason to say so out loud rather
   than default to STATE by habit.
3. **Anything else is unmodelled state.** *"An unmodelled setting is an
   unsupported setting"* (`docs/design/access.md:535`). apid's own state
   directory `/var/lib/mos/apid` (`mosd/apid/src/config.rs:38-40`,
   `mosd/dist/apid.service:16`) is on the same STATE bind and would satisfy
   reason 1 — but a credential granting full management access that mosd does not
   know about gets no row in the survives-what table, no validation, and no
   backup story, and it sits outside the one place this project has decided
   credentials live.
4. **It costs zero extra bus round trips.** The gate already calls
   `GetSettings("access")` on **every** request
   (`mosd/apid/src/routes.rs:704`) and `apiTokens` is a child of `access`, so
   the subtree the token check needs is already in hand at the moment the check
   runs. A sibling root (`apiTokens` at the top level) would have added a second
   `GetSettings` per request. This is why the path is under `access` and not
   beside it.
5. **It is symmetric with the two credentials already there.** `webAdmin` holds
   an argon2id PHC hash (`mosd/mosd-settings/src/model.rs:68-71`) and
   `access.device` holds a hash and a generation and *"never holds a plaintext
   secret"* (`:147-152`). `apiTokens` holds hashes.

The cost of reason 1 is stated in §2.2 and is not hypothetical: anything that
can read the settings tree can read the token hashes. `GetSettings` returns the
subtree verbatim (`mosd/mosd/src/bus.rs:182-186`), so the API's redaction rule
(§2.2) must cover `hash` as well as `password_hash`, and the D-Bus policy —
root-only in both directions (`mosd/dist/com.mos.mosd.conf:63-72`) — is what
keeps everything else out. Since anyone who is root has already won (§3.3), this
costs nothing new; it is recorded because "the hashes are readable" is the kind
of sentence that should be written down before someone discovers it.

**The hash: SHA-256, not argon2id, deliberately.** `access.webAdmin` uses
argon2id (`mosd/apid/src/auth.rs:19-25`) because a human chose that password and
an offline attacker with the hash can guess it. A token is 256 bits from `OsRng`
and there is nothing to guess; a work factor would buy no security and would be
paid on **every API request**, where the password's is paid once per login. The
`sha2` crate is already a dependency (`mosd/apid/Cargo.toml:26`, used by
`mosd/apid/src/session.rs:15`), so this adds nothing to the dependency list.
The comparison must be constant-time — the crate already contains the right
primitive, `Mac::verify_slice` — `verify_slice` (`mosd/apid/src/session.rs:67`), and a `String`
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
takes (`mosd/mosd-settings/src/model.rs:147-152`).

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
   `SameSite=Lax` (`mosd/apid/src/session.rs:103` at `86cd669`) withholds the
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
UI (`mosd/mosd-settings/src/model.rs:110-112`, `docs/design/access.md` §4.1), so
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
  syntax has no array indexing (`mosd/mosd-settings/src/model.rs:213-214`) —
  the same pattern the SSH key pane uses (`mosd/apid/src/routes.rs:2558-2571`).
  Two concurrent mints lose one token, silently.
- Identity is the `id`, never a list position, for the reason recorded at
  `mosd/apid/src/routes.rs:2582-2586`: an index is meaningful only against the
  list the caller last read, and a concurrent change slides it onto a different
  entry. A `DELETE` whose id matches nothing is a 404, not a silent success.

**Expiry: none in phase 1, and that is a decision, not an omission.** An
absolute expiry needs a wall clock, and nothing in the crate reads one —
`SessionStore` uses `Instant` throughout (`mosd/apid/src/session.rs:10`, `:53`,
`:72`), which is monotonic and cannot express a deadline that survives a reboot.
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
  (`docs/design/dashboard.md:1275-1276`), which has no use for a bearer token.
- **Coexisting means two credentials at one privilege level** — and there is
  only one privilege level, because apid runs as root (`mosd/dist/apid.service`
  sets no `User=`, `:1-13`; `mosd/dist/com.mos.mosd.conf:12-14` records the same
  from the other side) and every route it serves is behind the same gate
  (`mosd/apid/src/routes.rs:191`). A token can do everything the operator can do
  over the API. There are no scopes in phase 1, and inventing them would mean a
  per-method allowlist that the D-Bus policy already contemplates and
  deliberately deferred (`mosd/dist/com.mos.mosd.conf:48-61`) — this document
  does not reopen that.

Two consequences of coexistence that must be stated in the UI, not just here:

1. **Changing the admin password does not revoke any token.** That is deliberate
   — a human rotating their own password must not break every script — and it
   means "I changed my password" is not a containment action. The UI's password
   pane has to say so.
2. **§3.1 item 7 changes meaning.** The `auth.rs:53-54` comment's reasoning —
   per-client tracking buys nothing because there is one password — held because
   there was one credential. With tokens there are N, and the global backoff
   curve (`mosd/apid/src/auth.rs:40-47`) still gates only the login POST
   (`mosd/apid/src/routes.rs:1114-1123`). Bearer verification is **not** rate
   limited and should not be: 256 bits of `OsRng` is not guessable online, and a
   shared counter on the token path would let anyone with a bad token lock out
   every script. The comment is not wrong; it is now scoped to the password path
   and this document records that scoping.

### 3.3 Threat model, and what it does not protect against — **[proposed]**

**What the transport actually is.** rustls with the `ring` provider
(`mosd/Cargo.toml:38`, installed explicitly at `mosd/apid/src/main.rs:146-147`),
carrying a **self-signed certificate apid generates on first start**: CN `mos`,
SANs `DNS:mos`, `DNS:localhost` and the v4 loopback
(`mosd/apid/src/tls.rs:47-81`, SAN construction at `:59-67`), private key mode
`0o600` (`:78`, `:37`) in a state directory created mode `0o700` (`:24`).
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
than the `HttpOnly` cookie (`mosd/apid/src/session.rs:103`) for that one
property. The built-in UI is unaffected because it is no-JavaScript by decision
(`docs/design/dashboard.md:1275-1276`).

**What it does not protect against.** Five attacks, concretely.

1. **An active on-path attacker on the LAN captures the token on first use.**
   Because the certificate is self-signed with SANs that do not match the
   address operators actually use (`mosd/apid/src/tls.rs:59-67`), every client
   is configured to skip verification — the shipped boot health probe does
   exactly that, `curl -k` with a `wget --no-check-certificate` fallback
   (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:222`, `:228`). An attacker who
   can answer for the device's address terminates TLS with their own
   certificate, and the client, told to accept anything, hands over the bearer
   token in the first request. Nothing in this design stops that. The mitigation
   that would — an operator-installed certificate, or a documented pin — does
   not exist in `mosd/apid/src/tls.rs` at `86cd669`.
2. **A stolen token is full management access, indefinitely.** There is no
   expiry (§3.2), no binding to a client address, and no binding to a request.
   A token exfiltrated from a CI secret store, a laptop backup or a shell
   history reboots the appliance, enables SSH
   (`PUT /api/v1/settings/access.ssh.enabled`), adds a root key
   (`POST /api/v1/ssh/authorized-keys` — *"Every authorized key is a root key"*,
   `mosd/apid/src/routes.rs:1762`) and is then no longer needed. Detection is not
   addressed either: nothing in the crate logs which credential served a
   request, and mosd records only the D-Bus sender for power actions
   (`mosd/mosd/src/bus.rs:91-100`), which is apid for every request apid makes.
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
   (`mosd/apid/src/session.rs:103`) and nothing else, because there is no CSRF
   token in the crate at `86cd669` — `grep -ni csrf mosd/apid/src/*.rs` returns
   nothing (§1.2). **`Lax` is a cross-site control and says nothing about a
   request issued from the device's own origin.** After §4 and §5 land, the
   device's own origin serves an operator-supplied bundle out of `/srv/ui`
   (§5.2), whose installation §7.4 recommends **not** requiring a signature for.
   So a hostile or XSS-compromised bundle, running at `https://<device>/` with
   the operator's session cookie attached by the browser, can submit that form
   and read the plaintext out of the response. **What is new here is not
   privilege — it is persistence.** The same bundle can already drive every
   other form pane the operator's cookie reaches: reboot, enable SSH, add a root
   key (`mosd/apid/src/routes.rs:1762`). But a minted token survives deactivating
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
pane is tested to carry, `mosd/apid/src/routes.rs:1762`, asserted at
`mosd/apid/src/tests.rs:797`); apid runs as root
(`mosd/dist/apid.service:1-42`); the D-Bus policy allows root to own, send and
receive (`mosd/dist/com.mos.mosd.conf:68-72`). A root shell reads
`/var/lib/mos/settings.toml` directly, reads
`session.key` in that directory (`mosd/apid/src/tls.rs:86`), and calls
`com.mos.mosd1` without going through apid at all. **The API token's threat
model is entirely about the network channel**; it adds nothing against local
root and it is not intended to.

**CSRF, now that form posts and an API coexist.** There is no CSRF token
anywhere in the crate — `grep -ni csrf mosd/apid/src/*.rs` returns nothing at
`86cd669` (section 1.2) — and the picture after this proposal is:

- **The API path has no CSRF exposure**, because a bearer header is not something
  a browser attaches on a cross-site request. This is a property of the choice,
  not an added control — **and it is now unconditional, because no `/api/v1/`
  route accepts a cookie at all.** The mint that would have been the exception
  is `POST /builtin/tokens`, an HTML form on the form path (§3.2); a cookie
  presented to `/api/v1/tokens` is a `401`.
- **The form path is covered for POST by `SameSite=Lax`**
  (`mosd/apid/src/session.rs:103`), which withholds the cookie from cross-site
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
  and `"poweroff"` (`mosd/apid/src/routes.rs:1587-1591`) and
  `TRANSIENT_CONFIRM_TOKEN` is the literal `"set-transient-password"`
  (`:948`). They are not secret, not per-session and not unpredictable; the
  source describes their purpose accurately as stopping a submit without a
  ticked checkbox (`:788-789`). They stop a mis-click and a prefetch. Against a
  cross-site attacker they add nothing, and the form path holds because
  `SameSite=Lax` holds.

**One denial-of-service note, because it is already true and the API widens it.**
The gate calls `GetSettings("access")` on **every** request before deciding
anything (`mosd/apid/src/routes.rs:704`), including unauthenticated ones. So an
unauthenticated flood already costs one D-Bus round trip per request against the
single lock mosd holds over both trees (`mosd/mosd/src/bus.rs:51-53`, `:514`).
Adding an API does not create this, but it adds routes that are attractive to
automate against. This design does not solve it.

## 4. Static hosting

Section 1.6 measured the starting point at `86cd669`: apid served no static
asset of any kind, from anywhere, and the only disk paths it read at all were
`/proc/uptime` (`mosd/apid/src/routes.rs:1216`) and its own state directory
(`mosd/apid/src/tls.rs:48-49`, `:86`). Everything in this section was therefore
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
wrong: hardware **has** booted — a **v1** image reached the `mos login:` prompt
on a real CX3576-Z, and the repart/maskrom and SPL-hash investigations ran
against a real board — while the **v2** stack these sections land in (verity
root, A/B, `rauc install`, and apid itself) has **never** run on hardware.
*"Never booted"* and *"verified on device"* are both false. `[implemented]`
here means what §0 says it means and nothing more, and §6.3's *"No hardware
claim is made anywhere in this section"* stays true.

### 4.1 Routing between API and assets — **[implemented]**

**Implemented at `mosd/apid/src/routes.rs`** — `app` (`:88-161`), whose
*declaration order* is this subsection's precedence rule: `/` (`:95`), the
reserved `/builtin` subtree (`:115-125`), the fifteen legacy declarations
(`:126-145`), the reserved `/api` subtree (`:155-156`), and rule 4's
`.fallback(serve::fallback)` (`:158`). The asset side is
`mosd/apid/src/assets/serve.rs` (`root` and `fallback`). Nothing re-checks a
prefix: no handler under `assets/` reads one, which is the property this
subsection asked for rather than a coincidence of the implementation.

**Two things the implementation settled that the text above did not, both
reported by RFCT-074 rather than designed around.** First, `nest("/api", …)`
claims `/api`, `/api/x` and `/api/x/y` but **not** `/api/` — measured against
axum 0.8.9 — so `/api/` alone fell through to the asset router and, with a
bundle installed, was answered by §4.2's fallback with 200 and HTML. Rule 1
forbids that in as many words, and it is closed by the explicit second
declaration at `mosd/apid/src/routes.rs:156`, which is why that line is not
redundant. Second, and **not closed**: rule 1 is written about paths that
*begin* `/api/`, and `//api/versions` does not — it reaches the fallback, where
§4.4 rule 3 strips all leading separators and resolves it to the bundle's
`api/versions`. No API path is shadowed and phase 2's routes answer at
`/api/v1/...` regardless, so this is not the failure rule 1 exists to prevent;
what it is, is the reserved subtree's *names* remaining reachable from a bundle
by adding one slash. Closing it needs either the in-handler prefix check §4.1
rejects or a path-normalising middleware, and §4 chooses neither, so it is left
open and named here rather than in a comment.

**The precedence rule.** One request arrives; apid decides in this order, and
the order is total — no request is ever ambiguous:

1. **`/api/` — a reserved subtree.** The API router is mounted at `/api/v1` and
   the whole `/api/` prefix is claimed, **including its own not-found
   handler**. No request whose path begins `/api/` ever reaches the asset
   router, whether or not it matches a declared operation.
2. **Reserved non-API paths.** `/healthz`, and the built-in-UI prefix section
   6.3 reserves. Declared routes.
3. **Legacy server-rendered paths**, for as long as they are declared.
4. **Everything else — the asset router**, as the router's fallback.

**Why this order rather than any other.** Rule 1 is not a convention that has
to be policed; it is the shape axum's router already has. As of `86cd669` the
HTTPS router matched its fifteen `.route()` declarations and declared **no
fallback at all** — the only `.fallback` in the file belonged to the HTTP
redirect router, which is why an unmatched path was then answered by the gate's
redirect to `/login` or by axum's default not-found (section 1.6). As of
`0d4f3c6` the fifteen declarations are at `mosd/apid/src/routes.rs:126-145`,
the redirect router's fallback is at `:194`, the gate's `/login` redirect is at
`:269`, and the HTTPS router's fallback is declared: `.fallback(serve::fallback)`
at `:158`. Adding the asset service as the *fallback* therefore means declared
routes win **structurally**: a bundle that ships a file
at `api/v1/settings` cannot capture API traffic, because the router never
consults the fallback for a path it matched. A rule enforced by the dispatch
mechanism is worth more than a rule enforced by a check somebody can forget to
write.

**Why the `/api/v1` prefix, and what the alternatives cost.**

| Option | Rejected because |
|---|---|
| **Content negotiation on the same paths** (`Accept: application/json` selects the API) | The reserved set becomes invisible in the URL: you cannot tell from a request line whether it is an API call or an asset fetch, which makes both logs and `curl` reproduction ambiguous. A `fetch()` that forgets its `Accept` header silently receives HTML. |
| **A second listener on its own port** | Two TLS configurations, two firewall rules, and the self-signed certificate would have to be accepted twice by the browser — it is generated once into the state directory with SANs `DNS:mos`, `DNS:localhost`, `IP:127.0.0.1` (`mosd/apid/src/tls.rs:44-81`). The two listeners that exist at `86cd669` are 443 and a redirect-only 80 (`mosd/apid/src/config.rs:34-37`, `mosd/apid/src/routes.rs:72-76`); a third is a real operational cost for no isolation gain, since both would be served by the same root process. |
| **A subdomain** (`api.mos`) | The certificate carries three SANs and no wildcard (`mosd/apid/src/tls.rs:44-81`), and the appliance provides no DNS. A new name means a new SAN, a new way for the name to fail to resolve, and a second certificate-trust prompt. |
| **`/api/v1` prefix** | **Chosen.** One origin, one certificate, one listener, and the reserved set is legible in every URL. |

**What it costs, stated plainly.** The prefix `/api` is burned permanently: a
custom UI can never serve a page or an asset at `/api/anything`, and it never
gets that path back. That is the price of rule 1 being structural. It is
cheap here only because the reserved set is small and is written down.

**What happens to today's server-rendered paths while they still exist.** They
are declared routes, so rule 3 falls out of rule 1's mechanism with no special
case: at `86cd669` the reserved page paths are `/`, `/setup`, `/login`,
`/logout`, `/network`, `/hostname`, `/power`, `/power/reboot`,
`/power/poweroff`, `/ssh`, `/ssh/enable`, `/ssh/password`, `/ssh/keys/add`,
`/ssh/keys/remove` and `/healthz`, each a `.route()` declaration
(`mosd/apid/src/routes.rs:152-176`). A custom
bundle cannot occupy any of them.

**`/` is the one that matters, and it must not be waved past.** A replaceable UI
whose index cannot be served at the site root is not replaceable in any useful
sense — an SPA mounted at a subpath needs a base href and a rewrite of every
absolute URL it emits, and the operator's bookmark still lands on the built-in
status pane. So `/` is the single exception to rule 3:

- `GET /` serves the **active bundle's `index.html` when a bundle is active**
  and its index is readable (section 5.3's definition of active);
- otherwise `GET /` serves the built-in UI.

The built-in status pane that occupies `GET /` today (`home`, at
`mosd/apid/src/routes.rs:45` and `:578`) moves under section 6.3's reserved
prefix, where it is reachable unconditionally. `/` is therefore **conditional**
and the reserved prefix is **not** — and section 6.3 requires exactly one
unconditional path, not two, so this trade is the one that section makes.

The other legacy pane paths stay reserved until the phasing in section 8 moves
each pane onto the API and deletes its route. Until then a custom UI cannot use
those thirteen paths. That shrinkage is section 8's to schedule.

### 4.2 SPA fallback — **[implemented]**

**Implemented at `mosd/apid/src/assets/serve.rs`** — `fallback` and `respond`,
with condition 1 costing no code (it is 4.1's mounting), condition 2 the method
check, conditions 3 and 4 the `offers_html` and `ends_in_a_route_segment`
predicates, and condition 5 whether `serve_index` produced anything. Each
condition has its own test in `mosd/apid/src/tests.rs`.

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

**The property to test.** After this rule, a request that a developer expected
to be JSON never returns HTML with a 200. That is one integration test per
condition, and it is the test that keeps 4.2 from silently regressing.

### 4.3 MIME and caching — **[implemented]**

**Implemented at `mosd/apid/src/assets/mime.rs`** — the fixed extension
allowlist (`.wasm` and `.webmanifest` in it from the start, `:58-59`), the
`octet-stream` fallback, `nosniff`, and the three cache classes with their
header values (`:83-132`). The headers are attached to every response the asset
router builds by `asset_response` in `mosd/apid/src/assets/serve.rs`, and the
`/api/` subtree's own 404 carries `no-store` from the same enum
(`mosd/apid/src/routes.rs:176`). The immutable class is read per request from
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
(`tower-http-0.6.11/src/services/fs/serve_dir/open_file.rs:78-82`, in the
registry copy of the version pinned at `mosd/Cargo.lock:2391-2394`). A fixed
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
`mosd/apid/src/session.rs:18`, `:91`). The cookie is `HttpOnly`, so script
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
(`tower-http-0.6.11/src/services/fs/serve_dir/future.rs:244`) and **nothing
else**: `grep -n "CACHE_CONTROL\|ETAG"` over
`tower-http-0.6.11/src/services/fs/serve_dir/` returns no match. So the entire
caching posture above is a layer apid must add regardless of whether the
file-serving itself is borrowed. Note also that `tower-http` is **not a
dependency of the crate** (`mosd/apid/Cargo.toml:11-29`; section 1.6, evidence
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

**Implemented at `mosd/apid/src/assets/path.rs`** — `resolve`, a pure function
from a request target and an already-resolved bundle root, performing rules 1-5
in order, with one test per guard and the five requests §8.2 phase 4 acceptance
2 names among them. The **primary** defence rule 5 chooses — install-time
rejection of any entry that is not a regular file or a directory — is
`validate_tree` in `mosd/apid/src/bundle.rs` (§5.3 requirement 2). No `unsafe`
was added and no dependency was added; `#![forbid(unsafe_code)]` is still at
`mosd/apid/src/main.rs:21`.

**Two rejections beyond the five rules, both flagged rather than folded in.**
Neither loses behaviour the rules require, and both were reported by RFCT-072:

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
apid runs as **root** — `mosd/dist/apid.service` sets no `User=` line
(`mosd/dist/apid.service:1-42`). Its `[Service]` section sandboxes the daemon
in the directions a root network listener can afford, `PrivateTmp=` and
`ProtectHome=` among them (`mosd/dist/apid.service:24-39`), but there is no
`ProtectSystem=`, no `ReadOnlyPaths=` and no `RootDirectory=`, so nothing
narrows what the process may **read**. The D-Bus policy records the privilege
from the other side — *"no shipped unit sets User=, mosd.service owns the name
as root, apid.service and the boot health gate both run as root"*
(`mosd/dist/com.mos.mosd.conf:11-13`). A traversal is therefore an arbitrary
file read **as root**, and the reachable set includes at least:

- **`/var/lib/mos/settings.toml`** (`mosd/mosd-settings/src/store.rs:67`) — the
  whole settings tree, including the argon2id webAdmin hash
  (`mosd/apid/src/routes.rs:642-646`) and every authorized SSH key.
- **`/var/lib/mos/shadow`**, which is what `/etc/shadow` is a symlink to
  (`docs/design/ro-root.md:270-289`).
- **`/etc/ssh/`** — the sshd host private keys, bound from STATE
  (`docs/design/access.md:485`).
- **apid's own state directory**, `/var/lib/mos/apid` by default
  (`mosd/apid/src/config.rs:38-40`): the TLS private key, mode `0o600`
  (`mosd/apid/src/tls.rs:37`, called from `:78`), and **`session.key`**, the 32-byte HMAC
  signing key (`mosd/apid/src/tls.rs:86`).

That last one is the escalation nobody should have to discover during an
incident. A session cookie is `<id>.<hmac>` where the MAC is HMAC-SHA256 of the
id under the persistent signing key (`mosd/apid/src/session.rs:44-47`, `:51-61`). **Reading
`session.key` lets an attacker mint a valid session cookie**, which converts a
file-read primitive into full administrative access without ever guessing the
password.

**And the read-only rootfs does not help.** This must be said explicitly,
because it is the assumption a reader of `docs/design/ro-root.md` will carry in:
**dm-verity protects integrity, not confidentiality.** The squashfs and its hash
tree (`docs/design/ro-root.md:13-27`) guarantee that `/` cannot be *modified*.
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
   (`tower-http-0.6.11/src/services/fs/serve_dir/open_file.rs:153-156`, comment:
   *"Only applies to NULL bytes"*) and then to a 404
   (`tower-http-0.6.11/src/services/fs/serve_dir/future.rs:108`) — but that is a
   404 reached by accident, and an accident is not a rule.
5. **Symlinks — the case rules 1-4 do not cover, and the one that matters most
   here.** Lexical validation proves the *requested path* escapes nothing. It
   proves nothing about what the kernel does when it resolves that path.
   `tower_http` 0.6.11 performs **no canonicalisation at all**: `grep -rn
   "canonicalize\|symlink_metadata\|read_link"` over
   `tower-http-0.6.11/src/` returns no match, and `build_and_validate_path`
   (`tower-http-0.6.11/src/services/fs/serve_dir/mod.rs:455-493`) is purely
   lexical — it rejects `Component::ParentDir`, `RootDir` and `Prefix` at `:488`
   and then simply pushes the remaining names onto the base path.

   A bundle is **operator-supplied content**, and planting a symlink inside one
   is trivial. `ui/leak -> /var/lib/mos/settings.toml` inside a bundle is
   served, in full, by a purely lexical checker. Three mitigations, in order of
   strength:

   | Mitigation | Strength | Cost |
   |---|---|---|
   | **Reject symlinks at install time** — the unpacker refuses any entry that is not a regular file or a directory (section 5.3) | Removes the class from the tree entirely | None beyond the check; composes with a bundle that is immutable after activation |
   | **`openat2(2)` with `RESOLVE_BENEATH \| RESOLVE_NO_SYMLINKS`** | Strongest — the kernel enforces it, per-open, with no race | Needs Linux ≥ 5.6, and a raw syscall. **The workspace forbids unsafe code** (`mosd/Cargo.toml:10-11`, repeated locally at `mosd/apid/src/main.rs:21`), so this means a new dependency carrying `unsafe`, inside the root-privileged daemon, subject to the audit `mosd/hack/check.sh:9` runs |
   | **Canonicalise the opened path and assert it starts with the resolved bundle root** | Safe Rust, no new dependency | One extra syscall per request; TOCTOU-racy in principle, though the race requires mutating the bundle tree between the check and the open, which section 5.3's activate-by-rename makes unreachable for the install path |

   **Chosen: install-time rejection as the primary defence, canonicalise-and-
   assert at serve time as defence in depth.** Both are safe Rust and neither
   adds a dependency. `openat2` is genuinely stronger, and it is refused here
   for one reason worth writing down: buying it costs an `unsafe`-carrying
   dependency in a daemon that runs as root, and that is a worse trade against
   *this* threat than two cheap layers that each close it independently.

   One consequence to carry into 5.3: the assertion is made against the
   **resolved** bundle root, not against the `/srv/ui/current` symlink itself.
   That pointer is appliance-managed and lives outside every bundle tree; the
   "no symlinks" rule applies to bundle *contents*.

**On depending on a library, and what happens if its behaviour changes.**
`tower-http` is not a dependency of the crate — its manifest lists none
(`mosd/apid/Cargo.toml:11-31`, section 1.6 evidence 1). The copy at
`mosd/Cargo.lock:2364-2366` is version **0.6.11**, pulled in by the
**dev-dependency** `reqwest` (`mosd/apid/Cargo.toml:34`), and it is built
**without the `fs` feature**: its
dependency list in the lockfile (`mosd/Cargo.lock:2395-2406`) contains no
`tokio`, `mime_guess`, `httpdate` or `http-range-header`, all of which `fs`
requires
(`tower-http-0.6.11/Cargo.toml:168-183`). **`ServeDir` is therefore not
compiled today**, and adopting it is a manifest change and a new feature
surface, not a flag flip.

If it is adopted, two things follow:

- **Pin it exactly**, the way `tough` is pinned for a comparable reason
  (`mosd/Cargo.toml:33-35`).
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
  dev-dependencies (`mosd/apid/Cargo.toml:33-34`).

## 5. Where a custom UI lives

Markers are per subsection here too, for the reason §4 states; §4's note on
what `[implemented]` means in §§4-6, and on the hardware position it must not
be read as, governs this section unchanged.

### 5.1 Why it cannot live in the rootfs — **[implemented]**

`/` is a zstd-compressed squashfs covered by a dm-verity hash tree carried in
the same file (`docs/design/ro-root.md:13-27`), mounted read-only by the kernel
from `dm-mod.create=` with no fstab entry that could ever remount it — the
fstab template says so in as many words: *"there is no remount to perform and no
entry that could ever succeed in rewriting it"*
(`os/rootfs/overlay-v2/etc/fstab.in:7-9`; `docs/design/ro-root.md:239`) — so a
write there does not fail a permission check, it fails a cryptographic one. And
the slot is replaced **wholesale** by an A/B update: RAUC installs the entire
`rootfs.img` into the raw `rootfs-a`/`rootfs-b` slot
(`os/update/rauc/system.conf.in:75-85`, `os/update/rauc/manifest.raucm.in:21-22`), so anything
written into a rootfs would be gone at the next update even if writing it were
possible.

### 5.2 The location, and the bind — **[implemented]**

**Implemented at `mosd/apid/src/bundle.rs`** — `DEFAULT_ROOT` is `/srv/ui`
(`:42`), the layout beneath it is `bundles/<generation>/`, `current`,
`records/`, `.staging-<generation>/` and `.trash-<generation>/`, and the modes
are `DIR_MODE` `0755` and `FILE_MODE` `0644` (`:53`, `:55`), applied to the root and
to everything under it. The root is created lazily on first activation and
never at start-up, which is this subsection's *"absence is a defined state"*
written as code. No mount unit and no seed unit was added, and the eight binds
are still eight. The image side is asserted rather than assumed:
`os/verify-image-v2.sh`'s `check_ui_location` (`:254`) fixes `/srv/ui` as the root
(`:210`) and chains to the packed-mountpoint check, and every one of those
assertions is driven against an input in which its fact is false by
`os/verify/src/checks-fstab.test.ts`.

**The path is `/srv/ui/`.**

**It needs no bind, and that is the point.** `/home` and `/root` needed mount
units because those paths sit *inside* the verity squashfs and had to be
redirected onto DATA — `home.mount` binds `/srv/home` onto `/home`
(`os/rootfs/overlay-v2/etc/systemd/system/home.mount:20-21`) and `root.mount`
binds `/srv/root` onto `/root`
(`os/rootfs/overlay-v2/etc/systemd/system/root.mount:29-30`). `/srv` is not a
redirect: it is the DATA partition's **own mountpoint**, mounted directly from
the image's `fstab` — `/srv` is the DATA tier there
(`os/rootfs/overlay-v2/etc/fstab.in:12`) and the only one carrying
`x-systemd.growfs` (`:16`) — and the verifier
asserts that entry by mountpoint and options, requiring
`noatime` and `x-systemd.growfs` under the label
*"DATA is the growth target"* (`os/verify/src/checks-fstab.ts:124-128`).

So `docs/design/access.md` §10.2's mechanism — *"one mount unit plus one
verifier assertion"* (`docs/design/access.md:545`) — applies here at **half
strength: no mount unit is needed, and the verifier assertion that would have
accompanied it already exists**. The image ships **eight** binds
(`docs/design/access.md:481-492`); this proposal adds a ninth to **none** of
them. That is the whole reason `/srv` was chosen over inventing a new bind
target: it is the one persistent tier already reachable without a unit.

Two facts the image already guarantees and that this depends on:

- The `/srv` mountpoint exists in the read-only root
  (`os/rootfs/scripts/overlay-install.sh`), and the verifier asserts
  *"every fstab/bind mountpoint exists in the read-only root"*
  (`os/verify/src/checks-root.ts:520`).
- DATA is the only partition `systemd-repart` grows and the only one carrying
  `x-systemd.growfs` (`os/rootfs/overlay-v2/etc/fstab.in:16`), so a bundle root
  here has no ceiling short of the disk.

**It needs no seed unit either.** `mos-seed-home` exists for one reason:
`mount(8)` does not create the source of a bind, so the source must exist before
the mount runs (`os/rootfs/overlay-v2/etc/systemd/system/home.mount:12-14`;
`os/rootfs/overlay-v2/usr/lib/mos/mos-seed-home:9-18`). There is no bind here,
so nothing fails if `/srv/ui` is absent. **Absence is a defined state** — it is
section 6.1's first failure class, and it is the shipped state of every device
— and apid creating the directory lazily on first install is strictly simpler
than a ninth unit that has to be ordered against a mount.

**Ownership and permissions: `root:root`, mode `0755` on `/srv/ui` and on the
directories beneath it, `0644` for files.**

- apid runs as root — the unit sets no `User=` line
  (`mosd/dist/apid.service:1-42`) — so it can write
  regardless of what the mode says.
- **The mode is chosen for the daemon apid is meant to become, not the one it
  is.** mos runs two processes with a real privilege boundary
  (`docs/design/dashboard.md:8-10`), and nothing about serving a bundle root
  requires the API daemon to stay root. A root-owned, world-readable bundle root
  is the shape that survives that change without a migration: the serving path
  needs only read, and the install path is privileged anyway.
- **Not `0700`.** Content served to an authenticated browser is not a secret,
  and `0700` would force a group or an ownership change the day apid stops
  being root.
- **The owner is not pinned to a numeric uid**, unlike `/srv/home/mos`
  (`os/rootfs/overlay-v2/usr/lib/mos/mos-seed-home:41-42`), because
  root is `0` on every image that will ever exist. If a future `apid` account
  owns this tree instead, that uid **must** be pinned by number for exactly the
  reason `mos-seed-home` documents — the directory outlives the rootfs that
  created it.
- **Explicitly not under `/srv/home` or `/srv/root`.** Those are the bind
  sources for operator-owned trees (`/srv/home/mos` is uid 1000, mode `0700` —
  `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-home:44-47`). A UI bundle is
  appliance state, not a user's file, and mixing the two would make "delete my
  files" and "remove the UI" the same gesture.

### 5.3 Install and removal — **[implemented]**

**Implemented at `mosd/apid/src/bundle.rs`** — `Store::activate` performs the
five steps in this subsection's order (`:475`), `validate_tree` enforces the
three requirements a bundle has, `deactivate` (`:531`) and `delete` (`:552`)
are the two operations this subsection refuses to conflate, `prune` (`:582`)
keeps the current generation and the previous one, and `Store::status` (`:605`)
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
question rather than a design question — `mosd/hack/check.sh:9` runs
`cargo deny check licenses bans advisories` and `mosd/deny.toml` contains no ban
on crates that build C, so the workspace's pure-Rust posture is upheld by
**convention and review**, not by a gate: the only mechanical record of it is
the `tough` pin comment (`mosd/Cargo.toml:33-35`). The choice is therefore
between an uncompressed tar and a pure-Rust inflate, and is not settled here.

**How the write is made atomic.** Five steps, and the ordering is the mechanism:

1. **Unpack into `/srv/ui/.staging-<generation>/`** — a dot-prefixed name, on
   the **same filesystem** as the target so that step 3's `rename(2)` is atomic
   rather than a copy.
2. **Validate the staged tree completely** — `index.html` present and readable,
   no non-regular entries, manifest parses if present, declared API range
   checked against the version apid serves. Validation runs on the **staged**
   tree and never on the live one, so a rejected bundle has touched nothing an
   operator can see.
3. **`fsync` the staged tree and its parent directory, then
   `rename("/srv/ui/.staging-N", "/srv/ui/bundles/N")`.** The `fsync` is not
   ceremony: without it a power cut can leave a `current` pointer resolving to a
   tree whose data never reached the disk, which is exactly failure class 3 and
   exactly the failure mode the appliance's whole A/B story exists to avoid.
4. **Flip the active pointer.** `/srv/ui/current` is a **symlink** to
   `bundles/N`. It is replaced by creating the new symlink under a temporary
   name and `rename`-ing it over the old one — `rename(2)` over an existing
   symlink is atomic, so there is **no instant at which `current` is absent**.
   A reader either sees the old bundle or the new one.
5. **Prune.** Keep the current generation and the previous one; delete older
   ones.

**A half-uploaded bundle is never served** because nothing under
`/srv/ui/bundles/` is ever the active tree until step 4, the staging directory
is never under `bundles/`, and the asset router resolves `current` and refuses
anything outside the tree it resolves to (4.4 rule 5). The three steps are
independent: unpack can fail, validation can reject, and the rename can be
interrupted, and in each case the previously active bundle is still the active
bundle.

**Keeping two generations** is what makes deactivate-and-reactivate cheap, and
it costs two copies of a bundle on DATA. That is the cheapest place on the
device to spend it: DATA grows to fill the disk
(`os/rootfs/overlay-v2/etc/fstab.in:16`) and is already the tier chosen for
unbounded operator data over a 64 MiB STATE, for exactly this kind of reason
(`os/rootfs/overlay-v2/etc/systemd/system/home.mount:5-10`).

**Removal is two operations, and conflating them is a mistake.**

- **Deactivate** — remove the `current` symlink. The bundle stays on disk. The
  device falls back to the built-in UI. This is fast, reversible, and it is
  **the same operation as section 6.3's escape**, which is why it is specified
  here rather than invented there.
- **Delete** — `rename` the bundle directory to `/srv/ui/.trash-<generation>`,
  then unlink recursively. **Never unlink the tree `current` points at**:
  deactivate first, then delete, so a delete interrupted midway cannot leave
  `current` resolving to a partially-removed tree.

**"What is installed right now?"** must be answered **from the served tree, not
from a record of what was uploaded** — otherwise the answer is a claim about the
past rather than a fact about the present, and it will agree with the operator's
expectation at exactly the moment it should disagree. The read resolves
`/srv/ui/current` and reports:

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

**Implemented at `mosd/apid/src/bundle.rs` and `mosd/apid/src/startup.rs`** for
the row that is load-bearing. The third row's mechanism is the `current`
symlink under `/srv/ui` on DATA — created by `Store::point_current_at`, removed
by `Store::deactivate` — and it survives a restart because nothing re-creates
it: `startup::discover` re-reads the pointer on every start and answers "no
bundle" when it is absent. Rows 1 and 2 rest on configuration this campaign did
not change and which is cited in the table itself. **No row's persistence is
exercised on hardware**, and the A/B and factory-reset columns rest on reading
`os/update/rauc/system.conf.in` rather than on a test — §4's note governs.

Same framing, same columns and same honesty as `docs/design/access.md` §10.4
(`docs/design/access.md:500-508`); this table extends that vocabulary rather
than introducing a second one.

| What | Reboot | A/B update | Factory reset |
|---|---|---|---|
| **Custom UI bundles and the `current` pointer** (`/srv/ui`, DATA) | **yes** | **yes** — RAUC writes only the raw `rootfs` slot and the vfat `boot` slot (`os/update/rauc/system.conf.in:75-95`) and never touches DATA | **no**. Not implemented today (`docs/design/access.md:318-335`); a whole-disk reflash is the closest real operation, and it replaces DATA with the image's fresh filesystem — with §9.2's precision applying unchanged: blocks beyond the flashed extent are **unreachable, not erased** (`docs/design/access.md:454-459`) |
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
`mosd/apid/src/assets/serve.rs` — `active_root` answers class 1, `serve_index`
answers class 2 and class 4's index half with the built-in UI, and class 4's
inner-asset half is a 404 for that file and nothing else. Classes 3 and 5 are
start-up's, in `mosd/apid/src/startup.rs` — `recheck` re-checks the digest
recorded at activation and evaluates the declared range against
`SERVED_API_VERSIONS` as a **set intersection**, deactivating only on an empty
one and logging the declared range and the served set together. All five
classes are constructed end to end in `mosd/apid/src/tests/broken_classes.rs`,
each asserting a distinct state the mechanism reported so that no class can
pass for another's reason, with the set of classes that ran diffed against the
set declared.

**The constraint is implemented as a constraint, not as care.**
`startup::discover` is called from `mosd/apid/src/main.rs:83`, after both
listeners bind (`:62`, `:66`) and after `APID_LISTENING` is printed (`:72`). It
has **no error variant**: every outcome — an unreadable disk, a garbage
manifest, an absent `/srv/ui` — is a `BundleState`, and the work runs on the
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
| 1 | **No bundle installed.** `/srv/ui/current` absent | The asset router, `stat`/`readlink` returning `ENOENT` | Every request, cost of one syscall | Serve the built-in UI. **This is not an error** — it is the shipped state of every device, and it must not be logged as one |
| 2 | **A bundle with no `index.html`**, or whose index is a directory | Install-time validation (5.3 step 2), re-checked at activation | Before the bundle is ever reachable | Rejected at install. If it somehow reaches serving — the tree was mutated outside the install path — the SPA fallback has nothing to return and serves the **built-in UI**, not a 404 and not a 500 |
| 3 | **A malformed or half-written bundle** | Digest recorded at activation, re-checked | apid start-up and activation — **not** per request | Deactivate and serve the built-in UI, logging the mismatch |
| 4 | **A bundle whose files are unreadable** (`EACCES`, `EIO`) | The asset router, at `open` | Every request | **Asymmetric — see below** |
| 5 | **A UI that renders perfectly and cannot talk to any API version apid serves** | Nothing in the filesystem. See below | Activation, **and again at every apid start-up** | Refuse to activate, or deactivate, and say why — **only when the bundle's declared range and §2.1's served set have no member in common** |

**Class 3 is not reachable through the install path, and the two ways it *is*
reachable must be named.** Activation is a rename of a validated tree (5.3), so
the installer cannot produce it. It can arrive by a **power cut** — closed by
the `fsync`-before-rename in 5.3 step 3 — or by an **operator writing into
`/srv/ui` over a root shell**, which cannot be prevented on a device that offers
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
`config::Config::from_env()?` (`mosd/apid/src/main.rs:150`),
`tls::ensure_state_dir(...)` (`:151`),
`tls::load_or_generate_certificate(...)?` (`:153`),
`tls::load_or_generate_session_key(...)?` (`:154`) — all **before** the
listeners bind at `:162` and `:166`, and the unit is `Restart=on-failure`
(`mosd/dist/apid.service:15`). A startup error therefore becomes a **crash loop
with no listener bound**, which is precisely the failure this section exists to
prevent. **Bundle discovery and evaluation must happen after the listeners bind
and after `APID_LISTENING` is printed (`mosd/apid/src/main.rs:172`), and every
possible outcome must be a state the daemon holds, never an error it returns.**
A bundle must not be able to stop apid from listening. That is the actual safety
property, and it is stronger than any escape path.

The concrete shape of the version token, the handshake header and the error body
belongs to sections 2 and 3; the shape of the served set is fixed by §2.1's
`GET /api/versions` and is not re-specified here. This section states the
**requirement** only.

### 6.2 The built-in default UI, inside verity — **[implemented]**

This subsection was marked **[proposed]** because the *role* proposed for the
built-in UI — a fallback at a reserved path — did not exist; the artifact and
the protection described below already did at `86cd669`, and each is cited.
**The role now exists.** The built-in UI is what the asset router answers with
whenever a bundle cannot be served — `built_in` in
`mosd/apid/src/assets/serve.rs`, reached from `root`, from §4.2's condition 5
and from §6.1 classes 1, 2 and 4 — and it is reachable unconditionally at
§6.3's reserved prefix, `builtin_home` in `mosd/apid/src/routes.rs:802`. Its
form is unchanged and is asserted on the image rather than assumed:
`os/verify-image-v2.sh`'s `check_builtin_ui` (`:341`) requires the deactivate
form's rendered markup (`:231`) to be present in `/usr/bin/apid`, which is the
compiled-into-the-binary property checked as an on-image fact rather than as a
crate test, and `os/verify/src/checks-root.test.ts` drives that assertion against an input
in which it is false.

**Where it lives in the image: it is not a directory of files.** The built-in
UI is **compiled into the `apid` binary**. The pages are `maud` `html!` macro
expansions in `mosd/apid/src/routes.rs` (the macro is imported at `:29` and
used by every page handler), and the only
stylesheet is a `&str` constant emitted into the page head
(`mosd/apid/src/routes.rs:741-746`), described in the source as
*"Inline stylesheet shared by every page; no external assets"*
(`mosd/apid/src/routes.rs:719`). Section 1.6 evidences the rest: no
`include_str!`/`include_bytes!`, no `assets/`, `static/` or `public/` directory,
and no non-Rust file in the crate other than its manifest.

**How it gets there.** `os/rootfs/build-v2.sh:75-76` copies the cross-built
`apid` binary and its unit into the build context; `os/rootfs/scripts/mosd-install.sh`
installs the binary as `/usr/bin/apid` mode `0755`, `:295` installs the unit,
and `:297-299` enables it by symlink and **asserts the symlink exists**. The
binary is then part of the tree that `os/rootfs/build-v2.sh` packs into the
squashfs and covers with the dm-verity hash tree
(`docs/design/ro-root.md:13-27`).

**What guarantees an upload path can never write to it.** Three layers, and
naming which one is load-bearing matters more than the count:

1. **Load-bearing: dm-verity.** `/` is a squashfs assembled by the kernel from
   `dm-mod.create=` and mounted read-only, with no fstab entry that could remount
   it (`os/rootfs/overlay-v2/etc/fstab.in:7-9`, `docs/design/ro-root.md:239`). A
   write to `/usr/bin/apid` fails at the block layer, not at a permission check.
   **This holds even though apid runs as root** — the unit sets no `User=` line
   (`mosd/dist/apid.service:1-42`), so root is exactly what would be writing,
   and it still cannot. Nothing an operator uploads can reach the built-in UI,
   because nothing on the running system can.
2. **Real but not load-bearing: the bundle root is on a different filesystem.**
   `/srv/ui` is on DATA (5.2), every install-path write is confined to it, and
   4.4's canonicalise-and-assert bounds the *read* path to the same resolved
   tree.
3. **Absent, and named as absent: there is no systemd sandboxing.**
   `mosd/dist/apid.service:6-10` is the entire `[Service]` section — `Type=`,
   `ExecStart=`, `Restart=`, `StateDirectory=`. No `ProtectSystem=`, no
   `ReadWritePaths=`, no `ReadOnlyPaths=`. So layer 1 is not merely the
   strongest layer, it is the **only** one protecting the binary, and off a
   verity root there is nothing at all — which is not hypothetical, because
   `APID_STATE_DIR` exists precisely so the daemon runs off-device
   (`mosd/apid/src/config.rs:38-40`) and that is how the crate's tests run. This
   is a real gap, and is not counted as covered here.

**What we ship, and what we deliberately do not.** mos builds **no JavaScript
toolchain**, and section 1.6 measured that at `86cd669` four independent ways.
The built-in UI therefore stays **server-rendered `maud` with no build step**,
and **this document does not choose a frontend framework for it** —
`docs/design/dashboard.md` §5.8 already settled the live-value mechanism as
full-page refresh with a no-JavaScript off switch
(`docs/design/dashboard.md:1275-1276`; cited, not edited), which is the same
constraint approached from the other side.

**A customer's own UI is their toolchain, not ours.** This asymmetry is
deliberate and should not be read as an oversight. A bundle is a directory of
files that apid serves (5.3); whether the customer produced it with a bundler, a
compiler, a Makefile or by hand is invisible to the device and must **stay**
invisible. mos ships no bundler, pins no framework version, offers no build
integration, and takes no position on what a customer's UI is written in. The
reason is exactly section 6's requirement: **the artifact we guarantee will keep
working forever is the one with no build chain**, and guaranteeing that for
something we did not build and cannot rebuild would be a promise with no
mechanism behind it.

### 6.3 The deterministic way to reach it — **[implemented]**

**Implemented at `mosd/apid/src/routes.rs`** — candidate (A) is
`.nest(BUILTIN, …)` at `:115-125`, which claims the **whole** `/builtin`
subtree, its own not-found handler included, and is unshadowable for exactly
the structural reason `/api/` is; candidate (B) is the deactivate control the
pane carries, `builtin_deactivate` behind `POST /builtin/deactivate`
(`:122`, `:851`), which performs §5.3's deactivate. The two together are the
chosen mechanism, and both spellings answer: `nest` claims the bare `/builtin`
and **not** `/builtin/`, so the trailing-slash spelling — the one this document
writes — is declared outside the nest at `:125`. An operator recovering a
device should not have to get the slash right. The escape is driven from every
one of §6.1's five classes, identically and without diagnosis, by
`mosd/apid/src/tests/broken_classes.rs`, and the shadowing guard is fired in
both directions as a standing test. On the image, `os/verify-image-v2.sh`'s
`check_builtin_ui` (`:341`) asserts two facts the escape depends on: the packed
read-only root ships **nothing** at or under `/builtin`, so the prefix has not
grown a second, separately-built on-disk half; and the deactivate form's
rendered markup (`:231`) is present in `/usr/bin/apid`, which is true if and
only if the pane is compiled into the binary. Both are guard-fired against a
mutated input by `os/verify/src/checks-root.test.ts`.

The deactivate control is **POST only** — no `GET` handler exists — so no
prefetch, crawler or mis-clicked link can deactivate a working custom UI.

The requirement, restated as a test the mechanism must pass:

> **There is one documented action whose outcome does not depend on why the
> custom UI failed.** If the operator has to know the cause in order to choose
> the action, the mechanism has already failed.

Three candidates, evaluated.

**(A) A reserved path the asset router can never shadow.** A prefix — call it
`/builtin/` — served by the built-in handlers. 4.1's precedence rule makes it
unshadowable **structurally**: axum matches declared routes before consulting
the fallback, so no bundle content can occupy the prefix, and this is true
because of how dispatch works rather than because of a check.

- **Deterministic for classes 1-4: yes.** The built-in handlers do not read
  `/srv/ui` at all, so no bundle state — absent, corrupt, unreadable, wrong
  version — can affect them.
- **Class 5: yes, by definition.** Class 5 means the UI *renders*, so the
  listener is up and the prefix answers.
- **Costs.** It burns a path prefix permanently, and it only helps an operator
  who knows the URL. The mitigation proposed here — that the built-in error
  pages *"already exist and can name the path"* — **is the one surface that
  cannot carry it**, and RFCT-075 measured why: the crate's only error page is
  `bus_error` (`mosd/apid/src/routes.rs:646`), reached when a mosd call
  fails, and `gate` calls `get_settings("access")` on every path but `/healthz`
  *before* dispatch — so at the moment that page is on screen, `/builtin/` is
  answering 502 for the same reason, and naming the prefix there would advertise
  a path that is down. The prefix is instead named on the three built-in
  surfaces an operator with a broken custom UI actually reaches: the sign-in
  page (`mosd/apid/src/routes.rs:630`), the navigation on every built-in pane
  (`:311`), and the reserved subtree's own 404 (`:916`). The cost that must not be glossed: **(A) is a way *in*, not a way
  *out*.** It deactivates nothing, so the next navigation to `/` is broken
  again.

**(B) An override that disables the custom UI and survives a reboot.** Removing
`/srv/ui/current` — 5.3's *deactivate*.

- **Deterministic: yes, and it is the way *out*.** Afterwards `/` itself is the
  built-in UI, by 4.1's `/` rule.
- **Survives a reboot: yes.** The pointer is on DATA, and 5.4's third row
  asserts exactly this.
- **Cost, and it is decisive:** it requires an action the operator can only take
  through the API or a shell — that is, it **presupposes the access that may be
  broken**. It cannot be the only mechanism.

**(C) A boot-time or hardware escape** — a kernel cmdline flag, a recovery
button.

- **Rejected.** The cmdline is generated into the verity target
  (`docs/design/ro-root.md:135`) and is not operator-editable on a device, and
  `docs/design/uboot-ab-handshake.md:232` records that this board ships no
  `button recovery` and no `PREBOOT` rockusb entry. There is no shipped hardware
  escape to hang this on; inventing one is a bootloader change, not a daemon
  change, and it would be a large cost for a case (A) and (B) already cover.

**Chosen: (A) and (B) together, and neither alone.** (A) is the way in and
depends on nothing but the listener; (B) is the way out and becomes reachable
once (A) is. Concretely: **the built-in UI at the reserved prefix carries a
control that performs (B).** One documented action — *go to
`https://<device>/builtin/`* — reaches a working UI regardless of which of the
five classes occurred, and one click from there deactivates the bundle. **The
operator never has to diagnose anything**, which is the test this subsection
opened with.

**What if the operator cannot reach the API either?** The unflattering version,
because a comfortable one here would be worthless:

- **Under this design, a bad bundle cannot take the listener down.** 6.1's
  constraint puts bundle discovery and evaluation *after* the listeners bind
  (`mosd/apid/src/main.rs:62-72`, `:83`) and makes every bundle outcome a state rather
  than an error return. So the realistic causes of an unreachable API — a crash
  loop, a bind failure, a network misconfiguration — are **not caused by the UI
  mechanism**. That is the actual safety claim, and it is stronger than any
  escape path, because it means the escape path is rarely the thing standing
  between the operator and the device.
- **If the listener is down anyway, the escape is a shell, and
  `docs/design/access.md` §9.1 is blunt about what that is worth.** SSH is off
  by default (`mosd/mosd-settings/src/model.rs:108-112`, `enabled: false`), root
  is passwordless-locked, and the serial console does spawn a getty that has *no
  account which will accept a credential* (`docs/design/access.md:415-427`). An
  operator who enabled SSH and installed a key **before** the failure can
  `rm /srv/ui/current` and restart apid — that is a real path, and it is exactly
  as available as SSH was, which is: only if it was arranged in advance. An
  operator who did not is in §9.1's position, and the only remedy is a
  whole-disk reflash (`docs/design/access.md:437-459`) — which also clears the
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
(`mosd/dist/mosd.service:8` → `/usr/bin/mosd`, `mosd/dist/apid.service:8` →
`/usr/bin/apid`), two binaries installed separately by the image
(`os/rootfs/scripts/mosd-install.sh`), ordered `After=network.target
mosd.service` (`mosd/dist/apid.service:3`). What this subsection adds is the
argument, not a mechanism.

**The reasoning, and the code it rests on.** mosd treats first-boot
provisioning as a hard failure on purpose, and the code says why in as many
words: *"Hard failure on purpose: an unwritable STATE means no device identity
and no device credential, so there is no usable device to serve. A loud exit is
better than a daemon that quietly serves an unprovisioned tree the operator
cannot log in to."* (`mosd/mosd/src/main.rs:173-176`, with the `?` at `:183`).
A single-process design would make that exit take the UI with it: a provisioning
failure would leave a device with no diagnostic surface at all, reachable only
by serial console. Two processes are what keep the exit loud and the device
still explainable.

**The principle, stated once: the component that explains a failure must not be
the component that failed.** dashboard.md applies it to processes — mosd may
exit hard *because* apid is a different process and survives to render the 502
page *"The management daemon is unavailable."* (`mosd/apid/src/routes.rs:652`,
reachable because the bus client connects lazily and drops its cache on error,
`mosd/apid/src/bus_client.rs:23-26`, `:42-59`).

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
proposes it later: *ship the built-in UI as a bundle at `/srv/ui/builtin` and
serve both through one asset pipeline.* It looks cheaper — one code path instead
of two rendering strategies, and the default UI becomes replaceable by the same
mechanism as everything else. It is the same trade dashboard.md scored and
rejected: a DATA-level fault — a bad unpack, a filesystem error, an
`rm -rf /srv/ui` — would take **both** UIs at once, and the operator's
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

| Channel | Exists at `86cd669`? | Reaches `/srv/ui`? | Credential | Signed? |
|---|---|---|---|---|
| **The API upload path** | **no** — `grep -rn Multipart mosd/` returns nothing; §5.3's transport is proposed and the request that drives it belongs to §2.3/§3 | would, by construction | §3.2's bearer token, or an authenticated session (§3.2's bootstrap) | nothing exists to sign against — see 7.3 |
| **SSH** | **yes**, but **off by default on both image profiles** (`mosd/mosd-settings/src/model.rs:110-112`; `docs/design/access.md:212-218`), enabled only by an authenticated admin action through apid | **yes** — a shell writes the directory directly, with no involvement from apid at all | an authorized key, **every one of which is a root key** (`docs/design/access.md:225-230`; the pane says so and a test asserts the sentence, `mosd/apid/src/routes.rs:1762`, `mosd/apid/src/tests.rs:797`) | n/a |
| **A RAUC bundle** | **yes**, as an update mechanism | **no.** RAUC declares four slots — `rootfs.0` (`os/update/rauc/render-config.sh:239`), `rootfs.1` (`:245`), `boot.0` (`:265`) and `boot.1` (`:270`). DATA is not among them, and the survives-what table records the same from the other side (`docs/design/access.md:504`; §5.4) | n/a | **yes** — CMS, verified by `rauc` against `/etc/rauc/keyring.pem`, `plain` format refused (`os/update/rauc/system.conf.in:66-69`, `:78`) |
| **A factory image** | **yes**, but it ships DATA **empty.** `grep -n dataImg os/build/src/mkimage-v2.ts` returns exactly three lines: `:378` names the path, `:408` builds it with `makeExt4` — whose optional `seedDir` argument is **not passed**, so it is only `truncate` plus `mke2fs` and populates nothing — and `:437` `dd`s it into the image. Nothing mounts it and nothing copies into it. From the verifier's side the consequence is that an assertion about `/srv/ui` becomes owed only if the image ever ships something under `/srv/ui` | not today; it would need new work in the image pipeline | n/a | the image is not signed; the **bundle** built from it is |
| **The serial console** | **yes** — a getty spawns on both profiles | **no.** It *"has no account that will accept a credential"* (`docs/design/access.md:70`) | none that works | n/a |

**The count that matters.** Of five candidate channels, exactly **one reaches
`/srv/ui` on a shipped device today, and it is root**. A RAUC bundle
structurally cannot: it can replace the *built-in* UI, because that is compiled
into `/usr/bin/apid` inside the rootfs slot (§6.2), and it cannot install a
custom one. A factory image could, but does not. The console cannot. **The only
new channel this proposal creates is the API upload path**, and every trust
question in this section is about that one row.

### 7.2 The honest baseline: anyone with SSH is already root — **[implemented]**

`docs/design/access.md` §4.1 states it without qualification: *"Every authorized
key is a root key"*, and `mos` is *"a persistent working directory and a non-root
default shell, **not a lesser privilege level**"*
(`docs/design/access.md:232-233`). apid runs as root — the unit sets no `User=` line
(`mosd/dist/apid.service:1-42`), and the D-Bus policy records the same fact from
the other side (`mosd/dist/com.mos.mosd.conf:12-14`), with root allowed to own,
send and receive (`:68-72`).

So an operator with SSH:

- writes `/srv/ui/bundles/N` and re-points `current` with two shell commands,
  bypassing every validation §5.3 specifies — no unpack check, no manifest
  parse, no digest, no compatibility check;
- and **does not need to**. They read `/var/lib/mos/settings.toml` directly, they
  read `/var/lib/mos/apid/session.key` and mint a valid session cookie (§4.4,
  `mosd/apid/src/session.rs:51-61`), and they call `com.mos.mosd1` without going
  through apid at all.

**A signature on a UI bundle stops none of that.** A verifier is code that runs
on the device; the person with root owns the device's code, the keyring it would
check against, and the daemon that would do the checking. Any scheme whose
threat model includes local root is describing a property it cannot have. §3.3
reaches the same conclusion for the API token — *"Anyone with SSH is already
root, so none of this applies to them"* — and this section does not weaken it.

Note also that §6.1 has **already accepted** the consequence: failure class 3
names *"an operator writing into `/srv/ui` over a root shell"* as one of the two
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
`rauc bundle` with the material `make os-devkeys` generates (`Makefile:53-54` →
`os/update/rauc/gen-dev-keys.sh`): an OpenSSL CA plus a signer certificate, explicitly
**development-only**, gitignored, and carrying a banner that says so
(`os/update/rauc/gen-dev-keys.sh:2-3`, `:8-10`). On device, verification is `rauc`'s,
against `/etc/rauc/keyring.pem`, with `plain`-format bundles refused by
configuration (`os/update/rauc/system.conf.in:71-78`). Three reasons it does not
transfer:

1. **The trust anchor does not exist on any device.** The keyring is *"NOT
   shipped by this task and NOT in git"*, and *"until
   one is installed, `rauc install` on device fails closed"*
   (`os/update/rauc/system.conf.in:72-77`). The
   image verifier asserts only that no keyring is baked into the packed root,
   and records why in as many words: *"Absence is the shipped state; rauc
   install fails closed until one is provisioned"*
   (`os/verify/src/checks-root.ts:593-595`). A UI-bundle verifier would need an
   anchor that no shipped device has.
2. **The verification is `rauc`'s, not ours.** No Rust in this workspace verifies
   a CMS signature — `mosd/apid/Cargo.toml:11-31` carries no signature crate
   (`rustls` and `rcgen` are TLS, `sha2` is a bare digest). Reusing it means
   shelling out to `rauc`, and the crate's own rule forbids precisely that:
   *"mosd owns every system action: apid never spawns a process and never talks
   to systemd itself"* (`mosd/apid/src/settings_api.rs:10-12`).
3. **The key hierarchy is the wrong one even if it were reachable.** It is the
   fleet's OS-image signer. Signing a customer's HTML with the key that
   authorises a kernel and rootfs replacement makes the two operations equally
   trusted, which is backwards.

**The TUF skeleton (`update/sign`, RFCT-016).** `mos-sign` is a member of the
same cargo workspace (`mosd/Cargo.toml:3`) built on `tough` pinned at `=0.18.0`
(`mosd/Cargo.toml:42-44`). It is **build-host tooling**: it *"runs on a build
host, never on a device, and its output is static content"*
(`update/README.md:6-7`). It is not installed into the image at all —
`grep -rn "mos-sign\|update/sign" os/` returns nothing at `86cd669`. And its
README names the missing half without being asked: the **on-device Uptane
client** is named as *"Explicitly out of scope for the whole crate"*
(`update/README.md:34`). Its own README also records that RAUC's CMS signature
*"is a separate key hierarchy"* (`update/README.md:44`), so the two bodies of
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
   key (`mosd/apid/src/routes.rs:1762`). §3.2 states there are **no scopes in
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
  therefore say *"and check `/srv/ui/current`"*.
- **There is no provenance record at all.** After an upload, nothing on the
  device says who uploaded it, from where, or when. §3.3 already records that
  nothing in the crate logs which credential served a request. §5.3's read
  reports the digest and the manifest — both of which the uploader chose. So
  "which bundle is this?" is answerable and "who put it here?" is not.
- **An on-path attacker under §3.3 item 1 can substitute a bundle.** The
  certificate is self-signed with SANs that do not match the address operators
  actually use (`mosd/apid/src/tls.rs:59-67`), so clients are configured to skip
  verification and the token is captured on first use. **Of the three items,
  this is the only one a signature would close**, and it would close it only
  because the anchor would have been provisioned out of band — which is the same
  out-of-band channel that would have fixed the certificate.

**What would trigger revisiting — four conditions, each mechanically
checkable.**

1. **A production keyring is provisioned on devices.**
   `os/update/rauc/system.conf.in:56-61` records that this is out of scope and that
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
   `mosd/dist/com.mos.mosd.conf:48-61` deliberately deferred.
4. **The on-device Uptane client is implemented.** `update/README.md:25` names
   it as explicitly out of phase 1. Once a device verifies TUF metadata for one
   artifact class, extending it to a second is incremental rather than novel.

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
  (`docs/design/access.md:535`).
- **Code and dependency.** A signature verifier inside a root-privileged,
  network-facing daemon, plus whatever crate carries it. `mosd/deny.toml` bans no
  C-building crate and `mosd/hack/check.sh:9` checks only licenses, bans and
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
`mosd/dist/apid.service:12-39` is the whole `[Service]` section. It sandboxes
the daemon in the directions that cost nothing to a root network listener —
`NoNewPrivileges=`, `ProtectHome=`, `PrivateTmp=`, `MemoryDenyWriteExecute=`,
`RestrictAddressFamilies=` — and it carries no `ProtectSystem=` and no
`ReadWritePaths=` (§6.2 layer 3). So nothing at the process level bounds what
the upload handler can write, and dm-verity does not help, because §4.4 already
established that verity protects integrity and not confidentiality and a write
outside `/` is not a write to `/`. The fix belongs in
`mosd/dist/apid.service`, and **this section endorses it as the concrete
substitute for signing** — it is cheaper, it needs no key material, and it bounds a real
class of bugs rather than attesting an authorship nobody disputes.

**Recommendation, restated in one line, because a section like this must end
with an answer and not with a survey: do not sign UI bundles in phase 1;
authorise the upload with §3.2's token, spend the effort on `ProtectSystem=`
and `ReadWritePaths=` in `mosd/dist/apid.service`, and revisit the moment any
one of the four triggers above becomes true.**

## 8. Migration and phasing — **[proposed]**

### 8.1 What happens to today's server-rendered pages — **[proposed]**

**First, the fact this subsection is a decision about.** Measured at `86cd669`:
apid's pages are `maud` `html!` expansions compiled into the `apid` binary, with
one inline stylesheet constant and no external asset of any kind
(`mosd/apid/src/routes.rs:29`, `:727-734`, `:745`; §1.1 constraint 1 and §1.6
evidence it four ways). There is no build chain to retire and no asset directory
to move.

**And the question §6.2 leaves for this section, answered concretely: yes, the
built-in UI that §6.2 says ships inside verity IS today's maud pages.** §6.2
measures exactly that — the built-in UI is compiled into the `apid` binary —
and identifies how it gets inside the verity squashfs
(`os/rootfs/build-v2.sh:75-76`, `os/rootfs/scripts/mosd-install.sh`). No second
artifact is proposed anywhere in §6 and none is needed. What this section adds
is not a new artifact; it is **where those pages are reachable, and when they
move**.

Three options, all three costed, one chosen.

| Option | What it means | What it costs | Verdict |
|---|---|---|---|
| **A — they become the default static UI** | render the maud output into a bundle, ship it at `/srv/ui/builtin`, and serve built-in and custom through one asset pipeline | §6.4 names this exact proposal — *"ship the built-in UI as a bundle at `/srv/ui/builtin` and serve both through one asset pipeline"* — and rejects it, because a DATA-level fault (a bad unpack, a filesystem error, an `rm -rf /srv/ui`) takes **both** UIs at once and converts a recoverable failure into `docs/design/access.md` §9.1's unrecoverable one | **Rejected**, and recorded here only so that §8 does not reintroduce by scheduling what §6.4 rejected by argument |
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

Items (iv) and (v) are already shipped — `mosd/apid/src/routes.rs:1563`, `:1728`,
`:1506`, `:1516`, `:2018`, `:2558`. Items (i), (ii) and (iii) are new panes, and
they are the only built-in-UI work any phase below schedules.

**One contradiction between sibling sections, named here and reconciled here
rather than by editing either.** §2.1 says *"The nineteen existing paths
(section 1.2) keep their method, their path and their behaviour unchanged"*.
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
side by side (`docs/design/access.md:401-410`).

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
| 4 | Static hosting and the whole custom-UI lifecycle (§4, §5, §6) — with **no** upload route | `l1-o7ee8v0o-20260820142702-ui` (RFCT-071..079) | **landed** — §§4-6 carry per-subsection `[implemented]` markers; §4's preamble records the landing |
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
(`mosd/mosd-settings/src/store.rs:145`) strips the keys this schema does not
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
(`mosd/apid/src/bus_client.rs:159`, `:170`, `:181`, `:206`) and `zbus` 5.19.0
(`mosd/Cargo.lock:2907-2908`) carries the distinction in
`Error::MethodError(OwnedErrorName, ...)`. The phase matches on it, carries
the fdo error name into a typed error, and teaches the HTML handlers to stop
rendering `bus_error` (`mosd/apid/src/routes.rs:645-656`) for a value mosd
merely rejected. Optionally in the same phase, mosd's `to_fdo`
(`mosd/mosd/src/bus.rs:487-497`) stops collapsing `NotFound`, `ReadOnly` and
`Validation` (`mosd/mosd-settings/src/error.rs:7-31`) into one
`InvalidArgs`.

**What an operator can do that they could not before.** Submit an invalid CIDR
on `/network` and be told **why**. Today `network_submit` returns `bus_error` when
the settings write fails (`mosd/apid/src/routes.rs:1532-1538`), and `write_key_list`
does the same (`:1075-1077`), so a rejected value is reported to the operator as
*"The management daemon is unavailable."* — an outage message for a typo. §2.4
calls this out with the VLAN example. **This phase is a visible bug fix that
needs no API at all.**

**Acceptance.** A route test in which the in-memory `SettingsApi` fake
(`mosd/apid/src/settings_api.rs:3-4`, `:33-47`) returns a mosd validation error
renders mosd's message in the pane and does **not** render the 502 page; and a
test in which the fake returns a transport failure still renders the 502 page.
Both directions, because a test that only proves the new path leaves the old one
unasserted.

**What is explicitly still missing.** There is no API. Nothing about static
hosting. `/healthz` still answers `ok` while mosd is dead (§2.4 case 3), because
it must (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:219-232`).

**Why this is first and not folded into phase 2.** Two reasons, and the second
is the load-bearing one. First, §2.4's *whole error table* depends on
recovering the fdo error name, and §2.4 is not implementable until it is —
which apid now does, by downcasting to the concrete `zbus::Error`
(`mosd/apid/src/routes.rs:531-532`) and mapping `FDO_INVALID_ARGS`,
`FDO_IO_ERROR` and `FDO_FAILED` onto three distinct API error codes
(`:541-552`). Second: §2.1's breaking-change list makes *"changing
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
`mosd/mosd-settings/src/model.rs:15`, `:49`), so `SCHEMA_VERSION` must move 4 → 5
(`mosd/mosd-settings/src/model.rs:11`).

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

   That is the guard at `mosd/mosd-settings/src/store.rs:63-67`, and it returns
   **before `migrate` is ever called** (`:68`). No migration of any direction
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
   (`mosd/mosd-settings/tests/settings.rs:241`, `:277`, `:506`, `:536`, `:996`,
   `:1011`, `:1081`). `mosd/mosd-settings/src/store.rs:68` is the sole
   production caller of `migrate` and it can only ever walk **upward**.

**What follows, corrected.** An A/B rollback into a phase-1 slot after a token
has been minted does not degrade — it **fails the settings load**, and
`mosd/mosd/src/main.rs:45-48` propagates that with `?`, so mosd exits. Under
`Restart=on-failure` (`mosd/dist/mosd.service:13`) that is a crash loop, and
because apid's gate calls `GetSettings("access")` on **every** request
(`mosd/apid/src/routes.rs:704`) the whole appliance answers the 502 page *"The
management daemon is unavailable."* (`mosd/apid/src/routes.rs:650-660`). **The
appliance's own recovery mechanism becomes the thing that breaks management** —
the conclusion this document originally reached for the wrong reason.

**And it is pre-existing, not something this phase invents.** The same guard
applies to the v3 → v4 bump that already shipped (RFCT-032): a device updated to
schema v4 and then rolled back to a v3 binary hits `store.rs:63` identically.
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
(`mosd/apid/src/session.rs:32`, `:5-6`); and it does not expire at 24 hours.

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
path answers 422 (`mosd/apid/src/routes.rs:2590-2596`). The HTML path is not
changed.

**What an operator can do that they could not before.** Provision a
factory-fresh device entirely from a script. `POST /api/v1/setup` is
unauthenticated by necessity — it is the only route the gate lets through in
setup mode (`mosd/apid/src/routes.rs:708-713`) — and it returns a token (§2.3),
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
HTML path answers **502** (`mosd/apid/src/routes.rs:650-660`), so one appliance
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
rejection and canonicalise-and-assert; `/srv/ui` with the
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
startup steps with `?` (`mosd/apid/src/main.rs:53-57`) under
`Restart=on-failure` (`mosd/dist/apid.service:15`), so a bundle that could fail
startup would produce a crash loop with no listener bound. **The marker is
`APID_LISTENING`, not `WEBD_LISTENING` as this phase and §6.1 were written**;
the rename moved the string as well as the paths. As landed, the two binds are
`mosd/apid/src/main.rs:62` and `:66`, the marker is printed at `:72`, and
`startup::discover` is called at `:83` with no error variant to propagate.

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

1. Met by `mosd/apid/src/tests/broken_classes.rs`: each of §6.1's five classes
   is constructed end to end, the one navigation to `/builtin/` reaches a
   working UI from every one of them, the control there deactivates the bundle,
   each class asserts a **distinct** state the mechanism reported so none can
   pass for another's reason, and the set of classes that ran is diffed against
   the set declared. Class 4's `EACCES` arm needs a non-root runner and was run
   under `setpriv`; the repository's own checks run as root.
2. Met by `mosd/apid/src/assets/path.rs`'s per-guard suite, in this repository
   and not in a dependency's. `/%252e%252e%2fetc%2fpasswd` is a 404 by an
   explicit rejection rather than by a miss — see §4.4's two rejections beyond
   the five rules.
3. Met at the **header** level only: the three cache classes and `nosniff` are
   asserted on every asset response
   (`mosd/apid/src/assets/mime.rs`, `mosd/apid/src/tests.rs`). No browser was
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
(`mosd/mosd-settings/src/model.rs:110-112`), which means on a default device
this phase's feature is unreachable. And nothing is signed (§7).

**Shippable on its own: yes, and this is the phase most likely to be argued
about, so the argument is answered here.** The objection is that it is half a
feature. It is not: the mechanism is complete and only the transport is manual,
and §7.1 measured that **SSH is the only channel that reaches `/srv/ui` on a
shipped device today anyway** — this phase does not withhold a channel, it uses
the one that exists. It also front-loads every genuinely hard part — traversal,
MIME sniffing, cache correctness, the escape, the start-up compatibility
re-check — into a phase whose exposed population already has root, so a bug in
any of them is a bug in front of people who could have caused it by hand.

---

#### Phase 5 — the upload path

**What ships.** The request that drives §5.3: a file-receiving authenticated
route (no multipart handler exists anywhere in the crate — `grep -rn Multipart
mosd/` returns nothing at `86cd669`), the archive-format dependency §5.3
declines to settle, a bound on upload size, and §7's authorisation decision
in force — bearer token or authenticated session, no signature.

**What an operator can do that they could not before.** Install a UI on a device
with SSH off. That is every device by default, on both image profiles
(`mosd/mosd-settings/src/model.rs:110-112`, `docs/design/access.md:212-218`), so
this phase is what turns phase 4 from a capability for people with shells into a
product feature.

**Acceptance.**

1. A bundle uploaded over HTTPS with a bearer token is the active UI on the next
   page load.
2. A bundle containing a symlink is rejected at unpack with §2.4's envelope, and
   the previously active bundle is **still active** — §5.3's independence
   property, tested rather than asserted.
3. An interrupted upload leaves nothing under `/srv/ui/bundles/` and no
   `current` pointing at anything new.
4. Uploading a bundle whose declared API range excludes the served version is
   refused at activation with a legible reason (§6.1 class 5, activation half).

**What is explicitly still missing.** Provenance: nothing records who uploaded
what (§7.4). Expiry on the credential that authorised it (§3.2).
Signing (§7.4, and its four triggers).

**This is the phase §7 is about**, and the phase boundary is where §7 becomes
checkable: before it, the only channel to `/srv/ui` is already root; after it,
there is a network-reachable one. If §7's recommendation is ever revisited, this
is the phase whose scope changes, and nothing earlier is affected.

---

#### Phase 6 — the update-upload UI: `docs/design/dashboard.md` §8 phase 4e

**The parked item, located and quoted rather than paraphrased.** It is phase
**4e** of `docs/design/dashboard.md` §8.2: *"**Install a bundle, with progress**
— an upload path, a place to put the bundle, a `rauc install` caller, and a
progress surface. Today: no upload route, `Multipart` appears nowhere under
`mosd/`, and no `rauc install` caller anywhere in `mosd/`"*
(`docs/design/dashboard.md:1779`). It is gap row **4**, restated at
`docs/design/dashboard.md:789` and originally measured at
`docs/research/mos-ui-inventory.md:584`.

**Re-measured at `86cd669`, its three "today" claims all still hold:**
`grep -rn Multipart mosd/` returns nothing, and `grep -rci rauc mosd/mosd/src/`
returns `0` for every one of the six files in that directory.

**It belongs after phase 5, and the reason is mechanical rather than a
preference.** Phase 5 builds three of the four things 4e needs and they are the
three that are apid's: a file-receiving authenticated route, a staged write onto
a persistent tier that is validated before it becomes live, and a progress
surface an operator can watch. What 4e adds beyond phase 5 is **mosd** work — a
bus method and a `rauc install` caller, neither of which exists — plus a staging
location constrained by size: a bundle staged for `rauc install` is ~72 MiB
(`docs/task/RFCT-054.md:37-38`) against a 64 MiB STATE
(`os/boards/cx3576/board.env:265`), so it must stage on DATA — the same tier
§5.2 chose for `/srv/ui`, for the same reason, and it is the only partition
carrying `x-systemd.growfs` (`os/rootfs/overlay-v2/etc/fstab.in:16`).

**One asymmetry between this phase and phase 5 that makes §7 concrete rather
than abstract.** The update-upload path **is** signature-checked and the
UI-upload path is not. `rauc` verifies the CMS signature against
`/etc/rauc/keyring.pem` and mos refuses `plain`-format bundles by configuration
(`os/update/rauc/system.conf.in:50-62`), and dashboard.md's own row states the
constraint that goes with it: *"**no "install this file anyway" affordance may
be added**"* (`docs/design/dashboard.md:1779`). The asymmetry is correct, and it
is what §7's recommendation actually says: **mos requires a signature on the
artifact whose compromise is a kernel, and does not require a key ceremony for
the artifact whose compromise is a web page on an origin the operator already
controls.** §7 is not a general posture against signing; it is a line drawn at a
specific place, and it is drawn here so a later reader does not generalise it.

**One prerequisite outside this document's scope, named rather than assumed
away.** No keyring is shipped and none is in git
(`os/update/rauc/system.conf.in:72-77`, `os/verify/src/checks-root.ts:592-621`), so until
production keyring provisioning happens, `rauc install` **fails closed** and
this phase's acceptance cannot be demonstrated on a shipped image at all.

**What is explicitly still missing after phase 6.** Everything in 8.3.

### 8.3 What is deliberately not phased — **[proposed]**

Four items that a reader will look for and not find above. Each is deferred for
a reason that already exists in this document, and each is named so that its
absence is a decision rather than an oversight.

1. **Token expiry.** Needs a wall clock apid does not read — `SessionStore` uses
   `Instant` throughout (`mosd/apid/src/session.rs:10`, `:53`, `:72`), which is
   monotonic and cannot express a deadline surviving a reboot (§3.2). It is not
   phased because the prerequisite is not scheduled anywhere.
2. **A `SettingsChanged` subscription, and any change-stream API.** mosd emits
   the signal (`mosd/mosd/src/bus.rs:212-214`, `:292-297`) and the proxy
   declares no `#[zbus(signal)]` member (`mosd/apid/src/bus_client.rs:20-25`).
   `docs/design/dashboard.md` §8 phase 3 already claims it for the UI side, and
   this document does not schedule work another campaign's phasing owns.
3. **Scopes on API tokens.** §3.2 states there are none in phase 1 and that
   inventing them means the per-method D-Bus allowlist
   `mosd/dist/com.mos.mosd.conf:48-61` deliberately deferred. Adding a phase
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
`mosd/mosd-settings/src/model.rs` is a breaking change to that contract. The
on-disk tree has a mechanism for exactly this — `SCHEMA_VERSION` and a
registered migration chain that walks both directions
(`mosd/mosd-settings/src/model.rs:11`, `mosd/mosd-settings/src/migration.rs:46-57`,
`:74-81`) — and **there is no equivalent for the API's view of it**. A v4→v5
migration moves a path a `v1` client hard-coded, and the client learns about it
by breaking.

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
  `Validation` (`mosd/mosd-settings/src/error.rs:7-31`) to stop collapsing into
  one `InvalidArgs` (`mosd/mosd/src/bus.rs:487-497`). §2.4 emits a single
  `settings_rejected` for all three as a result, and §2.1 makes *"changing which
  `error.code` an existing failure emits"* a major-version bump. So after v1
  ships, this improvement costs a `v2`.
- **The VLAN dot-path limit.** `valid_iface_name` permits `.`
  (`mosd/apid/src/routes.rs:806-811`) while `split_path` splits on it
  unconditionally (`mosd/mosd-settings/src/path.rs:26-32`), so `network.eth0.100`
  cannot be addressed (§2.2). It is pre-existing; what is new is
  that fixing it now reaches a published contract, so a settings-syntax change
  becomes an API change.
- **Uptime.** §2.2 chose that mosd should publish it into the live-state tree
  rather than apid keep reading `/proc/uptime`
  (`mosd/apid/src/routes.rs:1216`). Adding it later is additive and cheap;
  choosing a *different* representation later is not.

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
`SettingsApi` fake (`mosd/apid/src/settings_api.rs:3-4`, `:33-47`) plus an
end-to-end suite on a private bus. After phase 5 the matrix is (every operation
× HTML and JSON) × (bundle absent, present, corrupt, unreadable, incompatible)
× (every major version served), plus §4.4's five traversal cases, §4.2's five
fallback conditions, §4.3's cache criterion, and §6.1's start-up re-check — and
that last one runs on the startup path of a daemon under `Restart=on-failure`
(`mosd/dist/apid.service:15`).

*Partly mitigated.* §8.2's phasing adds no bundle dimension at all until phase
4, and §6.1's constraint — evaluation strictly after the listeners bind
(`mosd/apid/src/main.rs:175-183`), every outcome a state and never an error
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
(`mosd/apid/src/session.rs:18`, `:103`); §6.2 layer 1, which keeps the built-in
UI unwritable by anything including root. **Not mitigated:** the process-level
bound. `mosd/dist/apid.service:12-39` sandboxes the daemon in several
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
holds on `SameSite=Lax` alone (`mosd/apid/src/session.rs:103`). **The seam is
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
behind one gate (`mosd/dist/apid.service:1-42`,
`mosd/apid/src/routes.rs:191`), so a token can do everything the operator can do
over the API. "Give my CI a token that can read state but not reboot the
appliance" is not expressible in phase 1, and making it expressible later means
reopening the per-method D-Bus allowlist that
`mosd/dist/com.mos.mosd.conf:48-61` deliberately deferred and that
`docs/design/dashboard.md` §6.3.2 costed.

*Accepted.* §3.2 gained a real revocation granularity over §3.1 item 6 — N
tokens instead of one password — and gained no **authority** granularity at all.
Those are different axes and this document only moved one of them.

**11. A denial-of-service surface that already exists acquires attractive
targets.** The gate calls `GetSettings("access")` on **every** request before
deciding anything, including unauthenticated ones
(`mosd/apid/src/routes.rs:704`), against the single lock mosd holds over both
trees (`mosd/mosd/src/bus.rs:51-53`). An unauthenticated flood already costs one
D-Bus round trip per request; an API is a thing scripts hammer by design, and
§3.2 makes that cost structural by *depending* on the read being there.

*Accepted.* The dependency is worth naming twice: the same call that makes the
token check free is the one that makes the flood expensive, so caching it
requires `SettingsChanged` and is not a local change.

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
