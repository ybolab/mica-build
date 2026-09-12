# 20260910-1910-fleet-device-plane-protocol Fleet device-to-plane protocol

- **status**: completed
- **createdAt**: 2026-09-10 19:10
- **approvedAt**: 2026-09-10 19:10
- **relatedTask**: 20260910-1910-fleet-device-plane-protocol

## Context

This is the authorized DESIGN artifact, not shipped functionality or permission
to implement or deploy. All proposed wire contracts below are normative for a
future v1 implementation. The user authorized choosing the missing protocol;
an external plane repository is not a prerequisite for completing this design.
No compatibility reader, version negotiation or migration is required.

Evidence was read at exact reviewed local L2
`e03686e0a1225c5bb1d4a2a082ced4574d160af8`, fast-forwarded into the initially
clean isolated branch `bkd/bvjc311u`. That commit contains reviewed C2
`da7d672533a347ba5ef87e7a5bec4a8aa00ea581`, D5
`8bdc375cc34116d1293f2ee4074bd486e184a434`, and approved #313
`5d0dca577a782aa707d9530779c4b23f2a7eda31`. File paths below refer to those
immutable bytes, not another worktree's uncommitted implementation.

Repair 1 separately synchronized reviewed local L2
`f30e2492a4f4a0d29f91f13d02abbcc2f92c093a` (tree
`64c7c9be5ea9fd470de79ac4b658374d696488a2`) into clean `ea4a8dca` as merge
`e0c43478f84cb2d43ddda197d7c59b063655da99`. Only mechanical index append
conflicts required resolution; all existing rows/statuses were preserved.
This sync includes D2, D1 and C.D3, but still no FLEET-CONFIG implementation.
It does not replace the original evidence baseline in the following table.

| Evidence at that commit | Consequence |
|---|---|
| C2 brief (20260910-1012-c-fleet-app-trust-obligations), [PLAN-072](PLAN-072.md) sections 3, 7a, 8; [PLAN-076](PLAN-076.md) sections 2, 5–9 | Off/null, outbound only, TOFU, registration and report allowlists, autonomy and separate reporting consent remain binding. The historical 65-row audit is not reopened. |
| [configuration.rs](../../pkgs/mosd/mosd-settings/src/configuration.rs), `BakedFleet`, `code_defaults`, `provisioning_status_at` | Off/null exists. Fleet projection is still baked-only at this HEAD. Separately authorized FLEET-CONFIG `r3suq4rc` is **not merged here**; do not claim its resolver delivered. |
| [provisioning_api.rs](../../pkgs/mosd/apid/src/provisioning_api.rs), `api_v1_provisioning_status`; [route tests](../../pkgs/mosd/apid/src/tests/provisioning_api.rs) | D5's authenticated local projection and updates precedence/redaction are delivered. It contains no enrollment/network activity. |
| [routes.rs](../../pkgs/mosd/apid/src/routes.rs), `ApiCredential`, `api_v1_system_info`, `api_v1_reset`; [reset API tests](../../pkgs/mosd/apid/src/tests/reset.rs) | LAN bearer/session plus CSRF and reset physical presence are local authority, never plane operator authority. System info delegates to the local bus. |
| [provisioning](../design/provisioning.md), [identity.rs](../../pkgs/mosd/mosd/src/identity.rs), [provisioning.rs](../../pkgs/mosd/mosd/src/provisioning.rs) | The existing identity is 16 random bytes represented by 32 lowercase hex digits. No hardware attestation or fleet PKI exists. `seededGeneration` is a seeding-rule version, not a reset counter. |
| [recovery](../design/recovery.md) section 2, [reset.rs](../../pkgs/mosd/mosd/src/reset.rs), `apply_pending`, `reseeded_settings`, factory survivor tests | All three reset tiers preserve device identity and per-device secrets. Full factory reset clears managed `/mos`, not all STATE. Whole-disk reflash replaces identity. Older provisioning prose equating reset with a STATE wipe does not override this actual contract. |
| [storage](../design/storage.md), [time](../design/time.md), [security lifecycle](../design/security-lifecycle.md) | DATA/state and DATA/meta are separate; wall-clock floor is not trusted current time. No OS signing key may become a device credential. |
| [telemetry.rs](../../pkgs/mosd/mosd/src/telemetry.rs), [storage_status.rs](../../pkgs/mosd/mosd/src/storage_status.rs), [update_codes.rs](../../pkgs/mosd/mosd/src/update_codes.rs) | Existing source enums and limits are usable inputs; a fleet producer does not exist. Closed native update error codes now exist; their mapping to this projection still needs implementation. |

## Proposal

### N1. Scope, threat model and protocol choices

Preserve local autonomy even with a hostile, unavailable or misconfigured plane.
Assume an on-path attacker, recorded/replayed requests, competing enrollments,
compromised individual device credentials, accidental clock rollback, and
crashes at persistence boundaries. A stolen device/root can extract its own
STATE keys; this contract is not hardware attestation or disk anti-rollback.
A visible `deviceId` authenticates nothing. First enrollment proves possession
of a newly generated signing key and claims the first-writer slot; it cannot
prove manufacturing provenance, physical ownership or tenant membership.
A wrong first writer can deny inventory, never obtain local device control.

Use TLS 1.3 with normal hostname/chain/time validation against the immutable
image's OS TLS CA bundle. No fleet-selected CA, certificate exception, mutable
fleet trust store, redirect, proxy auto-discovery, HTTP fallback, client TLS
certificate or TLS 0-RTT. A configured private deployment must supply its TLS
trust through a separately approved image build; this design installs nothing.
TLS authenticates responses and protects inventory confidentiality. Ed25519
request signatures prove private-key possession without transmitting reusable
bearer secrets; counters/CAS provide application replay protection. No fleet
CA, response-signing key hierarchy or generic signed-command infrastructure is
needed. OS boot/update signing keys, LAN login/session keys, SSH keys and AP
secrets are never inputs to this protocol.

All URLs below are paths relative to a configured HTTPS **origin**, not an
assertion that a service exists. Example `https://plane.example` is a reserved
placeholder. Origin normalization: parse HTTPS; lowercase ASCII DNS name,
remove explicit port 443; otherwise retain numeric port 1–65535; canonicalize
IP literals using the URL parser, bracket IPv6; no credentials, query,
fragment, non-root path, trailing DNS dot, Unicode hostname or zone identifier.
A root slash is removed. The future client refuses a configured URL that is
not such an origin, even if the local resolver accepts a broader HTTPS URL.
Use the configured origin, never untrusted forwarded headers, for signature
verification. Distinct configured origins are distinct enrollment authorities.

### N2. Wire framing and exact schemas

