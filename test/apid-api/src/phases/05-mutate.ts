/**
 * Phase 05 -- mutation, asserted by its effect on the device.
 *
 * A 303 proves only that a handler returned, so every mutation is observed at
 * least twice and never only by its status code: through the bus, where the GET
 * pane renders what mosd holds in settings; and on the device, where reconciler
 * and systemd journal lines reach the captured QEMU console (the guest boots
 * with `systemd.journald.forward_to_console=1`, and `src/console.ts` marks the
 * log before each post, so a match is evidence about this post and not the
 * boot). The hostname is asserted a third time across a reboot, left in
 * `ctx.state` for 07b-postreboot. This phase never posts a static network
 * address (see `networkNoOp`) and never posts to /power/* -- 07 owns taking the
 * guest down.
 */

import { createHash } from "node:crypto";
import { checkbox, UNCHECKED, type HttpResponse } from "../client.ts";
import {
  escapeForPattern,
  expectConsoleAbsent,
  expectConsoleLine,
  observeConsoleLine,
  openConsole,
  type ConsoleLog,
} from "../console.ts";
import type { Phase, PhaseContext } from "../runner.ts";

/**
 * Where this phase leaves the hostname it set, for 07b-postreboot.
 *
 * Exported so the post-reboot phase can import the key instead of repeating a
 * string literal: a typo'd key there would read `undefined`, and an assertion
 * against `undefined` is the kind of check that passes by accident.
 */
export const HOSTNAME_TARGET_STATE_KEY = "05-mutate.hostnameTarget";

/** Rejected by any hostname validator worth the name: a space and a bang. */
const INVALID_HOSTNAME = "not a hostname!";

/** The exact confirm token /ssh/password requires (read from the handler struct). */
const SSH_PASSWORD_CONFIRM = "set-transient-password";

/**
 * A throwaway ed25519 public key. Generated with ssh-keygen, never used to log
 * in anywhere; its private half was destroyed at generation time. It exists to
 * be syntactically valid, so that a rejection is apid's verdict on the write
 * path and not on a malformed blob.
 */
const TEST_KEY_TYPE = "ssh-ed25519";
const TEST_KEY_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIEPuVhBypntFnI+wBOiPwYrYq6qZmkBT/Kemz06SUxYP";
const TEST_KEY_COMMENT = "mos-e2e-apid-suite@invalid";
const TEST_PUBLIC_KEY = `${TEST_KEY_TYPE} ${TEST_KEY_BLOB} ${TEST_KEY_COMMENT}`;

/**
 * The transient SSH password. Fixed rather than random so that the assertion
 * "this string appears nowhere in the console" is reproducible, and distinctive
 * enough that a match is a leak and not a coincidence. 8..72 bytes, as the
 * handler requires.
 */
const TRANSIENT_PASSWORD = "mos-e2e-transient-Zq7Kx3-pw";

// Timeouts. A TCG guest reconciles slowly, so these are generous; each is the
// window the check names in its own text, so a pass never overstates itself.
const PANE_TIMEOUT_MS = 15_000;
const HOSTNAME_CONSOLE_TIMEOUT_MS = 30_000;
const CONTAINER_CONSOLE_TIMEOUT_MS = 90_000;
const SSH_CONSOLE_TIMEOUT_MS = 45_000;
const AUDIT_CONSOLE_TIMEOUT_MS = 30_000;
const LINK_TIMEOUT_MS = 30_000;
/** Let the reconciler finish talking before an absence is asserted over its window. */
const SETTLE_MS = 3_000;

const phase: Phase = {
  id: "05-mutate",
  title: "mutation: hostname, containers, ssh and network, each asserted by its effect on the device",
  assumes:
    "04-readonly ran and changed nothing, so the jar still holds the session 03-login " +
    "established, the device is out of setup mode, and the containers and SSH switches are " +
    "still in the state the image shipped them in. This is the first phase that writes, so " +
    "every effect it asserts on is one it caused itself; it leaves SSH disabled and the " +
    "containers switch off again, and hands 07b-postreboot the hostname it set.",

  async run(ctx) {
    // Opened once and shared: availability is decided here, and every
    // console-backed check below degrades to SKIP -- never to PASS -- if this
    // handle is not usable. See src/console.ts.
    const log = openConsole(ctx.config.consoleLog);
    if (!log.available) {
      ctx.report.note(
        `NOTE: the console log is not usable, so the device-effect half of this phase will ` +
          `SKIP: ${log.unavailableReason ?? "unknown reason"}`,
      );
    } else {
      ctx.report.note(`  observing the device on ${log.path ?? "(none)"} as well as over HTTP`);
    }

    await mutateHostname(ctx, log);
    await mutateContainers(ctx, log);
    await mutateSsh(ctx, log);
    await networkNoOp(ctx, log);
  },
};

export default phase;

// 5.1 hostname

