# Design: BM25 Global IDF Calculation

## 1. Problem Statement

The current BM25 implementation calculates Inverse Document Frequency (IDF) scores using **only the candidate memories being scored**. This creates a fundamental limitation:

- A term that appears frequently across the entire chat history may appear "rare" in the filtered candidate set
- This leads to artificially high IDF scores for globally common terms
- Retrieval quality degrades as the chat grows, since the IDF corpus doesn't represent the true vocabulary distribution

### Example Scenario

In a 1000-message chat about "Princess Suzy":
- The name "Suzy" appears in 800 memories
- Current retrieval filters to 50 candidate memories
- Only 10 of those candidates contain "Suzy"
- IDF assigns "Suzy" a high score (appears "rare" in 10/50 = 20% of corpus)
- But "Suzy" is actually very common (80% of all memories)

This causes BM25 to over-weight terms that should have low discriminative power.

## 2. Goals & Non-Goals

### Must Do
- Use a broader corpus for IDF calculation that includes hidden (non-visible) memories
- Maintain backward compatibility with existing saved data
- Keep implementation simple and maintainable
- Preserve existing Dynamic Character Stopwords behavior
- No schema changes to `chatMetadata.openvault`

### Won't Do
- Persistent global term frequency storage (deferred to future optimization)
- Inclusion of recent visible messages in IDF (already in context, no need)
- Complex cache invalidation logic

## 3. Proposed Architecture

### High-Level Approach

**Option A: Candidate + Hidden Memories Corpus**

Expand the IDF calculation corpus to include:
1. **Candidate memories** - The memories being scored (existing behavior)
2. **Hidden memories** - Memories from hidden (system) messages not in the current candidate set

The intuition: Hidden memories represent the "historical background" of the chat and provide a realistic vocabulary distribution for IDF scoring.

### Key Components

#### 3.1 Modified `scoreMemories()` Function

```javascript
// src/retrieval/math.js

export async function scoreMemories(
    memories,              // Candidate memories to score
    contextEmbedding,
    chatLength,
    constants,
    settings,
    queryTokens,
    characterNames = [],
    hiddenMemories = []    // NEW: Optional hidden memories for IDF
) {
    // Build corpus: candidates + hidden (if provided)
    const idfCorpus = hiddenMemories.length > 0
        ? [...memories, ...hiddenMemories]
        : memories;

    // Precompute BM25 data with expanded corpus
    let tokens = null;
    let idfMap = null;
    let avgDL = 0;
    let memoryTokensList = null;

    if (queryTokens) {
        tokens = Array.isArray(queryTokens) ? queryTokens : tokenize(queryTokens);

        // Filter character name stems (existing behavior)
        if (characterNames.length > 0) {
            const charStems = new Set(characterNames.flatMap((name) =>
                tokenize(name.toLowerCase())
            ));
            tokens = tokens.filter((t) => !charStems.has(t));
        }

        if (tokens.length > 0) {
            // Tokenize ALL memories in corpus (candidates + hidden)
            const corpusMemoryTokens = idfCorpus.map((m) =>
                m.tokens || tokenize(m.summary || '')
            );

            // Calculate IDF from expanded corpus
            const tokenizedMap = new Map(
                corpusMemoryTokens.map((t, i) => [i, t])
            );
            const idfData = calculateIDF(idfCorpus, tokenizedMap);
            idfMap = idfData.idfMap;
            avgDL = idfData.avgDL;

            // Only score candidate memories (not hidden ones)
            memoryTokensList = corpusMemoryTokens.slice(0, memories.length);

            // IDF-aware query TF adjustment (existing)
            tokens = adjustQueryTokensByIDF(tokens, idfMap, idfCorpus.length);
        }
    }

    // Compute raw BM25 scores for candidates only
    const rawBM25Scores = memories.map((_memory, index) => {
        if (tokens && idfMap && memoryTokensList) {
            return bm25Score(tokens, memoryTokensList[index], idfMap, avgDL);
        }
        return 0;
    });

    // ... rest of function unchanged
}
```

#### 3.2 Updated `scoreMemoriesDirect()` Call Site

```javascript
// src/retrieval/scoring.js

async function scoreMemoriesDirect(
    memories,
    contextEmbedding,
    chatLength,
    limit,
    queryTokens,
    characterNames = [],
    hiddenMemories = []  // NEW: Optional parameter
) {
    const { constants, settings } = getScoringParams();
    const scored = await scoreMemories(
        memories,
        contextEmbedding,
        chatLength,
        constants,
        settings,
        queryTokens,
        characterNames,
        hiddenMemories  // NEW: Pass through
    );
    // ... rest unchanged
}
```

