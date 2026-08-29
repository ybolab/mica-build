# RFCT-259 PLAN-028 M4: the status-outruns-pinned-phase class, bounded

- **status**: completed — the inventory, the 38-check build-time slice with its planted-red proof, and the residue with one worked example
- **priority**: P2
- **owner**: bkd/aygqxa5s
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-028 (M4)

The class, stated exactly: a milestone changes a shipped, wire-visible value; a
`test/apid-api` phase goes on pinning the OLD value as a literal; and nothing
fails, because the phase only runs under a booted run. `make os-apid-api-test`
needs a built x64 image and a QEMU boot, it is wired into no CI job (measured:
`.github/workflows/` names it nowhere), and it is the only thing in this
repository that executes those literals.

This milestone is bounded by design. It does not build boot tooling and it does
not teach the harness to run without a boot. It measures the pins, splits them
by whether agreement can be asserted against a committed artefact, implements
the half that can, and writes the half that cannot down as the class's residue.

## 1. The inventory

Every pinned literal under `test/apid-api/src/`, measured at d33deff. Twelve
phase files plus `client.ts`, `config.ts`, `console.ts`, `report.ts`,
`runner.ts`, `qemu.ts`, `main.ts` and the `fixture/` and `guest/` trees.

A dated measurement: the line numbers are where these literals were at d33deff,
and they are not re-anchored when the phase files move. What does not rot is
`src/spec-pins.ts`, whose rows locate their sites by anchor text rather than by
line and go RED — never quietly green — when an anchor stops matching.

The WHERE-ELSE column is the one that decides the partition. `openapi.json`
documents `/api/` and nothing else, so every literal about the HTML pane surface
(`/`, `/login`, `/setup`, `/hostname`, `/power/*`, `/ssh/*`, `/network*`,
`/containers/*`, `/mqtt/*`, `/builtin*`, `/healthz`, `/logout`) has no entry in
it at all. That is not a gap in the document; those routes are outside the `v1`
contract by design (§6.3), and it is why the mechanical slice is as small as it
is.

`selftest.ts` is excluded throughout: its literals are the harness's own stub
fixtures (`hello selftest`, `/text`), asserted against a stub server this
process starts. Nothing there is a claim about apid.

### 1.1 The API surface — `openapi.json` has something to say

