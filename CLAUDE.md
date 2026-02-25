# OpenVault - SillyTavern Extension

## WHAT: The Project
OpenVault is an agentic memory extension for SillyTavern. It provides POV-aware memory, witness tracking, relationship dynamics, and emotional continuity for roleplay conversations. It stores all data strictly within SillyTavern's `chatMetadata`.

## WHY: The Architecture
- **No external DBs**: All state is saved to `context.chatMetadata.openvault`.
- **Testability**: SillyTavern globals (`getContext`, `eventSource`, etc.) are injected via `src/deps.js`. **Never access ST globals directly; always use `getDeps()`.**
- **LLM Agnostic**: Optimized for structured output (Zod schemas) using medium-strength models.
- **Local RAG**: Uses Transformers.js (WebGPU/WASM) or Ollama for embeddings.

## DEPENDENCIES & IMPORTS (ESM)
**CRITICAL RULE:** This extension runs directly in the browser *without a bundler* (no Webpack/Vite for production). 
- **No bare specifiers**: You CANNOT use `import { z } from 'zod'` in `src/`. The browser will crash.
- **CDN Imports**: External libraries MUST be imported via CDN URLs (e.g., `import { z } from 'https://esm.sh/zod@4';`).
- **No new dependencies**: Do NOT add new `https://esm.sh/...` imports to the app unless explicitly instructed by the user. Keep dependencies to an absolute minimum.
- **Test Aliasing**: If instructed to add a new CDN dependency, you MUST also `npm install` the package and add an alias in `vitest.config.js` mapping the `https://...` URL to the local `node_modules/` path, or the test suite will break.

## HOW: Commands & Tools
- **Testing**: `npm run test` (Vitest with JSDOM). Tests use stubbed ST dependencies.
- **Linting/Formatting**: `npm run lint` and `npm run format`. We use Biome. **Do not format code manually**, rely on the linter.
- **Sync Version**: `npm run sync-version` (syncs package.json to manifest.json).

## MAP: Progressive Disclosure
Detailed instructions are lazily loaded when you visit these directories:
- `/src/extraction/CLAUDE.md` - How the LLM extracts JSON memories from chat.
- `/src/retrieval/CLAUDE.md` - How the Alpha-Blend (BM25 + Vector) scoring works.
- `/src/ui/CLAUDE.md` - UI rendering, jQuery conventions, and template logic.
- `/tests/CLAUDE.md` - Vitest conventions, stubs, and mock injection.

## GOTCHAS
- **Always strip `<think>` tags**: Models often return reasoning tags before JSON. Use `stripThinkingTags()` from `src/utils.js` before parsing any LLM output.
- **State Locks**: Because ST is event-driven, use `src/state.js` (`operationState`) to prevent concurrent extractions/retrievals.