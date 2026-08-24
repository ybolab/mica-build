// Filled in by the read-only-phase subtask; this file is that subtask's only edit.
//
// Until then it is RED on purpose. An unimplemented phase that is absent, or
// that reports nothing, is indistinguishable from a phase that passed.

import type { Phase } from "../runner.ts";

const phase: Phase = {
  id: "04-readonly",
  title: "read-only routes: every GET, /healthz unauthenticated, and the /api 404 envelope",
  assumes: "TODO: phase 03 left a valid session in the jar and the device out of setup mode.",
  async run(ctx) {
    ctx.report.fail("04-readonly is not implemented");
  },
};

export default phase;
