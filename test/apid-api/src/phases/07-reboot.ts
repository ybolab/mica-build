/**
 * The reboot, proven from the console rather than from a status code.
 *
 * A 303 proves apid's handler replied. It does not prove the machine acted, and
 * the difference between those two is the whole reason this suite runs against
 * a booted guest instead of against a router. So this phase marks the console,
 * posts, and then waits for systemd's shutdown transaction to appear on the
 * serial line. Only after that does it accept that the port going quiet means
 * "the guest went down" rather than "something moved in the network".
 *
 * `-no-reboot`, and why this phase ends where it does. os/qemu-run.sh:167
 * passes `-no-reboot`, so a guest-initiated reboot makes QEMU EXIT instead of
 * resetting. That file belongs to the image line and is not edited here. The
 * harness works with the flag: it boots a SECOND time from the SAME disk
 * (MOS_QEMU_REUSE_DISK=1), so the machine comes back through firmware, GRUB and
 * the grubenv this reboot just wrote, and 07b-postreboot runs in a DIFFERENT
 * suite process. This phase therefore ends when the port stops answering. It
 * does not wait for the machine to come back; that would be waiting on a
 * process which has not been started yet.
 *
 * Because 07b is a different process, `ctx.state` cannot carry anything to it.
 * The handoff goes through a JSON file instead -- see `handoffPath`.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON THE CONSOLE READER BELOW
 *
 * The campaign plan put a shared `src/console.ts` in the mutate subtask's
 * hands. At the time this file was written that module had not landed on
 * bkd/esf0br31, nor on any other branch in the repository, so the three phases
 * that need console evidence -- 07, 07b and 08 -- read it through the small
 * reader defined here and import it from this module. It lives HERE, in a file
 * this subtask owns, precisely so that it does not become a second
 * `src/console.ts` competing with the one that module is meant to provide.
 * When that module lands, `openConsole` is the only call site to redirect.
 * ---------------------------------------------------------------------------
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Client, checkbox } from "../client.ts";
import type { Config } from "../config.ts";
import type { Reporter } from "../report.ts";
import type { Phase, PhaseContext } from "../runner.ts";
import { BACKOFF_STATE_KEY, type BackoffState } from "./06-backoff.ts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// the console
// ---------------------------------------------------------------------------

/**
 * mos keeps journald at `Storage=volatile` because /var is the EPHEMERAL
 * partition, so a guest's journal dies with the guest and `os/qemu-journal.sh`
 * cannot work. The harness captures the serial console to a file instead and
 * passes its path as APID_CONSOLE, with
 * `systemd.journald.forward_to_console=1` on the kernel command line so the
 * journal is ON that line. That file is the only log this suite can read, and
 * for a shutdown it is the only evidence that exists at all: by the time the
 * machine is down there is nothing left to ask.
 */
export class ConsoleLog {
  #offset = 0;

  constructor(readonly path: string) {}

  /** Remember where the log currently ends. Everything asserted comes after. */
  mark(): void {
    this.#offset = sizeOf(this.path);
  }

