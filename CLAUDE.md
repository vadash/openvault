# OpenVault - SillyTavern Extension

## WHAT & WHY
Agentic memory extension for SillyTavern providing POV-aware memory, witness tracking, relationships, and emotional continuity.
- **Zero External DBs**: All state lives strictly in `context.chatMetadata.openvault`.
- **Local RAG**: Transformers.js (WebGPU/WASM) or Ollama.
- **LLM Agnostic**: Optimized for structured output (Zod schemas). Configurable preamble language (CN/EN) and assistant prefill presets.

## CRITICAL RULES (HOW)
- **ESM & No Bundler**: Runs directly in-browser. NO bare specifiers (`import { z } from 'zod'`).
- **CDN Imports Only**: All CDN imports go through `cdnImport()` (`src/utils/cdn.js`). Versions are pinned centrally in the `CDN_VERSIONS` map — when updating a package, update both `package.json` AND `CDN_VERSIONS`. Do NOT add new dependencies without permission.
- **Test Aliasing**: If adding a CDN dependency, you MUST `npm install` it and map the URL to `node_modules/` in `vitest.config.js`.
- **SillyTavern Globals**: NEVER access ST globals (`getContext`, `eventSource`) directly. Always use `getDeps()` from `src/deps.js`.
- **Settings Access**: Use centralized API from `src/settings.js`:
  - `getSettings(path?, defaultValue?)` - Get entire settings object or nested value via dot notation
  - `setSetting(path, value)` - Set nested value, auto-saves via debounced save
  - `hasSettings(path)` - Check if path exists
  - NEVER use `settings.xxx ?? <hardcoded>`. All defaults live in `defaultSettings` (src/constants.js).
- **LLM Prompt Format**: ALL prompt builders MUST return `buildMessages(systemPrompt, userPrompt, prefill, preamble)` from `src/prompts/shared/formatters.js`. System prompt MUST be assembled via `assembleSystemPrompt({ role, examples, outputLanguage })` — containing ONLY role + examples (schema/rules moved to user prompt to defeat recency bias). User prompt MUST end with `assembleUserConstraints({ schema, rules, languageInstruction })` for the constraint block (language_rules → task_rules → output_schema → EXECUTION_TRIGGER). Every LLM call config MUST use an `LLM_CONFIGS.*` entry from `src/llm.js` — NEVER inline `{ maxTokens, ... }` objects. `prefill` is optional — when empty or "none" preset, no assistant message is added. Callers resolve via `resolveExtractionPrefill(settings)` (defaults to `pure_think`). This ensures uniform preamble injection, assistant prefill, language rules, and structured output support across all call sites.
- **Anti-Test Creep**: Strictly enforce the Test Pyramid (`tests/CLAUDE.md`). Keep orchestrator integration tests thin (3-5 tests max). Test all edge cases, JSON parsing, and math exclusively in pure-function unit tests. Use `it.each` for permutations.
- **Pre-commit**: Biome lints/formats automatically. DO NOT format manually. `npm run test` uses Vitest + JSDOM.
- **Typecheck**: Run `npm run typecheck` (which regenerates types + runs `tsc --noEmit`). NEVER edit `src/types.d.ts` directly — it is auto-generated from Zod schemas in `src/store/schemas.js`. Edit the schema source and regenerate.
- **Plans Archive**: `docs/plans/` contains execution plans. Move to `docs/designs/` after completion.
- **Type Generation**: Types are generated from Zod schemas via `npm run generate-types`. Run before committing type changes.
- **No Magic Strings or Orphaned Constants**: All string literals used as identifiers (entity types, embedding sources, API endpoints) and numeric thresholds used as defaults MUST be defined in `src/constants.js` and imported at use sites. Exception: JSDoc type annotations are documentation, not runtime values. Frozen objects (`Object.freeze({...})`) for enumerated sets (e.g., `ENTITY_TYPES`, `EMBEDDING_SOURCES`, `ST_API_ENDPOINTS`).
- **Import Pattern**: Use `import('../types.d.ts').TypeName` for type imports, not `types.js`.

### Type Safety (JSDoc + @ts-check)
- **Zero-Transpile Types**: Add `// @ts-check` to enable TypeScript checking without a build step. JSDoc comments provide IntelliSense.
- **Centralized Types**: All typedefs live in `src/types.js`. Import via `/** @typedef {import('../types.js').Memory} Memory */`.
- **Where to Stop**: Type the domain layer (`src/extraction/`, `src/retrieval/`, `src/graph/`, `src/store/`). Do NOT type `src/ui/*.js` — jQuery/DOM manipulations are too painful via JSDoc.
- **Generic Syntax**: JSDoc supports `/** @param {<T>(x: T) => T} fn */` for generic function types.

