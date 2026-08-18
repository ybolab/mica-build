# Alpine rootfs maintenance

The `rootfs/` directory maps directly onto the target `/`. Static
configuration, OpenRC services, and board-side scripts belong here:

```text
rootfs/etc/network/interfaces       -> /etc/network/interfaces
rootfs/etc/init.d/rk-board          -> /etc/init.d/rk-board
rootfs/usr/local/bin/...            -> /usr/local/bin/...
```

The Dockerfile installs that layer with `COPY rootfs/ /`. Only dynamic build
actions stay in the Dockerfile:

- install Alpine packages and create the debug accounts;
- inject the kernel modules matching the current kernel and the verified
  AIC8800D80 firmware;
- create the runlevel links for the installed packages with `rc-update`;
- validate the configuration and produce the ext4 image.

Keep the executable bit when adding an init script or a board command.
The `0440` mode of `sudoers.d/wheel` is set explicitly in the build stage
because git records only whether a file is executable, not full Unix modes.

## Build contexts

The build context is this directory, so `COPY rootfs/ /` sees only the
overlay. Kernel modules and firmware arrive through named contexts wired up by
`board/cx3576/Makefile`:

| Context | Source | Used for |
|---|---|---|
| (default) | `rootfs/alpine/` | the `rootfs/` overlay |
| `kernel-out` | `out/kernel/` | `modules.tar` |
| `firmware` | `rootfs/firmware/` | AIC8800D80 U02 blobs |
