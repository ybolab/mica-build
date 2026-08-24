/**
 * The suite's entry point and the ordered phase registry.
 *
 * Every phase module is imported here, up front. That is deliberate: it means
 * no later subtask has to touch a shared file to add its work -- each fills in
 * exactly one phase module, and this registry never has to be edited again.
 *
 * The order is fixed by design, not by convenience. It runs from the cheapest
 * and least destructive assertion to the one that takes the guest down, so a
 * failure early costs nothing and a failure late has everything before it
 * already recorded.
 */

import { Client } from "./client.ts";
import { loadConfigOrExit } from "./config.ts";
import { Reporter } from "./report.ts";
import { runPhases, type Phase, type PhaseContext } from "./runner.ts";

import transport from "./phases/01-transport.ts";
import setup from "./phases/02-setup.ts";
import login from "./phases/03-login.ts";
import readOnly from "./phases/04-readonly.ts";
import mutate from "./phases/05-mutate.ts";
import backoff from "./phases/06-backoff.ts";
import reboot from "./phases/07-reboot.ts";
import poweroff from "./phases/08-poweroff.ts";

export const PHASES: readonly Phase[] = [
  transport,
  setup,
  login,
  readOnly,
  mutate,
  backoff,
  reboot,
  poweroff,
];

async function main(): Promise<void> {
  const config = loadConfigOrExit();
  const report = new Reporter({
    host: config.host,
    resultJsonPath: config.resultJson,
    negative: config.negative,
  });
  const client = new Client(config);

  report.note(
    `apid black-box suite against ${client.origin("https")} (plain HTTP on :${config.httpPort})`,
  );
  if (config.negative !== undefined) {
    report.note(
      `NOTE: APID_NEGATIVE=${config.negative} -- a check will be inverted; this run should be RED.`,
    );
  }

  const ctx: PhaseContext = { client, report, config, state: new Map<string, unknown>() };
  try {
    await runPhases(PHASES, ctx, config.phases);
  } catch (error) {
    // Registry-level refusals (an empty `assumes`, an unknown APID_PHASES id)
    // land here. They are reported as a failed check so the RESULT line is
    // still printed and the exit code is still meaningful.
    report.fail(
      "the phase registry and the phase selection are usable",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
  }

  report.finish();
}

await main();