The normative machine-readable schema is
[protocol.schema.json](../../tests/fleet-protocol/protocol.schema.json).
Its named `$defs` are the exact request/response schemas. All use only current
`mos/fleet/v1`; reports retain numeric `schemaVersion: 1` as their own allowlist
tag. Every HTTP request and response has `Fleet-Schema: mos/fleet/v1`.
Registration's body has **exactly** `deviceId`, `board`, `profile`, `version`,
`product` (`vendor`, `model`): auth/framing fields stay in headers. Reports are
a top-level JSON array. New device telemetry fields are not added by auth.

POST only; exact case-sensitive paths in N4; no query string, percent-encoded
path aliases, trailing slash or method override. HTTP/1.1 or HTTP/2 framing
must reject conflicting lengths, duplicated singleton headers and ambiguous
transfer framing before JSON/auth. `Content-Type: application/json` exactly,
`Accept: application/json`, `Content-Length` required and exact; no content
encoding, trailers or compression. HTTP/1.1 requests use origin-form and one
matching Host; HTTP/2 authority/scheme must match the configured origin. No
cookies, bearer Authorization, redirects, content negotiation or ambient proxy
credentials. HTTP/1.1 chunked requests/responses are outside this profile.

`$defs.headers` describes **all allowed ordinary request headers**, using
canonical display names after case-insensitive duplicate refusal and name
normalization. It is not a subset that drops transport headers. Host is
required for HTTP/1.1 and equals the normalized origin's authority (including
a non-default port); User-Agent and Connection are optional, never null.
Connection is permitted only in HTTP/1.1 requests/responses. HTTP/2 uses
exactly one each of `:method`, `:scheme`, `:authority`, `:path`, before ordinary
fields; method/path equal the signed values, scheme is `https`, and authority
equals the configured origin's authority. This profile omits Host in HTTP/2;
that is a profile restriction, not an RFC prohibition of matching Host.
HTTP/2 names are lowercase; Connection is forbidden by HTTP/2 itself.

The fixture `httpVersion` is transport metadata, not an HTTP/2 wire field or
a negotiated fleet version. `requestShape` checks the complete decoded request
envelope: all ordinary fields against `$defs.headers`, HTTP/1.1 Host or the
four HTTP/2 `pseudoHeaders` pairs, bounds and N3/N4 bindings. Pseudo-headers
are separate control data, not unknown ordinary headers. A real decoder must
reject duplicates and invalid pseudo-header order before producing this
representation; it must never coalesce singleton fields first. The LF fixture
adapter tests decoded pairs only, not real CRLF/framing, HPACK, stream ordering
or TLS. Those remain explicit N9 runtime/interop gates.

JSON is UTF-8 without BOM, maximum depth 12, with no trailing bytes except JSON
whitespace. Reject duplicate decoded member names at **every object depth**
(including escaped spelling aliases), unknown members, non-finite numbers,
unpaired surrogates, invalid UTF-8 and wrong types **before** authorization or
state changes. Schema validation is not authentication. Schema validates the
closed shape; N3–N8 add crypto, role, binding, cross-field and state checks.
Every JSON body property is required except `update.lastFailureCode`; only explicit
schema null unions permit null. Unknown telemetry remains null/unknown as
specified, never invented healthy zeroes. Protocol counters are unsigned
64-bit values represented as canonical decimal **strings** `0` or `[1-9][0-9]*`,
maximum `18446744073709551615`; reports start at `1`. No floating JSON counter,
leading zero, signed number, exponent or wrap. Timestamps are integer Unix
seconds (0–253402300799), or null only for unknown `capturedAt`.

Bounds, including UTF-8 bytes rather than character estimates:

| Object | Bound |
|---|---|
| Header block | 8,192 bytes, 32 fields; individual value 512 bytes |
| Lifecycle request/response, error or ownership response | 4,096 bytes |
| One report encoded as compact canonical JSON | 16,384 bytes |
| Report POST array | 1–16 reports; 65,536 total raw body bytes |
| Report acknowledgement | 4,096 bytes; exactly one receipt per submitted counter |
| Request duration | 20 seconds total including DNS/TCP/TLS/body, connection setup at most 10 seconds |

For HTTP/1.1 the header byte bound counts field-name/value bytes, `: ` and CRLF
per field plus the final CRLF. For HTTP/2 it counts the decoded field section,
name/value bytes plus 32 bytes per field, including pseudo-headers; the same
32-field and 512-byte value caps include pseudo-headers. Future transports
must enforce these while reading/decoding, not after unbounded buffering.

Unknown headers, duplicates and malformed values fail closed. Besides the
N3 headers, requests allow only Host (HTTP/1.1), User-Agent (`mos-fleet/1`),
Connection (HTTP/1.1 `keep-alive` or `close`), Content-Type, Accept and Content-Length.
Responses allow only Fleet-Schema, Content-Type, Content-Length, Cache-Control,
Date, Retry-After, Connection (HTTP/1.1), Server and WWW-Authenticate. Server is bounded
opaque transport metadata, never reflected into status. A 401 additionally
requires `WWW-Authenticate: FleetEd25519 realm="mos/fleet/v1"`; no other
authentication scheme is supported. `Location`, `Set-Cookie`, any command/config
header or header outside this list fails closed. Server responses use
`Cache-Control: no-store`;
clients have no response cache. Error text is a closed code, never reflected
input. Transport libraries must enforce header/body bounds while reading.

### N3. Request authentication and operator authority

Requests carry these singleton headers (lowercase matching of header names,
exact values). All are required; schema and semantic checks also apply:

| Header | Value |
|---|---|
| `Fleet-Schema` | `mos/fleet/v1` |
| `Fleet-Role` | `enroll`, `device` or `operator` |
| `Fleet-Device` | 32 lowercase hex `deviceId`, identical to every body deviceId |
| `Fleet-Epoch` | 32 lowercase hex, random local enrollment/reset epoch; operator uses 32 zeroes |
| `Fleet-Generation` | u64 string; enroll and ownership read use `0`; other operations use expected server ownership generation |
| `Fleet-Key` | 64 lowercase hex, raw 32-byte Ed25519 public key |
| `Fleet-Request` | 32 lowercase hex random request ID; reused only for exact logical retries |
| `Fleet-Time` | device/enroll `0`; operator Unix seconds in canonical decimal |
| `Fleet-Signature` | 128 lowercase hex, raw 64-byte Ed25519 signature |

Sign exactly these ASCII lines, each terminated with LF (including the last):

```text
mos-fleet-request/1
POST
<normalized-origin>
<exact-relative-path>
application/json
<role>
<deviceId>
<epoch>
<generation>
<publicKey>
<requestId>
<time>
<lowercase-sha256-of-exact-raw-body-bytes>
```

