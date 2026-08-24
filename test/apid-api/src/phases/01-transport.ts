// Filled in by the transport-phase subtask; this file is that subtask's only edit.
//
// Until then it is RED on purpose. An unimplemented phase that is absent, or
// that reports nothing, is indistinguishable from a phase that passed.

import type { Phase } from "../runner.ts";

const phase: Phase = {
  id: "01-transport",
  title: "transport: the certificate, the :80 -> :443 redirect, and verbatim request targets",
  assumes: "TODO: nothing but a booted guest with apid listening on both published ports; this phase is first and assumes no prior phase ran.",
  async run(ctx) {
    ctx.report.fail("01-transport is not implemented");
  },
};

export default phase;
