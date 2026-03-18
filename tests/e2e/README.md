Playwright end-to-end tests live here.

- `*.spec.js`: curated end-to-end scenarios
- `support/`: shared helpers
- `generated/`: temporary codegen output that should be cleaned up into curated specs

Run them from the frontend package root:

- `pnpm test:e2e`
- `pnpm test:e2e:headed`
- `pnpm test:e2e:ui`
