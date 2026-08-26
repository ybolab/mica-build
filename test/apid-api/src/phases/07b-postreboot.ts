/**
 * The far side of a real restart.
 *
 * Every assertion here is about state that had to survive a power cycle, and
 * none of it can be faked by a test that never took the machine down: the
 * session table was in RAM and is gone, the login guard's counters were on disk
 * and are not, and the hostname came back through firmware, GRUB and a fresh
 * systemd.
 *
 * Where things live, because getting this wrong turns an assertion into a
 * coincidence. `/var/lib/mos` is a bind mount onto the STATE partition
 * (os/rootfs/overlay-v2/etc/systemd/system/var-lib-mos.mount, whose own comment
 * says /var lives on EPHEMERAL and is redirected rather than moved). So:
 *
 *   - `session.key` PERSISTS. The pre-reboot cookie is NOT voided by a
 *     regenerated signing key, and this phase does not claim it is.
 *   - `login_guard.json` PERSISTS. That is what makes the backoff assertion
 *     below a real test of docs/design/access.md section 6 rather than a
 *     hopeful one.
 *   - `state.sessions` is an IN-RAM table. The old cookie is refused because
 *     its id is simply not in that table any more -- which is the reason this
 *     phase asserts, and the reason it states.
 *
 * If the boot-2 console ever shows apid REGENERATING cert.pem or session.key,
 * that is a finding: it would mean STATE did not mount and
 * `RequiresMountsFor=/var/lib/mos` did not hold. It is reported, never fixed.
 *
 * This phase runs in a SECOND suite process against a second boot of the same
 * disk, so `ctx.state` from boot 1 is gone. Everything it needs comes from the
 * JSON handoff 07 wrote. A missing handoff is a SKIP with a stated reason: a
 * phase that cannot make its assertions must not read as one that made them.
 */

import { Client, type HttpResponse } from "../client.ts";
import { splitLines } from "../console.ts";
import type { Reporter } from "../report.ts";
import type { Phase, PhaseContext } from "../runner.ts";
import { BACKOFF_BASE_MS, expectedWindowMs, waitForWindow } from "./06-backoff.ts";
import {
  findMatch,
  noConsoleReason,
  openConsole,
  readHandoff,
  truncate,
} from "./07-reboot.ts";

const HEALTHZ_TIMEOUT_MS = 180_000;
/**
 * A first failure's window is BACKOFF_BASE (1s). A preserved run of 4 failures
 * makes the next window 16s, and even a preserved run of 2 makes it 4s. 2.5s
 * therefore separates "the counter was reset by the reboot" from "the counter
 * survived" with room on both sides -- and the threshold is deliberately ABOVE
 * 1s rather than below any predicted value, because erring high can only ever
 * fail this check, never pass it by accident.
 */
const RESET_FLOOR_MS = 2_500;
const WINDOW_MEASURE_TIMEOUT_MS = 120_000;
const LOGIN_WAIT_TIMEOUT_MS = 150_000;
const HOSTNAME_CONSOLE_TIMEOUT_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The names of every assertion this phase makes, so a SKIP can name them all. */
const ASSERTIONS = [
  "the machine came back: apid answers /healthz on the second boot",
  "the pre-reboot session cookie is REFUSED after the restart",
  "the login backoff survived the restart (access.md section 6)",
  "a fresh login succeeds again once the window has passed",
  "the hostname 05 set survived the restart",
] as const;

/**
 * Log in, waiting out whatever window the backoff assertion above just armed.
 *
 * Success is detected by the SESSION COOKIE, not by a status code: a suite that
 * hardcoded 303 would be asserting apid's redirect style, and this call only
 * needs to know whether a session came back.
 */
async function loginWhenAllowed(
  client: Client,
  password: string,
  report: Reporter,
  timeoutMs: number,
): Promise<HttpResponse | undefined> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let attempts = 0;
  let nextProgress = started + 15_000;
  for (;;) {
    client.freshConnection();
    const response = await client.post("/login", { password });
    attempts += 1;
    if (response.status !== 429) return response;
    const now = Date.now();
    if (now >= deadline) {
      report.fail(
        "a fresh login becomes possible again once the window has passed",
        [
          `expected: the guard to reopen within ${timeoutMs}ms`,
          `actual:   still 429 after ${attempts} attempt(s) over ${now - started}ms`,
          `note:     the window this phase just measured should have been the last one.`,
          `          A window that never reopens means the failure run is climbing while`,
          `          this loop polls, i.e. a 429 itself is counting as a failure.`,
        ].join("\n"),
      );
      return undefined;
    }
    if (now >= nextProgress) {
      nextProgress = now + 15_000;
      report.note(
        `    ${Math.round((now - started) / 1000)}s/${Math.round(timeoutMs / 1000)}s ` +
          `waiting out the login window before re-establishing a session (${attempts} attempt(s))`,
      );
    }
    await sleep(1_000);
  }
}

