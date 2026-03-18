# Separate Deployment Validation

This guide validates that the frontend can run as its own deployment against a separately running backend/platform deployment.

## Assumptions

- The backend/platform stack is started independently from the frontend.
- The controller is reachable at `http://localhost:8080` from the host.
- The frontend is deployed separately and talks to the backend through `CONTROLLER_URL`.

## Local Validation Setup

### 1. Start the backend/platform side

From the current monorepo root:

```bash
docker compose -f docker-compose.platform.yml up -d --build
```

This starts:

- MySQL
- controller
- target load balancer
- dummy targets
- workers

### 2. Start the frontend separately

From the `frontend/` directory:

```bash
docker compose -f docker-compose.frontend.yml up -d --build
```

This starts the frontend on:

- `http://localhost:3001`

The frontend container points to the backend through:

- `CONTROLLER_URL=http://host.docker.internal:8080`

## Validation Scenarios

Validate these against the separately started frontend/backend pair:

1. Open `http://localhost:3001/login`
2. Log in successfully
3. Open the results page
4. Open templates
5. Open schedules
6. Start a builder-based test
7. Re-run an existing result
8. Run from a template
9. Open admin worker dashboards

## Automated Smoke Validation

From the `frontend/` directory you can run a lightweight split smoke check:

```bash
pnpm validate:separate-deployment
```

Defaults:

- frontend: `http://localhost:3001`
- controller: `http://localhost:8080`
- username: `admin`
- password: `changeme`

Override them when needed:

```bash
set SPLIT_FRONTEND_URL=http://localhost:3001
set SPLIT_CONTROLLER_URL=http://localhost:8080
set SPLIT_ADMIN_USERNAME=admin
set SPLIT_ADMIN_PASSWORD=changeme
pnpm validate:separate-deployment
```

The smoke check validates:

1. direct controller health
2. frontend login page reachability
3. login through the frontend proxy
4. profile summary through the frontend proxy
5. result list through the frontend proxy
6. template list through the frontend proxy
7. schedule list through the frontend proxy
8. admin system-template export through the frontend proxy
9. admin worker-dashboard listing through the frontend proxy

## Automated Write-Flow Validation

From the `frontend/` directory you can also run the write-heavy split validation:

```bash
pnpm validate:separate-deployment:writes
```

This validator logs in through the frontend proxy and exercises the flows that are most likely to break after a repo or deployment split:

1. builder-based run creation
2. result re-run via cloned result data
3. template creation from a saved result
4. template-based run via cloned template data
5. schedule create
6. schedule update
7. schedule run-now plus execution-history verification
8. template and schedule cleanup after the check

Defaults:

- frontend: `http://localhost:3001`
- controller: `http://localhost:8080`
- username: `admin`
- password: `changeme`
- timezone: `Europe/Berlin`

Important runtime note:

- this check intentionally starts real distributed runs
- if `K6_COMPLETION_BUFFER_SEC` is still high on the backend, the full validation can take a few minutes
- wait until the controller is idle before starting a second validation pass

## Optional Playwright Targeting

To point Playwright at the separately deployed frontend:

```bash
set PLAYWRIGHT_BASE_URL=http://localhost:3001
pnpm test:e2e
```

## Teardown

Frontend:

```bash
docker compose -f docker-compose.frontend.yml down
```

Backend/platform:

```bash
docker compose -f docker-compose.platform.yml down
```
