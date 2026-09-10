#!/usr/bin/env bash
# Offline target trees; no target executable, compiler, network or image build.
set -euo pipefail
command -v python3 >/dev/null
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
exec python3 "$ROOT/tests/rootfs-runtime/selection_test.py"
