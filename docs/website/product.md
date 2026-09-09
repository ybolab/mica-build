# Page brief: Product

- **Purpose**: answer "what is mos" in one screen, honestly, for a visitor who
  has never seen the repository.
- **Audience**: product integrators evaluating an embedded OS; technical
  decision makers skimming before delegating the evaluation.
- **Navigation position**: page 1, the site landing content. Links forward to
  [embedded differences](embedded.md), [downloads](downloads.md) and the
  [documentation portal](documentation.md).

## Content outline

1. One-sentence definition and the four properties that define the system.
2. "Built from" — the concrete architecture, one paragraph, linking to
   [../architecture.md](../architecture.md) for the full map.
3. "Who it is for" — the integrator framing.
4. "What it is not" — explicit non-goals, stated as plainly as the goals.

## Draft copy

### What mos is

mos is an embedded appliance operating system: a read-only Debian root under
systemd, updated through signed file deployments, managed by a small Rust plane that owns
the device's settings and drives systemd to match them.

Four properties define it:

**The root filesystem is read-only and integrity-verified.** Each system image
is a squashfs sealed by a dm-verity hash tree; every block read at runtime is
checked against a root hash fixed at build time. There is no configuration
drift, because there is nothing on the root to drift.

> status: shipped — evidence: `rootfs/build.sh`, `docs/design/ro-root.md`

**Updates publish authenticated deployments.** Kernel/support and root components
are installed independently. Objects are verified and synced before the native
boot record is activated. The health gate confirms a successful boot; a failed
candidate has three attempts before the retained deployment is selected. Normal
updates preserve shared DATA and never replace boot firmware. Physical-board
power-loss and watchdog qualification remain separate from VM evidence.

> status: shipped — evidence: `pkgs/mos-deploy/`, `docs/design/uboot-ab-handshake.md`, `rootfs/compose/90-pack.Dockerfile`

**One management plane owns the device.** `mosd` holds the settings tree and
reconciles it into systemd units — networking, Wi-Fi, SSH, containers, MQTT —
and `apid` serves the authenticated HTTPS API those settings are read and
written through, with a built-in web UI as one client of that API.

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/mosd.md`, `docs/design/api.md`

**Applications ride on top, not inside.** Native applications enter the image
as build-time Debian packages and update with the system; independently
released applications run as pinned OCI containers under podman and Quadlet,
off by default until the integrator enables them.

> status: shipped — evidence: `pkgs/podman/`, `docs/design/containers.md`

### Who it is for

mos is for teams that ship a device, not a distribution: a product integrator
who selects the board, owns the application, and needs the OS underneath to be
reproducible, updatable in the field, and recoverable when an update goes
wrong. The default trust model is a trusted integrator with full control of
the image, not an untrusted app marketplace.

### What mos is not

- **Not a general-purpose Linux distribution.** There is no on-device `apt`,
  no interactive package installation, and no expectation that a user logs in
  to administer it.

> status: shipped — evidence: `rootfs/compose/90-pack.Dockerfile`

- **Not a cloud or server CoreOS.** mos leads with boards, factory and offline
  setup, bounded flash and field recovery — see
  [embedded differences](embedded.md).
- **Not a fleet management service.** mos ships authenticated LAN management;
  a cloud fleet control plane is a separate product decision that has not been
  made.

> status: proposed — evidence: `docs/plan/PLAN-054.md`
