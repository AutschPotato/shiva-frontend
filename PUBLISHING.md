# Publishing Shiva Frontend

This file is intended to live in the root of the extracted `shiva-frontend` repository.

## Before First Push

1. Review `.env.example`
2. Confirm `CONTROLLER_URL` and `CONTROLLER_API_KEY` for the target deployment
3. Run:

```bash
pnpm install
pnpm build
pnpm test:e2e --list
```

Optional stronger check against a separately running backend:

```bash
pnpm validate:separate-deployment
pnpm validate:separate-deployment:writes
```

## Suggested Git Bootstrap

```bash
git init -b main
git add .
git commit -m "Initial frontend split"
git remote add origin <your-frontend-remote>
git push -u origin main
```

## After First Push

1. Configure repository secrets and variables
2. Enable the frontend CI workflow
3. Wire the deployment target for the frontend app
4. Re-run the split validation against the deployed backend

## Ownership Reminder

This repository should own:

- Next.js app code
- frontend docs
- frontend CI/CD
- Playwright tests and codegen
- the Next proxy/BFF layer
