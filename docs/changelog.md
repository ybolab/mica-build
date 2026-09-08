# Changelog

Campaign-level record, one entry per plan, newest first. Details live in the
plan file and the task records it names; this file holds the one-paragraph
history a reader can scan without opening either.

## PLAN-926 — S905X5M integration into updated local main (2026-09-08)

Updated local main to upstream 3c5374f3 and integrated the S905X5M adaptation,
including the Wi-Fi switch and front-panel repairs. Conflict resolution keeps
CX3576's slot-specific boot digests and S905X5M's independent payload contract.
Added the newly required display/DRAM declarations and aligned board readers
with upstream's path resolution inside extracted roots. Display fixtures now
exercise fresh slot reads. Verifier and build-driver typechecks passed, with
1,468 verifier tests and 171 boot/bundle/geometry unit tests passing. This is
a local source integration; image packaging, remote main publication and
device deployment are outside its scope. Existing hardware gaps remain open.

## PLAN-925 — Wi-Fi client switch API alignment (2026-09-08)

The built-in network page's Wi-Fi switch returned 409 because mos-apid omitted
`wifi.client.enabled` from its settings write allowlist. The boolean leaf now
returns 202 with an apply task, while adjacent Wi-Fi settings remain refused.
OpenAPI and the resource inventory are synchronized. Formatting, clippy and
325 apid binary tests passed, including switch, validation and session/CSRF
regressions. The device and existing images still contain the earlier service;
no packaging or deployment followed the user's disk-space stop instruction.
RFCT-945 records successful managed Wi-Fi DNS/HTTPS and unresolved gateway
ICMP loss separately from this API repair.

## PLAN-924 — S905X5M front-panel executable permissions (2026-09-08)

The package producer now installs both front-panel entry points as mode 0755.
The composed-root verifier checks optional executable modes and the panel
stop helper. All 1,394 verifier tests, actual package/root mode checks, 392 SD
image checks and 14 executable smoke checks passed. A temporary device bind
repair also passed service start/stop/restart. Replacement SD and RAUC artifacts
were produced before packaging was stopped; the later installer rebuild was
terminated. RFCT-944 retains the SD/eMMC boot-state ambiguity and remaining
runtime qualification gaps. The running root filesystem was not replaced.

## PLAN-923 — Local initialization helper and S905X5M SD inspection (2026-09-08)

Adapted the workspace-local initialization helper to the current JSON API,
session/CSRF contract, asynchronous apply tasks and additive SSH-key workflow.
Credentials are stored privately and retries preserve existing device state.
Fifteen isolated protocol cases and live fresh/repeat initialization passed.
SD runtime checks verified storage identity, management, Ethernet/NTP, MQTT,
container networking, radio discovery and basic HDMI/USB access. The image
remains degraded: non-executable front-panel scripts also prevent the boot
health gate from confirming the slot. RFCT-943 records the evidence and
RFCT-944 tracks the remaining runtime defects. The helper remains outside
the MOS Git checkout; this entry records its local delivery.

## PLAN-922 — S905X5M package integration on current mainline (2026-09-08)

Added the S905X5M/BM201 BSP to the top-level layout and package-based rootfs
pipeline, with resolved kernel configuration exports, independent radio
selection, and default-off front-panel and MQTT reference packages. SD images
and RAUC bundles consume the selected package's boot export; eMMC packages and
installer cards keep their separate media contracts. Runtime checks follow
mainline configuration and package inventories. The port retains mainline's
cx3576 boot-digest protocol and supports the x64 GRUB toolset on arm64 builders.
Factory-root smoke checks can use the existing BuildKit executor when Docker's
classic image store rejects a validated OCI archive.
Build evidence is recorded in RFCT-942. Existing-device configuration migration
and qualification of the new image on hardware remain separate work.

## PLAN-084 — Per-package JSON manifests and independent cache updates (2026-09-06)

Debian runtime pins now live in 172 individual JSON files with explicit target
variants, plus a separate bootstrap-helper record. All 342 previous target pins
and consumer mappings are preserved. `--package NAME` refreshes or verifies one
archive without processing unrelated package records; a real empty-cache run
fetched one archive and passed disconnected verification. The Bun builder renders
temporary installation records, keeping JSON tooling out of the target system.
Validation passed 40 archive checks, both-architecture selection checks, 920 build
tests, 1,279 verifier tests, 315 applicable image checks, 12 executable smoke
checks and all eight QEMU E2E phases with 137 assertions and no failures or skips.
See PLAN-084.

## PLAN-083 — Locked Debian runtime packages and QEMU acceptance (2026-09-06)

Runtime package manifests now pin versions, architectures, URLs and SHA256
checksums. Docker mounts a reusable archive cache; composition starts with 68
bootstrap packages and adds selected dependencies using dpkg without network
access or APT. The x64 system contains 159 upstream and 13 local packages.
Validation passed 920 build tests, 1,279 verifier tests, 315 applicable image
checks, 12 executable smoke checks and all eight QEMU/API E2E phases with 137
assertions, zero failures and zero skips. The guest tests now create a managed
WireGuard tunnel to exercise permissions on a real daemon-generated key.
Arm64 archives are verified; physical board acceptance remains separate.
See PLAN-083.

## PLAN-081 — Repository audit repairs (2026-09-05)

Closed stale-password session issuance, partial settings persistence, invalid UI
installation requests, diagnostics sandbox permissions, stale update/session UI
state, authenticated MQTT bridge connections and the package preflight regression.
Settings now use a private recoverable undo journal across DATA and STATE. CI adds
preflight, DATA layout and update-server checks, keeps generated OpenAPI equality,
and removes mandatory backward-compatibility enforcement during development.
English and Chinese current-state documentation is reconciled. Verification passed
1,047 mosd workspace tests, 149 UI tests, 920 build tests, 1,279 image-verifier tests,
25 preflight cases, 36 update-server tests and an isolated systemd sandbox probe.
Board and power-cut acceptance remain separate. See PLAN-081;
the audit resolution record it was written beside was a temporary document and
has been removed.

## PLAN-079 — Update server and release console (2026-09-04)

`update-server/` now provides a Bun/TypeScript service with a Chinese release
console, administrator sessions, streaming RAUC artifact uploads, publication
and withdrawal, expiring Ed25519-signed catalogs, range downloads and an audit
trail. SQLite stores release state; a standalone executable embeds the console
and database migration. The new protocol replaces TUF on the server side;
the existing OS client still needs its new reader before devices can use it.
Validation includes 36 tests, real HTTP range checks, full browser workflows
against the executable, and a clean dependency audit. Details and run commands
are in PLAN-079.

