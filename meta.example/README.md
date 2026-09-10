# `meta.example/` — public factory defaults

`meta.example/updates/manifest.json` is the committed example of the public
factory manifest baked into the read-only root. It contains configuration, not
signing material. Private signing inputs stay on their signing hosts, and
metadata trust anchors are fixed inputs to the authenticated kernel policy
rather than fields in this user-space manifest.

## Current manifest

The current JSON fields and committed example values are:

| JSON path | Example value | Meaning |
| --- | --- | --- |
| `schema` | `"mos/meta/v1"` | The only schema tag accepted by the current reader. |
| `product.vendor` | `"example"` | Product label. |
| `product.model` | `"mos-appliance"` | Product label. |
| `update.source` | `null` | No online update source is configured. |
| `update.channel` | `"stable"` | Default release channel. |
| `update.policy` | `"check"` | Check metadata on the configured interval; this is not `off`. |
| `update.checkIntervalMinutes` | `1440` | Metadata-check interval in minutes. |
| `http.credentialHosts` | `[]` | No additional host may receive update credentials. |
| `fleet.enabled` | `false` | Fleet integration is disabled. |
| `fleet.url` | `null` | No fleet endpoint is configured. |

All fields are required by the current `BakedManifest` shape, including the
nested fields, and unknown fields are refused by its parser. With
`update.source` set to `null`, there is no server to check or fetch from even
though the policy is `check`; offline import remains separate. Fleet is off and
has no endpoint.

If the baked file is missing, unreadable, invalid JSON, uses another schema, or
has an empty update channel, the current runtime reader records an error and
returns these code defaults: schema `mos/meta/v1`, empty product labels,
`source: null`, channel `stable`, policy `check`, interval `1440`, no credential
hosts, and fleet disabled with a null URL.

## Public root-build input

Point `MOS_META_DIR` at a distributed public-only directory with this shape:

```text
updates/manifest.json
GENERATED                 # optional development-grade marker
```

The current root staging step requires a regular, non-symlink manifest, rejects
private-key marker text, copies the manifest to
`/usr/share/mos/meta/updates/manifest.json`, and copies a nonempty `GENERATED`
marker when present. That staging step does not yet run the manifest parser or
schema validation, so prepare the document from the committed example and do
not treat staging alone as schema proof.

No signing directory belongs in this distributed input. The root composer
receives only the public manifest and optional marker; boot, content, and
metadata signing keys remain on their respective signing hosts.

## Development signing inputs

Create an isolated set of development signing inputs with the existing
fresh-directory generator:

```sh
bash pkgs/mos-boot/dev-keys.sh --out /absolute/path/to/new-development-inputs
```

The `--out` directory must not already exist. The generator creates private
boot, content, and metadata signing inputs, their public counterparts, the
public manifest, and a `GENERATED` marker. Its complete output is private
signing-host material, not the directory distributed to root builders. Supply
root builders only the public-only shape above.

The authoritative custody and release rules remain in:

- [Key delivery](../docs/design/key-delivery.md)
- [Release artifacts](../docs/design/release-artifacts.md)
- [Release signing](../docs/design/release-signing.md)
- [Development input generator](../pkgs/mos-boot/dev-keys.sh)
