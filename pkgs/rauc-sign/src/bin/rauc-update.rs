//! `rauc-update` — device-side update client.
//!
//! Four subcommands, each scriptable the way `rauc-verify` is (exit 0 means
//! the thing happened; a one-line reason on stderr otherwise):
//!
//! - `sync`: mirror the repository's metadata over plain HTTP into a local
//!   directory. Unverified input to the verified walk, never a substitute.
//! - `check`: verify the mirrored repository from the pinned root and select
//!   the newest target compatible with this device's board, profile, channel,
//!   schema floor and running version. Prints `selected ...` or `none`, with
//!   the reason per rejected candidate; exit 2 when nothing is compatible.
//! - `fetch`: `check`, then download the selected bundle resumably (HTTP
//!   range requests) into a byte-budgeted reserve directory, verifying sha256
//!   and length against the signed metadata before reporting the path.
//! - `import`: the offline path — the same selection and verification over a
//!   "lockbox" directory (full metadata plus bundle, `rauc-sign lockbox`),
//!   then stage the bundle into the reserve directory.
//!
//! No flag skips metadata or digest verification; there is none to add. The
//! last stdout line of a successful `fetch`/`import` is the verified local
//! bundle path, ready to hand to an installer; `--install` hands it to
//! `rauc install` directly (mosd's D-Bus `InstallUpdate` is the orchestrated
//! route and is documented in `docs/design/release-signing.md`, not linked
//! here — a bus stack is mosd's dependency, not this crate's).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result, ensure};
use clap::{Args, Parser, Subcommand};
use rauc_sign::update::{self, Candidate, DeviceIdentity, Selection};
use url::Url;

#[derive(Debug, Parser)]
#[command(
    name = "rauc-update",
    about = "Discover, download and import mos updates from a signed TUF repository"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Mirror the repository's metadata over plain HTTP into a local
    /// directory (unverified; `check` verifies from the pinned root).
    Sync {
        /// Base URL of the published repository (the directory holding
        /// metadata/ and targets/).
        #[arg(long)]
        url: Url,
        /// Local mirror directory to write metadata/ into.
        #[arg(long)]
        repo: PathBuf,
    },
    /// Verify the repository and select the newest compatible target.
    Check {
        #[command(flatten)]
        repo: RepoArgs,
        #[command(flatten)]
        selection: SelectionArgs,
    },
    /// Select, then download the bundle resumably into the reserve directory
    /// and verify it against the signed metadata.
    Fetch {
        #[command(flatten)]
        repo: RepoArgs,
        #[command(flatten)]
        selection: SelectionArgs,
        /// Base URL of the published repository, for the bundle bytes.
        #[arg(long)]
        url: Url,
        #[command(flatten)]
        reserve: ReserveArgs,
        /// Hand the verified bundle to `rauc install` after staging.
        #[arg(long)]
        install: bool,
    },
    /// Select, verify and stage a bundle from an offline lockbox directory.
    Import {
        /// Lockbox directory: full TUF metadata plus bundle(s), as produced
        /// by `rauc-sign lockbox` (e.g. mounted USB/SD media).
        #[arg(long)]
        lockbox: PathBuf,
        /// Pinned trusted root metadata, provisioned out of band.
        #[arg(long)]
        root: PathBuf,
        /// Persistent per-role version state (see `rauc-verify --state`).
        #[arg(long)]
        state: PathBuf,
        #[command(flatten)]
        selection: SelectionArgs,
        #[command(flatten)]
        reserve: ReserveArgs,
        /// Hand the verified bundle to `rauc install` after staging.
        #[arg(long)]
        install: bool,
    },
}

#[derive(Debug, Args)]
struct RepoArgs {
    /// Local repository directory (metadata/ and, for file-sourced targets,
    /// targets/), e.g. the directory `sync` mirrors into.
    #[arg(long)]
    repo: PathBuf,
    /// Pinned trusted root metadata, provisioned out of band.
    #[arg(long)]
    root: PathBuf,
    /// Persistent per-role version state (see `rauc-verify --state`).
    #[arg(long)]
    state: PathBuf,
}

#[derive(Debug, Args)]
struct SelectionArgs {
    /// Device identity file (BOARD=, PROFILE=, VERSION= lines).
    #[arg(long, default_value = update::DEFAULT_IDENTITY_PATH)]
    identity: PathBuf,
    /// Override (or, together with --profile and --current-version, replace)
    /// the identity file's board.
    #[arg(long)]
    board: Option<String>,
    /// Override the identity file's profile.
    #[arg(long)]
    profile: Option<String>,
    /// Override the identity file's running release version.
    #[arg(long)]
    current_version: Option<String>,
    /// Release channel to follow.
    #[arg(long, default_value = "stable")]
    channel: String,
    /// Permit selecting a version not newer than the running one. Logged;
    /// there is no flag that skips verification.
    #[arg(long)]
    allow_downgrade: bool,
}

