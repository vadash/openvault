# Remove Relationship Counters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove trust/tension counters, relationship type tracking, and decay system from OpenVault.

**Architecture:** Delete `simulation.js` entirely. Remove `updateRelationshipsFromEvents` from parser. Simplify formatting to show "Present: X, Y" instead of relationship classifications. Keep character state tracking (emotions) intact.

**Tech Stack:** JavaScript ES Modules, Vitest for testing

---

## Task 1: Remove Relationship Constants

**Files:**
- Modify: `src/constants.js:47-50`

**Step 1: Remove decay constants from defaultSettings**

Remove these lines from `defaultSettings`:
```javascript
// Before (lines 47-50):
    relationshipDecayInterval: 50,
    tensionDecayRate: 0.5,
    trustDecayRate: 0.1,

// After: (delete the 3 lines above entirely)
```

**Step 2: Run tests**

```bash
npm test
```

Expected: Some tests fail (simulation.js imports these)

**Step 3: Commit**

```bash
git add src/constants.js
git commit -m "chore: remove relationship decay constants"
```

---

## Task 2: Delete Simulation Module

**Files:**
- Delete: `src/simulation.js`

**Step 1: Delete the file**

```bash
rm src/simulation.js
```

**Step 2: Run tests**

```bash
npm test
```

Expected: Fails - result-committer.js imports from simulation.js

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete simulation.js (relationship decay)"
```

---

## Task 3: Update Result Committer

**Files:**
- Modify: `src/extraction/stages/result-committer.js`

**Step 1: Remove simulation import and relationship calls**

```javascript
// Before (lines 1-15):
import { MEMORIES_KEY, LAST_PROCESSED_KEY } from '../../constants.js';
import { saveOpenVaultData, log } from '../../utils.js';
import { updateCharacterStatesFromEvents, updateRelationshipsFromEvents } from '../parser.js';
import { applyRelationshipDecay } from '../../simulation.js';

// After:
import { MEMORIES_KEY, LAST_PROCESSED_KEY } from '../../constants.js';
import { saveOpenVaultData, log } from '../../utils.js';
import { updateCharacterStatesFromEvents } from '../parser.js';
```

**Step 2: Remove relationship update and decay calls from commitResults**

```javascript
// Before (lines 25-35):
        // Update character states and relationships
        updateCharacterStatesFromEvents(events, data);
        updateRelationshipsFromEvents(events, data);
    }

    // Update last processed message ID
    data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);

    // Apply relationship decay based on message intervals
    applyRelationshipDecay(data, maxId);

// After:
        // Update character states
        updateCharacterStatesFromEvents(events, data);
    }

    // Update last processed message ID
    data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);
```

**Step 3: Run tests**

```bash
npm test
```

Expected: Fails - parser.js still exports updateRelationshipsFromEvents

**Step 4: Commit**

```bash
git add src/extraction/stages/result-committer.js
git commit -m "refactor: remove relationship update and decay from result-committer"
```

---

## Task 4: Remove Relationship Logic from Parser

**Files:**
- Modify: `src/extraction/parser.js`

**Step 1: Remove RELATIONSHIPS_KEY import**

```javascript
// Before (line 7):
import { CHARACTERS_KEY, RELATIONSHIPS_KEY } from '../constants.js';

// After:
import { CHARACTERS_KEY } from '../constants.js';
```

**Step 2: Delete entire updateRelationshipsFromEvents function**

Delete lines 103-161 (the entire `updateRelationshipsFromEvents` function).

**Step 3: Run tests**

```bash
npm test
```

Expected: Fails - parser.test.js tests this function

**Step 4: Commit**

```bash
git add src/extraction/parser.js
git commit -m "refactor: remove updateRelationshipsFromEvents from parser"
```

---

## Task 5: Update Parser Tests

**Files:**
- Modify: `tests/parser.test.js`

**Step 1: Remove updateRelationshipsFromEvents import**

```javascript
// Before (lines 6-10):
import {
    parseExtractionResult,
    updateCharacterStatesFromEvents,
    updateRelationshipsFromEvents,
} from '../src/extraction/parser.js';