```
site (file:line)                     literal                what it pins                                   where else it is stated                                                   class
------------------------------------ ---------------------- ---------------------------------------------- ------------------------------------------------------------------------- -----
phases/04-readonly.ts:445            404                     GET /api, /api/, /api/v1/settings,             NONE. api_not_found is the nest fallback; none of these four targets is    b-unstated
                                                             /api/deeply/nested/thing -> 404                a declared path. routes.rs:237-242 builds the envelope, for no one path.
phases/04-readonly.ts:446            "application/json"      the same four -> Content-Type                  NONE, same reason: no declared path, so no responses.content to read.      b-unstated
phases/04-readonly.ts:452            "no-store"              the same four -> Cache-Control                 routes.rs CacheClass::NoStore + api.md §4.3. openapi.json carries NO       b
                                                                                                            headers member anywhere (measured: zero occurrences), so no artefact
                                                                                                            states this per route in a comparable form.
phases/04-readonly.ts:481            "not_found"             error.code on the four                         routes.rs:240 ApiError::apid("not_found", ..) and openapi.json's 404       b-unstated
                                                                                                            response DESCRIPTION prose. ApiErrorDetail.code is declared an open set
                                                                                                            with no enum, so no machine-readable per-route statement exists.
phases/04-readonly.ts:486            "apid"                  error.source on the four                       routes.rs:708 Self::new(code, message, "apid"). Prose only in the doc.     b-unstated
phases/04-readonly.ts:481            "code"                  the envelope member name                       /components/schemas/ApiErrorDetail required[]                             a
phases/04-readonly.ts:486            "source"                the envelope member name                       /components/schemas/ApiErrorDetail required[]                             a
phases/04-readonly.ts:509            "path" (absent)         §2.4 reserves error.path for a dot-path        /components/schemas/ApiErrorDetail properties[] but NOT required[]         a
phases/04-readonly.ts:313            "error"                 the envelope's one member                      /components/schemas/ApiError required[]                                    a
phases/04-readonly.ts:525            200                     unauthenticated GET /api/versions              /paths/~1api~1versions/get/responses/200                                   a
phases/04-readonly.ts:530            "application/json"      its media type                                 /paths/~1api~1versions/get/responses/200/content                           a
phases/04-readonly.ts:543            303                     unauthenticated GET /api/v1/settings           NONE. The bare root is not a declared path (the declared one is            b
                                                             (the bare root, gated)                         /api/v1/settings/{path}) and 303 is the HTML gate, not the API.
phases/04-readonly.ts:548            "/login"                where that 303 points                          routes.rs gate. Not an API route; nothing in openapi.json.                 b
phases/05b-wireguard.ts:445          401                     unauthenticated rotate                         /paths/..rotate-key/post/responses/401                                     a
phases/05b-wireguard.ts:458          "application/json"      its media type                                 /paths/..rotate-key/post/responses/401/content                             a
phases/05b-wireguard.ts:469          405                     GET on the rotate route                        /paths/..rotate-key/post/responses/405                                     a
phases/05b-wireguard.ts:486          404                     rotate on an undeclared interface              /paths/..rotate-key/post/responses/404                                     a
phases/05b-wireguard.ts:491          "settings_not_found"    that refusal's error.code                      routes.rs error mapping + the 404 response description. Open set.          b-unstated
phases/05b-wireguard.ts:491          "mosd"                  that refusal's error.source                    routes.rs. ApiErrorDetail.source has no enum either.                       b-unstated
phases/05b-wireguard.ts:491          "network.no-such-iface" the dot-path echoed back                       NONE: it is this phase's own input, echoed. Nothing states it.             b
phases/05b-wireguard.ts:500          200                     the rotation itself                            /paths/..rotate-key/post/responses/200                                     a
phases/05b-wireguard.ts:501          "no-store"              its Cache-Control                              as phases/04-readonly.ts:452 above.                                              b
phases/05b-wireguard.ts:511          "publicKey" (only)      the rotation body, one member and no other     /components/schemas/WireguardRotation required[] AND properties[]          a
phases/05b-wireguard.ts:98           44                      the base64 length of an X25519 key             NONE. WireguardRotation.publicKey is a bare string with no length          b
                                                                                                            constraint; 32 bytes padded is arithmetic, not a stated value.
phases/05b-wireguard.ts:312          "wireguard"             kind published in live network state           /components/schemas/NetworkInterface.kind is prose ("physical, vlan,       b-unstated
                                                                                                            bridge or wireguard"), and the STATE route's body is ResourceValue,
                                                                                                            i.e. any JSON. No comparable statement.
phases/05b-wireguard.ts:313,511      "publicKey"             the live-state member                          NONE: publicKey is a live-state addition, absent from NetworkInterface     b-unstated
                                                                                                            and from every schema the state route names.
phases/05b-wireguard.ts:146          "physical","vlan",      the /network pane's kind control values        NetworkInterface.kind prose, as above; the PANE is HTML and not in the     b
                                     "bridge","wireguard"                                                   document at all.
phases/05b-wireguard.ts:159          "vlanParent","vlanId",  the pane's per-kind input names                NONE. These are FORM field names, not API members; VlanParameters and     b
                                     "bridgePorts",                                                         BridgeParameters spell theirs differently (id, parent, ports).
                                     "listenPort"
phases/05d-bearer.ts:202             200                     GET /api/v1/settings/hostname                  /paths/..settings~1{path}/get/responses/200                               a
phases/05d-bearer.ts:227             200                     GET /api/v1/settings/mqtt.enabled              same pointer                                                              a
phases/05d-bearer.ts:253             204                     PUT /api/v1/settings/mqtt.enabled              /paths/..settings~1{path}/put/responses/204                               a
phases/05d-bearer.ts:273             204                     the restoring PUT                              same pointer                                                              a
phases/05d-bearer.ts:286             200                     GET /api/v1/ssh/authorized-keys                /paths/..authorized-keys/get/responses/200                                a
phases/05d-bearer.ts:296             "keys","notice"         the listing's members                          /components/schemas/AuthorizedKeyList required[]                          a
phases/05d-bearer.ts:311             201                     POST /api/v1/ssh/authorized-keys               /paths/..authorized-keys/post/responses/201                               a
phases/05d-bearer.ts:321             "key"                   the add response's member                      /components/schemas/AddedAuthorizedKey required[]                         a
phases/05d-bearer.ts:321             "fingerprint"           the entry member that is the DELETE segment    /components/schemas/AuthorizedKeyEntry properties[]                       a
phases/05d-bearer.ts:344             204                     DELETE .../authorized-keys/{fingerprint}       /paths/..authorized-keys~1{fingerprint}/delete/responses/204              a
phases/05d-bearer.ts:365             200                     POST .../rotate-key over the bearer            /paths/..rotate-key/post/responses/200                                    a
phases/05d-bearer.ts:379             "publicKey"             the rotation's member                          /components/schemas/WireguardRotation required[]                          a
phases/05d-bearer.ts:384             "privateKey" (absent)   no private half on any surface                 /components/schemas/WireguardRotation properties[] must NOT carry it      a
phases/05d-bearer.ts:401             200                     GET /api/v1/tokens                             /paths/..tokens/get/responses/200                                         a
phases/05d-bearer.ts:409             "id","name"             a token summary row                            /components/schemas/ApiTokenSummary required[]                            a
phases/05d-bearer.ts:433             201                     POST /api/v1/tokens                            /paths/..tokens/post/responses/201                                        a
phases/05d-bearer.ts:442,443         "id","token"            the mint response's members                    /components/schemas/MintedToken required[]                               a
phases/05d-bearer.ts:461             204                     DELETE /api/v1/tokens/{id}                     /paths/..tokens~1{id}/delete/responses/204                                a
phases/05d-bearer.ts:473             401                     the revoked token's next request               /paths/..settings~1{path}/get/responses/401                               a
phases/05d-bearer.ts:478,529         "not_authenticated"     that refusal's error.code                      routes.rs + response description prose. Open set, no enum.                b-unstated
phases/05d-bearer.ts:489             200                     the surviving token                            /paths/..settings~1{path}/get/responses/200                               a
phases/05d-bearer.ts:506             401                     no credential at all                           same operation, responses/401                                             a
phases/05d-bearer.ts:523             application/json        that 401's media type (a regex)                /paths/..settings~1{path}/get/responses/401/content                       a
phases/05d-bearer.ts:539             "message"               the envelope's human member                    /components/schemas/ApiErrorDetail required[]                             a
phases/05d-bearer.ts:552             401                     an unknown bearer                              same operation, responses/401                                             a
phases/05d-bearer.ts:619             204                     the second token revoking itself               /paths/..tokens~1{id}/delete/responses/204                                a
phases/05d-bearer.ts:625             401                     a self-revoked token's next request            /paths/..tokens/get/responses/401                                         a
phases/05d-bearer.ts:179             "mos_<id>_<secret>"     the token's wire format                        SetupToken and MintedToken DESCRIPTION prose ("The whole token,            b-unstated
                                     (as mos_${id}_)                                                        mos_<id>_<secret>"). Prose, not a pattern member.
phases/05d-bearer.ts:65              the SHA256 fingerprint  the DELETE segment for the phase's key         NONE. It is what ssh-keygen -lf prints for this phase's own throwaway     b
                                                                                                            key; no artefact states it and none should.
phases/05d-bearer.ts:51              "mqtt.enabled"          the settings dot-path the phase writes         mosd-settings model.rs MqttSettings.enabled. A settings PATH, not a       b
                                                                                                            wire value; the API passes dot-paths through (§2.2) and openapi.json
                                                                                                            declares {path} as a free parameter.
```

