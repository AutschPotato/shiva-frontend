Codegen output belongs in this directory.

Recommended workflow:

1. Run `pnpm codegen:e2e`
2. Capture the scenario into `codegen.spec.js`
3. Move the useful parts into a real spec under `tests/e2e`
4. Keep this folder as a scratch area, not as the long-term home for curated tests
