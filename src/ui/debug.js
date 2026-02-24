/**
 * Debug and diagnostic utilities for OpenVault
 *
 * Contains functions for testing connections and analyzing memory scoring
 * to help developers understand and troubleshoot retrieval behavior.
 */
import { getDeps } from '../deps.js';
import { MEMORIES_KEY } from '../constants.js';
import { getOpenVaultData, showToast } from '../utils.js';
import { getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
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
            contextEmbedding = await getQueryEmbedding(embeddingQuery);
        }

        // Score all memories using shared params
        const { constants, settings: scoringSettings } = getScoringParams();
        const scored = scoreMemories(memories, contextEmbedding, chatLength, constants, scoringSettings, bm25Tokens);

        // Build header with ACTUAL query context used for retrieval
        const queryExcerpt = embeddingQuery;
        const tokensDisplay = bm25Tokens.slice(0, 20).join(', '); // Limit display
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
Settings: alpha=${scoringSettings.alpha ?? 0.7}, boostWeight=${scoringSettings.combinedBoostWeight ?? 15}, threshold=${scoringSettings.vectorSimilarityThreshold}`;

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
