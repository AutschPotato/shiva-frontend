# Frontend Repo Extraction Checklist

This checklist describes the minimum expectations when the current `frontend/` tree is lifted into its own repository.

## Expected Repo Root Contents

- `app/`
- `components/`
- `context/`
- `lib/`
- `public/`
- `types/`
- `tests/e2e/`
- `docs/`
- `artifacts/README.md`
- `package.json`
- `pnpm-lock.yaml`
- `playwright.config.cjs`
- `Dockerfile`
- `.env.example`
- `.gitignore`
- `.github/workflows/frontend-ci.yml`

## Required Commands

The extracted repo should support:

- `pnpm install`
- `pnpm build`
- `pnpm test:e2e --list`

## CI Ownership

The extracted frontend repo should own:

- frontend build automation
- Playwright discovery and E2E automation
- frontend deployment automation

The prepared workflow already lives inside the frontend tree:

- [frontend-ci.yml](/C:/Dev/CLAUDE/PROJECTS/K6-ADOPTION/k6-enterprise-suite-codex/frontend/.github/workflows/frontend-ci.yml)

## Required Runtime Contract

- `CONTROLLER_URL`
- `CONTROLLER_API_KEY`

## Non-Goals

- No direct browser-to-controller rewrite
- No bundling of controller code into the frontend repo
- No dependency on the old monorepo root

## Cutover Support

Phase 6 provides a manifest-driven export path for the actual repo split:

- [frontend_repo_manifest.json](/C:/Dev/CLAUDE/PROJECTS/K6-ADOPTION/k6-enterprise-suite-codex/docs/reference/architecture/frontend_repo_manifest.json)
- [export-split-repo.ps1](/C:/Dev/CLAUDE/PROJECTS/K6-ADOPTION/k6-enterprise-suite-codex/scripts/export-split-repo.ps1)
