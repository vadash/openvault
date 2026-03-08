# Shared Utilities

## MODULES (No Barrel File — Import Explicitly)

### `logging.js`
- `log()`: Guarded by `settings.debugMode`. Auto-prefixes `[OpenVault]`.
- `logRequest()`: Detailed LLM payload debugging using `console.groupCollapsed()`.

### `data.js`
- Lazy-initializes `chatMetadata.openvault`.
- **Chat-Switch Guard**: `saveOpenVaultData(expectedChatId)` aborts save if the user switched chats during an async operation. Prevents massive cross-chat data corruption.
- `updateMemory()`: Automatically invalidates/deletes the embedding if the `summary` string changes.

### `tokens.js` (gpt-tokenizer)
- Exact token counting replacing old heuristic estimators.
- **Turn-Boundary Snapping** (`snapToTurnBoundary`): Trims message index arrays backward until it finds a valid `Bot -> User` transition or End-of-Chat. **CRITICAL**: Prevents auto-hide or batching from splitting a User message from its Bot response.

### `text.js`
- `stripThinkingTags()`: Strips `<think>`, `<reasoning>`, etc. (Case insensitive). Also handles orphaned closing tags (e.g., `</think>` without opening) from assistant prefill continuations — strips everything before and including the orphaned tag.
- `safeParseJSON()`: Multi-layer recovery. Extracts markdown codeblocks -> uses bracket-balancing to isolate JSON -> applies `jsonrepair`. Wraps bare arrays in an `{ events: [] }` object if the LLM forgot the root key.

### `st-helpers.js`
- `safeSetExtensionPrompt()`: Wraps ST's injection with try/catch.
- `yieldToMain()`: Polyfills `scheduler.yield()` with a `setTimeout(0)` fallback. Mandatory in heavy loops (communities, extraction dedup) to unfreeze the ST UI.

### `stemmer.js` & `stopwords.js`
- Language detection: Cyrillic -> Russian, Latin -> English.
- **Cyrillic Over-Stem Guard**: Snowball often over-strips Russian (e.g., `елена` -> `ел`). Guard limits stripping to max 3 chars, falling back to 1 char.
- **Entity Stemming**: `stemName()` intentionally DOES NOT filter stopwords (e.g., "The Castle" retains the "the" stem, because entity names are exact).
- **Stopwords**: Base EN+RU lists from `stopword` package only. No custom lists.