#!/bin/bash
# mos-build-side: container -- sign the complete kernel/DTB/initramfs configuration.
set -euo pipefail
export SOURCE_DATE_EPOCH=1577836800
bash /tools/initramfs.sh /tmp/initramfs aa64
test "$(stat -c%s /input/kernel)" -le 134217728
test "$(stat -c%s /output/initramfs.cpio)" -le 67108864
mkdir -p /tmp/fit-keys
ln -s /signing/key.pem /tmp/fit-keys/mos.key
ln -s /signing/cert.pem /tmp/fit-keys/mos.crt
cd /output
cat > boot.its <<'ITS'
/dts-v1/;
/ {
    description = "MOS authenticated kernel package";
    #address-cells = <1>;
    images {
        kernel { description = "YBO - Hub OS Linux kernel"; data = /incbin/("/input/kernel"); type = "kernel"; arch = "arm64"; os = "linux"; compression = "none";
            load = <0x42000000>; entry = <0x42000000>; hash { algo = "sha256"; }; };
        fdt { description = "CX3576-Z device tree"; data = /incbin/("/input/board.dtb"); type = "flat_dt"; arch = "arm64"; compression = "none";
            load = <0x52000000>; hash { algo = "sha256"; }; };
        ramdisk { description = "MOS authenticated boot and shutdown environment"; data = /incbin/("initramfs.cpio"); type = "ramdisk"; arch = "arm64"; os = "linux"; compression = "none";
            load = <0x54000000>; hash { algo = "sha256"; }; };
    };
    configurations {
        default = "conf";
        conf { description = "YBO - Hub OS signed boot"; kernel = "kernel"; fdt = "fdt"; ramdisk = "ramdisk";
            signature { algo = "sha256,rsa2048"; key-name-hint = "mos"; sign-images = "kernel", "fdt", "ramdisk"; }; };
    };
};
ITS
mkimage -f boot.its -k /tmp/fit-keys -r boot.itb
printf '/dts-v1/; / {};' | dtc -I dts -O dtb -o control.dtb
fdt_add_pubkey -a sha256,rsa2048 -k /tmp/fit-keys -n mos -r conf control.dtb
fit_check_sign -f boot.itb -k control.dtb
test "$(stat -c%s boot.itb)" -le 134217728
printf '%s\n' 'MOS_SIGNED_FIT_KERNEL_PASS'
