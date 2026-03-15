/**
 * OpenVault Prompts — Public API
 *
 * Barrel re-exports from domain modules.
 * Consumers import from this file; internal structure is hidden.
 */

// Shared
export {
    PREFILL_PRESETS,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
} from './shared/preambles.js';

// Events
export { buildEventExtractionPrompt } from './events/builder.js';

// Graph
export { buildGraphExtractionPrompt, buildEdgeConsolidationPrompt } from './graph/builder.js';

// Reflection
export { buildUnifiedReflectionPrompt } from './reflection/builder.js';

// Communities
export { buildCommunitySummaryPrompt, buildGlobalSynthesisPrompt } from './communities/builder.js';
