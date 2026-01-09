# Retrieval Context Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace parameter drilling in retrieval functions with a single `RetrievalContext` object.

**Architecture:** Create `buildRetrievalContext()` factory in retrieve.js, update scoring.js functions to accept `ctx` object instead of 6-9 individual parameters.

**Tech Stack:** JavaScript ES Modules, Vitest

---

## Task 1: Add RetrievalContext Type Definition

**Files:**
- Create: `src/retrieval/context.js`
- Test: None (type definition only)

**Step 1: Create the context module with JSDoc typedef**

```javascript
/**
 * RetrievalContext - Consolidated retrieval parameters
 *
 * @typedef {Object} RetrievalContext
 * @property {string} recentContext - Recent messages for BM25 matching
 * @property {string} userMessages - Last 3 user messages for embedding (capped at 1000 chars)
 * @property {number} chatLength - Current chat length for distance scoring
 * @property {string} primaryCharacter - POV character name
 * @property {string[]} activeCharacters - All active characters in scene
 * @property {string} headerName - Header for injection ("Scene" or character name)
 * @property {number} preFilterTokens - Stage 1 token budget
 * @property {number} finalTokens - Stage 2 token budget
 * @property {boolean} smartRetrievalEnabled - Whether to use LLM for selection
 */

export const RetrievalContext = {};
```

**Step 2: Commit**

```bash
git add src/retrieval/context.js
git commit -m "feat: add RetrievalContext type definition"
```

---

## Task 2: Update selectRelevantMemoriesSimple Signature

**Files:**
- Modify: `src/retrieval/scoring.js:159-191`
- Test: `tests/scoring.test.js`

**Step 2.1: Update test file first - change all calls to use ctx object**

Find all `selectRelevantMemoriesSimple(memories, 'context', 'user messages', 'Alice', [], 10, 100)` calls and replace with:

```javascript
const ctx = {
    recentContext: 'context',
    userMessages: 'user messages',
    primaryCharacter: 'Alice',
    activeCharacters: [],
    chatLength: 100,
    preFilterTokens: 24000,
    finalTokens: 12000,
    smartRetrievalEnabled: false,
};
// limit derived from ctx or passed separately for simple mode
await selectRelevantMemoriesSimple(memories, ctx, 10);
```

**Step 2.2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL - signature mismatch

**Step 2.3: Update function signature in scoring.js**

Change line 159 from:
```javascript
export async function selectRelevantMemoriesSimple(memories, recentContext, userMessages, characterName, activeCharacters, limit, chatLength) {
```

To:
```javascript
export async function selectRelevantMemoriesSimple(memories, ctx, limit) {
    const { recentContext, userMessages, primaryCharacter, activeCharacters, chatLength } = ctx;
```

Update internal references: `characterName` → `primaryCharacter`

**Step 2.4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

**Step 2.5: Commit**

```bash
git add src/retrieval/scoring.js tests/scoring.test.js
git commit -m "refactor: update selectRelevantMemoriesSimple to use RetrievalContext"
```

---

## Task 3: Update selectRelevantMemoriesSmart Signature

**Files:**
- Modify: `src/retrieval/scoring.js:194-257`
- Test: `tests/scoring.test.js`

**Step 3.1: Update test calls**

Change from:
```javascript
selectRelevantMemoriesSmart(memories, 'context', 'user messages', 'Alice', 10, 100)
```

To:
```javascript
selectRelevantMemoriesSmart(memories, ctx, 10)
```

**Step 3.2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL

**Step 3.3: Update function signature**

Change line 194 from:
```javascript
export async function selectRelevantMemoriesSmart(memories, recentContext, userMessages, characterName, limit, chatLength) {
```

To:
```javascript
export async function selectRelevantMemoriesSmart(memories, ctx, limit) {
    const { recentContext, userMessages, primaryCharacter, chatLength } = ctx;
```

Update internal references: `characterName` → `primaryCharacter`

**Step 3.4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

**Step 3.5: Commit**

```bash
git add src/retrieval/scoring.js tests/scoring.test.js
git commit -m "refactor: update selectRelevantMemoriesSmart to use RetrievalContext"
```

---

## Task 4: Update selectRelevantMemories Dispatcher

**Files:**
- Modify: `src/retrieval/scoring.js:260-302`
- Test: `tests/scoring.test.js`