impl SelectionArgs {
    fn identity(&self) -> Result<DeviceIdentity> {
        if let (Some(board), Some(profile), Some(version)) =
            (&self.board, &self.profile, &self.current_version)
        {
            return Ok(DeviceIdentity {
                board: board.clone(),
                profile: profile.clone(),
                version: version.clone(),
            });
        }
        let mut identity = DeviceIdentity::from_env_file(&self.identity)?;
        if let Some(board) = &self.board {
            identity.board = board.clone();
        }
        if let Some(profile) = &self.profile {
            identity.profile = profile.clone();
        }
        if let Some(version) = &self.current_version {
            identity.version = version.clone();
        }
        Ok(identity)
    }
}

#[derive(Debug, Args)]
struct ReserveArgs {
    /// Reserved directory the bundle is staged into.
    #[arg(long)]
    reserve_dir: PathBuf,
    /// Byte budget the reserve directory's content must never exceed.
    #[arg(long)]
    max_bytes: u64,
}

/// Prints the selection the way `check` reports it and returns the chosen
/// candidate, logging an admitted downgrade — the audit trail
/// `--allow-downgrade` owes.
fn report_selection(selection: &Selection) -> Option<&Candidate> {
    for (name, reason) in &selection.rejected {
        println!("rejected {name}: {reason}");
    }
    match &selection.selected {
        Some(candidate) => {
            if candidate.downgrade {
                eprintln!(
                    "rauc-update: warning: selecting {} version {} although it is not \
                     newer than the running version (--allow-downgrade)",
                    candidate.name, candidate.version
                );
            }
            println!(
                "selected {} version {} channel {} ({} bytes)",
                candidate.name, candidate.version, candidate.channel, candidate.length
            );
            Some(candidate)
        }
        None => {
            println!("none");
            None
        }
    }
}

/// Hands the verified bundle to RAUC. mosd's D-Bus `InstallUpdate` is the
/// orchestrated route (progress recorded in mosd's live state); this direct
/// call is the documented fallback and the two install the same bundle.
fn install(path: &Path) -> Result<()> {
    let status = std::process::Command::new("rauc")
        .arg("install")
        .arg(path)
        .status()
        .context("run rauc install (is rauc on PATH?)")?;
    ensure!(status.success(), "rauc install failed with {status}");
    Ok(())
}

/// Exit code for "nothing compatible": distinct from both success and error,
/// so a poll loop can tell "up to date" from "broken".
const EXIT_NONE: u8 = 2;

async fn run() -> Result<ExitCode> {
    let cli = Cli::parse();
    match cli.command {
        Command::Sync { url, repo } => {
            let report = update::sync_metadata(&url, &repo).await?;
            println!(
                "synced root v{} snapshot v{} targets v{} into {}",
                report.root_version,
                report.snapshot_version,
                report.targets_version,
                repo.display()
            );
        }
        Command::Check { repo, selection } => {
            let identity = selection.identity()?;
            let outcome = update::check(
                &repo.repo,
                &repo.root,
                &repo.state,
                &identity,
                &selection.channel,
                selection.allow_downgrade,
            )
            .await?;
            if report_selection(&outcome).is_none() {
                return Ok(ExitCode::from(EXIT_NONE));
            }
        }
        Command::Fetch {
            repo,
            selection,
            url,
            reserve,
            install: do_install,
        } => {
            let identity = selection.identity()?;
            let outcome = update::check(
                &repo.repo,
                &repo.root,
                &repo.state,
                &identity,
                &selection.channel,
                selection.allow_downgrade,
            )
            .await?;
            let Some(candidate) = report_selection(&outcome) else {
                return Ok(ExitCode::from(EXIT_NONE));
            };
            let report =
                update::fetch(&url, candidate, &reserve.reserve_dir, reserve.max_bytes).await?;
            if report.resumed_from > 0 && report.fetched > 0 {
                eprintln!(
                    "rauc-update: resumed at byte {} ({} bytes fetched)",
                    report.resumed_from, report.fetched
                );
            }
            println!("{}", report.path.display());
            if do_install {
                install(&report.path)?;
            }
        }
        Command::Import {
            lockbox,
            root,
            state,
            selection,
            reserve,
            install: do_install,
        } => {
            let identity = selection.identity()?;
            let outcome = update::check(
                &lockbox,
                &root,
                &state,
                &identity,
                &selection.channel,
                selection.allow_downgrade,
            )
            .await?;
            let Some(candidate) = report_selection(&outcome) else {
                return Ok(ExitCode::from(EXIT_NONE));
            };
            let report = update::import_selected(
                &lockbox,
                &root,
                &state,
                candidate,
                &reserve.reserve_dir,
                reserve.max_bytes,
            )
            .await?;
            println!("{}", report.path.display());
            if do_install {
                install(&report.path)?;
            }
        }
    }
    Ok(ExitCode::SUCCESS)
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(code) => code,
        Err(err) => {
            // One line, alternate format: the whole context chain colon-joined.
            eprintln!("rauc-update: {err:#}");
            ExitCode::FAILURE
        }
    }
}
