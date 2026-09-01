//! `rauc-sign` — release-side TUF repository tool for mos.

use std::path::PathBuf;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use clap::{Args, Parser, Subcommand};
use rauc_sign::keys;
use rauc_sign::repo::{self, Expirations};

/// Default location for generated development keys. Gitignored; never populated
/// with anything that goes near a production release.
const DEFAULT_KEYS_DIR: &str = "pkgs/rauc-sign/.devkeys";

#[derive(Debug, Parser)]
#[command(
    name = "rauc-sign",
    about = "Sign and verify the mos TUF update repository"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Generate a fresh ed25519 key per role into a gitignored directory.
    GenDevKeys {
        /// Directory to write `<role>.pk8` files into.
        #[arg(long, default_value = DEFAULT_KEYS_DIR)]
        keys_dir: PathBuf,
        /// Generate a key only for this role; repeatable. Defaults to all four.
        /// A rotation ceremony wants `--role root` on its own, so no unused copy
        /// of an online key is written to the offline media.
        #[arg(long = "role", value_name = "ROLE")]
        roles: Vec<String>,
    },
    /// Create an empty TUF repository with all four roles at version 1.
    Init {
        #[command(flatten)]
        common: Common,
        /// Signature threshold for every role.
        #[arg(long, default_value_t = 1)]
        threshold: u64,
        /// `root.json` expiration, RFC 3339. Only `init` signs the root role.
        #[arg(long, value_parser = parse_time)]
        root_expires: DateTime<Utc>,
        #[command(flatten)]
        expires: ExpiryArgs,
    },
    /// Add a RAUC bundle as a target and re-sign.
    Add {
        #[command(flatten)]
        common: Common,
        /// The `.raucb` bundle to publish.
        #[arg(long)]
        target: PathBuf,
        /// Target name in the metadata; defaults to the file name.
        #[arg(long)]
        name: Option<String>,
        /// dm-verity root hash of the bundle, 64 hex characters.
        #[arg(long)]
        verity_root_hash: String,
        /// Optional release version recorded in the target's custom block.
        #[arg(long)]
        release_version: Option<String>,
        #[command(flatten)]
        expires: ExpiryArgs,
    },
    /// Re-sign the repository, bumping snapshot and timestamp.
    Sign {
        #[command(flatten)]
        common: Common,
        /// Explicit snapshot version; defaults to the current version plus one.
        #[arg(long)]
        snapshot_version: Option<u64>,
        /// Explicit timestamp version; defaults to the current version plus one.
        #[arg(long)]
        timestamp_version: Option<u64>,
        /// Permit an explicit version below the published one. Without this,
        /// publishing a rollback is an error rather than a silent success.
        #[arg(long)]
        allow_rollback: bool,
        #[command(flatten)]
        expires: ExpiryArgs,
    },
    /// Rotate the root key: publish the next root version, signed by the
    /// outgoing key AND the incoming one, so clients pinned to either anchor
    /// accept it. The offline ceremony; needs no online key.
    RotateRoot {
        #[command(flatten)]
        common: Common,
        /// Directory holding the freshly generated `root.pk8` that takes over
        /// the root role. `--keys-dir` must still hold the outgoing one.
        #[arg(long)]
        new_keys_dir: PathBuf,
        /// New `root.json` expiration, RFC 3339.
        #[arg(long, value_parser = parse_time)]
        root_expires: DateTime<Utc>,
    },
    /// Replace the ONLINE role keys (targets, snapshot, timestamp): publish
    /// the next root version binding fresh keys and re-sign the online
    /// metadata with them, revoking the outgoing keys. The recovery for a
    /// compromised or retiring release host; an offline ceremony -- needs the
    /// root key and the incoming online keys, and the trust anchor does not
    /// change hands.
    RotateOnline {
        #[command(flatten)]
        common: Common,
        /// Directory holding the freshly generated `targets.pk8`,
        /// `snapshot.pk8` and `timestamp.pk8` that take over the online roles.
        /// `--keys-dir` holds the (unchanged) root key.
        #[arg(long)]
        new_keys_dir: PathBuf,
        /// New `root.json` expiration, RFC 3339.
        #[arg(long, value_parser = parse_time)]
        root_expires: DateTime<Utc>,
        #[command(flatten)]
        expires: ExpiryArgs,
    },
    /// Re-sign root at its annual expiry with the SAME key: a new version and a
    /// new expiration, no change of trust anchor and nothing to redistribute.
    /// Not a rotation -- see `rotate-root` for that.
    RefreshRoot {
        #[command(flatten)]
        common: Common,
        /// New `root.json` expiration, RFC 3339.
        #[arg(long, value_parser = parse_time)]
        root_expires: DateTime<Utc>,
    },
    /// Verify a repository offline against a trusted root.
    Verify {
        /// Repository directory.
        #[arg(long)]
        repo: PathBuf,
        /// Trusted root metadata, obtained out of band. Required: verifying a
        /// repository against its own metadata/root.json proves only that it
        /// is internally consistent, which an attacker-authored repository is
        /// too.
        #[arg(long)]
        root: PathBuf,
        /// Directory holding previously trusted metadata, enabling rollback checks.
        #[arg(long)]
        datastore: Option<PathBuf>,
    },
}