**Step 4.1: Update test calls**

Change from:
```javascript
selectRelevantMemories(memories, 'context', 'user messages', 'Alice', [], settings, 100)
```

To:
```javascript
const ctx = {
    recentContext: 'context',
    userMessages: 'user messages',
    primaryCharacter: 'Alice',
    activeCharacters: [],
    chatLength: 100,
    preFilterTokens: settings.retrievalPreFilterTokens || 24000,
    finalTokens: settings.retrievalFinalTokens || 12000,
    smartRetrievalEnabled: settings.smartRetrievalEnabled,
};
selectRelevantMemories(memories, ctx)
```

**Step 4.2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL

**Step 4.3: Update function signature**

Change line 260 from:
```javascript
export async function selectRelevantMemories(memories, recentContext, userMessages, characterName, activeCharacters, settings, chatLength) {
```

To:
```javascript
export async function selectRelevantMemories(memories, ctx) {
    const { preFilterTokens, finalTokens, smartRetrievalEnabled } = ctx;
```

Update internal calls to `selectRelevantMemoriesSimple` and `selectRelevantMemoriesSmart` to pass `ctx`.

**Step 4.4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

**Step 4.5: Commit**

```bash
git add src/retrieval/scoring.js tests/scoring.test.js
git commit -m "refactor: update selectRelevantMemories to use RetrievalContext"
```

---

## Task 5: Add buildRetrievalContext Factory

**Files:**
- Modify: `src/retrieval/retrieve.js`
- Test: `tests/retrieve.test.js`

**Step 5.1: Write failing test for buildRetrievalContext**

Add to tests/retrieve.test.js:

```javascript
import { buildRetrievalContext } from '../src/retrieval/retrieve.js';

describe('buildRetrievalContext', () => {
    it('builds context from current state', () => {
        mockContext.chat = [
            { mes: 'Hello', is_user: true, is_system: false },
            { mes: 'Hi!', is_user: false, is_system: false },
        ];
        getPOVContext.mockReturnValue({ povCharacters: ['Alice'], isGroupChat: false });
        getActiveCharacters.mockReturnValue(['Alice', 'Bob']);

        const ctx = buildRetrievalContext();

        expect(ctx.recentContext).toContain('Hello');
        expect(ctx.recentContext).toContain('Hi!');
        expect(ctx.userMessages).toContain('Hello');
        expect(ctx.chatLength).toBe(2);
        expect(ctx.primaryCharacter).toBe('Alice');
        expect(ctx.activeCharacters).toEqual(['Alice', 'Bob']);
        expect(ctx.headerName).toBe('Scene');
        expect(ctx.preFilterTokens).toBe(24000);
        expect(ctx.finalTokens).toBe(12000);
    });

    it('includes pending user message when provided', () => {
        mockContext.chat = [
            { mes: 'Hello', is_user: true, is_system: false },
        ];
        getPOVContext.mockReturnValue({ povCharacters: ['Alice'], isGroupChat: false });

        const ctx = buildRetrievalContext({ pendingUserMessage: 'What about that?' });

        expect(ctx.recentContext).toContain('[User is about to say]: What about that?');
        expect(ctx.userMessages).toContain('What about that?');
    });

    it('uses character name as header in group chat', () => {
        getPOVContext.mockReturnValue({ povCharacters: ['Bob', 'Alice'], isGroupChat: true });

        const ctx = buildRetrievalContext();

        expect(ctx.primaryCharacter).toBe('Bob');
        expect(ctx.headerName).toBe('Bob');
    });
});
```

**Step 5.2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL - buildRetrievalContext not exported

**Step 5.3: Implement buildRetrievalContext**

Add after line 26 in retrieve.js:

