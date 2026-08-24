// Filled in by the mutate-phase subtask; this file is that subtask's only edit.
//
// Until then it is RED on purpose. An unimplemented phase that is absent, or
// that reports nothing, is indistinguishable from a phase that passed.

import type { Phase } from "../runner.ts";

const phase: Phase = {
  id: "05-mutate",
  title: "mutation: hostname, network, ssh and containers, and what each one persists",
  assumes: "TODO: phase 04 left the session valid and read every route's pre-mutation state into ctx.state for this phase to compare against.",
  async run(ctx) {
    ctx.report.fail("05-mutate is not implemented");
  },
};

export default phase;
