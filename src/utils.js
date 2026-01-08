/**
 * OpenVault Utilities
 *
 * Barrel file that re-exports from utility submodules.
 * This provides a clean import interface and prevents circular dependencies.
 */

// Re-export from submodules
export { escapeHtml, showToast } from './utils/dom.js';
export { getOpenVaultData, getCurrentChatId, saveOpenVaultData, generateId } from './utils/data.js';
export { estimateTokens, sliceToTokenBudget, safeParseJSON, sortMemoriesBySequence, stripThinkingTags } from './utils/text.js';
export { withTimeout } from './utils/async.js';
export { safeSetExtensionPrompt } from './utils/st-helpers.js';
export { log, isExtensionEnabled, isAutomaticMode } from './utils/settings.js';

// Re-export scheduler functions for backwards compatibility
export { getExtractedMessageIds, getUnextractedMessageIds } from './extraction/scheduler.js';