#### 3.3 Updated `selectRelevantMemoriesSimple()` Call Site

```javascript
// src/retrieval/scoring.js

async function selectRelevantMemoriesSimple(memories, ctx, limit, allHiddenMemories) {
    // ... query building unchanged ...

    return scoreMemoriesDirect(
        memories,
        contextEmbedding,
        chatLength,
        limit,
        bm25Tokens,
        activeCharacters || [],
        allHiddenMemories  // NEW: Pass hidden memories for IDF
    );
}
```

#### 3.4 Updated `selectRelevantMemories()` Entry Point

```javascript
// src/retrieval/scoring.js

export async function selectRelevantMemories(memories, ctx) {
    if (!memories || memories.length === 0) return [];

    const activeMemories = memories.filter((m) => !m.archived);
    const { finalTokens } = ctx;

    // NEW: Build hidden memories set (all memories - candidates)
    // Use all non-archived memories that aren't in the candidate set
    const candidateIds = new Set(activeMemories.map((m) => m.id));
    const hiddenMemories = (ctx.allAvailableMemories || [])
        .filter((m) => !m.archived && !candidateIds.has(m.id));

    const { memories: scoredMemories, scoredResults } = await selectRelevantMemoriesSimple(
        activeMemories,
        ctx,
        1000,
        hiddenMemories  // NEW: Pass for IDF calculation
    );

    // ... rest unchanged
}
```

### 3.5 Context Building Updates

```javascript
// src/retrieval/retrieve.js

export function buildRetrievalContext(opts = {}) {
    // ... existing code ...

    return {
        recentContext,
        userMessages,
        chatLength: chat.length,
        primaryCharacter,
        activeCharacters: getActiveCharacters(),
        headerName: isGroupChat ? povCharacters[0] : 'Scene',
        finalTokens: settings.retrievalFinalTokens,
        worldContextBudget: settings.worldContextBudget,
        graphNodes: data?.graph?.nodes || {},
        allAvailableMemories: data?.[MEMORIES_KEY] || [],  // NEW: Full memory list
    };
}
```

## 4. Data Models / Schema

### No Schema Changes

This design requires **no changes** to `chatMetadata.openvault`:

- The `allAvailableMemories` array is built at runtime from existing `memories` data
- No new persistent fields needed
- Backward compatible with existing chats

### Runtime Data Structure

```typescript
// RetrievalContext augmentation
interface RetrievalContext {
    // ... existing fields ...
    allAvailableMemories?: Memory[];  // NEW: All memories for hidden set extraction
}

// scoreMemories signature augmentation
function scoreMemories(
    memories: Memory[],
    contextEmbedding: Float32Array | null,
    chatLength: number,
    constants: ScoringConstants,
    settings: ScoringSettings,
    queryTokens: string[] | string,
    characterNames?: string[],
    hiddenMemories?: Memory[]  // NEW: Optional hidden memories
): Promise<ScoredMemory[]>
```

## 5. Interface / API Design

### Public API Changes

None. The changes are internal to the retrieval pipeline.

### Internal Function Signatures

```javascript
// scoreMemories in src/retrieval/math.js
export async function scoreMemories(
    memories,              // Memory[]
    contextEmbedding,      // Float32Array | null
    chatLength,            // number
    constants,             // Object
    settings,              // Object
    queryTokens,           // string | string[]
    characterNames = [],   // string[]
    hiddenMemories = []    // NEW: Memory[] - optional
)

// selectRelevantMemories in src/retrieval/scoring.js
export async function selectRelevantMemories(
    memories,  // Memory[] - candidate memories to score
    ctx        // RetrievalContext - now includes allAvailableMemories
)

// buildRetrievalContext in src/retrieval/retrieve.js
export function buildRetrievalContext(opts = {})
// Returns RetrievalContext with allAvailableMemories populated
```

## 6. Risks & Edge Cases

### 6.1 Edge Cases

| Scenario | Behavior |
|----------|----------|
| No hidden memories exist | Falls back to candidate-only IDF (current behavior) |
| Hidden memories > 1000 | IDF corpus includes all; performance acceptable (tokenization is fast) |
| Chat has only visible messages | No hidden memories; IDF calculated from candidates only |
| Empty candidate set | Short-circuits before IDF calculation (existing behavior) |
| Memory has no `tokens` field | Falls back to `tokenize(summary)` (existing behavior) |

### 6.2 Performance Impact

