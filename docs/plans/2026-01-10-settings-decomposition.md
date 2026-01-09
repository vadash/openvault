# Settings.js Decomposition Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `src/ui/settings.js` into focused modules for better maintainability.

**Architecture:** Extract binding utilities to `src/ui/base/bindings.js` and debug functions to `src/ui/debug.js`. Keep orchestration in `settings.js`.

**Tech Stack:** ES Modules, jQuery, browser APIs.

---

## Task 1: Create `src/ui/base/bindings.js`

**Files:**
- Create: `src/ui/base/bindings.js`

**Step 1: Create bindings.js with extracted utilities**

```javascript
/**
 * Generic DOM↔Settings Binding Utilities
 *
 * Reusable functions for binding form elements to extension settings.
 */

import { getDeps } from '../../deps.js';
import { extensionName } from '../../constants.js';

/**
 * Convert tokens to approximate word count
 * @param {number} tokens - Token count
 * @returns {number} Approximate word count
 */
function tokensToWords(tokens) {
    return Math.round(tokens * 0.75);
}

/**
 * Update word count display for a token slider
 * @param {number} tokens - Token value
 * @param {string} wordsElementId - ID of the words span element
 */
export function updateWordsDisplay(tokens, wordsElementId) {
    $(`#${wordsElementId}`).text(tokensToWords(tokens));
}

/**
 * Bind a checkbox to a boolean setting
 * @param {string} elementId - jQuery selector for the checkbox
 * @param {string} settingKey - Key in settings object
 * @param {Function} onChange - Optional callback after value change
 */
export function bindCheckbox(elementId, settingKey, onChange) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = $(this).is(':checked');
        getDeps().saveSettingsDebounced();
        if (onChange) onChange();
    });
}

/**
 * Bind a slider (range input) to a numeric setting
 * @param {string} elementId - jQuery selector for the slider
 * @param {string} settingKey - Key in settings object
 * @param {string} displayId - Element ID to show the value (optional)
 * @param {Function} onChange - Optional callback after value change
 * @param {string} wordsId - Element ID to show word count (optional)
 * @param {boolean} isFloat - Use parseFloat instead of parseInt (optional)
 */
export function bindSlider(elementId, settingKey, displayId, onChange, wordsId, isFloat = false) {
    $(`#${elementId}`).on('input', function() {
        const value = isFloat ? parseFloat($(this).val()) : parseInt($(this).val());
        getDeps().getExtensionSettings()[extensionName][settingKey] = value;
        if (displayId) {
            $(`#${displayId}`).text(value);
        }
        if (wordsId) {
            updateWordsDisplay(value, wordsId);
        }
        getDeps().saveSettingsDebounced();
        if (onChange) onChange(value);
    });
}

/**
 * Bind a text input to a string setting
 * @param {string} elementId - jQuery selector for the input
 * @param {string} settingKey - Key in settings object
 * @param {Function} transform - Optional transform function (e.g., trim)
 */
export function bindTextInput(elementId, settingKey, transform = (v) => v) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = transform($(this).val());
        getDeps().saveSettingsDebounced();
    });
}

/**
 * Bind a number input to a numeric setting
 * @param {string} elementId - jQuery selector for the input
 * @param {string} settingKey - Key in settings object
 * @param {Function} validator - Optional validator function that returns the validated value
 */
export function bindNumberInput(elementId, settingKey, validator) {
    $(`#${elementId}`).on('change', function() {
        let value = $(this).val();
        if (validator) value = validator(value);
        getDeps().getExtensionSettings()[extensionName][settingKey] = value;
        $(this).val(value);
        getDeps().saveSettingsDebounced();
    });
}

/**
 * Bind a select dropdown to a setting
 * @param {string} elementId - jQuery selector for the select
 * @param {string} settingKey - Key in settings object
 * @param {Function} onChange - Optional callback after value change
 */
export function bindSelect(elementId, settingKey, onChange) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = $(this).val();
        getDeps().saveSettingsDebounced();
        if (onChange) onChange($(this).val());
    });
}

/**
 * Bind a button click handler
 * @param {string} elementId - jQuery selector for the button
 * @param {Function} handler - Click handler function
 */
export function bindButton(elementId, handler) {
    $(`#${elementId}`).on('click', handler);
}
```

**Step 2: Commit bindings.js**

```bash
git add src/ui/base/bindings.js
git commit -m "refactor: extract binding utilities to src/ui/base/bindings.js"
```

---

## Task 2: Create `src/ui/debug.js`

**Files:**
- Create: `src/ui/debug.js`

**Step 1: Create debug.js with extracted functions**

```javascript
/**
 * OpenVault Debug Utilities
 *
 * Diagnostic and connection testing functions for settings panel.
 */

