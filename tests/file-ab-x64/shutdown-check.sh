#!/usr/bin/env bash
# Require the exitrd to release the file-backed root and its SYSTEM filesystem.
set -euo pipefail
log=${1:?boot log required}
grep -F 'Entering exitrd...' "$log" >/dev/null
grep -F 'All filesystems, swaps, loop devices, MD devices and DM devices detached.' "$log" >/dev/null
if grep -E 'Unable to finalize remaining|Failed to execute shutdown binary|Failed to switch root to' "$log"; then
    exit 1
fi