#[derive(Debug, Args)]
struct Common {
    /// Repository directory.
    #[arg(long)]
    repo: PathBuf,
    /// Directory holding the `<role>.pk8` signing keys.
    #[arg(long, default_value = DEFAULT_KEYS_DIR)]
    keys_dir: PathBuf,
}

/// Expiration instants, always explicit so a release is reproducible and tests
/// never depend on the wall clock.
#[derive(Debug, Args)]
struct ExpiryArgs {
    /// `targets.json` expiration, RFC 3339.
    #[arg(long, value_parser = parse_time)]
    targets_expires: DateTime<Utc>,
    /// `snapshot.json` expiration, RFC 3339.
    #[arg(long, value_parser = parse_time)]
    snapshot_expires: DateTime<Utc>,
    /// `timestamp.json` expiration, RFC 3339.
    #[arg(long, value_parser = parse_time)]
    timestamp_expires: DateTime<Utc>,
}

impl From<&ExpiryArgs> for Expirations {
    fn from(args: &ExpiryArgs) -> Self {
        Self {
            targets: args.targets_expires,
            snapshot: args.snapshot_expires,
            timestamp: args.timestamp_expires,
        }
    }
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|e| format!("{value:?} is not an RFC 3339 timestamp: {e}"))
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::GenDevKeys { keys_dir, roles } => {
            let selected: Vec<&str> = if roles.is_empty() {
                keys::ROLES.to_vec()
            } else {
                roles.iter().map(String::as_str).collect()
            };
            for path in keys::generate_roles(&keys_dir, &selected)? {
                println!("wrote {}", path.display());
            }
            println!("keep these out of git; the root key is offline material");
        }
        Command::Init {
            common,
            threshold,
            root_expires,
            expires,
        } => {
            repo::init(
                &common.repo,
                &common.keys_dir,
                threshold,
                root_expires,
                (&expires).into(),
            )
            .await?;
            println!("initialized {}", common.repo.display());
        }
        Command::Add {
            common,
            target,
            name,
            verity_root_hash,
            release_version,
            expires,
        } => {
            let added = repo::add(
                &common.repo,
                &common.keys_dir,
                &target,
                name.as_deref(),
                &verity_root_hash,
                release_version.as_deref(),
                (&expires).into(),
            )
            .await?;
            println!("added target {}", added.raw());
        }
        Command::Sign {
            common,
            snapshot_version,
            timestamp_version,
            allow_rollback,
            expires,
        } => {
            repo::resign(
                &common.repo,
                &common.keys_dir,
                snapshot_version,
                timestamp_version,
                allow_rollback,
                (&expires).into(),
            )
            .await?;
            println!("re-signed {}", common.repo.display());
        }
        Command::RotateRoot {
            common,
            new_keys_dir,
            root_expires,
        } => {
            let version = repo::rotate_root(
                &common.repo,
                &common.keys_dir,
                Some(&new_keys_dir),
                root_expires,
            )
            .await?;
            println!("rotated root to v{version} in {}", common.repo.display());
            println!(
                "distribute metadata/{version}.root.json as the new trust anchor; \
                 clients still pinned to an older root reach it through this file"
            );
        }
        Command::RotateOnline {
            common,
            new_keys_dir,
            root_expires,
            expires,
        } => {
            let version = repo::rotate_online_keys(
                &common.repo,
                &common.keys_dir,
                &new_keys_dir,
                root_expires,
                (&expires).into(),
            )
            .await?;
            println!(
                "rotated the online keys; root is v{version} in {}",
                common.repo.display()
            );
            println!(
                "the outgoing targets/snapshot/timestamp keys are revoked; destroy them, \
                 move the incoming keys to the release host, and record the incident \
                 if this rotation is a response to compromise"
            );
        }
        Command::RefreshRoot {
            common,
            root_expires,
        } => {
            let version =
                repo::rotate_root(&common.repo, &common.keys_dir, None, root_expires).await?;
            println!(
                "refreshed root to v{version} in {} (same key; the trust anchor is unchanged)",
                common.repo.display()
            );
        }
        Command::Verify {
            repo: repo_dir,
            root,
            datastore,
        } => {
            let report = repo::verify(&repo_dir, &root, datastore.as_deref())
                .await
                .context("repository verification failed")?;
            println!(
                "OK root v{} timestamp v{} targets {}",
                report.root_version,
                report.timestamp_version,
                report.targets.join(",")
            );
        }
    }
    Ok(())
}