```javascript
/**
 * Build retrieval context from current state
 * @param {Object} opts - Options
 * @param {string} [opts.pendingUserMessage] - User message not yet in chat
 * @returns {import('./context.js').RetrievalContext}
 */
export function buildRetrievalContext(opts = {}) {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
    const chat = context.chat || [];
    const { povCharacters, isGroupChat } = getPOVContext();

    // Build recent context (all non-system messages)
    let recentContext = chat.filter(m => !m.is_system).map(m => m.mes).join('\n');
    if (opts.pendingUserMessage) {
        recentContext += '\n\n[User is about to say]: ' + opts.pendingUserMessage;
    }

    // Build user messages for embedding (last 3 user messages, capped at 1000 chars)
    let userMsgs = chat.filter(m => !m.is_system && m.is_user).slice(-3).map(m => m.mes);
    if (opts.pendingUserMessage) {
        userMsgs.push(opts.pendingUserMessage);
        userMsgs = userMsgs.slice(-3);
    }
    const userMessages = userMsgs.join('\n').slice(-1000);

    const primaryCharacter = isGroupChat ? povCharacters[0] : context.name2;

    return {
        recentContext,
        userMessages,
        chatLength: chat.length,
        primaryCharacter,
        activeCharacters: getActiveCharacters(),
        headerName: isGroupChat ? povCharacters[0] : 'Scene',
        preFilterTokens: settings.retrievalPreFilterTokens || 24000,
        finalTokens: settings.retrievalFinalTokens || 12000,
        smartRetrievalEnabled: settings.smartRetrievalEnabled,
    };
}
```

**Step 5.4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

**Step 5.5: Commit**

```bash
git add src/retrieval/retrieve.js tests/retrieve.test.js
git commit -m "feat: add buildRetrievalContext factory function"
```

---

## Task 6: Update selectFormatAndInject

**Files:**
- Modify: `src/retrieval/retrieve.js:66-107`
- Test: `tests/retrieve.test.js`

**Step 6.1: Update function signature**

Change from:
```javascript
async function selectFormatAndInject(memoriesToUse, data, recentMessages, userMessages, primaryCharacter, activeCharacters, headerName, settings, chatLength) {
```

To:
```javascript
async function selectFormatAndInject(memoriesToUse, data, ctx) {
    const { primaryCharacter, activeCharacters, headerName, finalTokens, chatLength } = ctx;
```

Update the call to `selectRelevantMemories`:
```javascript
const relevantMemories = await selectRelevantMemories(memoriesToUse, ctx);
```

Update call to `formatContextForInjection` to use `finalTokens` from ctx.

**Step 6.2: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (internal function, tests mock it)

**Step 6.3: Commit**

```bash
git add src/retrieval/retrieve.js
git commit -m "refactor: update selectFormatAndInject to use RetrievalContext"
```

---

## Task 7: Update retrieveAndInjectContext

**Files:**
- Modify: `src/retrieval/retrieve.js:110-188`
- Test: `tests/retrieve.test.js`

**Step 7.1: Simplify retrieveAndInjectContext to use buildRetrievalContext**

Replace the manual context building (lines ~130-165) with:

```javascript
const ctx = buildRetrievalContext();
```

Update the call to selectFormatAndInject:
```javascript
const result = await selectFormatAndInject(memoriesToUse, data, ctx);
```

**Step 7.2: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

**Step 7.3: Commit**

```bash
git add src/retrieval/retrieve.js
git commit -m "refactor: simplify retrieveAndInjectContext with buildRetrievalContext"
```

---

## Task 8: Update updateInjection

**Files:**
- Modify: `src/retrieval/retrieve.js:190-250`
- Test: `tests/retrieve.test.js`

**Step 8.1: Simplify updateInjection to use buildRetrievalContext**

Replace manual context building with:

```javascript
const ctx = buildRetrievalContext({ pendingUserMessage });
```

**Step 8.2: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

**Step 8.3: Commit**

```bash
git add src/retrieval/retrieve.js
git commit -m "refactor: simplify updateInjection with buildRetrievalContext"
```

---

## Task 9: Final Verification

**Step 9.1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

**Step 9.2: Run linting**

```bash
npm run lint
```

Expected: No errors

**Step 9.3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: cleanup after retrieval context refactor"
```

---

## Summary

| Before | After |
|--------|-------|
| `selectFormatAndInject(9 params)` | `selectFormatAndInject(memories, data, ctx)` |
| `selectRelevantMemories(7 params)` | `selectRelevantMemories(memories, ctx)` |
| `selectRelevantMemoriesSimple(7 params)` | `selectRelevantMemoriesSimple(memories, ctx, limit)` |
| `selectRelevantMemoriesSmart(6 params)` | `selectRelevantMemoriesSmart(memories, ctx, limit)` |
| Duplicated context building | Single `buildRetrievalContext()` factory |
