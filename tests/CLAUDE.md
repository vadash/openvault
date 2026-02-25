# Testing Subsystem (Vitest)

## WHAT
This directory contains all unit tests for the OpenVault extension using Vitest and JSDOM.

## HOW
- **Run tests**: `npm run test`
- **Mocks**: We use `src/deps.js` to inject SillyTavern globals (`getContext`, `eventSource`, etc.). 
- **Stubs**: ST dependencies are stubbed in `/tests/stubs/`. Do not try to import actual ST files that are outside the project folder.

## RULES & GOTCHAS
- **Dependency Injection**: Before each test, mock ST globals using `setDeps({...})`. After each test, ALWAYS call `resetDeps()`.
- **Testing Pure Functions**: Files like `src/ui/helpers.js` and `src/retrieval/math.js` contain pure functions. Test them by passing arguments directly, do not try to mock the DOM for these.
- **ESM URLs in Tests**: Production code uses CDN URLs (like `https://esm.sh/zod@4`). Vitest cannot resolve these natively. They are intercepted and mapped to local `node_modules` via `resolve.alias` in `vitest.config.js`. **Do not change the import paths in the tests to bypass this.**