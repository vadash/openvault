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
