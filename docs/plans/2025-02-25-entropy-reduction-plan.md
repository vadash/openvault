# Implementation Plan - Entropy Reduction Refactoring

> **Reference:** `docs/designs/2025-02-25-entropy-reduction-design.md`
> **Execution:** Use `executing-plans` skill.
>
> **Goal:** Reduce codebase by 1,500-2,500 lines through deletion and consolidation.

## Overview

This plan executes 5 phases sequentially. Each phase is independently verifiable and revertable via git.

**Success Metrics:**
- Delete ~15 files
- Delete 1,500-2,500 lines of code
- All remaining tests pass
- Manual verification in SillyTavern

---

## Phase 1: Test Suite Purge

**Goal:** Delete mock-heavy tests that verify implementation details rather than behavior.

### Task 1.1: Delete Mock-Heavy Event Tests

**Step 1: Delete Test File**
- File: `tests/events.test.js`
- Action: Delete entire file
- Reason: ~450 lines of interaction tests requiring complex mocks

**Step 2: Verify Deletion**
- Command: `ls tests/events.test.js 2>&1 || echo "File deleted"`
- Expect: "No such file or directory"

**Step 3: Git Commit**
- Command: `git add tests/events.test.js && git commit -m "refactor: delete mock-heavy events.test.js (450 lines)"`

---

### Task 1.2: Delete Listener Tests

**Step 1: Delete Test File**
- File: `tests/listeners.test.js`
- Action: Delete entire file

**Step 2: Verify Deletion**
- Command: `git status tests/listeners.test.js`
- Expect: "deleted: tests/listeners.test.js"

**Step 3: Git Commit**
- Command: `git add tests/listeners.test.js && git commit -m "refactor: delete listeners.test.js"`

---

### Task 1.3: Delete UI Action Tests

**Step 1: Delete Test File**
- File: `tests/ui-actions.test.js`
- Action: Delete entire file

**Step 2: Verify Deletion**
- Command: `git status tests/ui-actions.test.js`
- Expect: "deleted: tests/ui-actions.test.js"

**Step 3: Git Commit**
- Command: `git add tests/ui-actions.test.js && git commit -m "refactor: delete ui-actions.test.js"`

---

### Task 1.4: Delete Memory List Tests

**Step 1: Delete Test File**
- File: `tests/memory-list.test.js`
- Action: Delete entire file
- Reason: Uses massive, brittle custom jQuery mock

**Step 2: Verify Deletion**
- Command: `git status tests/memory-list.test.js`
- Expect: "deleted: tests/memory-list.test.js"

**Step 3: Git Commit**
- Command: `git add tests/memory-list.test.js && git commit -m "refactor: delete memory-list.test.js"`

---

### Task 1.5: Delete State Tests

**Step 1: Delete Test File**
- File: `tests/state.test.js`
- Action: Delete entire file
- Reason: Testing simple boolean toggles via complex timeout mocks

**Step 2: Verify Deletion**
- Command: `git status tests/state.test.js`
- Expect: "deleted: tests/state.test.js"

**Step 3: Git Commit**
- Command: `git add tests/state.test.js && git commit -m "refactor: delete state.test.js"`

---

### Task 1.6: Delete LLM Mock Tests

**Step 1: Delete Test Files**
- Files: `tests/llm.test.js`, `tests/llm-structured.test.js`
- Action: Delete both files
- Reason: Tests only verify mock connectionManager was called

**Step 2: Verify Deletion**
- Command: `git status tests/llm*.test.js`
- Expect: "deleted: tests/llm.test.js" and "deleted: tests/llm-structured.test.js"

**Step 3: Git Commit**
- Command: `git add tests/llm.test.js tests/llm-structured.test.js && git commit -m "refactor: delete LLM mock tests"`

---

### Task 1.7: Delete Mock Integration Test

**Step 1: Delete Test Directory**
- File: `tests/integration/structured-extraction.test.js`
- Action: Delete file
- Reason: Mocking entire pipeline makes it a unit test, not integration

**Step 2: Verify Deletion**
- Command: `git status tests/integration/structured-extraction.test.js`
- Expect: "deleted: tests/integration/structured-extraction.test.js"