Angle-bracket lines are substitutions, not literal wire data. Use pure Ed25519
(RFC 8032), not Ed25519ph/ctx and not an unlabelled signature over JSON alone.
Require canonical point/signature encodings, `S < L`, and reject small-order
public keys/R and invalid verification; use a vetted strict verifier. Payload
hashing uses SHA-256. The digest binds the entire array and every auth target;
changing whitespace requires re-signing. No JSON canonicalization is needed
for the request signature. Renewal additionally carries `Fleet-Next-Signature`
from the proposed new key over the **same signed bytes**, proving possession
before activation; this header exists only on renewal. Request ID and counter
are replay identities, not entropy-based authentication.

Device authorization is a lookup on `(configured origin, deviceId)` followed
by an exact match of active ownership generation, local epoch and activated
public key, its validity interval and revocation state **inside the same
transaction as the mutation**. Do not accept a signature merely because it
matches the key the caller supplied. Enrollment is the sole first-writer
exception. No endpoint lets a device list/read reports, inspect an owner,
release a conflict, renew or revoke a key for another device. Device-role use
of operator routes is always 403. An attacker guessing another ID gets no
owner/key/data projection; a competing enrollment gets only `claim_conflict`.

Operator authority is concrete but belongs on the plane. Its operator key
registry is provisioned by the plane's deployment administrator outside this
protocol, independent of device registration. Each record requires
`principalId` (nonempty ASCII max 64), `publicKey`, `audience` (exact normalized
origin), `notBefore`, `expiresAt`, `revoked`, `scopes` from exactly
`fleet:ownership:read`, `fleet:ownership:release`, `fleet:credential:revoke`,
and an explicit set of at most 4096 device IDs the principal may operate on.
The public registry record is at most 256 KiB; scope entries must be unique.
No wildcard or device-created operator record. The server verifies signature, live record,
audience, validity, scope **and target ID membership** on each request and again
at transaction commit. A federation adapter may later populate this registry;
a JWT name, tenant role string or LAN bearer alone conveys no authority here.

Operator signed time must be within 300 seconds behind / 30 seconds ahead of
server time. Keep request IDs plus digest/result for 600 seconds, maximum
64 per principal; reject excess with 429. Same ID+same body/headers returns
original result within that window; different content is `request_conflict`.
After expiry the time check prevents replay. Freshly re-signed release retries
use a fresh Fleet-Request and retain the durable releaseId in N5. A disabled principal cannot replay
an old authorization. Enrollment/device requests do not need clock freshness;
their exact generation, ownership state and durable idempotency checks bound
replay. No auth success is inferred from JSON schema validation.

### N4. Endpoint inventory and worked exchanges

Paths are all relative to the origin. `D` below is the exact Fleet-Device value.
All successful responses echo `schema`, `requestId`, `deviceId`; clients require
all three to match their pending request. Responses additionally bind
`generation` and `epoch` where the schema names them. Only the status listed
is success; an empty 204 or arbitrary 2xx is a malformed response.

| Operation and path (all POST) | Role | Request `$defs` | Success `$defs` / HTTP | Effect |
|---|---|---|---|---|
| `/v1/fleet/register` | enroll | `register` | `registered` / 200 | First-writer activation or exact pending registration retry only |
| `/v1/fleet/devices/D/renew` | device | `renew` | `renewed` / 200 | Activate new key with bounded old-key overlap |
| `/v1/fleet/devices/D/unregister` | device | `empty` (`{}`) | `unregistered` / 200 | Close own enrollment; no anonymous reopening |
| `/v1/fleet/devices/D/revoke` | device | `empty` | `revoked` / 200 | Revoke all keys of own generation |
| `/v1/fleet/devices/D/reports` | device | `reports` | `accepted` / 200 | Atomic whole-batch acceptance/dedup |
| `/v1/fleet/operator/devices/D/ownership` | operator + ownership:read | `empty` | `ownership` / 200 | Read only generation, state and binding, never payload or secret |
| `/v1/fleet/operator/devices/D/release` | operator + ownership:release | `release` | `released` / 200 | CAS invalidate old claim and reserve next claim for verified local key/epoch |
| `/v1/fleet/operator/devices/D/revoke` | operator + credential:revoke | `empty` | `revoked` / 200 | CAS revoke target generation; no reassignment |

[exchanges.json](../../tests/fleet-protocol/exchanges.json) is the worked
request/response set, including header inputs, example body identities and
expected schema/semantic checks. Its public keys and signature placeholders
are **not working credentials**. The runner signs in-memory ephemeral keys
for separate byte-binding tests and never stores a private key. Every operation
above has a positive shape control and matching response; negative fixtures
name the normative section being exercised.

Registration returns `generation`, `epoch`, `publicKey`, `issuedAt`, `expiresAt`.
It activates the device-generated key for 30 days (2,592,000 seconds). The
credential is that server binding plus the local private seed, not a bearer
issued over the wire. No secrets, configuration or update hint are returned.
Report success returns `generation`, `epoch`, `accepted` array of
`{counter,digest}` exactly matching the submitted sorted counters and stable
record digests from N7. It contains no high-water hint, remote cadence, commands
or optional extensions. `Retry-After` is only an HTTP scheduling hint on
429/5xx, with N8's bounded interpretation.

### N5. Ownership, collisions and credential lifecycle

The plane stores one authoritative row per `(origin, deviceId)`: monotonically
increasing ownership generation G, state `active|reserved|unregistered|revoked`,
local epoch, current public key and validity, optional prior overlap key,
registration receipt, last renewal receipt and last terminal/release receipt.
A missing row is distinct from a released row. Each origin assigns new IDs to
its server-configured inventory realm; device input never selects a tenant.
Only that origin's explicit operator grants expose inventory. Tenant transfer
and general inventory APIs are future and outside this contract.

First registration locks/inserts the device row. If absent, activate G=1 and
persist the exact registration request identity/digest/result. A concurrent
loser with another key/epoch gets 409 `claim_conflict`. An exact retry with the
same enrollment key/epoch/request/body returns the original issuance while
that key is current, valid and the generation is still active; it does not
extend expiry or change product fields. A different registration request,
including changed labels, requires explicit local reenrollment and operator
release rather than an unauthenticated update. A reserved row accepts **only**
the reserved key/epoch with valid possession signature and activates the
already allocated generation; no other key can race into the released slot.
A closed/revoked row never becomes absent because it aged out.

