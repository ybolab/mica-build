//! `rauc-verify` — device-side TUF metadata and target verifier
//!.
//!
//! Scriptable contract: exit 0 means verified; any other exit means not
//! verified, with a one-line reason on stderr. On success stdout carries the
//! verified role versions, or — with `--target` — the verified local path of
//! the target file, ready to hand to an installer.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use rauc_sign::client;

#[derive(Debug, Parser)]
#[command(
    name = "rauc-verify",
    about = "Verify a local mos TUF repository from the baked signing keys"
)]
struct Cli {
    /// Repository directory (containing metadata/ and targets/).
    #[arg(long)]
    repo: PathBuf,
    /// JSON file recording the highest verified version per role. Created on
    /// first use; must live on persistent storage, because it is what makes
    /// rollback protection hold across restarts.
    #[arg(long)]
    state: PathBuf,
    /// Verify this target's bytes and print its verified local path.
    #[arg(long)]
    target: Option<String>,
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match &cli.target {
        Some(name) => client::verify_baked_target(&cli.repo, &cli.state, name)
            .await
            .map(|path| path.display().to_string()),
        None => client::verify_baked(&cli.repo, &cli.state)
            .await
            .map(|report| {
                format!(
                    "OK root v{} targets v{} snapshot v{} timestamp v{}",
                    report.root().signed.version,
                    report.targets().signed.version,
                    report.snapshot().signed.version,
                    report.timestamp().signed.version
                )
            }),
    };
    match result {
        Ok(line) => {
            println!("{line}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            // One line, alternate format: the whole context chain colon-joined.
            eprintln!("rauc-verify: {err:#}");
            ExitCode::FAILURE
        }
    }
}
