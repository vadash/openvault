# Design: TypeScript-Style Type Safety Phase 2 - Graph, Store, & Prompt Builders

## Summary
Expand `@ts-check` and JSDoc type coverage to 6 additional files using the same approach as Phase 1. Add centralized typedefs to `types.js` and import them via JSDoc's `import()` syntax.

## Goals
- Catch property-renaming typos and refactoring breaks at edit time
- Provide IntelliSense/autocomplete for graph operations, repository methods, and prompt builders
- Zero runtime impact — pure comments, no transpilation
- Maintain "ESM + No Bundler" architecture

## Files to Add `@ts-check`

1. **`src/graph/graph.js`** (~420 lines) - Graph operations, semantic merge, edge consolidation
2. **`src/store/chat-data.js`** (~150 lines) - Repository CRUD operations
3. **`src/prompts/events/builder.js`** (~50 lines) - Event extraction prompt builder
4. **`src/prompts/graph/builder.js`** (~90 lines) - Graph extraction and edge consolidation builders
5. **`src/prompts/reflection/builder.js`** (~75 lines) - Reflection prompt builder
6. **`src/prompts/communities/builder.js`** (~75 lines) - Community summarization and global synthesis builders

## New Type Definitions (Add to `src/types.js`)

### Graph Types

```javascript
/**
 * Flat graph structure stored in chatMetadata.openvault.graph
 * @typedef {Object} GraphData
 * @property {Object.<string, GraphNode>} nodes - Keyed by normalized entity name
 * @property {Object.<string, GraphEdge>} edges - Keyed by "source__target"
 * @property {Object.<string, string>} [_mergeRedirects] - Maps old keys to merged keys
 * @property {string[]} [_edgesNeedingConsolidation] - Edge keys pending consolidation
 */

/**
 * Graph node (entity) structure
 * @typedef {Object} GraphNode
 * @property {string} name - Display name (original casing preserved)
 * @property {string} type - PERSON | PLACE | ORGANIZATION | OBJECT | CONCEPT
 * @property {string} description - Entity description (pipe-separated segments)
 * @property {number} mentions - How many times this entity was seen
 * @property {number[]} [embedding] - Vector representation (deprecated, use embedding_b64)
 * @property {string} [embedding_b64] - Base64-encoded Float32Array embedding
 * @property {string[]} [aliases] - Alternative names merged into this node
 * @property {boolean} [_st_synced] - ST Vector sync status
 */

/**
 * Graph edge (relationship) structure
 * @typedef {Object} GraphEdge
 * @property {string} source - Source entity key (normalized)
 * @property {string} target - Target entity key (normalized)
 * @property {string} description - Relationship description (pipe-separated segments)
 * @property {number} weight - Strength/occurrence count
 * @property {number} [_descriptionTokens] - Token count for consolidation trigger
 * @property {number[]} [embedding] - Vector representation (deprecated)
 * @property {string} [embedding_b64] - Base64-encoded Float32Array embedding
 * @property {boolean} [_st_synced] - ST Vector sync status
 */
```

### Store Types

```javascript
/**
 * Complete OpenVault data structure from chat metadata
 * @typedef {Object} OpenVaultData
 * @property {number} schema_version - Data schema version (current: 2)
 * @property {Memory[]} [memories] - Stored memory objects
 * @property {Object.<string, CharacterData>} [characters] - Character data keyed by name
 * @property {string[]} [processed_messages] - Message fingerprints already extracted
 * @property {GraphData} [graph] - Entity relationship graph
 * @property {Object.<string, CommunitySummary>} [communities] - Community summaries
 * @property {ReflectionState} [reflection_state] - Reflection tracking
 * @property {number} [graph_message_count] - Messages processed since last community detection
 * @property {GlobalWorldState} [global_world_state] - Macro-level world state synthesis
 */

/**
 * Character tracking data
 * @typedef {Object} CharacterData
 * @property {number} [firstSeen] - First message ID where character appeared
 * @property {number} [lastSeen] - Most recent message ID
 * @property {number} [mentionCount] - How many times character mentioned
 */

/**
 * Reflection state tracking
 * @typedef {Object} ReflectionState
 * @property {number} [lastMessageId] - Last message processed for reflections
 * @property {number} [reflectionCount] - Number of reflections generated
 */

/**
 * Global world state synthesis
 * @typedef {Object} GlobalWorldState
 * @property {string} summary - Global narrative summary
 * @property {number} last_updated - Message ID when last updated
 * @property {number} community_count - Number of communities at time of synthesis
 */

/**
 * Memory update fields for updateMemory()
 * @typedef {Object} MemoryUpdate
 * @property {string} [summary] - New summary text
 * @property {number} [importance] - New importance (1-5)
 * @property {string[]} [tags] - New tags
 * @property {boolean} [is_secret] - Secret flag
 */
```

