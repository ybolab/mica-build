# Security

This page states the security posture of a mos device as it ships: what is
protected, by which mechanism, against which attacker — and the gaps, named
with the same precision. The threat-model boundary to hold in mind throughout:
**physical possession of the boot medium implies full control.** Whoever holds
the hardware can reflash it; the protections below are about everyone else.

## 1. Runtime integrity: the read-only verity root

The root filesystem is a squashfs with a dm-verity hash tree, verified
per block at runtime; the root hash rides on the kernel command line. The
device cannot be modified into running altered system code short of replacing
the whole slot, and every service, including the management plane, runs from
that sealed root. Writes go only to the declared data tiers
([storage.md](storage.md)).

What this does **not** claim: end-to-end secure boot. On cx3576 nothing in
the build signs SPL or U-Boot, so the chain below the kernel is not
authenticated; many customer-selected boards use opaque boot stages, and
rootfs integrity must not be misrepresented as boot-chain integrity. Recorded
as a gap, not assumed away.

> status: shipped — evidence: `docs/design/ro-root.md`, `docs/design/uboot-ab-handshake.md`

## 2. Update authenticity

An update is signed twice, by two unrelated hierarchies: the RAUC bundle's
CMS signature, verified on the device against its keyring, and host-side TUF
metadata (four ed25519 roles, offline root) pinning the bundle's digest,
length and verity root hash. The key ceremonies, custody and rotation
procedures are written as an executable runbook,
[../design/release-signing.md](../design/release-signing.md).

The named gaps:

- **No production keys are provisioned anywhere yet.** A build without
  provided material generates a development-grade trust root and marks it;
  the image verifier fails a dev-keyring image unless explicitly waived as a
  bench image. No image with a development keyring should leave a desk.
- **No keyring rotation channel on deployed devices** — replacing the trust
  anchor on a fielded device currently means an image signed by the very key
  being replaced.
- **The device-side TUF verifier ships, and its trust anchor does not.**
  `rauc-verify` and `rauc-update` are in the image and walk release metadata
  from a pinned root, but no image provisions that root, so the walk has
  nothing to start from until an operator supplies one
  ([update-rollback.md](update-rollback.md)).

> status: shipped — evidence: `docs/design/release-signing.md`, `pkgs/rauc-sign/`

## 3. Access and credentials

- **Per-device credentials, minted on the device.** Nothing secret is baked
  into an image — an image is byte-identical fleet-wide, so a baked credential
  would be a fleet-wide secret. The build *fails* if the factory shadow file
  carries a usable password hash, on both profiles.
- **The management API is the gate.** HTTPS only; password login with signed
  sessions and CSRF protection for browsers, bearer tokens for automation;
  persistent login-backoff counters and a bounded, fsynced audit trail of
  logins, setup, power actions and transient-password events.
- **SSH is off by default on both profiles.** Persistent access is by public
  key only, and every authorized key is a root key — stated in the UI in as
  many words. The transient root password (set by an authenticated
  administrator, cleared automatically at the next boot) covers the
  operator-at-the-bench case without creating a long-lived password.
- **Lockout is real.** Losing the administrator credential and all keys
  leaves no software path in ([recovery.md](recovery.md)) — a deliberate
  trade, since credentials surviving updates means updates are not a back
  door.

The audit trail does not yet record session lifecycle events and nothing
uploads it; there is no hard lockout threshold (deliberately, until a
physical-presence release path exists).

> status: shipped — evidence: `docs/design/access.md`, `docs/design/provisioning.md`

## 4. Applications

Containers run rootful (rootless mode is not built) and container image
signatures are not verified by the shipped policy — registry TLS and digest
pinning are the protections, and the trusted-integrator threat model is the
context. The management/application boundary is structural: the MQTT bridge
can only reach exactly-enrolled application services and can never address the
management daemon. See [applications.md](applications.md).

> status: shipped — evidence: `docs/design/containers.md`, `docs/design/bus.md`

## 5. Network exposure

The inbound surface of a stock device is apid on 443 (and the redirect on 80)
— nothing else listens for management, nothing dials out, and no fleet or
cloud channel exists. Static UI assets are public; every appliance datum and
operation sits behind the API credential boundary.

> status: shipped — evidence: `docs/design/remote-management.md`

### 5.1 The firewall tools, and the firewall there is not

Every image ships **both** `nft` and `iptables`. Both are dependencies of the
base package, so a build that declines containers has both too. **The image
ships the tools and no policy: no default rule set, no allow or deny list, and
nothing that manages rules for you.** There is no API and no console surface for
them; `ssh` and these two commands are the whole of it.

**Reach for `nft`.** It is the complete view of what the device is actually
doing, and it is the vocabulary any policy this product eventually ships will be
written in. `iptables` is here as the compatibility path — for third-party
tooling and existing scripts that cannot speak nft — and not as the equal of the
other.

Six things about them, because each is a surprise otherwise.

**The `iptables` extension set is bounded, and it is the same on every board.**
A rule that names a match or target the kernel was not built with is refused,
by name:

```
# iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 8080
Warning: Extension REDIRECT revision 0 not supported, missing kernel module?
```