// After:
import {
    parseExtractionResult,
    updateCharacterStatesFromEvents,
} from '../src/extraction/parser.js';
```

**Step 2: Remove RELATIONSHIPS_KEY import if not used elsewhere**

Check if RELATIONSHIPS_KEY is still needed. If only used in relationship tests, remove from import.

**Step 3: Delete entire `describe('updateRelationshipsFromEvents')` block**

Delete the test block starting at approximately line 268 through line 456.

**Step 4: Run tests**

```bash
npm test
```

Expected: Passes (relationship tests removed)

**Step 5: Commit**

```bash
git add tests/parser.test.js
git commit -m "test: remove relationship update tests"
```

---

## Task 6: Update Formatting - Remove Relationship Classification

**Files:**
- Modify: `src/retrieval/formatting.js`

**Step 1: Remove RELATIONSHIPS_KEY import**

```javascript
// Before (line 7):
import { RELATIONSHIPS_KEY } from '../constants.js';

// After:
// (delete this import line entirely)
```

**Step 2: Delete getRelationshipContext function**

Delete the entire function at lines 148-181.

**Step 3: Modify formatRelationships helper to show "Present: X, Y"**

```javascript
// Before (lines 220-230):
    // Helper to format relationships
    const formatRelationships = () => {
        if (!relationships || relationships.length === 0) return [];

        const relLines = ['Relationships with present characters:'];
        for (const rel of relationships) {
            const trustDesc = rel.trust >= 7 ? 'high trust' : rel.trust <= 3 ? 'low trust' : 'moderate trust';
            const tensionDesc = rel.tension >= 7 ? 'high tension' : rel.tension >= 4 ? 'some tension' : '';
            relLines.push(`- ${rel.character}: ${rel.type || 'acquaintance'} (${trustDesc}${tensionDesc ? ', ' + tensionDesc : ''})`);
        }
        return relLines;
    };

// After:
    // Helper to format present characters
    const formatPresent = () => {
        if (!presentCharacters || presentCharacters.length === 0) return null;
        return `Present: ${presentCharacters.join(', ')}`;
    };