async function mutateHostname(ctx: PhaseContext, log: ConsoleLog): Promise<void> {
  const { report, client, config } = ctx;
  const target = config.hostnameTarget;
  report.note("");
  report.note("  5.1 hostname: the bus read-back, the running hostname, and what survives a reboot");

  // The mark is taken before the post, so everything asserted about the
  // console below is asserted about bytes written after this point and a
  // hostname line from the boot cannot satisfy it.
  const marker = log.mark(`POST /hostname hostname=${target}`);
  const posted = await client.post("/hostname", { hostname: target });
  report.expectStatus(posted, 303, `POST /hostname (hostname=${target}) is accepted with 303`);

  // (a) Through the bus. /hostname renders the value mosd holds in settings,
  // read back over the system bus -- not a value apid kept in memory for the
  // duration of one request. A pane that renders the target is evidence the
  // write reached mosd and came back. Polled, because the pane is rendered from
  // settings that the handler may publish a moment after it answers.
  await expectPane(
    ctx,
    `(a) bus read-back: GET /hostname renders ${target} within ${PANE_TIMEOUT_MS}ms`,
    "/hostname",
    (html) => {
      const value = inputValue(html, "hostname");
      if (value === undefined) {
        return `the pane renders no input named "hostname"; ${describePane(html, "hostname")}`;
      }
      return value === target
        ? true
        : `the hostname input still renders ${JSON.stringify(value)}`;
    },
  );

  // (b) On the device. mosd's hostname reconciler writes /etc/hostname and
  // calls org.freedesktop.hostname1.SetHostname(name, false) to change the
  // running hostname; hostnamed logs that, and journald forwards it to the
  // console. Measured on the live run of 2026-08-24, this image writes
  //
  //     systemd[1]: Hostname set to <mos-e2e-renamed>
  //
  // (the shape it also uses at boot, `Hostname set to <mos>.`), so absence is a
  // failure rather than an unobserved effect. Every candidate requires the new
  // hostname inside the line, so a match is evidence about this rename and not
  // about hostname machinery in general.
  const name = escapeForPattern(target);
  await expectConsoleLine(
    ctx.report,
    log,
    marker,
    new RegExp(`Hostname set to [<"']?${name}`, "i"),
    `(b) device effect: the console carries the running hostname changing to ${target}`,
    {
      timeoutMs: HOSTNAME_CONSOLE_TIMEOUT_MS,
      describePattern: `systemd's \`Hostname set to <${target}>\``,
    },
  );

  // (c) It persists. This is the only one of the three that cannot be
  // satisfied by anything held in memory: a hostname read back after a reboot
  // must have reached the disk. This phase only sets that up; 07b-postreboot
  // is where it is proved.
  ctx.state.set(HOSTNAME_TARGET_STATE_KEY, target);
  report.check(
    ctx.state.get(HOSTNAME_TARGET_STATE_KEY) === target,
    `(c) the hostname target ${JSON.stringify(target)} is left in ` +
      `ctx.state[${JSON.stringify(HOSTNAME_TARGET_STATE_KEY)}] for 07b-postreboot to verify`,
    `expected: ctx.state to carry the target for the post-reboot phase\n` +
      `actual:   ${JSON.stringify(ctx.state.get(HOSTNAME_TARGET_STATE_KEY))}`,
  );

  // A refused write that partially applied would leave the device carrying a
  // name the API said it would not accept. So the refusal is asserted, and
  // then the previous value is re-read over the bus to prove nothing of the
  // rejected one landed.
  const refused = await client.post("/hostname", { hostname: INVALID_HOSTNAME });
  report.expectStatus(
    refused,
    422,
    `POST /hostname with ${JSON.stringify(INVALID_HOSTNAME)} is refused with 422`,
  );
  await expectPane(
    ctx,
    `the refused hostname did not partially apply: /hostname still renders ${target}`,
    "/hostname",
    (html) => {
      const value = inputValue(html, "hostname");
      if (value === undefined) {
        return `the pane renders no input named "hostname"; ${describePane(html, "hostname")}`;
      }
      return value === target
        ? true
        : `the hostname input now renders ${JSON.stringify(value)} -- the refused write ` +
            `applied at least in part`;
    },
  );
}

// 5.2 containers -- the Quadlet bind, exercised in both directions

