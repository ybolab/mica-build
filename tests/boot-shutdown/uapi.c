/* Compile-only Linux UAPI proof. No device is opened by this fixture. */
#include <stddef.h>
#include <linux/loop.h>
#include <linux/watchdog.h>
#include <sys/ioctl.h>
_Static_assert(sizeof(struct watchdog_info) == 40, "watchdog size");
_Static_assert(_Alignof(struct watchdog_info) == 4, "watchdog alignment");
_Static_assert(offsetof(struct watchdog_info, options) == 0, "watchdog options");
_Static_assert(offsetof(struct watchdog_info, firmware_version) == 4, "watchdog firmware");
_Static_assert(offsetof(struct watchdog_info, identity) == 8, "watchdog identity");
_Static_assert(sizeof(struct loop_info64) == 232, "loop size");
_Static_assert(_Alignof(struct loop_info64) == 8, "loop alignment");
_Static_assert(offsetof(struct loop_info64, lo_device) == 0, "loop device");
_Static_assert(offsetof(struct loop_info64, lo_inode) == 8, "loop inode");
_Static_assert(offsetof(struct loop_info64, lo_rdevice) == 16, "loop rdevice");
_Static_assert(offsetof(struct loop_info64, lo_offset) == 24, "loop offset");
_Static_assert(offsetof(struct loop_info64, lo_sizelimit) == 32, "loop limit");
_Static_assert(offsetof(struct loop_info64, lo_number) == 40, "loop number");
_Static_assert(offsetof(struct loop_info64, lo_encrypt_type) == 44, "loop encryption");
_Static_assert(offsetof(struct loop_info64, lo_encrypt_key_size) == 48, "loop key size");
_Static_assert(offsetof(struct loop_info64, lo_flags) == 52, "loop flags");
_Static_assert(offsetof(struct loop_info64, lo_file_name) == 56, "loop filename");
_Static_assert(offsetof(struct loop_info64, lo_crypt_name) == 120, "loop crypt name");
_Static_assert(offsetof(struct loop_info64, lo_encrypt_key) == 184, "loop key");
_Static_assert(offsetof(struct loop_info64, lo_init) == 216, "loop init");
_Static_assert(WDIOC_GETSUPPORT == 0x80285700, "watchdog support request");
_Static_assert(WDIOC_GETTIMEOUT == 0x80045707, "watchdog timeout request");
_Static_assert(WDIOC_KEEPALIVE == 0x80045705, "watchdog keepalive request");
_Static_assert(LOOP_GET_STATUS64 == 0x4c05, "loop status request");
_Static_assert(LOOP_CLR_FD == 0x4c01, "loop detach request");
