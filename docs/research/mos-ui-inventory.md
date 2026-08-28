# Research: the mos web/UI current state, measured from the tree

> English only. Inventory, not proposal — see "Scope" below.

## 0. Status of this document — a snapshot at `d0bcae9`, not maintained

**Measured at** `d0bcae92656257021bb67bf7db72b8ac5bfb4651`, branch
`bkd/2o0djkty`, worktree clean at the time (§1, "Method"). That commit is the
whole of what this document describes, and the only commit it describes.

**This is a measurement at a time, not a living document.** It is a snapshot and
it is **not maintained**: it will not be re-measured as the tree moves. That is
a decision, not neglect — re-measuring on every merge is unbounded work with no
completion condition, since the tree moves again the following week and the same
drifts reappear. Read every present-tense sentence below as present tense *at
`d0bcae9`*.

**Where the current surface lives.** `docs/design/api.md` §1 inventories the same
surface measured at `86cd669` ("Merge webd SSH management: default-off SSH,
transient password, persistent keys, /home and /root on DATA"), and carries
**[implemented]** / **[proposed]** / **[not implemented]** status markers in its
headings, defined at `docs/design/api.md:18-20` on the convention set out in
`docs/design/access.md:23-29`. A reader who needs the routes, the bus surface or
the settings model *as they now are* goes there, not here.

**An anchor is not a retraction.** The measurement was correct when it was taken
and its findings remain valid as history. Its value was never only the inventory:
§9 recorded six doc-versus-code contradictions, they were routed onward, and the
design documents now carry dated corrections that trace back to them —
`docs/design/mosd.md:41-46` for §9 row 5 (webd is not a WebSocket bridge),
`docs/design/mosd.md:58-62` for row 6 (the settings path),
`docs/design/mosd.md:183-195` for row 1 (the `SshdReconciler` subtree), and
`docs/design/provisioning.md:141` for rows 2 and 3 (the device password
authenticates nothing). A reader who needs to know *why* those documents changed
comes here. Those citations are the current text of those documents, not a
re-verification of the code beneath them —
`docs/design/api.md` §1.7 closes by recording that the §9 table was not
re-verified at `86cd669` (`docs/design/api.md:642-643`). §10's list of what this
measurement never verified is likewise still true of this measurement.

**How it has gone stale — six drifts.** These are carried across from
`docs/design/api.md` §1.7 (`docs/design/api.md:492-514` on the branch this header
was written on), where each is stated with the fact at `86cd669` beside it. They
are named individually because a header that says "may be stale" is worth much
less than one that says exactly how. **None of them is corrected in the body
below**, deliberately: the body stays as measured.

1. **Line numbers throughout §2.1 no longer resolve.** It cites `GET /` at route
   `:42` and handler `:566`; at `86cd669` those are `mosd/webd/src/routes.rs:45`
   and `:578`.
2. **Its route table is missing five routes.** `GET /ssh`, `POST /ssh/enable`,
   `POST /ssh/password`, `POST /ssh/keys/add` and `POST /ssh/keys/remove` all
   exist at `mosd/webd/src/routes.rs:57-64`.
3. **"Six methods and one signal" (§4) is now seven methods.**
   `SetTransientRootPassword` exists at `mosd/mosd/src/bus.rs:283` and the daemon
   calls it (`mosd/webd/src/bus_client.rs:20`, `mosd/webd/src/routes.rs:1272`).
4. **"the sole call site is `GetState("network")`" (§4) is now two call sites.**
   `GetState("sshd")` is at `mosd/webd/src/routes.rs:1045`.
5. **Schema version "3" (§5.1) is now 4.** `mosd/mosd-settings/src/model.rs:11`.
6. **§3.6 quotes a D-Bus policy that permits any local process.** The shipped
   policy at `86cd669` denies the default context in both directions and allows
   root only (`mosd/dist/com.mos.mosd.conf:63-72`).

§1.7 records one further item outside those six: the navigation-bar count in §2.2
— *"exactly four links plus a logout button"* — is off by one, because `shell()`
now renders five plus the logout form (`mosd/webd/src/routes.rs:180-189`).

**§8's re-measure request is answered in §8 itself**, by this anchor rather than
by a re-measure. §8 asks for nothing beyond a re-measure, so nothing in it is
left dangling.

**On the daemon's name.** The daemon this document calls `webd` is **apid** going
forward; the rename is campaign `l1-o7ee8v0o-20260819152009-apid`. The `webd`
occurrences in the body are left exactly as measured — the name at `d0bcae9` is
part of what was measured, and rewriting it would falsify the snapshot. The same
holds for the `mosd/webd/…` paths cited in this header: they are the paths on the
branch it was written on. The check that settles it is `test -d mosd/apid` — if
that succeeds, the rename has landed and every `mosd/webd/…` path in this
document reads `mosd/apid/…`; if it fails, the rename has not landed and those
paths open as written.

---

## Scope

This document records **what mos ships today** in its management UI and the
mechanisms behind it. It proposes nothing: no dashboard, no routes, no
technology. A sibling task owns the proposal and cites this file. The one
exception is Appendix A, three sentences of opinion, clearly fenced.

---

## 1. Method

**Commit measured:** `d0bcae92656257021bb67bf7db72b8ac5bfb4651`
(branch `bkd/2o0djkty`, worktree clean at the time of measurement).

**Rule applied on disagreement:** *the code wins.* Where a design document under
`docs/design/` states something the code does not do, the code's behaviour is
recorded as the fact and the disagreement is listed in section 9 with both
citations. No design document was edited (out of scope for this task).

**Every line number in this document was read out of the tree at that commit**,
not recalled. Claims are tagged where the distinction matters:

- **[code]** — read directly out of a source file at the cited line.
- **[doc]** — stated by a repository document; the document is cited, and where
  the code disagrees section 9 says so.
- **[inference]** — my reasoning from the two above. Marked inline.

**What was NOT done:** nothing was built, run, flashed or booted. No `cargo`,
no image build, no hardware. Every statement about runtime behaviour is a
reading of source, not an observation. Section 10 lists what that leaves
unverified.

---

## 2. webd today: route and pane inventory

The router is built in one function: `mosd/webd/src/routes.rs:40-57`. There are
**ten routes on the HTTPS listener** plus a catch-all redirect router on the
HTTP listener (`mosd/webd/src/routes.rs:61-65`). That is the entire HTTP
surface — there is no other `Router`, no nested router and no fallback on the
HTTPS side.

Authentication is a single middleware layer, `gate`, applied to the whole HTTPS
router at `mosd/webd/src/routes.rs:55`; the gate itself is
`mosd/webd/src/routes.rs:115-140`. Its rules, read out of that function:

- `/healthz` returns before any check (`routes.rs:117-119`).
- If `access.webAdmin.password_hash` is absent, the appliance is in **setup
  mode**: only `/setup` passes, everything else 302s to `/setup`
  (`routes.rs:124-129`).
- Otherwise `/login` and `/setup` pass unauthenticated (`routes.rs:130-132`);
  everything else requires a valid signed session cookie or 302s to `/login`
  (`routes.rs:133-139`).

Note the gate calls `GetSettings("access")` on **every single request**,
including static-looking ones (`routes.rs:120`). A 502 page is rendered when
that call fails (`routes.rs:95-105`).

### 2.1 Route table

| Method + path | Handler (`routes.rs:LINE`) | What the pane renders | mosd bus call(s) | Settings / state dot-paths | Auth |
|---|---|---|---|---|---|
| `GET /` | `home` — route `:42`, fn `:566` | "Status" pane: hostname, uptime, and a `<pre>` dump of the pretty-printed live-state `network` subtree, one `<li>` per interface | `GetSettings("hostname")` (`:567`), `GetState("network")` (`:568`) | reads settings `hostname`; reads **state** `network` | yes (gate) |
| `GET /setup` | `setup_form` — route `:43`, fn `:327` | First-run wizard: admin password + confirm, optional hostname, optional single interface (name, DHCP checkbox, CIDR, gateway, DNS). Redirects to `/login` if already configured (`:332-334`) | `GetSettings("access")` (`:328`), `GetSettings("hostname")` (`:335`) | reads `access`, `hostname` | no — gate lets `/setup` through in both modes (`:125-131`) |
| `POST /setup` | `setup_submit` — route `:43`, fn `:369` | 409 if already configured (`:374-383`); 400 on short/mismatched password (`:384-400`); 422 on bad hostname or interface (`:403-421`); on success writes and issues a session cookie, 302 to `/` | `GetSettings("access")` (`:370`), `SetSettings("access.webAdmin", …)` (`:430`), `GetSettings("hostname")` (`:434`), `SetSettings("hostname", …)` (`:441`), `SetSettings("network.<iface>", …)` (`:451`) | writes `access.webAdmin`, `hostname`, `network.<iface>` | no (same as above); protected instead by the 409 already-configured check |
| `GET /login` | `login_form` — route `:44`, fn `:474` | Single password field | none | none | no |
| `POST /login` | `login_submit` — route `:44`, fn `:487` | 429 when the global login guard is locked (`:488-497`); 302 to `/setup` when no hash exists (`:502-504`); on success sets the session cookie and 302s to `/` (`:505-512`); 401 "Wrong password." otherwise (`:513-520`) | `GetSettings("access")` (`:498`) | reads `access.webAdmin.password_hash` via `password_hash()` (`:87-92`) | no |
| `POST /logout` | `logout` — route `:45`, fn `:523` | Drops the server-side session, clears the cookie, 302 to `/login` | none | none | yes (gate) |
| `GET /network` | `network_form` — route `:46`, fn `:686` | One `<form>` per configured interface (DHCP checkbox, CIDR, gateway, comma-joined DNS) plus an "Add interface" form. `?saved=1` renders a green banner (`:689`) | `GetSettings("network")` (`:687`) | reads settings `network` | yes |
| `POST /network` | `network_submit` — route `:46`, fn `:696` | 422 with the pane re-rendered and an error box on invalid iface name or CIDR (`:700-710`); on success 302 to `/network?saved=1` | `GetSettings("network")` on the error path (`:701`), `SetSettings("network.<iface>", …)` (`:714`) | writes `network.<iface>` | yes |
| `GET /hostname` | `hostname_form` — route `:47`, fn `:745` | One text input pre-filled with the current hostname; `?saved=1` banner | `GetSettings("hostname")` (`:746`) | reads `hostname` | yes |
| `POST /hostname` | `hostname_submit` — route `:47`, fn `:896` | 422 + error box on an invalid name (`:901-907`); 302 to `/hostname?saved=1` on success | `SetSettings("hostname", …)` (`:910`) | writes `hostname` | yes |
| `GET /power` | `power_form` — route `:48`, fn `:841` | Two confirmation forms (Reboot, Power off), each with a `required` checkbox carrying an action-specific token, plus a sentence noting rebooting is what activates a newly installed slot (`:834`) | none | none | yes |
| `POST /power/reboot` | `power_reboot` — route `:52`, fn `:884` → `power_submit` `:857` | 422 when the confirm token does not match (`:858-866`); otherwise **202 Accepted** with an acknowledgement page, and the D-Bus call is spawned on a detached task so the response goes out before the machine goes down (`:867-881`) | `Reboot()` (`:870`, via `SettingsApi::reboot`) | none | yes |
| `POST /power/poweroff` | `power_poweroff` — route `:53`, fn `:888` → `power_submit` `:857` | Same shape, "Power off" labels | `PowerOff()` (`:871`) | none | yes |
| `GET /healthz` | `healthz` — route `:54`, fn `:142` | The literal string `ok`, `text/plain` | none | none | **no** — explicitly exempted at `routes.rs:117-119` |
| `ANY *` on the **HTTP** listener | `redirect_to_https` — router `:61`, fn `:67` | 308 Permanent Redirect to the HTTPS origin, host taken from the `Host` header with any port stripped (`:73-83`) | none | none | n/a |

Two deliberate absences worth recording, both commented in the source:

- **There is no `GET` handler for either power action** (`routes.rs:49-51`): a
  browser prefetch, a crawler or a mis-clicked link cannot power the appliance
  off. A test pins this (`mosd/webd/src/tests.rs:563`).
- **There is no `POST /setup` bypass once configured**: the 409 at
  `routes.rs:374-383` is the guard, not the gate.

### 2.2 The navigation bar — the operator's whole menu

Rendered by `shell()` at `mosd/webd/src/routes.rs:168-178`. It contains exactly
four links plus a logout button:

`Status` (`/`) · `Network` (`/network`) · `Hostname` (`/hostname`) ·
`Power` (`/power`) · [Logout]

`page()` (`:188`) renders the same shell **without** the nav — used for setup,
login and every error page (`:187-190`).

---

## 3. webd technology posture, as it actually is

### 3.1 HTML rendering

**Server-rendered, compile-time-typed HTML via `maud`.** Imported at
`mosd/webd/src/routes.rs:13`; the dependency is declared at
`mosd/webd/Cargo.toml:18` and pinned at workspace level to `maud = "0.27"`
(`mosd/Cargo.toml:43`). Every page is built from an `html! { … }` macro and
converted with `.into_string()` (`routes.rs:184`).

There is **one shared page shell** (`shell`, `routes.rs:157-185`) and two thin
wrappers over it: `page` (no nav, `:188`) and `pane` (with nav, `:193`).

### 3.2 JavaScript — counted

**Zero.** Measured at the head of this branch:

| Probe | Command | Result |
|---|---|---|
| `<script` tags anywhere under `mosd/` | `grep -rn "<script" mosd/` | **0 matches** |
| `.js` files anywhere in the repo | `find . -name "*.js" -not -path "./.git/*"` | **0 files** |
| Static-file route / asset server | `grep -rn "ServeDir\|ServeFile" mosd/webd/` | **0 matches** |
| Inline event handlers / client fetch | `grep -rn "onclick\|onsubmit\|fetch(\|XMLHttpRequest\|addEventListener" mosd/webd/src/` | **0 matches** |

`tower-http` is not a dependency (`mosd/webd/Cargo.toml:11-28` — the full
dependency list is anyhow, argon2, async-trait, axum, axum-server, hmac, maud,
rand, rcgen, rustls, serde, serde_json, sha2, tokio, tracing, tracing-subscriber,
zbus). There is no `include_str!`/`include_bytes!` of an asset anywhere in the
crate.

**The one stylesheet is a 7-line inline `const STYLE`** at
`mosd/webd/src/routes.rs:147-154`, emitted into a `<style>` element at
`routes.rs:165`. Its doc comment says so explicitly: *"Inline stylesheet shared
by every page; no external assets."*

Consequence, stated as fact rather than complaint: **every state change in the
UI today is a full form POST followed by a 302 and a full page re-render.**
There is no polling, no live update and no client-side state. The `?saved=1`
query marker (`routes.rs:206-209`) exists precisely because a redirect is the
only way the app has to say "that worked".

### 3.3 TLS

- Stack: **rustls with the `ring` provider**, installed explicitly at startup
  (`mosd/webd/src/main.rs:46-48`). Workspace pin:
  `rustls = { version = "0.23", default-features = false, features = ["ring", "std", "tls12"] }`
  (`mosd/Cargo.toml:38`). `axum-server` uses the
  `tls-rustls-no-provider` feature (`mosd/Cargo.toml:37`), which is why the
  provider install in `main.rs` is mandatory rather than decorative.
- Certificate: **self-signed, generated on first start and reused afterwards**
  (`mosd/webd/src/tls.rs:47-81`). CN `mos`, SANs `DNS:mos`, `DNS:localhost`,
  `IP:127.0.0.1` (`tls.rs:59-67`). Generated with `rcgen`
  (`mosd/Cargo.toml:39`). `cert.pem` is written world-readable; `key.pem` goes
  through `write_secret` at mode 0600 (`tls.rs:31-42`, `tls.rs:78`).
- There is **no ACME, no CA, no certificate rotation and no way to install an
  operator-supplied certificate.** Nothing in the crate reads a certificate path
  from configuration; the only inputs are `WEBD_STATE_DIR` and what is already
  in it (`tls.rs:48-57`).

### 3.4 Session and auth mechanism

- Admin password hashing: **argon2id**, PHC string format
  (`mosd/webd/src/auth.rs:13-19`), verified at `auth.rs:22-26`. The hash lives
  in the settings tree at `access.webAdmin.password_hash`
  (written `routes.rs:429-430`, read `routes.rs:87-92`).
- Brute-force backoff: a **single global counter**, not per-client — 5
  consecutive failures arm a 30-second lockout on *every* login attempt
  (`auth.rs:9-10`, `auth.rs:38-64`). The doc comment at `auth.rs:28-31` states
  the reasoning: one appliance, one admin password, so per-client tracking buys
  nothing against an online guesser.
- Sessions: **in-process `HashMap<String, Instant>` guarded by a `Mutex`**
  (`mosd/webd/src/session.rs:24-27`). The cookie value is
  `<128-bit-random-hex>.<hex HMAC-SHA256 of the id>` (`session.rs:45-55`);
  verification checks the MAC *and* that the id names a live, unexpired session
  (`session.rs:66-79`).
- **Sessions do not survive a webd restart** — stated in the module doc at
  `session.rs:1-6` and structurally true, since the map is created fresh in
  `SessionStore::new` (`session.rs:31-36`), which is called from
  `AppState::new` (`routes.rs:30-36`) once per process.
- TTL 24 hours (`session.rs:19`), matching the cookie `Max-Age=86400`
  (`session.rs:91`).
- Cookie flags: `webd_session=<v>; Path=/; HttpOnly; Secure; SameSite=Lax;
  Max-Age=86400` (`session.rs:18`, `session.rs:91`).
- The HMAC signing key is 32 bytes from `OsRng`, persisted at
  `<state_dir>/session.key` mode 0600 and reloaded on restart
  (`mosd/webd/src/tls.rs:85-103`). So the *key* survives a restart even though
  the session *table* does not.
- **There is no CSRF token anywhere in the crate.** The only cross-site
  mitigation is the `SameSite=Lax` cookie attribute (`session.rs:91`) plus the
  fact that the destructive routes are POST-only with a required confirmation
  field (`routes.rs:52-53`, `routes.rs:820`).

### 3.5 Listen addresses, configuration, and process posture

Configuration is entirely environment-driven (`mosd/webd/src/config.rs:33-52`),
documented in the crate doc at `mosd/webd/src/main.rs:7-19`:

| Variable | Default | Cite |
|---|---|---|
| `WEBD_HTTPS_ADDR` | `0.0.0.0:443` | `config.rs:34-35` |
| `WEBD_HTTP_ADDR` | `0.0.0.0:80` | `config.rs:36-37` |
| `WEBD_STATE_DIR` | `/var/lib/mos/webd` | `config.rs:38-40` |
| `WEBD_BUS` | `system` (`session` accepted; anything else is a hard error) | `config.rs:41-45` |

So on a shipped appliance webd listens on **all interfaces**, port 443 for
HTTPS and port 80 for the 308 redirect. Both listeners are bound before the
single machine-readable startup line `WEBD_LISTENING https=<addr> http=<addr>`
is printed to stdout (`main.rs:59-69`); everything else goes to stderr
(`main.rs:43-45`).

**The unit file** is `mosd/dist/webd.service` (13 lines, quoted in full below
because its shortness is the finding):

```ini
[Unit]
Description=mos web UI daemon
After=network.target mosd.service
Wants=mosd.service

[Service]
Type=simple
ExecStart=/usr/bin/webd
Restart=on-failure
StateDirectory=mos/webd

[Install]
WantedBy=multi-user.target
```

Read out of that file:

- `StateDirectory=mos/webd` (`mosd/dist/webd.service:10`) → systemd creates
  `/var/lib/mos/webd`, which is exactly `WEBD_STATE_DIR`'s default.
- **No `User=`, so webd runs as root.** [inference from the absence of the
  directive; there is no `User=`/`DynamicUser=` line in the file.]
- **No hardening directives at all** — no `ProtectSystem`, `ProtectHome`,
  `PrivateTmp`, `NoNewPrivileges`, `CapabilityBoundingSet`,
  `RestrictAddressFamilies`, `SystemCallFilter`. The file has 13 lines and they
  are all shown above.
- **No `Environment=` lines**, so every default in the table above is what runs.
- Ordering: `After=network.target mosd.service`, `Wants=mosd.service`
  (`webd.service:3-4`). `Wants` not `Requires`, so webd starts even if mosd
  fails — which is coherent with `bus_client`'s lazy-connect design
  (`mosd/webd/src/bus_client.rs:22-25`: mosd being down surfaces as per-request
  502 pages, never as a webd crash).

`/var/lib/mos` is a **bind mount from the STATE partition**, established by
`os/rootfs/overlay-v2/etc/systemd/system/var-lib-mos.mount:12-16`, ordered
`Before=mosd.service webd.service` (`var-lib-mos.mount:10`). So the webd
certificate, private key and session signing key are on STATE and survive an
A/B update; they are lost only on a factory reset
(`docs/design/ro-root.md:365`). [doc for the tier semantics, code for the mount.]

Installation into the image: `os/rootfs/scripts/mosd-install.sh` installs
`/usr/bin/webd`, `/usr/lib/systemd/system/webd.service`, and the
`multi-user.target.wants` enablement symlink; the v2 verifier asserts all three
plus the `After=` and `StateDirectory=` lines
(`os/verify-image-v2.sh:922-929`).

### 3.6 The D-Bus policy webd talks through

`mosd/dist/com.mos.mosd.conf:4-11`:

```xml
<!-- Dev skeleton posture: root owns the name, everyone may talk to it. -->
<policy user="root">    <allow own="com.mos.mosd"/> </policy>
<policy context="default">
  <allow send_destination="com.mos.mosd"/>
  <allow receive_sender="com.mos.mosd"/>
</policy>
```

**Any local process may call any method on `com.mos.mosd`, including `Reboot`
and `PowerOff`.** The comment in the file calls this a dev skeleton posture. It
is the shipped policy — `os/rootfs/build-v2.sh` copies this exact file into the
image staging directory. (Measured against `os/rootfs/build.sh:38`, the v1
stager RFCT-107 deleted; the v2 stager does the same thing.)

---

## 4. mosd bus surface available to a UI

Interface `com.mos.mosd1` (`mosd/mosd/src/bus.rs:157`), bus name
`com.mos.mosd` (`bus.rs:17`), object path `/com/mos/mosd` (`bus.rs:19`).
**Six methods and one signal. That is the entire surface.**

| Member | Kind | Signature | Returns | `bus.rs:LINE` | webd calls it? |
|---|---|---|---|---|---|
| `GetSettings` | method | `(s path) → s` | JSON-encoded settings value at the dot-path; `""` or `"."` is the whole tree. `InvalidArgs` when the path does not resolve | `:160-164` | **yes** — `bus_client.rs:63-72`, used by `/`, `/setup`, `/login`, `/network`, `/hostname` and the gate |
| `SetSettings` | method | `(s path, s value_json) → ()` | nothing. Parses the JSON, validates against the typed tree, **persists atomically**, re-applies every reconciler whose subtree overlaps the path, then emits `SettingsChanged` | `:169-194` | **yes** — `bus_client.rs:74-83`, used by `/setup`, `/network`, `/hostname` |
| `GetState` | method | `(s path) → s` | JSON-encoded **live-state** subtree; `InvalidArgs` when the path is absent | `:197-202` | **yes, but only for one path** — `bus_client.rs:85-94`; the sole call site is `GetState("network")` at `routes.rs:568` |
| `ReportHealth` | method | `(s component, s status, s detail) → ()` | nothing. Writes `health.<component> = {status, detail}` into the live-state tree. Rejects an empty component | `:209-229` | **no.** The only caller in the tree is the boot health gate, `os/rootfs/overlay-v2/usr/lib/mos/mos-health:45-50` |
| `Reboot` | method | `() → ()` | nothing. Records `power = {last_action, requested_by}` in live state and logs, **then** calls `org.freedesktop.systemd1.Manager.Reboot` | `:235-237` (→ `:95-101`, `mosd/mosd/src/power.rs:11-19,58-77`) | **yes** — `bus_client.rs:96-105`, from `POST /power/reboot` |
| `PowerOff` | method | `() → ()` | same shape, `Manager.PowerOff` | `:243-245` (→ `:104-110`) | **yes** — `bus_client.rs:107-116`, from `POST /power/poweroff` |
| `SettingsChanged` | **signal** | `(s path, s value_json)` | emitted after a successful `SetSettings` | `:249-254` | **no.** webd's zbus proxy (`mosd/webd/src/bus_client.rs:9-20`) declares only the five methods; it has no `#[zbus(signal)]` member and no signal receiver anywhere in the crate |

Two properties of `SetSettings` a UI author needs and that are easy to miss:

- **The write is validated against the typed tree before it is persisted**
  (`bus.rs:178-181` builds a `candidate`, `Settings::set` deserializes the whole
  root into `Settings` at `mosd/mosd-settings/src/model.rs:338-342`, and only
  then is `store.save` called). A malformed write fails without mutating
  anything.
- **`schema_version` is read-only** (`model.rs:333-335`, `model.rs:343-345`).

`paths_overlap` (`bus.rs:24-39`) decides which reconcilers re-run: segment-wise
prefix in *either* direction, with the root matching everything. So writing
`network.eth0.dhcp` re-runs the reconciler whose subtree is `network`, and
writing the whole tree re-runs all of them.

---

## 5. The settings tree, and what webd surfaces of it

Schema version **3** (`mosd/mosd-settings/src/model.rs:11`). Persisted as TOML
at `/var/lib/mos/settings.toml` (`mosd/mosd-settings/src/store.rs:12`), written
atomically, loaded through a migration chain (`mosd/mosd-settings/src/migration.rs:88`).
`#[serde(deny_unknown_fields)]` is on every struct — `model.rs:15`, `:49`,
`:67`, `:78`, `:110`, `:125`, `:141`, `:166`, `:176`, `:201`, `:218`, `:279`,
`:290` — so a document carrying an unknown key fails to load rather than
silently dropping it.

### 5.1 Top-level shape

`struct Settings` at `model.rs:16-32`:

| Field | Type | `model.rs:LINE` | Surfaced in webd today | Route |
|---|---|---|---|---|
| `schema_version` | `u32` | `:18` | **no** (and unwritable — `:333-335`) | — |
| `hostname` | `String`, default `"mos"` | `:20`, default `:38` | **yes** — read and written | `GET/POST /hostname` (`routes.rs:47`), also shown on `/` (`routes.rs:567`) and settable in the wizard (`routes.rs:441`) |
| `network` | `BTreeMap<String, IfaceSettings>` | `:22` | **yes** — read and written | `GET/POST /network` (`routes.rs:46`), wizard (`routes.rs:451`) |
| `access` | `AccessSettings` | `:25` | **partially** — see 5.2 | `/setup`, `/login` |
| `provisioning` | `ProvisioningSettings` | `:28` | **no** | — |
| `wifi` | `WifiSettings` | `:31` | **no** | — |

### 5.2 `access` — `AccessSettings`, `model.rs:50-63`

| Subtree | Fields (`model.rs:LINE`) | Surfaced in webd today | Route |
|---|---|---|---|
| `access.webAdmin` | `password_hash: String` (`:70`); the whole struct is `Option` (`:53`) | **partially** — written once at first-run setup (`routes.rs:430`) and read for login (`routes.rs:87-92`, `:502`). There is **no password-change route**: `grep` finds `SetSettings("access.webAdmin", …)` at exactly one call site, `routes.rs:430`, inside `setup_submit`, which 409s if a hash already exists (`routes.rs:374-383`) | `/setup`, `/login` |
| `access.ssh` | `enabled` (`:81`, default `false` `:99`), `port` (`:83`, default `22` `:100`), `permitRootLogin` (`:86`, default `true` `:101`), `passwordAuthentication` (`:90`, default `true` `:102`), `listenAddresses` (`:93`, default `[]` `:103`) | **no** — no route reads or writes any `access.ssh` path. (In-flight elsewhere; see section 8) | — |
| `access.console` | `shellEnabled: bool` (`:115`) | **no**. Also consumed by no reconciler at all — `grep -rn "shell_enabled" mosd/` finds only `model.rs:115` and its test at `model.rs:370` | — |
| `access.device` | `passwordHash: Option<String>` (`:134`), `generation: u32` (`:136`) | **no** — webd never reads `access.device`; `grep -rn "access.device\|passwordHash" mosd/webd/src/` returns nothing | — |

### 5.3 `provisioning` — `ProvisioningSettings`, `model.rs:142-151`

| Field | `model.rs:LINE` | Surfaced in webd today |
|---|---|---|
| `state` (`pending` \| `complete`, enum at `:156-162`) | `:144` | **no** |
| `deviceId` (`Option<String>`, lowercase hex) | `:147` | **no** |
| `seededGeneration` (`u32`) | `:150` | **no** |

The whole `provisioning` subtree is invisible to the UI. Nothing in
`mosd/webd/src/` mentions it.

### 5.4 `wifi` — `WifiSettings`, `model.rs:167-172`

**Nothing under `wifi` is surfaced in webd today.** No route, no form, no read.

`wifi.client` — `WifiClientSettings`, `model.rs:177-187`:

| Field | `model.rs:LINE` | Default | Surfaced |
|---|---|---|---|
| `enabled` | `:179` | `false` (`:191`) | no |
| `interface` | `:181` | `"wlan0"` (`:192`) | no |
| `networks` (`Vec<WifiNetwork>`) | `:186` | `[]` (`:193`) | no |

`WifiNetwork`, `model.rs:202-214`: `ssid` (`:204`), `psk: Option<String>`
(`:207`), `hidden` (`:210`), `priority: i32` (`:213`). The doc comment at
`model.rs:182-185` records a constraint any UI must live with: **the dot-path
syntax has no array indexing, so `networks` is written as a whole JSON array.**
Adding one network means reading the list, appending, and writing it back — a
read-modify-write with no locking between the read and the write.

`wifi.ap` — `WifiApSettings`, `model.rs:219-246`:

| Field | `model.rs:LINE` | Default (`:248-261`) | Surfaced |
|---|---|---|---|
| `mode` (`off`\|`provisioning`\|`always`, enum `:267-275`) | `:221` | `off` | no |
| `interface` | `:223` | `"wlan0"` | no |
| `ssid` (`Option`; absent = derive from device identity) | `:227` | `None` | no |
| `psk` (`Option`; absent = derive from device credential) | `:232` | `None` | no |
| `channel: u8` | `:234` | `6` | no |
| `countryCode` | `:237` | `"US"` | no |
| `address` (CIDR) | `:239` | `"192.168.4.1/24"` | no |
| `holdDownSeconds` | `:242` | `120` | no |
| `graceSeconds` | `:245` | `60` | no |

`holdDownSeconds` and `graceSeconds` are **consumed by nothing** — deliberately,
per `docs/design/connd.md:204-211`. Verified in code: `grep -rn
"hold_down_seconds\|grace_seconds" mosd/` finds them only in
`mosd/mosd-settings/src/model.rs` (declarations `:242`, `:245`; defaults `:258`,
`:259`) and in `mosd/mosd-settings/tests/settings.rs` (`:426-427`, `:489-490`).
No reconciler reads either field.

### 5.5 `network.<iface>` — `IfaceSettings`, `model.rs:280-286`

| Field | `model.rs:LINE` | Surfaced |
|---|---|---|
| `dhcp: bool` | `:282` | **yes** — checkbox, `routes.rs:317` |
| `static.address` | `:293` | **yes** — `routes.rs:318-319` |
| `static.gateway` (`Option`) | `:296` | **yes** — `routes.rs:320-321` |
| `static.dns` (`Vec<String>`) | `:299` | **yes** — comma-separated text field, `routes.rs:322-323`, split at `routes.rs:277-282` |

**IPv4 only.** `valid_ipv4` (`routes.rs:226-235`) and `valid_cidr`
(`routes.rs:238-247`) accept four dot-separated decimal octets and a prefix
`0..=32`; an IPv6 address fails both. The settings model itself is a bare
`String` and imposes no such limit (`model.rs:293`), so **this is a webd-side
restriction, not a schema restriction.**

**There is no delete-interface route.** `network_submit` (`routes.rs:696-720`)
only ever writes `network.<iface>`; nothing in the crate writes `null` or
removes a key. [inference from the absence of any such call site.]

---

## 6. The live-state tree — what `GetState` can actually return

The live-state tree is a `serde_json::Value` held in `MosdService`'s `Inner`
alongside the settings (`mosd/mosd/src/bus.rs:43-46`), initialised in
`mosd/mosd/src/main.rs:86-91` as an empty object (plus `{"dry_run": true}`
under `MOSD_DRY_RUN=1`). It is **not persisted** — a mosd restart empties it and
`apply_all()` (`main.rs:92`, `bus.rs:114-121`) repopulates it.

### 6.1 Everything that writes into it

| Top-level key | Written by | Cite | Shape |
|---|---|---|---|
| `hostname` | `HostnameReconciler` | `mosd/mosd/src/reconciler/hostname.rs:64` | `{"hostname": "<name>"}` — the **configured** name, echoed back after `set_static_hostname` succeeded |
| `network` | `NetworkReconciler` | `mosd/mosd/src/reconciler/network.rs:115-118,132` | `{"<iface>": {"file": "50-mos-<iface>.network", "dhcp": <bool>}}` |
| `sshd` | `SshdReconciler` | `mosd/mosd/src/reconciler/sshd.rs:392-403` | `enabled`, `port`, `permitRootLogin`, `passwordAuthentication`, `listenAddresses`, `dropIn`, `unit`, `activeState`, `unitFileState`, `rootPassword` |
| `wifiClient` | `WifiClientReconciler` | `mosd/mosd/src/reconciler/wifi_client.rs:508-518` | `enabled`, `interface`, `station`, `networks[]` (`ssid`/`hidden`/`priority`/`secured` — **never the PSK**), `config`, `networkdUnit`, `unit`, `activeState`, `unitFileState` |
| `wifiAp` | `WifiApReconciler` | `mosd/mosd/src/reconciler/wifi_ap.rs:792-807`, conflict variant `:739-750` | `mode`, `interface`, `accessPoint`, `ssid`, `ssidSource`, `channel`, `countryCode`, `address`, `secured`, `config`, `networkdUnit`, `unit`, `activeState`, `unitFileState` — or, on a single-radio conflict, a short object with `accessPoint: "conflict"` and a `conflict` sentence |
| `health.<component>` | `ReportHealth` callers | `mosd/mosd/src/bus.rs:209-229` | `{"status": …, "detail": …}` |
| `power` | `Reboot` / `PowerOff` | `mosd/mosd/src/bus.rs:80-89` | `{"last_action": "reboot"\|"power_off", "requested_by": "<unique bus name>"}` |
| `dry_run` | mosd startup under `MOSD_DRY_RUN=1` | `mosd/mosd/src/main.rs:87-89` | `true` |

A reconciler that **fails** does not vanish from the tree — `record`
(`bus.rs:126-137`) writes `{"error": "<message>"}` under the same key. So the
error state is readable over the bus; nothing in webd reads it.

### 6.2 Which components report health

Exactly **one**, and only once per boot: `os/rootfs/overlay-v2/usr/lib/mos/mos-health`
calls `ReportHealth("var", "ok"|"degraded", "<detail>")` at
`mos-health:194` / `:197`, via the `report_health` helper at `mos-health:45-50`.
That script runs from `mos-health.service`, a `Type=oneshot` ordered
`After=multi-user.target` (`os/rootfs/overlay-v2/usr/lib/systemd/system/mos-health.service:9,16-17`).

So `health` contains at most `health.var`, and its `detail` is the `/var`
percentage at boot (`mos-health:186-199`). **It is never refreshed.** Nothing
re-runs the gate and nothing else in the tree calls `ReportHealth` —
`grep -rn "ReportHealth\|report_health" .` finds only `bus.rs`, the two copies
of `mos-health`, and `os/tests/health-test.sh`.

### 6.3 What is NOT in the live-state tree, that an operator would expect

Each of these is absent from the tree entirely — not empty, absent, so
`GetState` on the path returns `InvalidArgs` (`bus.rs:199-201`):

- **The observed IP address of any interface.** `network` carries the rendered
  *unit file name* and the *configured* `dhcp` flag (`network.rs:117`) — never a
  lease, an address, a route or a DNS server actually in use. A DHCP interface
  that got no lease is indistinguishable in this tree from one that did.
- **Link/carrier state.** No reconciler asks networkd or the kernel whether a
  link is up.
- **The observed hostname.** `hostname` echoes `settings.hostname` back
  (`hostname.rs:64`) after the hostnamed call returned `Ok`; it is a
  confirmation that the write was attempted, not a read-back.
- **A/B slot state** — which slot is running, which is inactive, boot attempts
  left, whether the running slot is confirmed. Nothing writes it.
- **RAUC status of any kind**, including installed version and last install
  result.
- **Uptime.** Not in the tree; webd reads `/proc/uptime` itself
  (`routes.rs:569`).
- **Filesystem usage for anything but `/var`,** and even `/var` only as a
  boot-time snapshot inside a `health` detail string.
- **The device's own identity.** `deviceId` is a *setting* (`model.rs:147`), so
  it is reachable via `GetSettings`, but it is not in live state and no route
  reads it.
- **Memory, CPU, load, temperature, kernel version, OS version, build id.**
  None of these exist anywhere in mos's management plane.
- **Connected WiFi station details** — signal strength, the SSID actually
  associated with, the BSSID. `wifiClient.networks` lists the **configured**
  networks (`wifi_client.rs:495-506`); `activeState` is systemd's view of the
  supplicant *unit*, not of the association.
- **Connected AP clients.** Nothing enumerates hostapd's station table.

---

## 7. Shipped but unexposed — the gap table

This is the core deliverable: mechanisms M3/M4/M5 built that **no UI reaches
today**. "How a UI would read it today" is a statement about what exists at this
commit, not a recommendation.

| # | Mechanism | What exists | Where it lives (cited) | How a UI would read it today | Operator question it answers |
|---|---|---|---|---|---|
| 1 | **A/B slot state — which slot is running** | Full two-slot model: `slot.rootfs.0` bootname `A`, `slot.rootfs.1` bootname `B`, each with a child boot slot | `os/update/rauc/system.conf.in:75-95`; partition GUIDs in `os/boards/cx3576/board.env:209-219`, `:155-172` | **No bus mechanism.** `grep -rci rauc mosd/mosd/src/` returns **0 for every file**. A UI would have to subprocess `rauc status --output-format=shell` (the exact parse the health gate does at `os/rootfs/overlay-v2/usr/lib/mos/mos-health:72-104`), or read `RAUC_SYSTEM_BOOTED_BOOTNAME` the same way. webd cannot: `mosd/webd/src/settings_api.rs:10-12` states webd never spawns a process | "Which system am I running, A or B?" |
| 2 | **Boot attempt credits / rollback posture** | `BOOT_A_LEFT` / `BOOT_B_LEFT` in the redundant U-Boot environment, readable via `fw_printenv` | `os/rootfs/overlay-v2/etc/fw_env.config.in:27-29`; range constraint `os/boards/cx3576/board.env:198-205`; RAUC writes them per `os/update/rauc/system.conf.in:36-48` | **No mechanism.** Would need `fw_printenv` as a subprocess, and `fw_env.config.in:23-25` warns there is **no cross-process locking** between the two existing writers | "Is this boot on its last credit before rollback?" |
| 3 | **RAUC status and last install result** | Status file on the META partition, deliberately not on `/var` | `os/update/rauc/system.conf.in:14-34` | **No mechanism** — same as row 1 | "What version is in the other slot? Did the last update succeed?" |
| 4 | **Installing an update bundle** | Signed verity-format `.raucb` bundles are **built** (`os/update/bundle.sh`), signature-verified against `/etc/rauc/keyring.pem`, refusing `plain` format | `os/update/bundle.sh:1-22`; `os/update/rauc/manifest.raucm.in:9-32`; `os/update/rauc/system.conf.in:50-62` | **No mechanism at all.** There is no upload route, no file-receiving handler (`Multipart` appears nowhere in `mosd/webd/`), and no `rauc install` caller anywhere in `mosd/`. **Would need new mosd work** — a bus method plus a place to put the bundle | "Install this update." |
| 5 | **Boot health gate + mark-good** | A 208-line gate that probes systemd, mosd and webd, then runs `rauc status mark-good` | `os/rootfs/overlay-v2/usr/lib/mos/mos-health:111-207`, unit at `.../mos-health.service:1-26` | **Only the side effect is visible**, and only for `/var`: `health.var` via `ReportHealth` (`mos-health:194,197` → `bus.rs:209-229`). The gate's own verdict — did it pass, was the slot confirmed, which probe failed — goes to the journal (`mos-health:17-18`) and **nowhere a UI can read**. Would need new mosd work | "Did this boot confirm itself, or is it one crash from rolling back?" |
| 6 | **connd WiFi station state** | Fully reconciled: wpa_supplicant config rendered at 0600, networkd unit, `wpa_supplicant@<if>.service` driven | `mosd/mosd/src/reconciler/wifi_client.rs:461-519`; settings `model.rs:177-214` | **Readable today via existing calls, unused:** `GetSettings("wifi.client")` and `GetState("wifiClient")` both work. `mosd/webd/src/` contains **zero** references to either path. So this is a pure UI gap, not a mechanism gap | "Is the appliance on WiFi, and which network?" |
| 7 | **connd WiFi AP state** | Fully reconciled: hostapd config at 0600, networkd unit with `DHCPServer=yes`, `hostapd@<if>.service` driven; single-radio conflict reported as `accessPoint: "conflict"` | `mosd/mosd/src/reconciler/wifi_ap.rs:726-808`, conflict at `:738-751`; settings `model.rs:219-246` | **Readable today via existing calls, unused:** `GetSettings("wifi.ap")`, `GetState("wifiAp")`. Zero references in webd. Note `wifiAp.ssid` and `ssidSource` are already computed for exactly this purpose (`wifi_ap.rs:796-797`) | "What SSID is the setup access point broadcasting, and why is it up?" |
| 8 | **Provisioning state and device identity** | `provisioning.state` (`pending`/`complete`), `provisioning.deviceId`, `seededGeneration`; first-boot seeding is idempotent and network-free | `mosd/mosd-settings/src/model.rs:142-162`; `mosd/mosd/src/provisioning.rs:1-25,117` | **Readable today:** `GetSettings("provisioning")` works. Zero references in webd | "Has this device finished first-boot setup? What is its identity?" |
| 9 | **Device credentials (the per-device password and the AP PSK)** | Both minted on-device from the CSPRNG at first boot; the device-password Argon2id hash in `access.device.passwordHash`, a bcrypt copy in the root shadow entry, plaintexts at `/var/lib/mos/secrets/{device-password,ap-psk}` 0600 in a 0700 dir | `mosd/mosd/src/identity.rs:42-75,90-114`; hash consumed by `mosd/mosd/src/reconciler/sshd.rs:298,326` | **Metadata readable, plaintext not.** `GetSettings("access.device")` returns the hash and generation. The **plaintexts are not on the bus at all** — no method reads `secrets/`. A UI could not display "your device password is X" without new mosd work. Separately, **nothing can rotate either secret** — `docs/plan/PLAN-010.md:493-495` records this as a gap, and `identity.rs:109-114` confirms a present hash is never regenerated | "What is my device password?" / "Rotate it." |
| 10 | **Power actions** | **These ARE exposed — the one thing in this table that is done.** `Reboot`/`PowerOff` on the bus, reaching `org.freedesktop.systemd1.Manager` | `mosd/mosd/src/bus.rs:235-245`, `mosd/mosd/src/power.rs:11-19,58-77` | **Already surfaced:** `GET /power` (`routes.rs:48`), `POST /power/reboot` (`:52`), `POST /power/poweroff` (`:53`), each behind the session gate, POST-only, with a required confirmation token (`routes.rs:820`), answering 202 on a detached task (`routes.rs:857-882`). **The known gap:** the pane has no update-state awareness, so it cannot warn that rebooting a `PENDING_CONFIRM` slot burns a boot attempt — `docs/plan/PLAN-010.md:502-503` and `docs/design/mosd.md:217-220` both record this | "Reboot / shut down." (answered) |
| 11 | **Storage / filesystem usage** | Four tiers with distinct loss semantics: STATE `/mnt/state`, DATA `/srv` (the only growth target), META `/mnt/meta`, EPHEMERAL `/var` | `os/rootfs/overlay-v2/etc/fstab.in:11-27`; sizes at `os/boards/cx3576/board.env:251-310`; tier table `docs/design/ro-root.md:363-368` | **Almost nothing.** Only `/var`, only as a boot-time percentage inside `health.var.detail` (`mos-health:186-199`). `/srv` — the tier that actually fills up — has **no reporting of any kind**. Would need new mosd work (a `statvfs` read is trivial; the bus surface for it does not exist) | "Is the disk filling up? How much room is left for application data?" |
| 12 | **Uptime** | Not in mosd at all | — | **webd reads `/proc/uptime` itself** (`mosd/webd/src/routes.rs:569-571`, parsed `:539-546`, formatted `:549-560`) and renders it on `/` (`:580-583`). Note this is the one place webd touches the filesystem for data rather than going through the bus — a documented exception to the layering stated in `mosd/webd/src/settings_api.rs:10-12` | "How long has this been up?" (answered, via a side channel) |
| 13 | **Hostname: configured vs observed** | `hostname` setting; reconciled through systemd-hostnamed | `mosd/mosd-settings/src/model.rs:20`; `mosd/mosd/src/reconciler/hostname.rs:60-65` | **Configured only.** `/` shows `GetSettings("hostname")` (`routes.rs:567`). The live-state `hostname` key echoes the same configured value back (`hostname.rs:64`) — it is **not** a read-back from hostnamed. There is no `GetHostname` call anywhere | "What does the network actually see this box as?" |
| 14 | **Network: configured vs observed** | Reconciler renders `50-mos-<iface>.network` into networkd's runtime dir and sweeps every `*-mos-*.network` it did not render | `mosd/mosd/src/reconciler/network.rs:108-133`, sweep at `:121-130`; the sweep hazard is documented at `docs/design/connd.md:216-230` | **Configured only.** `/` renders `GetState("network")` (`routes.rs:568`), which is `{iface: {file, dhcp}}` — the unit file name and the configured flag. **No address, no lease, no gateway, no carrier.** An operator on a DHCP interface cannot learn their own IP from this UI. Reading the real thing would need mosd to **query** networkd. mosd already talks to `org.freedesktop.network1`, but for exactly one thing: `Manager.Reload` (`mosd/mosd/src/reconciler/network.rs:36-43`). It issues no `Get`, no property read and no link enumeration — the four `network1` matches in `mosd/` are all inside that one `call_method` | "What is my IP address?" |
| 15 | **SSH channel state** | Reconciler renders `/etc/ssh/sshd_config.d/10-mos.conf`, writes the device password into the root shadow entry, drives `ssh.service`, and publishes `activeState`/`unitFileState`/`rootPassword` | `mosd/mosd/src/reconciler/sshd.rs:386-404`; settings `model.rs:79-94` | **Readable today via existing calls, unused in this branch:** `GetSettings("access.ssh")` and `GetState("sshd")`. **In flight on a separate branch — see section 8** | "Is SSH open? On what port?" |
| 16 | **Settings change notification** | `SettingsChanged(path, value_json)` is emitted after every successful write | `mosd/mosd/src/bus.rs:249-254`, emitted `:190-192` | **Not subscribed.** webd's proxy declares five methods and no signal (`mosd/webd/src/bus_client.rs:9-20`). Since webd has no JavaScript (section 3.2) there is no transport to push it over either | "Something else changed the config — show me." |
| 17 | **Console shell policy** | `access.console.shellEnabled` exists in the schema | `mosd/mosd-settings/src/model.rs:111-116` | **Readable via `GetSettings`, but meaningless:** no reconciler consumes it. `grep -rn "shell_enabled" mosd/` finds one non-test hit — the field declaration at `mosd/mosd-settings/src/model.rs:115` — plus three assertions in `mosd/mosd-settings/tests/settings.rs` (`:395`, `:473`, `:652`). Nothing under `mosd/mosd/src/` reads it. `docs/plan/PLAN-010.md:518` records this | — (the setting does nothing today) |
| 18 | **Reconciler failure state** | A failing reconciler is recorded as `{"error": "<message>"}` under its live-state key rather than disappearing | `mosd/mosd/src/bus.rs:126-137` | **Readable via `GetState("<name>")`, unread.** webd calls `GetState` for exactly one path, `"network"` (`routes.rs:568`), and its rendering treats any object as opaque JSON (`routes.rs:587-596`) — an `error` key would be dumped as raw JSON in a `<pre>`, not surfaced as a failure | "Did applying my settings actually work?" |

### 7.1 Summary of the gap classes

Counting the 18 rows above [inference, my classification of the rows]:

- **1 answered** (row 10, power) — plus row 12 answered through a side channel.
- **7 need only UI work** — the bus call already exists and returns the data:
  rows 6, 7, 8, 15, 16, 17, 18, and the metadata half of row 9.
- **9 need new mosd work** — no mechanism reaches the data from the bus at all:
  rows 1, 2, 3, 4, 5, 11, 13, 14, and the plaintext half of row 9.

The A/B update subsystem is the sharpest of these: it is the largest thing M4
built, and **mosd contains literally zero lines referencing it**
(`grep -rci rauc mosd/mosd/src/` → 0 in all 12 files).

---

## 8. In-flight work not in this branch

A parallel campaign, **`sshweb`, on branch `bkd/hiu25adw`**, is adding SSH
management to webd. It is **not merged into this branch and is not verifiable
from this tree.**

- **Not read, not cited.** Per this task's constraints I did not check out,
  read, diff or `git log` that branch. Nothing below is a claim about its file
  contents.
- **What is expected to land** (from the campaign brief, not from code): routes
  in `mosd/webd/src/routes.rs` surfacing the `access.ssh` subtree — the
  `enabled`, `port`, `permitRootLogin`, `passwordAuthentication` and
  `listenAddresses` fields catalogued in section 5.2.
- **Consequence for this document:** treat **section 5.2's "no" for
  `access.ssh`, and gap-table row 15, as true of this branch only.** A reader
  looking at a post-merge tree should re-measure both.
- **What remains open even if that lands:** the SSH work is a settings pane.
  Rows 1–5, 9, 11, 13 and 14 of the gap table are untouched by it, as is the
  `access.device` credential surface.

**This request was answered by anchoring, not by re-measuring.** The `sshweb`
merge happened: it is `86cd669`, whose commit message names the branch this
section names, `bkd/hiu25adw`. The two re-measures asked for above — the route
inventory in section 2, and section
5.2's "no" for `access.ssh` together with gap-table row 15 — were **not** carried
out on this document, deliberately. A snapshot is not maintained (§0), and
re-measuring it on each merge would never finish. The measured surface at
`86cd669` lives in `docs/design/api.md` §1 instead — the route table as shipped
in its §1.2, and the six drifts this document has accumulated enumerated in its
§1.7. Both re-measures are answered there. The request was not ignored and it was
not silently dropped — it was redirected, and §0 is where that redirect is
recorded.

Nothing else in this section asks to be re-measured. "What remains open even if
that lands", above, is an observation carried forward as history, not a request;
it was true of the pre-merge tree and this document does not re-check it.

---

## 9. Contradictions found — design document vs code

Recorded, not fixed; fixing design documents is out of scope for this task.

| # | Document says | Code does | Cites |
|---|---|---|---|
| 1 | The sshd reconciler's subtree is **"`access.ssh`, `access.device`"** | `subtree()` returns **`"access.ssh"` only**. Since `SetSettings` re-runs a reconciler only when `paths_overlap(path, subtree)` holds (`mosd/mosd/src/bus.rs:183-188`, `paths_overlap` at `:24-39`), a write to `access.device` alone does **not** re-run the sshd reconciler — so a changed device-password hash is not pushed into `/etc/shadow` until something else triggers a reconcile. `apply()` genuinely *reads* `access.device` (`sshd.rs:389` → `apply_root_password(settings)` at `sshd.rs:298`), which is presumably why the doc says what it says | doc `docs/design/mosd.md:150`; code `mosd/mosd/src/reconciler/sshd.rs:382-384` and `mosd/mosd/src/bus.rs:184` |
| 2 | The device password "**mosd and webd verify against themselves**" via `access.device.passwordHash` | **Neither does.** webd verifies only `access.webAdmin.password_hash` (`mosd/webd/src/routes.rs:87-92`, used at `:502-505`) and contains no reference to `access.device` at all. mosd's `identity::verify_password` is marked `#[allow(dead_code)]` with the comment "read back by the access and connd reconcilers, which do not exist yet", and `grep -rn "identity::verify_password" mosd/` finds **no caller** | doc `docs/design/access.md:165-166`; code `mosd/webd/src/routes.rs:87-92`, `mosd/mosd/src/identity.rs:208-217` |
| 3 | The device password authenticates the operator on "SSH, the local console **and the webd admin UI**" | The webd admin UI authenticates against `access.webAdmin.password_hash`, a **separate** secret set by the operator during first-run setup (`routes.rs:429-430`). The two credentials are unrelated: nothing copies one into the other. Same defect as row 2, stated in a second document | doc `docs/design/provisioning.md:135`; code `mosd/webd/src/routes.rs:429-430`, `:87-92` |
| 4 | "nothing on the device drives yet (**mosd invokes `rauc install` on a local file**)" — the parenthetical asserts a mosd capability | **mosd has no RAUC integration whatsoever.** `grep -rci rauc mosd/mosd/src/` returns 0 for all 12 source files. There is no `rauc install` call anywhere in `mosd/` | doc `os/update/rauc/manifest.raucm.in:27-28`; code — absence, measured by the grep above across `mosd/mosd/src/` |
| 5 | "webd bridges **HTTP/WebSocket** ↔ D-Bus for browsers" | There is no WebSocket in webd. `axum`'s `ws` feature is not enabled (`mosd/webd/Cargo.toml:15` takes the workspace default, `mosd/Cargo.toml:36` = `axum = "0.8"` with no features), no route upgrades a connection (`routes.rs:40-57`), and with zero JavaScript (section 3.2) nothing could consume one. **Mitigating context:** this line sits in §2, the M2 *decision record*, which the document's own header (`docs/design/mosd.md:8-11`) says is preserved unchanged as a record — so it is fairly read as intent rather than a claim about today | doc `docs/design/mosd.md:29-30`; code `mosd/webd/Cargo.toml:15`, `mosd/webd/src/routes.rs:40-57` |
| 6 | Settings are "Persisted as versioned TOML on STATE (**`/state/mos/settings.toml`**)" | The path is **`/var/lib/mos/settings.toml`** (`mosd/mosd-settings/src/store.rs:12`), which is a bind mount from `/mnt/state/mos` (`os/rootfs/overlay-v2/etc/systemd/system/var-lib-mos.mount:13-14`). Same partition, different path. Same mitigating context as row 5 — §3 is the M2 record — **and §5.1 of the same document states the correct path** (`docs/design/mosd.md:67`), so the document contradicts itself | doc `docs/design/mosd.md:42` vs `docs/design/mosd.md:67`; code `mosd/mosd-settings/src/store.rs:12` |

Rows 1–4 are substantive: a reader acting on any of them would be wrong about
what the system does. Rows 5–6 are stale-record artefacts of a document that
explicitly preserves its original decision text, and are listed for completeness.

---

## 10. Unverified / gaps

Things I could not establish from this tree, and what I tried:

1. **Nothing here was executed.** No `cargo`, no `nextest`, no image build, no
   boot. Every behavioural statement is a reading of source. The task
   constraints forbade the build; I did not attempt it.
2. **`os/verify-image-v2.sh` assertions are cited, not run.** I cite
   `os/verify-image-v2.sh:922-929` for what the verifier *asserts* about
   `webd.service`. I did not run the verifier, so I cannot say those assertions
   currently pass on a built image. `docs/plan/PLAN-010.md:335` claims
   `293/293` as of 2026-08-19 — that is a **[doc]** claim I did not reproduce.
3. **The `sshweb` branch (`bkd/hiu25adw`) is entirely unverified** by
   construction — I was instructed not to read it and did not. Section 8's
   expectations come from the campaign brief only.
4. **Runtime `GetState` shape is inferred from the reconcilers, not observed.**
   I read every `apply()` return and every `record()`/`insert` call site
   (section 6.1), and I believe that enumerates the tree exhaustively. But I did
   not run mosd and call `GetState("")`, so I cannot rule out a key I missed.
   The grep I used to bound this was over `inner.state` and `state.as_object_mut`
   in `mosd/mosd/src/bus.rs` plus the five reconciler `apply` returns.
5. **"webd runs as root" is an inference from the absence of `User=`** in
   `mosd/dist/webd.service` (13 lines, quoted in full in section 3.5). I did not
   observe the process. There is no drop-in directory for that unit anywhere in
   the tree (`find . -name "webd.service.d"` → nothing), so a drop-in adding
   `User=` would have to be created outside the repo.
6. **Whether `SettingsChanged` is emitted reliably under concurrent writes** —
   not analysed. The emit is outside the lock (`mosd/mosd/src/bus.rs:189-192`,
   `drop(inner)` precedes it); I did not reason about the ordering consequences
   because no consumer exists.
7. **Browser behaviour is not verified.** Whether the self-signed certificate
   produces a usable first-run experience, whether `SameSite=Lax` is sufficient
   against the specific POST routes present, and whether the forms are usable on
   a phone — all unexamined. `<meta name="viewport">` **is** emitted
   (`mosd/webd/src/routes.rs:163`); nothing beyond that was checked.
8. **No external system was consulted.** This document makes no claim about
   Venus OS, Bottlerocket, RAUC upstream or any other project. The two sibling
   tasks own that half.
9. **Line numbers were spot-checked by re-extraction**, not by a full
   mechanical pass. Every handler line number in section 2 was re-derived with
   `grep -n "^async fn "` after the table was written; every `model.rs` and
   `bus.rs` line was read from a numbered dump. A residual error rate above zero
   is possible.

---

## Appendix A — observations for the design task

Fenced to three sentences, per the task constraints.

The single largest asymmetry this inventory turned up is that the settings tree
is well surfaced and the **live-state tree is almost entirely unsurfaced** —
webd makes exactly one `GetState` call, for one path, and renders its result as
a raw JSON dump. Seven of the eighteen gap-table rows need no new mosd
mechanism at all, only a route, which makes them a materially different class of
work from the nine that need a new bus surface. The absence of any JavaScript is
worth treating as a measured starting position rather than a constraint or a
virtue: it is what makes every current interaction a form POST plus a redirect,
and it is why nothing in the system can display a value that changes on its own.

<!-- dated-record: an inventory measured at 86cd669, already classified dated by RFCT-165; it cites paths HEAD no longer has; exempt from docs/verify-citations.sh (RFCT-172) -->
