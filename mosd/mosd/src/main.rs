//! mosd — management-plane daemon skeleton.

#![forbid(unsafe_code)]

mod reconciler;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    tracing::info!("mosd skeleton starting");
    let reconcilers = reconciler::all();
    tracing::info!(count = reconcilers.len(), "reconcilers registered");
}