```

**Step 4: Update function signature to accept presentCharacters instead of relationships**

```javascript
// Before:
export function formatContextForInjection(memories, relationships, emotionalInfo, characterName, tokenBudget, chatLength = 0) {

// After:
export function formatContextForInjection(memories, presentCharacters, emotionalInfo, characterName, tokenBudget, chatLength = 0) {
```

**Step 5: Update usage of formatRelationships to formatPresent**

Replace `relLines` variable usage throughout with simple `presentLine`:

```javascript
// Before:
    const relLines = formatRelationships();
    const hasRecentContent = buckets.recent.length > 0 || emotionalLine || relLines.length > 0;
    // ... later ...
    if (relLines.length > 0) overheadTokens += estimateTokens(relLines.join('\n'));
    // ... later ...
    if (relLines.length > 0) {
        lines.push(...relLines);
    }

// After:
    const presentLine = formatPresent();
    const hasRecentContent = buckets.recent.length > 0 || emotionalLine || presentLine;
    // ... later ...
    if (presentLine) overheadTokens += estimateTokens(presentLine);
    // ... later ...
    if (presentLine) {
        lines.push(presentLine);
    }
```

**Step 6: Run tests**

```bash
npm test
```

Expected: Fails - formatting.test.js expects old format

**Step 7: Commit**

```bash
git add src/retrieval/formatting.js
git commit -m "refactor: replace relationship classification with simple Present line"
```

---

## Task 7: Update Retrieve Module

**Files:**
- Modify: `src/retrieval/retrieve.js`

**Step 1: Remove getRelationshipContext import**

```javascript
// Before (line 13):
import { getRelationshipContext, formatContextForInjection } from './formatting.js';

// After:
import { formatContextForInjection } from './formatting.js';
```

**Step 2: Replace relationship context with present characters list**

```javascript
// Before (lines 111-122):
    // Get relationship and emotional context
    const relationshipContext = getRelationshipContext(data, primaryCharacter, activeCharacters);
    const primaryCharState = data[CHARACTERS_KEY]?.[primaryCharacter];
    const emotionalInfo = {
        emotion: primaryCharState?.current_emotion || 'neutral',
        fromMessages: primaryCharState?.emotion_from_messages || null,
    };

    // Format and inject
    const formattedContext = formatContextForInjection(
        relevantMemories,
        relationshipContext,
        emotionalInfo,

// After:
    // Get emotional context
    const primaryCharState = data[CHARACTERS_KEY]?.[primaryCharacter];
    const emotionalInfo = {
        emotion: primaryCharState?.current_emotion || 'neutral',
        fromMessages: primaryCharState?.emotion_from_messages || null,
    };

    // Get present characters (excluding POV)
    const presentCharacters = activeCharacters.filter(c => c !== primaryCharacter);

    // Format and inject
    const formattedContext = formatContextForInjection(
        relevantMemories,
        presentCharacters,
        emotionalInfo,
```

**Step 3: Run tests**

```bash
npm test
```

Expected: May still fail due to formatting tests

**Step 4: Commit**

```bash
git add src/retrieval/retrieve.js
git commit -m "refactor: pass present characters instead of relationship context"
```

---

## Task 8: Update Formatting Tests

**Files:**
- Modify: `tests/formatting.test.js`

**Step 1: Remove getRelationshipContext tests**

Delete the entire `describe('getRelationshipContext')` block (approximately lines 30-130).

**Step 2: Update formatContextForInjection tests to use presentCharacters**

For each test that passes `relationships` array, convert to simple string array:

```javascript
// Before:
const relationships = [
    { character: 'Bob', trust: 8, tension: 2, type: 'friend' },
];
const result = formatContextForInjection(memories, relationships, null, 'Alice', 10000, 500);
expect(result).toContain('Relationships with present characters:');
expect(result).toContain('- Bob: friend (high trust)');

// After:
const presentCharacters = ['Bob'];
const result = formatContextForInjection(memories, presentCharacters, null, 'Alice', 10000, 500);
expect(result).toContain('Present: Bob');
```

**Step 3: Delete trust/tension description tests**

Delete tests:
- `it('describes trust levels correctly')`
- `it('describes tension levels correctly')`
- `it('defaults relationship type to acquaintance')`

**Step 4: Update narrative engine integration test**

Update the test at approximately line 783 to use `presentCharacters`:

```javascript
// Before:
const relationships = [
    { character: 'Goblin', trust: 1, tension: 9, type: 'enemy' },
];
// ...
expect(result).toContain('Goblin: enemy (low trust, high tension)');

// After:
const presentCharacters = ['Goblin'];
// ...
expect(result).toContain('Present: Goblin');
```

**Step 5: Run tests**

```bash
npm test
```

Expected: Passes

**Step 6: Commit**

```bash
git add tests/formatting.test.js
git commit -m "test: update formatting tests for simplified Present line"
```

---

## Task 9: Remove buildRelationshipData from UI Calculations

**Files:**
- Modify: `src/ui/calculations.js`
- Modify: `tests/ui-calculations.test.js`

**Step 1: Delete buildRelationshipData function**

Delete lines 95-110 from `src/ui/calculations.js`.

**Step 2: Remove buildRelationshipData from test import**

```javascript
// Before (line 11):
    buildRelationshipData,

// After: (delete this line)
```

**Step 3: Delete buildRelationshipData test block**

Delete the `describe('buildRelationshipData')` block (approximately lines 231-261).

**Step 4: Run tests**

```bash
npm test
```

Expected: Passes

**Step 5: Commit**

```bash
git add src/ui/calculations.js tests/ui-calculations.test.js
git commit -m "refactor: remove buildRelationshipData from UI calculations"
```

---

## Task 10: Clean Up - Remove RELATIONSHIPS_KEY If Unused

**Files:**
- Possibly modify: `src/constants.js`
- Possibly modify: Various test files

**Step 1: Check if RELATIONSHIPS_KEY is still used anywhere**

```bash
grep -r "RELATIONSHIPS_KEY" src/ tests/
```

**Step 2: If no usages remain, remove from constants.js**

```javascript
// Remove this line if unused:
export const RELATIONSHIPS_KEY = 'relationships';
```

**Step 3: Remove from any test mock files that import it**

**Step 4: Run tests**

```bash
npm test
```

Expected: All 500+ tests pass (minus removed tests)

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: remove unused RELATIONSHIPS_KEY constant"
```

---

## Task 11: Final Verification

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

**Step 2: Run linter**

```bash
npm run lint
```

Expected: No errors

**Step 3: Verify no dangling imports**

```bash
grep -r "simulation" src/
grep -r "updateRelationshipsFromEvents" src/
grep -r "getRelationshipContext" src/
grep -r "buildRelationshipData" src/
grep -r "trust_level\|tension_level" src/
```

Expected: No matches

**Step 4: Commit any fixes**

**Step 5: Squash or clean up commits (optional)**

```bash
git log --oneline -15
```

Review commits, optionally squash into logical groups.

---

## Summary

After all tasks complete:
- **Deleted:** `src/simulation.js`
- **Removed:** `updateRelationshipsFromEvents`, `getRelationshipContext`, `buildRelationshipData`
- **Removed:** Trust/tension counters, relationship_type field, decay constants
- **Changed:** Scene output now shows `Present: Alice, Bob` instead of relationship classifications
- **Tests:** Updated to match new behavior