A collision is visible locally as `claim_conflict`, with effective origin,
deviceId, attempted epoch and public-key fingerprint (no credential bytes).
The privileged operator independently authenticates the local administrator
through the existing LAN management/presence workflow or an equivalent verified
physical service visit, obtains the **candidate** epoch/public key from the
future authenticated local status surface, and verifies deviceId and origin
against that device. A label, screenshot supplied by an unknown party or
knowledge of deviceId alone is insufficient possession evidence. The operator
then reads the plane ownership generation and signs release with that expected
G, candidate epoch/key and random `releaseId`. The authorization audit records
principal, deviceId, old/new generation, releaseId and `reason: wrong-claim`
or `reason: local-reenrollment`; it never treats the reason as proof.

Release atomically verifies scope/target, compares expected G, increments to
G+1 (refuse exhaustion), revokes both old keys, closes old report acceptance,
and reserves the candidate binding. It retains high-water H and receipts per
N7 but exposes no old telemetry to the new enrollment. An exact retry of the
last releaseId, expected G and candidate returns its original G+1 receipt
even after candidate activation, without changing state again; a changed body
with the same ID is 409. An intervening release/terminal transition returns
409 `generation_conflict`; it cannot release the current owner by replaying
an old command. Reservation never expires into an anonymous slot; an operator
can CAS replace it. Reuse of the current or prior overlap key/epoch as the
replacement is refused. First-writer TOFU remains the default for **new IDs**;
operator recovery does not pretend to retroactively authenticate first use.

Renewal request is exactly `{nextPublicKey}`; old key signs N3 bytes and new
key signs the same bytes. Both keys remain bound to the same D/G/epoch. Only
the current key may start renewal; a key equal to current/previous is refused.
At commit T, new key becomes current with expiry T+2,592,000; old key can
report until min(old expiry,T+600), and can replay **only that exact renewal**
while the new key is still current. The stored renewal receipt includes both
public keys, request digest and result. An exact retry signed by the old key
may recover that receipt until the new key expires, even after the 600-second
report overlap, provided the generation has not been revoked/released. This
special permission discloses public issuance metadata only and cannot start a
second renewal. A fresh renewal is allowed no earlier than 24 hours after the
current issuance; default device renewal is at issuance+23 days. Persist the
new seed plus pending request before transmission, then atomically promote on
valid response. A restart with pending renewal repeats it; no lost-response
path destroys the only usable new seed. Never renew on a report response.

Unregister and either revocation path close the entire generation immediately
and revoke both keys; unregister leaves a closed inventory marker, revoke
leaves an explicit security refusal. A terminal commit invalidates the current
release receipt, so replay cannot claim release success after a later terminal
decision. Same terminal operation/request retry
returns the retained result only for that closed generation and signing key;
this exception never permits reporting/renewal. A different terminal request
against already closed state returns `credential_revoked`; a newer generation
returns `generation_conflict`. Device revoke has no key selector: it cannot
revoke an unrelated key. Operator revoke uses the current expected G and its
own authority, not a device signature. Expiry never frees ownership. An
expired client requires local reenrollment plus operator release; no automatic
TOFU fallthrough or fallback credential exists.

All report, renewal, terminal and release transactions serialize on the same
D row and check authorization at their linearization point. If report commit
wins, its historical receipt is valid; if revoke/release wins, the report
mutates nothing. If renewal wins, previous-key reports obey overlap at their
own commit time; previous-key fresh renewals fail. Device processing of any
response is also fenced by its still-current local epoch/pending request.
An old response may not resurrect state after a local off/reset/rebind.

### N6. Device persistence, reset and single ownership

All paths here are FUTURE, absent, service-owned state. The future non-root
`fleetd` executable owns its files, either as its daemon or its bounded
**network-free lifecycle mode** invoked by the local reconciler. It is the only
normal writer; mosd owns desired config/identity and calls it without reading
credentials. apid reads only the bounded status projection as root. No generic
buffer library, database, orphan daemon or new installed unit is delivered here.

| Path | Owner and content | Bound/reset |
|---|---|---|
| `/var/lib/mos/fleet/credential.json` (DATA/state bind) | `fleetd:fleetd`, private Ed25519 seed (32 bytes as hex), origin/D/G/epoch, validity, optional pending new seed/request and prior public metadata | directory 0700, file 0600, 8 KiB; at most current+pending secret; off/rebind/factory invalidates and unlinks |
| `/var/lib/mos/fleet/counters.json` | same owner; D and reservedThrough only | 1 KiB; preserved across all reset tiers and URL/off transitions, never rewound |
| `/mos/fleet/epoch.json` | same owner; random 128-bit epoch, normalized origin, D | 1 KiB; required equality with credential before every request; full factory sweep removes it |
| `/mos/fleet/queue.log` and temporary compaction file | same owner; framed append journal of complete reports and local drop/ack/retry records | live report bound 128/1 MiB; log 2 MiB, temporary compaction at most 2 MiB; file 0600 |
| `/mos/fleet/status.json` | same owner; durable secret-free status snapshot, written only with an already required lifecycle/queue/reservation update | 8 KiB, 0600; contains state/error classes, public binding fingerprint, times, queue/gap counts, schema, not seeds/signatures/raw failures |
| `/run/mos-fleet/status.json` | same owner; live tmpfs status for apid while the daemon runs | directory 0700, file 0600, 8 KiB; cleared on stop/reboot; no flash write per successful report |

No quota is installed on `/mos`, `/srv` or `/mos/containers`. Total fleet-owned
file-content budget is at most 4 MiB of logs including simultaneous compaction,
plus 64 KiB metadata/temp space; strict writer admission enforces that bound.
Filesystem block/inode overhead is additional and bounded by the fixed file
count; this is a service writer budget, not a filesystem quota.
The live tmpfs projection preserves accurate last-send visibility without
contradicting PLAN-076's steady-state flash policy. apid reads live status only
for the current local epoch and a running client; otherwise it labels the
durable snapshot by its observation time and projects off from desired state.
No successful volatile report forces a DATA status write.
Directory entries are fixed above, with at most one `.tmp` per metadata target
and one compaction target. Never write SYSTEM or DATA/meta, and never traverse
container binds. Status write failure cannot gate local management.

Serialize the daemon/lifecycle mode with an exclusive open-file lock on the
fleet STATE directory. No process may sign while lifecycle mode invalidates.
Secret creation uses CSPRNG, umask 077, `O_NOFOLLOW|O_EXCL`, verified regular
file/owner/mode and no hard links. Metadata replace: write same-directory temp,
fsync file, rename, fsync parent; publish memory only after durable commit.
Reject corrupt state and stop fleet locally, never regenerate counters under
the same D. A directory/permission/fsync failure disables fleet only.
For credential pending/promote both phases use one atomic credential file;
never split seed and activation metadata into separately committed files.