async function mutateContainers(ctx: PhaseContext, log: ConsoleLog): Promise<void> {
  const { report, client } = ctx;
  report.note("");
  report.note("  5.2 containers: the Quadlet bind mount, on and then off again");

  // Read the switch before posting. If it is already on, mosd has nothing to
  // reconcile and no reconciler lines are expected -- so the console checks
  // below say so and SKIP, rather than going red about a device that was
  // already in the requested state. `assumes` says it arrives off.
  const wasOn = await readSwitch(ctx, "/containers", "enabled");
  const noOpOn =
    wasOn === true
      ? "the containers switch was ALREADY on when this phase posted, so mosd had nothing to " +
        "reconcile and no turn_on lines are expected. This phase assumes the device arrives " +
        "with containers in their shipped state; it did not."
      : undefined;

  const onMark = log.mark("POST /containers/enable enabled=on");
  // A ticked checkbox sends its field; `checkbox(true)` says that once, here.
  const on = await client.post("/containers/enable", { enabled: checkbox(true) });
  report.expectStatus(on, 303, "POST /containers/enable (enabled checked) is accepted with 303");

  // (a) Through the bus: the pane renders mosd's own view of the switch.
  await expectPane(
    ctx,
    `(a) bus read-back: GET /containers shows the switch enabled within ${PANE_TIMEOUT_MS}ms`,
    "/containers",
    (html) => switchVerdict(html, "enabled", true),
  );

  // (b) On the device: this switch makes mosd mount
  // etc-containers-systemd.mount, binding /etc/containers/systemd out of STATE
  // so Quadlet has a directory to read. Nothing about that is visible over
  // HTTP. Both patterns are failures when absent, not skips, because the
  // wording was measured: mosd/mosd/src/reconciler/container.rs emits them
  // from `tracing::info!` and they are quoted verbatim here.
  const consoleOn = async (pattern: RegExp, what: string): Promise<void> => {
    if (noOpOn !== undefined) {
      report.skip(what, noOpOn);
      return;
    }
    await expectConsoleLine(report, log, onMark, pattern, what, {
      timeoutMs: CONTAINER_CONSOLE_TIMEOUT_MS,
    });
  };
  await consoleOn(
    /container:\s*turn_on begin/,
    "(b) device effect: mosd's container reconciler logged `container: turn_on begin`",
  );
  await consoleOn(
    /container:\s*starting the bind/,
    "(b) device effect: mosd's container reconciler logged `container: starting the bind`",
  );
  // Any line naming the unit: systemd's own message wording (unit id versus
  // unit description) varies by version, but the unit name appearing in the
  // window after the post is the mount actually being acted on.
  await consoleOn(
    /etc-containers-systemd\.mount/,
    "(b) device effect: a console line names etc-containers-systemd.mount after the switch went on",
  );

  // The reverse direction. A switch that only works one way is a switch that
  // was never tested -- and turning it back off is also what leaves the device
  // in the state the next phase assumes.
  const offMark = log.mark("POST /containers/enable with the checkbox omitted (unchecked)");
  // An unticked checkbox sends nothing -- not "off", not "". Omitting the field
  // entirely is what a browser does, and what apid's Option<String> expects.
  const off = await client.post("/containers/enable", { enabled: UNCHECKED });
  report.expectStatus(
    off,
    303,
    "POST /containers/enable (enabled omitted, i.e. unchecked) is accepted with 303",
  );
  await expectPane(
    ctx,
    `bus read-back: GET /containers shows the switch disabled again within ${PANE_TIMEOUT_MS}ms`,
    "/containers",
    (html) => switchVerdict(html, "enabled", false),
  );
  // Measured on the live run of 2026-08-24, the window contains, in order:
  //
  //     mosd:    container: turn_on begin
  //     mosd:    container: starting the bind
  //     systemd: Mounting etc-containers-systemd.mount - Quadlet unit ...
  //     systemd: Mounted etc-containers-systemd.mount - Quadlet unit ...
  //     systemd: Unmounting etc-containers-systemd.mount - Quadlet unit ...
  //     systemd: etc-containers-systemd.mount: Deactivated successfully.
  //     systemd: Unmounted etc-containers-systemd.mount - Quadlet unit ...
  //
  // mosd emits no `container: turn_off` line -- its reconciler logs
  // `container: turn_on begin` on the way up and nothing coming down -- so a
  // pattern waiting for one waits forever. The line below names the unit and
  // says the deactivation succeeded; `Unmounting` only says it was attempted.
  await expectConsoleLine(
    report,
    log,
    offMark,
    /etc-containers-systemd\.mount:\s*Deactivated successfully/i,
    "device effect: the console carries the bind mount coming back down",
    {
      timeoutMs: CONTAINER_CONSOLE_TIMEOUT_MS,
      describePattern: "systemd's `etc-containers-systemd.mount: Deactivated successfully`",
    },
  );
}

// 5.3 / 5.4 ssh -- the unit, the key pair of writes, and the audited password

