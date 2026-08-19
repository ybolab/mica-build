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

> **Stub — written by RFCT-064.** Do not fill this in from another task.

### 2.1 Versioning and path shape

> **Stub — written by RFCT-064.** Do not fill this in from another task.

### 2.2 Resource model

> **Stub — written by RFCT-064.** Do not fill this in from another task.

### 2.3 Operation inventory: today's form posts, tomorrow's API

> **Stub — written by RFCT-064.** Do not fill this in from another task.

### 2.4 Error shape

> **Stub — written by RFCT-064.** Do not fill this in from another task.

## 3. Authentication for a programmatic client — **[proposed]**

> **Stub — written by RFCT-064.** Do not fill this in from another task.

### 3.1 Browser session versus programmatic client

> **Stub — written by RFCT-064.** Do not fill this in from another task.

### 3.2 The proposal

> **Stub — written by RFCT-064.** Do not fill this in from another task.

### 3.3 Threat model, and what it does not protect against

> **Stub — written by RFCT-064.** Do not fill this in from another task.

## 4. Static hosting — **[proposed]**

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 4.1 Routing between API and assets

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 4.2 SPA fallback

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 4.3 MIME and caching

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 4.4 Path traversal

> **Stub — written by RFCT-065.** Do not fill this in from another task.

## 5. Where a custom UI lives — **[proposed]**

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 5.1 Why it cannot live in the rootfs

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 5.2 The location, and the bind

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 5.3 Install and removal

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 5.4 Survives-what

> **Stub — written by RFCT-065.** Do not fill this in from another task.

## 6. The safety requirement: the built-in UI and the escape — **[proposed]**

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 6.1 What "broken" covers

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 6.2 The built-in default UI, inside verity

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 6.3 The deterministic way to reach it

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 6.4 Why this is the same reasoning that split mosd and apid

> **Stub — written by RFCT-065.** Do not fill this in from another task.

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

> **Stub — written by RFCT-064.** Do not fill this in from another task.

### 10.2 From static hosting and the custom-UI lifecycle

> **Stub — written by RFCT-065.** Do not fill this in from another task.

### 10.3 From trust and phasing

> **Stub — written by RFCT-066.** Do not fill this in from another task.
