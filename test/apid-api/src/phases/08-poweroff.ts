/**
 * The last phase, and the only one that ends with nothing left to ask.
 *
 * Power-off is asserted the same way the reboot was: mark the console, read the
 * confirm token off the page, post, and then wait for systemd to reach its
 * power-off transaction on the serial line. The 303 is apid's handler
 * answering; `Reached target Power-Off` is the machine doing it. Only the
 * second one is evidence.
 *
 * This phase runs LAST by design. After it there is no device to interrogate,
 * no console still being written to and no port to poll -- so anything that
 * needed proving had to be proved before now, and the registry order in
 * main.ts is what guarantees it was.
 */

import { checkbox } from "../client.ts";
import type { Phase, PhaseContext } from "../runner.ts";
import {
  POWEROFF_PATTERNS,
  confirmTokenFor,
  expectPortStopsAnswering,
  isGateRedirect,
  noConsoleReason,
  openConsole,
  truncate,
} from "./07-reboot.ts";

const POWEROFF_ACTION = "/power/poweroff";
const POWEROFF_EVIDENCE_TIMEOUT_MS = 180_000;
const PORT_QUIET_TIMEOUT_MS = 240_000;

const phase: Phase = {
  id: "08-poweroff",
  title: "poweroff: POST-only, the confirm token is required, and the guest goes down",
  assumes:
    "phase 07b confirmed the machine came back from the reboot and left a valid session " +
    "in the jar. This phase is destructive and irreversible and must run last: it removes " +
    "the device every later assertion would need, so the registry order in main.ts -- not " +
    "a convention -- is what keeps it last.",

  async run(ctx: PhaseContext): Promise<void> {
    const { report, client, config } = ctx;
    const consoleLog = openConsole(config);

    // -- 1. mark -------------------------------------------------------------
    if (consoleLog !== undefined) consoleLog.mark("reading /power and posting the UNCONFIRMED poweroff");

    // -- 2. the token, read off the page, and the confirm gate ---------------
    const powerPage = await client.get("/power");
    report.expectStatus(powerPage, 200, "GET /power renders the power page to the post-reboot session");
    const token = confirmTokenFor(powerPage.body, POWEROFF_ACTION);
    report.check(
      token !== undefined && token !== "",
      "the poweroff form on /power carries its own confirm token, read off the page rather than hardcoded",
      [
        `expected: an <input name="confirm" value="..."> inside <form action="${POWEROFF_ACTION}">`,
        `actual:   no such input was found`,
        `body:     ${truncate(powerPage.body.replace(/\s+/g, " "), 400)}`,
      ].join("\n"),
    );

    // Checked before the real post, as in 07: an unconfirmed power action that
    // went through would be the worst defect this suite could find, and after
    // the confirmed post there is no machine left to check it against.
    const unconfirmed = await client.post(POWEROFF_ACTION, {});
    report.note(`    POST ${POWEROFF_ACTION} with no confirm field answered ${unconfirmed.status}`);
    report.check(
      unconfirmed.status !== 303,
      "an unconfirmed POST /power/poweroff is not answered as an accepted power action",
      [
        `expected: anything but the 303 the CONFIRMED post below is asserted to return`,
        `actual:   ${unconfirmed.status}`,
        `note:     a 303 here would mean the confirm field decides nothing.`,
      ].join("\n"),
    );
    const stillUp = await client.get("/healthz", { sendCookies: false });
    report.expectStatus(
      stillUp,
      200,
      "the machine is STILL UP after an unconfirmed POST /power/poweroff",
    );

    // -- 3. the real one, and the console proof ------------------------------
    if (consoleLog !== undefined) consoleLog.mark("the CONFIRMED POST /power/poweroff");
    const posted = await client.post(POWEROFF_ACTION, {
      confirm: checkbox(true, token ?? "the-token-was-not-found-on-the-page"),
    });
    report.expectStatus(
      posted,
      303,
      "POST /power/poweroff carrying the page's own confirm token is accepted (303)",
    );

    // A 303 ALONE IS NOT ACCEPTANCE. Measured 2026-08-24 on the first live run:
    // with no valid session in the jar, apid's auth gate answers EVERY route
    // except /healthz with 303 to /login -- including this one. The status
    // check above passed while nothing whatsoever had been asked of the
    // machine, which made the most destructive assertion in the suite green on
    // a run where the guest was never going to go down.
    //
    // The Location is what tells the two apart, so it is asserted rather than
    // the status alone. The success target is not hardcoded here (that would
    // couple this phase to a redirect apid is free to change); what is asserted
    // is that it is NOT the gate's, which is the distinction that was missing.
    const postedTo = posted.headers.get("location");
    report.check(
      posted.status === 303 && postedTo !== undefined && !isGateRedirect(postedTo),
      "the accepted POST /power/poweroff is an ACCEPTED ACTION and not the auth gate bouncing an unauthenticated caller",
      [
        `expected: 303 whose Location is neither /login nor /setup`,
        `actual:   ${posted.status} -> ${JSON.stringify(postedTo ?? "<no Location>")}`,
        `note:     a 303 to /login means the session was not honoured and the machine was`,
        `          never asked to power off. Every assertion below would then be`,
        `          measuring a device nobody told to do anything.`,
      ].join("\n"),
    );

    if (consoleLog !== undefined) {
      const evidence = await consoleLog.waitFor(POWEROFF_PATTERNS, {
        report,
        what: "systemd reaching its power-off transaction on the console",
        timeoutMs: POWEROFF_EVIDENCE_TIMEOUT_MS,
      });
      if (evidence.unavailableReason !== undefined) {
        report.skip(
          "the CONSOLE shows the guest powering off -- the machine acted, not merely the handler",
          `${evidence.unavailableReason} -- the wait ended because the log stopped being readable, ` +
            `which is not evidence that the guest failed to power off`,
        );
      } else {
      report.check(
        evidence.matched,
        "the CONSOLE shows the guest powering off -- the machine acted, not merely the handler",
        [
          `expected: a line matching one of ${POWEROFF_PATTERNS.length} power-off patterns`,
          `actual:   none within ${evidence.elapsedMs}ms of the 303`,
          `patterns: ${POWEROFF_PATTERNS.map(String).join(" | ")}`,
          `the last console lines since the post:`,
          evidence.tail === "" ? "          <the console produced nothing at all>" : evidence.tail,
        ].join("\n"),
      );
      }
      if (evidence.matched) {
        report.note(
          `    console evidence ${evidence.elapsedMs}ms after the post: ${truncate(evidence.line ?? "", 120)}`,
        );
      }
    } else {
      report.skip(
        "the CONSOLE shows the guest powering off",
        `${noConsoleReason(config)} -- that leaves only the 303 and the port going quiet, and neither one proves the machine acted`,
      );
    }

    // -- 4. and the port goes quiet, for good --------------------------------
    await expectPortStopsAnswering(
      ctx,
      "the HTTPS port stops answering after the power-off: the guest is gone",
      PORT_QUIET_TIMEOUT_MS,
    );

    // -- 5. the record that nothing follows ----------------------------------
    //
    // Not a formality. This line is what tells a reader of a red run that the
    // totals above are the WHOLE run: there is no later phase whose absence
    // might explain a missing assertion, because the device it would have
    // needed no longer exists.
    report.pass(
      "08-poweroff ran last by design: the device is gone and no assertion follows this one",
    );
    report.note(
      `    ${report.passes} passed and ${report.failures} failed up to and including this line. ` +
        `Anything not asserted by now was not asserted at all -- 08 is destructive and ` +
        `irreversible, and main.ts places it last for exactly that reason.`,
    );
  },
};

export default phase;
