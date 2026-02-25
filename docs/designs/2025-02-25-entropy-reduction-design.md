# Design: Entropy Reduction Refactoring

## 1. Problem Statement

OpenVault's codebase has accumulated significant entropy through premature abstraction, over-engineering, and tests that verify implementation details rather than behavior. The project contains:

- **~6,966 lines** of source code
- **~8,153 lines** of test code (more tests than production code)
- Mock-heavy "unit tests" that break on any refactoring
- Custom UI abstractions wrapping jQuery (which is already present)
- Pipeline stages split across 5 files when 1 would suffice
- Utility functions scattered across 6 tiny files

**Core issue:** The codebase prioritizes "clean architecture" patterns over simplicity, resulting in high cognitive load for minimal benefit.

## 2. Goals & Non-Goals

### Must Do
1. Reduce total lines of code by **1,500 - 2,500 lines**
2. Eliminate tests that require mocking more than 20% of the system
3. Flatten unnecessary directory structures (`src/utils/`, `src/extraction/stages/`, `src/extraction/schemas/`, `src/ui/base/`)
4. Remove custom UI framework abstractions (`Component.js`, `bindings.js`)
5. Consolidate the extraction pipeline into a single procedural function
6. Evaluate Web Worker necessity through benchmarking
7. Keep only pure-function tests (no mocks for global state)

### Won't Do
1. Change external APIs or interfaces
2. Modify the data model (`EventSchema`, memory structures)
3. Change behavior of the extraction or retrieval logic
4. Rewrite CSS or templates
5. Add new features

## 3. Proposed Architecture

### High-Level Approach

**Principle: Data-oriented design over class-oriented design.**

Replace custom abstractions with:
- Plain functions operating on plain data
- Standard jQuery for DOM manipulation
- Single-file modules instead of directory trees
- Pure-function tests only

### Execution Strategy

All 5 phases will be designed together but executed sequentially. Each phase is independently verifiable.

**Phase Order:**
1. Test Suite Purge (safest - deletes test code only)
2. Consolidating Barrel Directories (low risk, moves code around)
3. Flattening Extraction Pipeline (moderate risk, consolidates logic)
4. Ripping Out Custom UI Abstractions (moderate risk, changes DOM bindings)
5. Web Worker Evaluation (requires benchmark first)

## 4. Data Models / Schema

No changes to data models. This refactoring preserves all existing schemas:

```javascript
// src/extraction/schemas/event-schema.js → src/extraction/structured.js
const EventSchema = z.object({
    type: z.enum(["action", "emotion", "revelation", "relationship_change"]),
    description: z.string(),
    importance: z.number().min(1).max(5),
    // ... (unchanged)
});

// src/extraction/schemas/retrieval-schema.js → src/extraction/structured.js
const RetrievalResponseSchema = z.object({
    selected_ids: z.array(z.string()),
    reasoning: z.string().optional(),
});
```

## 5. Interface / API Design

### Before: Extraction Pipeline (Over-Engineered)

```javascript
// Current: 5 files, class-based pipeline
import { ExtractionPipeline } from './extraction/pipeline.js';
const pipeline = new ExtractionPipeline(context);
await pipeline.execute(messages);
```

### After: Extraction (Simplified)

```javascript
// New: Single file, function-based
import { extractEvents } from './extraction/extract.js';
const results = await extractEvents(messages, context);
```

All logic from `message-selector`, `prompt-builder`, `llm-executor`, `event-processor`, and `result-committer` becomes inline functions within `extract.js`.

### Before: UI Components

```javascript
// Current: Extending Component base class
class MemoryList extends Component {
    constructor(el) { super(el); }
    render() { ... }
    bindEvents() { ... }
}
```

### After: UI Functions

```javascript
// New: Simple function with jQuery
function renderMemoryList(container, memories) {
    const $container = $(container);
    $container.html(memories.map(m => MemoryTemplate(m)).join(''));
    $container.on('click', '.memory-delete', handleDelete);
}
```

### Before: Utils (6 files)

```javascript
// Current: Scattered imports
import { debounce } from './utils/async.js';
import { findClosest } from './utils/dom.js';
import { getSetting } from './utils/settings.js';
```

### After: Utils (1 file)

```javascript
// New: Single import
import { debounce, findClosest, getSetting } from './utils.js';
```

## 6. Risks & Edge Cases

### Risk 1: Test Coverage Loss
**Issue:** Deleting mock-heavy tests removes coverage for integration paths.

**Mitigation:**
- Keep pure-function tests (`math.test.js`, `formatting.test.js`, `parser.test.js`)
- Manual testing in SillyTavern for integration paths
- The "deleted" tests were verifying mock calls, not real behavior

