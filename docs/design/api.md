# apid: an API-first management daemon with replaceable UI

> **Status:** proposal. This document proposes that the management daemon become
> **API-first** — that every management operation be reachable over a documented
> HTTP API, and that the human interface become one client of that API rather
> than the only way in, so a site can replace it without forking the daemon.
> The audience is whoever builds or replaces the mos management UI, and whoever
> has to script the appliance without a browser. Sections 2-9 are the proposal
> and are written by sibling tasks; section 1 is not a proposal at all — it is
> the measured surface those sections must be derived from.

## 0. How to read this document

**Status markers.** The convention is `docs/design/access.md` section 0
(`docs/design/access.md:23-30`), reused here in the same form. Every section
below that describes a **mechanism** carries one of:

- **[implemented]** — code exists and is named, by path.
- **[proposed]** — no code; this document is asking for it.
- **[not implemented]** — deliberately, no code at all. Prose only.

access.md's reason for the discipline applies here unchanged: *"dead code has a
compiler, a test run and a grep-for-callers that can surface it; a security
control that exists only as prose has no mechanism that will ever notice it is
absent"* (`docs/design/access.md:33-36`). This document is mostly **[proposed]**,
and marking it so is the point — a reader must be able to tell section 1 (which
can be checked against the tree) from sections 2-9 (which cannot, because there
is nothing to check yet). Sections 0 and 10 carry no marker: they describe no
mechanism, which is the same exemption access.md states at
`docs/design/access.md:40-41`.

**The commit this document was measured at.** Every factual claim in section 1
was read out of the tree at commit
`86cd669fa71889577f7e1ab1fab0e0e09a463dcf` — *"Merge webd SSH management:
default-off SSH, transient password, persistent keys, /home and /root on
DATA"* — which is this branch's merge base with `main`. Line numbers are that
commit's. A reader on a later tree should re-measure before trusting a line
number; the claims are written so that `git show 86cd669:<path>` settles any
disagreement.

**The `apid` / `webd` path note, and the check that settles it.** Prose in this
document says **apid**: it is the API daemon, and the dashboard is one thing it
serves. The crate directory on the tree measured here is **`mosd/webd/`**, and
the crate is named `webd` (`mosd/webd/Cargo.toml:2`). Campaign
`l1-o7ee8v0o-20260819152009-apid` is renaming the crate, the systemd unit, the
`StateDirectory`, both image verifiers, the Dockerfiles and the design docs.
The check that tells a reader which world they are in is:

```
test -d mosd/apid
```

- **Exit 0** — the rename has landed. Every `mosd/webd/...` path cited below is
  now `mosd/apid/...`, and the line numbers in section 1 are no longer reliable
  because the rename touched those files. Re-measure section 1 against the
  merged tree.
- **Exit 1** — the rename has not landed. The `mosd/webd/...` paths cited below
  open as written at `86cd669`, and the prose name `apid` is forward-looking
  only.

**What this document settles.** Section 1 settles what exists, so that no later
section invents a surface mos does not have. Sections 2-9 propose the API, the
programmatic authentication, static hosting, where a custom UI lives, the safety
escape back to a built-in UI, trust, phasing, and what the whole direction
forecloses.

**What this document does not settle.** It does not re-open anything
`docs/design/dashboard.md` decided (see section 1.7): not the live-value
mechanism, not the process architecture, not whether `com.mos.mosd1` is a
supported contract, not the rename. It proposes no route handler code, no
markup, and no build tooling. It makes **no hardware claims** — nothing
described or proposed here has been run on a device; every statement about
current behaviour is a reading of source.

## 1. The surface as it exists today — **[implemented]**

Measured at `86cd669`, as stated in section 0. Where this section and a design
document disagree, the code is recorded as the fact and the disagreement is
named.

### 1.1 What apid is, and the two constraints that bound every option

As of `86cd669`, apid is a Rust crate named `webd` (`mosd/webd/Cargo.toml:2`),
built into a binary started by a systemd unit as `/usr/bin/webd`
(`mosd/dist/webd.service:8`) after `mosd.service`
(`mosd/dist/webd.service:3-4`), with its state directory declared as
`StateDirectory=mos/webd` (`mosd/dist/webd.service:10`). The unit sets no
`User=` line (`mosd/dist/webd.service:1-13`), so the daemon runs as root; the
D-Bus policy file records the same fact from the other side — *"no shipped unit
sets User=, mosd.service owns the name as root, webd.service and the boot health
gate both run as root"* (`mosd/dist/com.mos.mosd.conf:12-14`).

It binds two listeners, defaulting to `0.0.0.0:443` for HTTPS and `0.0.0.0:80`
for the redirect-only HTTP listener (`mosd/webd/src/config.rs:34-37`), and
prints exactly one machine-readable startup line,
`WEBD_LISTENING https=<addr> http=<addr>` (`mosd/webd/src/main.rs:69`), routing
everything else to stderr (`mosd/webd/src/main.rs:43-45`).

**Constraint 1 — the pages are server-rendered maud, with no JavaScript build
chain.** The template engine is `maud` (`mosd/webd/Cargo.toml:18`, resolved to
`maud = "0.27"` at `mosd/Cargo.toml:43`), used directly in the handlers via the
`html!` macro (`mosd/webd/src/routes.rs:14`). The HTTP stack is `axum`
(`mosd/webd/Cargo.toml:15` → `axum = "0.8"` at `mosd/Cargo.toml:36`) served by
`axum-server` (`mosd/webd/Cargo.toml:16` → `mosd/Cargo.toml:37`). There is no
JavaScript: `routes.rs` contains no occurrence of the string `script` in any
case (`grep -ci script mosd/webd/src/routes.rs` returns `0` at `86cd669`), and
the only stylesheet is an inline constant (`mosd/webd/src/routes.rs:158-165`)
injected into the page head as `style { (PreEscaped(STYLE)) }`
(`mosd/webd/src/routes.rs:176`). The crate contains no non-Rust file other than
its manifest (`find mosd/webd -type f ! -name '*.rs'` returns
`mosd/webd/Cargo.toml` alone), so there is no bundler input, no `package.json`,
and nothing for a build chain to consume.

**Constraint 2 — TLS is rustls only.** `rustls` is pinned with
`default-features = false` and the `ring`, `std` and `tls12` features
(`mosd/Cargo.toml:38`), `axum-server` takes the `tls-rustls-no-provider`
feature (`mosd/Cargo.toml:37`), certificate generation uses `rcgen` with the
`ring` backend (`mosd/Cargo.toml:39`), and the daemon installs the ring provider
explicitly before anything else runs
(`mosd/webd/src/main.rs:46-48`). No OpenSSL, and no C TLS stack, appears in the
crate's dependency list (`mosd/webd/Cargo.toml:11-29`). The workspace also
forbids unsafe code (`mosd/Cargo.toml:10-11`) and the crate repeats the forbid
locally (`mosd/webd/src/main.rs:21`).

These two constraints bound every option in sections 2-6: an API that requires a
JavaScript toolchain to be usable from the shipped UI, or a TLS feature rustls
does not offer, is not free — it is a change to the posture recorded here.

### 1.2 The route table as shipped

There are **two** routers in `mosd/webd/src/routes.rs`.

The **HTTPS application router** is `app()` at `mosd/webd/src/routes.rs:43-68`.
Every route it declares is listed below; the `gate` middleware is layered over
all of them at `mosd/webd/src/routes.rs:66`.

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
| `POST /power/reboot` | `:55` | `power_reboot` (`:896`) → `power_submit` (`:869`) | HTML form POST | 422 when the confirm token does not match (`:870-878`); otherwise **202 Accepted** (`:890`) with the D-Bus call spawned on a detached task so the response goes out first (`:879-888`) | `Reboot()` (`:882`) |
| `POST /power/poweroff` | `:56` | `power_poweroff` (`:900`) → `power_submit` (`:869`) | HTML form POST | Same shape | `PowerOff()` (`:883`) |
| `GET /ssh` | `:57` | `ssh_form` (`:1200`) | GET page | SSH pane: stored `access.ssh` settings, the authorized-key list, and the sshd reconciler's live state | `GetSettings("access.ssh")` (`:1035`), `GetState("sshd")` (`:1045`) |
| `POST /ssh/enable` | `:61` | `ssh_enable` (`:1216`) | HTML form POST | Writes the checkbox state and redirects to `/ssh?saved=1` (`:1225`) | `SetSettings("access.ssh.enabled", …)` (`:1220`) |
| `POST /ssh/password` | `:62` | `ssh_password` (`:1261`) | HTML form POST | Sets a **transient** root password after a confirm token and a length check (`:1240-1259`) | `SetTransientRootPassword()` (`:1272`) |
| `POST /ssh/keys/add` | `:63` | `ssh_key_add` (`:1284`) | HTML form POST | Parses and validates one public key, then rewrites the whole list; 422 on a rejected key (`:1085`) | `GetSettings("access.ssh")` (`:1062`), `SetSettings("access.ssh.authorizedKeys", …)` (`:1075`) |
| `POST /ssh/keys/remove` | `:64` | `ssh_key_remove` (`:1317`) | HTML form POST | Removes one key and rewrites the whole list | same as add |
| `GET /healthz` | `:65` | `healthz` (`:153`) | neither — plain text | Returns the literal `ok` | none |

**Kinds, counted.** Of the nineteen method+path pairs above — declared by
fifteen `.route()` calls (`mosd/webd/src/routes.rs:45-65`) — seven are GET
pages, eleven are HTML form POSTs, and one (`/healthz`) is neither: it returns a
bare string (`mosd/webd/src/routes.rs:153-155`). **There is no route in this router that
returns JSON, and none that accepts a JSON request body** — every mutating
handler takes `Form<...>`, axum's URL-encoded form extractor
(`mosd/webd/src/routes.rs:8`, and each handler signature, e.g. `:381`, `:708`,
`:1284`). That absence is the whole reason sections 2 and 3 exist.

**Two deliberate absences, both commented in the source.** No `GET` handler
exists for either power action (`mosd/webd/src/routes.rs:52-54`) or for any of
the four SSH mutations (`mosd/webd/src/routes.rs:58-60`), so a browser prefetch,
a crawler or a mis-clicked link cannot power the appliance off or enable SSH.
And there is no CSRF token anywhere in the crate (`grep -ni csrf
mosd/webd/src/*.rs` returns nothing at `86cd669`); the mitigations that exist
are the `SameSite=Lax` cookie attribute (section 1.4) and the per-action confirm
token on power (`mosd/webd/src/routes.rs:870`) and on the transient password
(`mosd/webd/src/routes.rs:948`).

**The second router.** `redirect_app()` at `mosd/webd/src/routes.rs:72-76` is
the router served on the **HTTP** listener. It declares no routes at all — only
a fallback (`:74`) — and answers every request with a 308 Permanent Redirect to
the HTTPS origin, deriving the host from the `Host` header with any port
stripped and re-attaching the actual HTTPS port unless it is 443
(`mosd/webd/src/routes.rs:78-95`). It carries no state beyond that port
(`:75`), no auth gate, and no access to mosd. Both routers are wired in
`main` — `routes::app(state)` on the rustls listener and
`routes::redirect_app(https_addr.port())` on the plain one
(`mosd/webd/src/main.rs:78-83`).

### 1.3 How apid reaches mosd

apid never spawns a process and never talks to systemd itself; every system
action goes through mosd. The trait doc states it as a rule: *"The power actions
are here rather than executed locally because mosd owns every system action:
webd never spawns a process and never talks to systemd itself"*
(`mosd/webd/src/settings_api.rs:10-12`).

