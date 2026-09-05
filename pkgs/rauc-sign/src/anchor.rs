//! Bootstrap the TUF walk using only the image's baked package signing keys.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ring::{digest, signature};
use serde_json::Value;
use tough::schema::{Role, Root, Signed};

const MANIFEST: &str = "/usr/share/mos/meta/updates/manifest.json";

/// Repository metadata is untrusted until a baked key authenticates its root.
/// There is no environment, argument or operator-document anchor override.
pub(crate) fn root_bytes(repo: &Path) -> Result<Vec<u8>> {
    // Every stat here names its path. A bare `?` on an `io::Error` reaches the
    // operator as "No such file or directory (os error 2)" and nothing else --
    // true, useless, and indistinguishable between the two directories and the
    // manifest.
    for directory in ["/usr/share/mos/meta", "/usr/share/mos/meta/updates"] {
        ensure!(
            fs::symlink_metadata(directory)
                .with_context(|| format!("stat baked anchor directory {directory}"))?
                .is_dir(),
            "baked anchor directory must be a real directory: {directory}"
        );
    }
    ensure!(
        fs::symlink_metadata(MANIFEST)
            .with_context(|| format!("stat baked manifest {MANIFEST}"))?
            .is_file(),
        "baked manifest must be a regular file, not an alternate anchor link"
    );
    let manifest: Value =
        serde_json::from_slice(&fs::read(MANIFEST).context("read baked manifest")?)
            .context("parse baked manifest")?;
    ensure!(
        manifest["schema"] == "mos/meta/v1",
        "unsupported baked manifest schema"
    );
    let trust = manifest["trust"]
        .as_object()
        .context("missing baked trust object")?;
    ensure!(
        trust
            .keys()
            .all(|key| matches!(key.as_str(), "signingKeys" | "signingKeyIds")),
        "baked trust accepts only signingKeys and signingKeyIds; alternate anchors are refused"
    );
    let encoded = trust
        .get("signingKeys")
        .and_then(Value::as_array)
        .context("missing baked trust.signingKeys")?;
    ensure!(
        !encoded.is_empty(),
        "baked trust.signingKeys is empty; no package key is trusted"
    );
    let mut keys = Vec::new();
    let mut ids = Vec::new();
    for value in encoded {
        let text = value
            .as_str()
            .context("signingKeys entry is not a string")?;
        let key = STANDARD.decode(text).context("decode baked Ed25519 key")?;
        ensure!(
            key.len() == 32 && STANDARD.encode(&key) == text,
            "invalid baked Ed25519 public key"
        );
        ids.push(Value::String(hex::encode(digest::digest(
            &digest::SHA256,
            &key,
        ))));
        keys.push(key);
    }
    ensure!(
        trust.get("signingKeyIds") == Some(&Value::Array(ids)),
        "baked signingKeyIds do not match signingKeys"
    );

    // Start at the earliest root signed by a baked key, then let tough verify
    // each rotation. A freshly baked incoming key may start later in the chain.
    let metadata = repo.join("metadata");
    let mut roots = Vec::new();
    for entry in fs::read_dir(&metadata)
        .with_context(|| format!("read repository metadata directory {}", metadata.display()))?
    {
        let entry = entry.with_context(|| format!("read an entry of {}", metadata.display()))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(version) = name
            .strip_suffix(".root.json")
            .and_then(|v| v.parse::<u64>().ok())
        {
            roots.push((version, entry.path()));
        }
    }
    roots.sort_by_key(|(version, _)| *version);
    roots.push((u64::MAX, metadata.join("root.json")));
    for (_, path) in roots {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => return Err(err).with_context(|| format!("read {}", path.display())),
        };
        let root: Signed<Root> =
            serde_json::from_slice(&bytes).context("parse candidate TUF root")?;
        let message = root
            .signed
            .canonical_form()
            .context("canonicalize candidate TUF root")?;
        if keys.iter().any(|key| {
            root.signatures.iter().any(|sig| {
                signature::UnparsedPublicKey::new(&signature::ED25519, key)
                    .verify(&message, &sig.sig)
                    .is_ok()
            })
        }) {
            return Ok(bytes);
        }
    }
    bail!("repository has no root authenticated by baked trust.signingKeys")
}
