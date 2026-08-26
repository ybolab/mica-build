#!/bin/sh
# Append the dm-verity hash tree, pad to a whole MiB, and write the parameters out.
#
# Called from os/rootfs/stages/90-pack.Dockerfile (pack stage), where the reasoning lives.
# Build arguments read from the environment: VERITY_SALT, VERITY_UUID, VERITY_HASH_ALGO, VERITY_DATA_BLOCK_SIZE,
#   VERITY_HASH_BLOCK_SIZE.

set -eu
    test -n "${VERITY_SALT}" && test -n "${VERITY_UUID}"
    sq_bytes="$(stat -c %s /out/rootfs.squashfs)"
    if [ $((sq_bytes % VERITY_DATA_BLOCK_SIZE)) -ne 0 ]; then
        echo "error: squashfs size ${sq_bytes} is not a multiple of ${VERITY_DATA_BLOCK_SIZE}" >&2; exit 1
    fi
    data_blocks=$((sq_bytes / VERITY_DATA_BLOCK_SIZE))
    hash_start_block=$((sq_bytes / VERITY_HASH_BLOCK_SIZE))
    cp /out/rootfs.squashfs /out/rootfs-verity.img
    root_hash="$(veritysetup format /out/rootfs-verity.img /out/rootfs-verity.img \
        --hash="${VERITY_HASH_ALGO}" \
        --data-block-size="${VERITY_DATA_BLOCK_SIZE}" \
        --hash-block-size="${VERITY_HASH_BLOCK_SIZE}" \
        --data-blocks="${data_blocks}" \
        --hash-offset="${sq_bytes}" \
        --salt="${VERITY_SALT}" \
        --uuid="${VERITY_UUID}" \
        | awk '/^Root hash:/ { print $NF }')"
    test -n "${root_hash}"
    raw_bytes="$(stat -c %s /out/rootfs-verity.img)"
    image_bytes=$(( (raw_bytes + 1048575) / 1048576 * 1048576 ))
    truncate -s "${image_bytes}" /out/rootfs-verity.img
    rm -f /out/rootfs.squashfs
    { echo "VERITY_ROOT_HASH=${root_hash}"
      echo "VERITY_SALT=${VERITY_SALT}"
      echo "VERITY_UUID=${VERITY_UUID}"
      echo "VERITY_HASH_ALGO=${VERITY_HASH_ALGO}"
      echo "VERITY_DATA_BLOCK_SIZE=${VERITY_DATA_BLOCK_SIZE}"
      echo "VERITY_HASH_BLOCK_SIZE=${VERITY_HASH_BLOCK_SIZE}"
      echo "VERITY_DATA_BLOCKS=${data_blocks}"
      echo "VERITY_HASH_START_BLOCK=${hash_start_block}"
      echo "VERITY_DATA_SECTORS=$((sq_bytes / 512))"
      echo "SQUASHFS_BYTES=${sq_bytes}"
      echo "IMAGE_BYTES=${image_bytes}"
    } > /out/rootfs-verity.env
    echo "pack: squashfs ${sq_bytes} B + verity -> ${raw_bytes} B -> padded ${image_bytes} B"
    echo "pack: root hash ${root_hash}"
