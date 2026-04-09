# Design: Graph-Anchored Entity Detection

## 1. Problem Statement

The retrieval pipeline extracts entity names from recent messages using regex + hardcoded
stopword/imperative lists. This approach is brittle for multilingual RP:

- Russian imperatives ("Запомни", "Держись") slip through filters as false entities
- "User" (generic ST identifier) gets detected as an entity
- Every new language/dialect needs more hardcoded word lists
- The system already has LLM-curated entity names in the graph — but doesn't use them for retrieval

## 2. Goals & Non-Goals

**Must do:**
- Replace regex-based entity extraction with graph-anchored lookup
- Handle inflectional endings (Елена/Елену/Еленой) via Snowball stemming
- Persist merge aliases on graph nodes for alternate name matching (Vova/Lily)
- DRY the stemmer into a shared utility module
- Rewrite query-context tests for the new approach

**Won't do:**
- Change BM25 scoring or vector scoring
- Change graph merging logic (beyond adding alias persistence)
- Remove stopwords.js or russian-imperatives.js (still used by graph merging)
- Support CJK word segmentation (Snowball doesn't cover it; current behavior: pass-through)

## 3. Proposed Architecture

### 3.1 Shared Stemmer Utility

New file: `src/utils/stemmer.js`

Extracts `stemWord()` from `math.js` so it can be used by both retrieval and graph modules.

```javascript
// src/utils/stemmer.js
import snowball from 'https://esm.sh/snowball-stemmers';

const ruStemmer = snowball.newStemmer('russian');
const enStemmer = snowball.newStemmer('english');

const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const LATIN_RE = /\p{Script=Latin}/u;

/**
 * Stem a word using the appropriate language stemmer based on script detection.
 * Cyrillic → Russian, Latin → English, other → unchanged.
 */
export function stemWord(word) {
    if (CYRILLIC_RE.test(word)) return ruStemmer.stem(word);
    if (LATIN_RE.test(word)) return enStemmer.stem(word);
    return word;
}

/**
 * Stem a multi-word name into a Set of stems.
 * No stopword filtering — entity names should not be filtered.
 * @param {string} name - Entity name (e.g. "King Aldric")
 * @returns {Set<string>} Set of stems (e.g. {"king", "aldric"})
 */
export function stemName(name) {
    if (!name) return new Set();
    const words = name.toLowerCase().match(/[\p{L}0-9]+/gu) || [];
    return new Set(words.filter(w => w.length > 2).map(stemWord).filter(w => w.length > 2));
}
```

### 3.2 Graph-Anchored extractQueryContext

Replace `extractFromText()` (regex + stopwords + imperatives) with graph lookup.

**Input changes:** `extractQueryContext(messages, activeCharacters, graphNodes)` — new 3rd param.

**Algorithm:**
1. Build stem → entity display name map from `graphNodes` + `activeCharacters`
   - For each node: stem `node.name` + stem each `node.aliases[]`
   - For each character: stem name
2. For each message, split into stemmed word tokens
3. Match stemmed tokens against the stem map
4. Accumulate recency-weighted scores (same as before)
5. Filter >50% frequency, sort, take top N (same as before)

### 3.3 Alias Persistence on Graph Merge

In `mergeOrInsertEntity()` (`graph.js`), when node B merges into node A:

```javascript
if (!graphData.nodes[bestMatch].aliases) graphData.nodes[bestMatch].aliases = [];
graphData.nodes[bestMatch].aliases.push(name);
```

This stores the original name of the merged entity. Example:
- LLM extracts "Vova (aka Lily)" → merges into existing "Vova" node
- `vova.aliases = ["Vova (aka Lily)"]`
- During retrieval, stemming "Lily" matches against alias stems

Same treatment in `consolidateGraph()` for retroactive merges.

## 4. Data Model Changes

### Graph Node (extended)

```typescript
{
  name: string,
  type: string,
  description: string,
  mentions: number,
  embedding?: number[],
  aliases?: string[]      // NEW — names that merged into this node
}
```

No migration needed — missing `aliases` field treated as empty array.

## 5. File Changes

| File | Change |
|------|--------|
| `src/utils/stemmer.js` | **NEW** — shared `stemWord()` + `stemName()` |
| `src/retrieval/math.js` | Remove `stemWord`, `ruStemmer`, `enStemmer`, `CYRILLIC_RE`, `LATIN_RE`. Import from `utils/stemmer.js` |
| `src/retrieval/query-context.js` | Replace `extractFromText()` with graph-anchored lookup. Remove imports of `ALL_STOPWORDS`, `isLikelyImperative`. Add import of `stemName`, `stemWord` from utils. New param `graphNodes` on `extractQueryContext`. |
| `src/retrieval/scoring.js` | Pass `ctx.graphNodes` to `extractQueryContext()` |
| `src/retrieval/retrieve.js` | Add `graphNodes: data.graph?.nodes || {}` to retrieval context |
| `src/graph/graph.js` | Add `aliases` persistence in `mergeOrInsertEntity()` and `consolidateGraph()` |
| `tests/query-context.test.js` | Rewrite entity extraction tests: pass `graphNodes` param, test stem matching, test alias matching |

### Files NOT changed
- `src/utils/stopwords.js` — still used by graph token overlap guard
- `src/utils/russian-imperatives.js` — still used by stopwords.js (which feeds graph merging)
- `buildEmbeddingQuery()`, `buildBM25Tokens()`, `parseRecentMessages()` — unchanged

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| Empty graph (first messages) → no entities detected | Character names still work via `activeCharacters`. No memories to retrieve anyway. |
| New entity mentioned but not yet in graph | Those messages are still in visible chat context — LLM sees them directly. |
| Short entity names (3 chars) stem to <3 chars → filtered | `stemName` has post-stem length filter. Very short names (e.g. "Jo") already don't work in current system either (3-char minimum). |
| Entity name is a common word (e.g. "Rose" the character) | Same false-positive risk as current system. Frequency filter (>50% messages) helps. |
| Snowball over-stems Russian name to match unrelated word | Low risk — proper nouns stem predictably. Same stemmer already used in BM25 without issues. |
| Graph node with no `aliases` field (existing data) | `node.aliases || []` — backwards compatible, no migration. |
