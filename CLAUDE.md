# OpenVault - SillyTavern Extension

## WHAT & WHY
Agentic memory extension for SillyTavern providing POV-aware memory, witness tracking, relationships, and emotional continuity. 
- **Zero External DBs**: All state lives strictly in `context.chatMetadata.openvault`.
- **Local RAG**: Transformers.js (WebGPU/WASM) or Ollama.
- **LLM Agnostic**: Optimized for structured output (Zod schemas) using `<think>` tags.

## CRITICAL RULES (HOW)
- **ESM & No Bundler**: Runs directly in-browser. NO bare specifiers (`import { z } from 'zod'`).
- **CDN Imports Only**: Use `https://esm.sh/...`. Never pin versions (`@version`). Do NOT add new dependencies without permission.
- **Test Aliasing**: If adding a CDN dependency, you MUST `npm install` it and map the URL to `node_modules/` in `vitest.config.js`.
- **SillyTavern Globals**: NEVER access ST globals (`getContext`, `eventSource`) directly. Always use `getDeps()` from `src/deps.js`.
- **Settings Access**: NEVER use `settings.xxx ?? <hardcoded>` or `settings.xxx || <hardcoded>`. All defaults live in `defaultSettings` (src/constants.js). `loadSettings()` guarantees every key is populated.
- **Pre-commit**: Biome lints/formats automatically. DO NOT format manually. `npm run test` uses Vitest + JSDOM.

## GOTCHAS & DEBUG SAUCE
- **`<think>` Tags**: LLMs often return reasoning before JSON. ALWAYS pass output through `stripThinkingTags()` (`src/utils.js`) before parsing.
- **Payload Calculator**: `PAYLOAD_CALC` in `src/constants.js` is the single source of truth for LLM context overhead (12k tokens). Don't hardcode it elsewhere.
- **Thread Yielding**: Use `yieldToMain()` (`src/utils/st-helpers.js`). It polyfills `scheduler.yield()` with `setTimeout(0)` fallback.
- **State Locks**: `operationState.extractionInProgress` (`src/state.js`) is for MANUAL backfill only. Background worker uses `isRunning` (`worker.js`). They mutually exclude.

## ARCHITECTURE MAP (Lazy Loaded Context)
- `include/ARCHITECTURE.md` - Global pipeline, Data Schema, Retrieval Math.
- `src/extraction/CLAUDE.md` - 2-phase async worker, JSON validation, Zod schemas.
- `src/retrieval/CLAUDE.md` - Alpha-Blend scoring, Forgetfulness curve.
- `src/graph/CLAUDE.md` - Flat JSON graph, Semantic Merge, GraphRAG Louvain communities.
- `src/reflection/CLAUDE.md` - Per-character insight pipeline, 3-tier replacement.
- `src/ui/CLAUDE.md` - jQuery UI patterns, Settings bindings.
- `src/utils/CLAUDE.md` - Shared utils (stemmer, stopwords).
- `tests/CLAUDE.md` - Vitest mocking constraints via `deps.js`.