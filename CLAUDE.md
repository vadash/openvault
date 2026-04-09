# OpenVault

Agentic memory extension for SillyTavern providing POV-aware memory, witness tracking, relationships, and emotional continuity. 
**Core Philosophy:** Zero external DBs (all state lives in `context.chatMetadata.openvault`), local RAG first, and LLM-agnostic structured outputs

## GLOBAL ARCHITECTURE RULES

### 1. Imports & Dependencies
- **Write ESM code without bundlers.** Runs directly in-browser. Never use bare specifiers (`import { z } from 'zod'`)
- **Import CDN packages exclusively via `cdnImport()`.** (`src/utils/cdn.js`)
- **Pin all CDN versions centrally.** Maintain the `CDN_VERSIONS` map in `src/utils/cdn.js`. Update both `package.json` and `CDN_VERSIONS` simultaneously
- **Alias CDN URLs for testing.** Map all CDN dependencies to `node_modules/` in `vitest.config.js`

### 2. Environment Boundaries
- **Access SillyTavern globals exclusively via `getDeps()`.** (`src/deps.js`). Never access `getContext`, `eventSource`, or `fetch` directly
- **Access settings exclusively via `src/settings.js`.** Use `getSettings(path, default)` and `setSetting(path, val)`. Never hardcode fallbacks; pull from `defaultSettings` in `src/constants.js`
- **Define all magic strings and thresholds centrally.** Place enums (e.g., `ENTITY_TYPES`), thresholds, and API endpoints in `src/constants.js` and freeze them (`Object.freeze({...})`)

### 3. Code & State Safety
- **Validate arrays explicitly.** Use `array?.length > 0 ? array : fallback`. Empty arrays are truthy and will bypass `||` fallbacks
- **Throw `AbortError` to signal cancellation.** Catch it explicitly and do not log it as a failure
- **Reset session controller before checking extension enabled.** In `onChatChanged`, `resetSessionController()` must fire before `isExtensionEnabled()` — otherwise disabling the extension leaks in-flight workers across chat switches.
- **Yield the main thread in heavy loops.** Call `await yieldToMain()` to polyfill `scheduler.yield()` and prevent ST UI freezes
- **Never edit `src/types.d.ts` directly.** Regenerate it from Zod schemas using `npm run generate-types`
- **Never use `z.any()` in Zod schemas.** Use `z.unknown()`, typed alternatives, or JSDoc `@typedef` for complex/interface types that Zod can't model (e.g., function signatures, class instances). `z.any()` leaks into generated `types.d.ts` as `any`

### 4. Pre-Commit
- **`npm run check` runs automatically on every commit** (sync-version, generate-types, lint, jsdoc, css, typecheck). The commit is aborted on any failure — fix errors, never skip them

## DIRECTORY KNOWLEDGE MAP
Domain-specific rules live in subdirectory CLAUDE.md files (auto-discovered by Claude):
- `src/store/` — State management, stChanges contract, migrations
- `src/store/migrations/` — Schema versioning, rollback patterns
- `src/extraction/` — Background worker, turn boundaries, swipe protection, backfill
- `src/graph/` — Semantic merge, edge consolidation, Louvain communities
- `src/reflection/` — Reflection pipeline, accumulator, 3-tier dedup
- `src/retrieval/` — Context budgeting, world context intent routing, query building
- `src/services/` — ST Vector REST API, CSRF, collection isolation
- `src/prompts/` — Prompt topology, `<think/>` tags, bilingual schemas
- `src/ui/` — Progressive disclosure, DOM patterns, payload calculator
- `src/perf/` — Metrics store, sync vs async instrumentation
- `src/utils/` — Codecs, logging, stemmers, AIMD queue
- `tests/` — Test pyramid, mocking boundaries, factories
- `include/DATA_SCHEMA.md` — Data schema & retrieval formulas (authoritative)