  /** Everything written since the last `mark()`. */
  since(): string {
    return readFrom(this.path, this.#offset);
  }

  /** The whole capture. For a boot-2 log, where the boot itself is the subject. */
  all(): string {
    return readFrom(this.path, 0);
  }

  /**
   * Poll the console until one of `patterns` matches a line, or the deadline
   * passes. Prints a progress line while it waits and hands back the tail when
   * it gives up: a wait that expires and says only "timed out" costs a
   * ten-minute boot to diagnose.
   */
  async waitFor(
    patterns: readonly RegExp[],
    options: {
      readonly report: Reporter;
      readonly what: string;
      readonly timeoutMs: number;
      readonly intervalMs?: number;
      readonly progressMs?: number;
      /** Search the whole capture rather than only what followed `mark()`. */
      readonly fromStart?: boolean;
    },
  ): Promise<ConsoleMatch> {
    const intervalMs = options.intervalMs ?? 1_000;
    const progressMs = options.progressMs ?? 15_000;
    const started = Date.now();
    const deadline = started + options.timeoutMs;
    let nextProgress = started + progressMs;
    let lines: string[] = [];

    for (;;) {
      lines = linesOf(options.fromStart === true ? this.all() : this.since());
      const hit = findMatch(lines, patterns);
      if (hit !== undefined) {
        return { ...hit, matched: true, elapsedMs: Date.now() - started, tail: "" };
      }
      const now = Date.now();
      if (now >= deadline) break;
      if (now >= nextProgress) {
        nextProgress = now + progressMs;
        options.report.note(
          `    ${Math.round((now - started) / 1000)}s/${Math.round(options.timeoutMs / 1000)}s ` +
            `waiting for ${options.what} | last console line: ` +
            truncate(lines.at(-1) ?? "<nothing on the console yet>", 100),
        );
      }
      await sleep(intervalMs);
    }

    return {
      matched: false,
      pattern: undefined,
      line: undefined,
      elapsedMs: Date.now() - started,
      tail: lines.slice(-40).join("\n"),
    };
  }
}

export interface ConsoleMatch {
  readonly matched: boolean;
  readonly pattern: string | undefined;
  readonly line: string | undefined;
  readonly elapsedMs: number;
  /** The last 40 console lines, populated only when the wait expired. */
  readonly tail: string;
}

/** The first line matching any pattern, and which pattern found it. */
export function findMatch(
  lines: readonly string[],
  patterns: readonly RegExp[],
): { readonly pattern: string; readonly line: string } | undefined {
  for (const line of lines) {
    for (const pattern of patterns) {
      if (pattern.test(line)) return { pattern: String(pattern), line };
    }
  }
  return undefined;
}

/**
 * The console log, or undefined when there is none to read.
 *
 * Undefined is not an error: a suite run by hand against a guest somebody else
 * booted has no capture. It is the signal for the caller to SKIP the
 * console-derived half of a check with a stated reason, never to pass it.
 */
export function openConsole(config: Config): ConsoleLog | undefined {
  const configured = config.consoleLog;
  if (configured === undefined) return undefined;
  try {
    // Existence and readability, not content: QEMU appends to this file while
    // the suite runs, so it may legitimately be empty at this instant.
    fs.accessSync(configured, fs.constants.R_OK);
  } catch {
    return undefined;
  }
  return new ConsoleLog(configured);
}

/** Why the console half of a check could not be made. Said out loud, always. */
export function noConsoleReason(config: Config): string {
  return config.consoleLog === undefined
    ? "APID_CONSOLE is not set, so this run has no serial capture to read; the harness sets it, a hand-run suite does not"
    : `APID_CONSOLE names ${JSON.stringify(config.consoleLog)}, which this process cannot read`;
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function readFrom(file: string, offset: number): string {
  let fd: number | undefined;
  try {
    const size = fs.statSync(file).size;
    // A shrunken file means it was rotated or replaced under us; start over
    // rather than read from an offset that now means something else.
    const from = size < offset ? 0 : offset;
    if (size <= from) return "";
    fd = fs.openSync(file, "r");
    const buffer = Buffer.allocUnsafe(size - from);
    const read = fs.readSync(fd, buffer, 0, size - from, from);
    // latin1, not utf8: a serial console carries firmware bytes, ANSI escapes
    // and half-written lines, and a utf8 decode would replace them with U+FFFD
    // and could corrupt the very line an assertion is about.
    return buffer.subarray(0, read).toString("latin1");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(ANSI, "").trimEnd())
    .filter((line) => line !== "");
}

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

/**
 * systemd taking the machine down. Any one of these is proof; which one appears
 * depends on how far the transaction gets before QEMU exits under `-no-reboot`.
 */
export const SHUTDOWN_PATTERNS: readonly RegExp[] = [
  /Reached target\s+(Shutdown|System Shutdown|Late Shutdown|Unmount All Filesystems|Reboot|System Reboot)/i,
  /Starting\s+(System Reboot|Reboot|Unmount All Filesystems)/i,
  /systemd-shutdown\[\d+\]:/,
  /Sending SIGTERM to remaining processes/i,
  /Deactivating swap|Unmounting\s+\/|Remounting.*read-only|re-mounted.*\bro\b/i,
  /reboot: Restarting system/i,
];

/** The far end of the same transaction: the machine actually stopping. */
export const POWEROFF_PATTERNS: readonly RegExp[] = [
  /Reached target\s+Power[\s-]?Off/i,
  /systemd-shutdown\[\d+\]:\s+Powering off/i,
  /\bPowering off\b/i,
  /reboot: Power down/i,
  /ACPI: Preparing to enter system sleep state S5/i,
];

// ---------------------------------------------------------------------------
// reading a confirm token out of a rendered form
// ---------------------------------------------------------------------------

/**
 * The confirm token for one power action, read out of `GET /power`'s HTML.
 *
 * Deliberately NOT hardcoded. The token is the handler's, and reading it off
 * the page is exactly what a browser does; a constant here would still pass
 * after apid changed the token, and would have stopped being a test of the
 * confirm gate at the moment it diverged.
 */
export function confirmTokenFor(html: string, action: string): string | undefined {
  for (const piece of html.split(/<form\b/i).slice(1)) {
    const closing = piece.search(/<\/form\s*>/i);
    const form = closing < 0 ? piece : piece.slice(0, closing);
    const openTagEnd = form.indexOf(">");
    const openTag = openTagEnd < 0 ? form : form.slice(0, openTagEnd);
    if (attributesOf(openTag).get("action") !== action) continue;
    for (const tag of form.match(/<input\b[^>]*>/gi) ?? []) {
      const attributes = attributesOf(tag);
      if (attributes.get("name") === "confirm") return attributes.get("value");
    }
  }
  return undefined;
}

const ATTRIBUTE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+))/g;

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE.lastIndex = 0;
  for (;;) {
    const match = ATTRIBUTE.exec(tag);
    if (match === null) break;
    const name = match[1];
    if (name === undefined) continue;
    attributes.set(name.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

// ---------------------------------------------------------------------------
// the 07 -> 07b handoff, across a process boundary
// ---------------------------------------------------------------------------

/** Everything 07b needs that only 07 could know. */
export interface Handoff {
  readonly schema: 1;
  readonly writtenAtIso: string;
  readonly writtenAtMs: number;
  /** The `apid_session` VALUE held before the reboot, for 07b to replay. */
  readonly sessionCookieValue: string | undefined;
  /** What 05 renamed the device to, and what 07b expects to find after boot 2. */
  readonly hostnameTarget: string;
  /** What 06 left the login guard at. Undefined if 06 did not run. */
  readonly backoff: BackoffState | undefined;
  readonly rebootPostedAtMs: number;
}

/**
 * Where the handoff lives.
 *
 * `APID_HANDOFF` wins if it is set. Otherwise the file sits NEXT TO
 * APID_RESULT_JSON, which the harness points at `_out/x64/apid-api/` -- a
 * directory that outlives both boots and is bind-mounted into the bun
 * container under the same path in both suite invocations. Last resort is the
 * working directory, which makes a hand-run two-process sequence work with no
 * environment at all.
 */
export function handoffPath(config: Config): string {
  const override = process.env["APID_HANDOFF"]?.trim();
  if (override !== undefined && override !== "") return override;
  if (config.resultJson !== undefined) {
    return path.join(path.dirname(config.resultJson), "handoff-07-reboot.json");
  }
  return path.resolve("handoff-07-reboot.json");
}

export type HandoffRead =
  | { readonly ok: true; readonly handoff: Handoff; readonly path: string }
  | { readonly ok: false; readonly why: string; readonly path: string };

/** Read the handoff, or say precisely why it could not be read. Never throws. */
export function readHandoff(config: Config): HandoffRead {
  const file = handoffPath(config);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    return {
      ok: false,
      path: file,
      why:
        `no handoff file at ${file} (${error instanceof Error ? error.message : String(error)}). ` +
        `07-reboot writes it. If 07 did not run in the first boot, or wrote it somewhere ` +
        `else, nothing below can be asserted -- set APID_HANDOFF to point both suite ` +
        `invocations at the same path.`,
    };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not a JSON object");
    return { ok: true, handoff: parsed as Handoff, path: file };
  } catch (error) {
    return {
      ok: false,
      path: file,
      why: `the handoff at ${file} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// "the port stopped answering", with a deadline
// ---------------------------------------------------------------------------

/**
 * Errors that mean "there is no listener there any more", and nothing else.
 *
 * This distinction is load-bearing. `expectPortStopsAnswering` waits for the
 * probe to FAIL, so a blanket catch would read any exception as evidence the
 * guest went down -- including an exception thrown inside this process before a
 * packet was ever sent. That is not hypothetical: `tls.connect` throws a
 * TypeError when `servername` is an IP literal, and APID_HOST is always an IP
 * (see the defect noted in this subtask's report), so a blanket catch would
 * turn a client-side bug into a confident PASS on the most destructive
 * assertion the suite makes.
 */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ETIMEDOUT",
  "EPROTO",
  "ERR_SOCKET_CLOSED",
]);

export function isUnreachable(error: unknown): boolean {
  // A TypeError or RangeError never crossed the network: it is this process
  // getting its own arguments wrong.
  if (error instanceof TypeError || error instanceof RangeError) return false;
  const code: unknown = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && UNREACHABLE_CODES.has(code)) return true;
  // socketRequest's own deadline, which reads as "nothing answered".
  return error instanceof Error && /timed out after \d+ms/.test(error.message);
}

/**
 * Poll the HTTPS port until a connection is refused, unroutable or times out.
 *
 * Every probe dials a NEW socket (`raw` always does), because a pooled
 * connection would keep reporting a listener that is no longer there. A refusal
 * is the PASS condition, so the probe's exception is the success path -- but
 * only for the exceptions in `isUnreachable`. Anything else fails this check
 * immediately and says it was a suite bug, rather than polling for four minutes
 * and then reporting the wrong thing.
 */
export async function expectPortStopsAnswering(
  ctx: PhaseContext,
  what: string,
  timeoutMs: number,
): Promise<boolean> {
  const probe = new Client(ctx.config);
  const started = Date.now();
  const deadline = started + timeoutMs;
  let attempts = 0;
  let nextProgress = started + 15_000;
  let lastStatus: number | undefined;

  for (;;) {
    attempts += 1;
    let gone = false;
    let suiteError: unknown;
    try {
      const response = await probe.raw("/healthz", { timeoutMs: 3_000, sendCookies: false });
      lastStatus = response.status;
    } catch (error) {
      if (isUnreachable(error)) gone = true;
      else suiteError = error;
    }

    if (gone) {
      ctx.report.note(
        `    the port stopped answering after ${attempts} probe(s) in ` +
          `${Math.round((Date.now() - started) / 1000)}s` +
          `${lastStatus === undefined ? " (it never answered from this phase at all)" : `; last status seen was ${lastStatus}`}`,
      );
      return ctx.report.pass(what);
    }
    if (suiteError !== undefined) {
      return ctx.report.fail(
        what,
        [
          `expected: the probe to be refused by a machine that is down`,
          `actual:   the probe threw INSIDE this process, before reaching the network:`,
          `          ${suiteError instanceof Error ? `${suiteError.name}: ${suiteError.message}` : String(suiteError)}`,
          `note:     this is a bug in the suite's client, not evidence about the guest.`,
          `          It is reported as a failure rather than silently counted as "the`,
          `          port went quiet", which is what a blanket catch would have done.`,
        ].join("\n"),
      );
    }

    const now = Date.now();
    if (now >= deadline) {
      return ctx.report.fail(
        what,
        [
          `expected: the HTTPS port to stop answering within ${timeoutMs}ms`,
          `actual:   still answering ${lastStatus ?? "<no status>"} after ${attempts} probe(s)`,
          `origin:   ${ctx.client.origin("https")}`,
          `note:     apid replied to the power action, so either the guest never acted on`,
          `          it or something other than the guest is answering this port.`,
        ].join("\n"),
      );
    }
    if (now >= nextProgress) {
      nextProgress = now + 15_000;
      ctx.report.note(
        `    ${Math.round((now - started) / 1000)}s/${Math.round(timeoutMs / 1000)}s ` +
          `${ctx.client.origin("https")} still answering ${lastStatus ?? "<no status>"} ` +
          `after ${attempts} probe(s)`,
      );
    }
    await sleep(2_000);
  }
}

