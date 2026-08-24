// Filled in by the login-phase subtask; this file is that subtask's only edit.
//
// Until then it is RED on purpose. An unimplemented phase that is absent, or
// that reports nothing, is indistinguishable from a phase that passed.

import type { Phase } from "../runner.ts";

const phase: Phase = {
  id: "03-login",
  title: "login and session: the cookie's attributes, the gate after setup, and /logout",
  assumes: "TODO: phase 02 left an admin password set, the device out of setup mode, and the jar EMPTY (the setup response's session, if any, was cleared).",
  async run(ctx) {
    ctx.report.fail("03-login is not implemented");
  },
};

export default phase;