async function mutateSsh(ctx: PhaseContext, log: ConsoleLog): Promise<void> {
  const { report, client } = ctx;
  report.note("");
  report.note("  5.3 ssh: the unit, and an add-then-remove pair on the authorized keys");

  const paneBefore = await client.get("/ssh");
  const wasOn = paneBefore.status === 200 ? checkboxChecked(paneBefore.body, "enabled") : undefined;
  const noOpOn =
    wasOn === true
      ? "SSH was ALREADY enabled when this phase posted, so systemd had nothing to start and " +
        "no start line is expected. This phase assumes the device arrives with SSH in its " +
        "shipped state; it did not."
      : undefined;

  const enableMark = log.mark("POST /ssh/enable enabled=on");
  const enabled = await client.post("/ssh/enable", { enabled: checkbox(true) });
  report.expectStatus(enabled, 303, "POST /ssh/enable (enabled checked) is accepted with 303");

  // (a) Through the bus.
  await expectPane(
    ctx,
    `(a) bus read-back: GET /ssh shows SSH enabled within ${PANE_TIMEOUT_MS}ms`,
    "/ssh",
    (html) => switchVerdict(html, "enabled", true),
  );

  // (b) On the device. mosd drives ssh.service -- Debian's unit name; this
  // image ships no unit of its own -- so systemd starting that unit is the
  // device acting, logged by PID 1 and by sshd itself rather than by apid.
  // The pattern is a union of the wordings systemd and sshd use (the unit id
  // appears in modern systemd messages, the unit description in older ones),
  // and sshd's own "Server listening ... port 22" line, which is the strongest
  // of the three because it means the daemon is actually accepting.
  const sshStarted = new RegExp(
    "(?:Starting|Started|Reloading|Reloaded|Activating)[^\\n]{0,120}(?:ssh\\.service|OpenBSD Secure Shell)" +
      "|(?:ssh\\.service|sshd)[^\\n]{0,120}(?:Started|Starting|Succeeded|running)" +
      "|Server listening on [0-9a-fA-F:.]+ port 22",
    "i",
  );
  if (noOpOn !== undefined) {
    report.skip("(b) device effect: systemd started ssh.service after the post", noOpOn);
  } else {
    await expectConsoleLine(
      report,
      log,
      enableMark,
      sshStarted,
      "(b) device effect: systemd started ssh.service after the post",
      {
        timeoutMs: SSH_CONSOLE_TIMEOUT_MS,
        describePattern: "a systemd or sshd line naming ssh.service starting",
      },
    );
  }

  // Add, then remove. The pair is what proves the write path: a pane that
  // renders a key proves only that something can render, but a key that
  // appears after an add and is gone after a remove has been through mosd's
  // authorized-keys writer in both directions.
  const fingerprint = sshFingerprint(TEST_KEY_BLOB);
  const before = fingerprintsIn(paneBefore.body);
  const added = await client.post("/ssh/keys/add", { key: TEST_PUBLIC_KEY });
  report.expectStatus(added, 303, "POST /ssh/keys/add (a valid ed25519 key) is accepted with 303");

  const listed = await expectPane(
    ctx,
    `GET /ssh lists the key that was just added within ${PANE_TIMEOUT_MS}ms`,
    "/ssh",
    (html) =>
      html.includes(TEST_KEY_COMMENT) || html.includes(fingerprint)
        ? true
        : `neither the key's comment (${TEST_KEY_COMMENT}) nor its fingerprint (${fingerprint}) ` +
          `appears; ${describePane(html, "SHA256")}`,
  );

  // The fingerprint is computed here from the key that was posted -- sha256 of
  // the wire blob, base64, unpadded, which is what ssh-keygen -l prints -- so
  // this compares the pane against an independently derived value rather than
  // against whatever the pane happens to contain.
  const paneAfter = await client.get("/ssh");
  const rendered = fingerprintsIn(paneAfter.body);
  const rendersFingerprint = rendered.includes(fingerprint);
  report.check(
    rendersFingerprint,
    `GET /ssh renders the added key's fingerprint (${fingerprint})`,
    [
      `expected: the pane to render ${fingerprint}, computed from the posted key`,
      `actual:   ${rendered.length === 0 ? "the pane renders no SHA256 fingerprint at all" : `the pane renders ${rendered.join(", ")}`}`,
      describePane(paneAfter.body, "SHA256"),
    ].join("\n"),
  );

  // The identifier for the removal. The fingerprint is what /ssh/keys/remove is
  // documented to take; the fallbacks exist so that a pane rendering some other
  // identifier still gets the remove path exercised (and the check above has
  // already reported the discrepancy) rather than leaving the key on the device.
  const fresh = rendered.find((candidate) => !before.includes(candidate));
  const identifier = rendersFingerprint ? fingerprint : (fresh ?? TEST_KEY_COMMENT);
  const removed = await client.post("/ssh/keys/remove", { identifier });
  report.expectStatus(
    removed,
    303,
    `POST /ssh/keys/remove (identifier=${identifier}) is accepted with 303`,
  );

  if (listed) {
    await expectPane(
      ctx,
      `GET /ssh no longer renders the removed key within ${PANE_TIMEOUT_MS}ms`,
      "/ssh",
      (html) => {
        const still: string[] = [];
        if (html.includes(TEST_KEY_COMMENT)) still.push(`the comment ${TEST_KEY_COMMENT}`);
        if (html.includes(fingerprint)) still.push(`the fingerprint ${fingerprint}`);
        if (html.includes(TEST_KEY_BLOB)) still.push("the key blob itself");
        return still.length === 0 ? true : `the pane still renders ${still.join(" and ")}`;
      },
    );
  } else {
    // Vacuity guard: if the pane never rendered the key, its absence now proves
    // nothing about the removal -- it would pass on a device that ignored both
    // writes.
    report.skip(
      "GET /ssh no longer renders the removed key",
      "the pane never rendered the added key in the first place, so its absence after the " +
        "removal is not evidence that the removal did anything",
    );
  }

  await sshTransientPassword(ctx, log);

  // Leave SSH disabled. 06-backoff, 07-reboot and 08-poweroff all assume the
  // shipped state, and a device left with a listening sshd and a transient
  // password is not that. The re-read is also the reverse-direction evidence
  // for this switch.
  const disableMark = log.mark("POST /ssh/enable with the checkbox omitted (unchecked)");
  const disabled = await client.post("/ssh/enable", { enabled: UNCHECKED });
  report.expectStatus(
    disabled,
    303,
    "POST /ssh/enable (enabled omitted, i.e. unchecked) is accepted with 303",
  );
  await expectPane(
    ctx,
    `bus read-back: GET /ssh shows SSH disabled again, as the next phase assumes`,
    "/ssh",
    (html) => switchVerdict(html, "enabled", false),
  );
  // Measured on the live run of 2026-08-24, turning the switch off produces
  // all three of
  //
  //     Stopping ssh.service - OpenBSD Secure Shell server...
  //     ssh.service: Deactivated successfully
  //     Stopped ssh.service - OpenBSD Secure Shell server.
  //
  // so the wording is known and absence is now a real failure. The pattern
  // stays an alternation because which of the three lands first depends on
  // timing, not on whether the device acted.
  await expectConsoleLine(
    report,
    log,
    disableMark,
    /(?:Stopping|Stopped|Deactivat)[^\n]{0,120}(?:ssh\.service|OpenBSD Secure Shell)|ssh\.service:\s*Deactivated successfully/i,
    "device effect: the console carries ssh.service stopping again",
    {
      timeoutMs: SSH_CONSOLE_TIMEOUT_MS,
      describePattern: "systemd stopping ssh.service (any of its three wordings)",
    },
  );
}

