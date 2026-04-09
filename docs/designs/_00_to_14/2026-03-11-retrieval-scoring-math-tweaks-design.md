# Design: Retrieval & Scoring Math Tweaks (Phase 3)

## 1. Problem Statement

OpenVault's retrieval system has three identified flaws in scoring and context selection that reduce retrieval quality:

1. **BM25 Multi-Word Entity False Positives**: Multi-word entities like "бордовый комплект белья" (burgundy lingerie set) are tokenized into individual stems ("бордов", "комплект", "бел"), each receiving a 5x boost. When the user types "комплект ключей" (key set), the shared stem "комплект" triggers the 5x boost, falsely retrieving memories about lingerie instead of keys.

2. **Reflection Decay Obsolescence**: Foundational reflections (e.g., "I deeply love X because of Y") generated early in a long RP decay linearly to 0.25x effectiveness by message 1000, while mundane recent reflections score higher. Important long-term insights are lost to aggressive temporal decay.

3. **Artificial Context Bucket Quotas**: The "Old" bucket is hard-capped at 50% of memory budget. If old memories are highly relevant (referencing callbacks to the story's beginning), they are truncated in favor of less-relevant recent memories that happen to fill the "Mid" or "Recent" buckets.

## 2. Goals & Non-Goals

### Must Do
- Fix multi-word entity matching to prevent false positives from partial stem matches
- Implement recursive reflection tree to preserve high-value long-term insights
- Remove hard bucket quotas in favor of score-first selection with soft chronological balancing

### Won't Do
- Complete rewrite of BM25 scoring system (evolutionary changes only)
- Full graph re-architecture (work within existing node/edge schema)
- Real-time reflection synthesis during retrieval (reflection generation remains async background process)

## 3. Proposed Architecture

### 3.1 BM25 Exact Phrase Tokens

Add a new Layer 0 to BM25 token construction that treats multi-word entities as atomic units before tokenization:

```
Layer 0: Exact phrase match tokens (multi-word entities at 10x boost)
Layer 1: Single-word entity stems (5x boost) - existing
Layer 2: Corpus-grounded message stems (3x boost) - existing
Layer 3: Non-grounded message stems (2x boost) - existing
```

**Key insight**: Multi-word entities (spaces in name) are added as raw, untokenized strings to the query tokens. During BM25 scoring, a memory receives the boost only if it contains the **exact phrase** (case-insensitive, whitespace-normalized). Single-word entities continue using the existing stem-based Layer 1.

### 3.2 Recursive Reflection Tree

Implement a hierarchical reflection system where old reflections can be synthesized into higher-level reflections:

```
Level 0 (Events): Raw extracted events
Level 1 (Reflections): Synthesized from recent events (current system)
Level 2 (Meta-Reflections): Synthesized from old Level 1 reflections
Level 3+ (Higher-Order): Recursively synthesized from lower-level reflections
```

**Mechanism**:
1. Add `level: number` field to reflections (default 1 for current reflections)
2. Add `parent_ids: string[]` field to track source reflections
3. Modify reflection trigger to include old reflections in synthesis context
4. Higher-level reflections reset the decay curve by having a newer `sequence` timestamp
5. Apply decay based on `(distance / 2^level)` — higher-level reflections decay slower

### 3.3 Score-First Budgeting with Soft Chronological Balance

Replace hard bucket quotas with a two-phase selection:

**Phase 1: Score-First Selection**
- Select top-scoring N tokens globally, regardless of chronology
- N = tokenBudget * 0.95 (reserve 5% for soft balance adjustment)

**Phase 2: Soft Chronological Balancing**
- After Phase 1, analyze the selected distribution across Old/Mid/Recent
- If a bucket is underrepresented (<20% of selected), add up to 5% more budget from next-best memories in that bucket
- Final variance: ~15-20% per bucket (vs fixed 50% for Old)

## 4. Data Models / Schema

### 4.1 Reflection Schema Changes

```typescript
// Add to existing memory schema
interface ReflectionMemory extends Memory {
    type: 'reflection';
    level: number; // NEW: 1 = normal, 2+ = meta-reflection
    parent_ids?: string[]; // NEW: source reflection IDs for level >= 2
    // ... existing fields (summary, importance, tokens, etc.)
}
```

### 4.2 BM25 Token Structure

```typescript
// Internal structure for BM25 token construction
interface BM25TokenLayers {
    layer0: string[];  // Exact phrase tokens (multi-word entities)
    layer1: string[];  // Single-word entity stems
    layer2: string[];  // Corpus-grounded stems
    layer3: string[];  // Non-grounded stems
}
```

### 4.3 Settings Schema Changes

```typescript
// Add to defaultSettings in constants.js
export const defaultSettings = {
    // ... existing settings

    // NEW: BM25 exact phrase boost weight
    exactPhraseBoostWeight: 10.0, // 10x for multi-word entities

    // NEW: Reflection level settings
    maxReflectionLevel: 3, // Maximum reflection tree depth
    reflectionLevelMultiplier: 2.0, // Decay slows by 2x per level

    // NEW: Soft balance thresholds
    bucketMinRepresentation: 0.20, // 20% minimum per bucket
    bucketSoftBalanceBudget: 0.05, // 5% budget for balancing
};
```

## 5. Interface / API Design

### 5.1 BM25 Token Construction

```typescript
/**
 * Build enriched token array for BM25 scoring with multi-word entity phrase matching.
 * @param {string} userMessage - Original user message
 * @param {{entities: string[], weights: Object}} extractedEntities - Extracted entity context
 * @param {Set<string>|null} corpusVocab - Corpus vocabulary for grounding
 * @param {Object} meta - Metadata object for debug output
 * @returns {string[]} Token array with boosted entities and message stems
 */
export function buildBM25Tokens(
    userMessage: string,
    extractedEntities: {entities: string[], weights: Record<string, number>},
    corpusVocab: Set<string> | null,
    meta: {layer0Count?: number, layer1Count?: number, ...} | null
): string[]
```

**Changes**:
- Split `extractedEntities.entities` into multi-word and single-word entities
- Add Layer 0: Exact phrase tokens for multi-word entities (un-tokenized)
- Single-word entities continue to Layer 1 (existing behavior)

### 5.2 Exact Phrase Matching in BM25

```typescript
/**
 * Check if a memory contains an exact multi-word phrase (case-insensitive).
 * @param {string} phrase - Multi-word phrase to find
 * @param {Object} memory - Memory object with summary field
 * @returns {boolean} True if exact phrase found in memory
 */
function hasExactPhrase(phrase: string, memory: Memory): boolean
```

### 5.3 Reflection Generation with Level Support

```typescript
/**
 * Generate reflections including potential higher-level synthesis.
 * @param {string} characterName - Character to reflect for
 * @param {Array} allMemories - Full memory stream including old reflections
 * @param {Object} characterStates - Character state for POV filtering
 * @returns {Promise<Array>} New reflection memory objects
 */
export async function generateReflections(
    characterName: string,
    allMemories: Memory[],
    characterStates: CharacterStates
): Promise<Memory[]>
```

**Changes**:
- Filter candidate memories to include old reflections (level >= 1, distance > threshold)
- Pass `level` and `parent_ids` to prompt construction
- LLM prompt indicates when synthesizing higher-level reflections

### 5.4 Reflection Decay with Level

```typescript
// In calculateScore() - modified reflection decay section
if (memory.type === 'reflection' && distance > constants.reflectionDecayThreshold) {
    const threshold = constants.reflectionDecayThreshold;
    const level = memory.level || 1;
    const levelDivisor = Math.pow(constants.reflectionLevelMultiplier, level - 1);

    // Decay is divided by level multiplier: level 2 decays 2x slower
    const decayFactor = Math.max(0.25, 1 - (distance - threshold) / (2 * threshold * levelDivisor));
    total *= decayFactor;
}
```

### 5.5 Score-First Budgeting

```typescript
/**
 * Select memories using score-first budgeting with soft chronological balancing.
 * @param {Array} scoredMemories - Pre-scored memories, sorted by score
 * @param {number} tokenBudget - Maximum tokens to select
 * @param {number} chatLength - Current chat length for bucket assignment
 * @returns {Array} Selected memories fitting budget with balanced distribution
 */
export function selectMemoriesWithSoftBalance(
    scoredMemories: ScoredMemory[],
    tokenBudget: number,
    chatLength: number
): Memory[]
```

## 6. Risks & Edge Cases

### 6.1 BM25 Exact Phrase Matching

| Risk | Mitigation |
|------|------------|
| Phrase matches are too strict (misses relevant memories) | Fallback to stem-based Layer 1 if exact phrase finds no matches; retain both phrase and stem tokens |
| Multi-word entities with punctuation (e.g., "King Aldric, Jr.") | Normalize punctuation during phrase matching (strip commas, periods, etc.) |
| Case sensitivity issues | Case-fold both phrase and memory text before comparison |
| Performance degradation from substring search | Cache phrase matches per memory; early exit after first match |

### 6.2 Recursive Reflection Tree

| Risk | Mitigation |
|------|------------|
| Infinite recursion or unbounded tree depth | Hard cap at `maxReflectionLevel: 3`; enforce in synthesis logic |
| Meta-reflections become too abstract/unusable | Require minimum 3 source reflections for synthesis; filter low-importance sources |
| Reflection proliferation exceeding storage | Apply 3-tier dedup to meta-reflections; maxReflectionsPerCharacter applies across all levels |
| Synthesis prompt becomes complex with mixed levels | Separate prompts for level 1 vs level 2+; level 2+ gets different system instruction |

### 6.3 Score-First Budgeting

| Risk | Mitigation |
|------|------------|
| Recent memories dominate completely (no old context) | Soft balance minimum 20% per bucket; ensures chronology represented |
| Sudden context shifts when scoring changes | Use exponential moving average of scores; prevent thrashing |
| Empty bucket causes division by zero | Handle zero-count buckets gracefully; skip balance phase if any bucket empty |
| Token counting inaccuracy leads to budget overrun | Conservative 5% reserve buffer in Phase 1 |

### 6.4 Cross-Cutting Concerns

| Edge Case | Behavior |
|-----------|----------|
| Empty corpus vocab (no memories yet) | Fall back to unfiltered Layer 3 only (existing backward compat) |
| Chat with < 100 messages (all "Recent") | All memories in Recent bucket; soft balance skips old/mid |
| Reflection without level field (legacy) | Treat as level 1 for backward compatibility |
| Entity with 1 word but extracted as multi-word | Normalize during extraction; strip whitespace, check word count |

## 7. Implementation Phases

### Phase 1: BM25 Exact Phrase Tokens (1-2 days)
1. Modify `buildBM25Tokens()` to split multi-word vs single-word entities
2. Add `hasExactPhrase()` helper function
3. Modify BM25 scoring to check exact phrases before stem matching
4. Add tests for phrase matching edge cases
5. Update debug export to show Layer 0 token count

### Phase 2: Recursive Reflection Tree (2-3 days)
1. Update reflection schema to include `level` and `parent_ids`
2. Modify `generateReflections()` to include old reflections in candidate set
3. Update prompt construction to handle level-aware synthesis
4. Modify `calculateScore()` reflection decay with level divisor
5. Add migration script to set `level: 1` on existing reflections
6. Add tests for multi-level reflection generation

### Phase 3: Score-First Budgeting (1-2 days)
1. Move `assignMemoriesToBuckets()` and `getMemoryPosition()` to `src/utils/text.js` to avoid circular dependencies
2. Create `selectMemoriesWithSoftBalance()` function in `scoring.js`
3. Modify `selectRelevantMemories()` to use new selection logic
4. Update `formatContextForInjection()` to remove hard 50% quota
5. Add tests for bucket distribution and edge cases
6. Update debug export to show bucket distribution before/after

### Phase 4: Integration & Testing (1 day)
1. End-to-end testing with realistic RP scenarios
2. Performance profiling (BM25 phrase match cost)
3. Update UI settings panel with new constants
4. Documentation updates

## 8. Implementation Notes

### 8.1 BM25 Exact Phrase Token Detection

**Distinguishing exact phrases from stems**:
Since `buildBM25Tokens()` returns a flat `string[]`, exact phrases (Layer 0) can be distinguished from stems (Layers 1-3) by checking for spaces:

```javascript
// Inside scoreMemories() in math.js
const exactPhrases = tokens.filter(t => t.includes(' '));
const stemTokens = tokens.filter(t => !t.includes(' '));
```

**Handling exact phrases in BM25**:
Because `calculateIDF()` relies on `m.tokens` (which only contains single-word stems), exact phrases should be handled separately from the standard `idfMap`. Two approaches:

1. Assign maximum possible IDF (since phrases are highly specific)
2. Apply the 10x boost as a direct flat multiplier to the final BM25 score for matching memories

**Phrase matching implementation**:
Use a helper in `bm25Score()`:
```javascript
function hasExactPhrase(phrase, docTokens, docText) {
    const normalized = phrase.toLowerCase().trim();
    const searchText = docText.toLowerCase();
    // Simple substring search (phrase contains spaces)
    return searchText.includes(normalized);
}
```

### 8.2 Reflection Candidate Set Construction

In `src/reflection/reflect.js`, modify `generateReflections()` to include old reflections:

```javascript
// Current: Top 100 recent memories only
const recentMemories = sortMemoriesBySequence(accessibleMemories, false).slice(0, 100);

// NEW: Combine recent memories with existing reflections for synthesis
const recentMemories = sortMemoriesBySequence(accessibleMemories, false).slice(0, 100);
const oldReflections = accessibleMemories.filter(m =>
    m.type === 'reflection' &&
    m.level >= 1
);
const candidateSet = _deduplicateById([...recentMemories, ...oldReflections]);
```

### 8.3 Avoiding Circular Dependencies

**Issue**: `assignMemoriesToBuckets()` lives in `formatting.js`, but `selectMemoriesWithSoftBalance()` in `scoring.js` needs it. Since `formatting.js` imports from `scoring.js`, this creates a circular dependency.

**Solution**: Move `assignMemoriesToBuckets()` and `getMemoryPosition()` to a shared utility file:
- Option A: Move to `src/utils/text.js` (already has `sortMemoriesBySequence`)
- Option B: Move to `src/retrieval/math.js` (pure functions, already imported by scoring)

Recommended: **Option A** (`text.js`) to keep temporal utilities together.

```javascript
// In src/utils/text.js - export bucket utilities
export { assignMemoriesToBuckets, getMemoryPosition } from './retrieval/formatting.js';
// Then move the actual implementations to text.js
```

### 8.4 Backward Compatibility for Reflection Level

Existing reflections lack the `level` field. Use safe defaulting:

```javascript
// In math.js calculateScore()
const level = memory.level || 1; // Defaults legacy reflections to Level 1
```

No destructive database migration required—reflections gain `level: 1` on next save.

## 9. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| BM25 false positive rate | < 5% | Manual inspection of edge cases |
| Old reflection retrieval (after 1000 msgs) | > 0.5x score avg | Score comparison in test chats |
| Old bucket representation | 15-25% of tokens | Debug export stats |
| Reflection tree depth | Avg 1.5-2.0 in long chats | Reflection stats export |
| Retrieval latency increase | < 10% | Perf monitoring |
