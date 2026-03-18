const frontendUrl = stripTrailingSlash(
  process.env.SPLIT_FRONTEND_URL || process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001",
);
const controllerUrl = stripTrailingSlash(process.env.SPLIT_CONTROLLER_URL || "http://localhost:8080");
const username = process.env.SPLIT_ADMIN_USERNAME || "admin";
const password = process.env.SPLIT_ADMIN_PASSWORD || "changeme";

async function main() {
  const checks = [];

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
  checks.push(ok("frontend proxy login", `authenticated as ${login.user?.username || username}`));

  const authHeaders = { Authorization: `Bearer ${login.token}` };

  const profile = await fetchJson(`${frontendUrl}/api/backend/api/profile`, { headers: authHeaders });
  if (!profile?.user?.username) {
    throw new Error("Profile response is missing user.username");
  }
  checks.push(ok("profile summary", profile.user.username));

  const results = await fetchJson(`${frontendUrl}/api/backend/api/result/list?limit=5&offset=0`, {
    headers: authHeaders,
  });
  checks.push(ok("result list", summariseCount(results?.total, results?.results?.length ?? results?.items?.length)));

  const templates = await fetchJson(`${frontendUrl}/api/backend/api/templates`, { headers: authHeaders });
  checks.push(ok("template list", summariseCount(templates?.total, templates?.templates?.length)));

  const schedules = await fetchJson(`${frontendUrl}/api/backend/api/schedules`, { headers: authHeaders });
  checks.push(ok("schedule list", summariseCount(undefined, schedules?.schedules?.length)));

  const systemExport = await fetchJson(`${frontendUrl}/api/backend/api/admin/templates/system/export`, {
    headers: authHeaders,
  });
  const exportedCount = Array.isArray(systemExport?.templates)
    ? systemExport.templates.length
    : systemExport?.template
      ? 1
      : 0;
  checks.push(ok("system template export", `${exportedCount} exported`));

  const dashboards = await fetchJson(`${frontendUrl}/api/backend/api/admin/workers/dashboards`, {
    headers: authHeaders,
  });
  const dashboardCount = Array.isArray(dashboards?.dashboards) ? dashboards.dashboards.length : 0;
  checks.push(ok("worker dashboards", `${dashboardCount} workers, phase=${dashboards?.phase || "unknown"}`));

  printSummary(checks);
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

function summariseCount(total, visible) {
  if (typeof total === "number") {
    return `total=${total}, visible=${visible ?? 0}`;
  }
  return `${visible ?? 0} visible`;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function truncate(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function ok(name, detail) {
  return { name, detail };
}

function printSummary(checks) {
  console.log("");
  console.log("Separate deployment smoke validation passed:");
  for (const check of checks) {
    console.log(`- ${check.name}: ${check.detail}`);
  }
  console.log("");
  console.log(`Frontend:   ${frontendUrl}`);
  console.log(`Controller: ${controllerUrl}`);
}

main().catch((error) => {
  console.error("");
  console.error("Separate deployment smoke validation failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