### 1.2 The HTML pane surface — `openapi.json` has nothing to say

`openapi.json` documents `/api/` alone. Every row below is therefore NONE
against it, and the WHERE-ELSE column names the Rust source instead.

```
site (file:line)                     literal                      what it pins                                    where else it is stated                                   class
------------------------------------ ---------------------------- ----------------------------------------------- --------------------------------------------------------- -----
phases/01-transport.ts:23            "DEPTH_ZERO_SELF_SIGNED_CERT" the TLS rejection shape                        NONE. It is node/bun's verdict on apid's cert, not a       b
                                                                                                                   value this tree states anywhere.
phases/01-transport.ts:26            443                          the guest's own HTTPS port in the 308 Location   os/pkgs/mosd/apid config/tls listener bind. Not a wire     b
                                                                                                                   member; only a booted listener can be asked.
phases/01-transport.ts:135           308                          GET / and /hostname on the plain-HTTP listener   routes.rs redirect handler                                 b
phases/01-transport.ts:174           200                          GET /healthz unauthenticated                     routes.rs                                                  b
phases/01-transport.ts:213,214       303, "/setup"                the setup-mode gate                              routes.rs gate                                             b
phases/02-setup.ts:21                "apid_session"               the session cookie NAME                          session.rs:18 pub const COOKIE_NAME                        b
phases/02-setup.ts:35-41             "Path=/","HttpOnly",         the five cookie attributes; SameSite=Lax IS      session.rs:121 format!("{COOKIE_NAME}=..; Path=/;           b
                                     "Secure","SameSite=Lax",     the whole cross-site defence                     HttpOnly; Secure; SameSite=Lax; Max-Age=86400")
                                     "Max-Age=86400"
phases/02-setup.ts:44,47             "not a valid hostname!",     inputs, not answers                              NONE, and correctly so.                                    b
                                     "sevenby"
phases/02-setup.ts:50-66             the CSRF marker and header   the ABSENCE of any anti-forgery scheme           NONE. An absence claim about markup apid does not          b
                                     lists                                                                         render; only the rendered page can answer it.
phases/02-setup.ts:107,115,122,      200,400,303,400,422,303,     the setup ladder and its once-only 409           routes.rs setup handler                                    b
  135,147,156,292                    409
phases/02-setup.ts:123,157,283       "/setup","/","/login"        where each answer redirects                      routes.rs gate                                             b
phases/03-login.ts:18,21-27          "apid_session" and the same  the SAME five attributes against the OTHER       session.rs:18,121 — and the divergence between the         b
                                     five attributes              handler                                          two handlers is the point, observable only over the wire.
phases/03-login.ts:34                1_000                        BACKOFF_BASE, waited out after one failure       auth.rs:13 BACKOFF_BASE = Duration::from_secs(1)           b
phases/03-login.ts:37                750                          the phase's own scheduling margin                NONE. A harness constant.                                  b
phases/03-login.ts:67,68,69          303,"/login",["Path=/",      logout, and the deletion cookie                  routes.rs logout + session.rs:126 (Max-Age=0)              b
                                     "Max-Age=0"]
phases/03-login.ts:105,110,125,126   303,"/login"                 the configured-device gate                       routes.rs gate                                             b
phases/03-login.ts:154,197,252,253   401,"/",200,/^text\/html/i   the wrong password, then the right one           routes.rs login handler                                    b
phases/04-readonly.ts:25             /^text\/html\s*(;.*)?$/i     every pane's media type                          axum Html responder + assets::mime                         b
phases/04-readonly.ts:60-91          five pane markers            each pane renders ITSELF                         routes.rs maud templates (the exact rendered strings)      b
phases/04-readonly.ts:276,279        "Deactivate the custom UI",  the /builtin escape control and Status pane      routes.rs escape_section() / pane("Status", ..)            b
                                     "<h1>Status</h1>"
phases/04-readonly.ts:167-219        the six fallback rows and     §4.4's traversal guards and §4.2's conditions    serve.rs / asset_path::resolve                             b
                                     their withHtml/withAny        3-5, over the wire
phases/04-readonly.ts:219            "root:","/bin/",":x:0:0:"    signs a real passwd escaped the bundle root      NONE. Signs of a file the fixture is written NOT to        b
                                                                                                                   contain; only a served body can be searched.
phases/04-readonly.ts:726,731        405,"GET, HEAD"              the fallback's method guard and its Allow        serve.rs. openapi.json states no headers, so Allow is      b
                                                                                                                   unstated even for the /api/ routes that carry one.
phases/04-readonly.ts:253-262        the eight POST-only paths    no GET handler exists on any of them             routes.rs:199-200 and the post(..) declarations. A 405     b
                                                                                                                   from a router that HAS the route is the assertion; the
                                                                                                                   declaration list alone cannot make it.
phases/05-mutate.ts:41               "set-transient-password"     the /ssh/password confirm token                  routes.rs:5945 const TRANSIENT_CONFIRM_TOKEN               b
phases/05-mutate.ts:49-52,60         the throwaway ed25519 key,   inputs                                           NONE, and correctly so.                                    b
                                     the transient password
phases/05-mutate.ts:119,183,227,     303 x8, 422                  every pane mutation's answer                     routes.rs form handlers                                    b
  275,331,377,414,452,504,669
phases/05-mutate.ts:64-71            the five console windows and the reconciler and journal lines each POST       NONE. Measured windows on a contended TCG guest.           b
                                     SETTLE_MS                    must produce
phases/05c-kernel-net.ts:37,57-92    "M7-SMOKE:" and the ten      what the in-guest smoke must conclude            guest/m7-net-smoke.sh writes them. The PAIRING is         b
                                     REQUIRED ids                                                                  checkable; the conclusions are the kernel's.
phases/05c-kernel-net.ts:47          180_000                      how long the boot-time smoke may take            NONE. A measured wait.                                     b
phases/06-backoff.ts:21,23           1_000, 300_000               BACKOFF_BASE and BACKOFF_MAX                     auth.rs:13,16 Duration::from_secs(1) / from_secs(300)      b
phases/06-backoff.ts:301             429                          the armed guard's refusal                        routes.rs / auth.rs                                        b
phases/06-backoff.ts:49,52,55        4, 400, 60_000               the phase's own drive-up and probe cadence       NONE. Harness constants.                                   b
phases/07-reboot.ts:270,272          202, 422                     the pane power verbs' accepted and unconfirmed   routes.rs:5856-5860 power_accepted -> StatusCode::ACCEPTED b
                                                                  answers                                          — the /api/v1/actions/reboot 202 in openapi.json is a
                                                                                                                   DIFFERENT route with its own handler.
phases/07-reboot.ts:283-290,         the six shutdown and five    systemd taking the machine down                  NONE. systemd's own console wording.                       b
  293-299                            poweroff console patterns
phases/07-reboot.ts:541,543-545      "/power/reboot" and the      the destructive phase's windows                  routes.rs:199 for the path; the windows are measured.       b
  phases/08-poweroff.ts:30-32        four timeouts
phases/07-reboot.ts:587,620          200                          /power renders, and the machine is still up      routes.rs                                                  b
phases/07b-postreboot.ts:39          2_500                        the floor separating a reset run from a          derived from auth.rs's curve; the MEASUREMENT is the       b
                                                                  preserved one                                    device's.
phases/07b-postreboot.ts:30,40-42    180_000,120_000,150_000,     the second boot's windows                        NONE. Measured on a TCG guest.                             b
                                     60_000
phases/07b-postreboot.ts:179,335     303, 200                     the pre-reboot session refused, /hostname read   routes.rs gate                                             b
```