## x64 builds its own kernel, and there is no initramfs (2026-09-04)

x64 shipped Debian's generic amd64 kernel — 108 MB, with its own maintainer
scripts, its own initramfs run during the compose, and a klibc shell script in
the initrd that assembled the verity root. It now builds its own kernel from
mainline `v6.12.107`, pinned by tag and verified by digest, from a reviewed
fragment merged over `x86_64_defconfig` with the resolved config recorded in
tree and a build that refuses a config that drifted from it.

The reason was not size. `boards/common/mos-required.fragment` called itself the
board-independent baseline and was not one: measured against the Debian config
x64 actually shipped, of its 23 `=y` lines, 10 held, 12 were `=m`, one was absent
and its `CONFIG_LSM` was a different string — and nothing in the tree checked any
of it. That gap had already cost a whole-board outage: a change to the verity
format updated two of its three consumers and missed the klibc script, so every
x64 image was unbootable while cx3576 stayed green, because cx3576's kernel reads
the same command line directly and never runs that code.

**The initramfs is gone with it.** `rootfs/initramfs/` is deleted, initramfs-tools
and klibc-utils are out of the root, and there is no initrd in either slot's boot
partition, in `grub.cfg`, in the assembler or in the bundle. The kernel carries
`DM_INIT` and `DM_VERITY` built in and GRUB's `dm-mod.create` does what the shell
script did. Measured on the built artefacts: the kernel package drops from 108 MB
to 15 MB, the root from 435 MB to 296 MB, the RAUC bundle from 298 MB to 132 MB,
and 4230 modules become 8. The bzImage grows, from 11.6 MiB to 14.9 MiB, because
the drivers are built in — that is the trade, stated rather than hidden. Both
first-boot repartition and RAUC installation were always ordinary units after
`/sbin/init`, so removing the initrd took nothing from either.

The checks changed meaning rather than being deleted. `checks-kernel.ts` accepted
`=y` or `=m` over 7 symbols; it now requires `=y` **and** builtin over 31, which is
itself the provenance check — Debian's config has twelve of them `=m` and
`CONFIG_DM_INIT` nowhere, so a distribution kernel returning goes red. The
assertion that an x64 slot must carry an initrd was inverted rather than dropped,
and a BusyBox clause that would have become vacuous over an archive that can no
longer exist was restated stronger.

The floor is now one floor. The container-network symbols moved out of cx3576's
per-board loop into the shared fragment that both boards merge and assert after
`olddefconfig`. That consolidation also introduced, and then caught, the exact
defect the work exists to prevent: replacing a 59-symbol floor with a 41-symbol
one dropped 22 symbols and compensated for them only on the board that already
had them, so `CONFIG_NF_CONNTRACK_MARK` — the DNAT mark netavark sets for
published ports — was silently absent from x64's own config. The netavark gate
found it, and it and `NF_NAT_MASQUERADE` are named in the shared floor now.

The kernel also provisions the disk-encryption capability, and that is all it
does: `DM_CRYPT`, `CRYPTO_XTS` and `CRYPTO_AES` in a separately labelled block
that says it is the only block whose entries name no consumer, and that carries
its exit condition — each line leaves when a consumer lands in the image, and the
whole block is deleted if the product decision reverses. Nothing is encrypted at
rest; the image ships no cryptsetup, formats no LUKS header and has no unlock
path. Derived as three symbols, measured as six, because the crypt target selects
ESSIV in 6.12 and accelerated x86 AES pulls in cryptd and the SIMD helpers.
`CONFIG_TRUSTED_KEYS` and `CONFIG_ENCRYPTED_KEYS` stay off: cx3576 has no TPM —
its device tree declares none — so on that board the symbol would seal against
nothing, and enabling them would decide by accident where a volume key lives,
which is the first question an unlock design has to answer.

## The base image carries a firewall vocabulary, and keeps its unit off (2026-09-03)

`mos-system` now depends on both `nftables` and `iptables`. Neither is a
firewall: the image ships no rule set, no policy, no persistence and nothing
that reapplies a rule after a reboot. What it gains is the ability to look and
to act at all, on every profile — before this, a build that declined containers
had no firewall tooling whatsoever, because `nft` reached the image only as a
dependency of `mos-podman`.

Two front-ends over one backend is supportable only if the documentation says
which one answers which question, so it does. `nft list ruleset` is the complete
view of the `nf_tables` subsystem, including the container network driver's own
tables; `iptables -S` shows only what came through the iptables front-end, and
on a device running containers, reading it as "the firewall on this box" is
wrong. `iptables` here is `iptables-nft`, a translation layer over the same
kernel subsystem — the legacy binaries ship in the same Debian package, the
alternatives group is in auto mode where nft outranks legacy, and nothing in the
tree runs `update-alternatives`. A check asserts that endpoint, because a
flipped alternatives group leaves an executable `iptables` writing to a rule
store nothing else on the device reads.

