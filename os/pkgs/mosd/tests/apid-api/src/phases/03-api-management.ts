/** Cookie and bearer management through /api, with retired form routes inert. */

import type { JsonValue } from "../report.ts";
import type { Phase, PhaseContext } from "../runner.ts";
import { BEARER_STATE, CSRF_STATE } from "./02-session.ts";

function parseObject(body: string): Record<string, JsonValue> | undefined {
  try {
    const value = JSON.parse(body) as JsonValue;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const phase: Phase = {
  id: "03-api-management",
  title: "all appliance reads and writes flow through the authenticated JSON API",
  assumes: "02 left an authenticated browser session plus its CSRF token and setup bearer in phase state",

  async run({ client, report, config, state }: PhaseContext): Promise<void> {
    const csrf = state.get(CSRF_STATE);
    const bearer = state.get(BEARER_STATE);
    if (typeof csrf !== "string" || typeof bearer !== "string") {
      report.fail("the management phase received both credentials from setup", `csrf=${typeof csrf}; bearer=${typeof bearer}`);
      return;
    }

    const ui = await client.get("/api/v1/ui");
    report.expectStatus(ui, 200, "GET /api/v1/ui reports UI selection through the API");
    report.expectJson(ui, { mode: "builtIn" }, "the factory image reports the built-in UI active", { subset: true });

    const hostname = await client.get("/api/v1/settings/hostname");
    report.expectStatus(hostname, 200, "GET /api/v1/settings/hostname reads through the browser session");
    report.expectJson(hostname, config.hostnameTarget, "the setup hostname reads back through the API");

    const current = await client.get("/api/v1/settings/container.enabled");
    report.expectStatus(current, 200, "GET /api/v1/settings/container.enabled reads the container switch");
    const enabled = JSON.parse(current.body) as JsonValue;
    if (typeof enabled !== "boolean") {
      report.fail("the container setting is a boolean", `actual body: ${current.body}`);
      return;
    }

    const refused = await client.request("PUT", "/api/v1/settings/container.enabled", {
      body: JSON.stringify(enabled),
      contentType: "application/json",
    });
    report.expectStatus(refused, 403, "a cookie-authenticated settings PUT without CSRF is refused");
    report.expectJson(
      refused,
      { error: { code: "csrf_invalid", source: "apid" } },
      "the missing-CSRF refusal uses the API envelope",
      { subset: true },
    );

    const accepted = await client.request("PUT", "/api/v1/settings/container.enabled", {
      body: JSON.stringify(enabled),
      contentType: "application/json",
      headers: { "X-CSRF-Token": csrf },
    });
    report.expectStatus(accepted, 202, "the same settings PUT with CSRF is accepted");
    const acceptedBody = parseObject(accepted.body);
    const taskId = acceptedBody?.["taskId"];
    report.check(
      typeof taskId === "string" && taskId.length > 0,
      "the accepted settings write returns its \"taskId\"",
      `actual body: ${accepted.body}`,
    );
    if (typeof taskId === "string") {
      const task = await client.get(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
      report.expectStatus(task, 200, "GET /api/v1/tasks/{id} exposes the accepted write");
    }

    const bearerRead = await client.get("/api/v1/settings/hostname", {
      sendCookies: false,
      headers: { Authorization: `Bearer ${bearer}` },
    });
    report.expectStatus(bearerRead, 200, "the setup bearer reads the same management API without CSRF");

    const anonymous = await client.get("/api/v1/ui", { sendCookies: false });
    report.expectStatus(anonymous, 401, "an API management read with no credential is refused");

    for (const path of [
      "/containers/enable",
      "/mqtt/enable",
      "/hostname",
      "/network",
      "/ssh/enable",
      "/power/poweroff",
      "/builtin/deactivate",
    ] as const) {
      const response = await client.post(path, { enabled: "on", hostname: "must-not-apply" });
      report.expectStatus(response, 405, `POST ${path} remains outside the management surface after login`);
    }

    const unchanged = await client.get("/api/v1/settings/hostname");
    report.expectJson(unchanged, config.hostnameTarget, "retired form routes did not mutate the hostname");
  },
};

export default phase;
