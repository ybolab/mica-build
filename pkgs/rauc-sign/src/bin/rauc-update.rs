//! `rauc-update` — device-side update client.
//!
//! Five subcommands, each scriptable the way `rauc-verify` is (exit 0 means
//! the thing happened; a one-line reason on stderr otherwise):
//!
//! - `sync`: mirror the repository's metadata over plain HTTP into a local
//!   directory. Unverified input to the verified walk, never a substitute.
//! - `check`: verify the mirrored repository from the baked signing keys and select
//!   the newest target compatible with this device's board, profile, channel,
//!   schema floor and running version. Prints `selected ...` or `none`, with
//!   the reason per rejected candidate; exit 2 when nothing is compatible.
//! - `probe`: the PLAN-061 readiness probe of the `/mos/updates` workspace
//!   on its own — `/mos` is mounted on the same device as the DATA pool at
//!   `/mnt/data`, no symlink stands in for a workspace directory, a private
//!   probe file is created, fsynced and removed, the pool's free space and
//!   read-only state are reported once. Prints `ready ...` or
//!   `<status> <kind>: <detail>` with status `unavailable` (not mounted, not
//!   the pool) or `degraded` (read-only, exhausted, probe failed); exit 3
//!   for either.
//! - `fetch`: probe, then `check`, then download the selected bundle
//!   resumably (HTTP range requests) into `downloads/` under a byte budget,
//!   verifying sha256 and length against the signed metadata before one
//!   same-filesystem rename lands it in `verified/` and its path is printed.
//! - `import`: the offline path — the same probe, then the same selection and
//!   verification over a "lockbox" directory (full metadata plus bundle,
//!   `rauc-sign lockbox`), then the budget, staging copy and rename into
//!   `verified/`.
//!
//! Both acquiring subcommands answer in that order deliberately: the
//! invocation is validated, then the device, then the repository. Readiness is
//! a device fact that does not depend on the repository, and asking it last
//! makes exit 3 unreachable whenever the metadata walk fails first — a device
//! with a read-only `/mos` would report the repository's error and never its
//! own state. The price is that a degraded workspace answers 3 where an
//! up-to-date device would have answered 2; `check` still answers that
//! question without touching the workspace.
//!
//! No flag skips metadata or digest verification; there is none to add. No
//! flag moves the workspace off `/mos/updates` either: an unready workspace
//! is exit 3 with the status and kind named, never a write somewhere else. The last
//! stdout line of a successful `fetch`/`import` is the verified local bundle
//! path, ready to hand to an installer; `--install` hands it to `rauc
//! install` directly, after checking it is a regular file inside `verified/`
//! (mosd's D-Bus `InstallUpdate` is the orchestrated route and is documented
//! in `docs/design/release-signing.md`, not linked here — a bus stack is
//! mosd's dependency, not this crate's).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result, ensure};
use clap::{Args, Parser, Subcommand};
use rauc_sign::update::{self, Candidate, DeviceIdentity, Selection};
use rauc_sign::workspace::{Unready, Workspace};
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
    /// directory (unverified; `check` verifies from the baked signing keys).
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
    /// Probe the /mos/updates workspace for readiness without acquiring
    /// anything: exit 0 and `ready ...`, or exit 3 and
    /// `unavailable|degraded <kind>: ...`.
    Probe {
        /// Byte budget the workspace's content must never exceed; readiness
        /// requires DATA to back what is still unspent of it.
        #[arg(long)]
        max_bytes: u64,
        /// Bytes that must be free, instead of the unspent budget.
        #[arg(long)]
        need: Option<u64>,
    },
    /// Probe the workspace, select, then download the bundle resumably into
    /// downloads/ and move it into verified/ once it verifies against the
    /// signed metadata.
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
    /// Probe the workspace, then select, verify and stage a bundle from an
    /// offline lockbox directory.
    Import {
        /// Lockbox directory: full TUF metadata plus bundle(s), as produced
        /// by `rauc-sign lockbox` (e.g. mounted USB/SD media).
        #[arg(long)]
        lockbox: PathBuf,
        /// Persistent per-role version state (see `rauc-verify --state`).
        #[arg(long)]
        state: PathBuf,
        #[command(flatten)]
        selection: SelectionArgs,
        /// Byte budget the workspace's content must never exceed.
        #[arg(long)]
        max_bytes: u64,
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
    /// Directory partial downloads are written to. Defaults to the
    /// workspace's downloads/ and must lie inside it; nothing outside
    /// /mos/updates is accepted.
    #[arg(long)]
    reserve_dir: Option<PathBuf>,
    /// Byte budget the workspace's content must never exceed.
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

/// Hands the verified bundle to RAUC — after [`Workspace::installable`] has
/// said it is a regular file inside `verified/`, which the path this binary
/// just produced always is; the check is the guarantee that nothing else
/// ever reaches this line. mosd's D-Bus `InstallUpdate` is the orchestrated
/// route (progress recorded in mosd's live state); this direct call is the
/// documented fallback and the two install the same bundle.
fn install(workspace: &Workspace, path: &Path) -> Result<()> {
    let path = workspace.installable(path)?;
    let status = std::process::Command::new("rauc")
        .arg("install")
        .arg(&path)
        .status()
        .context("run rauc install (is rauc on PATH?)")?;
    ensure!(status.success(), "rauc install failed with {status}");
    Ok(())
}

/// Exit code for "nothing compatible": distinct from both success and error,
/// so a poll loop can tell "up to date" from "broken".
const EXIT_NONE: u8 = 2;

/// Exit code for "the workspace is not ready" (unavailable or degraded):
/// distinct again, so mosd can record a named `update-unavailable` state
/// rather than a generic failure.
const EXIT_UNREADY: u8 = 3;

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
            let outcome = update::check_baked(
                &repo.repo,
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
        Command::Probe { max_bytes, need } => {
            let workspace = Workspace::from_env()?;
            match workspace.probe(max_bytes, need) {
                Ok(ready) => println!(
                    "ready root={} pool={} source={} fs_root={} fstype={} free={} used={} \
                     budget={}",
                    workspace.root().display(),
                    ready.pool,
                    ready.source,
                    ready.fs_root,
                    ready.fstype,
                    ready.free_bytes,
                    ready.used_bytes,
                    ready.max_bytes
                ),
                Err(unready) => {
                    println!("{unready}");
                    return Ok(ExitCode::from(EXIT_UNREADY));
                }
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
            let workspace = Workspace::from_env()?;
            // A reserve directory outside downloads/ is a wrong invocation and
            // is refused before the device is consulted, so it stays exit 1
            // whatever state the workspace is in. `update::fetch` resolves it
            // again for its own use; this call is the argument check.
            workspace.reserve_dir(reserve.reserve_dir.as_deref())?;
            // Readiness before the metadata walk — this is what makes
            // EXIT_UNREADY reachable here at all (see the module doc). The
            // probe inside `update::fetch` re-asks with the exact number of
            // bytes still needed once the candidate is known; this one asks
            // the unspent-budget question `probe` asks.
            workspace
                .probe(reserve.max_bytes, None)
                .map_err(anyhow::Error::new)?;
            let outcome = update::check_baked(
                &repo.repo,
                &repo.state,
                &identity,
                &selection.channel,
                selection.allow_downgrade,
            )
            .await?;
            let Some(candidate) = report_selection(&outcome) else {
                return Ok(ExitCode::from(EXIT_NONE));
            };
            let report = update::fetch(
                &url,
                candidate,
                &workspace,
                reserve.reserve_dir.as_deref(),
                reserve.max_bytes,
            )
            .await?;
            if report.resumed_from > 0 && report.fetched > 0 {
                eprintln!(
                    "rauc-update: resumed at byte {} ({} bytes fetched)",
                    report.resumed_from, report.fetched
                );
            }
            println!("{}", report.path.display());
            if do_install {
                install(&workspace, &report.path)?;
            }
        }
        Command::Import {
            lockbox,
            state,
            selection,
            max_bytes,
            install: do_install,
        } => {
            let identity = selection.identity()?;
            let workspace = Workspace::from_env()?;
            // The same ordering as `fetch`, for the same reason: `import` had
            // the identical hole, with the lockbox walk standing in for the
            // repository one.
            workspace
                .probe(max_bytes, None)
                .map_err(anyhow::Error::new)?;
            let outcome = update::check_baked(
                &lockbox,
                &state,
                &identity,
                &selection.channel,
                selection.allow_downgrade,
            )
            .await?;
            let Some(candidate) = report_selection(&outcome) else {
                return Ok(ExitCode::from(EXIT_NONE));
            };
            let report =
                update::import_baked(&lockbox, &state, candidate, &workspace, max_bytes).await?;
            println!("{}", report.path.display());
            if do_install {
                install(&workspace, &report.path)?;
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
            // An unready workspace is its own exit code, however deep in the
            // chain it sits, so a caller can name the state without parsing.
            if err.downcast_ref::<Unready>().is_some() {
                return ExitCode::from(EXIT_UNREADY);
            }
            ExitCode::FAILURE
        }
    }
}
