# Memory Retrieval & Scoring Subsystem

> For the big picture of how this fits into the whole app, see `docs/ARCHITECTURE.md`.

## WHAT
Finds relevant memories (events + reflections) and community summaries. Formats for prompt injection via named slots: `openvault_memory` and `openvault_world`.

## HOW: The Math (`math.js` & `scoring.js`)
Hybrid **Alpha-Blend** scoring:
1. **Forgetfulness Curve**: Exponential decay by message distance. Importance 5 = soft floor (1.0, not hard 5.0).
2. **BM25**: IDF-aware term frequency via `query-context.js`.
   - **IDF-Aware Query Adjustment**: Query tokens weighted by inverse document frequency BEFORE scoring. Prevents common named entities (e.g., main character's name) from artificially inflating scores when repeated.
3. **Vector**: Cosine similarity via WebGPU/Ollama.
4. **Reflection Decay**: Reflections older than 500 messages get linear decay (floor 0.25×).
- **Formula**: `Total = Base + (Alpha * Vector) + ((1 - Alpha) * BM25)`

## HOW: Candidate Selection (`retrieve.js`)
- **Hidden Memories**: Extracted from system messages only (visible messages already in context).
- **Reflections**: Included alongside hidden memories (reflections have no `message_ids`).
- **POV Filter**: Applied to combined candidate set via `filterMemoriesByPOV()`.

## HOW: World Context (`world-context.js`)
- **Source**: GraphRAG community summaries from `src/graph/communities.js`.
- **Retrieval**: Pure Vector similarity (cosine) ONLY — bypasses BM25 entirely. Token budget from `settings.worldContextBudget` (default 2000).
- **Format**: `<world_context>` XML tag with title/summary/findings.
- **Injection**: Named slot `openvault_world` (higher in prompt than memories).

## GOTCHAS & RULES
- **Pure Functions**: `math.js` ONLY. No `deps.js`, no DOM. Worker-safe.
- **Named Slots**: Use `safeSetExtensionPrompt(content, name)` — `openvault_memory` or `openvault_world`.
- **Formatting Buckets**: `formatting.js` divides into `Old`, `Mid`, `Recent` buckets. Old bucket capped at 50% of memory budget to prevent creep.
- **POV Filtering**: Filter through `src/pov.js` before scoring. Only inject witnessed/known memories.