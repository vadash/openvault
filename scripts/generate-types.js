#!/usr/bin/env node
/**
 * Generate src/types.d.ts from Zod schemas
 * Run via: npm run generate-types
 *
 * Uses the same _setTestOverride pattern as tests to mock CDN imports
 * so Node.js can import browser-targeted schema files.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- 1. Mock CDN imports for Node.js ---
// Same pattern used in tests: set up global override before importing source files

if (!globalThis.__openvault_cdn_test_overrides) {
    globalThis.__openvault_cdn_test_overrides = new Map();
}

// Provide local zod for CDN mock
const { z } = await import('zod');
globalThis.__openvault_cdn_test_overrides.set('zod', { z });

// --- 2. Dynamically import zod-to-ts (ESM) ---
const { zodToTs, printNode, createAuxiliaryTypeStore } = await import('zod-to-ts');

// --- 2.5. Create auxiliary type store (required by zod-to-ts) ---
const auxiliaryTypeStore = createAuxiliaryTypeStore();

// --- 3. Import schemas from browser-accessible source files ---

const {
    MemorySchema,
    GraphNodeSchema,
    GraphEdgeSchema,
    GraphDataSchema,
    ScoreBreakdownSchema,
    ScoredMemorySchema,
    BaseEntitySchema,
    BaseRelationshipSchema,
    EventSchema,
    EventExtractionSchema,
    CharacterDataSchema,
    ReflectionStateSchema,
    GlobalWorldStateSchema,
    CommunitySummarySchema,
    OpenVaultDataSchema,
    StVectorItemSchema,
    ScoringConfigSchema,
    QueryConfigSchema,
    GraphExtractionSchema,
    StSyncChangesSchema,
    ExtractionOptionsSchema,
    IDFCacheSchema,
    ExtractionContextParamsSchema,
    ExtractionLLMOptionsSchema,
    GenerateReflectionsResultSchema,
    ConsolidateEdgesResultSchema,
    MergeEntityResultSchema,
    StVectorQueryResultSchema,
    LLMConfigSchema,
    LLMCallOptionsSchema,
    LLMMessagesSchema,
    RetrievalContextSchema,
    BM25ContextSchema,
    ForgetfulnessConstantsSchema,
    ScoringSettingsSchema,
    MemoryUpdateSchema,
    CharacterNamesSchema,
    PromptContextSchema,
    BasePromptParamsSchema,
    GraphPromptParamsSchema,
    EdgeConsolidationParamsSchema,
    ReflectionPromptParamsSchema,
    CommunitySummaryParamsSchema,
    GlobalSynthesisParamsSchema,
} = await import('../src/store/schemas.js');

// --- 4. Map: Type Name -> Zod Schema ---

const typeMappings = [
    { name: 'Memory', schema: MemorySchema },
    { name: 'GraphNode', schema: GraphNodeSchema },
    { name: 'GraphEdge', schema: GraphEdgeSchema },
    { name: 'GraphData', schema: GraphDataSchema },
    { name: 'ScoreBreakdown', schema: ScoreBreakdownSchema },
    { name: 'ScoredMemory', schema: ScoredMemorySchema },
    { name: 'Entity', schema: BaseEntitySchema }, // Use base schema for types
    { name: 'Relationship', schema: BaseRelationshipSchema },
    { name: 'ExtractedEvent', schema: EventSchema },
    { name: 'EventExtraction', schema: EventExtractionSchema },
    { name: 'CharacterData', schema: CharacterDataSchema },
    { name: 'ReflectionState', schema: ReflectionStateSchema },
    { name: 'GlobalWorldState', schema: GlobalWorldStateSchema },
    { name: 'CommunitySummary', schema: CommunitySummarySchema },
    { name: 'OpenVaultData', schema: OpenVaultDataSchema },
    { name: 'StVectorItem', schema: StVectorItemSchema },
    { name: 'ScoringConfig', schema: ScoringConfigSchema },
    { name: 'QueryConfig', schema: QueryConfigSchema },
    { name: 'GraphExtraction', schema: GraphExtractionSchema },
    { name: 'StSyncChanges', schema: StSyncChangesSchema },
    { name: 'ExtractionOptions', schema: ExtractionOptionsSchema },
    { name: 'IDFCache', schema: IDFCacheSchema },
    { name: 'ExtractionContextParams', schema: ExtractionContextParamsSchema },
    { name: 'ExtractionLLMOptions', schema: ExtractionLLMOptionsSchema },
    { name: 'GenerateReflectionsResult', schema: GenerateReflectionsResultSchema },
    { name: 'ConsolidateEdgesResult', schema: ConsolidateEdgesResultSchema },
    { name: 'MergeEntityResult', schema: MergeEntityResultSchema },
    { name: 'StVectorQueryResult', schema: StVectorQueryResultSchema },
    { name: 'LLMConfig', schema: LLMConfigSchema },
    { name: 'LLMCallOptions', schema: LLMCallOptionsSchema },
    { name: 'LLMMessages', schema: LLMMessagesSchema },
    { name: 'RetrievalContext', schema: RetrievalContextSchema },
    { name: 'BM25Context', schema: BM25ContextSchema },
    { name: 'ForgetfulnessConstants', schema: ForgetfulnessConstantsSchema },
    { name: 'ScoringSettings', schema: ScoringSettingsSchema },
    { name: 'MemoryUpdate', schema: MemoryUpdateSchema },
    { name: 'CharacterNames', schema: CharacterNamesSchema },
    { name: 'PromptContext', schema: PromptContextSchema },
    { name: 'BasePromptParams', schema: BasePromptParamsSchema },
    { name: 'GraphPromptParams', schema: GraphPromptParamsSchema },
    { name: 'EdgeConsolidationParams', schema: EdgeConsolidationParamsSchema },
    { name: 'ReflectionPromptParams', schema: ReflectionPromptParamsSchema },
    { name: 'CommunitySummaryParams', schema: CommunitySummaryParamsSchema },
    { name: 'GlobalSynthesisParams', schema: GlobalSynthesisParamsSchema },
];

// --- 5. Generate the .d.ts file ---

const OUTPUT_PATH = path.resolve(__dirname, '../src/types.d.ts');

// Type overrides for fields that use z.any() in schemas but need specific TS types
const typeOverrides = {
    ExtractionOptions: {
        abortSignal: 'AbortSignal',
        progressCallback: '(current: number, total: number, phase: number) => void',
        onPhase2Start: '() => void',
    },
    ExtractionLLMOptions: {
        signal: 'AbortSignal',
    },
    LLMCallOptions: {
        signal: 'AbortSignal',
    },
};

async function generateTypes() {
    // Generate type definitions (without timestamp for comparison)
    let typeContent = '';
    for (const { name, schema } of typeMappings) {
        const { node } = zodToTs(schema, { name, auxiliaryTypeStore });
        const typeDef = printNode(node);
        typeContent += `export type ${name} = ${typeDef};\n\n`;
    }
    typeContent += `// End of generated types\n`;

    // Apply type overrides
    for (const [_typeName, overrides] of Object.entries(typeOverrides)) {
        for (const [fieldName, typeName] of Object.entries(overrides)) {
            // Replace patterns like `fieldName?: any | undefined` with `fieldName?: typeName | undefined`
            const pattern = new RegExp(`(${fieldName}\\?:) any (\\| undefined)`, 'g');
            typeContent = typeContent.replace(pattern, `$1 ${typeName} $2`);
        }
    }

    // Read existing file to compare
    let existingContent = '';
    try {
        const existing = await fs.readFile(OUTPUT_PATH, 'utf-8');
        // Strip header (first 3 lines: auto-gen marker, do-not-edit, blank line)
        const lines = existing.split('\n');
        existingContent = lines.slice(3).join('\n');
    } catch {
        // File doesn't exist yet
    }

    // Only write if content actually changed
    if (typeContent === existingContent) {
        console.log(`No changes - ${OUTPUT_PATH} up to date`);
        return;
    }

    // Content changed - write without timestamp
    const dtsContent = `// AUTO-GENERATED BY scripts/generate-types.js
// DO NOT EDIT DIRECTLY. Update src/store/schemas.js instead.

${typeContent}`;

    await fs.writeFile(OUTPUT_PATH, dtsContent, 'utf-8');
    console.log(`Generated ${typeMappings.length} types in ${OUTPUT_PATH}`);
}

generateTypes().catch((err) => {
    console.error('Type generation failed:', err.message);
    process.exit(1);
});