// 5.4 the transient SSH password -- audit as the observation

async function sshTransientPassword(ctx: PhaseContext, log: ConsoleLog): Promise<void> {
  const { report, client } = ctx;
  report.note("");
  report.note("  5.4 ssh transient password: audited, and the password itself never logged");

  // The effect of this write is a shadow entry, which no route renders and
  // none should. What is observable is the audit trail, mirrored to the
  // journal and so to the console, which makes the audit line the only
  // device-effect evidence available for this mutation.
  const marker = log.mark("POST /ssh/password (the transient SSH password)");
  const posted = await client.post("/ssh/password", {
    password: TRANSIENT_PASSWORD,
    // The confirm field is a checkbox whose value is the confirm token; sending
    // "on" would be a ticked box with the wrong value, which is not consent.
    confirm: checkbox(true, SSH_PASSWORD_CONFIRM),
  });
  report.expectStatus(
    posted,
    303,
    "POST /ssh/password (password + confirm=set-transient-password) is accepted with 303",
  );

  // Still a skip: the operation it observes does not happen. POST /ssh/password
  // answered 502 on the run of 2026-08-24:
  //
  //   apid: mosd call failed error=org.freedesktop.DBus.Error.Failed:
  //     set transient root password: record the transient marker:
  //     create /etc/.transient-root-password.mosd-tmp: Read-only file system
  //
  // mosd writes its marker's temp file straight into /etc, which is read-only
  // on this image, so the transient password is never set and there is no
  // audit event to word a pattern from. That daemon defect is reported by the
  // 502 check above; until it is fixed, absence stays a SKIP with the window
  // pasted rather than asserting a pattern the device never emits.
  await observeConsoleLine(
    report,
    log,
    marker,
    [
      { name: "an audit line about the ssh password", pattern: /audit[^\n]{0,160}(?:ssh|password)/i },
      { name: "a transient-password event", pattern: /transient[ _-]?password/i },
      {
        name: "an ssh password event in any wording",
        pattern: /ssh[^\n]{0,60}password[^\n]{0,60}(?:set|changed|updated|enabled)/i,
      },
    ],
    "device effect: the console carries the audit event for the transient SSH password",
    { timeoutMs: AUDIT_CONSOLE_TIMEOUT_MS },
  );

  // Give the reconciler and the audit mirror a moment to finish writing before
  // asserting what is not in the window: an absence asserted over a window that
  // closes too early is an absence that was never really tested.
  await settle(SETTLE_MS);

  // A password that leaks into the journal is a security defect that ships
  // unnoticed, because every functional check still passes with the secret in
  // the log. `expectConsoleAbsent` refuses to pass over an empty window, so a
  // quiet console reports SKIP rather than a vacuous green.
  expectConsoleAbsent(
    report,
    log,
    marker,
    TRANSIENT_PASSWORD,
    "the transient SSH password itself appears NOWHERE in the console after the post",
    `the password ${JSON.stringify(TRANSIENT_PASSWORD)}`,
  );
}

// 5.5 network -- a no-op round trip, and a hard prohibition