Boot order: mosd completes existing reset/import/identity reconciliation;
lifecycle mode resolves desired settings and compares D/origin/epoch before
starting any outbound client. For full factory reset, invoke invalidation
before clearing the existing reset intent, after reset preflight succeeds;
its replay is idempotent and network-free. The missing `/mos/fleet/epoch.json`
also fences a preserved STATE credential after interruption. Configuration
reset preserves credentials only when the resulting enabled/origin binding
is unchanged; application-data reset does not touch fleet state. Full factory
preserves deviceId but discards this **new fleet credential**, queue, epoch and
retry state, while retaining the counter reservation. Existing local identity,
calibration, passwords, META and deployment records keep their current reset
contract. These hooks are required future work, not claims about today's reset. A failed
fleet cleanup cannot widen or indefinitely delay a local reset: after its
bounded attempt, keep the fleet unit stopped; the normal full-factory sweep
removes the epoch marker, and startup must finish invalidation before any
fleet I/O. Existing reset I/O failure rules still apply to the reset itself.

Off is immediately authoritative: cancel I/O, stop timers/daemon, zero in-memory
seeds, invalidate and unlink credential, clear live status and erase the owned
queue/epoch.
No DNS, connection or retry is allowed once effective off has committed. The
historical best-effort unregister is permitted **only if a locally initiated
disable/rebind can send it once on an already established old-origin connection
before the off fence**, without waiting for a response (maximum 1 second send
budget). Otherwise skip it. This explicitly resolves the old "off means no
network"/"try goodbye" tension in favor of no off-state traffic. Local completion
never waits for plane acceptance. Re-enable generates a fresh key/epoch;
existing plane ownership may require the release procedure. URL rebind follows
this same sequence and never sends old credentials or buffered telemetry to
the new origin, including A→B→A. Reporting-off while registration remains on
clears the queue locally, stops capture/send timers, retains credential and
permits its explicit renewal. Reporting-on restarts capture with reserved
counters; queued data is not silently sent after consent was withdrawn.

An offline reset cannot notify the old plane or invalidate a stolen copy there
instantaneously. Old-plane revocation/release or expiry is required to stop that
copy; state this limit honestly. On-device old credentials cannot cross a
reset/origin boundary; on-plane old credentials cannot cross a committed server
generation. A rollback of all device storage by a physical owner is outside
the threat model; H/CAS still refuse reused counters/generations. Server disaster
recovery must restore authorization and dedup together; an uncertain rollback
must refuse writes and require operator recovery, not reset H to zero.

### N7. Reports, durable acceptance and crash traces

The exact PLAN-076 leaves are preserved in `$defs.report`. Structural resolution
of its mixed `health[]`/`health.unknownComponents` notation is
`health:{components:[{component,status}],unknownComponents}`. `component` is a
fixed enum selector for the approved status array, not dynamic telemetry.
Report schema uses only fixed keys. Registration repeats no serial/MAC and
reports repeat only `version`, not board/profile/product. No source names,
addresses, hostname, free-text error, journal, diagnostic snapshot or application
field can pass. `lastFailureCode` is the sole optional leaf, omitted when no
closed source mapping exists; never substitute raw `last_error` text.

Current native deployment facts are read through `GetUpdateState` in
[bus.rs](../../pkgs/mosd/mosd/src/bus.rs), backed by
[deployment.rs](../../pkgs/mosd/mosd/src/deployment.rs) and
[the current deployment contract](../design/updates.md). There are no legacy
raw-slot identities. V1 preserves the approved leaf names `bootedSlot` and
`primary` but requires **null** for both; it never manufactures A/B slot
labels or restores a legacy reader. `pendingNotConfirmed` is true exactly when
validated native `state.candidate` is non-null, false when it is null, null
when native status is unavailable. `lastOperation` maps a recognized native
operation to the schema enum (unmapped is unknown); lastResult maps native
`running/done/failed/refused` to `running/succeeded/failed/refused`, absent to
none, other states to unknown. No native deployment IDs or new fields are
added to the allowlist. A richer native projection needs an explicit later
allowlist/version decision.

