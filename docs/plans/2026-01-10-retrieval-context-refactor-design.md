# Retrieval Context Refactor Design

## Problem

Functions in `src/retrieval/` suffer from parameter drilling - passing 6-9 arguments through multiple call layers:

| Function | Params |
|----------|--------|
| `selectFormatAndInject` | 9 |
| `selectRelevantMemories` | 7 |
| `selectRelevantMemoriesSimple` | 7 |
| `selectRelevantMemoriesSmart` | 6 |

Adding new context parameters requires changing signatures across the entire call stack.

## Solution

Introduce a `RetrievalContext` plain object built once at entry points, passed through the call chain.

### RetrievalContext Structure

```javascript
{
    // Chat state
    recentContext: string,    // Recent messages for BM25
    userMessages: string,     // Last 3 user messages for embedding
    chatLength: number,       // For distance scoring

    // Character context
    primaryCharacter: string, // POV character
    activeCharacters: [],     // All present characters
    headerName: string,       // "Scene" or character name

    // Token budgets (from settings)
    preFilterTokens: number,
    finalTokens: number,
    smartRetrievalEnabled: boolean,
}
```

### Function Signature Changes

| Function | Before | After |
|----------|--------|-------|
| `selectFormatAndInject` | 9 params | `(memories, data, ctx)` |
| `selectRelevantMemories` | 7 params | `(memories, ctx)` |
| `selectRelevantMemoriesSimple` | 7 params | `(memories, ctx)` |
| `selectRelevantMemoriesSmart` | 6 params | `(memories, ctx)` |

### Context Builder

Add `buildRetrievalContext(opts)` in `retrieve.js`:

```javascript
function buildRetrievalContext(opts = {}) {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
    const chat = context.chat;
    const { povCharacters, isGroupChat } = getPOVContext();

    let recentContext = chat.filter(m => !m.is_system).map(m => m.mes).join('\n');
    if (opts.pendingUserMessage) {
        recentContext += '\n\n[User is about to say]: ' + opts.pendingUserMessage;
    }

    let userMsgs = chat.filter(m => !m.is_system && m.is_user).slice(-3).map(m => m.mes);
    if (opts.pendingUserMessage) {
        userMsgs.push(opts.pendingUserMessage);
        userMsgs = userMsgs.slice(-3);
    }
    const userMessages = userMsgs.join('\n').slice(-1000);

    return {
        recentContext,
        userMessages,
        chatLength: chat.length,
        primaryCharacter: isGroupChat ? povCharacters[0] : context.name2,
        activeCharacters: getActiveCharacters(),
        headerName: isGroupChat ? povCharacters[0] : 'Scene',
        preFilterTokens: settings.retrievalPreFilterTokens || 24000,
        finalTokens: settings.retrievalFinalTokens || 12000,
        smartRetrievalEnabled: settings.smartRetrievalEnabled,
    };
}
```

## Files Changed

1. `src/retrieval/retrieve.js` - Add `buildRetrievalContext()`, update callers
2. `src/retrieval/scoring.js` - Update function signatures

## Files Unchanged

- `src/retrieval/worker.js` - keeps flat postMessage interface
- `src/retrieval/formatting.js` - takes processed data, not context
- `src/retrieval/math.js` - pure scoring math

## Testing

- Update existing tests in `tests/retrieval.test.js` for new signatures
- No new test file needed - same behavior, cleaner interface
- Manual verification: load extension, trigger retrieval, confirm injection

## Benefits

1. Adding new context params = add one field, no signature changes
2. Eliminates duplicated context-building in `retrieveAndInjectContext` and `updateInjection`
3. Easier to test - can build mock context objects
4. Self-documenting - context shape is explicit