/**
 * Post the interface's current configuration back unchanged.
 *
 * Posting a static address from this suite is forbidden. The guest is reached
 * over eth0 by DHCP (10.0.2.15/24) through QEMU's hostfwd, so a static address
 * reconfigures the very interface every other assertion travels over: the
 * forward drops mid-run, every later phase times out, and the failure looks
 * exactly like apid crashing. That change is worth testing from a harness that
 * can reach the guest another way (a serial console driver, or a second NIC)
 * and can put the interface back -- not from here. A no-op round trip is still
 * a real assertion: it proves the network reconciler applied a configuration
 * equal to the running one without dropping the link, which reconcilers get
 * wrong by tearing down and rebuilding unconditionally.
 */
async function networkNoOp(ctx: PhaseContext, log: ConsoleLog): Promise<void> {
  const { report, client } = ctx;
  report.note("");
  report.note("  5.5 network: a no-op round trip (a static address is FORBIDDEN here)");

  const pane = await client.get("/network");
  if (pane.status !== 200) {
    report.fail("GET /network renders the current interface configuration", [
      `expected: status 200 so the current configuration can be posted back unchanged`,
      `actual:   status ${pane.status}${pane.statusText === "" ? "" : ` ${pane.statusText}`}`,
    ].join("\n"));
    return;
  }

  // Read one form, not the pane. The /network pane renders a form per
  // configured interface and then an "Add interface" fieldset, all carrying
  // fields with the same names. Reading `iface` pane-wide and `dhcp` pane-wide
  // would take the two from different forms and post a body no browser would
  // ever have submitted -- on this route, one interface's name with another
  // one's addressing.
  const forms = interfaceForms(pane.body);
  if (forms.length === 0) {
    // A freshly provisioned mos device has no mosd-managed interface: /network
    // renders the "Add interface" fieldset and nothing above it, because the
    // link the suite is talking over is brought up by systemd-networkd's own
    // defaults rather than by mosd's settings. There is then no no-op round
    // trip to make -- posting `dhcp=on` would create configuration rather than
    // post existing configuration back unchanged, and a static address is
    // forbidden outright -- so it is skipped with the pane's actual contents as
    // the reason. What is still asserted is that the pane renders at all.
    report.check(
      pane.body.includes("Add interface"),
      "GET /network renders the interface pane (the 'Add interface' fieldset)",
      [
        `expected: the Network pane's "Add interface" legend`,
        `actual:   a ${pane.body.length}-byte pane without it`,
        describePane(pane.body, "iface"),
      ].join("\n"),
    );
    report.skip(
      "the /network round trip leaves the link up",
      "the pane renders NO configured interface -- only the \"Add interface\" fieldset -- which " +
        "is the ordinary state of a freshly provisioned device: the link this suite is talking " +
        "over is configured by systemd-networkd's defaults, not by mosd. There is no existing " +
        "configuration to post back unchanged, and this suite does not guess an interface name: " +
        "a wrong guess reconfigures the link every other assertion travels over. Posting `dhcp=on` " +
        "would CREATE configuration rather than round-trip it, which is a change, not a no-op.",
    );
    return;
  }
  report.pass("GET /network names the interface it is currently configuring");
  if (forms.length > 1) {
    // More than one configured interface, and nothing in the HTML says which
    // one carries the connection this suite is talking over. Posting to the
    // wrong one could flip a static interface onto DHCP. Refusing is cheap;
    // guessing costs the run and looks like apid crashing.
    report.skip(
      "the /network round trip leaves the link up",
      `the pane renders ${forms.length} configured interfaces (${forms
        .map((form) => form.iface)
        .join(", ")}) and nothing in the markup says which one carries the link this suite ` +
        `is talking over. Posting to the wrong one would reconfigure an interface this ` +
        `phase was not asked to touch. A harness that knows the guest's interface could ` +
        `pass it in and turn this back into a real check.`,
    );
    return;
  }

  const form = forms[0];
  if (form === undefined) return;
  if (!form.dhcp) {
    // The form says this interface is not on DHCP. Posting dhcp=on would then
    // be a change, not a no-op, and posting the static address back is
    // forbidden -- so there is no honest post to make, and this is a skip.
    report.skip(
      "the /network round trip leaves the link up",
      `the form for ${form.iface} renders its dhcp checkbox unchecked, so the interface is ` +
        `not on DHCP. Posting dhcp checked would be a CHANGE rather than the no-op this ` +
        `check requires, and posting a static address from this suite is forbidden -- it ` +
        `would reconfigure the interface the suite is talking over.`,
    );
    return;
  }

  // Every field comes from that one form, so the body is exactly what a browser
  // would submit if a user opened the page and pressed save without touching
  // anything.
  const iface = form.iface;
  const marker = log.mark(`POST /network (no-op: iface=${iface}, dhcp on)`);
  const posted = await client.post("/network", {
    iface,
    dhcp: checkbox(true),
    address: form.address,
    gateway: form.gateway,
    dns: form.dns,
  });
  report.expectStatus(
    posted,
    303,
    `POST /network (iface=${iface}, dhcp checked, addresses unchanged) is accepted with 303`,
  );

  // The device-effect assertion for this mutation: the link is still up
  // afterwards. /healthz is the only route the auth gate lets through
  // unauthenticated, so this is a pure liveness probe -- cookies withheld
  // deliberately, so a session problem cannot be mistaken for a link problem.
  const linkUp = await report.expectEventually(
    `the network round trip did not drop the link: /healthz answers 200 within ${LINK_TIMEOUT_MS}ms`,
    async () => {
      const health = await client.get("/healthz", { sendCookies: false });
      if (health.status !== 200) throw new Error(`/healthz answered ${health.status}`);
      return true;
    },
    { timeoutMs: LINK_TIMEOUT_MS, intervalMs: 1_000 },
  );
  if (!linkUp) {
    // A dropped link is the one failure this phase could plausibly have caused
    // itself, and over HTTP it is indistinguishable from apid crashing -- the
    // symptom is the same silence. What the guest said while it happened is on
    // the console, so paste it rather than making someone re-boot the image to
    // find out. This is a note, not a check: it adds evidence, not a verdict.
    report.note(`    what the guest wrote to the console during the round trip:`);
    for (const line of log.describeWindow(marker)) report.note(`    ${line}`);
  }

  // And the session survived it: an authenticated route still renders instead
  // of redirecting to /login. This also re-proves, at the end of the phase,
  // that the hostname set in 5.1 is still the one mosd holds.
  const target = ctx.config.hostnameTarget;
  await expectPane(
    ctx,
    `the session survived the network round trip: /hostname still answers 200 and renders ${target}`,
    "/hostname",
    (html) => {
      const value = inputValue(html, "hostname");
      if (value === undefined) {
        return `the pane renders no input named "hostname"; ${describePane(html, "hostname")}`;
      }
      return value === target ? true : `the hostname input renders ${JSON.stringify(value)}`;
    },
  );

  // There is deliberately no console assertion here: a no-op reconcile may
  // legitimately log nothing at all, so no line's absence would mean anything.
  // The console is used above only to explain a failure, never to produce one.
}