Initial fixed health components are `mosd`, `connd`, `apid`, `update`, in that
order; producer emits each once, with `unknown` for absent/unmapped states and
counts all other source components. Health states are `ok|degraded|failed|unknown`;
only exact recognized source states map, all other text maps to `unknown`.
Storage tiers are `esp,firmware,system,data` in that order, each once. Absent
tiers retain `present:false,mounted:false,usedPercent:null,pressure:null`.
Media array covers observed eMMC media only, at most 4, sorted by sanitized
model then numeric wear values; unsupported values null, never a raw sysfs
reason. `model` is printable ASCII up to 64 bytes, checked against the source
redaction denylist/scrub; if not safely representable use null, not truncation.
`usedPercent` is floor of observed percent, 0–100; media maximum wear is 0–110
(110 represents JEDEC's beyond-estimate bucket), or null. Unknown source
counts are null for pstore/failures; health.unknownComponents counts observed
unmapped keys. Interfaces use null carrier/online when not observed. An
unavailable time source yields synchronized=false,stratum=null. No healthy
result is inferred from source absence.

Thermal array is at most 32 source readings, ordered zones then hwmon in the
source's stable enumeration. Wire label is fixed `zone-00`…`zone-31` or
`hwmon-00`…`hwmon-31`, not a driver/free-text label; no new site identifier.
Min/max/last are integers in milli-Celsius [-273150,1000000], with
min<=last<=max; unavailable triples are all null. Sampling is local every 10
seconds while reporting is enabled; reset each window only on creating a
report. Window capture is still coalesced at the approved >=60-second floor.
Watchdog uses `active|inactive|unknown`, nullable nowayout, and only the eight
fixed source flags; pstore and failures carry counts only. `reset.reason` is
`watchdog|kernel-crash|unknown`. `time.stratum` is null or 0–16. Interfaces
contain exactly kind/carrierUp/online, at most 64, kind
`physical|bridge|vlan|wireguard|unknown`; unmapped kinds become unknown,
not the source string; sort by kind/carrierUp/online, preserving equal entries.
If any array exceeds its bound, refuse the whole report, do not select a subset.
The approved denylist first, leaf allowlist second, string scrub third remains
mandatory in the producer; both planted-secret and benign-survival tests are
required. Schema validation alone cannot establish source redaction.

Counter scope is device identity for its entire preserved STATE lifetime,
including origins and ownership generations. Reserve blocks of 64 before use:
if reservedThrough R is durable, atomically persist min(R+64,MAX), then hand
out R+1…newR from memory. On reboot skip every unused counter <=durable R;
recover already queued lower counters before emitting any newly allocated one.
Exhaustion stops reporting visibly and never wraps or silently changes D.
Gaps in counters can be unused reservations, lost volatile sends or local drops;
they do not assert that fabricated telemetry existed.

Retain PLAN-076's flash policy: successful unqueued sends keep reports and acks
in RAM; only one durable counter reservation per 64 allocated reports is
required. No claim of exactly-once capture across a crash. First failure
appends the whole report to a single journal and fsyncs before it is considered
buffered. Journal record is length + canonical JSON event + SHA-256 checksum;
recovery accepts only complete records, truncates an incomplete final record,
and refuses earlier corruption. One writer; append/compaction/ack/drop/retry
updates are transactional event groups with a final commit record and fsync.
Recovery applies only committed groups. Compaction fsyncs the replacement,
renames, fsyncs directory; keep the prior committed journal until rename.

Queue is <=128 whole reports and <=1,048,576 report bytes (including framing),
retention <=172,800 seconds (48 hours) from capture/first buffering using local
elapsed time. On reboot with untrusted wall clock, retain age already accrued
and conservatively add one cadence; repeat reboots can expire data earlier,
never extend retention indefinitely. Within a boot use monotonic time; trusted
forward wall elapsed adds to age, negative wall deltas do not subtract it.
Drop oldest records when count/bytes/age bind, under the same journal commit
as cumulative `gapReports` increment. It is u64, scoped to local epoch and
persisted on buffer mutations; do not wrap (at exhaustion stop capture).
Each outgoing attempt carries the current cumulative gap count on **every**
report in that batch, so the next newly accepted report exposes local drops
even when captured earlier. The count means locally dropped queue/samples, not
a claim that none of them previously reached the plane. Local refusal of an
oversized/unrepresentable produced report also increments this count, without
creating a fake payload. A crash before a volatile report is buffered can lose
that sample without a durable gap increment; reserved counter holes show
uncertainty. Exact crash-loss accounting would contradict the approved
no-fsync-per-success design and is explicitly not promised.

`capturedAt` is a label from usable device time, else null; authority is the
counter. `bufferedSeconds` is total whole seconds since capture at this send,
clamped 0–172800. It may rise on retry. It and `gapReports` are transport
metadata; neither can decrease across retries within an epoch. All other report fields freeze at
capture. Define stable record digest as SHA-256 of canonical JSON of the report
with **bufferedSeconds and gapReports removed**. Canonical JSON here has ASCII lexicographically sorted object keys, preserved array order,
no whitespace, integer numbers in decimal, JSON strings escaped for quote and
backslash, and literal printable ASCII otherwise. All wire strings are bounded
ASCII; no float normalization is involved. The request signature still covers
both delivery fields and all exact raw bytes. A duplicate never rewrites the
first stored bufferedSeconds, gapReports or receive time. This avoids a
wait-duration change becoming a conflicting report while protecting actual telemetry content.

One outstanding report batch, oldest queued counters first, strictly increasing
and unique, all same D and current header G/epoch. Do not send a later queued
batch until the prior batch's outcome is resolved or its records are explicitly
locally dropped by bounds/lifecycle. Retries may re-batch surviving records. Any raw body change (including delivery
metadata) uses a new requestId and signature; an unchanged wire retry may retain
the prior requestId. Record identity/digest stays the same. New reports may queue
behind a retry but cannot overtake it. Batch splitting is a local byte bound,
never a response-directed payload change.

Server acceptance transaction (all-or-nothing, no partial ack):

1. Validate framing, JSON schema, cross-field invariants, D/G/epoch/key binding
   and signature. Lock D, recheck active state and key time/revocation at commit.
2. Dedup key is `(origin,deviceId,counter)` (PLAN-076's `(deviceId,counter)`
   within one plane). For a retained receipt, require same generation/epoch
   and stable digest; mismatch is 409 `counter_conflict`, with **no writes**.
3. For a new counter require it > durable H. Process batch in ascending order;
   known matching duplicates may precede new counters, holes are allowed.
   Unknown counter <=H is 409 `stale_counter`, never inferred accepted. A
   reversed array or repeated member fails the whole batch. Do not allocate
   rows or mutate H on a rejected request.
4. Atomically store each new report, immutable stable digest, D/G/epoch,
   receive timestamp and receipt; update H to highest new accepted counter;
   persist durable commit before sending 200 with exactly submitted receipts.
   Roll back every new row if any item fails or storage/capacity is unavailable.
5. An accepted receipt certifies that exact **stable payload** (all fields
   except bufferedSeconds/gapReports) was durably accepted once under that
   generation, retained at least as specified below. The delivery metadata
   stored is from first acceptance, not necessarily this retry's values. It does
   not certify hardware truth, downstream UI consumption, continuous capture,
   cross-region replication or permanent retention.

The plane retains report+receipt for 7 days from first durable acceptance,
never refreshes retention on retry, and enforces <=16,384 retained records and
<=256 MiB payload per D. At capacity refuse a whole new batch with 429 until
retention makes room; a duplicate-only batch can still succeed. Never evict an
unexpired receipt to satisfy new traffic. Retain D/H/generation/tombstone and
last lifecycle receipts for the lifetime of this origin's identity namespace
(maximum 32 KiB per D), independently of telemetry retention. A service cannot
silently garbage-collect these and still advertise this protocol. Global device
admission capacity is operator-owned: reject new enrollments with 503 when
its configured capacity is reached. No per-device query exposes another
identity's state or the prior owner's data. If historical report retention
passes, an old retry <=H fails closed; local 48-hour queue retention ensures a
conforming retry normally precedes that deadline.

Client retires records **only** after TLS-authenticated 200 of the exact schema,
requestId/D/G/epoch plus ordered counter/digest list equal to its pending batch,
and after checking the local lifecycle fence. For disk queues append and fsync
the ack transaction before reclamation; for volatile reports remove in memory.
Malformed/unknown/injected response content cannot retire even one report.
Transport error/refusal changes only bounded error/retry status, never reports,
counters, config, update state or ownership. Local queue bounds/consent/reset
and explicit N5 credential operations are separately authorized effects.

| Trace | Required result |
|---|---|
| Send counters 65,66; server commits, response lost; retry identical records | Second acceptance returns both original digests; no duplicate inventory/history or H change. Larger bufferedSeconds is permitted. |
| Server crashes before commit | No new report/H/receipt survives; retry commits whole batch once. |
| Server crashes after commit before response | Receipt survives; retry behaves as previous committed duplicate. |
| Device crashes before reservation fsync | No reserved counter was sent; recover old R and reserve safely. |
| Device crashes after reservation, before send | Resume above new R; unused numbers are holes, not made-up reports. |
| Failed send, device crashes before queue commit | Volatile sample may be lost; no half-record accepted on recovery. |
| Queue append committed, crash before/after ack journal commit | Before: replay same records safely. After: reclaim on recovery, no resend obligation. |
| Replay old key/G after release; release and report race | Whichever D transaction commits first determines acceptance. Old G never changes new owner data. |
| Renewal commit, reply lost, overlap expires, device restarts | Pending old+new seed persists; exact old-key renewal retry recovers public result until new expiry, then local recovery is required. |
| Factory reset or A→B→A during a pending response | Local epoch fence refuses old response and old queued records; new key/epoch cannot reuse a stale activation. |

### N8. Errors, scheduling and bounded retry

Error response schema is exactly `schema,requestId,deviceId,code`. Error codes
are closed below; no message/details/config fields. On malformed framing where
D/requestId cannot be safely read, close the connection or return an empty
400; client treats this as invalid transport, never as an authenticated state
transition. Known target values in a parsed error must match the pending request.

| HTTP / code | Device behavior |
|---|---|
| 400 `malformed`, 413 `too_large`, 415 `content_type`, 422 `schema_invalid` or `version_unsupported` | Permanent protocol refusal; show status, stop automatic fleet sends until local repair/restart; do not drop a queued payload in response |
| 401 `invalid_signature` / `credential_expired` | Visible auth refusal; stop automatic sends; no automatic register/renew driven by response |
| 403 `role_forbidden` / `credential_revoked` | Visible permanent auth refusal, same freeze; local services continue |
| 409 `claim_conflict`, `generation_conflict`, `request_conflict`, `counter_conflict`, `stale_counter` | Visible distinct conflict; pause this operation pending local intervention, preserve queue within bounds |
| 429 `rate_limited`, 500 `internal`, 503 `unavailable`, or other 5xx | Retry on local scheduler; a malformed error body is a protocol transport failure with the same bounded backoff, no state effect |
| DNS/TCP/TLS/timeout, 3xx, other 2xx/4xx, invalid body/header | Transport/protocol failure; bounded backoff, no redirect/fallback; TLS time failure separately visible |

A recognizable permanent status with invalid body still never authorizes a
credential or report-state change; classify protocol failure, not its injected
reason. At most one attempt per origin/device every **60 seconds**, across
register/renew/report/retries, including successful backlog flush; local
unregister's bounded pre-off send is the only explicit lifecycle exception.
A new report is generated per baked cadence C, default 900 seconds, constrained
60–86400; a smaller baked value has the approved 60-second floor and should be
refused at build time. Changes trigger the same producer, coalesced by the same
60-second generation floor. No response changes C or payload production.

On failure n (1–16 saturated), exponential base B=min(C,30*2^(n-1)). Delay floor
F=max(60,B,clamp(validRetryAfter,0,C)); pick integer uniform delay in
[F,min(C,max(F,ceil(1.25*F)))]. This resolves historical 30-second initial
backoff against the 60-second storm floor in favor of the latter. Jitter cannot
reduce Retry-After. At the cap jitter interval collapses; add initial/recovery
phase jitter once in [60,min(C,120)] before the first attempt to spread devices.
HTTP delta form is nonnegative digits (max 20, overflow saturates at C).
HTTP-date forms from RFC 9110 section 5.6.7 are supported: IMF-fixdate,
obsolete RFC850 and asctime; validate calendar and weekday, GMT and the RFC850
50-year rule. Leap-second values are ignored as retry hints; they never
authorize a clock correction. Convert date minus locally usable wall time once on receipt,
clamp [0,C]; if local time is untrusted ignore the date hint, never set the
clock from Date/Retry-After. Ignore malformed, comma-combined, negative,
fractional or duplicate Retry-After as a hint (duplicate singleton framing
still makes the response invalid). Max header length 128 for this field.

Run deadline on monotonic time; subsequent clock corrections cannot move it.
Persist failure level, chosen remaining delay, associated epoch and attempt
intent in the queue journal **before a retry attempt**, so a reboot cannot
reset the backoff. On reboot wait the whole saved delay (bounded <=C), not a
wall-clock subtraction; remaining retry state is at most 1 KiB and one pending
operation. A boot with no retry state still takes initial phase jitter. Success
resets failure state only after valid N7 ack or separately valid lifecycle
result. Disk write refusal prevents fleet retry, not local operations. Clock
rollback on the plane uses durable nondecreasing authorization time floor:
if its wall clock is below the saved floor or synchronization is uncertain,
refuse mutations with 503 until restored; never resurrect expired credentials.
Device uses the current clock floor for TLS, refuses validation exceptions,
and schedules explicit renewal using issuance/expiry plus monotonic elapsed;
uncertain current time becomes `clock_untrusted`, not permission to ignore TLS.

### N9. Future cohesive implementation and acceptance

These are **future consumers**, not present modules or executable tasks created
by this plan. Storage/queue is delivered with its consuming client, not as an
unused library. Each slice needs separate implementation authorization and
exclusive source ownership. A plane repository/deployment owner is required
before implementing its endpoints, not before finishing this specification.

| Later slice and real caller → flow → owner → observable output | Prerequisites and acceptance |
|---|---|
| Finish/verify FLEET-CONFIG in existing `configuration::provisioning_status_at` → fixed fleet document resolver → existing mosd-settings config ownership → authenticated APID desired-state projection | Independently authorized r3suq4rc; merge reviewed result first. Prove absent/null/off/error precedence and exact projection, no registration claims or sockets. |
| Future mosd report producer: `GetFleetReport` called by future fleet client and APID preview → current storage/telemetry/health/update sources → mosd owns allowlist and thermal window → identical canonical report content | Map all N7 leaves; closed failure-code adapter and fixed enums. Positive benign survival plus planted secrets at every depth, unknown source components, array/byte bounds, null/failure mapping; preview consumes no network counter. Framing metadata is provided by the caller to the same serializer; preview is marked unsent locally, no extra wire leaf. |
| Future separate `fleetd` client entrypoint and lifecycle mode → allowed read-only bus report/registration projection → **same executable owns credential, counter reservation, queue and retry** → status.json and outbound requests | Approval for new executable/unit/package/reset hooks and narrowly authorized read-only bus method(s). Do not claim a crate/unit already exists. Identity projection must expose exactly N2 registration fields to this UID; no GetSettings fallback. Bus negative tests prohibit GetSettings, ReportHealth, InstallUpdate, Reboot and credential APIs. Validate filesystem modes/symlink refusal, atomic rename/fsync failpoints, restart reservation/renewal, bounded overflow, no off-state DNS/socket/timer across boot. |
| Future plane enrollment/report route handlers → schema + Ed25519 verifier + explicit registry authorization → plane owns D rows, lifecycle receipts, H and durable report store → exact N4 receipts/conflicts | Select repository/owner/storage engine; implement single-D serializable transactions with no partially accepted batch. Cross-device and wrong-role negatives, expired keys, stale releases, two simultaneous enrollments, release reservation, current/old renewal races and crash-before/after-commit tests. Admission/retention restore tests are required. No standalone generic queue/CA first. |
| Future APID fleet status/preview local routes → desired config plus bounded status and mosd producer → read-only local projection → authenticated off/conflict/queue/expiry status | Existing LAN auth/CSRF/presence stays separate. Never read credential.json through API. Preview requires local admin authorization; unauthorized access and exact redaction tests. Any console addition is separately approved. |
| Future two-sided interoperability/autonomy gate → real isolated client + actual server with test TLS authority and virtual clocks → each side's own persistence → reproducible exchange/crash traces | Test every N4 endpoint, canonical bytes in both languages, mutated method/path/origin/body/key, raw CRLF and duplicate singleton fields, HTTP/2 pseudo-header order/lowercase/authority and streamed HPACK/decoded-byte bounds, malformed/duplicate/unknown responses, retry forms, no redirects, rate/queue bounds, key expiry/overlap, offline reset and URL rebound. QEMU/offline local update/reboot/recovery proof requires a later resource grant. Physical power-cut/board/boot evidence is separate. |

Plane operations remain external choices: hosting, TLS issuance/custody,
operator registry onboarding/review, tenant inventory UI, residency, SLO,
capacity and backups. They must honor this protocol's retention/replay floor;
none creates a lease on local appliance functions. NAT support, commands,
remote config, diagnostics upload, managed OCI, application trust, update/boot
signing and fleet rollout are wholly outside this protocol.

### N10. Design validation and evidence limits

Run [validate.mjs](../../tests/fleet-protocol/validate.mjs) using the existing
`IMAGE_BUN_1` digest in [images.env](../../build-env/images.env), without installs
or live services. It validates the complete current schema vocabulary, all
worked exchanges, raw duplicate-key/unknown/size/version/injection negatives,
positive controls, actual ephemeral Ed25519 signed-byte mutation tests, and
labeled in-memory sequence models of authorization/CAS/report acceptance.
The schema evaluator intentionally supports only the keywords used here and
refuses unknown schema keywords; it is not a production JSON Schema library.

The model accepts explicit test principals and is **not** a crypto/auth service.
Repair 1 adds receipt-recovery refusal for wrong device/role, mismatched
generation/epoch/key, changed request ID/new key/raw-body digest, terminal state
and expiry, alongside successful old-key recovery after overlap ends. The
renewal model's digest argument represents the exact raw body; its default
uses the worked compact body. Origin/method/path and both possession signatures
remain independently covered by the signed-byte controls, not invented model
crypto. Complete HTTP/1.1 examples and HTTP/2 decoded-envelope controls cover
allowed headers, authority, duplicates, unsupported fields and byte/count caps.
The original 46-check run did not cover these missing cases; repair RED/GREEN
identities and results are recorded separately in the task.
The independent in-memory crypto test verifies byte binding, not a deployed
credential, certificate or durable transaction. Schema/model checks cannot
prove strict Ed25519 point rejection in a future Rust/server library, disk fsync/power loss, real network behavior, TLS configuration, server
isolation or OS/board behavior. N9 names the later real runtime/interop tests.
`make docs-verify` includes link/index/status/coverage/BSP checks, but existing
link/index scripts exclude PMA records, so this runner additionally verifies
links and exact unique own task/plan rows. Scoped `git diff --check` and an
actual pma-cr design review cover full device/server auth, lifecycle, counter,
retry and race contracts. Validation records and exact fixture/source hashes
are recorded in the associated task when complete.

Primary references, accessed 2026-09-10 UTC (requirements narrowed above are
this protocol's decisions, not invented quotations from these documents):

- [RFC 8032 sections 5.1.5–5.1.7](https://www.rfc-editor.org/rfc/rfc8032.html#section-5.1.5): Ed25519 key/signature encodings and verification.
- [RFC 9110 sections 5.6.7 and 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3): HTTP dates and Retry-After forms.
- [RFC 9113 sections 6.5.2, 8.2.2 and 8.3.1](https://www.rfc-editor.org/rfc/rfc9113.html#section-8.3.1): decoded field-section accounting, connection-field prohibition and request pseudo-header authority; consulted for Repair 1 on 2026-09-10 UTC.
- [RFC 8446 sections 2.3 and 8](https://www.rfc-editor.org/rfc/rfc8446.html#section-8): early-data replay limits; this protocol disables early data.
- [RFC 8259 sections 4 and 8](https://www.rfc-editor.org/rfc/rfc8259.html#section-8): duplicate-name interoperability and UTF-8; this profile rejects duplicates and malformed Unicode strictly.

## Risks

TOFU allows first-writer squatting; operator-assisted reserved reassignment is
the deliberate recovery. Offline resets cannot revoke stolen remote copies
until the plane sees revocation or expiry. Flash-saving volatile success paths
permit crash capture loss; counter holes are not precise loss counts. These
are bounded explicit design tradeoffs, not proof gaps hidden by schema tests.
No unresolved contract choice blocks design completion; production runtime and
operations acceptance remains future.

## Scope

Only this plan, its unique task/index rows, the minimal C2 decision-status link
and `tests/fleet-protocol/` change. No production implementation, deployment,
activation, shared build/signing changes, historical reclassification or main
integration. Global changelog/index reconciliation stays with L2 D.

## Alternatives

- Bearer-only bootstrap/renewal was rejected: response-loss recovery either
  retains secret responses server-side or adds a second bootstrap secret.
  Device-held signing keys give recoverable public issuance receipts and
  exact method/path/body binding without exporting seeds.
- Mandatory factory certificate/claim-code enrollment contradicts the accepted
  zero-touch TOFU default; no new hardware identity is invented.
- An HTTP signature negotiation framework, device PKI and response-signing CA
  are unnecessary for this fixed path/algorithm scope. The small explicit
  domain-separated signing profile still requires real cross-language tests.
- Earlier PLAN-076 "accept all historic versions/ignore unknown fields"
  language is superseded by the user's development/no-compatibility rule:
  current v1 only, reject unknown fields and unsupported versions.

## Annotations

- Design authorization is explicit in the dispatch; no additional proposal or
  deployment approval is implied by this plan's completion status.
- Historical registration hint remains unselected; this response schema omits
  it entirely. It cannot enter the report-response path by implication.