**Step 3: Git Commit**
- Command: `git add tests/integration/structured-extraction.test.js && git commit -m "refactor: delete mock integration test"`

---

### Task 1.8: Delete Mocks Directory

**Step 1: Delete Mocks Directory**
- Directory: `tests/__mocks__/`
- Action: Delete entire directory
- Reason: Should not need global environment mocks for pure-logic tests

**Step 2: Verify Deletion**
- Command: `ls tests/__mocks__ 2>&1 || echo "Directory deleted"`
- Expect: "No such file or directory"

**Step 3: Git Commit**
- Command: `git add tests/__mocks__ && git commit -m "refactor: delete __mocks__ directory"`

---

### Task 1.9: Verify Remaining Tests Pass

**Step 1: Run All Tests**
- Command: `npm test`
- Expect: PASS
- Note: These pure-function tests should remain: `math.test.js`, `formatting.test.js`, `parser.test.js`, `query-context.test.js`, `ui-calculations.test.js`, `scheduler.test.js`, `pov.test.js`, `retrieve.test.js`, `utils.test.js`, `embeddings.test.js`, `embeddings/strategies.test.js`, `scoring.test.js`, `constants.test.js`, `prompts.test.js`, `memory-templates.test.js`, `extraction/structured.test.js`

**Step 2: Git Commit**
- Command: `git add . && git commit -m "test: verify remaining tests pass after purge"`

---

## Phase 2: Consolidating Barrel Directories

**Goal:** Flatten `src/utils/` and `src/extraction/schemas/` into single files.

### Task 2.1: Read and Consolidate Utils

**Step 1: Read All Utils Files**
- Command:
  ```bash
  cat src/utils/async.js
  cat src/utils/dom.js
  cat src/utils/settings.js
  cat src/utils/st-helpers.js
  cat src/utils/text.js
  ```
- Purpose: Understand all exports to consolidate

**Step 2: Create Consolidated Utils**
- File: `src/utils.js`
- Action: Append all functions from subdirectory files
- Pattern:
  ```javascript
  // From async.js
  export function debounce(fn, delay) { ... }
  export function throttle(fn, limit) { ... }

  // From dom.js
  export function findClosest(element, selector) { ... }

  // From settings.js
  export function getSetting(key) { ... }
  export function setSetting(key, value) { ... }

  // etc.
  ```

**Step 3: Update All Imports**
- Command: `grep -r "from.*utils/" src/ --include="*.js"`
- Action: Replace all `from './utils/xxx'` with `from './utils'`

**Step 4: Verify**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "refactor: consolidate utils/ into single utils.js"`

---

### Task 2.2: Delete Utils Directory

**Step 1: Delete Directory**
- Directory: `src/utils/`
- Action: Delete entire directory

**Step 2: Verify**
- Command: `ls src/utils 2>&1 || echo "Directory deleted"`
- Expect: "No such file or directory"

**Step 3: Git Commit**
- Command: `git add src/utils/ && git commit -m "refactor: delete src/utils/ directory"`

---

### Task 2.3: Move Schemas to structured.js

**Step 1: Read Schema Files**
- Command:
  ```bash
  cat src/extraction/schemas/event-schema.js
  cat src/extraction/schemas/retrieval-schema.js
  ```

**Step 2: Append to structured.js**
- File: `src/extraction/structured.js`
- Action: Move schemas into this file where consumed
- Pattern:
  ```javascript
  import { z } from '../vendor/zod.js';

  export const EventSchema = z.object({
      type: z.enum(["action", "emotion", "revelation", "relationship_change"]),
      description: z.string(),
      importance: z.number().min(1).max(5),
      // ... rest of schema
  });

  export const RetrievalResponseSchema = z.object({
      selected_ids: z.array(z.string()),
      reasoning: z.string().optional(),
  });
  ```

**Step 3: Update Imports**
- Command: `grep -r "from.*schemas/" src/ --include="*.js"`
- Action: Replace imports to point to `structured.js`

**Step 4: Verify**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "refactor: move schemas into extraction/structured.js"`

