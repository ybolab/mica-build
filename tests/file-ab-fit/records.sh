#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v docker >/dev/null
mkdir -p _out/tests
image=$(bash build-env/from.sh --arch=amd64 --ref LOCAL_MOS_BUILD_C)
# mos-build-side: container-block -- compile and execute with the pinned C toolchain.
docker run --rm --label ai-agent=true --network traefik -v "$PWD:/src:ro" -v "$PWD/_out/tests:/out" \
    --entrypoint /bin/bash "$image" -ceu '
    gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
        /src/tests/file-ab-fit/records.c -o /out/fit-records
    timeout 15 /out/fit-records
'
# mos-build-side: host