**The bus and the interface.** The transport is **D-Bus**, via `zbus`
(`mosd/webd/Cargo.toml:29` → `mosd/Cargo.toml:24`). The proxy declares the
interface `com.mos.mosd1`, the well-known service name `com.mos.mosd`, and the
object path `/com/mos/mosd` (`mosd/webd/src/bus_client.rs:9-13`). mosd's side
declares the same three: `BUS_NAME` (`mosd/mosd/src/bus.rs:20`), `OBJECT_PATH`
(`mosd/mosd/src/bus.rs:22`) and the interface attribute
(`mosd/mosd/src/bus.rs:179`). Which bus is chosen is configuration: `WEBD_BUS`
selects system (the default) or session (`mosd/webd/src/config.rs:41-45`).

**Every method apid calls today — six.** The proxy trait
(`mosd/webd/src/bus_client.rs:14-21`) declares exactly:

| Proxy method | Line | mosd's implementation | Called from |
|---|---|---|---|
| `get_settings(path) -> String` | `bus_client.rs:15` | `mosd/mosd/src/bus.rs:182` | the gate (`routes.rs:131`) and the `/`, `/setup`, `/login`, `/network`, `/hostname`, `/ssh` handlers |
| `set_settings(path, value_json)` | `bus_client.rs:16` | `mosd/mosd/src/bus.rs:191` | `/setup`, `/network`, `/hostname`, `/ssh/enable`, `/ssh/keys/*` |
| `get_state(path) -> String` | `bus_client.rs:17` | `mosd/mosd/src/bus.rs:219` | two paths only: `GetState("network")` (`routes.rs:580`) and `GetState("sshd")` (`routes.rs:1045`) |
| `reboot()` | `bus_client.rs:18` | `mosd/mosd/src/bus.rs:257` | `POST /power/reboot` (`routes.rs:882`) |
| `power_off()` | `bus_client.rs:19` | `mosd/mosd/src/bus.rs:265` | `POST /power/poweroff` (`routes.rs:883`) |
| `set_transient_root_password(password)` | `bus_client.rs:20` | `mosd/mosd/src/bus.rs:283` | `POST /ssh/password` (`routes.rs:1272`) |

**What apid does not call, and cannot receive.** mosd exposes a seventh method,
`ReportHealth` (`mosd/mosd/src/bus.rs:231`), which the proxy does not declare
(`mosd/webd/src/bus_client.rs:14-21`); its caller in the tree is the boot health
gate, not apid. mosd also emits one signal, `SettingsChanged(path, value_json)`,
after every successful `SetSettings` (`mosd/mosd/src/bus.rs:212-214`, declared
at `:292-297`). The proxy declares **no** `#[zbus(signal)]` member
(`mosd/webd/src/bus_client.rs:14-21`), so apid has no push notification of a
settings change from any source, including itself.

**Shape of the client.** All handler code depends on the `SettingsApi` trait
(`mosd/webd/src/settings_api.rs:13-31`), not on zbus, which is what lets the
route tests substitute an in-memory fake (`mosd/webd/src/settings_api.rs:3-4`,
`:35-47`). The real implementation connects lazily and caches the proxy, and
drops the cache on any call error so the next request reconnects; the documented
consequence is that mosd being down surfaces as per-request errors rather than a
crash (`mosd/webd/src/bus_client.rs:23-26`, `:42-59`). A failed call renders a
502 page reading *"The management daemon is unavailable."*
(`mosd/webd/src/routes.rs:106-116`).

**Who else may call.** The shipped D-Bus policy restricts `com.mos.mosd` to
root in both directions — the default context denies both `send_destination` and
`receive_sender` (`mosd/dist/com.mos.mosd.conf:63-66`) and only `user="root"`
is allowed to own, send and receive (`:68-72`). The file also carries an
explicit extension point describing the block a future non-root apid would need
(`mosd/dist/com.mos.mosd.conf:32-46`) and a deliberately deferred per-method
allowlist (`:48-61`). Note that `docs/design/dashboard.md:1317-1320` cites this
file as permitting *"any local process"* to call it; at `86cd669` that is no
longer true — the code wins, and the policy is root-only.

### 1.4 Authentication as shipped

**Where the credential lives.** One password, stored as an argon2id PHC string
at the settings dot-path `access.webAdmin.password_hash`
(`mosd/webd/src/routes.rs:98-103`; the typed field is
`mosd/mosd-settings/src/model.rs:52-53` and `:66-71`). Hashing is argon2id with
default parameters (`mosd/webd/src/auth.rs:13-19`) and verification parses the
PHC string (`mosd/webd/src/auth.rs:22-26`). Nothing else in the crate
authenticates: there is no second credential, no user table, and no reference to
`access.device` in `mosd/webd/src/routes.rs`.

**How a session is established.** `POST /login` verifies the password and, on
success, calls `SessionStore::create` and sets the cookie
(`mosd/webd/src/routes.rs:499-534`). `POST /setup` does the same at the end of
the first-run wizard without a login step (`mosd/webd/src/routes.rs:469-474`).
The store generates 16 random bytes from `OsRng`, hex-encodes them as the id,
computes an HMAC-SHA256 of that id under the persistent signing key, records the
id with an expiry, and returns `<id>.<mac>` as the cookie value
(`mosd/webd/src/session.rs:44-55`).