---

### Task 2.4: Delete Schemas Directory

**Step 1: Delete Directory**
- Directory: `src/extraction/schemas/`
- Action: Delete entire directory

**Step 2: Verify**
- Command: `ls src/extraction/schemas 2>&1 || echo "Directory deleted"`
- Expect: "No such file or directory"

**Step 3: Git Commit**
- Command: `git add src/extraction/schemas/ && git commit -m "refactor: delete src/extraction/schemas/ directory"`

---

## Phase 3: Flattening Extraction Pipeline

**Goal:** Consolidate 5 pipeline stage files into single procedural function.

### Task 3.1: Read All Pipeline Stage Files

**Step 1: Read Pipeline and Stages**
- Command:
  ```bash
  cat src/extraction/pipeline.js
  cat src/extraction/stages/message-selector.js
  cat src/extraction/stages/prompt-builder.js
  cat src/extraction/stages/llm-executor.js
  cat src/extraction/stages/event-processor.js
  cat src/extraction/stages/result-committer.js
  ```

**Step 2: No Commit (Read Only)**
- Purpose: Understand the flow before consolidation

---

### Task 3.2: Create Simplified extract.js

**Step 1: Create New extract.js**
- File: `src/extraction/extract.js`
- Action: Write consolidated procedural function
- Pattern:
  ```javascript
  import { getContext } from '../context.js';
  import { buildExtractionPrompt } from '../prompts.js';
  import { callLLM } from '../llm/caller.js';
  import { EventSchema } from './structured.js';

  export async function extractEvents(messages, context) {
      // 1. Select messages (from message-selector)
      const recentMessages = messages.slice(-10);

      // 2. Build prompt (from prompt-builder)
      const prompt = buildExtractionPrompt(recentMessages, context);

      // 3. Execute LLM (from llm-executor)
      const response = await callLLM(prompt);

      // 4. Process events (from event-processor)
      const events = parseEvents(response);

      // 5. Commit results (from result-committer)
      return commitEvents(events, context);
  }
  ```

**Step 2: Verify No Syntax Errors**
- Command: `node -c src/extraction/extract.js`
- Expect: No syntax errors

**Step 3: Git Commit**
- Command: `git add src/extraction/extract.js && git commit -m "refactor: create consolidated extract.js"`

---

### Task 3.3: Update Pipeline Imports

**Step 1: Find All Pipeline Imports**
- Command: `grep -r "ExtractionPipeline\|from.*pipeline" src/ --include="*.js"`

**Step 2: Replace Imports**
- File: Any file importing `ExtractionPipeline`
- Action: Change to `import { extractEvents } from './extraction/extract.js'`
- Change: `new ExtractionPipeline(context).execute(messages)` → `extractEvents(messages, context)`

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "refactor: replace ExtractionPipeline with extractEvents function"`

---

### Task 3.4: Delete Pipeline Files

**Step 1: Delete Pipeline and Stages**
- Files: `src/extraction/pipeline.js`, `src/extraction/stages/` directory
- Action: Delete all

**Step 2: Verify**
- Command: `ls src/extraction/pipeline.js 2>&1 && ls src/extraction/stages 2>&1 || echo "Files deleted"`
- Expect: "No such file or directory"

**Step 3: Git Commit**
- Command: `git add src/extraction/pipeline.js src/extraction/stages/ && git commit -m "refactor: delete pipeline.js and stages/ directory"`

---

### Task 3.5: Manual Verification

**Step 1: Manual Test**
- Action: Run SillyTavern and trigger extraction
- Expect: Events are extracted correctly

**Step 2: Git Commit**
- Command: `git add . && git commit -m "test: manual verification of extraction passed"`

---

## Phase 4: Ripping Out Custom UI Abstractions

**Goal:** Remove Component.js, bindings.js, and use raw jQuery.

### Task 4.1: Read UI Base Files

**Step 1: Read Component Architecture**
- Command:
  ```bash
  cat src/ui/base/Component.js
  cat src/ui/base/bindings.js
  cat src/ui/base/constants.js
  ```

**Step 2: No Commit (Read Only)**
- Purpose: Understand patterns before removal

---

### Task 4.2: Refactor MemoryList.js

**Step 1: Read Current MemoryList**
- Command: `cat src/ui/components/MemoryList.js`

**Step 2: Rewrite as Function**
- File: `src/ui/components/MemoryList.js`
- Action: Convert from class to function
- Pattern:
  ```javascript
  import $ from 'jquery';
  import { MemoryTemplate } from '../templates/memory-templates.js';

  export function renderMemoryList(container, memories) {
      const $container = $(container);
      $container.html(memories.map(m => MemoryTemplate(m)).join(''));

      $container.on('click', '.memory-delete', function(e) {
          const id = $(this).data('id');
          // Handle delete
      });

      return $container;
  }
  ```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add src/ui/components/MemoryList.js && git commit -m "refactor: convert MemoryList to function"`