### Prompt Builder Types

```javascript
/**
 * Character names pair for prompt building
 * @typedef {Object} CharacterNames
 * @property {string} char - Character name
 * @property {string} user - User name
 */

/**
 * Context object for prompt builders
 * @typedef {Object} PromptContext
 * @property {Memory[]} [memories] - Existing memories for context
 * @property {string} [charDesc] - Character description
 * @property {string} [personaDesc] - Persona description
 */

/**
 * Base prompt builder parameters
 * @typedef {Object} BasePromptParams
 * @property {string} messages - Chat message text
 * @property {CharacterNames} names - Character and user names
 * @property {PromptContext} [context] - Additional context
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {string} [outputLanguage] - Output language ('en' | 'ru' | 'auto')
 */

/**
 * Graph extraction prompt parameters
 * @typedef {Object} GraphPromptParams extends BasePromptParams
 * @property {string[]} [extractedEvents] - Previously extracted events for context
 */

/**
 * Edge consolidation prompt parameters
 * @typedef {Object} EdgeConsolidationParams
 * @property {GraphEdge} edgeData - Edge to consolidate
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {string} [outputLanguage] - Output language
 */

/**
 * Reflection prompt parameters
 * @typedef {Object} ReflectionPromptParams
 * @property {string} characterName - Character name to reflect on
 * @property {Memory[]} recentMemories - Recent memories for reflection
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {string} [outputLanguage] - Output language
 */

/**
 * Community summary prompt parameters
 * @typedef {Object} CommunitySummaryParams
 * @property {string[]} nodeLines - Formatted node descriptions
 * @property {string[]} edgeLines - Formatted edge descriptions
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {string} [outputLanguage] - Output language
 */

/**
 * Global synthesis prompt parameters
 * @typedef {Object} GlobalSynthesisParams
 * @property {CommunitySummary[]} communities - Community summaries to synthesize
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {string} [outputLanguage] - Output language
 */

/**
 * Community summary result
 * @typedef {Object} CommunitySummary
 * @property {string} title - Community title
 * @property {string} summary - Community summary
 * @property {string[]} [findings] - Key findings
 */

/**
 * LLM message array (OpenAI format)
 * @typedef {Array<{role: string, content: string}>} LLMMessages
 */
```

### Consolidation Result (Already exists, add if missing)

```javascript
/**
 * Return value from consolidateEdges
 * @typedef {Object} ConsolidateEdgesResult
 * @property {number} count - Number of edges consolidated
 * @property {StSyncChanges} stChanges - ST Vector sync changes
 */

/**
 * Return value from mergeOrInsertEntity
 * @typedef {Object} MergeEntityResult
 * @property {string} key - The node key (may be merged target)
 * @property {StSyncChanges} stChanges - ST Vector sync changes
 */
```

---

## File-by-File Implementation