### 1.3 The non-phase modules

```
site (file:line)      literal                     what it pins                              where else it is stated                                       class
--------------------- --------------------------- ----------------------------------------- ------------------------------------------------------------- -----
client.ts:20          15_000                      the per-request deadline                  NONE. A harness constant.                                     b
client.ts:351         "application/x-www-form-     what a browser posts to a pane form       routes.rs Form<..> extractors. Not an /api/ media type.       b
                      urlencoded"
client.ts:626,738     "Connection: close", 443/80 the raw transport's framing and the        NONE / the listener's own ports.                              b
                                                  scheme defaults
config.ts:41-44       18443,18080,                the harness's OWN defaults, overridable    run.sh's MOS_QEMU_HTTPS_PORT / MOS_QEMU_HTTP_PORT.            b
                      "mos-e2e-admin-pw",         by environment                             Published-port choices, not wire values.
                      "mos-e2e-renamed"
console.ts:16-20,     250,12,300, the CSI and OSC how the serial capture is read             NONE. Reader constants.                                       b
  411-417             escape patterns
report.ts:54          1                           the RESULT JSON's OWN schemaVersion        NONE — and deliberately not mosd's SCHEMA_VERSION (8, at      b
                                                                                             mosd-settings/src/model.rs:11). Same word, different tree.
report.ts:55,56       "    ", 240                 output formatting                          NONE.                                                         b
runner.ts:68,69       78, "  assumes: "           output formatting                          NONE.                                                         b
qemu.ts:41,44,108,    1048576, "::/EFI/mos/       the boot engine's disk and GRUB surgery    os/boards/x64/board.env and the ESP layout. Build inputs,     b
  160-163             grub.cfg", the linux-line                                              not wire values; already covered by the selftest.
                      pattern and the _out paths
main.ts:31-43         the twelve phase ids, in    the run order                              run.sh's BOOT1_PHASES / BOOT2_PHASES. The runner REFUSES an   b
                      order                                                                  unknown id, so this pairing already fails loudly.
fixture/ui-bundle/    index.html, assets/app.js,  what an active bundle serves               Read from the same tree run.sh seeds, by 04-readonly, so      b
                      etc/passwd                                                             the expected bodies cannot drift from the disk.
guest/m7-net-smoke.sh the M7-SMOKE conclusion ids what the guest reports                     phases/05c-kernel-net.ts:57-92 requires them.                 b
```

