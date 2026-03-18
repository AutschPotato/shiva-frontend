# Controller Integration Contract

This document defines what the future `shiva-frontend` repository expects from the backend/platform deployment.

## Deployment Contract

- `CONTROLLER_URL` must point to a reachable controller deployment.
- `CONTROLLER_API_KEY` is optional and, when used, is forwarded by the Next proxy.
- The frontend talks to the controller through `app/api/backend/[...path]/route.ts`.
- Browser code should continue to use `/api/backend/...` rather than calling the controller directly.

## Authentication Contract

- Users authenticate through `POST /api/auth/login`.
- The frontend persists the returned JWT client-side in the session context.
- The Next proxy forwards the JWT to the controller on subsequent requests.
- From the end-user perspective, authentication remains frontend-driven and proxy-mediated.

## Required Controller API Groups

- Auth:
  - `POST /api/auth/login`
  - `POST /api/auth/forgot-password`
  - `POST /api/auth/reset-password`
  - `GET /api/profile`
  - `PUT /api/profile/password`
- Test execution:
  - `POST /api/run`
  - `POST /api/stop`
  - `POST /api/pause`
  - `POST /api/resume`
  - `POST /api/scale`
  - `GET /api/metrics/live`
  - `GET /api/workers/status`
- Results:
  - `GET /api/result/list`
  - `GET /api/result/{id}`
- Templates:
  - `GET /api/templates`
  - `POST /api/templates`
  - `GET /api/templates/{id}`
  - `PUT /api/templates/{id}`
  - `DELETE /api/templates/{id}`
- Schedules:
  - `POST /api/schedules`
  - `GET /api/schedules`
  - `GET /api/schedules/calendar`
  - `POST /api/schedules/check-conflict`
  - `GET /api/schedules/{id}`
  - `PUT /api/schedules/{id}`
  - `DELETE /api/schedules/{id}`
  - `POST /api/schedules/{id}/pause`
  - `POST /api/schedules/{id}/resume`
  - `POST /api/schedules/{id}/run-now`
  - `GET /api/schedules/{id}/executions`
- Admin:
  - `GET /api/auth/users`
  - `POST /api/auth/users`
  - `POST /api/auth/users/{id}/reset-password`
  - `POST /api/resetdata`
  - `GET /api/admin/templates/system/export`
  - `POST /api/admin/templates/system/import`
  - `POST /api/admin/templates/{id}/system`
  - `DELETE /api/admin/templates/{id}/system`
  - `GET /api/admin/templates/{id}/export`
  - `GET /api/admin/workers/dashboards`
  - `GET /api/admin/workers/{worker}/dashboard`
  - `GET /api/admin/workers/{worker}/dashboard/*`

## Dashboard Proxy Expectations

- Worker dashboards remain reachable only through the frontend proxy plus controller admin proxy chain.
- The frontend assumes proxied dashboard HTML, asset, and event-stream requests remain stable under `/api/backend/api/admin/workers/.../dashboard/...`.
- A future backend change must not silently break the dashboard proxy path contract.

## Extraction Readiness

This document is intentionally written so it can move unchanged with the frontend tree into a standalone repository.