import { getDeps } from '../deps.js';
import { MEMORIES_KEY } from '../constants.js';
import { getOpenVaultData, showToast } from '../utils.js';
import { getEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { scoreMemories } from '../retrieval/math.js';
import { getScoringParams } from '../retrieval/scoring.js';
import { parseRecentMessages, extractQueryContext, buildBM25Tokens, buildEmbeddingQuery } from '../retrieval/query-context.js';

/**
 * Test Ollama connection
 */
export async function testOllamaConnection() {
    const $btn = $('#openvault_test_ollama_btn');
    const url = $('#openvault_ollama_url').val().trim();

    if (!url) {
        $btn.removeClass('success').addClass('error');
        $btn.html('<i class="fa-solid fa-xmark"></i> No URL');
        return;
    }

    $btn.removeClass('success error');
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Testing...');

    try {
        const response = await fetch(`${url}/api/tags`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            $btn.removeClass('error').addClass('success');
            $btn.html('<i class="fa-solid fa-check"></i> Connected');
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (err) {
        $btn.removeClass('success').addClass('error');
        $btn.html('<i class="fa-solid fa-xmark"></i> Failed');
        console.error('[OpenVault] Ollama test failed:', err);
    }

    // Reset button after 3 seconds
    setTimeout(() => {
        $btn.removeClass('success error');
        $btn.html('<i class="fa-solid fa-plug"></i> Test');
    }, 3000);
}

/**
 * Calculate and copy all memory weights to clipboard with detailed breakdown
 */
export async function copyMemoryWeights() {
    const $btn = $('#openvault_copy_weights_btn');
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Calculating...');

    try {
        const data = getOpenVaultData();
        if (!data || !data[MEMORIES_KEY] || data[MEMORIES_KEY].length === 0) {
            showToast('warning', 'No memories to score');
            $btn.html('<i class="fa-solid fa-copy"></i> Copy Memory Weights');
            return;
        }

        const context = getDeps().getContext();
        const chat = context.chat || [];
        const chatLength = chat.length;
        const memories = data[MEMORIES_KEY];

        // Build recent context for query extraction (same as real retrieval)
        const recentContext = chat.slice(-10).map(m => m.mes).join('\n');
        const recentMessages = parseRecentMessages(recentContext, 10);
        const queryContext = extractQueryContext(recentMessages, []);

        // Get user messages for embedding and BM25 (same as real retrieval)
        const recentUserMessages = chat.filter(m => !m.is_system && m.is_user).slice(-3);
        const userMessages = recentUserMessages.map(m => m.mes).join('\n');

        // Build embedding query from user messages only (intent matching)
        const userMessagesForEmbedding = parseRecentMessages(userMessages, 3);
        const embeddingQuery = buildEmbeddingQuery(userMessagesForEmbedding, queryContext);

        const bm25Tokens = buildBM25Tokens(userMessages, queryContext);

        // Get embedding for the actual query (not raw user messages)
        let contextEmbedding = null;
        if (isEmbeddingsEnabled() && embeddingQuery) {
            contextEmbedding = await getEmbedding(embeddingQuery);
        }

        // Score all memories using shared params
        const { constants, settings: scoringSettings } = getScoringParams();
        const scored = scoreMemories(memories, contextEmbedding, chatLength, constants, scoringSettings, bm25Tokens);

        // Build header with ACTUAL query context used for retrieval
        const queryExcerpt = embeddingQuery;
        const tokensDisplay = bm25Tokens.slice(0, 20).join(', ');
        const tokensTruncated = bm25Tokens.length > 20 ? `... (+${bm25Tokens.length - 20} more)` : '';

        const header = `=== OpenVault Memory Debug Info ===
Embedding Query (user-only): "${queryExcerpt}"
BM25 Keywords: [${tokensDisplay}${tokensTruncated}]

Memory Scores:
${'━'.repeat(60)}`;

        // Format each memory with breakdown tree (sorted by score descending)
        const memoryLines = scored.map(({ memory, score, breakdown }) => {
            const stars = '★'.repeat(breakdown.importance || 3) + '☆'.repeat(5 - (breakdown.importance || 3));
            const lines = [
                `[${score.toFixed(1)}] [${stars}] ${memory.summary}`,
                `  ├─ Base: ${breakdown.baseAfterFloor.toFixed(1)} (importance ${breakdown.importance})`
            ];

            // Recency penalty (negative if floor was applied, positive otherwise)
            if (breakdown.recencyPenalty > 0) {
                lines.push(`  ├─ Floor bonus: +${breakdown.recencyPenalty.toFixed(1)} (importance 5 floor applied)`);
            } else if (breakdown.recencyPenalty < 0) {
                lines.push(`  ├─ Recency penalty: ${breakdown.recencyPenalty.toFixed(1)} (distance ${breakdown.distance})`);
            } else {
                lines.push(`  ├─ Recency: 0.0 (distance ${breakdown.distance})`);
            }

            // Vector similarity
            if (breakdown.vectorSimilarity > 0) {
                lines.push(`  ├─ Vector similarity: +${breakdown.vectorBonus.toFixed(1)} (sim ${breakdown.vectorSimilarity.toFixed(2)})`);
            } else {
                lines.push(`  ├─ Vector similarity: +0.0 (below threshold)`);
            }

            // BM25 keywords
            if (breakdown.bm25Score > 0) {
                lines.push(`  └─ BM25 keywords: +${breakdown.bm25Bonus.toFixed(1)} (score ${breakdown.bm25Score.toFixed(2)})`);
            } else {
                lines.push(`  └─ BM25 keywords: +0.0 (no matches)`);
            }

            return lines.join('\n');
        });

        const footer = `${'━'.repeat(60)}
Total: ${scored.length} memories
Settings: vectorWeight=${scoringSettings.vectorSimilarityWeight}, keywordWeight=${scoringSettings.keywordMatchWeight ?? 1.0}, threshold=${scoringSettings.vectorSimilarityThreshold}`;

        const output = [header, ...memoryLines, footer].join('\n');

        await navigator.clipboard.writeText(output);
        showToast('success', `Copied ${scored.length} memories with debug info`);
        $btn.html('<i class="fa-solid fa-check"></i> Copied!');
    } catch (err) {
        console.error('[OpenVault] Copy weights failed:', err);
        showToast('error', 'Failed to copy weights');
        $btn.html('<i class="fa-solid fa-xmark"></i> Failed');
    }

    setTimeout(() => {
        $btn.html('<i class="fa-solid fa-copy"></i> Copy Memory Weights');
    }, 2000);
}
```

**Step 2: Commit debug.js**

```bash
git add src/ui/debug.js
git commit -m "refactor: extract debug utilities to src/ui/debug.js"
```

---

## Task 3: Update `src/ui/settings.js` to use new modules

**Files:**
- Modify: `src/ui/settings.js`

**Step 1: Update imports**

Add new imports at top of file (after existing imports):

```javascript
import { bindCheckbox, bindSlider, bindTextInput, bindNumberInput, bindSelect, bindButton, updateWordsDisplay } from './base/bindings.js';
import { testOllamaConnection, copyMemoryWeights } from './debug.js';
```

**Step 2: Remove extracted helper functions**

Delete the following sections from settings.js:
- `tokensToWords` function (lines ~43-48)
- `updateWordsDisplay` function (lines ~50-58) - but keep import
- The entire "UI Binding Helpers" section (lines ~64-134):
  - `bindCheckbox`
  - `bindSlider`
  - `bindTextInput`
  - `bindNumberInput`
  - `bindSelect`
  - `bindButton`

**Step 3: Remove extracted debug functions**

Delete from settings.js:
- `testOllamaConnection` function (lines ~270-300)
- `copyMemoryWeights` function (lines ~305-380)

**Step 4: Remove unused imports**

Remove these imports from settings.js (now only used in debug.js):
- `scoreMemories` from '../retrieval/math.js'
- `getScoringParams` from '../retrieval/scoring.js'
- `parseRecentMessages, extractQueryContext, buildBM25Tokens, buildEmbeddingQuery` from '../retrieval/query-context.js'
- `MEMORIES_KEY` from '../constants.js'

**Step 5: Commit settings.js changes**

```bash
git add src/ui/settings.js
git commit -m "refactor: use extracted modules in settings.js"
```

---

## Task 4: Run tests and verify

**Step 1: Run test suite**

```bash
npm test
```

Expected: All tests pass.

**Step 2: Run linter**

```bash
npm run lint
```

Expected: No errors.

**Step 3: Commit any fixes if needed**

---

## Summary

After completion:
- `src/ui/base/bindings.js` - ~110 lines (binding utilities)
- `src/ui/debug.js` - ~140 lines (debug functions)
- `src/ui/settings.js` - ~300 lines (reduced from ~530)

Total: 3 commits
1. `refactor: extract binding utilities to src/ui/base/bindings.js`
2. `refactor: extract debug utilities to src/ui/debug.js`
3. `refactor: use extracted modules in settings.js`