**Cookie attributes and expiry.** The cookie is named `webd_session`
(`mosd/webd/src/session.rs:18`) and is set as
`Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
(`mosd/webd/src/session.rs:91`); logout re-sets the same attributes with
`Max-Age=0` (`mosd/webd/src/session.rs:96`). Server-side the TTL is 24 hours
(`mosd/webd/src/session.rs:19`), enforced on every verification, with an expired
entry removed as it is found (`mosd/webd/src/session.rs:66-79`). **Sessions live
in memory only** — a `HashMap` in the store (`mosd/webd/src/session.rs:26`) —
so, as the module doc states, *"a webd restart logs everyone out"*
(`mosd/webd/src/session.rs:5-6`). The HMAC signing key, by contrast, is
persisted: 32 bytes at `session.key` in the state directory, generated on first
start with mode `0600` (`mosd/webd/src/tls.rs:85-103`).

**What a request carries.** Only the cookie. The gate extracts it from the
`Cookie` header by prefix match (`mosd/webd/src/session.rs:99-111`) and verifies
signature-then-liveness (`mosd/webd/src/session.rs:57-79`). There is no
`Authorization` header path, no API key, and no token of any kind in the crate.

**The gate.** One middleware, layered over the whole HTTPS router
(`mosd/webd/src/routes.rs:66`), implements three modes
(`mosd/webd/src/routes.rs:126-151`): `/healthz` always passes (`:128-130`);
in **setup mode** — no admin password hash present — only `/setup` passes and
everything else redirects there (`:135-140`); in **normal mode** `/login` and
`/setup` pass and everything else requires a valid session cookie or redirects
to `/login` (`:141-150`). Note the gate calls `GetSettings("access")` on
**every** request (`mosd/webd/src/routes.rs:131`), so every request costs at
least one D-Bus round trip.

**Brute-force accounting.** A single global counter, not per-client: five
consecutive failures arm a 30-second lockout that rejects every login attempt
(`mosd/webd/src/auth.rs:9-10`, `:38-64`). The comment states why per-client
tracking was rejected — *"the appliance has one admin password, so per-client
tracking buys nothing against an online guesser"*
(`mosd/webd/src/auth.rs:28-31`).

**TLS material.** The certificate is self-signed and generated on first start
into the state directory: CN `mos`, SANs `DNS:mos`, `DNS:localhost`,
`IP:127.0.0.1` (`mosd/webd/src/tls.rs:44-81`), with the private key written mode
`0600` (`mosd/webd/src/tls.rs:30-42`, `:78`) inside a state directory created
mode `0700` (`mosd/webd/src/tls.rs:20-28`). That directory defaults to
`/var/lib/mos/webd` and is overridable by `WEBD_STATE_DIR`
(`mosd/webd/src/config.rs:38-40`), and is provided by systemd as
`StateDirectory=mos/webd` (`mosd/dist/webd.service:10`). There is no ACME
client, no certificate rotation, and no way to install an operator-supplied
certificate in `mosd/webd/src/tls.rs`.

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
(`mosd/mosd-settings/src/store.rs:12`), written atomically through `Store`
(`mosd/mosd-settings/src/store.rs:14-18`). Every struct in the model carries
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
into `Settings` (`mosd/mosd-settings/src/model.rs:367-371`) — and only then
calls `store.save` (`mosd/mosd/src/bus.rs:199-203`), so a malformed write
mutates nothing. Second, **the dot-path syntax has no array indexing**: the
model comment says a list is *"written as a whole JSON array through the
dot-path API"* (`mosd/mosd-settings/src/model.rs:213-214`), which is exactly why
the SSH pane reads the whole key list, edits it in memory, and writes the whole
list back (`mosd/webd/src/routes.rs:1061-1080`).

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
(`mosd/mosd/src/bus.rs:46-49`), and `GetState` returns the subtree at a dot-path
or `InvalidArgs` (`mosd/mosd/src/bus.rs:219-224`). Four kinds of thing write into
it, and that set is the entire read surface an API can expose:

1. **One key per reconciler**, named by `name()` above, holding that
   reconciler's applied result, or `{"error": "..."}` when it failed
   (`mosd/mosd/src/bus.rs:125-132`, `:137-148`).
2. **`power`** — `{last_action, requested_by}`, recorded *before* the action so
   the record survives the machine going down (`mosd/mosd/src/bus.rs:86-100`).
3. **`health.<component>`** — `{status, detail}`, written by `ReportHealth`
   (`mosd/mosd/src/bus.rs:231-251`).
4. **`dry_run`** — present only when `MOSD_DRY_RUN=1`
   (`mosd/mosd/src/main.rs:43`, `:90-93`), in which case no reconcilers are
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
   `mosd/webd/Cargo.toml:11-29` and contains no `tower-http`; `tower` itself
   appears only under `[dev-dependencies]` (`mosd/webd/Cargo.toml:31-34`). The
   workspace pins `tower` with only the `util` feature (`mosd/Cargo.toml:46`),
   which carries no file-serving service.
2. **No file-serving service is constructed.** `grep -n "ServeDir\|ServeFile"
   mosd/webd/src/*.rs` returns nothing, and the HTTPS router
   (`mosd/webd/src/routes.rs:44-68`) declares no `nest_service`, no
   `fallback_service` and no `fallback` at all — the only `fallback` in the file
   is the HTTP redirect router's (`mosd/webd/src/routes.rs:74`).
3. **Nothing is embedded in the binary.** `grep -n "include_str!\|include_bytes!"
   mosd/webd/src/*.rs` returns nothing.
4. **There is no asset to serve.** The crate contains no non-Rust file other
   than its manifest (`find mosd/webd -type f ! -name '*.rs'` returns
   `mosd/webd/Cargo.toml`), and the crate has no `assets/`, `static/` or
   `public/` directory (`find mosd/webd -type d` returns `mosd/webd`,
   `mosd/webd/src` and `mosd/webd/tests`).

What the pages need instead is inlined: the single stylesheet is a `&str`
constant emitted into each `<head>` (`mosd/webd/src/routes.rs:158-165`, `:176`),
described in the source as *"Inline stylesheet shared by every page; no external
assets"* (`mosd/webd/src/routes.rs:157`). There is no favicon route, no font,
and no image: a request for `/favicon.ico` matches nothing in
`mosd/webd/src/routes.rs:44-68`, so it is answered by the gate — a redirect to
`/login` when unauthenticated (`mosd/webd/src/routes.rs:149`), and otherwise
axum's default not-found.

The consequence for section 4 is concrete rather than stylistic: static hosting
is not a matter of pointing an existing middleware at a directory. Nothing in
the crate reads a file off disk to serve it today, and the only disk paths it
touches at all are `/proc/uptime` (`mosd/webd/src/routes.rs:581`) and its own
state directory (`mosd/webd/src/tls.rs:47-49`, `:86`).

### 1.7 What the dashboard proposal already settled

`docs/design/dashboard.md` is a merged proposal covering sections 1-8
(`docs/design/dashboard.md:3-7`), and this document must not re-decide what it
decided. Four things are settled there and are treated as inputs here. **Live
values:** section 5.8 adopts *"option A — full-page refresh — as the dashboard's
only live-value mechanism, at a 15-second default interval, with a
no-JavaScript off switch"* (`docs/design/dashboard.md:1275-1276`), on the
grounds that mosd has no live-state push signal at all and that a no-JavaScript
path must keep working; it explicitly names what that forecloses, including any
sub-15-second value and all client-side UI state
(`docs/design/dashboard.md:1304-1315`). **Process architecture (section 6 —
owned by campaign `l1-o7ee8v0o-20260819152009-apid`; cited here, not edited):**
section 6.6 recommends *"option 2, together with the read half of option 3 —
primitives (a) and (b). Defer option 3's action verb (c). Do not merge."*
(`docs/design/dashboard.md:2198-2199`), i.e. two processes with a real
privilege boundary rather than folding the web daemon into mosd. **The bus as a
contract:** section 7.3 answers *"yes, `com.mos.mosd1` is a supported contract,
and it must remain served regardless of which process option is chosen"*
(`docs/design/dashboard.md:2431-2433`), because the boot health gate is a real
second consumer whose failure path is an A/B rollback
(`docs/design/dashboard.md:2433-2435`). **The rename:** section 7.4 costs it and
enumerates the surfaces, including the only item with a cost on already-deployed
devices, the `StateDirectory` and `/var/lib/mos/webd`
(`docs/design/dashboard.md:2482-2499`). This document therefore assumes a
server-rendered no-JavaScript built-in UI, two processes, a bus that keeps
existing, and the name `apid`; a section below that needs any of those to change
must say so and say why, rather than quietly assuming it.

**Where this section agrees with the earlier inventory, and where that inventory
has gone stale.** `docs/research/mos-ui-inventory.md` measured the same surface
at commit `d0bcae92656257021bb67bf7db72b8ac5bfb4651`
(`docs/research/mos-ui-inventory.md:16`), which is **not** this document's base.
It **agrees** with everything measured here about the technology posture —
server-rendered maud, zero JavaScript, rustls-only TLS, listeners on
`0.0.0.0:443` and `0.0.0.0:80` — and about the shape of the session mechanism
and of the settings dot-path model. It has gone **stale** in six ways, and in
each case the tree at `86cd669` is the fact:

1. **Line numbers throughout its section 2.1 no longer resolve.** It cites
   `GET /` at route `:42` and handler `:566`; at `86cd669` those are
   `mosd/webd/src/routes.rs:45` and `:578`.
2. **Its route table is missing five routes.** `GET /ssh`, `POST /ssh/enable`,
   `POST /ssh/password`, `POST /ssh/keys/add` and `POST /ssh/keys/remove` all
   exist at `mosd/webd/src/routes.rs:57-64`. Its own section 8 predicted exactly
   this and instructed a re-measure after the `sshweb` merge
   (`docs/research/mos-ui-inventory.md:536-560`) — which is the merge this
   document's base commit is.
3. **"Six methods and one signal"** (`docs/research/mos-ui-inventory.md:287`) is
   now seven methods: `SetTransientRootPassword` exists at
   `mosd/mosd/src/bus.rs:283` and apid calls it
   (`mosd/webd/src/bus_client.rs:20`, `mosd/webd/src/routes.rs:1272`).
4. **"the sole call site is `GetState("network")`"**
   (`docs/research/mos-ui-inventory.md:293`) is now two call sites; `GetState("sshd")`
   is at `mosd/webd/src/routes.rs:1045`.
5. **Schema version "3"** (`docs/research/mos-ui-inventory.md:317`) is now
   **4** (`mosd/mosd-settings/src/model.rs:11`).
6. **Its section 3.6 quotes a D-Bus policy that permits any local process**
   (`docs/research/mos-ui-inventory.md:263-280`); the shipped policy at
   `86cd669` denies the default context in both directions and allows root only
   (`mosd/dist/com.mos.mosd.conf:63-72`). `docs/design/dashboard.md:1317-1320`
   carries the same stale reading.

Its navigation-bar count is likewise off by one — it records *"exactly four
links plus a logout button"* (`docs/research/mos-ui-inventory.md:93-97`), and
`shell()` now renders five plus the logout form
(`mosd/webd/src/routes.rs:180-189`). Nothing in its section 9 contradiction
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
(`mosd/webd/src/routes.rs:44-68`), so today every `/api/...` request is handled
by the gate, which redirects it to `/login` when unauthenticated
(`mosd/webd/src/routes.rs:149`) and otherwise falls through to axum's default
not-found. The API prefix is therefore free.

**The version lives in the path segment immediately after `/api/`.**
Recommended, for three reasons that are properties of this codebase rather than
general taste:

1. The gate already dispatches on `request.uri().path()`
   (`mosd/webd/src/routes.rs:127`). A version check is the same string operation
   the one existing middleware already performs, so it needs no new extractor
   and no new failure mode in the layer that guards everything
   (`mosd/webd/src/routes.rs:66`).
2. axum registers routes by path (`mosd/webd/src/routes.rs:44-68`). A second
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
(`mosd/webd/src/routes.rs:88`, `:89-93`) — that is not the objection. The
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

`settingsSchemaVersion` carries mosd's `SCHEMA_VERSION`
(`mosd/mosd-settings/src/model.rs:11`, value **4** at `86cd669`). **It is not
the API version and the two must never be conflated.** The schema version is the
shape of the tree on disk (`mosd/mosd-settings/src/store.rs:12`), moved by a
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
(`mosd/webd/src/routes.rs:135-140`). An authenticated probe cannot answer the
question it exists to answer. The cost is an unauthenticated fingerprint:
anyone who can reach port 443 (`mosd/webd/src/config.rs:34-37`) learns which API
major versions this device speaks. The appliance already answers `/healthz` with
the literal `ok` unauthenticated (`mosd/webd/src/routes.rs:128-130`, `:153-155`),
so this is one more bit on a listener that already identifies itself — it is not
zero, and it is exactly why the response carries a version list and nothing
else: not the hostname, not `provisioning.deviceId`
(`mosd/mosd-settings/src/model.rs:174-176`), not a build string.

**What apid promises across a patch release versus an A/B image update.** The
honest starting point is that **there is no apid patch release independent of an
image update.** The binary is `/usr/bin/webd` (`mosd/dist/webd.service:8`), and
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
  version bump, which is a much larger promise for §6 to keep.

### 2.2 Resource model — **[proposed]**

Derived from `mosd/mosd-settings/src/model.rs` and `mosd/mosd/src/bus.rs` as
measured at `86cd669`. Nothing here invents a model alongside mosd's; where the
settings tree and a sensible REST resource genuinely disagree, the disagreement
is named and the choice is costed.

**Three roots, because mosd has three things and not one.**

| Root | Backed by | Methods | Why it is separate |
|---|---|---|---|
| `/api/v1/settings/<dot-path>` | `Settings` (`mosd/mosd-settings/src/model.rs:16-32`) via `GetSettings` / `SetSettings` (`mosd/mosd/src/bus.rs:182`, `:191`) | `GET`, `PUT` | typed, validated, persisted to `/var/lib/mos/settings.toml` (`mosd/mosd-settings/src/store.rs:12`), survives reboot and A/B update (`docs/design/access.md:504`) |
| `/api/v1/state/<dot-path>` | the live-state tree via `GetState` (`mosd/mosd/src/bus.rs:219`) | `GET` only | untyped `serde_json::Value` (`mosd/mosd/src/bus.rs:46-49`), in memory, no writer that is not a reconciler or `ReportHealth` |
| `/api/v1/actions/<verb>` | `Reboot`, `PowerOff`, `SetTransientRootPassword` (`mosd/mosd/src/bus.rs:257`, `:265`, `:283`) | `POST` only | not state at all — see §2.3 |

The split is mosd's, not a stylistic preference. The two trees have different
types (`settings: Settings` and `state: Value`, `mosd/mosd/src/bus.rs:47-48`),
different mutability (`SetSettings` exists; there is no `SetState` anywhere in
the proxy trait, `mosd/webd/src/bus_client.rs:14-21`, nor in mosd's interface
impl, `mosd/mosd/src/bus.rs:179-298`), and different lifetimes (the settings tree
is saved atomically on every write, `mosd/mosd/src/bus.rs:202`; the live-state
tree is a field of `Inner` that starts empty or as `{"dry_run": true}`,
`mosd/mosd/src/bus.rs:63-64`, `mosd/mosd/src/main.rs:90-93`). An API that merged
them would have to decide on every request which half a path belonged to.

**The dot-path is the resource identifier, verbatim.** `GET
/api/v1/settings/access.ssh` returns exactly what `GetSettings("access.ssh")`
returns (`mosd/mosd/src/bus.rs:182-186`). `PUT /api/v1/settings/hostname` with
body `"router"` performs exactly `SetSettings("hostname", "\"router\"")`
(`mosd/mosd/src/bus.rs:191-216`). This is the recommendation, and the
alternative it rejects is the interesting part.

**Rejected: hand-shaped REST nouns that do not map onto the tree** (`GET
/api/v1/ssh`, `PATCH /api/v1/network/eth0`). What it costs is not extra code —
it is a second model that has to be kept in sync with `model.rs` by hand. Every
field added to `Settings` is invisible over the API until someone also adds it
to the resource layer, and a field that is invisible over the API is, by this
project's own rule, unsupported: *"An unmodelled setting is an unsupported
setting"* (`docs/design/access.md:468-474`). Hand-shaped nouns reproduce exactly
that failure one layer up, where nothing — no compiler, no
`deny_unknown_fields` (`mosd/mosd-settings/src/model.rs:15`, `:49`, `:78`, and
ten more) — will ever notice the omission. The passthrough cannot drift, because
there is nothing to drift from.

**What the passthrough costs, stated plainly.** The API becomes exactly as
capable as the bus, including the bus's limits:

- **No array indexing.** The dot-path syntax has none; the model says a list is
  *"written as a whole JSON array through the dot-path API"*
  (`mosd/mosd-settings/src/model.rs:213-214`). Every client that wants to add
  one SSH key must read `access.ssh.authorizedKeys`, append, and write the whole
  list back — which is precisely what the HTML pane does today
  (`mosd/webd/src/routes.rs:1061-1080`). Two clients doing that concurrently
  lose one of the two writes, with no mechanism that notices.
- **Whole-subtree writes are all-or-nothing.** `Settings::set` deserializes the
  entire root into `Settings` after the write and rejects the result if it does
  not fit (`mosd/mosd-settings/src/model.rs:367-371`), and every struct carries
  `#[serde(deny_unknown_fields)]`, so a `PUT` of a subtree with one extra key
  fails the whole write. That is a good property — it is also a surprising one
  for a client that expected a merge.
- **A dot in a value collides with a dot in the path.** Verified at `86cd669`:
  apid accepts an interface name containing `.`
  (`mosd/webd/src/routes.rs:231-236` permits `.`, `_` and `-`), but `split_path`
  splits on `.` unconditionally (`mosd/mosd-settings/src/path.rs:26-32`), so
  `network.eth0.100` — a VLAN sub-interface — lands as a field named `100`
  inside `IfaceSettings` and is rejected by `deny_unknown_fields`
  (`mosd/mosd-settings/src/model.rs:308-315`). Running `Settings::set` against a
  default tree with that path returns `Validation { path: "network.eth0.100",
  message: "unknown field `100`, expected `dhcp` or `static`" }`. This is a
  **pre-existing** limit of the dot-path model, not one the API introduces — the
  HTML form has it too — but an API that adopts the dot-path adopts it, and a
  client must be told rather than left to discover it as a 502 (§2.4). It is
  routed onward in §10.1.

**The exception: two collection resources, added deliberately.** The dot-path
model fails outright for the two arrays in the tree, because a per-item delete
cannot be expressed as a settings write at all. Both get a named collection:

| Collection | Underlying dot-path | Item identity | Routes |
|---|---|---|---|
| SSH authorized keys | `access.ssh.authorizedKeys` (`mosd/mosd-settings/src/model.rs:105`, item at `:129-135`) | SSH fingerprint | `GET`/`POST /api/v1/ssh/authorized-keys`, `DELETE /api/v1/ssh/authorized-keys/{fingerprint}` |
| WiFi client networks | `wifi.client.networks` (`mosd/mosd-settings/src/model.rs:215`, item at `:231-243`) | `ssid` | `GET`/`POST /api/v1/wifi/client/networks`, `DELETE /api/v1/wifi/client/networks/{ssid}` |

**Identity is never a list index.** The reason is already recorded in the crate,
and it is the reason here too: *"an index is only meaningful against the list the
operator was looking at, so a key added or removed by another session between the
render and the submit would slide it onto a different key and delete something
nobody asked to delete"* (`mosd/webd/src/routes.rs:1306-1316`). A `DELETE` whose
identifier matches nothing is an error, not a silent success, for the reason the
same comment gives: *"'removed' when nothing was removed is how an operator ends
up believing access was withdrawn while the key still grants root."*

**What the exception costs.** There are now two ways to write the same state:
`PUT /api/v1/settings/access.ssh.authorizedKeys` and `DELETE
/api/v1/ssh/authorized-keys/{fingerprint}`. A client using the first can produce
a list the second would have rejected. The floor is the same either way, because
both end at `SetSettings` → `Settings::set` → `store.save`
(`mosd/mosd/src/bus.rs:199-203`), and the collection route additionally runs
`validate_authorized_keys` first — the same validator mosd runs before rendering
the file (`mosd/webd/src/routes.rs:1066-1071`). So the difference is the quality
of the error message, not whether a bad list can be written. That is an
acceptable cost and it is named rather than hidden. The passthrough route must
**not** be removed for these two paths: removing it would make the collection the
only way in, and a client that needs to replace a whole list atomically would
have to issue N deletes and M posts with no atomicity at all.

**Redaction is a rule of this root, not of a handler.** As of `86cd669`,
`GetSettings("access")` returns the subtree verbatim
(`mosd/mosd/src/bus.rs:182-186`), and `access.webAdmin.password_hash`
(`mosd/mosd-settings/src/model.rs:68-71`) is a field of it. A settings
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
mitigation is a test, not a hope — routed in §10.1. A redacted field is
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
| SSH keys | the authorized-keys collection above | `access.ssh.authorizedKeys` | **every key is a root key** (`docs/design/access.md` §4.1, `mosd/webd/src/routes.rs:944`); the API response must carry that sentence in a `notice` field for the same reason the pane must carry it |
| Transient root password | `POST /api/v1/actions/transient-root-password` | `SetTransientRootPassword` (`mosd/mosd/src/bus.rs:283`) | an action, not a setting — see §2.3 |
| Web admin credential | `GET /api/v1/settings/access.webAdmin` (redacted), `PUT` refused | `WebAdminSettings` (`model.rs:68-71`) | see §3.2 for why the API does not offer a password change in phase 1 |
| Console | `GET`/`PUT /api/v1/settings/access.console` | `ConsoleSettings` (`model.rs:140-145`) | only the `debug` image ships the shell at all (`model.rs:141-142`) |
| Power | `POST /api/v1/actions/reboot`, `.../poweroff` | `Reboot`/`PowerOff` (`mosd/mosd/src/bus.rs:257`, `:265`) | actions — see §2.3 |
| Reconciler results | `GET /api/v1/state/<name>` for `hostname`, `network`, `sshd`, `wifiClient`, `wifiAp` | one key per reconciler (`mosd/mosd/src/bus.rs:125-132`, `:137-148`) | an entry is either the applied result or `{"error": "..."}`; the API passes both through unchanged |
| Last power request | `GET /api/v1/state/power` | `{last_action, requested_by}` (`mosd/mosd/src/bus.rs:86-100`) | recorded *before* the action, so it survives the machine going down |
| Health | `GET /api/v1/state/health` and `GET /api/v1/health` | `health.<component>` (`mosd/mosd/src/bus.rs:231-251`) | the two are different questions — see §2.4 |
| Dry-run marker | `GET /api/v1/state/dry_run` | present only under `MOSD_DRY_RUN=1` (`mosd/mosd/src/main.rs:43`, `:90-93`) | in that mode no reconcilers are registered at all (`:71-75`), so every other state key is absent |

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
   (`mosd/webd/src/routes.rs:581`) — one of only two disk paths apid touches
   outside its own state directory (section 1.6). Exposing it over the API means
   either apid keeps reading it, which contradicts the rule the crate states
   about itself — *"mosd owns every system action: webd never spawns a process
   and never talks to systemd itself"* (`mosd/webd/src/settings_api.rs:10-12`) —
   or mosd publishes it into the live-state tree and the API reads it there.
   **Chosen: mosd publishes it**, and until it does, uptime has no API
   representation. Cost: the API is missing a field the HTML status pane shows,
   until a mosd change lands. Routed in §10.1.

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
(`mosd/webd/src/routes.rs:52-54`) or for any of the four SSH mutations
(`:58-60`), *"so a browser prefetch, a crawler or a mis-clicked link cannot power
the appliance off"*.

The **confirmation token** that guards the three form posts today
(`mosd/webd/src/routes.rs:870`, and `TRANSIENT_CONFIRM_TOKEN` at `:948`) does
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
goes out before the machine goes down (`mosd/webd/src/routes.rs:879-893`). 202
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
- **`GET /healthz` (`mosd/webd/src/routes.rs:65`, `:153-155`).** It keeps its
  path, its unauthenticated exemption (`:128-130`) and its literal `ok` body,
  unchanged and unversioned, because it has a real consumer with a real failure
  path: the boot health gate probes `https://127.0.0.1/healthz` with curl and
  falls back to wget (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:164-177`),
  and the image verifier asserts that probe exists
  (`os/verify-image-v2.sh:1350`). Moving it under `/api/v1/` would put a
  version bump in the path of the boot gate whose failure is an A/B rollback
  (`docs/design/dashboard.md:2433-2435`).
  **But it answers a narrower question than its name suggests, and the API must
  not repeat the mistake.** `/healthz` returns before any check
  (`mosd/webd/src/routes.rs:128-130`), so it answers `ok` on an appliance whose
  mosd is dead. `GET /api/v1/health` is the API's health endpoint and reports
  both halves — see §2.4.
- **A password change.** `access.webAdmin.password_hash` is written by exactly
  one handler today, `setup_submit` (`mosd/webd/src/routes.rs:441-444`), and
  there is no change-password route anywhere in the crate. The API does not
  invent one: it would be the first operation the API offers that the UI does
  not, and it needs a decision about whether changing the password revokes
  tokens (§3.2 says it does not). Routed in §10.1.
- **`ReportHealth`.** mosd exposes it (`mosd/mosd/src/bus.rs:231`) and apid does
  not declare it on the proxy (`mosd/webd/src/bus_client.rs:14-21`). The API does
  not expose it either: its caller is the boot health gate, a root-local process
  that already has the bus, and turning it into an HTTP write would let any token
  holder forge a component's health status.

**One behaviour change the API should make, named because it is a change.**
`ssh_key_remove` answers **422** when the identifier matches nothing
(`mosd/webd/src/routes.rs:1329-1335`, via `ssh_error` at `:1082-1091`). For a
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
| `settings_rejected` | 422 | mosd | mosd answered `org.freedesktop.DBus.Error.InvalidArgs` (`mosd/mosd/src/bus.rs:158-160`, `:198`, `:222`) |
| `settings_io` | 500 | mosd | mosd answered `IOError` (`mosd/mosd/src/bus.rs:161`) |
| `mosd_failed` | 500 | mosd | mosd answered `Failed` (`mosd/mosd/src/bus.rs:163`, `:176`, `:111`, `:120`) |
| `mosd_unreachable` | **503** | apid | the call could not be made at all |

**The question that matters: does the API surface mosd's errors or translate
them? Recommendation: translate the classification, pass the message through
verbatim, and always say which side it came from.**

The reason is what apid does today, which is neither. As of `86cd669`, apid
**flattens**: `BusSettings` converts every `zbus::Error` straight to
`anyhow::Error` with `err.into()` (`mosd/webd/src/bus_client.rs:70`, and the
same line at `:80`, `:91`, `:103`, `:114`, `:128`), and every handler renders
one page for the result — `bus_error`, HTTP **502**, body *"The management daemon
is unavailable."* (`mosd/webd/src/routes.rs:106-116`). So a settings value mosd
rejected as invalid is reported to the operator as the daemon being down:
`network_submit` returns `bus_error` on a failed `SetSettings`
(`mosd/webd/src/routes.rs:726-729`), and `write_key_list` does the same
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
are anyhow chains built by mosd with `{err:#}` (`mosd/mosd/src/bus.rs:176`).
mosd carries a contract that one of them — the transient-password path — never
echoes the password (`mosd/mosd/src/bus.rs:170-177`, restated in
`mosd/webd/src/bus_client.rs:123-125` and `mosd/webd/src/settings_api.rs:26-30`),
but that contract is stated for that one method. Making the HTTP body a verbatim
copy of every chained message from every method extends a one-method promise
across the whole interface, silently, and the extension is not written down
anywhere. **Translating the classification while copying the message keeps the
same exposure the HTML path already has** — the pane already shows mosd's message
text in an error box (`mosd/webd/src/routes.rs:1048`, `:590`, `:610`) — without
widening it.

**And the failure mode of the choice this rejects.** If the API translated the
message too — replacing mosd's text with apid's own phrasing per code — then
every message mosd learns to produce is invisible until apid is taught it. The
"unknown field `100`, expected `dhcp` or `static`" string in the example above
comes from serde, through `SettingsError::Validation`
(`mosd/mosd-settings/src/model.rs:367-371`, `mosd/mosd-settings/src/error.rs:14-21`),
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
   reconnects (`mosd/webd/src/bus_client.rs:23-26`, `:56-59`). The cost is
   named: the HTML path returns 502 for the same underlying failure
   (`mosd/webd/src/routes.rs:106-116`), so until §8 changes both, one appliance
   reports one outage two ways. Changing only the API is the wrong half of that
   trade and this section says so.
3. **mosd down entirely, distinguished from "everything is fine".** This is the
   case that must not be got wrong, because apid surviving a dead mosd is an
   existing design property, stated in the crate: *"mosd not being up yet
   therefore surfaces as per-request errors (502 pages), never as a webd crash"*
   (`mosd/webd/src/bus_client.rs:23-26`). The trap is already in the tree:
   `/healthz` returns before any check (`mosd/webd/src/routes.rs:128-130`) and
   answers the literal `ok` (`:153-155`), so **an appliance whose mosd is dead
   answers `/healthz` with `ok`**. A monitor polling it sees a healthy device.
   `/healthz` cannot be fixed, because the boot health gate depends on exactly
   that behaviour (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:164-177`) — its
   comment says so in as many words: *"`/healthz` is webd's existing endpoint and
   bypasses its auth gate"* (`:164`).

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
   request (`mosd/webd/src/routes.rs:131`) and returns `bus_error` when it fails
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
   `Redirect::to("/login")` (`mosd/webd/src/routes.rs:149`), a 303/307-class
   response. A client that follows redirects — which is the default for `curl
   -L`, for Python `requests`, and for most HTTP libraries — ends up at `GET
   /login`, which the gate lets through (`:141-143`) and which returns
   **200 OK** with an HTML form (`:486-497`). A script that checks the status
   code and stops there concludes its request succeeded. This is the sharpest of
   the seven: every other item makes the client's life harder, and this one makes
   it *wrong*.
2. **Obtaining the credential means emulating three browser behaviours.**
   `POST /login` takes `Form<LoginForm>` — axum's URL-encoded extractor
   (`mosd/webd/src/routes.rs:8`, `:499`), not JSON — answers **302 to `/`**
   (`:520-524`), and delivers the credential in a `Set-Cookie` header
   (`:521`, value built at `mosd/webd/src/session.rs:90-92`). A client must
   therefore URL-encode rather than serialise JSON, *not* follow the redirect,
   and parse a `Set-Cookie` header. None of those is hard; all three are the
   client pretending to be something it is not.
3. **The credential does not survive a restart of the daemon that issued it.**
   Sessions live in a `HashMap` in memory (`mosd/webd/src/session.rs:26`) and the
   module says so: *"a webd restart logs everyone out"*
   (`mosd/webd/src/session.rs:5-6`). Since apid ships inside the verity rootfs
   (`mosd/dist/webd.service:8`, `docs/design/access.md:468-474`), **every A/B
   image update invalidates every session**. A cron job's credential expires
   whenever the fleet is updated, and per item 1 the job's next run gets a 200
   and an HTML page.
4. **The TTL is fixed at 24 hours and is not renewed by use.** The expiry is
   stamped once at creation (`mosd/webd/src/session.rs:53`, TTL at `:19`) and
   `verify` only compares against it — it never extends it
   (`mosd/webd/src/session.rs:66-79`). A long-running client is logged out
   mid-operation exactly 24 hours in, with no warning in any response before
   that point.
5. **The expiry is monotonic, not absolute.** `Instant` (`session.rs:10`, `:53`)
   is a monotonic clock. A client cannot compute when its session dies from
   anything the server told it, because nothing on the wire carries the
   server's notion of now.
6. **There is exactly one credential, and it identifies a human.** The only
   thing the crate authenticates against is
   `access.webAdmin.password_hash` (`mosd/webd/src/routes.rs:98-103`); there is
   no second credential, no user table, and no reference to `access.device` in
   the route module (section 1.4). A script therefore holds the operator's
   password. Revoking the script means changing that password, which logs the
   operator out too — there is no smaller unit of revocation than "everyone".
7. **A misconfigured script locks the operator out, repeatedly.** The login
   backoff is a single global counter, not per-client, by explicit design:
   *"the appliance has one admin password, so per-client tracking buys nothing
   against an online guesser"* (`mosd/webd/src/auth.rs:28-31`). Five consecutive
   failures arm a 30-second lockout that rejects **every** login attempt
   (`mosd/webd/src/auth.rs:9-10`, `:52-58`; the 429 at
   `mosd/webd/src/routes.rs:500-508`). A script retrying with a stale password
   every ten seconds holds the human admin out of the web UI indefinitely. That
   comment's reasoning is sound *for one password*; adding a second class of
   credential is what makes it stop being sound, which §3.2 has to answer.

Items 6 and 7 are the ones that cannot be fixed by making the session mechanism
nicer. They are consequences of there being one credential.

### 3.2 The proposal: a bearer API token — **[proposed]**

**One mechanism.** A long-lived, revocable bearer token, minted by an
authenticated admin, stored hashed in the settings tree, sent in an
`Authorization` header. It is the **only** accepted credential on `/api/v1/`
routes: the session cookie authenticates the HTML pages and nothing else.

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
(`mosd/webd/src/session.rs:44-55`) — and the reason to keep the id visible is
mechanical: with N tokens stored, an opaque blob forces apid to hash the
presented secret and compare against all N entries on every request, while an
embedded id is one lookup and one comparison. 32 bytes is 256 bits, double the
session id's 128 (`mosd/webd/src/session.rs:46`), because unlike a session this
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
   (`mosd/mosd-settings/src/store.rs:12`), mounted from `/mnt/state/mos` by
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
   unsupported setting"* (`docs/design/access.md:468-474`). apid's own state
   directory `/var/lib/mos/webd` (`mosd/webd/src/config.rs:38-40`,
   `mosd/dist/webd.service:10`) is on the same STATE bind and would satisfy
   reason 1 — but a credential granting full management access that mosd does not
   know about gets no row in the survives-what table, no validation, and no
   backup story, and it sits outside the one place this project has decided
   credentials live.
4. **It costs zero extra bus round trips.** The gate already calls
   `GetSettings("access")` on **every** request
   (`mosd/webd/src/routes.rs:131`) and `apiTokens` is a child of `access`, so
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
argon2id (`mosd/webd/src/auth.rs:13-19`) because a human chose that password and
an offline attacker with the hash can guess it. A token is 256 bits from `OsRng`
and there is nothing to guess; a work factor would buy no security and would be
paid on **every API request**, where the password's is paid once per login. The
`sha2` crate is already a dependency (`mosd/webd/Cargo.toml:25`, used by
`mosd/webd/src/session.rs:15`), so this adds nothing to the dependency list.
The comparison must be constant-time — the crate already contains the right
primitive, `Mac::verify_slice` (`mosd/webd/src/session.rs:61`), and a `String`
`==` on hex digests is what must not be written. To be honest about the size of
that requirement: a timing leak on a *stored digest* is not a practical attack,
because learning the digest does not yield a preimage. Constant-time is required
anyway, because deciding it site-by-site is how the one site where it mattered
gets missed.

**How a token is created.** `POST /api/v1/tokens`, body `{"name": "ci-deploy"}`,
authenticated by an existing credential — response `201` with
`{"id": "...", "name": "...", "token": "mos_..."}`. **The plaintext appears in
that response and nowhere else, ever**: only the hash is stored, so a lost token
is replaced, not recovered. That is the same posture `access.device` already
takes (`mosd/mosd-settings/src/model.rs:147-152`).

The bootstrap problem — the first token cannot be minted with a token — is
answered by the browser session, not by a new channel. **An authenticated
session cookie may mint a token**, through a new pane in the built-in UI; that
is the one place the cookie reaches past the HTML pages. The alternatives were
worse: minting over SSH needs SSH, which is off by default and stays off until
an authenticated admin action through the web UI
(`mosd/mosd-settings/src/model.rs:110-112`, `docs/design/access.md` §4.1), so it
is circular; and minting at first-run setup means `POST /setup` returns a
credential the operator did not ask for and may never rotate. `POST /api/v1/setup`
(§2.3) does return one, because a caller who drove first-run setup over the API
demonstrably wants API access — but the browser wizard does not.

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
  the same pattern the SSH key pane uses (`mosd/webd/src/routes.rs:1061-1080`).
  Two concurrent mints lose one token, silently.
- Identity is the `id`, never a list position, for the reason recorded at
  `mosd/webd/src/routes.rs:1306-1316`: an index is meaningful only against the
  list the caller last read, and a concurrent change slides it onto a different
  entry. A `DELETE` whose id matches nothing is a 404, not a silent success.

**Expiry: none in phase 1, and that is a decision, not an omission.** An
absolute expiry needs a wall clock, and nothing in the crate reads one —
`SessionStore` uses `Instant` throughout (`mosd/webd/src/session.rs:10`, `:53`,
`:72`), which is monotonic and cannot express a deadline that survives a reboot.
Adding an `expiresAt` before there is a trusted wall clock would produce a field
that is either unenforced or enforced against a clock that resets. So: tokens do
not expire, and **revocation is the entire lifecycle**. The cost is blunt — a
token that leaks and is forgotten works forever, and nothing in the system will
ever remind anyone it exists beyond its appearance in `GET /api/v1/tokens`.
Making expiry possible is routed in §10.1.

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
  only one privilege level, because apid runs as root (`mosd/dist/webd.service`
  sets no `User=`, `:1-13`; `mosd/dist/com.mos.mosd.conf:12-14` records the same
  from the other side) and every route it serves is behind the same gate
  (`mosd/webd/src/routes.rs:66`). A token can do everything the operator can do
  over the API. There are no scopes in phase 1, and inventing them would mean a
  per-method allowlist that the D-Bus policy already contemplates and
  deliberately deferred (`mosd/dist/com.mos.mosd.conf:48-61`) — this document
  does not reopen that.

Two consequences of coexistence that must be stated in the UI, not just here:

1. **Changing the admin password does not revoke any token.** That is deliberate
   — a human rotating their own password must not break every script — and it
   means "I changed my password" is not a containment action. The UI's password
   pane has to say so.
2. **§3.1 item 7 changes meaning.** The `auth.rs:28-31` comment's reasoning —
   per-client tracking buys nothing because there is one password — held because
   there was one credential. With tokens there are N, and the global 30-second
   lockout (`mosd/webd/src/auth.rs:9-10`) still gates only `POST /login`
   (`mosd/webd/src/routes.rs:500-508`). Bearer verification is **not** rate
   limited and should not be: 256 bits of `OsRng` is not guessable online, and a
   shared counter on the token path would let anyone with a bad token lock out
   every script. The comment is not wrong; it is now scoped to the password path
   and this document records that scoping.

### 3.3 Threat model, and what it does not protect against — **[proposed]**

**What the transport actually is.** rustls with the `ring` provider
(`mosd/Cargo.toml:38`, installed explicitly at `mosd/webd/src/main.rs:46-48`),
carrying a **self-signed certificate apid generates on first start**: CN `mos`,
SANs `DNS:mos`, `DNS:localhost`, `IP:127.0.0.1`
(`mosd/webd/src/tls.rs:44-81`, SAN construction at `:59-67`), private key mode
`0600` (`:78`, `:30-42`) in a state directory created mode `0700` (`:20-28`).
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
than the `HttpOnly` cookie (`mosd/webd/src/session.rs:91`) for that one
property. The built-in UI is unaffected because it is no-JavaScript by decision
(`docs/design/dashboard.md:1275-1276`).

**What it does not protect against.** Four attacks, concretely.

1. **An active on-path attacker on the LAN captures the token on first use.**
   Because the certificate is self-signed with SANs that do not match the
   address operators actually use (`mosd/webd/src/tls.rs:59-67`), every client
   is configured to skip verification — the shipped boot health probe does
   exactly that, `curl -k` with a `wget --no-check-certificate` fallback
   (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:168`, `:174`). An attacker who
   can answer for the device's address terminates TLS with their own
   certificate, and the client, told to accept anything, hands over the bearer
   token in the first request. Nothing in this design stops that. The mitigation
   that would — an operator-installed certificate, or a documented pin — does
   not exist in `mosd/webd/src/tls.rs` at `86cd669`.
2. **A stolen token is full management access, indefinitely.** There is no
   expiry (§3.2), no binding to a client address, and no binding to a request.
   A token exfiltrated from a CI secret store, a laptop backup or a shell
   history reboots the appliance, enables SSH
   (`PUT /api/v1/settings/access.ssh.enabled`), adds a root key
   (`POST /api/v1/ssh/authorized-keys` — *"Every authorized key is a root key"*,
   `mosd/webd/src/routes.rs:944`) and is then no longer needed. Detection is not
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

**Anyone with SSH is already root, so none of this applies to them.** Every
authorized key is a root key (`docs/design/access.md` §4.1, and the sentence the
pane is tested to carry, `mosd/webd/src/routes.rs:937-944`); apid runs as root
(`mosd/dist/webd.service:1-13`); the D-Bus policy allows root to own, send and
receive (`mosd/dist/com.mos.mosd.conf:68-72`). A root shell reads
`/var/lib/mos/settings.toml` directly, reads
`/var/lib/mos/webd/session.key` (`mosd/webd/src/tls.rs:85-103`), and calls
`com.mos.mosd1` without going through apid at all. **The API token's threat
model is entirely about the network channel**; it adds nothing against local
root and it is not intended to.

**CSRF, now that form posts and an API coexist.** There is no CSRF token
anywhere in the crate — `grep -ni csrf mosd/webd/src/*.rs` returns nothing at
`86cd669` (section 1.2) — and the picture after this proposal is:

- **The API path has no CSRF exposure**, because a bearer header is not something
  a browser attaches on a cross-site request. This is a property of the choice,
  not an added control.
- **The form path is covered for POST by `SameSite=Lax`**
  (`mosd/webd/src/session.rs:91`), which withholds the cookie from cross-site
  form submissions. That is a real control and it is the only one.
- **The per-action confirm tokens are not CSRF tokens and must not be counted as
  such.** `PowerAction::confirm_token` returns the constant strings `"reboot"`
  and `"poweroff"` (`mosd/webd/src/routes.rs:790-795`) and
  `TRANSIENT_CONFIRM_TOKEN` is the literal `"set-transient-password"`
  (`:948`). They are not secret, not per-session and not unpredictable; the
  source describes their purpose accurately as stopping a submit without a
  ticked checkbox (`:788-789`). They stop a mis-click and a prefetch. Against a
  cross-site attacker they add nothing, and the form path holds because
  `SameSite=Lax` holds.

**One denial-of-service note, because it is already true and the API widens it.**
The gate calls `GetSettings("access")` on **every** request before deciding
anything (`mosd/webd/src/routes.rs:131`), including unauthenticated ones. So an
unauthenticated flood already costs one D-Bus round trip per request against the
single lock mosd holds over both trees (`mosd/mosd/src/bus.rs:44-49`, `:183`).
Adding an API does not create this, but it adds routes that are attractive to
automate against. It is routed in §10.1 rather than solved here.

## 4. Static hosting — **[proposed]**

Section 1.6 measured the starting point at `86cd669`: apid serves no static
asset of any kind, from anywhere, and the only disk paths it reads at all are
`/proc/uptime` (`mosd/webd/src/routes.rs:581`) and its own state directory
(`mosd/webd/src/tls.rs:47-49`, `:86`). Everything in this section is therefore
new code rather than a configuration change to something that exists, and it is
marked **[proposed]** throughout for that reason.

### 4.1 Routing between API and assets — **[proposed]**

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
HTTPS router matches its fifteen `.route()` declarations
(`mosd/webd/src/routes.rs:45-65`) and declares **no fallback at all** — the only
`.fallback` in the file belongs to the HTTP redirect router
(`mosd/webd/src/routes.rs:74`), which is why an unmatched path today is answered
by the gate's redirect to `/login` (`mosd/webd/src/routes.rs:149`) or by axum's
default not-found (section 1.6). Adding the asset service as the *fallback*
therefore means declared routes win **structurally**: a bundle that ships a file
at `api/v1/settings` cannot capture API traffic, because the router never
consults the fallback for a path it matched. A rule enforced by the dispatch
mechanism is worth more than a rule enforced by a check somebody can forget to
write.

**Why the `/api/v1` prefix, and what the alternatives cost.**

| Option | Rejected because |
|---|---|
| **Content negotiation on the same paths** (`Accept: application/json` selects the API) | The reserved set becomes invisible in the URL: you cannot tell from a request line whether it is an API call or an asset fetch, which makes both logs and `curl` reproduction ambiguous. A `fetch()` that forgets its `Accept` header silently receives HTML. |
| **A second listener on its own port** | Two TLS configurations, two firewall rules, and the self-signed certificate would have to be accepted twice by the browser — it is generated once into the state directory with SANs `DNS:mos`, `DNS:localhost`, `IP:127.0.0.1` (`mosd/webd/src/tls.rs:44-81`). The two listeners that exist today are 443 and a redirect-only 80 (`mosd/webd/src/config.rs:34-37`, `mosd/webd/src/routes.rs:72-76`); a third is a real operational cost for no isolation gain, since both would be served by the same root process. |
| **A subdomain** (`api.mos`) | The certificate carries three SANs and no wildcard (`mosd/webd/src/tls.rs:44-81`), and the appliance provides no DNS. A new name means a new SAN, a new way for the name to fail to resolve, and a second certificate-trust prompt. |
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
`/ssh/keys/remove` and `/healthz` (`mosd/webd/src/routes.rs:45-65`). A custom
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
`mosd/webd/src/routes.rs:45` and `:578`) moves under section 6.3's reserved
prefix, where it is reachable unconditionally. `/` is therefore **conditional**
and the reserved prefix is **not** — and section 6.3 requires exactly one
unconditional path, not two, so this trade is the one that section makes.

The other legacy pane paths stay reserved until the phasing in section 8 moves
each pane onto the API and deletes its route. Until then a custom UI cannot use
those thirteen paths. That shrinkage is section 8's to schedule; the requirement
is routed in 10.2 rather than decided here.

### 4.2 SPA fallback — **[proposed]**

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
2.4 and is **not specified here**; the requirement is routed in 10.2.

**The property to test.** After this rule, a request that a developer expected
to be JSON never returns HTML with a 200. That is one integration test per
condition, and it is the test that keeps 4.2 from silently regressing.

### 4.3 MIME and caching — **[proposed]**

**How a content type is decided.** From the filename extension, through a
**fixed allowlist compiled into apid** — not through a general-purpose guesser
and never by sniffing content.

The alternative would be `mime_guess`, which is what `tower_http`'s `ServeDir`
uses: it calls `mime_guess::from_path` and falls back to
`application/octet-stream`
(`tower-http-0.6.11/src/services/fs/serve_dir/open_file.rs:78-82`, in the
registry copy of the version pinned at `mosd/Cargo.lock:2364-2366`). A fixed
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
session cookie (`webd_session`, `Path=/; HttpOnly; Secure; SameSite=Lax`,
`mosd/webd/src/session.rs:18`, `:91`). The cookie is `HttpOnly`, so script
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
dependency of the crate** (`mosd/webd/Cargo.toml:11-29`; section 1.6, evidence
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

### 4.4 Path traversal — **[proposed]**

**What a successful traversal reaches, first, because it sets the stakes.**
apid runs as **root** — `mosd/dist/webd.service` sets no `User=` line, and its
entire `[Service]` section is four directives (`mosd/dist/webd.service:6-10`):
`Type=`, `ExecStart=`, `Restart=` and `StateDirectory=`. There is no
`ProtectSystem=`, no `ReadOnlyPaths=`, no `RootDirectory=`, no `PrivateTmp=`.
The D-Bus policy records the same fact from the other side — *"no shipped unit
sets User=, mosd.service owns the name as root, webd.service and the boot health
gate both run as root"* (`mosd/dist/com.mos.mosd.conf:12-14`). A traversal is
therefore an arbitrary file read **as root, with no sandbox**, and the reachable
set includes at least:

- **`/var/lib/mos/settings.toml`** (`mosd/mosd-settings/src/store.rs:12`) — the
  whole settings tree, including the argon2id webAdmin hash
  (`mosd/webd/src/routes.rs:98-103`) and every authorized SSH key.
- **`/var/lib/mos/shadow`**, which is what `/etc/shadow` is a symlink to
  (`docs/design/ro-root.md:270-289`).
- **`/etc/ssh/`** — the sshd host private keys, bound from STATE
  (`docs/design/access.md:485`).
- **apid's own state directory**, `/var/lib/mos/webd` by default
  (`mosd/webd/src/config.rs:38-40`): the TLS private key, mode `0600`
  (`mosd/webd/src/tls.rs:30-42`, `:78`), and **`session.key`**, the 32-byte HMAC
  signing key (`mosd/webd/src/tls.rs:85-103`).

That last one is the escalation nobody should have to discover during an
incident. A session cookie is `<id>.<hmac>` where the MAC is HMAC-SHA256 of the
id under `session.key` (`mosd/webd/src/session.rs:44-55`). **Reading
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
   | **`openat2(2)` with `RESOLVE_BENEATH \| RESOLVE_NO_SYMLINKS`** | Strongest — the kernel enforces it, per-open, with no race | Needs Linux ≥ 5.6, and a raw syscall. **The workspace forbids unsafe code** (`mosd/Cargo.toml:10-11`, repeated locally at `mosd/webd/src/main.rs:21`), so this means a new dependency carrying `unsafe`, inside the root-privileged daemon, subject to the audit `mosd/hack/check.sh:9` runs |
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
`tower-http` is not a dependency of the crate today (`mosd/webd/Cargo.toml:11-29`
— section 1.6, evidence 1). The copy at `mosd/Cargo.lock:2364-2366` is version
**0.6.11**, pulled in by the **dev-dependency** `reqwest`
(`mosd/webd/Cargo.toml:32`), and it is built **without the `fs` feature**: its
dependency list in the lockfile (`mosd/Cargo.lock:2368-2379`) contains no
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
  dev-dependencies (`mosd/webd/Cargo.toml:33-34`).

## 5. Where a custom UI lives — **[proposed]**

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
(`os/rauc/system.conf.in:75-85`, `os/rauc/manifest.raucm.in:21-22`), so anything
written into a rootfs would be gone at the next update even if writing it were
possible.

### 5.2 The location, and the bind — **[proposed]**

**The path is `/srv/ui/`.**

**It needs no bind, and that is the point.** `/home` and `/root` needed mount
units because those paths sit *inside* the verity squashfs and had to be
redirected onto DATA — `home.mount` binds `/srv/home` onto `/home`
(`os/rootfs/overlay-v2/etc/systemd/system/home.mount:20-21`) and `root.mount`
binds `/srv/root` onto `/root`
(`os/rootfs/overlay-v2/etc/systemd/system/root.mount:29-30`). `/srv` is not a
redirect: it is the DATA partition's **own mountpoint**, mounted directly from
`/etc/fstab` (`os/rootfs/overlay-v2/etc/fstab.in:12`, `:23`), and the verifier
asserts that entry by GUID, mountpoint and options —
`check_fstab "DATA is the growth target" "${DATA_GUID}" /srv
"noatime,x-systemd.growfs"` (`os/verify-image-v2.sh:1425`).

So `docs/design/access.md` §10.2's mechanism — *"one mount unit plus one
verifier assertion"* (`docs/design/access.md:476-479`) — applies here at **half
strength: no mount unit is needed, and the verifier assertion that would have
accompanied it already exists**. The image ships **eight** binds
(`docs/design/access.md:481-492`); this proposal adds a ninth to **none** of
them. That is the whole reason `/srv` was chosen over inventing a new bind
target: it is the one persistent tier already reachable without a unit.

Two facts the image already guarantees and that this depends on:

- The `/srv` mountpoint exists in the read-only root
  (`os/rootfs/Dockerfile.v2:255`), and the verifier asserts every fstab and bind
  mountpoint exists (`os/verify-image-v2.sh:1277-1281`).
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

- apid runs as root today (`mosd/dist/webd.service:1-13`), so it can write
  regardless of what the mode says.
- **The mode is chosen for the daemon apid is meant to become, not the one it
  is.** `docs/design/dashboard.md` §6.6 adopts two processes with a real
  privilege boundary and its scorecard records *"`webd` can be non-root: yes"*
  for that option (`docs/design/dashboard.md:2186`, `:2198-2199`; cited, not
  edited — that file belongs to campaign
  `l1-o7ee8v0o-20260819152009-apid`). A root-owned, world-readable bundle root
  is the shape that survives that change without a migration: the serving path
  needs only read, and the install path is privileged anyway.
- **Not `0700`.** Content served to an authenticated browser is not a secret,
  and `0700` would force a group or an ownership change the day apid stops
  being root.
- **The owner is not pinned to a numeric uid**, unlike `/srv/home/mos`
  (`os/rootfs/overlay-v2/usr/lib/mos/mos-seed-home:24-30`, `:44-47`), because
  root is `0` on every image that will ever exist. If a future `apid` account
  owns this tree instead, that uid **must** be pinned by number for exactly the
  reason `mos-seed-home` documents — the directory outlives the rootfs that
  created it. That is routed in 10.2.
- **Explicitly not under `/srv/home` or `/srv/root`.** Those are the bind
  sources for operator-owned trees (`/srv/home/mos` is uid 1000, mode `0700` —
  `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-home:44-47`). A UI bundle is
  appliance state, not a user's file, and mixing the two would make "delete my
  files" and "remove the UI" the same gesture.

### 5.3 Install and removal — **[proposed]**

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
between an uncompressed tar and a pure-Rust inflate, and it is routed in 10.2
rather than settled here.

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
specified here**; the requirement is routed in 10.2.

### 5.4 Survives-what — **[proposed]**

Same framing, same columns and same honesty as `docs/design/access.md` §10.4
(`docs/design/access.md:500-508`); this table extends that vocabulary rather
than introducing a second one.

| What | Reboot | A/B update | Factory reset |
|---|---|---|---|
| **Custom UI bundles and the `current` pointer** (`/srv/ui`, DATA) | **yes** | **yes** — RAUC writes only the raw `rootfs` slot and the vfat `boot` slot (`os/rauc/system.conf.in:75-95`) and never touches DATA | **no**. Not implemented today (`docs/design/access.md:318-335`); a whole-disk reflash is the closest real operation, and it replaces DATA with the image's fresh filesystem — with §9.2's precision applying unchanged: blocks beyond the flashed extent are **unreachable, not erased** (`docs/design/access.md:454-459`) |
| **The built-in UI** (compiled into `/usr/bin/webd`, inside the verity squashfs) | **yes** | **replaced, which is the point** — the new slot carries the new image's built-in UI, and there is no state to migrate because there is no state | **yes** — a reflash writes an image that contains it. This is the one row a factory reset **restores** rather than destroys, and that asymmetry is the whole of section 6 |
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

## 6. The safety requirement: the built-in UI and the escape — **[proposed]**

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

### 6.1 What "broken" covers — **[proposed]**

Five classes. The first four are visible in the filesystem; the fifth is not,
and it is the one that decides the shape of the rest.

| # | Class | Detected by | Detected when | Response |
|---|---|---|---|---|
| 1 | **No bundle installed.** `/srv/ui/current` absent | The asset router, `stat`/`readlink` returning `ENOENT` | Every request, cost of one syscall | Serve the built-in UI. **This is not an error** — it is the shipped state of every device, and it must not be logged as one |
| 2 | **A bundle with no `index.html`**, or whose index is a directory | Install-time validation (5.3 step 2), re-checked at activation | Before the bundle is ever reachable | Rejected at install. If it somehow reaches serving — the tree was mutated outside the install path — the SPA fallback has nothing to return and serves the **built-in UI**, not a 404 and not a 500 |
| 3 | **A malformed or half-written bundle** | Digest recorded at activation, re-checked | apid start-up and activation — **not** per request | Deactivate and serve the built-in UI, logging the mismatch |
| 4 | **A bundle whose files are unreadable** (`EACCES`, `EIO`) | The asset router, at `open` | Every request | **Asymmetric — see below** |
| 5 | **A UI that renders perfectly and cannot talk to the API version it finds** | Nothing in the filesystem. See below | Activation, **and again at every apid start-up** | Refuse to activate, or deactivate, and say why |

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
  bundle whose declared range does not include the version apid serves. **This
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
re-evaluates every activated bundle against its own version and deactivates one
that no longer fits, logging why. That is the mechanism that closes the gap
section 5.4's table opens.

*One constraint on where that evaluation may happen, and it is not negotiable.*
apid's `main` propagates every startup step with `?` —
`config::Config::from_env()?` (`mosd/webd/src/main.rs:50`),
`tls::ensure_state_dir(...)` (`:51`),
`tls::load_or_generate_certificate(...)?` (`:53`),
`tls::load_or_generate_session_key(...)?` (`:54`) — all **before** the listeners
bind at `:59` and `:63`, and the unit is `Restart=on-failure`
(`mosd/dist/webd.service:9`). A startup error therefore becomes a **crash loop
with no listener bound**, which is precisely the failure this section exists to
prevent. **Bundle discovery and evaluation must happen after the listeners bind
and after `WEBD_LISTENING` is printed (`mosd/webd/src/main.rs:69`), and every
possible outcome must be a state the daemon holds, never an error it returns.**
A bundle must not be able to stop apid from listening. That is the actual safety
property, and it is stronger than any escape path.

The concrete shape of the version token, the handshake header and the error body
belongs to sections 2 and 3. This section states the **requirement** only, and
routes it in 10.2.

### 6.2 The built-in default UI, inside verity — **[proposed]**

The section is marked **[proposed]** because the *role* proposed for the
built-in UI — a fallback at a reserved path — does not exist. The artifact and
the protection described below **do** exist at `86cd669`, and each is cited.

**Where it lives in the image: it is not a directory of files.** At `86cd669`
the built-in UI is **compiled into the `webd` binary**. The pages are `maud`
`html!` macro expansions in `mosd/webd/src/routes.rs` (the macro is imported at
`:14` and used by every page handler), and the only stylesheet is a `&str`
constant emitted into each `<head>` (`mosd/webd/src/routes.rs:157-165`, `:176`),
described in the source as *"Inline stylesheet shared by every page; no external
assets"* (`mosd/webd/src/routes.rs:157`). Section 1.6 evidences the rest: no
`include_str!`/`include_bytes!`, no `assets/`, `static/` or `public/` directory,
and no non-Rust file in the crate other than its manifest.

**How it gets there.** `os/rootfs/build-v2.sh:75-76` copies the cross-built
`webd` binary and its unit into the build context; `os/rootfs/Dockerfile.v2:294`
installs the binary as `/usr/bin/webd` mode `0755`, `:295` installs the unit,
and `:297-299` enables it by symlink and **asserts the symlink exists**. The
binary is then part of the tree that `os/rootfs/build-v2.sh` packs into the
squashfs and covers with the dm-verity hash tree
(`docs/design/ro-root.md:13-27`).

**What guarantees an upload path can never write to it.** Three layers, and
naming which one is load-bearing matters more than the count:

1. **Load-bearing: dm-verity.** `/` is a squashfs assembled by the kernel from
   `dm-mod.create=` and mounted read-only, with no fstab entry that could remount
   it (`os/rootfs/overlay-v2/etc/fstab.in:7-9`, `docs/design/ro-root.md:239`). A
   write to `/usr/bin/webd` fails at the block layer, not at a permission check.
   **This holds even though apid runs as root** — the unit sets no `User=`
   (`mosd/dist/webd.service:1-13`), so root is exactly what would be writing,
   and it still cannot. Nothing an operator uploads can reach the built-in UI,
   because nothing on the running system can.
2. **Real but not load-bearing: the bundle root is on a different filesystem.**
   `/srv/ui` is on DATA (5.2), every install-path write is confined to it, and
   4.4's canonicalise-and-assert bounds the *read* path to the same resolved
   tree.
3. **Absent, and named as absent: there is no systemd sandboxing.**
   `mosd/dist/webd.service:6-10` is the entire `[Service]` section — `Type=`,
   `ExecStart=`, `Restart=`, `StateDirectory=`. No `ProtectSystem=`, no
   `ReadWritePaths=`, no `ReadOnlyPaths=`. So layer 1 is not merely the
   strongest layer, it is the **only** one protecting the binary, and off a
   verity root there is nothing at all — which is not hypothetical, because
   `WEBD_STATE_DIR` exists precisely so the daemon runs off-device
   (`mosd/webd/src/config.rs:38-40`) and that is how the crate's tests run. This
   is a real gap; it is routed in 10.2 rather than counted as covered here.

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

### 6.3 The deterministic way to reach it — **[proposed]**

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
  who knows the URL. Mitigations: the built-in error pages already exist
  (`mosd/webd/src/routes.rs:106-116`) and can name the path, and it is
  documented. The cost that must not be glossed: **(A) is a way *in*, not a way
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
  (`mosd/webd/src/main.rs:59-69`) and makes every bundle outcome a state rather
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
(`mosd/dist/mosd.service:8` → `/usr/bin/mosd`, `mosd/dist/webd.service:8` →
`/usr/bin/webd`), two binaries installed separately by the image
(`os/rootfs/Dockerfile.v2:285` and `:294`), ordered `After=network.target
mosd.service` (`mosd/dist/webd.service:3`). What this subsection adds is the
argument, not a mechanism.

**The reasoning is recorded in `docs/design/dashboard.md` §6 — cited here and
not edited; that file belongs to campaign
`l1-o7ee8v0o-20260819152009-apid`.** mosd treats first-boot provisioning as a
hard failure on purpose, and the code says why in as many words: *"Hard failure
on purpose: an unwritable STATE means no device identity and no device
credential, so there is no usable device to serve. A loud exit is better than a
daemon that quietly serves an unprovisioned tree the operator cannot log in
to."* (`mosd/mosd/src/main.rs:57-60`, with the `?` at `:67`). dashboard.md
quotes the same comment and draws the consequence that matters here: *"After a
merge there is no process left to render it: **a provisioning failure becomes a
device with no UI and no diagnostic surface at all**, reachable only by serial
console."* (`docs/design/dashboard.md:1811-1813`). Its scorecard records the
same fact as a row — *"A `mosd` startup failure still renders an error page"*:
**no** for a merge, yes for the two-process option
(`docs/design/dashboard.md:2191`) — and §6.6 concludes *"Adopt option 2 ... Do
not merge."* (`docs/design/dashboard.md:2198-2199`).

*(dashboard.md's own inline line numbers there — `main.rs:57-63`, `:53-56`,
`routes.rs:95-105` — no longer resolve at `86cd669`; the current ones are
`mosd/mosd/src/main.rs:57-60` and `:67`, and `mosd/webd/src/routes.rs:106-116`.
Section 1.7 records the same kind of drift for the research inventory. The code
is the fact.)*

**The principle, stated once: the component that explains a failure must not be
the component that failed.** dashboard.md applies it to processes — mosd may
exit hard *because* apid is a different process and survives to render the 502
page *"The management daemon is unavailable."* (`mosd/webd/src/routes.rs:106-116`,
reachable because the bus client connects lazily and drops its cache on error,
`mosd/webd/src/bus_client.rs:23-26`, `:42-59`).

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

> **Stub — written by RFCT-066.** Do not fill this in from another task.

## 8. Migration and phasing — **[proposed]**

> **Stub — written by RFCT-066.** Do not fill this in from another task.

## 9. What API-first forecloses — **[proposed]**

> **Stub — written by RFCT-066.** Do not fill this in from another task.

## 10. Routed follow-ups

Work this document identifies but does not own. A follow-up is recorded here
rather than by editing another file: `docs/design/dashboard.md`,
`docs/design/access.md`, `docs/design/mosd.md` and the crate itself are owned by
parallel campaigns for the duration, and are cited above rather than changed.

### 10.1 From the API surface

Everything §2 and §3 found that belongs to a file this campaign may not edit, or
to a later phase. All twelve were measured at `86cd669`.

1. **`mosd/mosd/src/bus.rs` — uptime has no home in either tree.** `GET /`
   reads `/proc/uptime` inside apid (`mosd/webd/src/routes.rs:581`), which the
   crate's own rule says system facts should not be
   (`mosd/webd/src/settings_api.rs:10-12`). mosd should publish uptime into the
   live-state tree so §2.2's `/api/v1/state/` root can serve it; until it does,
   the API has no uptime and the HTML status pane has a field the API cannot
   reproduce.
2. **`mosd/mosd/src/bus.rs:156-166` — `to_fdo` collapses three distinct
   failures into one.** `NotFound`, `ReadOnly` and `Validation`
   (`mosd/mosd-settings/src/error.rs:7-31`) all become
   `fdo::Error::InvalidArgs`, so no caller can distinguish "that path does not
   exist" from "that value is invalid" from "that path is read-only" without
   parsing message text. §2.4 emits one code, `settings_rejected`, for all
   three as a result. Splitting them needs a mosd change; the API is the
   consumer that makes it worth doing.
3. **`mosd/webd/src/bus_client.rs:68-71` (and `:80`, `:91`, `:103`, `:114`,
   `:128`) — the fdo error name is discarded.** Every `zbus::Error` becomes an
   `anyhow::Error` before any handler sees it, and `zbus` 5.19.0
   (`mosd/Cargo.lock:2907-2908`) carries the distinction in
   `Error::MethodError(OwnedErrorName, ...)`. §2.4's whole error table depends
   on recovering it. This is a crate change and belongs to §8's phasing.
4. **Redaction has no test and the design is fail-open.** §2.2 requires a
   structural redactor keyed on field *name*, because the two `psk` fields sit
   inside arrays the dot-path cannot address
   (`mosd/mosd-settings/src/model.rs:213-214`, `:235-236`, `:260-261`). A
   secret-bearing field added later under a name not on the list is exposed by
   default. The mitigation is a test that walks `Settings::default()` — plus a
   fixture with every optional field populated — and asserts no known-secret
   field survives serialisation. Belongs with whoever implements §2.2.
5. **`GET /healthz` answers `ok` while mosd is dead.** It returns before any
   check (`mosd/webd/src/routes.rs:128-130`, `:153-155`), and the boot health
   gate depends on exactly that (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:164-177`).
   §2.3 keeps it unchanged and §2.4 adds `GET /api/v1/health` beside it. What is
   routed onward is the documentation debt: anything that treats `/healthz` as
   "the appliance is healthy" — `docs/plan/PLAN-005.md:149`,
   `docs/design/boards.md:91` — is relying on a narrower guarantee than it reads
   as. Those files belong to other owners; they are cited, not edited.
6. **`mosd/webd/src/routes.rs:131` — every request costs a D-Bus round trip.**
   The gate calls `GetSettings("access")` before deciding anything, including
   for unauthenticated requests, against the single lock mosd holds over both
   trees (`mosd/mosd/src/bus.rs:44-49`). §3.2 exploits this (the token set
   arrives free) and §3.3 names it as a DoS surface. Whoever owns apid's
   performance should decide whether the gate caches with an invalidation on
   `SettingsChanged` — which requires item 10.
7. **`docs/design/access.md` §10.4 gains a row if §3.2 lands.** The
   survives-what table (`docs/design/access.md:500-508`) enumerates credentials
   by tier; `access.apiTokens` would be a settings-tree row with the same
   answers as `access.ssh.authorizedKeys`. That file is owned by a parallel
   campaign and is cited here rather than changed.
8. **`docs/design/dashboard.md` §5.8 — is the 15-second floor a UI decision or
   an apid decision?** It adopts full-page refresh at a 15-second default as
   *"the dashboard's only live-value mechanism"*
   (`docs/design/dashboard.md:1275-1276`) and names what that forecloses at
   `:1304-1315`. A token-authenticated client polling `GET /api/v1/state/...` is
   not a dashboard and is not obviously bound by it. Whoever owns that document
   should say which it is; §2 assumed the former and did not re-open it.
9. **No wall clock, so no token expiry (§3.2).** apid reads `Instant` only
   (`mosd/webd/src/session.rs:10`, `:53`, `:72`), which cannot express a
   deadline surviving a reboot. `expiresAt` on an API token is deferred to
   whichever phase establishes a trusted wall clock, and until then revocation
   is the entire lifecycle.
10. **`SettingsChanged` exists and apid does not subscribe.** mosd emits it
    after every successful `SetSettings` (`mosd/mosd/src/bus.rs:212-214`,
    declared at `:292-297`); the proxy declares no `#[zbus(signal)]` member
    (`mosd/webd/src/bus_client.rs:14-21`). An API that wanted to offer a change
    stream — or a gate that wanted to cache (item 6) — cannot today. This is a
    later phase, and it touches the same ground
    `docs/design/dashboard.md` §5.8 settled for the UI.
11. **No change-password operation exists anywhere.**
    `access.webAdmin.password_hash` is written by exactly one handler,
    `setup_submit` (`mosd/webd/src/routes.rs:441-444`), and no route changes it
    afterwards. §2.3 declined to invent one over the API because it would be the
    first operation the API offers that the UI does not, and because it needs a
    decision this document only half-makes (§3.2: a password change does not
    revoke tokens). It belongs to whoever owns the built-in UI's account pane.
12. **The dot-path cannot address a VLAN interface.** `valid_iface_name` permits
    `.` (`mosd/webd/src/routes.rs:231-236`) while `split_path` splits on it
    unconditionally (`mosd/mosd-settings/src/path.rs:26-32`), so
    `network.eth0.100` is rejected by `deny_unknown_fields`
    (`mosd/mosd-settings/src/model.rs:308-315`). This is a pre-existing limit of
    the settings model, not one the API introduces; it belongs to whoever owns
    the settings path syntax, and §2.2 records that the API inherits it.

### 10.2 From static hosting and the custom-UI lifecycle

Each item names the file or the section that owns it, and one sentence saying
what it owes. Nothing here is edited by this document.

**To documents this campaign may not touch**

- `docs/design/access.md` §10.2 and §10.4 — §5.2 adds a DATA-resident appliance
  path (`/srv/ui`) that needs **no ninth bind**, and §5.4 adds three rows in
  §10.4's vocabulary; both belong in access.md once its campaign fence lifts.
- `docs/design/dashboard.md` §6 — §6.4 rests entirely on its two-process
  recommendation (`:2198-2199`), so if that decision is ever reopened, §6 here
  must be re-derived rather than assumed; the file belongs to campaign
  `l1-o7ee8v0o-20260819152009-apid`.
- `docs/design/dashboard.md` §6 line citations — its `main.rs:57-63`,
  `:53-56` and `routes.rs:95-105` no longer resolve at `86cd669` (§6.4 records
  the current numbers); a re-measure belongs to whoever next edits that file.
- `docs/design/ro-root.md` §4 — the storage-tier table lists what lives on each
  partition; `/srv/ui` is a new DATA resident and belongs in it.

**To the API sections this task does not own (RFCT-064, §2 and §3)**

- §2.4 — the **404 body for the `/api/` subtree fallback** that §4.1 rule 1
  requires: a mistyped API path must return the API error envelope, not an
  empty body and never HTML.
- §2.1 — the **API version token** §6.1 class 5 needs, for both the manifest
  range check at activation and the mandatory re-check at apid start-up.
- §2.3 — the **version handshake a client sends**, which §6.1 names as the
  detector that makes a class-5 failure legible rather than confusing.
- §2.2/§2.3 — the **"what is installed right now?" read** §5.3 specifies the
  semantics of but not the shape: it must answer from the served tree and must
  have a named answer for "no bundle active".
- §2.3/§3 — the **bundle upload operation** itself: §5.3 specifies the on-disk
  mechanism and says nothing about the request that drives it.

**To sections 7-9 (RFCT-066)**

- §7 — **who may install a bundle.** §5.3 describes the mechanism and takes no
  position on authorisation; today the only credential in the crate is the
  single webAdmin password (§1.4).
- §8 — the **phasing that releases `/` and the thirteen legacy pane paths** from
  §4.1's reserved set, and that moves the built-in panes under §6.3's reserved
  prefix. §4.1 depends on this happening; it does not schedule it.
- §9 — **what this forecloses**: the `/api` prefix is burned permanently (§4.1),
  and the MIME allowlist lives inside the verity image so a customer cannot
  extend it on device (§4.3).

**To the crate and the image** — product code, none of which this campaign
changes

- `mosd/webd/Cargo.toml` (`mosd/apid/Cargo.toml` after the rename) — the
  **static-file dependency decision**: adopt `tower-http` with the `fs` feature,
  or hand-roll. §4.4 requires that whichever is chosen, the version is pinned
  exactly and the traversal behaviour is asserted by a test **in this
  repository**, because `build_and_validate_path` is private and carries no
  stability promise.
- `mosd/webd/Cargo.toml` — the **archive-format dependency** for §5.3's upload
  transport. `mosd/deny.toml` bans no C-building crate and `mosd/hack/check.sh:9`
  checks only licenses, bans and advisories, so the pure-Rust posture here is
  convention (`mosd/Cargo.toml:33-35` is its only written trace) and the choice
  needs a deliberate decision rather than a default.
- `mosd/dist/webd.service` — **no sandboxing directives exist** (`:6-10` is the
  whole `[Service]` section). §6.2 layer 3: the built-in UI's protection rests
  entirely on dm-verity, with nothing behind it off a verity root. Adding
  `ProtectSystem=` and an explicit `ReadWritePaths=` would give it a second
  layer, and would also bound §4.4's traversal blast radius.
- `mosd/mosd-settings/src/model.rs` — **only if** §6.3's deactivate is
  implemented as a settings flag rather than as the removal of the `current`
  pointer. `docs/design/access.md:468-474` applies either way: *"An unmodelled
  setting is an unsupported setting."*
- `os/rootfs/overlay-v2/usr/lib/mos/` — **no seed unit is proposed** for
  `/srv/ui` (§5.2 explains why). If one is ever added, its owner uid must be
  pinned by number for the reason `mos-seed-home:24-30` documents.
- `os/verify-image-v2.sh` — no new assertion is proposed: `/srv` as a mountpoint
  (`:1277-1281`) and the DATA fstab entry (`:1425`) are already asserted, and
  those are what §5.2 depends on. An assertion becomes owed only if the image
  ever ships something under `/srv/ui`.

### 10.3 From trust and phasing

> **Stub — written by RFCT-066.** Do not fill this in from another task.
