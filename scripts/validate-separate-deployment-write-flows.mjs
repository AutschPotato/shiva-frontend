const frontendUrl = stripTrailingSlash(
  process.env.SPLIT_FRONTEND_URL || process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001",
);
const controllerUrl = stripTrailingSlash(process.env.SPLIT_CONTROLLER_URL || "http://localhost:8080");
const username = process.env.SPLIT_ADMIN_USERNAME || "admin";
const password = process.env.SPLIT_ADMIN_PASSWORD || "changeme";
const timezone = process.env.SPLIT_TIMEZONE || "Europe/Berlin";
const runPollIntervalMs = Number(process.env.SPLIT_RUN_POLL_INTERVAL_MS || 2000);
const idleTimeoutMs = Number(process.env.SPLIT_IDLE_TIMEOUT_MS || 300000);
const runTimeoutMs = Number(process.env.SPLIT_RUN_TIMEOUT_MS || 480000);
const resultTimeoutMs = Number(process.env.SPLIT_RESULT_TIMEOUT_MS || 180000);
const scheduleTriggerTimeoutMs = Number(process.env.SPLIT_SCHEDULE_TRIGGER_TIMEOUT_MS || 90000);

async function main() {
  const checks = [];
  const resources = {
    templateIds: [],
    scheduleIds: [],
  };

  try {
    checks.push(await checkHttp("controller health", `${controllerUrl}/api/health`));
    checks.push(await checkHttp("frontend login page", `${frontendUrl}/login`, { expectJson: false }));

    const login = await fetchJson(`${frontendUrl}/api/backend/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!login?.token) {
      throw new Error("Login did not return a token");
    }

    const authHeaders = { Authorization: `Bearer ${login.token}` };
    checks.push(ok("frontend proxy login", `authenticated as ${login.user?.username || username}`));

    await waitForIdle(authHeaders, "before write-flow validation");
    checks.push(ok("idle gate", "no active test before write validation"));

    const builderProfile = createTinyBuilderProfile("split-write-builder");
    const builderRun = await startRun(authHeaders, builderProfile.request, "builder run");
    const builderResult = await waitForRunAndResult(authHeaders, builderRun.test_id, "builder run");
    checks.push(ok("builder run", `${builderRun.test_id} completed via separate deployment`));

    const rerunPayload = buildRunPayloadFromClone(
      buildCloneDataFromResult(builderResult),
      uniqueName("split-write-rerun"),
    );
    await waitForIdle(authHeaders, "before result re-run");
    const rerun = await startRun(authHeaders, rerunPayload, "result re-run");
    await waitForRunAndResult(authHeaders, rerun.test_id, "result re-run");
    checks.push(ok("result re-run", `${rerun.test_id} completed from cloned result data`));

    const templatePayload = buildTemplatePayloadFromResult(builderResult);
    const template = await fetchJson(`${frontendUrl}/api/backend/api/templates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(templatePayload),
    });
    if (!template?.id) {
      throw new Error("Template creation did not return an id");
    }
    resources.templateIds.push(template.id);
    checks.push(ok("template create", `${template.id} created from builder result`));

    const templateRunPayload = buildRunPayloadFromClone(
      buildCloneDataFromTemplate(template),
      uniqueName("split-write-template-run"),
    );
    await waitForIdle(authHeaders, "before template-based run");
    const templateRun = await startRun(authHeaders, templateRunPayload, "template-based run");
    await waitForRunAndResult(authHeaders, templateRun.test_id, "template-based run");
    checks.push(ok("template-based run", `${templateRun.test_id} completed from template clone data`));

    const scheduleBase = buildSchedulePayloadFromBuilderProfile(builderProfile, {
      name: uniqueName("split-write-schedule"),
      projectName: uniqueName("split-write-schedule-project"),
      scheduledAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      timezone,
    });

    await waitForIdle(authHeaders, "before schedule create");
    const schedule = await fetchJson(`${frontendUrl}/api/backend/api/schedules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(scheduleBase),
    });
    if (!schedule?.id) {
      throw new Error("Schedule creation did not return an id");
    }
    resources.scheduleIds.push(schedule.id);
    checks.push(ok("schedule create", `${schedule.id} created`));

    const updatedSchedulePayload = {
      ...scheduleBase,
      name: `${scheduleBase.name}-updated`,
      project_name: `${scheduleBase.project_name}-updated`,
      scheduled_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    };
    const updatedSchedule = await fetchJson(`${frontendUrl}/api/backend/api/schedules/${schedule.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(updatedSchedulePayload),
    });
    checks.push(ok("schedule update", `${updatedSchedule.id} renamed to ${updatedSchedule.name}`));

    const executionsBefore = await fetchJson(
      `${frontendUrl}/api/backend/api/schedules/${schedule.id}/executions`,
      { headers: authHeaders },
    );
    const priorExecutionCount = Array.isArray(executionsBefore?.executions) ? executionsBefore.executions.length : 0;

    await waitForIdle(authHeaders, "before schedule run-now");
    const runNowStartedAt = Date.now();
    const runNow = await fetchJson(`${frontendUrl}/api/backend/api/schedules/${schedule.id}/run-now`, {
      method: "POST",
      headers: authHeaders,
    });
    if (runNow?.status !== "triggered") {
      throw new Error(`Schedule run-now returned unexpected status: ${JSON.stringify(runNow)}`);
    }

    const scheduleTriggered = await waitForScheduleTriggeredRun(
      authHeaders,
      schedule.id,
      priorExecutionCount,
      runNowStartedAt,
    );
    const scheduledResult = await waitForRunAndResult(
      authHeaders,
      scheduleTriggered.testId,
      "schedule run-now",
    );
    const matchingExecution = await waitForScheduleExecutionLink(
      authHeaders,
      schedule.id,
      scheduleTriggered.testId,
    );
    checks.push(
      ok(
        "schedule run-now",
        `${scheduleTriggered.testId} completed, execution=${matchingExecution.id}, status=${matchingExecution.status}`,
      ),
    );

    await fetchJson(`${frontendUrl}/api/backend/api/schedules/${schedule.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    resources.scheduleIds = resources.scheduleIds.filter((id) => id !== schedule.id);
    checks.push(ok("schedule cleanup", `${schedule.id} deleted after validation`));

    await fetchJson(`${frontendUrl}/api/backend/api/templates/${template.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    resources.templateIds = resources.templateIds.filter((id) => id !== template.id);
    checks.push(ok("template cleanup", `${template.id} deleted after validation`));

    printSummary(checks);
    printWriteFlowNotes(builderResult, scheduledResult);
  } catch (error) {
    console.error("");
    console.error("Separate deployment write-flow validation failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await cleanupResources(resources);
  }
}

function createTinyBuilderProfile(prefix) {
  const stages = [{ duration: "1s", target: 1 }];
  return {
    request: {
      project_name: uniqueName(prefix),
      url: "http://target-lb:8090",
      executor: "ramping-vus",
      stages,
      http_method: "GET",
      content_type: "application/json",
      sleep_seconds: 0,
      config_content: JSON.stringify({
        env: {
          TARGET_URL: "http://target-lb:8090",
          HTTP_METHOD: "GET",
          CONTENT_TYPE: "application/json",
        },
      }),
    },
    stages,
  };
}

function buildSchedulePayloadFromBuilderProfile(profile, args) {
  return {
    name: args.name,
    project_name: args.projectName,
    mode: "builder",
    url: profile.request.url,
    executor: profile.request.executor,
    stages: profile.request.stages,
    http_method: profile.request.http_method,
    content_type: profile.request.content_type,
    config_content: profile.request.config_content,
    scheduled_at: args.scheduledAt,
    timezone: args.timezone,
    recurrence_type: "once",
    estimated_duration_s: 1,
  };
}

function buildCloneDataFromResult(result) {
  const cloneData = {};
  if (result.script_content) cloneData.script_content = result.script_content;
  if (result.config_content) cloneData.config_content = result.config_content;
  if (result.url) cloneData.url = result.url;
  if (result.metadata?.payload?.http_method || result.http_method) {
    cloneData.http_method = result.metadata?.payload?.http_method ?? result.http_method;
  }
  if (result.metadata?.payload?.content_type || result.content_type) {
    cloneData.content_type = result.metadata?.payload?.content_type ?? result.content_type;
  }
  if (result.payload_source_json) cloneData.payload_json = result.payload_source_json;
  if (result.metadata?.payload?.payload_target_kib) {
    cloneData.payload_target_kib = Math.round(result.metadata.payload.payload_target_kib);
  }
  if (result.metadata?.stages) cloneData.stages = result.metadata.stages;
  return cloneData;
}

function buildTemplatePayloadFromResult(result) {
  return {
    name: uniqueName("split-write-template"),
    description: `Created from split validation result ${String(result.id || "").slice(0, 8)}`,
    mode: result.script_content ? "upload" : "builder",
    url: result.url || undefined,
    stages: result.metadata?.stages,
    http_method: result.metadata?.payload?.http_method ?? result.http_method ?? undefined,
    content_type: result.metadata?.payload?.content_type ?? result.content_type ?? undefined,
    payload_json: result.payload_source_json || undefined,
    payload_target_kib: result.metadata?.payload?.payload_target_kib
      ? Math.round(result.metadata.payload.payload_target_kib)
      : undefined,
    script_content: result.script_content || undefined,
    config_content: result.config_content || undefined,
  };
}

function buildCloneDataFromTemplate(template) {
  const cloneData = { mode: template.mode };
  if (template.script_content) cloneData.script_content = template.script_content;
  if (template.config_content) cloneData.config_content = template.config_content;
  if (template.url) cloneData.url = template.url;
  if (template.executor) cloneData.executor = template.executor;
  if (template.http_method) cloneData.http_method = template.http_method;
  if (template.content_type) cloneData.content_type = template.content_type;
  if (template.payload_json) cloneData.payload_json = template.payload_json;
  if (template.payload_target_kib) cloneData.payload_target_kib = template.payload_target_kib;
  if (template.auth?.auth_enabled) cloneData.auth = template.auth;
  if (template.stages) cloneData.stages = template.stages;
  return cloneData;
}

function buildRunPayloadFromClone(cloneData, projectName) {
  if (cloneData.script_content) {
    return {
      project_name: projectName,
      script_content: cloneData.script_content,
      ...(cloneData.config_content ? { config_content: cloneData.config_content } : {}),
    };
  }

  const executor = cloneData.executor || (Array.isArray(cloneData.stages) && cloneData.stages.length > 0
    ? "ramping-vus"
    : "constant-vus");
  const payload = {
    project_name: projectName,
    url: cloneData.url,
    executor,
    http_method: cloneData.http_method || "POST",
    content_type: cloneData.content_type || "application/json",
    ...(cloneData.config_content ? { config_content: cloneData.config_content } : {}),
    ...(cloneData.auth ? { auth: cloneData.auth } : {}),
  };

  if (executor === "ramping-vus" || executor === "ramping-arrival-rate") {
    payload.stages = Array.isArray(cloneData.stages) && cloneData.stages.length > 0
      ? cloneData.stages
      : [{ duration: "1s", target: 1 }];
  }
  if (executor === "constant-vus") {
    payload.vus = 1;
    payload.duration = "1s";
    payload.sleep_seconds = 0;
  }
  if (executor === "constant-arrival-rate") {
    payload.rate = 1;
    payload.time_unit = "1s";
    payload.duration = "1s";
    payload.pre_allocated_vus = 1;
    payload.max_vus = 1;
  }
  if (cloneData.payload_json && methodAllowsPayload(payload.http_method)) {
    payload.payload_json = cloneData.payload_json;
  }
  if (cloneData.payload_target_kib > 0 && methodAllowsPayload(payload.http_method)) {
    payload.payload_target_kib = cloneData.payload_target_kib;
  }
  return payload;
}

async function startRun(authHeaders, payload, label) {
  const response = await fetchJson(`${frontendUrl}/api/backend/api/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  });
  if (!response?.test_id) {
    throw new Error(`${label} did not return a test_id`);
  }
  return response;
}

async function waitForRunAndResult(authHeaders, testId, label) {
  const startedAt = Date.now();
  let seenPhase = null;

  while (Date.now() - startedAt < runTimeoutMs) {
    const live = await fetchJsonAllow404(`${frontendUrl}/api/backend/api/metrics/live`, { headers: authHeaders });
    if (live.status === 404) {
      const result = await fetchJsonAllow404(`${frontendUrl}/api/backend/api/result/${testId}`, {
        headers: authHeaders,
      });
      if (result.status === 200) {
        return result.body;
      }
    } else {
      const body = live.body;
      if (body?.test_id === testId) {
        seenPhase = body.phase || seenPhase;
        if (body.phase === "done" || body.status === "completed") {
          return waitForResult(authHeaders, testId, label);
        }
      } else if (body?.test_id && body.test_id !== testId && body.phase !== "done") {
        throw new Error(
          `${label} expected live test ${testId}, but observed active test ${body.test_id} in phase ${body.phase || "unknown"}`,
        );
      }
    }

    await sleep(runPollIntervalMs);
  }

  throw new Error(`${label} did not finish within ${Math.round(runTimeoutMs / 1000)}s (last phase: ${seenPhase || "none"})`);
}

async function waitForResult(authHeaders, testId, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < resultTimeoutMs) {
    const result = await fetchJsonAllow404(`${frontendUrl}/api/backend/api/result/${testId}`, {
      headers: authHeaders,
    });
    if (result.status === 200) {
      return result.body;
    }
    await sleep(runPollIntervalMs);
  }
  throw new Error(`${label} completed but result ${testId} was not available within ${Math.round(resultTimeoutMs / 1000)}s`);
}

async function waitForIdle(authHeaders, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < idleTimeoutMs) {
    const live = await fetchJsonAllow404(`${frontendUrl}/api/backend/api/metrics/live`, { headers: authHeaders });
    if (live.status === 404) {
      return;
    }
    const phase = live.body?.phase || "unknown";
    if (phase === "done") {
      return;
    }
    await sleep(runPollIntervalMs);
  }
  throw new Error(`${label} timed out waiting for an idle controller`);
}

async function waitForScheduleTriggeredRun(authHeaders, scheduleId, priorExecutionCount, runNowStartedAt) {
  const startedAt = Date.now();
  let observedTestId = "";

  while (Date.now() - startedAt < scheduleTriggerTimeoutMs) {
    const [live, executions] = await Promise.all([
      fetchJsonAllow404(`${frontendUrl}/api/backend/api/metrics/live`, { headers: authHeaders }),
      fetchJson(`${frontendUrl}/api/backend/api/schedules/${scheduleId}/executions`, { headers: authHeaders }),
    ]);

    if (live.status === 200 && live.body?.test_id && live.body?.phase !== "done") {
      observedTestId = live.body.test_id;
    }

    const items = Array.isArray(executions?.executions) ? executions.executions : [];
    const newest = items[0];
    if (items.length > priorExecutionCount) {
      if (newest?.load_test_id) {
        return { testId: newest.load_test_id, execution: newest };
      }
      if (observedTestId) {
        return { testId: observedTestId, execution: newest };
      }
    }

    const freshMatch = items.find((execution) => {
      const createdAt = execution?.created_at ? Date.parse(execution.created_at) : NaN;
      return Number.isFinite(createdAt) && createdAt >= runNowStartedAt - 5000;
    });
    if (freshMatch?.load_test_id) {
      return { testId: freshMatch.load_test_id, execution: freshMatch };
    }
    if (freshMatch && observedTestId) {
      return { testId: observedTestId, execution: freshMatch };
    }

    await sleep(runPollIntervalMs);
  }

  throw new Error(`Schedule ${scheduleId} did not trigger a run within ${Math.round(scheduleTriggerTimeoutMs / 1000)}s`);
}

async function waitForScheduleExecutionLink(authHeaders, scheduleId, testId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < resultTimeoutMs) {
    const executions = await fetchJson(`${frontendUrl}/api/backend/api/schedules/${scheduleId}/executions`, {
      headers: authHeaders,
    });
    const items = Array.isArray(executions?.executions) ? executions.executions : [];
    const match = items.find((execution) => execution.load_test_id === testId);
    if (match) {
      return match;
    }
    await sleep(runPollIntervalMs);
  }
  throw new Error(`Schedule executions did not reference triggered test ${testId}`);
}

async function cleanupResources(resources) {
  const token = await loginForCleanup();
  if (!token) {
    return;
  }
  const authHeaders = { Authorization: `Bearer ${token}` };

  for (const scheduleId of [...resources.scheduleIds]) {
    try {
      await fetchJsonAllow404(`${frontendUrl}/api/backend/api/schedules/${scheduleId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
    } catch {
      // Best-effort cleanup only.
    }
  }

  for (const templateId of [...resources.templateIds]) {
    try {
      await fetchJsonAllow404(`${frontendUrl}/api/backend/api/templates/${templateId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function loginForCleanup() {
  try {
    const login = await fetchJson(`${frontendUrl}/api/backend/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return login?.token || "";
  } catch {
    return "";
  }
}

async function checkHttp(name, url, opts = {}) {
  const response = await fetch(url, { redirect: "manual" });
  if (!response.ok) {
    throw new Error(`${name} failed with HTTP ${response.status}`);
  }
  if (opts.expectJson !== false) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error(`${name} returned unexpected content type: ${contentType || "unknown"}`);
    }
  }
  return ok(name, `HTTP ${response.status}`);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${url} failed with HTTP ${response.status}: ${truncate(text)}`);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Expected JSON from ${url}, received: ${truncate(text)} (${error.message})`);
  }
}

async function fetchJsonAllow404(url, init = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  if (response.status === 404) {
    return { status: 404, body: null };
  }
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${url} failed with HTTP ${response.status}: ${truncate(text)}`);
  }
  try {
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  } catch (error) {
    throw new Error(`Expected JSON from ${url}, received: ${truncate(text)} (${error.message})`);
  }
}

function methodAllowsPayload(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method || "").toUpperCase());
}

function uniqueName(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function truncate(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok(name, detail) {
  return { name, detail };
}

function printSummary(checks) {
  console.log("");
  console.log("Separate deployment write-flow validation passed:");
  for (const check of checks) {
    console.log(`- ${check.name}: ${check.detail}`);
  }
  console.log("");
  console.log(`Frontend:   ${frontendUrl}`);
  console.log(`Controller: ${controllerUrl}`);
}

function printWriteFlowNotes(builderResult, scheduledResult) {
  console.log("");
  console.log("Validated flows:");
  console.log(`- Builder run -> result ${builderResult.id}`);
  console.log("- Result clone data -> manual re-run");
  console.log("- Result save-as-template payload -> template create");
  console.log("- Template clone data -> manual run");
  console.log(`- Schedule create/update/run-now -> result ${scheduledResult.id}`);
  console.log("");
}

main();
