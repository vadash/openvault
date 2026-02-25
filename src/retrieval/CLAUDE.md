# Memory Retrieval & Scoring Subsystem

## WHAT
This subsystem finds the most relevant memories for the current chat context and formats them for prompt injection.

## HOW: The Math (`math.js` & `scoring.js`)
We use a hybrid **Alpha-Blend** scoring system:
1. **Forgetfulness Curve**: Base score decays exponentially based on message distance. Importance 5 memories have a minimum score floor.
2. **BM25 (Keyword)**: IDF-aware term frequency. Boosts exact entities extracted from the scene via `query-context.js`.
3. **Vector (Semantic)**: Cosine similarity via WebGPU/Ollama.
- **Formula**: `Total = Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus)`

## GOTCHAS & RULES
- **Pure Functions**: `math.js` must contain ONLY pure functions. Do not import `deps.js` or DOM elements here. It must be testable and potentially worker-safe.
- **Formatting Buckets**: `formatting.js` strictly divides memories into `Old`, `Mid`, and `Recent` buckets based on `CURRENT_SCENE_SIZE` and `LEADING_UP_SIZE`.
- **POV Filtering**: Always filter memories through `src/pov.js` before scoring. Only inject memories the active POV character(s) witnessed or know about.