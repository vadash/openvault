# OpenVault - SillyTavern Extension

## WHAT & WHY
Agentic memory extension for SillyTavern providing POV-aware memory, witness tracking, relationships, and emotional continuity. 
- **Zero External DBs**: All state lives strictly in `context.chatMetadata.openvault`.
- **Local RAG**: Transformers.js (WebGPU/WASM) or Ollama.
- **LLM Agnostic**: Optimized for structured output (Zod schemas). Configurable preamble language (CN/EN) and assistant prefill presets.

## CRITICAL RULES (HOW)
- **ESM & No Bundler**: Runs directly in-browser. NO bare specifiers (`import { z } from 'zod'`).
- **CDN Imports Only**: Use `https://esm.sh/...`. Never pin versions (`@version`). Do NOT add new dependencies without permission.
- **Test Aliasing**: If adding a CDN dependency, you MUST `npm install` it and map the URL to `node_modules/` in `vitest.config.js`.
- **SillyTavern Globals**: NEVER access ST globals (`getContext`, `eventSource`) directly. Always use `getDeps()` from `src/deps.js`.
- **Settings Access**: NEVER use `settings.xxx ?? <hardcoded>` or `settings.xxx || <hardcoded>`. All defaults live in `defaultSettings` (src/constants.js). `loadSettings()` guarantees every key is populated.
- **LLM Prompt Format**: ALL prompt builders MUST return `buildMessages(systemPrompt, userPrompt, prefill, preamble)` from `src/prompts/formatters.js`. System prompt MUST be assembled via `assembleSystemPrompt({ role, schema, rules, examples, outputLanguage })`. Every LLM call config MUST use an `LLM_CONFIGS.*` entry from `src/llm.js` — NEVER inline `{ maxTokens, ... }` objects. This ensures uniform preamble injection, assistant prefill, language rules, and structured output support across all call sites.
- **Pre-commit**: Biome lints/formats automatically. DO NOT format manually. `npm run test` uses Vitest + JSDOM.
- **Plans Archive**: `docs/plans/` contains execution plans. Move to `docs/designs/` after completion.

## GOTCHAS & DEBUG SAUCE
- **Bucket Utilities**: `assignMemoriesToBuckets()` and `getMemoryPosition()` moved from `formatting.js` to `utils/text.js` to avoid circular deps with `scoring.js`.
- **`<think>` Tags**: LLMs often return reasoning before JSON. ALWAYS pass output through `stripThinkingTags()` (`src/utils/text.js`) before parsing. Handles both paired tags and orphaned closing tags (from prefill continuations).
- **Payload Calculator**: `PAYLOAD_CALC` in `src/constants.js` is the single source of truth for LLM context overhead (12k tokens). Don't hardcode it elsewhere.
- **Thread Yielding**: Use `yieldToMain()` (`src/utils/st-helpers.js`). It polyfills `scheduler.yield()` with `setTimeout(0)` fallback.
- **State Locks**: `operationState.extractionInProgress` (`src/state.js`) is for MANUAL backfill only. Background worker uses `isRunning` (`worker.js`). They mutually exclude.
- **ST Event Timing**: `GENERATION_AFTER_COMMANDS` fires BEFORE `chat.push()` and BEFORE textarea is cleared. Pending user message must be read from `$('#send_textarea').val()`, NOT from `context.chat` (which only has the previous message). See `events.js:onBeforeGeneration()`.

## ARCHITECTURE MAP (Lazy Loaded Context)
- `include/ARCHITECTURE.md` - Global pipeline, Data Schema, Retrieval Math.
- `src/extraction/CLAUDE.md` - 2-phase async worker, JSON validation, Zod schemas.
- `src/retrieval/CLAUDE.md` - Alpha-Blend scoring, Forgetfulness curve.
- `src/graph/CLAUDE.md` - Flat JSON graph, Semantic Merge, GraphRAG Louvain communities.
- `src/reflection/CLAUDE.md` - Per-character insight pipeline, 3-tier replacement.
- `src/perf/CLAUDE.md` - Performance monitoring store, 12 metrics (2 sync, 10 async).
- `src/ui/CLAUDE.md` - jQuery UI patterns, Settings bindings, 5th Perf tab.
- `src/utils/CLAUDE.md` - Shared utils (stemmer, stopwords).
- `tests/CLAUDE.md` - Vitest mocking constraints via `deps.js`, `tests/perf/` suite.