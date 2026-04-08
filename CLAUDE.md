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

### 4. Pre-Commit
- **`npm run check` runs automatically on every commit** (sync-version, generate-types, lint, jsdoc, css, typecheck). The commit is aborted on any failure — fix errors, never skip them

### 5. ST Sync Pipeline Types
- **toDelete items:** Always push `{ hash: number }` objects, never plain strings
- **Hash computation:** Use `cyrb53(text)` (returns number), never `.toString()`
- **Schema contract:** `StSyncChangesSchema` in `schemas.js` validates shapes — keep in sync
- **Every mutation must return complete stChanges.** If a function modifies/deletes entities, memories, or communities, it must return `{ toSync, toDelete }` for both. Missing either causes orphaned embeddings. Check all code paths — early returns are the most common leak source.
- **Use the `syncNode(key)` helper pattern** (from `graph.js`) to avoid duplicating the `[OV_ID:${key}] ${description}` + `cyrb53` boilerplate in every merge path.

## DIRECTORY KNOWLEDGE MAP
To keep context windows clean, domain-specific rules live in their respective directories:
- `src/store/CLAUDE.md` - State management, migrations, flat-file DB rules
- `src/extraction/CLAUDE.md` - Background worker, graph building, reflection, Louvain communities
- `src/retrieval/CLAUDE.md` - Alpha-blend scoring, BM25 math, world context intent routing
- `src/prompts/CLAUDE.md` - Prompt topologies, `<think>` tags, bilingual schemas
- `src/ui/CLAUDE.md` - Progressive disclosure, DOM manipulation, payload calculations
- `src/utils/CLAUDE.md` - Codecs, logging, stemmers, AIMD queues
- `tests/CLAUDE.md` - Test pyramid, mocking boundaries, factories
- `include/DATA_SCHEMA.md` - Data schema
