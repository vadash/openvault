# Memory Extraction Subsystem

## WHAT
This subsystem converts raw SillyTavern chat messages into structured JSON events using an LLM, deduplicates them, and embeds them.

## HOW: The 5-Stage Pipeline (`extract.js`)
1. **Message Selection**: `scheduler.js` determines unextracted batches.
2. **Prompting**: `prompts.js` builds strict Zod-compatible system prompts.
3. **LLM Execution**: `llm.js` fetches the response.
4. **Processing**: `structured.js` strips markdown/thinking tags and validates via Zod.
5. **Commit**: Deduplicate against existing memories (Cosine Similarity >= 0.85) and save to `chatMetadata`.

## GOTCHAS & RULES
- **Zod Schemas**: We use Zod (`ExtractionResponseSchema`) to define the shape, then convert it to JSON Schema Draft-04 for ST's ConnectionManager.
- **Deduplication**: Never insert an event if a highly similar one exists. `filterSimilarEvents` handles this.
- **Character States**: When extracting an event, update the `CHARACTERS_KEY` state (current emotion, known events) in `updateCharacterStatesFromEvents()`.
- **Testing**: Test parsers heavily. See `tests/extraction/structured.test.js`.