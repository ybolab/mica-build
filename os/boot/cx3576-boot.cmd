# Source for the boot.scr written into BOOT-A and BOOT-B. Compiled by
# os/mkimage-v2.sh with SOURCE_DATE_EPOCH pinned to the layout-v2 FILE_MTIME.
# Body is verbatim from docs/design/uboot-ab-handshake.md section 5.3
# (RFCT-018); that document is the authority, change it there first.
#
# boot.cmd — mos A/B handshake for CX3576-Z (layout v2).
# Compiled to boot.scr and written to BOTH boot partitions by the assembler.
# Identical in both slots: whichever copy runs may boot either slot.
#
# hush notes: no arithmetic without setexpr; setexpr is HEXADECIMAL, which is
# also the radix RAUC uses for BOOT_x_LEFT. Keep boot-attempts in 1..9.

setenv verityaddr 0x40f00000

# --- defaults, only used on a virgin environment ---------------------------
test -n "${BOOT_ORDER}"  || setenv BOOT_ORDER "A B"
test -n "${BOOT_A_LEFT}" || setenv BOOT_A_LEFT 3
test -n "${BOOT_B_LEFT}" || setenv BOOT_B_LEFT 3

# --- pick the leftmost slot in BOOT_ORDER that still has credits -----------
setenv bootslot
for slot in ${BOOT_ORDER}; do
    if test -n "${bootslot}"; then
        echo "skipping ${slot}"
    elif test "${slot}" = "A"; then
        if test ${BOOT_A_LEFT} -gt 0; then
            setexpr BOOT_A_LEFT ${BOOT_A_LEFT} - 1
            setenv bootslot A
            setenv bootpart 3
            setenv rootpart 5
        fi
    elif test "${slot}" = "B"; then
        if test ${BOOT_B_LEFT} -gt 0; then
            setexpr BOOT_B_LEFT ${BOOT_B_LEFT} - 1
            setenv bootslot B
            setenv bootpart 4
            setenv rootpart 6
        fi
    fi
done

# --- no credits anywhere: refill, persist, reboot --------------------------
if test -z "${bootslot}"; then
    echo "mos: no bootable slot left, resetting attempt counters"
    setenv BOOT_A_LEFT 3
    setenv BOOT_B_LEFT 3
    saveenv
    reset
fi

# --- persist the decrement BEFORE booting: this is what makes it a watchdog -
saveenv

echo "mos: booting slot ${bootslot} (A=${BOOT_A_LEFT} B=${BOOT_B_LEFT} left)"

# --- per-slot verity parameters, from the chosen slot's boot partition ------
# mos-verity.env is a one-line text env file written by the assembler; it
# defines verity_args= with the full dm-mod.create=/dm-mod.waitfor= tail.
if load mmc 0:${bootpart} ${verityaddr} mos-verity.env; then
    env import -t ${verityaddr} ${filesize}
else
    echo "mos: slot ${bootslot} has no mos-verity.env"
    setenv BOOT_${bootslot}_LEFT 0
    saveenv
    reset
fi

# --- machine identity: only when U-Boot actually has one (see section 6) ---
setenv machineid_arg
if test -n "${machine_id}"; then
    setenv machineid_arg "systemd.machine_id=${machine_id}"
fi

setenv consoleargs "console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000"
setenv rootargs "root=/dev/dm-0 rootfstype=squashfs ro rootwait"
setenv bootargs "${rootargs} ${verity_args} ${consoleargs} storagemedia=emmc net.ifnames=0 ${machineid_arg}"

# --- load and go -----------------------------------------------------------
load mmc 0:${bootpart} ${kernel_addr_r} Image
load mmc 0:${bootpart} ${fdt_addr_r} rk3576-src.dtb
booti ${kernel_addr_r} - ${fdt_addr_r}

# booti only returns on failure: burn this slot's remaining credits so the
# next reset moves on instead of retrying a slot we know cannot boot.
echo "mos: booti returned, slot ${bootslot} is bad"
setenv BOOT_${bootslot}_LEFT 0
saveenv
reset