That is not a translation failure and retrying it will not help — the
extension is simply not in this kernel, and adding one is a kernel change
rather than a package install.

**Guaranteed on every board**, because the shared kernel floor pins it: the
targets `MASQUERADE`, `REDIRECT`, `SNAT`, `DNAT`, `MARK`, `CHECKSUM` and `CT
--notrack`; the matches `addrtype`, `conntrack`, `state` and `mark`; the plain
verdicts (`ACCEPT`, `DROP`, `RETURN`, jumps) and the built-in matches (`-p`,
`--dport`, `-i`, `-o`, `--tcp-flags`); and the four tables `filter`, `nat`,
`mangle` and `raw` in both address families. Before 2026-09-04 `REDIRECT`,
`CHECKSUM` and `CT` worked on the arm64 board and were refused on x64 — that
asymmetry is what the floor replaced.

**Outside that set, ask before you rely on it, and do not assume the two boards
answer alike.** Measured on 2026-09-04, four extensions still differ, and not
all in the same direction:

| | x64 | arm64 (cx3576) |
|---|---|---|
| `-m multiport`, `-m comment`, `-j CT --zone` | refused | works |
| `-j LOG` | works | **refused** |

`-m limit` and `-m iprange` are refused on **both**. `-j REJECT` and
`-j TCPMSS` work on both today but are not pinned by the floor, so treat them
as convention rather than contract. If your scripts need any of these, say so
— which of them the product guarantees is an open decision, not an oversight.

**`nft list ruleset` is the complete view. `iptables -S` is not.** Both tools
program one kernel subsystem, `nf_tables`. `nft list ruleset` prints all of it:
rules you added through either tool, and the tables the container network driver
writes for itself. `iptables -S` prints only what came through the `iptables`
front-end, in the tables that front-end owns. On a device running containers,
reading `iptables -S` as "the firewall on this box" is wrong — and a rule you
cannot find with it is not evidence that the rule is absent.

**`iptables` here is `iptables-nft`.** On Debian trixie the `iptables` command
is a translation layer over that same `nf_tables` subsystem, not the legacy
xtables path and not a second firewall; `iptables --version` says so itself,
printing `(nf_tables)`. Rules it creates are real `nf_tables` rules in tables of
its own. The legacy binaries (`iptables-legacy` and its save/restore pair, over
`xtables-legacy-multi`) are in the image, because the same Debian package ships
them, and **nothing in the image selects them**: the alternatives group is left
in auto mode, where the nft front-end outranks the legacy one, and no unit,
script or postinst here runs `update-alternatives`. Selecting legacy by hand
would put your rules in a second, older kernel rule store that nothing else on
the device reads — not `nft`, not the container driver.

**The container driver's tables are the container driver's.** They are visible
through `nft` and not through `iptables`, and the driver reconciles them: a rule
you edit inside them by hand is a rule you are contesting with a reconciler, and
it will be rewritten. Add your own rules in your own chains.

**Nothing persists, through either tool.** A rule added at runtime lives in the
kernel and is gone at the next reboot. There is no `netfilter-persistent`, no
`iptables-save` unit, and nothing in the image loads a ruleset at boot. One file
looks like it might: the `nftables` package ships `/etc/nftables.conf` and
`nftables.service`, and **this image keeps that unit disabled on purpose**, with
a preset it owns rather than by leaving a symlink out. That matters in both
directions — the unit's `ExecStart` is `nft -f /etc/nftables.conf`, and that
config begins with `flush ruleset`, so an enabled unit would clear the container
network's rules at every boot. The file is on the read-only root, so it is not
somewhere you can put your own rules either.

**If you want a rule to survive a power cycle**, the route today is your own
unit: a service that reapplies the rules, installed into the writable unit
directory `/usr/local/lib/systemd/system` like any other native application
([applications.md](applications.md)). That is a statement of what the product
does now, not a recommendation of how to run a firewall.

> status: shipped — evidence: `rootfs/packages-src/system/control/mos-system.control`, `boards/common/mos-required.fragment`, `verify/src/checks-firewall.ts`

## 6. Security lifecycle

The lifecycle is now written down: every credential in the product with its
owning role and rotation procedure, the release channel and signing
procedures, severity classes with triage and patch targets, advisory
publication, incident response, and support windows and end of life. Each
section states its own maturity rather than implying it is enforced. Boards
carry a boot-assurance claim in a committed evidence file, and the release
gate reads that file rather than letting a release name its own level.

> status: shipped — evidence: `docs/design/security-lifecycle.md`, `boards/cx3576/evidence.json`

**None of the response channels exists yet, and an auditor should be told
so.** There is no published security contact and no disclosure policy at the
repository root, no advisory feed, no end-of-life announcement mechanism, and
no tooling that enforces a support window or a patch target — reports today
reach the maintainers privately and are handled case by case. Factory identity
injection, factory records and debug/fuse policy are likewise designed and
unbuilt ([manufacturing.md](manufacturing.md)). The advisories brief for the
official site is [../website/security.md](../website/security.md); this page
is the honest inventory.

> status: unsupported