---

### Task 4.3: Refactor CharacterStates.js

**Step 1: Read Current CharacterStates**
- Command: `cat src/ui/components/CharacterStates.js`

**Step 2: Rewrite as Function**
- File: `src/ui/components/CharacterStates.js`
- Action: Convert from class to function
- Pattern:
  ```javascript
  import $ from 'jquery';

  export function renderCharacterStates(container, states) {
      const $container = $(container);
      $container.html(states.map(s => `<div class="state">${s}</div>`).join(''));
      return $container;
  }
  ```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add src/ui/components/CharacterStates.js && git commit -m "refactor: convert CharacterStates to function"`

---

### Task 4.4: Rewrite settings.js

**Step 1: Read Current Settings**
- Command: `cat src/ui/settings.js`

**Step 2: Replace bindSlider/bindCheckbox with jQuery**
- File: `src/ui/settings.js`
- Action: Remove dependency on bindings.js
- Pattern:
  ```javascript
  // Before: bindSlider('#threshold', onThresholdChange);
  // After:
  $('#threshold').on('input', function() {
      onThresholdChange(parseFloat(this.value));
  });

  // Before: bindCheckbox('#enabled', onEnabledChange);
  // After:
  $('#enabled').on('change', function() {
      onEnabledChange(this.checked);
  });
  ```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add src/ui/settings.js && git commit -m "refactor: replace bindings.js with raw jQuery"`

---

### Task 4.5: Inline Constants

**Step 1: Read Constants**
- Command: `cat src/ui/base/constants.js`

**Step 2: Inline Constants**
- File: Where constants are used
- Action: Move the 3 constants directly to their usage or `src/constants.js`

**Step 3: Delete constants.js**
- File: `src/ui/base/constants.js`
- Action: Delete file