The unit that ships with `nftables` needed a decision rather than an absence.
`nftables.service` runs `nft -f /etc/nftables.conf`, whose first line is `flush
ruleset` — on a device with containers that clears the container network's rules.
It was not enabled, but only because nothing had enabled it: measured on a clean
trixie root, **no shipped preset rule matches `nftables.service` at all, and
systemd's fallback for an unmatched unit is enable**, so a single `systemctl
preset-all` was enough. `mos-system` now ships `50-mos-nftables.preset` with
`disable nftables.service`, the postinst asserts the outcome, and a verify check
resolves the preset the way systemd does — basename masking across `/etc`,
`/run` and `/usr/lib`, first matching rule wins — rather than grepping for the
line it hopes is decisive.

On the image this project ships the closure delta is six packages and 2768 KiB,
because four of the ten were already present through `mos-podman`; the profile
this decision actually changes is the container-less one, which pays ten
packages and 4351 KiB for a firewall vocabulary it previously did not have.

## The kernel floor covers eBPF, the firewall back-end and bridge filtering (2026-09-03)

`boards/common/mos-required.fragment` named the virtual link kinds and netavark's
fib expressions and nothing else, so two capabilities the shipped runtime already
depends on were unstated. crun programs the cgroup v2 device controller as a
`BPF_PROG_TYPE_CGROUP_DEVICE` program, and on cgroup v2 that program *is* the
device policy — there is no controller file to write instead — so the eBPF core,
`bpf(2)`, the JIT and `CGROUP_BPF` are engine facts rather than diagnostics
niceties. The firewall half is derived from what `iptables-nft` actually resolves
through: the nf_tables core and its inet, ip and ip6 families, the xt compat
expression and the x_tables core it depends on, conntrack, NAT and masquerade.
Bridge filtering adds three more, because traffic between two containers on one
bridge is switched at layer 2 and no host firewall sees it otherwise.

Eighteen symbols, each with the clause that says what it buys. Deliberately left
out and recorded as such: the legacy `IP_NF_*` back-end and `BRIDGE_NF_EBTABLES`,
which nothing in the image uses; the per-extension matches and targets, which are
policy; `BRIDGE_VLAN_FILTERING`, which has no consumer because mosd renders VLANs
as their own netdevs; and `BRIDGE_IGMP_SNOOPING`, which is not neutral — built, it
stops forwarding multicast to ports that sent no report, which is how mDNS
discovery inside a container network breaks. BTF was priced by building it — 7.7
MiB added to `Image` in both A/B slots and twice the build time — and declined
until something ships a CO-RE tool.

The floor is now checked from both sides: `verify/src/checks-kernel.ts` asserts it
against Debian's built artefact on x64, the fragment is merged before
`olddefconfig` and asserted against the built config on cx3576, and a test reads
the fragment and requires every registered symbol pinned there. Eight symbols
build no object of their own, so a register entry may omit its module, and the
modprobe check names in its PASS message which symbols it skipped — a green line
cannot be read as covering them. One asymmetry is written down rather than
smoothed over: `br_netfilter` defaults its `call-iptables` switches on and
registers its hooks once a bridge exists, so a FORWARD policy reaches same-bridge
container traffic on the board whose kernel builds it in and not on the board
where it is a module. The capability is common; the default state is not.

## The built-in console follows the prototype's information architecture (2026-09-03)

PLAN-067 closed the visual gap to the approved prototype; this closes the
structural one. Page titles lose their descriptions and gain a status slot, the
footer reports release and active slot, the connection has the prototype's
three states with a banner, and preferences become a searchable language picker
and a segmented appearance control. Overview's attention rows stop being
hard-coded copy and become device facts. Network merges observed state into the
interface table and opens an interface detail route with a review dialog and an
apply strip whose every step is observed. Services opens a service detail route
and the terminal window. Applications gains its filters, retained-data count
and Desired column. Access becomes four labelled sections. System folds to the
prototype's six tabs, with the update check table, automatic policy, manual
upload and configuration backup.

Two rules governed the work. Nothing states a device fact the device did not
report: service endpoints, bridge membership, whether a change would cut off
this browser, and the update checks are all derived or omitted. And anything
designed but not yet real is built, disabled and marked at the section that is
incomplete, not only at the bottom of the page. Six shipped surfaces the
prototype has no place for are retained under sections that name them as
additions. PLAN-068.

## The built-in console matches the prototype detail for detail (2026-09-02)

PLAN-064 reproduced the approved prototype in outline; the shipped console now
reproduces it in detail. The OKLCH re-derivation of the palette is replaced by
the prototype's own Klein values for both themes, including the hover,
accent-soft, accent-strong, skeleton and chrome roles. The type scale drops to
the prototype's 22px page titles, 16px section titles, 15px control and table
text and one 13px secondary size, and the shell adopts its 56/52px header,
square logo mark with a stacked wordmark and hostname, navigation pills with an
inverted active state, 44px footer on the page ground and 300px drawer with a
status block. Buttons, inputs, tags, tables, tab strips, switches, dialogs,
progress bars and the blueprint-framed sign-in card follow the prototype's
sizes, radii and states, and the breakpoints move to 581px and 1100px. Content,
routes, API bindings and the simulation boundary are unchanged. PLAN-067.

## Built-in UI builds are isolated from source (2026-09-02)

The built-in UI now has one production and quality path through the Bun image
pinned by `build-env/images.env`; host Bun discovery and configurable output
directories are gone. The UI source is mounted read-only, while dependency
installation, generated metadata and Vite output are confined to
`_out/apid-ui/`, with the production tree fixed at `_out/apid-ui/dist`. Rust
target and package builders also mount repository source read-only, write Cargo
artifacts through a separate target mount and consume the UI tree through
`/build/apid-ui:ro`. This supersedes PLAN-065's source-adjacent producer
placement without changing APID's embedded VFS or runtime routes. PLAN-066.

## Built-in UI assets are generated before Rust builds (2026-09-02)

`pkgs/mosd/apid/ui/dist/` is now ignored generated output rather than a second
source of truth in Git. The frontend production entry uses local Bun or the
pinned Bun container; local checks, target builds and package producers run it
before Cargo and pass the absolute output directory explicitly. APID's build
script validates that tree, copies accepted bytes into Cargo-owned output and
generates the same sorted embedded VFS. The frontend gate now proves source,
tests and a fresh production build, while a focused contract gate prevents
generated files or unwired Cargo entries from returning. PLAN-065.

## The built-in UI now implements the complete product prototype (2026-09-02)

The recovery SPA now matches the approved horizontal Klein-blue prototype and
uses the shadcn/ui base-nova contract on Base UI, Spectrum-aligned OKLCH tokens,
self-hosted Barlow fonts, responsive desktop/mobile navigation, persisted
English/Simplified Chinese and light/dark preferences, and route-level lazy
loading inside the embedded VFS. Overview, typed network management, system
services, credentials, UI package versions and authenticated update actions
use the current APID contracts. Applications, browser terminal, time, automatic
update policy, storage, diagnostics/support, backup and recovery are complete
interactive simulations backed only by ephemeral in-memory state; every
affected page labels that boundary at its bottom. Vitest and Playwright cover
the simulation boundary, navigation, preferences and critical workflows. The
34-file embedded tree is 1,067,103 bytes raw and 501,172 bytes as the sum of
per-file gzip streams; 250,984 raw bytes are the twelve Latin Barlow font
assets, and the remaining increase from the 676 KiB baseline delivers the
complete route and interaction surface. PLAN-064.

## The built-in UI moved to an internal namespace (2026-09-02)

The verity-covered recovery SPA now owns `/_ui` and uses canonical `/_ui/`
asset and navigation URLs; `/` redirects there when no usable custom UI is
active. `/ui` has no compatibility alias and is now an ordinary custom-UI
route, so an integrator bundle can own that path without being intercepted by
APID. The route router, one-decode reserved-segment guard, Vite/TanStack bases,
localized recovery copy, committed hashed assets, tests and current English
and Chinese guidance moved together. `/api/v1/ui` and `/mos/ui` retain their
existing API and storage meanings. PLAN-060.

## Application delivery, an emergency binary and a recovery interface (2026-09-03)

`docs/user/applications.md` now routes application code on one question — may
this code be a release behind the OS? — into either build-time `.deb`
composition under the RAUC lifecycle (`docs/design/native-applications.md`) or
digest-pinned OCI/Quadlet delivery. Three more Quadlet examples are fed to the
shipped generator by the documentation test, so a broken example is a red gate
rather than a customer's discovery. What is not enforced is named: signature
admission, mandatory ceilings, a secret store and per-application automatic
rollback; the slot-wide rollback the boot health gate does perform is stated
separately rather than folded in, because folding it in would have made the
group false.

`mos-busybox` ships one unexpanded `/usr/bin/busybox` for emergencies. Depending
on Debian's package would have shipped an initrd carrying busybox and 271 applet
hard links through the initramfs hook it also installs — the applet farm the
plan rejects, arriving as a side effect of one dependency line — so the producer
extracts the single file and runs no maintainer script. Verify walks the packed
root for symlinks and for files sharing the binary's inode, because the hook
expands as hard links.

Physical recovery actions now have a system-layer interface: a board declares
its own actions in `board.env`, mosd maps a boot-time intent through that
declaration into the presence assertion and reset tier the existing flows
consume, and a board that declares none refuses and says so. Both shipped boards
declare none, and the debug serial console is withdrawn as a candidate — on
cx3576, displacing its getty was measured to wedge the tty and block systemd.
PLAN-045, PLAN-048, PLAN-051.

## Install, onboarding, provisioning and recovery (2026-09-02)

A device can now be configured before anybody logs into it: a versioned,
totally validated provisioning document arrives on the boot partition or on
removable media, applies in one save or not at all, and is refused once the
device has an administrator — so a fielded appliance cannot be reconfigured
from a stick. Claiming records how it happened, and a bootstrap credential is
bound by a forced rotation at first sign-in rather than by an expiry, because
an unclaimed device is the one with no trusted clock and a window that closes
with nobody in it would brick. Slot state is inspectable and a manual rollback
is guarded: it can only ever mark the booted slot bad, never mark a target
good, and it refuses a target that was installed more recently than the
running system or that cannot be ordered against it — which derives "the
target has run before" from RAUC installing only the inactive slot, a premise
now named where the guard lives. Reset has three tiers with a table that says
what each one preserves as well as what it clears, executed from an intent
record applied on the next boot; META and the system slots are unreachable
because the type that carries the roots has no member for them. Secure wipe is
deliberately absent until a board evidences a device-level erase primitive.
The console renders every reachable flow and explains the two that are not.

Not closed, and the records say so: the presence gate ships and nothing writes
a presence assertion, so tier 3 and credential recovery are implemented,
tested and unreachable on a fielded device; every install, flash and
first-boot procedure is documented and unrun on hardware. PLAN-046, PLAN-048.

## Time, storage, diagnostics and the system-information surface (2026-09-02)

The image now keeps time on purpose: `systemd-timesyncd` ships as base policy
with a pinned 32-2048 s poll, a 30 s retry and a 60 s clock save, its saved
clock bound onto STATE so `max(RTC, last known good)` holds before TLS and TUF
validity are ever checked. NTP servers and the timezone are typed settings
with a runtime reconciler; the timezone is presentation only, rendered to
`/run/mos/timezone`, and `/etc/localtime` stays UTC because a bind over the
zoneinfo symlink would hand the operator's zone to every reader of UTC. The
cx3576 kernel now asserts its RTC driver. `GET /api/v1/storage/status`
reports the PLAN-063 tiers: DATA at `/mnt/data` with `/mos` and `/srv` as
binds of one pool whose capacity is stated once, readiness proven by a real
probe write with named unavailable and degraded states, eMMC wear as a JEDEC
bucket range beside its raw evidence, and every lifecycle action explicitly
unsupported. `GET /api/v1/system/info` assembles what this device is from
the shipped manifest, machine id, uname and RAUC; `/api/v1/system/telemetry`
and `/api/v1/network/status` report observed state, kept distinct from the
desired configuration, and say so when a fact is absent. Diagnostics
snapshots collect one at a time under `/mos/diagnostics` with retention and
explicit deletion, redacted by a fail-closed allowlist. A Wi-Fi AP
passphrase refusal no longer names the secret's length. Board validation of
RTC backup power, media health, fsck evidence and the telemetry fields needs
bench hardware and is recorded as not done. PLAN-044, PLAN-049, PLAN-052.

## Release identity, authenticated updates and the security lifecycle (2026-09-02)

A release is now a validated manifest (version, channel, board
compatibility, artifacts with sizes and digests, source and build identity)
with SHA256SUMS, a CycloneDX SBOM taken from the image's package manifest,
provenance and a license inventory; `make os-release-gate` refuses to
publish without them or without board evidence. Devices carry
`rauc-update`: it discovers releases from signed TUF metadata, downloads
resumably into `/mos/updates/downloads`, moves only an authenticated bundle
into `/mos/updates/verified` and hands RAUC that path alone, with an offline
import through a lockbox. mosd owns the update lifecycle (idle through
rolled-back, plus `update-unavailable` when the DATA pool is missing,
read-only or exhausted) under a fail-closed policy file for maintenance
windows, metered links and a health-gated reboot; apid exposes it under
`/api/v1/update` and the System page exposes its state and typed actions.
`docs/design/security-model.md` separates six security boundaries and is
the canonical I1-I4 boot-assurance ladder; `security-lifecycle.md` and
`manufacturing.md` name owners for keys, releases, advisories, factory
records and RMA. Both boards honestly remain I1. Production key ceremonies,
release hosting and every board-side fault row are operator or bench work
and are listed in the task records. PLAN-043, PLAN-047, PLAN-053.

## User documentation, website briefs and the BSP porting set (2026-09-02)

`docs/user/` now carries the fifteen-page customer journey from download to
support under an explicit documentation contract: audience, page ownership
and a truth-status taxonomy on every claim. `docs/website/` holds one content
brief per official-website page. `docs/bsp/` is the porting manual, the
vendor intake rubric, the `board.env` reference, the dossier template with
its cx3576 instance, the field-reliability qualification matrix, the I1-I4
boot-assurance ladder and the support tiers. `docs/zh/` mirrors all three
sets. `make docs-verify` grew four gates -- internal links, truth-status
lines, en/zh coverage and dossier shape -- each with its own negative test.
The twelve cx3576 qualification rows still read "not tested"; they need a
bench run. PLAN-042, PLAN-050.

## The os/ wrapper is gone (2026-09-02)

`os/boards`, `os/build`, `os/build-env`, `os/pkgs`, `os/rootfs`, `os/tests`,
`os/tools` and `os/verify` now live at the repository root. The wrapper dated
from when the tree was expected to hold more than the OS; it never did.
Every path reference followed -- including the self-locating scripts that
derive the repository root from their own depth, and both TypeScript path
modules, whose `OS_DIR` (now equal to `REPO_ROOT`) was retired. The `os-*`
make target names stayed: they are names, not paths. Historical records keep
the paths they were written with. Landed as 69febcae.

## Built-in UI assets are an isolated embedded tree (2026-09-01)

APID now generates a sorted compile-time VFS from the complete committed
`ui/dist` tree instead of naming `index.html`, `app.js` and `app.css` in Rust.
Vite emits content-hashed vendor, route and locale chunks; page routes and the
Simplified Chinese catalog load on demand, while every resource remains inside
the verity-covered binary. `/`, `/ui` and `/api` are terminal ownership domains:
misses and ambiguous encoded or repeated-separator paths cannot cross between
the custom UI, built-in UI and JSON API. The Chinese UI development guide now
documents the VFS, lazy-loading, cache and path-isolation contract. PLAN-059.

## The built-in UI is bilingual and theme-selectable (2026-09-01)

The recovery SPA now ships typed inline English and Simplified Chinese
resources and browser-local language selection, plus persisted system, light
and dark appearance modes available before and after authentication. Its owned
shadcn `base-nova` controls remain backed solely by Base UI, while local
semantic tokens now follow Adobe Spectrum 2 color hierarchy, focus, state,
density and accessibility guidance without importing a second component
runtime. Every shipped route was localized, theme and locale document metadata
stay synchronized, and the complete embedded APID asset tree remains deterministic.
PLAN-058.

## Package versions mean something, and the image says what it holds (2026-09-01)

Upstream repacks now carry their upstream version in front of the pool's git
stamp -- `mos-podman 5.8.6+git…`, `mos-rauc 1.13+git…`, declared per producer
by `VERSION_FROM` in producer.env -- while first-party packages keep the
workspace version. The pool-wide invariant weakened from one version to one
stamp, in the gate, the compose preflight and the exact-version Depends pins
(now pinned to the named package's own pool version; the cross-boundary pin
uses the new `@SYSTEM_VERSION@` control token). The composed image ships
`/usr/share/mos/manifest.tsv`, its bill of materials written before the
package-manager purge and asserted by os/verify. The `radios` producer split
into independent `wifi` and `bluetooth` producers, and each radio name is its
own `MOS_ROOTFS_WITHOUT` token -- declining Bluetooth keeps Wi-Fi -- with the
umbrella `radios` token removed. The container-network kernel floor (VETH and
the nft fib family) moved into the shared `mos-required.fragment` and into
os/verify's per-image kernel checks for the Debian-kernel board. PLAN-041.

## The v2 suffix is retired (2026-09-01)

The `v2` in file and target names dated from when the current layout coexisted
with a legacy chain; that chain is gone, so the suffix stopped naming a
distinction. `os/rootfs/build-v2.sh` is now `build.sh`, `os/rootfs/overlay-v2/`
is `overlay/`, the cx3576 assembler `mkimage-v2*` is `mkimage-cx3576*` (the
name `mkimage-x64` already used), the make targets dropped their `-v2`, and
images assemble as `<board>-mos-<epoch>.img`. Prose that said "v2 image" or
"layout v2" now says "mos image" or "the A/B layout". Version numbers that
really are versions -- the settings schema's v2, the API `/api/v2` rule,
upstream releases -- are untouched, and historical records (this file,
docs/plan, docs/task) keep the names they were written with.

## The rootfs is composed from Debian packages (2026-08-31)

The nine-file rootfs stage chain is gone. A root is now one APT transaction
against a local package pool -- `_out/debs/<arch>/`, built and indexed by
`make os-debs` -- on a digest-pinned Debian base, followed by one finalizer
that closes and packs it. What used to be a floor stage, a read-only-root
wiring stage, four feature stages and a board stage is package metadata:
fifteen packages from ten producers discovered from the tree, with
configuration order coming from their own `Depends` rather than from a number
in a filename. Declining a feature is naming fewer packages, through a resolver
that refuses a set not naming exactly one profile package. Enablement is
package-owned symlink payload; nothing anywhere calls `systemctl enable`. The
RAUC keyring stays the one path that is not package payload, staged per build
from `ca/`, and it is a different seam from the TLS trust store `mos-ca-trust`
ships. The switch-over was accepted on a gate that built x64 through both paths
at one commit and judged every difference between the two roots -- 35
differences, 35 sanctioned, 0 unsanctioned -- whose reasoning is kept as a
closed record in `os/tests/dual-build-sanctions.md`.

## Built-in UI is a pure SPA over the management API (2026-08-31)

apid now embeds a React/Vite application at `/ui`; `/` serves a valid active
custom bundle and otherwise redirects to that built-in UI. All server-rendered
Maud pages and non-API form mutations, including `/containers/enable`, were
removed. Setup, login and logout have JSON session routes, API handlers accept
either a stored bearer token or a signed browser session, and session mutations
require a per-session CSRF header. Custom UI status/deactivation is likewise an
API resource. mosd now obtains an on-demand normalized network snapshot from
systemd-networkd, and the network API/SPA report the observed interface count,
configured intent and each link's operational, carrier, address-family and
address details. The committed frontend assets are rebuilt and byte-compared
in CI before Cargo embeds them.

## Settings writes are bounded, scoped and queued (2026-08-31)

apid-to-mosd and mosd-to-systemd waits now have five-second bounds, while
mosd keeps settings/live-state reads separate from its serialized apply lock
and reconciles only overlapping subtrees. Persisted settings writes enter one
bounded, coalescing queue whose task records are mirrored into apid by
`TaskChanged`; the settings and transient-password APIs return 202 plus a task
id, and bearer clients can read the bounded task collection or one record.
The zero-JavaScript SSH pane redirects to that task and meta-refreshes only
until success, failure, interruption, or confirmed history loss, and no
plaintext password can enter the queue.

## cx3576 builds on a host without binfmt (2026-08-30)

The rootfs stage driver links its chain one of two ways, decided by the
builder's driver: by tag in the daemon's image store on the `docker` driver,
as before, or by OCI layout on any other -- each stage exported
`type=oci,tar=false` under `_out/<board>/stages/` and handed to the next as a
named build context under the tag its `FROM` names. A `docker-container`
builder bundles its own emulator, so `os/rootfs/build-v2.sh` now selects
`mos-<arch>` when `default` cannot reach the platform, the way the RAUC and
podman builds already did, instead of refusing with the host binfmt command.
The smoke run that closes the build follows: when the daemon cannot execute
the root, every register entry runs inside that builder through one throwaway
build per artifact, with the same register and the same judging. With that,
every cx3576 step -- builder images, U-Boot, kernel, RAUC, podman, mosd, the
rootfs, the image, its verification and the bundle -- builds on an amd64 host
with docker and buildx and nothing registered on it.

## MQTT bridge hardened against its application peers (2026-08-30)

A review of the decoupled bridge found it still treating its D-Bus peers as
mosd. Every `GetItems` and `SetValue` into an application is now bounded by
five seconds, so a hung application is recorded as unreachable instead of
stopping the heartbeat and every other application. The rumqttc event-loop
task no longer waits on the runtime: requests that arrive while it is busy
are dropped, and a reconnect travels on its own channel, closing a deadlock
between the two bounded channels. An activation that fails while the
application still owns its name -- one that claims the name before it
registers `/` -- is retried by a bus sweep five seconds later.

The documented application policy now grants root `GetItems`: the stock
system bus has no root exemption, so a package that granted only the bridge
was published to MQTT and reported non-conforming by mosd's registry on every
boot. Image verification requires that grant for every enrollment. The MQTT
reconciler no longer lets an identity that fails validation block the off
path, and a read of a path no application publishes is ignored rather than
answered with a retained null under the client's chosen name.

## MQTT enrollment decoupled from service naming (2026-08-30)

`com.mos.ext.*` is no longer a privileged application namespace. All services
use the uniform `com.mos.<class>[.<suffix>]` grammar, while MQTT eligibility is
an independent package-owned contract: an exact regular-file enrollment under
`/usr/lib/mos/mqtt-applications.d` must be paired with exact D-Bus name
ownership and `mos-mqttd` Item1 grants. Global prefix ownership and the central
mqttd policy were removed; wildcard, prefix, unenrolled, and unpaired grants
fail image verification.

`mos-mqttd` now has zero D-Bus access to `com.mos.mosd`. `GetDeviceId` and the
bridge identity proxy were removed; mosd instead renders the already-validated
topic identity into `/run/mos/mqttd-device.env` before starting the bridge.
mosd retains its explicit local `com.mos.mosd1` management API because APID and
mosd are separate processes, but exports no Item1 façade and no settings,
state, signal, or action to MQTT. This entry supersedes the extension-namespace
and single-`GetDeviceId` exception described in the immediately following
entry.

## MQTT restricted to application data (2026-08-30)

`mos-mqttd` no longer mirrors the `com.mos.mosd` management tree. It now
discovers only class-bearing `com.mos.ext.*` application services, validates
their identities and item paths at the trust boundary, coordinates one
device-wide heartbeat/full-publish lifecycle, and fails closed when two
applications claim the same class and instance. System settings and state —
including SSH, networking, credentials, containers and MQTT configuration —
and power or update actions have no MQTT read, publication or write path.

The bridge's sole system-management permission is the new read-only
`com.mos.mosd1.GetDeviceId` method used to form topic addresses. APID now calls
the dedicated `Reboot` and `PowerOff` management methods directly, and mosd's
obsolete system `com.mos.Item1` façade and action-item implementation are gone.
D-Bus policy and image verification pin the exact grant across all policy
files. Application disappearance, watcher failure, invalid item paths and
address collisions withdraw retained values rather than leaving stale state.

## Mosd workspace tests consolidated and repository prose audited (2026-08-30)

The repository-root `test/apid-api/` harness now lives at
`os/pkgs/mosd/tests/apid-api/`, beside the D-Bus policy harness moved out of
`os/pkgs/mosd/hack/`. Repository-root discovery, container workdirs, fixtures,
Make targets, verification inputs, executable modes, and current documentation
all follow the new ownership boundary. Cargo unit and integration tests remain
crate-local, while `os/tests/` remains the home for OS-wide tests.

The accompanying audit removed a committed conflict marker, unstable source
line citations, stale references to deleted build and verification scripts,
incorrect current paths, and incomplete prose in design documents and code
comments. It also corrected a stale build-test expectation that still named the
deleted bundle script. Validation passed the 48-case documentation index, the
31-file shell pipefail scan, 689 build tests, 1,096 image-verification tests,
47 APID self-checks, 38 API specification pins, 45 D-Bus policy checks, and the
Rust workspace tests and clippy gates. The full QEMU APID run was not available
because this checkout has no `_out/x64` image; dry-run resolution reached the
new paths and stopped only at that missing prerequisite.

## Scratch root renamed to `tmp/` (2026-08-29)

`runtime/` collided with a real runtime path twice over. A genuine `runtime/`
directory in this repository would have been silently gitignored, and
`build-harness.md` quotes `/srv/bkd/runtime/bun` two sections above the one
that defined the scratch root, so a reader had to work out which `runtime` was
meant. It is `tmp/` now — unambiguous, and the convention PMA already states
for throwaway files. Nothing in the tree read the old name: it was a rule in
`.gitignore` and a section of `build-harness.md`, not a path any script builds.

Renaming it exposed a gap in the citation sweep. That sweep matched
`name.ext`, so it could not see a filename with no extension (`Dockerfile:41`)
or one whose dot comes first (`.gitignore:33`) — and the doc it was about to
rewrite cited `.gitignore:33`, a line number the rename itself was about to
invalidate. Twenty-three such citations survived and are now gone, across
`build-harness.md`, `uboot-ab-handshake.md`, `boards.md`,
`mos-required.fragment`, `podman/Dockerfile` and three `os/verify` sources.

Still there, and measured rather than fixed: about a hundred bare continuation
references in `os/verify/src/` and `os/build/src/` — `:1750`, `:2096` and the
like — pointing into `os/verify-image-v2.sh`, the shell verifier that was
deleted. They are archaeology in comments, not links anything resolves, and
clearing them is a separate pass over roughly a hundred sites.

## The docs gate narrowed to what ships (2026-08-29)

`docs/plan/` and `docs/task/` are PMA process tracking. They are not part of
the product, and a record is deleted when it closes, so the sets an index gate
asserted over them were down to two task records and zero plans — a check that
reports green without having checked anything. Both sections are removed.

What remains is the pairing a reader depends on: `docs/design/*.md` against
`docs/README.md`, both directions, plus the once-each assertion that catches a
document listed twice. A design document that no index lists is not broken,
does not fail a build, and is simply never found again; nothing else in the
tree can catch that.

The gate goes from 352 lines to 118 and the negative suite from 398 to 202 —
750 to 320 against 16 documents, where it had been 750 against 18 rows.

One gap closed on the way out. The forward direction for `design/` — a
document that exists with no row — had no negative case of its own: the task
half of that pair had been carrying it, and removing the task section would
have left the gate's primary assertion untested. It has a case now, and the
suite is 4/4.

`docs/research/` is not gated because it does not exist; it went with the
Venus OS evaluation. `check_readme_dir` still takes its directory as an
argument, so if a second shipped tree appears, one call adds it.

## Talos removed from the tree, and the settled records pruned (2026-08-29)

Talos is gone. The three references that were not history went with it: the
`.gitignore` entry for a `talos/` directory that does not exist, the base name
in the Makefile's retired-`os` message (the target keeps its recipe — a retired
build path that exits 0 is the failure mode every check here exists to
prevent), and the `apid` name-collision note in `remote-management.md`, which
disambiguated a daemon no reader can now encounter.

`README.md` keeps one mention, deliberately: the design-lineage sentence.
Talos really is where the immutable-root idea came from, and crediting an
influence is not the same as naming a dependency.

The rest of the Talos residue was inside settled records, so applying this
campaign's own rule cleared it. PLAN-029 M3 established that a record is
deleted when it closes; the closures in the previous commit left seven behind,
which contradicted it. Every settled record is now pruned — thirteen in all,
including this campaign's own PLAN-029 and RFCT-262/263/264. `docs/plan/` holds
no plan records, and `docs/task/` holds RFCT-253 and RFCT-260, the two that are
genuinely open.

An empty plan set turned out to break `docs/verify-index.sh`: an unmatched glob
expands to the pattern itself, and the forward loop reported `PLAN-*.md` as a
record with no row. It failed closed rather than passing green, which is the
right direction, but it was still a defect. Both forward loops now skip a path
that does not exist. The negative suite stays at 17/17 — it mints its own
`PLAN-900` fixture rather than borrowing a real record, which is what keeps the
plan assertions armed against an empty tree.

## Backlog cleanup (2026-08-29)

The open set was four plans and five tasks; most of it was bookkeeping rather
than work. Verified against the tree, then closed:

- **RFCT-005 and PLAN-007 — the Talos rebase, abandoned.** Both proposed
  rebasing the fork onto upstream Talos v1.14.0-rc.1. The project took the
  other fork, PLAN-010's systemd base. There is no fork left to rebase. The
  last three references outside the records — a `.gitignore` entry for a
  directory that does not exist, the base name in the Makefile's own "retired"
  message, and the `apid` name-collision note in `remote-management.md` — went
  with them. What stays is the design-lineage sentence in `README.md`, which
  credits an influence rather than naming a dependency.
- **RFCT-008 and PLAN-010 M1 — superseded.** The systemd rootfs prototype was
  replaced by the v2 chain (`os/rootfs/build-v2.sh` over nine stage
  Dockerfiles, squashfs+dm-verity, A/B layout) that M2-M5 build on and that
  ships. M1 was the only milestone still open under a plan whose other four
  were implementation-complete. Its remaining done criterion — hardware boot
  to sshd — was never recorded, and closing it does not claim it.
- **PLAN-006 — completed by supersession**, executed on the systemd base as
  PLAN-010 M4. **PLAN-008 — completed by supersession**: the connectivity
  concern ships as two mosd reconcilers, and no `connd` process exists,
  deliberately.
- **RFCT-007 — completed.** Item 1 had shipped. Item 3, the flashing matrix,
  is delivered in `os/boards/cx3576/bsp/README.md`: five paths, which board
  state each applies to, and why `ums` is reachable only from U-Boot and never
  from Maskrom. **Item 2, the `update.img` pipeline, is closed as superseded
  and will not be built** — three flash paths already write a whole-disk image
  through `rkdeveloptool wl 0`, and the RK packaging format would require
  vendoring `afptool` and `rkImageMaker`, closed-source SDK binaries, for no
  capability the tree lacks.

Left open, and genuinely open: **RFCT-253** (whether `access.ssh` may stay
bus-writable, a decision on evidence already gathered) and **RFCT-260** (the AP
reconciler's third copy of the WPA byte rule, and a refusal that names the
secret's length). Standing and untracked: the arm64/cx3576 verifications owed
to a host with binfmt.

## PLAN-029 — Documentation system rebuild (2026-08-29)

The documentation tree went from 276 files and 77,319 lines to 42 files and
17,306, and stopped being coupled to code positions. Delivered as one record,
RFCT-262, because record proliferation was one of the things being removed.

- **Decoupled from code.** 3,843 `path:line` citations are gone from the
  documents, along with the gate that kept them resolvable
  (`docs/verify-citations.sh`, its test and three baselines — 1,821 lines, two
  `Makefile` targets and a CI step). Documents now name a module or a contract.
  The HTTP surface defers to `os/pkgs/mosd/apid/openapi.json`, which CI already
  holds equal to what the shipped binary prints and diffs for breaking changes —
  moving the API surface off an ungated prose transcription and onto a gated
  artifact. api.md's transcribed route table and operation inventory collapsed
  accordingly; its design reasoning stayed.
- **Settled records pruned.** 205 completed `RFCT-*` and 24 closed `PLAN-*`
  deleted, both indexes rewritten to the survivors. RFCT-257 and RFCT-261 were
  closed rather than kept: both were work scoped against the citation gate this
  campaign removed, so leaving them open would have left the tree with a task to
  build on machinery that no longer exists.
- **Re-anchored on the current version.** `docs/research/` deleted with the
  Venus OS comparison it existed for; the eight `*.zh.md` siblings replaced by
  `docs/zh/`, written against the tree rather than translated from a moving
  target. mosd.md was a M2 brief under five dated amendments claiming schema v4
  in one heading and v7 in another while the code is at v8, and five reconcilers
  where seven are registered; the amendments are collapsed into one statement of
  where the design stands.
- **Tests.** Measurement did not support a broad prune — `os/verify` runs a
  0.84 test-to-source ratio and `os/build` 1.06, close to one test file per
  module — so only what lost its subject went: the citation gate's negative
  suite, and `os-layout-lint-test`, a filename filter over a suite
  `os-verify-test` runs whole and which nothing invoked. `test/apid-api` is
  recorded as the manual harness it already was. The index gate's negative suite
  stayed green at 17/17; its plan cases now mint their own completed plan rather
  than borrowing a real one the pruning rule would delete.

Left open deliberately: 97 references to deleted records remain in 24 non-docs
files, mid-sentence in doc comments and in the generated `openapi.json`. They
resolve in the history, and clearing them costs a 24-file prose edit plus a
regeneration.

**Amendment 1 (same day).** Two things the milestones left short. Code no
longer cites task or plan records at all — 390 references across 125 files,
including the doc comments `utoipa` publishes into `openapi.json`, so an API
client was being shown `docs/task/RFCT-210.md`. The document was regenerated
from the corrected source, never hand-edited. Doing that surfaced two classes
M1's own dangling check had missed by requiring a `.md` suffix: 179 record
references in the living design documents and 94 pointers at the deleted
`docs/research/`. Both are now zero. `docs/zh/design/` also grew from six
documents to all sixteen.

## PLAN-021 — The defect and debt batch (2026-08-28)

Fifteen of the sixteen filed tasks closed: RFCT-094, RFCT-096, RFCT-129
through RFCT-134, and RFCT-136 through RFCT-142; the sixteenth, RFCT-135,
grew into PLAN-022 rather than closing here. Alongside the filed batch,
RFCT-180 delivered the M1 quick-fix batch (test timeouts, the audit-trail
flake, dead instructions and dead code), and RFCT-190/191 ran the M3 ghost
sweeps — stale provenance references across os/** re-measured and repointed
or dated, plus the docs-side re-measures, owner sweep, and gate repairs.

The five defect clusters, by outcome:

- **Credential and auth**: the admin password is changeable after setup
  (RFCT-134), /healthz states what it actually checks (RFCT-131), and one
  outage no longer reports as both 502 and 503 (RFCT-140).
- **API/bus plumbing**: uptime comes from mosd instead of apid's own
  /proc read (RFCT-129), the three settings failures reach the API as
  distinct errors (RFCT-130), per-request GetSettings round trips are
  cached (RFCT-132), and apid receives mosd's SettingsChanged (RFCT-133).
- **Hardening**: apid's unit sandboxes the filesystem it serves
  (RFCT-137), cargo-deny enforces the no-C posture it previously only
  named (RFCT-138), the unreachable bundle store's fate is decided and
  recorded (RFCT-136), and the traversal guards gained over-the-wire
  coverage with a bundle-carrying fixture (RFCT-141).
- **Device**: the U-Boot boot-credit read is ordered against writers
  (RFCT-142), and the production keyring provisioning path is documented
  and testable while staying fail-closed (RFCT-139).
- **Test honesty**: dotted keys' missing item objects are certain rather
  than theoretical (RFCT-094), and "0 skipped" no longer hides skips
  (RFCT-096).

## 2026-09-08 17:02 [decision]

Repository wired into the PMA workflow per the skill as of 2026-09-08 15:42
UTC. `docs/CHANGELOG.md` renamed to `docs/changelog.md` (18 references
rewritten). Two records renamed from the interim slug-first form to the
`<timestamp>-<feature-slug>` form, IDs stable in meaning:
`file-ab-signed-components-20260908T1423Z` → `20260908-1423-file-ab-signed-components`
(task) and `file-ab-signed-components-20260908T1428Z` →
`20260908-1428-file-ab-signed-components` (plan); their four cross-references
updated. Added `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/decisions/`,
`.gitattributes`, `.editorconfig`, `.env.example`. Fast path stays
enabled. Record: `docs/plan/20260908-1702-pma-project-injection.md`.

## 2026-09-08 17:11 [progress]

Plan `20260908-1428-file-ab-signed-components` (file-based A/B, independently
signed components, three-partition layout, unified DATA) approved by the user
for implementation. Task `20260908-1423-file-ab-signed-components` claimed by
L1. P1 — the feasibility gate — is being dispatched as two parallel L3 tasks;
later phases wait on its evidence per the plan's own sequence.

## 2026-09-08 17:14 [progress]

P1 of `20260908-1428-file-ab-signed-components` dispatched: `ew42ee3o`
(P1-A, boot/trust primitives) and `iku9ubdw` (P1-B, writer audit), records
`20260908-1712-p1-signed-verity-boot` and `20260908-1712-p1-writable-path-audit`.

## 2026-09-08 17:19 [progress]

User direction on `20260908-1428-file-ab-signed-components`: parallel
execution confirmed; x64 completes each phase first and is verified under
QEMU, then the same layout is applied to cx3576 and the other boards. The
plan's sequencing rule and annotations record it; both P1 tasks were
re-prioritised by follow-up, and P1-A reports its x64 stage separately so P2
for x64 can open on it.

## 2026-09-08 17:27 [progress]

`docs/verify-status.sh` now accepts any plan record under `docs/plan/` (index
excluded) for a `proposed` status line, instead of only `PLAN-NNN.md`; the
negative test carries both record shapes and an index-only case, and the
user-doc contract (en and zh) states the rule. Task `20260908-1727-status-gate-plan-naming`.

## 2026-09-08 19:32 [progress]

P1-A of `20260908-1428-file-ab-signed-components` reports the boot/trust half
feasible as drafted: signed dm-verity accepted/refused with the plan's errno
set on x64, virt-arm64 and the cx3576 vendor kernel; one kernel boots two
signed roots; cx3576 FIT enforcement in the U-Boot sandbox; systemd-boot
shared-UKI Type #1 entries with boot counting on x64 and virt-arm64. L1
verified the raw logs, re-ran the gates and refused a byte-flipped signature.
Merge pending the committed harness and the x64 contract.