## 2. The partition, and the rule that produced it

The rule, applied to the WHERE-ELSE column of section 1:

> **(a) MECHANICAL** — a committed artefact states the SAME value in a form a
> program can read and compare: a JSON Pointer into `os/pkgs/mosd/apid/openapi.json`
> resolving to a structural member (a response status key, a response's
> `content` media type, a schema's `required` or `properties` list). Agreement
> is then a lookup, and disagreement is a failure with both values in hand.
>
> **(b) BOOT-ONLY** — everything else. Two sub-cases, counted together because
> the operative clause is the same one (*agreement cannot be asserted at build
> time*), and named separately because their reasons differ:
>
>   - **b-device**: the source of truth IS the running device — timing, console
>     wording, reboot behaviour, what a template actually rendered, whether a
>     405 came from a router that has the route.
>   - **b-unstated**: the value's source of truth is a file, but no committed
>     artefact states the PAIRING the phase pins. Error `code` values are the
>     clearest case: `ApiErrorDetail.code` is documented as *"Stable machine
>     token, from an open set"* with no `enum`, so nothing says which code a
>     given route and status answers. Response headers are the same shape —
>     `openapi.json` carries no `headers` member anywhere in the document
>     (measured: zero occurrences), so `Cache-Control: no-store` and
>     `Allow: GET, HEAD` are unstated per route even where they ship.

**Counts.** Section 1's three tables hold **110 rows**: **38 (a)** and **72
(b)**, of which **10** are b-unstated and 62 b-device. The 38 (a) rows are
exactly the 38 checks section 3 implements — one row, one check, no row without
a check and no check without a row.

Several (b) rows group a list rather than a single literal (the five cookie
attributes, the six fallback rows and both of their status columns, the eight
POST-only paths, the eleven console patterns, the ten M7-SMOKE conclusion ids),
so the literal count on the (b) side is materially higher than 72. It is not
given as a single number here because the grouping is where the reading is: the
five cookie attributes are one decision and one source line, and counting them
as five would overstate the residue as much as counting them as one understates
it.

(a) is small, and that is the finding rather than a shortfall. `openapi.json`
covers `/api/`, and `/api/` is three of the twelve phase files. The other nine
drive the browser surface, the console and the power verbs, and no committed
artefact in this tree states what those answer in a machine-comparable form.
The honest response is a small mechanical slice plus an explicit boundary, not
a wider rule that would let a weaker check call itself coverage.

## 3. The check

`test/apid-api/src/spec-pins.ts`, entered through `test/apid-api/spec-pins.sh`,
wired as `make os-apid-api-spec-pins` and run in `check.yml`'s `os-verify` job
— the job that has docker and deliberately no bun, so the check runs in the bun
pinned by digest as `IMAGE_BUN_1` and its announce line says so.

`os-verify` and not `offline-suites`, for that job's own stated reason: the
container route needs docker and `offline-suites` opens by saying its suites
need neither root nor docker.

**There are exactly two copies of every value and the check asserts they agree.**
The phase's literal is read out of the phase file's own bytes at run time —
never imported, never restated in the table. A row carries only where to read
the phase's copy (an anchor string) and which declaration it must agree with
(path, method, status, schema). So all four directions behave:

```
  openapi.json moves, the phase does not   -> RED (this is the class)
  the phase moves, openapi.json does not   -> RED
  both move together                       -> green, correctly
  the anchored assertion is renamed/deleted-> RED, naming the anchor
```

That last one is deliberate, and it is `docs/verify-index.sh`'s lesson: a check
that silently matches nothing prints the same green as a check that matched and
agreed. An anchor finding 0 sites, or 2, is a hard failure here. So is an empty
pin table, for the reason `run.sh` gives about its own totals.

Schema rows do carry the member names they assert — a third copy — and that is
sound rather than sloppy: the names must be found **in the phase's own source
span** before they are looked up in the document, so a stale name in the table
can only ever produce a false RED.

### 3.1 The green

```
$ make os-apid-api-spec-pins
bash test/apid-api/spec-pins.sh
apid-api spec-pins: 1.4.0 at /srv/bkd/runtime/bun
note: reading /srv/bkd/worktrees/u51kzjlk/aygqxa5s/os/pkgs/mosd/apid/openapi.json
PASS: src/phases/05d-bearer.ts: the bearer settings read pins the status GET /api/v1/settings/{path} declares (200)
...
PASS: src/phases/04-readonly.ts: the envelope's dot-path, declared but not required agrees with components.schemas.ApiErrorDetail (optional: path)
RESULT: PASS (38/38 checks)
```

and in the pinned container, which is the route CI takes:

```
$ MOS_APID_CONTAINER=1 bash test/apid-api/spec-pins.sh
apid-api spec-pins: in oven/bun:1@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 (MOS_APID_CONTAINER=1)
note: reading /w/os/pkgs/mosd/apid/openapi.json
...
RESULT: PASS (38/38 checks)      rc=0
```

### 3.2 The planted red, verbatim

Four plants, one per failure direction. Every one was reverted and the control
re-run green afterwards; the tree was clean before each plant, because
`git checkout -- <file>` discards uncommitted work in the same file.

**Plant 1 — the class itself.** A milestone moves the settings write from 204
to 200 in `openapi.json`; the phase still pins 204.

```
FAIL: src/phases/05d-bearer.ts: the bearer settings write pins the status PUT /api/v1/settings/{path} declares
    src/phases/05d-bearer.ts:256
    pinned:   204   (the literal in the phase file, right now)
    pointer:  /paths/~1api~1v1~1settings~1{path}/put/responses/204
    declared: 200, 400, 401, 404, 405, 409, 422, 500, 503   (what openapi.json says this operation answers)
    read as:  the phase asserts a status openapi.json does not declare for this route.
              Either a milestone moved the shipped status and this phase still pins the
              old one, or the phase was pointed at the wrong route.
FAIL: src/phases/05d-bearer.ts: the settings restore pins the status PUT /api/v1/settings/{path} declares
    src/phases/05d-bearer.ts:276
    pinned:   204   (the literal in the phase file, right now)
    pointer:  /paths/~1api~1v1~1settings~1{path}/put/responses/204
    declared: 200, 400, 401, 404, 405, 409, 422, 500, 503   (what openapi.json says this operation answers)
    read as:  the phase asserts a status openapi.json does not declare for this route.
              Either a milestone moved the shipped status and this phase still pins the
              old one, or the phase was pointed at the wrong route.
RESULT: FAIL (36/38 checks)      rc=1
```

Both sites went red, which is the point: the class does not touch one
assertion.

**Plant 2 — the other direction.** The phase's literal is changed to 200;
`openapi.json` untouched.

```
FAIL: src/phases/05d-bearer.ts: the bearer settings write pins the status PUT /api/v1/settings/{path} declares
    src/phases/05d-bearer.ts:256
    pinned:   200   (the literal in the phase file, right now)
    pointer:  /paths/~1api~1v1~1settings~1{path}/put/responses/200
    declared: 204, 400, 401, 404, 405, 409, 422, 500, 503   (what openapi.json says this operation answers)
    read as:  the phase asserts a status openapi.json does not declare for this route.
              Either a milestone moved the shipped status and this phase still pins the
              old one, or the phase was pointed at the wrong route.
RESULT: FAIL (37/38 checks)      rc=1
```

**Plant 3 — the vacuity guard.** The anchored assertion is reworded, so the row
no longer names a site. It must not go green.

```
FAIL: src/phases/05d-bearer.ts: the bearer settings write pins the status PUT /api/v1/settings/{path} declares
    anchor:   "a settings WRITE over the bearer"
    actual:   no occurrence of the anchor -- the assertion it names was renamed or deleted, so this row reads nothing
RESULT: FAIL (37/38 checks)      rc=1
```

**Plant 4 — a response member.** `notice` is dropped from
`AuthorizedKeyList.required` in the document; the phase still requires it.

```
FAIL: src/phases/05d-bearer.ts: the authorized-keys listing's members agrees with components.schemas.AuthorizedKeyList
    src/phases/05d-bearer.ts:297
    pinned:   "keys", "notice" (required)
    pointer:  /components/schemas/AuthorizedKeyList
    declared: required = [keys]; properties = [keys, notice]
    actual:   notice is not in required
    read as:  the phase asserts a body shape openapi.json no longer declares.
RESULT: FAIL (37/38 checks)      rc=1
```

Control after every revert: `RESULT: PASS (38/38 checks)`, working tree clean.

## 4. The residue: what stays boot-only, worked through once

Everything in section 1 that is not (a). Rather than enumerate it again, here is
one site followed all the way through, because a reader who can follow one can
recognise the rest.

**The phase and the pinned value.** `test/apid-api/src/phases/07-reboot.ts`,
line 270:

```ts
export const POWER_ACCEPTED_STATUS = 202;
/** What an unconfirmed power action is refused with. Measured, same run. */
export const POWER_UNCONFIRMED_STATUS = 422;
```

Its doc comment says where the 202 came from: *"Measured 2026-08-24 against the
live guest. Every other form post in apid answers 303 See Other -- the
post/redirect/get a browser wants -- but /power/reboot and /power/poweroff
answer 202 Accepted."* Two phases assert against it — 07-reboot line 664 for
the reboot and 08-poweroff line 90 for the power-off — and 08 also asserts that
an *unconfirmed* post is answered with something that is not 202.

**Where the shipped value lives.** `os/pkgs/mosd/apid/src/routes.rs`, in
`power_accepted`, which builds `(StatusCode::ACCEPTED, ..)` for both verbs. The
pane routes are declared at routes.rs lines 199-200 as `post(power_reboot)` and
`post(power_poweroff)`.

**Why `openapi.json` does not help.** It declares `POST /api/v1/actions/reboot`
and `POST /api/v1/actions/poweroff`, both answering 202 — which looks like the
same fact and is not. Those are the **API** routes: bearer-authenticated,
no confirm token, added by PLAN-023 M7. `/power/reboot` is the **pane** route:
cookie-authenticated, and it demands a confirm token read off the rendered
form. Two handlers, two authentication paths, two contracts. A build-time check
that compared 07-reboot's 202 against `/api/v1/actions/reboot`'s 202 would be
asserting agreement between two values that are free to differ, and it would
stay green through exactly the change it was built to catch.

**The milestone-shaped change that outruns it.** Suppose a milestone rules that
the pane's power verbs should answer 303 to `/power?queued=1` — so an operator's
browser lands on a page saying the machine is going down, instead of on a bare
202 with an empty body. It is a small change: one `power_accepted` in routes.rs,
its doc comment, apid's own in-process tests in `os/pkgs/mosd/apid/src/tests.rs`
(which already post `confirm=reboot` to `/power/reboot`), and
`docs/design/api.md`'s pane section.

**The exact point at which nothing fails.** That change touches no `/api/v1/`
route, so `openapi.json` does not move — the "committed OpenAPI document is what
the shipped flag prints" step in check.yml stays green, and so does the oasdiff
contract check, correctly, because no API contract changed. `cargo nextest`
stays green: the in-process tests were updated with the handler, which is what a
careful author does. `make os-apid-api-spec-pins` stays green: 202 is not one of
its 38 rows and cannot be, for the reason above. `docs/verify-citations.sh` and
`docs/verify-index.sh` stay green: the citation into routes.rs is re-anchored
with the edit. **Every gate in this repository is green, and
`POWER_ACCEPTED_STATUS = 202` is now wrong.**

**What it costs.** Nothing, until someone boots the image. Then 07-reboot's
`POST /power/reboot carrying the page's own confirm token is accepted (202)`
goes red against a 303 — and reads as a *reboot failure*, the most alarming
result the suite can produce, on a machine that rebooted perfectly. 08-poweroff
then goes red the same way, and its unconfirmed-post check goes green for the
wrong reason: 303 is not 202, so "an unconfirmed POST is not answered as an
accepted power action" passes while the constant it compares against no longer
names acceptance at all. Worse, 07-reboot's `isGateRedirect` check now has real
work to do: a 303 to `/power?queued=1` and the auth gate's 303 to `/login` are
the same status, and the assertion that tells them apart was written when the
success case was not a redirect at all.

**The exact run that would have caught it.**

```
MOS_BOARD=x64 bash os/rootfs/build-v2.sh && bash os/build/run.sh --mkimage-x64
make os-apid-api-test
```

The image build is the long pole; the suite itself the README measures at about
four minutes end to end — two boots, twelve phases, an argon2 hash behind every
login. Both need docker and the second needs a built x64 artefact. Nothing
shorter observes it, because the value only exists on the wire of a running
daemon.

**Why this is not closed by writing more checks.** The pane surface has no
committed machine-readable contract to compare against. One could be written —
an `openapi.json` for `/`, or a table of pane routes and statuses generated from
routes.rs — but that is a new contract artefact and a new generator, which is
PLAN-023/026/027 territory and not this milestone's. What this milestone can
honestly leave behind is the boundary, stated where a reader of the harness will
meet it: `src/spec-pins.ts`'s header names what is out of scope and why, and
`check.yml`'s "What this job does not cover" step now says out loud that
`make os-apid-api-test` runs nowhere in CI and that every device-truth assertion
is checked by a booted run or not at all.

The same walk applies, unchanged in shape, to: the five session-cookie
attributes against session.rs (a rename to `SameSite=Strict` breaks no gate and
is invisible until boot); the backoff curve against auth.rs (a `BACKOFF_BASE`
moved to 2s makes 03-login's one-second wait race, intermittently, only under a
boot); the five pane markers against routes.rs's templates (a reworded legend
turns "the pane rendered ITSELF" red); and every console pattern in 05c, 07 and
08 (systemd's wording is not this repository's to state).