// helpers: polling a pane, reading a pane

/**
 * Poll a GET route until `holds` accepts what it renders.
 *
 * Polled rather than read once because these panes are rendered from mosd's
 * settings over the system bus, and a reconciler on a TCG guest is not
 * instantaneous. `holds` returns true, or the reason it does not hold -- that
 * reason is thrown so it lands in the reporter's `last:` line, which is what
 * makes a red here say what the pane actually rendered instead of "false".
 */
async function expectPane(
  ctx: PhaseContext,
  what: string,
  path: string,
  holds: (html: string, response: HttpResponse) => true | string,
  options: { readonly timeoutMs?: number } = {},
): Promise<boolean> {
  return ctx.report.expectEventually(
    what,
    async () => {
      const response = await ctx.client.get(path);
      if (response.status !== 200) {
        const location = response.headers.get("location");
        throw new Error(
          `GET ${path} answered ${response.status}` +
            (location === undefined ? "" : ` -> ${location}`),
        );
      }
      const verdict = holds(response.body, response);
      if (verdict === true) return true;
      throw new Error(verdict);
    },
    { timeoutMs: options.timeoutMs ?? PANE_TIMEOUT_MS, intervalMs: 500 },
  );
}

/** The current state of a switch, or undefined if the pane could not be read. */
async function readSwitch(
  ctx: PhaseContext,
  path: string,
  field: string,
): Promise<boolean | undefined> {
  try {
    const response = await ctx.client.get(path);
    if (response.status !== 200) return undefined;
    return checkboxChecked(response.body, field);
  } catch {
    // A pre-read is a courtesy, not an assertion: if it fails, the checks that
    // follow report on their own terms rather than this throwing the phase.
    return undefined;
  }
}

function switchVerdict(html: string, field: string, wanted: boolean): true | string {
  const state = checkboxChecked(html, field);
  if (state === undefined) {
    return (
      `the pane renders no checkbox named ${JSON.stringify(field)} to read the switch from ` +
      `(the POST handler takes that field name); ${describePane(html, field)}`
    );
  }
  if (state === wanted) return true;
  return `the ${field} checkbox renders ${state ? "checked" : "unchecked"}, expected ${
    wanted ? "checked" : "unchecked"
  }`;
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// helpers: the SSH key

/**
 * `SHA256:<unpadded base64 of the sha256 of the wire blob>` -- what
 * `ssh-keygen -l` prints, derived here from the key this suite posted so the
 * pane is compared against an independent value.
 */
function sshFingerprint(base64Blob: string): string {
  const digest = createHash("sha256").update(Buffer.from(base64Blob, "base64")).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

function fingerprintsIn(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/SHA256:[A-Za-z0-9+/]{20,}={0,2}/g)) {
    const value = match[0];
    if (value !== undefined) found.add(value);
  }
  return [...found];
}

// helpers: minimal HTML reading. Nothing here parses HTML properly and nothing
// needs to: every value this phase asserts on is an attribute of an <input>,
// <select> or <option> whose name is fixed by apid's handler structs.

