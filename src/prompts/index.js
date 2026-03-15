/**
 * OpenVault Prompts — Public API
 *
 * Barrel re-exports from domain modules.
 * Consumers import from this file; internal structure is hidden.
 */

// Communities
export { buildCommunitySummaryPrompt, buildGlobalSynthesisPrompt } from './communities/builder.js';

// Events
export { buildEventExtractionPrompt } from './events/builder.js';

// Graph
export { buildEdgeConsolidationPrompt, buildGraphExtractionPrompt } from './graph/builder.js';

// Reflection
export { buildUnifiedReflectionPrompt } from './reflection/builder.js';
// Shared
export {
    PREFILL_PRESETS,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
} from './shared/preambles.js';