## 5. The milestone's boundary, stated

**In.** An inventory of every pinned literal under `test/apid-api/src/` with its
site, what it pins and where else the tree states it. A partition by whether
agreement is assertable without a boot. A build-time check over the 38 that are,
wired into the Makefile and CI, failing loudly on both directions of drift and
on its own vacuity, proved by four planted reds. The residue written down with
one worked example.

**Out, deliberately.** No boot tooling. No change to `run.sh`, to any phase
file, or to any `os/` or `pkgs/` source — so no design-document citation moved
and no re-anchoring pass was needed. No new contract artefact for the pane
surface. No widening of the mechanical rule to let a presence-grep call itself
an agreement check.

**What a reader should not conclude.** A green `make os-apid-api-spec-pins` does
not mean the phases are current. It means 38 literals agree with `openapi.json`.
The rest of the class is open, is written down in section 4, and closes only
under a booted run.

## 6. Files

- `test/apid-api/src/spec-pins.ts` — the checker and its pin table (new)
- `test/apid-api/spec-pins.sh` — host bun or the pinned `IMAGE_BUN_1` container (new)
- `test/apid-api/package.json` — the `spec-pins` script
- `test/apid-api/README.md` — the no-boot section names it
- `Makefile` — `os-apid-api-spec-pins`
- `.github/workflows/check.yml` — the step, and the scope statement it widens
- `docs/task/RFCT-259.md`, `docs/task/index.md` — this record

## 7. Gates

```
$ bash docs/verify-citations.sh
docs/verify-citations.sh: 2170/2170 PASS

$ bash docs/verify-index.sh
docs/verify-index.sh: 863/863 PASS

$ cd test/apid-api && bun run typecheck
$ cd test/apid-api && bun run selftest
RESULT: PASS (47/47 checks)

$ make os-apid-api-spec-pins
RESULT: PASS (38/38 checks)
```