const TAG_ATTRIBUTE = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttributes(insideTag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of insideTag.matchAll(TAG_ATTRIBUTE)) {
    const name = match[1];
    if (name === undefined) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.set(name.toLowerCase(), value);
  }
  return attributes;
}

function tagsNamed(html: string, tag: string): Array<Map<string, string>> {
  const out: Array<Map<string, string>> = [];
  for (const match of html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "gi"))) {
    out.push(parseAttributes(match[1] ?? ""));
  }
  return out;
}

/** Every input carrying `name`, in document order. */
function inputsNamed(html: string, name: string): Array<Map<string, string>> {
  return tagsNamed(html, "input").filter((attributes) => attributes.get("name") === name);
}

/** The value of the input named `name`, or undefined if there is no such input. */
function inputValue(html: string, name: string): string | undefined {
  const named = inputsNamed(html, name);
  if (named.length === 0) return undefined;
  // A form may carry a hidden companion field under the same name; the visible
  // control is the one rendering the current value, so prefer it.
  const control =
    named.find((attributes) => (attributes.get("type") ?? "").toLowerCase() !== "hidden") ??
    named[0];
  return decodeEntities(control?.get("value") ?? "");
}

/** Whether the checkbox named `name` renders checked; undefined if absent. */
function checkboxChecked(html: string, name: string): boolean | undefined {
  const named = inputsNamed(html, name);
  if (named.length === 0) return undefined;
  // Same reason: read the checkbox, not a hidden field that happens to share
  // its name, or the switch would read as "off" on a pane that renders one.
  const box =
    named.find((attributes) => (attributes.get("type") ?? "").toLowerCase() === "checkbox") ??
    named[0];
  return box === undefined ? undefined : box.has("checked");
}

/** One interface form on the /network pane, read as a unit. */
interface InterfaceForm {
  readonly iface: string;
  readonly dhcp: boolean;
  readonly address: string;
  readonly gateway: string;
  readonly dns: string;
}

/**
 * Every form on the /network pane that configures an interface that exists.
 *
 * The pane renders one form per configured interface plus an "Add interface"
 * fieldset, and all of them carry fields named iface/dhcp/address/gateway/dns.
 * A form is taken to describe a configured interface only when it names a
 * non-empty one; the add fieldset, whose iface is empty or unselected, drops
 * out on that test. If the pane renders no <form> at all, the whole pane is
 * read as one block rather than silently returning nothing.
 */
function interfaceForms(html: string): InterfaceForm[] {
  const blocks = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)]
    .map((match) => match[1] ?? "")
    .filter((block) => block !== "");
  const found: InterfaceForm[] = [];
  for (const block of blocks.length > 0 ? blocks : [html]) {
    const iface = readIface(block);
    if (iface === undefined || iface === "") continue;
    found.push({
      iface,
      dhcp: checkboxChecked(block, "dhcp") === true,
      address: inputValue(block, "address") ?? "",
      gateway: inputValue(block, "gateway") ?? "",
      dns: inputValue(block, "dns") ?? "",
    });
  }
  return found;
}

/**
 * The interface the /network pane is currently configuring.
 *
 * Three renderings are accepted: a <select> with a selected <option>, a checked
 * radio, or a plain input. If none of them names an interface, the caller skips
 * rather than guessing.
 */
function readIface(html: string): string | undefined {
  const selected = selectedOption(html, "iface");
  if (selected !== undefined && selected !== "") return selected;
  for (const attributes of tagsNamed(html, "input")) {
    if (attributes.get("name") !== "iface") continue;
    if (attributes.get("type")?.toLowerCase() === "radio" && !attributes.has("checked")) continue;
    const value = decodeEntities(attributes.get("value") ?? "");
    if (value !== "") return value;
  }
  return undefined;
}

function selectedOption(html: string, name: string): string | undefined {
  const select = new RegExp(
    `<select\\b[^>]*\\bname\\s*=\\s*["']?${name}["']?[^>]*>([\\s\\S]*?)</select>`,
    "i",
  ).exec(html);
  const inner = select?.[1];
  if (inner === undefined) return undefined;
  for (const option of inner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const attributes = parseAttributes(option[1] ?? "");
    if (!attributes.has("selected")) continue;
    const value = attributes.get("value");
    return decodeEntities(value ?? (option[2] ?? "").trim());
  }
  return undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&");
}

/**
 * A window of the pane around the first mention of `needle`.
 *
 * A failure that says only "the value was wrong" costs a TCG boot to
 * investigate; one that pastes the markup it was reading usually costs nothing.
 */
function describePane(html: string, needle: string): string {
  const at = html.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) {
    return `pane:     ${html.length} bytes, and it does not mention ${JSON.stringify(needle)} at all`;
  }
  const window = html.slice(Math.max(0, at - 120), at + 200).replace(/\s+/g, " ");
  return `pane:     around the first ${JSON.stringify(needle)}: ${JSON.stringify(window)}`;
}