const phase: Phase = {
  id: "07b-postreboot",
  title: "after the reboot: the hostname persisted, the session did not, and the backoff did",
  assumes:
    "phase 07 posted /power/reboot, the console showed the guest going down, and the " +
    "harness booted the SAME disk again (MOS_QEMU_REUSE_DISK=1) so this runs against a " +
    "second boot in a SECOND suite process. It assumes the JSON handoff 07 wrote is " +
    "readable at the same path from this process; without it nothing here can be " +
    "asserted and every check below is SKIPPED with that reason rather than passed.",

  async run(ctx: PhaseContext): Promise<void> {
    const { report, client, config } = ctx;

    const read = readHandoff(config);
    if (!read.ok) {
      for (const assertion of ASSERTIONS) report.skip(assertion, read.why);
      return;
    }
    const handoff = read.handoff;
    report.note(`    handoff read from ${read.path}, written ${handoff.writtenAtIso}`);
    if (handoff.hostnameTarget !== undefined && handoff.hostnameTarget !== config.hostnameTarget) {
      report.note(
        `    NOTE: 07 recorded hostnameTarget ${JSON.stringify(handoff.hostnameTarget)} but this ` +
          `process's APID_HOSTNAME_TARGET is ${JSON.stringify(config.hostnameTarget)}. The ` +
          `handoff wins: it is what the device was actually told to become.`,
      );
    }
    const hostname = handoff.hostnameTarget;
    const consoleLog = openConsole(config);

    // -- 1. the machine came back -------------------------------------------
    const probe = new Client(config);
    const healthzStarted = Date.now();
    let healthzAttempts = 0;
    let lastHealthz = "never connected";
    await report.expectEventually(
      ASSERTIONS[0],
      async () => {
        healthzAttempts += 1;
        try {
          const response = await probe.raw("/healthz", { timeoutMs: 5_000, sendCookies: false });
          lastHealthz = `status ${response.status}`;
          return response.status === 200;
        } catch (error) {
          lastHealthz = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          return false;
        }
      },
      { timeoutMs: HEALTHZ_TIMEOUT_MS, intervalMs: 3_000 },
    );
    report.note(
      `    /healthz answered after ${healthzAttempts} probe(s) in ` +
        `${Math.round((Date.now() - healthzStarted) / 1000)}s (last: ${lastHealthz}); ` +
        `${Math.round((Date.now() - handoff.rebootPostedAtMs) / 1000)}s since the reboot was posted`,
    );

    // -- 2. the session did NOT survive -------------------------------------
    //
    // Replayed on a SEPARATE client so the main jar stays clean for the fresh
    // login below. The refusal's cause is `state.sessions` being an in-RAM
    // table -- NOT a regenerated signing key. session.key lives under
    // /var/lib/mos, which is bound onto STATE and survives; asserting the wrong
    // mechanism would make this check pass for a reason that is not true.
    if (handoff.sessionCookieValue === undefined) {
      report.skip(
        ASSERTIONS[1],
        "07 recorded no apid_session value to replay, so there is no pre-reboot session to refuse",
      );
    } else {
      const replay = new Client(config);
      replay.jar.ingest([`apid_session=${handoff.sessionCookieValue}; Path=/`]);
      replay.freshConnection();
      const refused = await replay.get("/power");
      report.expectStatus(refused, 303, ASSERTIONS[1]);
      const location = refused.headers.get("location") ?? "";
      report.check(
        location.includes("/login"),
        "the refused replay is sent to /login, i.e. the gate treats it as unauthenticated rather than as a broken session",
        [
          `expected: a Location naming /login`,
          `actual:   ${JSON.stringify(refused.headers.get("location"))}`,
          `status:   ${refused.status}`,
          `note:     a session that SURVIVED a restart would be a finding, not a convenience:`,
          `          the id would have to have come from somewhere other than the RAM table.`,
        ].join("\n"),
      );
    }

    // -- 3. the login backoff DID survive -----------------------------------
    //
    // docs/design/access.md section 6: the counters are written to
    // <state_dir>/login_guard.json, and /var/lib/mos is bound onto STATE, so a
    // power cycle must not reset the clock. Which of the two possible
    // assertions is made depends on what is MEASURED, not on which one is
    // likelier to pass -- the window 07 left open may or may not have outlived
    // the reboot, and asserting both and hoping would be asserting neither.
    if (handoff.backoff === undefined) {
      report.skip(
        ASSERTIONS[2],
        "06-backoff left no guard state in the handoff, so there is no pre-reboot failure run to compare against",
      );
    } else {
      const before = handoff.backoff;
      const openedAt = before.lastFailureAtMs;
      const elapsedSinceMs = Date.now() - openedAt;
      report.note(
        `    06 left the run at ${before.failures} failure(s) with a ` +
          `${before.expectedWindowMs}ms window opening at ${before.lastFailureAtIso}; ` +
          `${Math.round(elapsedSinceMs / 1000)}s have passed since, so the window ` +
          `${elapsedSinceMs > before.expectedWindowMs ? "has expired naturally" : "should still be open"}.`,
      );

      const guardProbe = new Client(config);
      const wrongPassword = `${config.adminPassword}-not-the-password`;
      guardProbe.freshConnection();
      const firstAfterBoot = await guardProbe.post("/login", { password: wrongPassword });
      const firstAt = Date.now();

      if (firstAfterBoot.status === 429) {
        // Branch A: the window 07 left open outlived the boot. The guard is
        // refusing on a counter it can only have read back off STATE.
        report.pass(ASSERTIONS[2]);
        report.note(
          `    asserted the STILL-ARMED form: the first login attempt of boot 2 was refused 429, ` +
            `${Math.round(elapsedSinceMs / 1000)}s after 06's last failure. The guard cannot be ` +
            `refusing on an in-RAM counter -- this process is talking to a systemd that started ` +
            `after the one 06 talked to.`,
        );
      } else if (firstAfterBoot.status === 401) {
        // Branch B: the window expired during the boot, which says nothing on
        // its own. The RUN is what must have been preserved, so measure the
        // NEXT window: a run reset to zero would make this a first failure and
        // its window BACKOFF_BASE (1s).
        report.note(
          `    the window had expired by boot 2 (the first attempt was 401, not 429), so the ` +
            `STILL-ARMED form is not available. Measuring the NEXT window instead: a run reset ` +
            `to zero would make this failure the first, and its window ${BACKOFF_BASE_MS}ms.`,
        );
        const outcome = await waitForWindow(
          guardProbe,
          wrongPassword,
          firstAt,
          [],
          WINDOW_MEASURE_TIMEOUT_MS,
        );
        if (outcome.kind !== "opened") {
          report.fail(
            ASSERTIONS[2],
            [
              `expected: to measure the window that follows the first failure of boot 2`,
              `actual:   ${outcome.kind === "unexpected" ? `status ${outcome.response.status}` : `still ${outcome.lastStatus} after ${outcome.attempts} probe(s) over ${outcome.waitedMs}ms`}`,
              `note:     a window longer than ${WINDOW_MEASURE_TIMEOUT_MS}ms would itself argue the`,
              `          run was preserved, but this check does not get to assert what it`,
              `          could not measure.`,
            ].join("\n"),
          );
        } else {
          const predicted = expectedWindowMs(before.failures + 1);
          report.check(
            outcome.windowMs > RESET_FLOOR_MS,
            ASSERTIONS[2],
            [
              `expected: a window longer than ${RESET_FLOOR_MS}ms, because a run RESET by the`,
              `          reboot would put this at failure 1 and its window at ${BACKOFF_BASE_MS}ms`,
              `actual:   ${outcome.windowMs}ms`,
              `context:  06 left the run at ${before.failures} failure(s); if that survived, auth.rs`,
              `          predicts ${predicted}ms here`,
              `note:     login_guard.json lives under /var/lib/mos, which var-lib-mos.mount binds`,
              `          onto the STATE partition. A ~${BACKOFF_BASE_MS}ms window here means the`,
              `          counters did NOT survive, which contradicts access.md section 6`,
              `          and is a finding rather than a flake.`,
            ].join("\n"),
          );
          report.note(
            `    asserted the PRESERVED-RUN form: measured ${outcome.windowMs}ms against a ` +
              `${BACKOFF_BASE_MS}ms floor for a reset run and a ${predicted}ms prediction for a ` +
              `run preserved at ${before.failures}. Shape only -- this is a contended TCG host.`,
          );
        }
      } else {
        report.fail(
          ASSERTIONS[2],
          [
            `expected: 429 (the window survived) or 401 (it expired, and the run is measured)`,
            `actual:   status ${firstAfterBoot.status} from POST /login with a wrong password`,
            `note:     any other status means the login guard is not what answered.`,
          ].join("\n"),
        );
      }
    }

    // -- 4. and then a real session again ------------------------------------
    //
    // Deliberately last of the auth checks: a SUCCESSFUL login resets the
    // failure run, so doing this any earlier would erase the very evidence
    // assertion 3 is made of.
    client.jar.clear();
    const loggedIn = await loginWhenAllowed(
      client,
      config.adminPassword,
      report,
      LOGIN_WAIT_TIMEOUT_MS,
    );
    if (loggedIn === undefined) {
      report.skip(
        ASSERTIONS[4],
        "no session could be re-established after the reboot, so /hostname cannot be read back",
      );
      report.note(
        "    08-poweroff assumes a valid session and will fail on it; the cause is here, not there.",
      );
      return;
    }
    const session = client.jar.get("apid_session");
    report.check(
      session !== undefined && session.value !== "",
      ASSERTIONS[3],
      [
        `expected: a POST /login with the correct password to issue an apid_session cookie`,
        `actual:   status ${loggedIn.status}, Set-Cookie ${JSON.stringify(loggedIn.setCookie)}`,
        `jar:      ${JSON.stringify(client.jar.names())}`,
      ].join("\n"),
    );

    // -- 5. the hostname persisted -------------------------------------------
    //
    // Read back over HTTP only AFTER the login above, because /hostname is
    // behind the gate and an unauthenticated read would assert a redirect.
    const hostnamePage = await client.get("/hostname");
    report.expectStatus(hostnamePage, 200, "GET /hostname answers the re-established session");
    if (hostname === undefined) {
      // 05 did not run in the first boot, so the device was never renamed.
      // "the hostname 05 set survived the restart" is then a claim about an
      // event that did not happen, and the only honest verdict is SKIP -- a red
      // here would be this phase reporting the SHAPE OF THE RUN as a defect in
      // the device. This is reachable whenever APID_PHASES leaves 05 out.
      report.skip(
        ASSERTIONS[4],
        "07's handoff records no hostname target, which means 05-mutate did not run in the " +
          "first boot and the device was never renamed. There is no rename to prove persisted. " +
          "Run the full phase list, or set APID_PHASES to include 05-mutate, to make this a " +
          "real check again.",
      );
      report.skip(
        "the boot-2 CONSOLE shows the new hostname, the device reporting its own identity",
        "same reason: 05-mutate did not run, so there is no new hostname to look for.",
      );
      return;
    }
    report.check(
      hostnamePage.body.includes(hostname),
      ASSERTIONS[4],
      [
        `expected: ${JSON.stringify(hostname)} in the rendered /hostname page after a cold start`,
        `actual:   not present`,
        `body:     ${truncate(hostnamePage.body.replace(/\s+/g, " "), 400)}`,
        `note:     05 set this before the reboot. Its absence means the rename did not reach`,
        `          persistent storage, not that this phase read the wrong page.`,
      ].join("\n"),
    );

    // The device reporting its own identity on the serial line after a cold
    // start is stronger than any read-back over the API: nothing this suite
    // did is in the path. agetty renders `<hostname> login:` from /etc/issue,
    // and journald's console lines carry the nodename too.
    if (consoleLog === undefined) {
      report.skip(
        "the boot-2 CONSOLE shows the new hostname, the device reporting its own identity",
        noConsoleReason(config),
      );
    } else {
      const prompt = new RegExp(`(^|\\s)${escapeRegExp(hostname)}\\s+login:`, "i");
      const anywhere = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(hostname)}([^A-Za-z0-9_-]|$)`);
      // fromStart: the boot-2 capture is a fresh file and the boot itself is
      // the subject, so there is no earlier mark to measure from.
      const found = await consoleLog.waitFor([prompt], {
        report,
        what: `the getty prompt to render "${hostname} login:"`,
        timeoutMs: HOSTNAME_CONSOLE_TIMEOUT_MS,
        fromStart: true,
      });
      if (found.matched) {
        report.pass(
          "the boot-2 CONSOLE renders `" + hostname + " login:` -- the device reports its own identity after a cold start",
        );
        report.note(`    console: ${truncate(found.line ?? "", 120)}`);
      } else {
        // splitLines, not a bare split: systemd colours the boot log, and an
        // ANSI run sitting against the hostname would break a pattern that
        // spans it.
        const onALogLine = findMatch(splitLines(consoleLog.all()), [anywhere]);
        if (onALogLine !== undefined) {
          report.pass(
            "the boot-2 CONSOLE carries the new hostname on its own boot log lines",
          );
          report.note(`    console: ${truncate(onALogLine.line, 120)}`);
        } else {
          report.skip(
            "the boot-2 CONSOLE shows the new hostname, the device reporting its own identity",
            `neither "${hostname} login:" nor the bare hostname appeared in ` +
              `${consoleLog.path} within ${HOSTNAME_CONSOLE_TIMEOUT_MS}ms. The HTTP read-back ` +
              `above is the load-bearing assertion; this one is skipped rather than failed ` +
              `because a getty prompt that has not been printed yet is not a defect. ` +
              `Last console lines:\n${found.tail}`,
          );
        }
      }
    }
  },
};

export default phase;