**Tokenization Cost:**
- Current: Tokenize `N` candidate memories
- New: Tokenize `N + M` memories (candidates + hidden)
- Tokenization is ~10ms per 100 memories
- For 500 candidates + 1500 hidden = ~200ms overhead

**Mitigation:**
- Memories with cached `tokens` field skip tokenization
- Tokenization is async-friendly (already yields every 250 items)
- Only happens during retrieval (not on hot generation path)

### 6.3 Semantic Correctness

**Question:** Should reflections be included in the IDF corpus?

**Answer:** Yes. Reflections contain summarized themes and are semantically distinct from events. Including them improves IDF accuracy for abstract concepts.

**Implementation:** The `allAvailableMemories` array includes both events and reflections.

### 6.4 Backward Compatibility

**Existing chats:** No migration needed. The design is fully backward compatible:
- Missing `allAvailableMemories` in context defaults to `[]`
- Missing `tokens` field triggers lazy tokenization
- No new persistent schema fields

**Future migrations:** None required.

## 7. Testing Strategy

### Unit Tests

```javascript
// src/retrieval/math.test.js

describe('calculateIDF with expanded corpus', () => {
    it('should calculate IDF from candidates + hidden memories', () => {
        const candidates = [
            { summary: 'Suzy fought bravely' },
            { summary: 'The kingdom is at peace' }
        ];
        const hidden = [
            { summary: 'Suzy visited the castle' },
            { summary: 'Suzy met the king' },
            { summary: 'The king declared war' }
        ];

        const tokenized = new Map([
            ...candidates.map((m, i) => [i, tokenize(m.summary)]),
            ...hidden.map((m, i) => [i + candidates.length, tokenize(m.summary)])
        ]);

        const { idfMap } = calculateIDF([...candidates, ...hidden], tokenized);

        // "Suzy" appears in 3/5 = 60% of corpus
        // Should have LOWER IDF than if calculated from candidates only (1/2 = 50%)
        const suzyIDF = idfMap.get('suzy') ?? 0;
        expect(suzyIDF).toBeLessThan(
            calculateIDF(candidates, new Map(candidates.map((m, i) => [i, tokenize(m.summary)])))
                .idfMap.get('suzy') ?? Infinity
        );
    });
});
```

### Integration Tests

```javascript
// src/retrieval/retrieve.integration.test.js

describe('BM25 retrieval with hidden memory IDF', () => {
    it('should rank rare terms higher than common terms', async () => {
        // Setup: Chat with many memories about common topic, few about rare topic
        const data = {
            memories: [
                // Common: "sword" appears many times
                { id: '1', summary: 'He drew his sword', message_ids: [1], is_system: true },
                { id: '2', summary: 'The sword gleamed', message_ids: [2], is_system: true },
                { id: '3', summary: 'Sword fighting is hard', message_ids: [3], is_system: true },
                // Rare: "excalibur" appears once
                { id: '4', summary: 'He found Excalibur', message_ids: [4], is_system: true },
                // Hidden (not in candidates): more "sword" references
                { id: '5', summary: 'His sword was heavy', message_ids: [5], is_system: true },
                { id: '6', summary: 'Sword practice daily', message_ids: [6], is_system: true },
            ]
        };

        // Query for "sword" should score lower than "excalibur"
        // despite more token matches, due to lower IDF
        const results = await retrieveAndInjectContext();

        const swordResult = results.find(r => r.memory.id === '1');
        const excaliburResult = results.find(r => r.memory.id === '4');

        expect(excaliburResult.breakdown.bm25Score)
            .toBeGreaterThan(swordResult.breakdown.bm25Score);
    });
});
```

## 8. Implementation Checklist

- [ ] Add `hiddenMemories` parameter to `scoreMemories()` in `src/retrieval/math.js`
- [ ] Update `calculateIDF()` call to use expanded corpus
- [ ] Update `scoreMemoriesDirect()` signature in `src/retrieval/scoring.js`
- [ ] Update `selectRelevantMemoriesSimple()` to pass hidden memories
- [ ] Update `selectRelevantMemories()` to extract hidden from `ctx.allAvailableMemories`
- [ ] Update `buildRetrievalContext()` to populate `allAvailableMemories`
- [ ] Add unit tests for expanded corpus IDF calculation
- [ ] Add integration test for common vs rare term ranking
- [ ] Manual testing in real chat scenarios

## 9. Future Enhancements (Out of Scope)

- **Persistent global term frequencies**: Store `globalTermStats` in metadata for true global IDF without recomputation
- **Adaptive corpus size**: Dynamically adjust hidden memory window based on chat size
- **IDF caching**: Cache IDF computation between retrievals when chat hasn't changed
