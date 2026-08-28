#!/usr/bin/env bash
# Throwaway helper: run a command in the workspace's Rust container.
set -euo pipefail
docker run --rm \
  -v /srv/bkd/worktrees/u51kzjlk/xkoq9feb:/src \
  -v /srv/mos-rust-tools:/tools \
  -e PATH=/tools/bin:/opt/rust/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -e LD_LIBRARY_PATH=/opt/rust/lib \
  -w "${WD:-/src/os/pkgs/mosd}" \
  localhost/mos-build-rust bash -c "$1"