// ---------------------------------------------------------------------------
// the phase
// ---------------------------------------------------------------------------

const REBOOT_ACTION = "/power/reboot";
/** A window in which an UNCONFIRMED post must be shown to have caused nothing. */
const UNCONFIRMED_GRACE_MS = 5_000;
const SHUTDOWN_EVIDENCE_TIMEOUT_MS = 180_000;
const PORT_QUIET_TIMEOUT_MS = 240_000;

const phase: Phase = {
  id: "07-reboot",
  title: "reboot: POST-only, the confirm token is required, and the device comes back",
  assumes:
    "phase 06 left the login guard ARMED with a recorded failure count (deliberately: " +
    "07b asserts it survived the restart), the main jar still holds the valid session 03 " +
    "established, and 05 renamed the device to config.hostnameTarget. This phase is " +
    "destructive and ends the first boot: everything after it runs in a SECOND suite " +
    "process against a second boot of the same disk.",

  async run(ctx: PhaseContext): Promise<void> {
    const { report, client, config } = ctx;

    // -- 1. what 07b will need, gathered while the machine is still up ------
    const sessionCookie = client.jar.get("apid_session");
    report.check(
      sessionCookie !== undefined,
      "a session cookie is in hand to replay after the reboot",
      [
        `expected: apid_session in the jar, left by 03-login`,
        `actual:   the jar holds ${JSON.stringify(client.jar.names())}`,
        `note:     without it 07b cannot assert that the session did NOT survive, which`,
        `          is one of the two assertions the reboot exists to make.`,
      ].join("\n"),
    );
    const backoff = ctx.state.get(BACKOFF_STATE_KEY) as BackoffState | undefined;
    if (backoff === undefined) {
      report.note(
        "    NOTE: 06-backoff left no guard state, so 07b will have nothing to compare " +
          "the post-reboot backoff against and will SKIP that assertion rather than pass it.",
      );
    }

    const consoleLog = openConsole(config);

    // -- 2. mark, so everything asserted below is AFTER this point ----------
    if (consoleLog !== undefined) consoleLog.mark();

    // -- 3. read the confirm token off the page, as a browser would ---------
    const powerPage = await client.get("/power");
    report.expectStatus(powerPage, 200, "GET /power renders the power page to an authenticated caller");
    const rebootToken = confirmTokenFor(powerPage.body, REBOOT_ACTION);
    report.check(
      rebootToken !== undefined && rebootToken !== "",
      "the reboot form on /power carries a confirm token, read off the page rather than hardcoded",
      [
        `expected: an <input name="confirm" value="..."> inside <form action="${REBOOT_ACTION}">`,
        `actual:   no such input was found`,
        `body:     ${truncate(powerPage.body.replace(/\s+/g, " "), 400)}`,
      ].join("\n"),
    );

    // -- 4. the confirm gate, checked BEFORE anything is confirmed ----------
    //
    // An unconfirmed power action that went through would be the worst defect
    // this suite could find, so it is checked first, while the machine is still
    // in a state where the check means anything at all.
    const absent = await client.post(REBOOT_ACTION, {});
    report.note(`    POST ${REBOOT_ACTION} with no confirm field answered ${absent.status}`);
    const wrong = await client.post(REBOOT_ACTION, { confirm: checkbox(true, "not-the-confirm-token") });
    report.note(`    POST ${REBOOT_ACTION} with a wrong confirm answered ${wrong.status}`);
    report.check(
      absent.status !== 303 || wrong.status !== 303,
      "an unconfirmed POST /power/reboot is not answered as an accepted power action",
      [
        `expected: at least one of the two unconfirmed posts to be refused rather than accepted`,
        `actual:   no-confirm answered ${absent.status}, wrong-confirm answered ${wrong.status}`,
        `note:     303 is what the CONFIRMED post below is asserted to return, so two 303s`,
        `          here would mean the confirm field decides nothing.`,
      ].join("\n"),
    );

    const healthz = await client.get("/healthz", { sendCookies: false });
    report.expectStatus(
      healthz,
      200,
      "the machine is STILL UP after an unconfirmed and a wrongly-confirmed POST /power/reboot",
    );
    if (consoleLog !== undefined) {
      await sleep(UNCONFIRMED_GRACE_MS);
      const suspicious = findMatch(linesOf(consoleLog.since()), SHUTDOWN_PATTERNS);
      report.check(
        suspicious === undefined,
        `no shutdown transaction appeared on the console in the ${UNCONFIRMED_GRACE_MS}ms after the unconfirmed posts`,
        [
          `expected: nothing resembling a shutdown on the serial line`,
          `actual:   ${JSON.stringify(suspicious?.line)} matched ${suspicious?.pattern}`,
          `note:     /healthz answering is not enough on its own -- a machine that has just`,
          `          begun its shutdown transaction still answers for a moment.`,
        ].join("\n"),
      );
    } else {
      report.skip(
        "the console shows no shutdown after the unconfirmed posts",
        noConsoleReason(config),
      );
    }

    // -- 5. the real one ----------------------------------------------------
    if (consoleLog !== undefined) consoleLog.mark();
    const rebootPostedAtMs = Date.now();
    const posted = await client.post(REBOOT_ACTION, {
      confirm: checkbox(true, rebootToken ?? "the-token-was-not-found-on-the-page"),
    });
    report.expectStatus(
      posted,
      303,
      "POST /power/reboot carrying the page's own confirm token is accepted (303)",
    );

    // Write the handoff NOW, while there is still a filesystem to write it to
    // and before any wait can be interrupted. It lands on the HOST side of the
    // bind mount, not on the guest, so the reboot cannot take it with it.
    const handoff: Handoff = {
      schema: 1,
      writtenAtIso: new Date(rebootPostedAtMs).toISOString(),
      writtenAtMs: rebootPostedAtMs,
      sessionCookieValue: sessionCookie?.value,
      hostnameTarget: config.hostnameTarget,
      backoff,
      rebootPostedAtMs,
    };
    const file = handoffPath(config);
    let wrote = true;
    let writeError = "";
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(handoff, undefined, 2)}\n`, "utf8");
    } catch (error) {
      wrote = false;
      writeError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    report.check(
      wrote,
      "the 07 -> 07b handoff is persisted to a file, because 07b runs in a DIFFERENT process",
      [
        `expected: a writable ${file}`,
        `actual:   ${writeError}`,
        `note:     the second boot is a second suite invocation, so ctx.state cannot reach`,
        `          it. APID_HANDOFF overrides this path for both processes.`,
      ].join("\n"),
    );
    if (wrote) report.note(`    handoff written to ${file}`);

    // -- 6. the console, which is the actual proof --------------------------
    //
    // The 303 above proves apid's handler replied. It says nothing about
    // whether the machine acted on it. This is the assertion the whole phase is
    // built around, and it is the one an in-process test cannot make.
    if (consoleLog !== undefined) {
      const evidence = await consoleLog.waitFor(SHUTDOWN_PATTERNS, {
        report,
        what: "systemd's shutdown transaction on the console",
        timeoutMs: SHUTDOWN_EVIDENCE_TIMEOUT_MS,
      });
      report.check(
        evidence.matched,
        "the CONSOLE shows the guest shutting down -- the machine acted, not merely the handler",
        [
          `expected: a line matching one of ${SHUTDOWN_PATTERNS.length} shutdown patterns`,
          `actual:   none within ${evidence.elapsedMs}ms of the 303`,
          `patterns: ${SHUTDOWN_PATTERNS.map(String).join(" | ")}`,
          `the last console lines since the post:`,
          evidence.tail === "" ? "          <the console produced nothing at all>" : evidence.tail,
        ].join("\n"),
      );
      if (evidence.matched) {
        report.note(
          `    console evidence ${evidence.elapsedMs}ms after the post: ${truncate(evidence.line ?? "", 120)}`,
        );
      }
    } else {
      report.skip(
        "the CONSOLE shows the guest shutting down",
        `${noConsoleReason(config)} -- that leaves only the 303 and the port going quiet, and neither one proves the machine acted`,
      );
    }

    // -- 7. and only then does the port going quiet mean anything -----------
    await expectPortStopsAnswering(
      ctx,
      "the HTTPS port stops answering: the guest is down",
      PORT_QUIET_TIMEOUT_MS,
    );

    report.note(
      "    07 ends here by design. os/qemu-run.sh:167 passes -no-reboot, so QEMU EXITS " +
        "rather than resets; the harness boots the same disk a second time and runs " +
        "07b-postreboot in a new suite process. Waiting for the machine here would be " +
        "waiting on a process that has not been started yet.",
    );
  },
};

export default phase;