### Risk 2: Web Worker Performance Regression
**Issue:** Removing the worker may block the main thread during scoring.

**Mitigation:**
- **Benchmark phase first:** Measure scoring time for 5,000 memories
- Threshold: If scoring >16ms, keep worker; if <10ms, delete it
- Implement simple `performance.now()` measurement in `src/retrieval/scoring.js`

### Risk 3: UI Regression from jQuery Refactor
**Issue:** Removing `Component.js` may break event bindings or state management.

**Mitigation:**
- Each component refactor is self-contained
- Test in browser after each component conversion
- jQuery is well-understood and debuggable

### Risk 4: Breaking Changes During Refactor
**Issue:** Consolidating files may introduce import errors.

**Mitigation:**
- Run tests after each phase
- Use `npm test` to verify no broken imports
- Each phase is independently revertable

## 7. Phase-by-Phase Execution Plan

### Phase 1: Test Suite Purge

**Delete these files:**
- `tests/events.test.js` (~450 lines)
- `tests/listeners.test.js`
- `tests/ui-actions.test.js`
- `tests/memory-list.test.js`
- `tests/state.test.js`
- `tests/llm.test.js`
- `tests/llm-structured.test.js`
- `tests/integration/structured-extraction.test.js`
- `tests/__mocks__/` (entire directory)

**Keep these files:**
- `tests/math.test.js`
- `tests/formatting.test.js`
- `tests/parser.test.js`
- `tests/query-context.test.js`
- `tests/ui-calculations.test.js`
- `tests/scheduler.test.js`
- `tests/pov.test.js`
- `tests/retrieve.test.js`
- `tests/utils.test.js`
- `tests/embeddings.test.js`
- `tests/embeddings/strategies.test.js`
- `tests/scoring.test.js`
- `tests/constants.test.js`
- `tests/prompts.test.js`
- `tests/memory-templates.test.js`
- `tests/extraction/structured.test.js`

**Verification:** `npm test` passes with remaining tests.

### Phase 2: Consolidating Barrel Directories

**Actions:**
1. Move all functions from `src/utils/` into `src/utils.js`
2. Delete `src/utils/` directory
3. Move `EventSchema` and `RetrievalResponseSchema` into `src/extraction/structured.js`
4. Delete `src/extraction/schemas/` directory
5. Update all imports across the codebase

**Files deleted:** 8 (6 utils files, 2 schema files + directories)

**Verification:** `npm test` passes, `npm run lint` passes.

### Phase 3: Flattening Extraction Pipeline

**Actions:**
1. Read all 5 stage files into understanding
2. Inline their logic into `src/extraction/extract.js` as simple functions
3. Delete `src/extraction/pipeline.js`
4. Delete `src/extraction/stages/` directory
5. Update imports

**Files deleted:** 6 (pipeline.js + 5 stage files)

**Verification:** Manual extraction test in SillyTavern.

### Phase 4: Ripping Out Custom UI Abstractions

**Actions:**
1. Delete `src/ui/base/Component.js`
2. Delete `src/ui/base/bindings.js`
3. Delete `src/ui/base/constants.js` (inline the 3 constants)
4. Refactor `MemoryList.js` to `renderMemoryList()` function
5. Refactor `CharacterStates.js` to `renderCharacterStates()` function
6. Rewrite `src/ui/settings.js` to use raw jQuery
7. Delete `src/ui/base/` directory

**Files deleted:** 4 (Component.js, bindings.js, constants.js, base directory)

**Verification:** Test all UI interactions in SillyTavern.

### Phase 5: Web Worker Evaluation

**Actions:**
1. Add benchmark to `src/retrieval/scoring.js`:
   ```javascript
   const start = performance.now();
   // ... scoring logic ...
   const duration = performance.now() - start;
   console.log(`[OpenVault] Scoring ${memories.length} memories took ${duration.toFixed(2)}ms`);
   ```
2. Run with 5,000 memories in SillyTavern
3. If <16ms: delete `src/retrieval/worker.js` and `src/retrieval/sync-scorer.js`
4. If >16ms: keep worker implementation

**Files possibly deleted:** 2

**Verification:** Manual performance check in SillyTavern.

## 8. Success Metrics

- **File count reduction:** ~15 files deleted
- **Line count reduction:** 1,500 - 2,500 lines
- **Test suite runs:** All remaining tests pass
- **Manual verification:** Extraction and retrieval work in SillyTavern
- **No regressions:** All existing functionality preserved

## 9. Rollback Plan

Each phase creates a git commit. If any phase introduces issues:

```bash
git revert HEAD  # Rollback last phase
# Or
git checkout <previous-commit>  # Rollback to known good state
```

The refactoring is designed to be incremental and reversible.