## GOTCHAS & DEBUG SAUCE
- **Empty Array Fallback**: `[] || fallback` never falls back — empty arrays are truthy. Use `array?.length > 0 ? array : fallback` when checking for populated arrays. Critical when processing LLM responses that may return empty arrays as valid schema outputs.
- **Bucket Utilities**: `assignMemoriesToBuckets()` and `getMemoryPosition()` moved from `formatting.js` to `utils/text.js` to avoid circular deps with `scoring.js`.
- **`thinking`/`/thinking` Tags**: LLMs often return reasoning or tool wrappers before JSON. ALWAYS pass output through `stripThinkingTags()` (`src/utils/text.js`) before parsing. Handles paired tags (with attributes), bracket variants, and orphaned closing tags (from prefill continuations). Preambles contain explicit anti-tool-call directives; `extractJsonBlocks` returns the LAST substantial block (>= 50 chars) as safety net (LLMs output noise before payload). Few-shot examples use `thinking` property (wrapped in `<thinking>` tags by `format-examples.js`) — schemas permit optional `<thinking>` tags for backward compatibility.
- **JSON Parsing Result Object**: `safeParseJSON()` returns `{ success, data?, error?, errorContext? }` (Zod-style). Always check `result.success` before accessing `result.data`. Domain-specific unwrapping (e.g., bare arrays → events wrapper) happens in `structured.js` parsers, NOT in the utility.
- **Payload Calculator**: `PAYLOAD_CALC` in `src/constants.js` is the single source of truth for LLM context overhead (12k tokens). Don't hardcode it elsewhere.
- **Thread Yielding**: Use `yieldToMain()` (`src/utils/st-helpers.js`). It polyfills `scheduler.yield()` with `setTimeout(0)` fallback.
- **State Locks**: `operationState.extractionInProgress` (`src/state.js`) is for MANUAL backfill and Emergency Cut. Background worker uses `isWorkerRunning()` (`src/state.js`). They mutually exclude.
- **ST Event Timing**: `GENERATION_AFTER_COMMANDS` fires BEFORE `chat.push()` and BEFORE textarea is cleared. Pending user message must be read from `$('#send_textarea').val()`, NOT from `context.chat` (which only has the previous message). See `events.js:onBeforeGeneration()`.
- **ST Vector Storage**: Set `embeddingSource: 'st_vector'` to use SillyTavern's built-in Vectra DB. No local embeddings stored — ST handles vector generation. Items marked with `_st_synced` flag.
- **Proxy Vector Scores**: When using `st_vector`, retrieval uses rank-position proxy scores (not cosine similarity). Higher rank = higher proxy score.
- **ST API CSRF**: All `fetch()` calls to ST endpoints (`/api/vector/*`) MUST use `getDeps().getRequestHeaders()` — never manual headers. ST requires `X-CSRF-Token` header on POST requests.
- **Session Kill-Switch**: Use `isSessionDisabled()`/`setSessionDisabled()` in `state.js` for per-session failure states. NEVER mutate global settings to disable — affects all chats.
- **Data Schema Completeness**: When adding fields to OpenVault data, update BOTH: (1) `getOpenVaultData()` in `store/chat-data.js` for new chats, (2) the migration backfill function (e.g., `initGraphState()` in `migrations/v2.js`) for existing chats, (3) tests in `tests/store/chat-data.test.js` and `tests/store/migrations.test.js`. Domain code assumes schema shape — no defensive `if (!data.field)` checks.
- **Install Requires `--legacy-peer-deps`**: `zod-to-ts@2.0.0` has a stale `peerDependencies: typescript@^5.0.0` but we use TS 6. Run `npm install --legacy-peer-deps`. Do NOT downgrade TypeScript.

## ARCHITECTURE MAP (Lazy Loaded Context)
- `src/deps.js` - Dependency injection for testability (SillyTavern globals, browser APIs)
- `src/state.js` - Operation state machine, generation locks, chat loading cooldown, worker singleton
- `src/store/chat-data.js` - Repository for local chat metadata mutations (CRUD, batch operations, temporal field updates)
- `src/store/migrations/CLAUDE.md` - Schema versioning, migration patterns, rollback strategy.
- `src/services/st-vector.js` - Network I/O boundary for ST Vector REST API (sync, delete, purge, query)
- `src/embeddings/migration.js` - Embedding model mismatch detection, stale embedding cleanup, ST fingerprinting
- `src/embeddings.js` - Embedding strategies: Transformers.js (local), Ollama (remote), ST Vector Storage (external)
- `include/DATA_SCHEMA.md` - Data schema, retrieval math, semantic merge, GraphRAG, embedding protection.
- `src/extraction/CLAUDE.md` - 2-phase async worker, 6-stage pipeline, callback injection, Zod schemas.
- `src/prompts/CLAUDE.md` - Domain prompt structure, `thinking` tag convention, few-shot examples.
- `src/retrieval/CLAUDE.md` - Alpha-Blend scoring, Forgetfulness curve, Transient decay.
- `src/graph/CLAUDE.md` - Flat JSON graph, Semantic Merge, GraphRAG Louvain communities.
- `src/reflection/CLAUDE.md` - Per-character insight pipeline, 3-tier replacement.
- `src/perf/CLAUDE.md` - Performance monitoring store, 12 metrics (2 sync, 10 async).
- `src/ui/CLAUDE.md` - jQuery UI patterns, Settings bindings, 5th Perf tab.
- `src/utils/CLAUDE.md` - Shared utils (stemmer, stopwords).
- `tests/CLAUDE.md` - Vitest mocking constraints via `deps.js`, `tests/perf/` suite.

### Type System
- `src/constants.js` - All constants: default settings, metadata keys, frozen enums (`ENTITY_TYPES`, `EMBEDDING_SOURCES`, `ST_API_ENDPOINTS`), internal thresholds, performance metrics, BM25 parameters
- `src/store/schemas.js` - Zod schemas (single source of truth)
- `src/types.d.ts` - Auto-generated TypeScript declarations (run `npm run generate-types`)

## ARCHITECTURAL PATTERNS
- **Settings Injection**: Domain functions receive settings via extended context objects (`queryConfig`, `scoringConfig`) instead of calling `getDeps().getExtensionSettings()` directly. Enables pure unit tests.
- **Callback Injection**: UI provides callbacks (`onStart`, `onProgress`, `onComplete`, `onError`) to domain functions. Domain becomes testable without DOM mocking. UI becomes thin wiring layer.
- **Repository Pattern**: Data mutations go through explicit methods (`addMemories`, `markMessagesProcessed`, `incrementGraphMessageCount`) in `store/chat-data.js`, not direct array pushes.
