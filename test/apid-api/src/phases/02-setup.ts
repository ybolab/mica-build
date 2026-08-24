// Filled in by the setup-phase subtask; this file is that subtask's only edit.
//
// Until then it is RED on purpose. An unimplemented phase that is absent, or
// that reports nothing, is indistinguishable from a phase that passed.

import type { Phase } from "../runner.ts";

const phase: Phase = {
  id: "02-setup",
  title: "setup mode: the gate herds every route to /setup, and the first admin password is accepted",
  assumes: "TODO: phase 01 left the transport proven and the device still in SETUP MODE -- no admin password hash on disk, so the gate redirects everything but /healthz to /setup.",
  async run(ctx) {
    ctx.report.fail("02-setup is not implemented");
  },
};

export default phase;
