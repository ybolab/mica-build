# `meta.example/` — the committed shape of the gitignored `meta/`

`meta/` is a **build-host** directory. It holds the configuration and every
private key a release needs, and it is gitignored: a committed signing key
would make every device trust anything anyone builds. This directory is the
committed statement of what belongs there, and it is a directory the **tooling
uses** rather than prose beside the tooling — `pkgs/rauc/gen-dev-keys.sh`
instantiates `meta/updates/manifest.json` from the document here when `meta/`
has none, so an example that drifted from the schema would be a build that
fails rather than a document nobody re-read.

It carries no `rauc/` and no key of any shape, not even a placeholder: a file
named like a key in a committed directory is a file somebody eventually fills
in.

## `meta/`, and which half of it ships

```text
meta/rauc/ca.cert.pem            RAUC CA certificate            PUBLIC  -> image
meta/rauc/ca.key.pem             RAUC CA private key            SECRET  -> never
meta/rauc/signer.cert.pem        bundle signer certificate      public  -> host only
meta/rauc/signer.key.pem         bundle signer private key      SECRET  -> never
meta/updates/manifest.json       update configuration           PUBLIC  -> image
meta/updates/root.key            package signing private key    SECRET  -> never
meta/GENERATED                   development-grade marker       host only
```

**Two files reach the image, by allowlist, and nothing else does:**

| File in `meta/` | Path in the image |
|---|---|
| `meta/rauc/ca.cert.pem` | `/etc/rauc/keyring.pem` |
| `meta/updates/manifest.json` | `/usr/share/mos/meta/updates/manifest.json` |

Everything else is build-host-only, **including any file not named above**.
That is an allowlist and not a denylist on purpose: under a denylist a file
nobody anticipated ships by default, and the default is what decides the
outcome on the day somebody drops a note to the release host in here.

`signer.cert.pem` is public and still does not ship — RAUC takes the signer
certificate out of the bundle's own CMS structure and chains it to the keyring,
so the device never needs the file.

Two checks hold that split, in two places, because they fail on different days:
`rootfs/build.sh` refuses to **stage** anything off the allowlist or anything
carrying private key material, and `verify`'s `packed-meta-is-the-public-set`
and `no-private-key-in-baked-meta` refuse an **image** that contains one however
it got there.

## What must never be in the baked set

1. **No private key of any kind.** Private keys are `meta/`'s purpose; the rule
   is that none of them ship.
2. **No per-device value** — no serial, no MAC, no device id, no claim code.
   Every device flashed from one image carries a byte-identical baked set, so a
   per-device value in it is the same on every device.
3. **No secret of any kind** — no bearer token, no PSK, no password. A baked
   file is byte-identical on every device of a release, so a secret in it is a
   fleet-wide shared secret by construction. `/mos/config/` is where a
   per-device, root-only secret goes; this is not that tier.

A token pasted into `manifest.json` is a JSON string and no assertion
distinguishes it from a URL, so **no check is proposed for rule 3**. What
governs it is the release process, the same out-of-band control that governs
the signing material itself.

## `updates/manifest.json`

The document in this directory is the schema, and it configures **no server**:
`update.source` and `fleet.url` are `null`, so a build from a fresh checkout
produces a device that checks nothing until somebody edits their own `meta/`.
There is no built-in vendor URL anywhere in this tree.

- `schema` — first key, `mos/meta/v1`. Unknown keys are a build error: a
  mistyped key must fail loudly rather than silently configure nothing.
- `product.vendor`, `product.model` — a label saying which product an image is.
  Nothing reads it to make a decision.
- `update.source` — the one place releases are discovered. `null` means no
  online source; the offline import path is unaffected.
- `update.channel`, `update.policy`, `update.checkIntervalMinutes` — the baked
  defaults an operator document overrides at runtime. Minutes, because the
  operator document is minutes and two units for one quantity is a defect
  waiting for a reader who does not notice.
- `trust.signingKeys` — the base64 ed25519 public halves this image accepts a
  package signature from, a **list** so that a rotation can ship an image
  trusting the outgoing and incoming key at once. **Empty is a supported steady
  state**, and it is what a fresh checkout gets: a development package-signing
  key that no published repository has signed anything with anchors nothing, so
  `gen-dev-keys.sh --domain updates` is opt-in. An image with an empty list can
  verify no update package.
- `trust.signingKeyIds` — the sha256 of each key's bytes, **derived by the
  build**, and the value an operator compares against the ceremony record so
  nobody has to eyeball base64. Do not hand-write it.
- `http.credentialHosts` — the same-origin rule's explicit exceptions.
  Credentials configured for the update source are attached only to hosts
  same-origin with `update.source`, plus this list, so a tampered catalog
  cannot redirect a token at an attacker. Empty by default, and the rule exists
  before the first credential does because the failure it prevents is silent.
- `fleet.enabled`, `fleet.url` — may this device dial out. A product fact with
  a baked default.

## Generating a development `meta/`

```sh
bash pkgs/rauc/gen-dev-keys.sh                     # --domain rauc, the default
bash pkgs/rauc/gen-dev-keys.sh --domain updates    # the package signing key too
```

`rootfs/build.sh` runs the first form as `--if-absent` on every build, so a
fresh checkout builds an image without any manual step and says loudly that it
did. Whatever it writes is flagged development-grade **forever after** by
`meta/GENERATED`, which names the domains it generated; production material is
**placed** in `meta/` by an operator and arrives without that marker.

The signature algorithm each key gets is declared in
`pkgs/rauc/key-algorithms.env`, not chosen inside the generator, and
`rootfs/build.sh` refuses both a declared value outside its role's allowed set
and material in `meta/` outside it.
