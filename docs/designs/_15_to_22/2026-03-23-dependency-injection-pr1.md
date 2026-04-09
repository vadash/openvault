# PR 1: Dependency Injection — Settings-Only via Extended Contexts

## Goal

Remove `getDeps().getExtensionSettings()` reads from 4 deep domain files. Shift settings resolution to orchestrators. Deliver config through existing context objects.

**Non-goals:** No logic changes (BM25, cosine, scoring math stay identical). No new files or abstractions. Runtime infrastructure (`connectionManager`, `fetch`, `parseReasoningFromString`, `showToast`) stays as `getDeps()` calls. Files outside scope (`reflect.js`, `graph.js`, `communities.js`) untouched.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | 4 files: `query-context.js`, `scoring.js`, `embeddings.js`, `llm.js` | Establishes pattern; reflection/graph follow in a later PR |
| Injection depth | Settings reads only | Runtime infra always comes from host environment; settings injection gives the biggest test win |
| Config shape | Extend existing context objects | `RetrievalContext` already flows through scoring; `options` already exists on `callLLM` |

## File-by-File Changes

### 1. `src/retrieval/query-context.js`

**Delete** internal helper `getQueryContextSettings()` and its `getDeps()` import.

**Signature changes:**

```js
// BEFORE
export function extractQueryContext(messages, activeCharacters = [], graphNodes = {})
export function buildEmbeddingQuery(messages, extractedEntities)
export function buildBM25Tokens(userMessage, extractedEntities, corpusVocab = null, meta = null)

// AFTER
export function extractQueryContext(messages, activeCharacters = [], graphNodes = {}, queryConfig)
export function buildEmbeddingQuery(messages, extractedEntities, queryConfig)
export function buildBM25Tokens(userMessage, extractedEntities, corpusVocab = null, meta = null, queryConfig)
```

`buildBM25Tokens` uses `entityBoostWeight` from settings (Layers 1-3 boost calculations). `parseRecentMessages` and `buildCorpusVocab` do not read settings — no changes.

**`queryConfig` shape:**

```js
{
  entityWindowSize: number,      // how many recent messages to scan for entity mentions
  embeddingWindowSize: number,   // message window for embedding query construction
  recencyDecayFactor: number,    // exponential decay weight for entity recency
  topEntitiesCount: number,      // max entities to include in query context
  entityBoostWeight: number,     // weight multiplier for graph-anchored entities
}
```

**Orchestrator wiring** — `retrieve.js:buildRetrievalContext()`:

```js
// In buildRetrievalContext(), build queryConfig from settings:
const settings = getDeps().getExtensionSettings()[extensionName];
ctx.queryConfig = {
  entityWindowSize:    settings.entityWindowSize,
  embeddingWindowSize: settings.embeddingWindowSize,
  recencyDecayFactor:  settings.recencyDecayFactor,
  topEntitiesCount:    settings.topEntitiesCount,
  entityBoostWeight:   settings.entityBoostWeight,
};
```

Call sites in `retrieve.js` pass `ctx.queryConfig`:

```js
const extracted = extractQueryContext(messages, activeChars, graphNodes, ctx.queryConfig);
const embeddingQuery = buildEmbeddingQuery(messages, extracted, ctx.queryConfig);
```

**Test impact:** Remove `setupTestContext()`, `resetDeps()`, and `vi.mock('../../src/deps.js')` from `query-context.test.js`. Pass plain config objects directly. All 17 tests become pure unit tests.

---

### 2. `src/retrieval/scoring.js`

**Delete** exported helper `getScoringParams()` and its `getDeps()` import.

**No exported signature changes.** `selectRelevantMemories(memories, ctx)` already receives a `RetrievalContext`. Internal functions read from `ctx.scoringConfig` instead of calling `getScoringParams()`.

**`scoringConfig` shape** (added to `RetrievalContext`):

```js
{
  forgetfulnessBaseLambda: number,
  forgetfulnessImportance5Floor: number,
  reflectionDecayThreshold: number,
  vectorSimilarityThreshold: number,
  alpha: number,
  combinedBoostWeight: number,
  embeddingSource: string,       // needed by selectRelevantMemoriesSimple/WithST for strategy routing
}
```

**Internal function changes:**

| Function | Current | After |
|----------|---------|-------|
| `selectRelevantMemories` | Calls `getScoringParams()` at top | Reads `ctx.scoringConfig` |
| `selectRelevantMemoriesSimple` | Calls `getDeps()` for `embeddingSource` | Reads from `ctx.scoringConfig.embeddingSource` |
| `selectRelevantMemoriesWithST` | Calls `getDeps()` for `embeddingSource`, `vectorSimilarityThreshold` | Reads from `ctx.scoringConfig` |
| `scoreMemoriesDirect` | Calls `getScoringParams()`, destructures to `constants`/`settings`, passes separately to `math.js:scoreMemories()` | Reads `ctx.scoringConfig`, destructures into `constants`/`settings` shape that `math.js` expects. `math.js` is NOT touched in this PR. |

**Orchestrator wiring** — `retrieve.js:buildRetrievalContext()`:

```js
ctx.scoringConfig = {
  forgetfulnessBaseLambda:       settings.forgetfulnessBaseLambda,
  forgetfulnessImportance5Floor: settings.forgetfulnessImportance5Floor,
  reflectionDecayThreshold:      settings.reflectionDecayThreshold,
  vectorSimilarityThreshold:     settings.vectorSimilarityThreshold,
  alpha:                         settings.alpha,
  combinedBoostWeight:           settings.combinedBoostWeight,
  embeddingSource:               settings.embeddingSource,
};
```

**Test impact:** `scoring.test.js` already doesn't use `setupTestContext` for most tests. The remaining internal function tests can pass `scoringConfig` via ctx without mocking.

---

### 3. `src/embeddings.js` (internal refactor, no API change)

**Exported function signatures unchanged.** The wrapper functions (`getQueryEmbedding`, `getDocumentEmbedding`, `enrichEventsWithEmbeddings`, `backfillAllEmbeddings`, etc.) remain the getDeps() boundary.

**Strategy class changes:**

#### TransformersStrategy

```js
// BEFORE (reads settings internally)
async getQueryEmbedding(text, { signal } = {}) {
  const prefix = getDeps().getExtensionSettings()[extensionName].embeddingQueryPrefix;
  return this.#embed(prefix + text, { signal });
}

// AFTER (accepts prefix as param)
async getQueryEmbedding(text, { signal, prefix = '' } = {}) {
  return this.#embed(prefix + text, { signal });
}
```

Same pattern for `getDocumentEmbedding` — accept `prefix` param.

#### OllamaStrategy

```js
// BEFORE (reads settings internally via #getSettings())
async getEmbedding(text, { signal } = {}) {
  const { url, model } = this.#getSettings();
  // ... fetch call
}

// AFTER (accepts url/model as params, delete #getSettings())
async getEmbedding(text, { signal, url, model } = {}) {
  // ... fetch call using injected url/model
}
```

#### StVectorStrategy

No changes — it doesn't read settings from getDeps(). It delegates to `utils/data.js` which is out of scope.

#### Wrapper function wiring (inside embeddings.js)

```js
// Wrapper reads settings once, passes to strategy
export async function getQueryEmbedding(text, { signal } = {}) {
  const settings = getDeps().getExtensionSettings()[extensionName];
  const source = settings.embeddingSource;
  const strategy = getStrategy(source);
  return strategy.getQueryEmbedding(text, {
    signal,
    prefix: settings.embeddingQueryPrefix,
    url: settings.ollamaUrl,
    model: settings.embeddingModel,
  });
}
```

**Orchestrator changes:** None. Exported API is identical.

**Test impact:** Strategy classes (`TransformersStrategy`, `OllamaStrategy`) testable by constructing the class and calling methods with plain params. No `getDeps()` mocking needed for strategy-level tests. Wrapper tests still need mocking (unchanged).

---

### 4. `src/llm.js` (backward-compatible extension)

**Add optional `profileId` and `backupProfileId` to existing `options` param:**

```js
// BEFORE
export async function callLLM(messages, config, options = {}) {
  const { signal, structured } = options;
  // reads profileId from getDeps().getExtensionSettings()
}

// AFTER
export async function callLLM(messages, config, options = {}) {
  const { signal, structured, profileId: explicitProfileId, backupProfileId: explicitBackupId } = options;
  // if explicitProfileId provided, use it; otherwise fall back to getDeps() read
}
```

**Fallback logic:**

```js
const settings = getDeps().getExtensionSettings()[extensionName];
const profileId = explicitProfileId
  ?? settings[config.profileSettingKey]
  ?? getDeps().getExtensionSettings()?.connectionManager?.selectedProfile;

const backupProfileId = explicitBackupId
  ?? settings.backupProfile;
```

**Orchestrator changes:** `extract.js` CAN start passing profile IDs but isn't required to. Callers outside PR 1 scope (`reflect.js`, `graph.js`, `communities.js`) continue working without changes due to the fallback.

**Test impact:** Profile failover tests in `llm.test.js` can pass `profileId`/`backupProfileId` directly in options. Reduces dependency on mocked settings structure for those specific tests.

---

## Execution Order

| Step | File | Risk | Test change |
|------|------|------|-------------|
| 1 | `query-context.js` + test | Low | Remove setupTestContext entirely |
| 2 | `scoring.js` + test | Low | Add scoringConfig to ctx in tests |
| 3 | `retrieve.js` (orchestrator) | Low | Build queryConfig + scoringConfig in buildRetrievalContext |
| 4 | `embeddings.js` strategies | Low | New strategy-level tests without getDeps mock |
| 5 | `llm.js` options extension | Low | Existing tests gain optional profileId path |

Steps 1-3 form a natural unit (retrieval pipeline). Steps 4-5 are independent.

## Verification

- `npm run test` green after each step
- No `getDeps()` imports remaining in `query-context.js` or `scoring.js` after steps 1-2
- `getDeps()` call count in `embeddings.js` reduced (moved from strategies to wrappers)
- `llm.js` retains getDeps() fallback — existing callers must not break
- Biome lint/format passes (pre-commit hook)
