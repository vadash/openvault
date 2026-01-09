# Extraction Pipeline Refactor Design

**Date:** 2025-01-09
**Status:** Design Approved
**Author:** Claude + User

## Problem Statement

The `extractMemories` function in `src/extraction/extract.js` is a "God Function" handling too many responsibilities:
- Configuration reading
- Chat slicing (message selection)
- Prompt building
- LLM calling
- JSON parsing
- Embedding generation
- Deduplication
- State updating (characters, relationships)
- Persistence

This makes the code hard to understand, modify, and test.

## Solution Overview

Decompose `extractMemories` into an `ExtractionPipeline` class with discrete stages. Each stage has a single responsibility and can be tested independently.

## Architecture

### File Structure

```
src/extraction/
├── extract.js              # Thin wrapper, exports extractMemories()
├── pipeline.js             # NEW: ExtractionPipeline class
├── stages/
│   ├── message-selector.js      # Stage 1: selectMessagesToExtract
│   ├── prompt-builder.js        # Stage 2: buildExtractionPrompt
│   ├── llm-executor.js          # Stage 3: callLLMAndParse
│   ├── event-processor.js       # Stage 4: enrichAndDedupEvents
│   └── result-committer.js      # Stage 5: commitResults
├── parser.js               # Existing (unchanged)
└── context-builder.js      # Existing (unchanged)
```

### ExtractionPipeline Class

```javascript
class ExtractionPipeline {
  constructor(settings) { ... }

  async run(messageIds = null, targetChatId = null) {
    // Stage 1
    const { messages, batchId } = await this._selectMessages(messageIds);

    // Stage 2
    const prompt = await this._buildPrompt(messages);

    // Stage 3
    const events = await this._executeLLM(prompt, messages, batchId);

    // Stage 4
    const finalEvents = await this._processEvents(events);

    // Stage 5
    await this._commitResults(finalEvents, messages, batchId);

    return { status: 'success', events_created: finalEvents.length, ... };
  }
}
```

## Pipeline Stages

### Stage 1: Message Selection (`message-selector.js`)

```javascript
function selectMessagesToExtract(chat, data, settings, messageIds = null)
// Returns: { messages: Message[], batchId: string } | { status: 'skipped', reason }
```

- Handles incremental (last N unprocessed) and targeted (specific IDs) extraction
- Generates unique `batchId`
- Returns early for edge cases (no messages, no new messages)

### Stage 2: Prompt Building (`prompt-builder.js`)

```javascript
function buildExtractionPrompt(messages, context, existingMemories)
// Returns: string (the prompt)
```

- Formats messages into text
- Calls `selectMemoriesForExtraction()` and `buildExtractionPrompt()`
- Pure function, easy to test

### Stage 3: LLM Execution (`llm-executor.js`)

```javascript
async function callLLMAndParse(prompt, messages, characterName, userName, batchId)
// Returns: Event[] (parsed events)
```

- Calls `callLLMForExtraction()`
- Calls `parseExtractionResult()` to get structured events
- Adds processed message IDs to data (for backfill tracking)

### Stage 4: Event Processing (`event-processor.js`)

```javascript
async function enrichAndDedupEvents(events, existingMemories, settings)
// Returns: Event[] (enriched + deduplicated)
```

- Calls `enrichEventsWithEmbeddings()`
- Runs `filterSimilarEvents()` for deduplication
- Returns final list ready for storage

### Stage 5: Result Committing (`result-committer.js`)

```javascript
async function commitResults(events, messages, data, maxMessageId, targetChatId)
// Returns: { success: boolean, eventsCreated: number }
```

- Updates `data[MEMORIES_KEY]`
- Calls `updateCharacterStatesFromEvents()`, `updateRelationshipsFromEvents()`
- Applies relationship decay
- Calls `saveOpenVaultData()`

## Error Handling

- Errors bubble up from each stage (no catching at stage level)
- Caller (`extractMemories`) handles errors and displays toasts
- Current behavior preserved for backward compatibility

## Dependencies

- Each stage imports what it needs directly (no DI framework)
- `ExtractionPipeline` receives settings in constructor
- Context (`getDeps().getContext()`) fetched per run

## Testing Strategy

### Unit Tests

| Stage | Test Focus |
|-------|-----------|
| `message-selector` | Edge cases: empty chat, all processed, backfill mode |
| `prompt-builder` | Prompt structure, token budget adherence |
| `llm-executor` | JSON parse error handling, event metadata |
| `event-processor` | Dedup logic, embedding generation |
| `result-committer` | State mutations, relationship updates |

### Integration Tests

- Full pipeline happy path
- Chat ID mismatch during save
- LLM returns invalid JSON
- Dedup removes all events

## Migration Notes

1. Existing `extractMemories` function signature unchanged
2. All existing imports continue to work
3. Tests should pass without modification (behavior preserved)