### 1. `src/graph/graph.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../types.js').GraphData} GraphData */
/** @typedef {import('../types.js').GraphNode} GraphNode */
/** @typedef {import('../types.js').GraphEdge} GraphEdge */
/** @typedef {import('../types.js').Entity} Entity */
/** @typedef {import('../types.js').MergeEntityResult} MergeEntityResult */
/** @typedef {import('../types.js').ConsolidateEdgesResult} ConsolidateEdgesResult */
/** @typedef {import('../types.js').StSyncChanges} StSyncChanges */
```

**Key functions to type:**
- `normalizeKey(name)` → `string`
- `expandMainCharacterKeys(baseKeys, graphNodes)` → `string[]`
- `findCrossScriptCharacterKeys(baseKeys, graphNodes)` → `string[]`
- `upsertEntity(graphData, name, type, description, cap)` → `void`
- `upsertRelationship(graphData, source, target, description, cap, settings)` → `void`
- `hasSufficientTokenOverlap(tokensA, tokensB, ...)` → `boolean`
- `shouldMergeEntities(cosine, threshold, ...)` → `boolean`
- `mergeOrInsertEntity(graphData, name, type, description, cap, _settings)` → `Promise<MergeEntityResult>`
- `consolidateEdges(graphData, _settings)` → `Promise<ConsolidateEdgesResult>`
- `createEmptyGraph()` → `GraphData`

### 2. `src/store/chat-data.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../types.js').OpenVaultData} OpenVaultData */
/** @typedef {import('../types.js').Memory} Memory */
/** @typedef {import('../types.js').MemoryUpdate} MemoryUpdate */
```

**Key functions to type:**
- `getOpenVaultData()` → `OpenVaultData | null`
- `getCurrentChatId()` → `string | null`
- `saveOpenVaultData(expectedChatId)` → `Promise<boolean>`
- `generateId()` → `string`
- `updateMemory(id, updates)` → `Promise<boolean>`
- `deleteMemory(id)` → `Promise<boolean>`
- `deleteCurrentChatData()` → `Promise<boolean>`
- `addMemories(newMemories)` → `void`
- `markMessagesProcessed(fingerprints)` → `void`
- `incrementGraphMessageCount(count)` → `void`

### 3. `src/prompts/events/builder.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../../types.js').BasePromptParams} BasePromptParams */
/** @typedef {import('../../types.js').LLMMessages} LLMMessages */
```

**Key functions to type:**
- `buildEventExtractionPrompt({...})` → `LLMMessages`

### 4. `src/prompts/graph/builder.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../../types.js').GraphPromptParams} GraphPromptParams */
/** @typedef {import('../../types.js').EdgeConsolidationParams} EdgeConsolidationParams */
/** @typedef {import('../../types.js').LLMMessages} LLMMessages */
```

**Key functions to type:**
- `buildGraphExtractionPrompt({...})` → `LLMMessages`
- `buildEdgeConsolidationPrompt(edgeData, ...)` → `LLMMessages`

### 5. `src/prompts/reflection/builder.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../../types.js').ReflectionPromptParams} ReflectionPromptParams */
/** @typedef {import('../../types.js').LLMMessages} LLMMessages */
```

**Key functions to type:**
- `buildUnifiedReflectionPrompt(...)` → `LLMMessages`

### 6. `src/prompts/communities/builder.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../../types.js').CommunitySummaryParams} CommunitySummaryParams */
/** @typedef {import('../../types.js').GlobalSynthesisParams} GlobalSynthesisParams */
/** @typedef {import('../../types.js').LLMMessages} LLMMessages */
```

**Key functions to type:**
- `buildCommunitySummaryPrompt(...)` → `LLMMessages`
- `buildGlobalSynthesisPrompt(...)` → `LLMMessages`

---

## Implementation Steps

1. **Add new typedefs to `src/types.js`**
   - Add all new type definitions above
   - Verify no syntax errors with `npm run lint`

2. **Add `@ts-check` to `src/graph/graph.js`**
   - Add import typedefs
   - Add JSDoc to exported functions
   - Run `npm run lint` to verify

3. **Add `@ts-check` to `src/store/chat-data.js`**
   - Import typedefs
   - Add JSDoc to repository methods
   - Run `npm run lint` to verify

4. **Add `@ts-check` to all 4 prompt builder files**
   - Import typedefs
   - Add JSDoc to builder functions
   - Run `npm run lint` to verify

5. **Verify**
   - Check VS Code Problems panel — should show 0 errors
   - Run `npm run test` to ensure no runtime regressions
   - Verify IntelliSense works for new types

## Success Criteria

- [ ] `// @ts-check` present in all 6 target files
- [ ] VS Code shows IntelliSense for `GraphData`, `OpenVaultData`, `LLMMessages`, etc.
- [ ] Property access typos show red underline
- [ ] All existing tests pass (`npm run test`)
- [ ] No new runtime dependencies added

## Notes

- **JSDoc `extends` syntax**: The `GraphPromptParams extends BasePromptParams` in comments is conceptual — JSDoc doesn't support true extends. Just document the shared properties inline or use a base type.
- **Array return types**: Prompt builders return `LLMMessages` (array of message objects).
- **Optional chaining**: When documenting optional properties, use `[propertyName]` syntax in JSDoc `@param`.
- **Import paths**: All type imports use `import('../../types.js')` or `import('../types.js')` depending on depth.
