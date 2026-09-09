#!/bin/bash
# Run acceptance orchestration with the pinned Bun and static Docker client.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
repo=$PWD
bun=$(bash build-env/from.sh --ref IMAGE_BUN_1)
cli=$(bash build-env/from.sh --ref IMAGE_DOCKER_CLI_28)
stamp=$(printf '%s\n%s\n%s\n' "$bun" "$cli" "$(sha256sum verify/Dockerfile)" | sha256sum | cut -c1-16)
image="ai-agent/mos-acceptance-bun:$stamp"
if ! docker image inspect "$image" >/dev/null 2>&1; then
    docker build --label ai-agent=true -t "$image" \
        --build-arg "MOS_BUN_IMAGE=$bun" --build-arg "MOS_DOCKER_CLI_IMAGE=$cli" \
        -f verify/Dockerfile verify
fi
case "$repo" in
    /work/*) host_repo="/srv/station/work/${repo#/work/}";;
    /root/*) host_repo="/srv/station/root/${repo#/root/}";;
    *) host_repo=$repo;;
esac
docker run --rm --label ai-agent=true --network traefik \
    -v "$host_repo:$repo" -v /var/run/docker.sock:/var/run/docker.sock \
    -w "$repo" "$image" bun "$@"