**Step 4: Verify**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "refactor: inline constants from ui/base/constants.js"`

---

### Task 4.6: Delete UI Base Files

**Step 1: Delete Component.js and bindings.js**
- Files: `src/ui/base/Component.js`, `src/ui/base/bindings.js`
- Action: Delete both

**Step 2: Delete Directory**
- Directory: `src/ui/base/`
- Action: Delete entire directory

**Step 3: Verify**
- Command: `ls src/ui/base 2>&1 || echo "Directory deleted"`
- Expect: "No such file or directory"

**Step 4: Git Commit**
- Command: `git add src/ui/base/ && git commit -m "refactor: delete ui/base/ directory (Component.js, bindings.js)"`

---

### Task 4.7: Manual UI Verification

**Step 1: Manual Test**
- Action: Test all UI interactions in SillyTavern
- Check: Memory list, character states, settings controls
- Expect: All interactions work correctly

**Step 2: Git Commit**
- Command: `git add . && git commit -m "test: manual UI verification passed"`

---

## Phase 5: Web Worker Evaluation

**Goal:** Benchmark and potentially remove Web Worker complexity.

### Task 5.1: Add Scoring Benchmark

**Step 1: Read Current Scoring**
- Command: `cat src/retrieval/scoring.js`

**Step 2: Add Benchmark Code**
- File: `src/retrieval/scoring.js`
- Action: Add timing instrumentation
- Pattern:
  ```javascript
  export function scoreMemories(query, memories) {
      const start = performance.now();

      // ... existing scoring logic ...

      const duration = performance.now() - start;
      console.log(`[OpenVault] Scoring ${memories.length} memories took ${duration.toFixed(2)}ms`);

      return scores;
  }
  ```

**Step 3: Git Commit**
- Command: `git add src/retrieval/scoring.js && git commit -m "feat: add scoring performance benchmark"`

---

### Task 5.2: Manual Benchmark Test

**Step 1: Run Benchmark**
- Action: Load SillyTavern with ~5,000 memories
- Action: Trigger retrieval and check console
- Threshold: If >16ms, keep worker; if <10ms, delete worker

**Step 2: Document Results**
- Action: Note the timing result

**Step 3: Git Commit**
- Command: `git add . && git commit -m "test: document scoring benchmark results"`

---

### Task 5.3: Delete Worker (If <16ms)

**ONLY EXECUTE IF BENCHMARK SHOWS <16ms**

**Step 1: Delete Worker Files**
- Files: `src/retrieval/worker.js`, `src/retrieval/sync-scorer.js`
- Action: Delete both

**Step 2: Update Imports**
- Command: `grep -r "from.*worker\|from.*sync-scorer" src/ --include="*.js"`
- Action: Replace with direct import from `scoring.js`

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Manual Test**
- Action: Test retrieval in SillyTavern
- Expect: No UI blocking

**Step 5: Git Commit**
- Command: `git add . && git commit -m "refactor: remove Web Worker (scoring <16ms)"`

---

### Task 5.4: Keep Worker (If >16ms)

**ONLY EXECUTE IF BENCHMARK SHOWS >16ms**

**Step 1: Document Decision**
- Action: Add comment explaining why worker is kept
- File: `src/retrieval/scoring.js`
- Add: `// Web Worker kept: scoring takes >16ms for 5000 memories`

**Step 2: Git Commit**
- Command: `git add src/retrieval/scoring.js && git commit -m "docs: document Web Worker necessity (scoring >16ms)"`

---

## Final Verification

### Task Final.1: Count Lines Reduced

**Step 1: Count Lines Before**
- Command:
  ```bash
  git show HEAD~14:src --stat 2>/dev/null || echo "Check earlier commit"
  # Alternative: use git log to find pre-refactor commit
  ```

**Step 2: Count Current Lines**
- Command: `find src -name "*.js" -exec wc -l {} + | tail -1`

**Step 3: Verify Reduction**
- Expect: 1,500-2,500 lines reduced

**Step 4: Git Commit**
- Command: `git add . && git commit -m "docs: entropy reduction complete - ~X lines removed"`

---

### Task Final.2: Final Test Suite Run

**Step 1: Run All Tests**
- Command: `npm test`
- Expect: All PASS

**Step 2: Run Linter**
- Command: `npm run lint` (if available)
- Expect: No errors

**Step 3: Git Commit**
- Command: `git add . && git commit -m "test: final verification - all tests pass"`

---

### Task Final.3: Full Manual Test

**Step 1: Manual Integration Test**
- Action: Test in SillyTavern:
  - Memory extraction
  - Memory retrieval
  - UI interactions
  - Settings changes
- Expect: All features work

**Step 2: Git Commit**
- Command: `git add . && git commit -m "test: manual integration complete - entropy reduction verified"`

---

## Rollback Commands

If any phase fails:

```bash
# Rollback last phase
git revert HEAD

# Rollback to pre-refactor state
git checkout <commit-before-phase-1>
```

Each phase commit can be independently reverted.

---

## Summary

This plan executes 5 phases:
1. **Test Suite Purge** - Delete ~8 test files (~8,000 lines)
2. **Consolidate Directories** - Flatten utils/ and schemas/
3. **Flatten Pipeline** - Consolidate 5 stage files into 1
4. **Remove UI Abstractions** - Delete Component.js, bindings.js
5. **Web Worker Evaluation** - Benchmark and possibly delete

**Estimated Impact:**
- Files deleted: ~15
- Lines removed: 1,500-2,500
- Tests retained: Pure function tests only
