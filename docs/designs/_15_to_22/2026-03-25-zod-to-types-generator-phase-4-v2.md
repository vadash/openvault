# Design: Zod-to-Types Generator - Phase 4

## Summary
Migrate from manually-maintained JSDoc types (`src/types.js`) to auto-generated TypeScript declaration files (`src/types.d.ts`) derived from Zod schemas. Establishes Zod as the single source of truth for both runtime validation and design-time type checking.

## Context
Phases 1-3 added `@ts-check` and JSDoc types to the entire domain layer. While this improved IntelliSense and caught bugs, it created a maintenance burden: **types are defined twice**—once as JSDoc in `types.js` and once as Zod schemas in `structured.js` for LLM validation.

This design solves that duplication by generating the type definitions automatically from Zod schemas.

## Goals
- Single source of truth: Zod schemas define both runtime validation and compile-time types
- Eliminate manual synchronization between JSDoc and Zod schemas
- Preserve zero-bundler architecture (`.d.ts` files are dev-only, not loaded at runtime)
- Maintain existing `@ts-check` coverage—just change import paths
- Hook generation into existing workflow (pre-commit/pre-test)

## Non-Goals
- No migration to `.ts` source files (keep `.js` with `@ts-check`)
- No runtime bundling or transpilation step
- No changes to CDN import patterns
- No breaking changes to data shapes—this is tooling only

---

## Architecture

### Before (Current State)
```
Zod Schemas (structured.js) ──┐
                              ├──→ Both define same shapes
JSDoc Types (types.js) ───────┘
```

### After (Target State)
```
Zod Schemas (schemas/*.js) ──→ zod-to-ts ──→ types.d.ts
                                    ↓
Source Files (*.js) ──────────→ import types from .d.ts
```

---

## File Structure Changes

### New Files
```
scripts/
  generate-types.js     # Generator script using zod-to-ts + CDN mock

src/
  store/schemas.js      # Zod schemas for internal types (Memory, GraphData, etc.)
  types.d.ts            # GENERATED - Do not edit manually
```

### Modified Files
```
src/types.js            # DEPRECATED - Keep during transition, then delete
src/extraction/structured.js  # Re-export base schemas; extend with .catch() for LLM
package.json            # Add generate-types script, pretest hook
```

### Unchanged Files
```
All domain files (*.js)  # Just change import: types.js → types.d.ts
```

---

## Implementation

### Step 1: Install zod-to-ts

```bash
npm install --save-dev zod-to-ts
```

### Step 2: Create Internal Schemas (Single Source of Truth)

Create `src/store/schemas.js` with Zod schemas for all internal data structures. This file is browser-accessible and uses CDN imports like the rest of the codebase:

```javascript
// @ts-check
/**
 * Zod schemas for OpenVault data structures
 *
 * These schemas serve dual purposes:
 * 1. Runtime validation where needed (optional, to save CPU)
 * 2. Source of truth for TypeScript type generation via zod-to-ts
 *
 * For LLM I/O schemas with .catch() fallbacks, define a Base schema here
 * and extend it in src/extraction/structured.js with the fallbacks.
 */

import { cdnImport } from '../utils/cdn.js';
const { z } = await cdnImport('zod');

// --- Core Memory Schema ---

export const MemorySchema = z.object({
  id: z.string(),
  summary: z.string(),
  importance: z.number().int().min(1).max(5),
  embedding: z.array(z.number()).optional(),
  message_id: z.number(),
  timestamp: z.number(),
  witnesses: z.array(z.string()).optional(),
  type: z.enum(['event', 'reflection', 'global_synthesis']).optional(),
  level: z.number().optional(),
  tokens: z.array(z.string()),
  message_ids: z.array(z.number()).optional(),
  mentions: z.number().optional(),
  retrieval_hits: z.number().optional(),
  archived: z.boolean().optional(),
  _st_synced: z.boolean().optional(),
  _proxyVectorScore: z.number().optional(),
});

// --- Graph Schemas ---

export const GraphNodeSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['PERSON', 'PLACE', 'ORGANIZATION', 'OBJECT', 'CONCEPT']),
  description: z.string(),
  mentions: z.number(),
  embedding: z.array(z.number()).optional(),
  embedding_b64: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  _st_synced: z.boolean().optional(),
});

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  description: z.string(),
  weight: z.number(),
  _descriptionTokens: z.number().optional(),
  embedding: z.array(z.number()).optional(),
  embedding_b64: z.string().optional(),
  _st_synced: z.boolean().optional(),
});

export const GraphDataSchema = z.object({
  nodes: z.record(z.string(), GraphNodeSchema),
  edges: z.record(z.string(), GraphEdgeSchema),
  _mergeRedirects: z.record(z.string(), z.string()).optional(),
  _edgesNeedingConsolidation: z.array(z.string()).optional(),
});

// --- Entity & Relationship (Base Schemas for LLM Extension) ---

/**
 * Base Entity schema - strict validation
 * Extended in structured.js with .catch() fallbacks for LLM output
 */
export const BaseEntitySchema = z.object({
  name: z.string().min(1).describe('Entity name, capitalized'),
  type: z.enum(['PERSON', 'PLACE', 'ORGANIZATION', 'OBJECT', 'CONCEPT']),
  description: z.string().describe('Comprehensive description of the entity'),
});

/**
 * Base Relationship schema - strict validation
 * Extended in structured.js with .catch() fallbacks for LLM output
 */
export const BaseRelationshipSchema = z.object({
  source: z.string().min(1).describe('Source entity name'),
  target: z.string().min(1).describe('Target entity name'),
  description: z.string().min(1).describe('Description of the relationship'),
});

// --- Scoring & Retrieval Schemas ---

export const ScoreBreakdownSchema = z.object({
  total: z.number(),
  base: z.number(),
  baseAfterFloor: z.number(),
  recencyPenalty: z.number(),
  vectorBonus: z.number(),
  vectorSimilarity: z.number(),
  bm25Bonus: z.number(),
  bm25Score: z.number(),
  distance: z.number(),
  importance: z.number(),
  hitDamping: z.number().optional(),
  frequencyFactor: z.number().optional(),
});

export const ScoredMemorySchema = z.object({
  memory: MemorySchema,
  score: z.number(),
  breakdown: ScoreBreakdownSchema,
});

// --- Event Schemas ---

export const EventSchema = z.object({
  summary: z.string().min(20, 'Summary must be a complete descriptive sentence'),
  importance: z.number().int().min(1).max(5).default(3),
  characters_involved: z.array(z.string()).default([]),
  witnesses: z.array(z.string()).default([]),
  location: z.string().nullable().default(null),
  is_secret: z.boolean().default(false),
  emotional_impact: z.record(z.string(), z.any()).optional().default({}),
  relationship_impact: z.record(z.string(), z.any()).optional().default({}),
});

export const EventExtractionSchema = z.object({
  events: z.array(EventSchema),
});

// ... additional schemas for OpenVaultData, StVectorItem, etc.
```

### Step 2b: Extend Base Schemas for LLM Validation

In `src/extraction/structured.js`, import base schemas and add `.catch()` fallbacks:

```javascript
import { cdnImport } from '../utils/cdn.js';
const { z } = await cdnImport('zod');

// Import base schemas from store/schemas.js
import {
  BaseEntitySchema,
  BaseRelationshipSchema,
  EventSchema
} from '../store/schemas.js';

// Extend with .catch() fallbacks for LLM output forgiveness
export const EntitySchema = z.object({
  name: BaseEntitySchema.shape.name.catch('Unknown'),
  type: BaseEntitySchema.shape.type.catch('OBJECT'),
  description: BaseEntitySchema.shape.description.catch('No description available'),
});

export const RelationshipSchema = z.object({
  source: BaseRelationshipSchema.shape.source.catch('Unknown'),
  target: BaseRelationshipSchema.shape.target.catch('Unknown'),
  description: BaseRelationshipSchema.shape.description.catch('No description'),
});

// Re-export strict schemas that don't need fallbacks
export { EventSchema, EventExtractionSchema } from '../store/schemas.js';

// Graph extraction uses base schemas with .max() limits
export const GraphExtractionSchema = z.object({
  entities: z.array(EntitySchema).max(5).default([]),
  relationships: z.array(RelationshipSchema).max(5).default([]),
});
```

This pattern ensures:
- **Single source of truth**: Base shapes defined once in `store/schemas.js`
- **Type accuracy**: Generated types reflect the strict base schemas (no `| 'Unknown'` unions)
- **Runtime forgiveness**: LLM validation uses `.catch()` fallbacks without polluting types

### Step 3: Create Generator Script (with CDN Mock)

Create `scripts/generate-types.js`:

```javascript
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
import { zodToTs, printNode } from 'zod-to-ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- 1. Mock CDN imports for Node.js ---
// Same pattern used in tests: set up global override before importing source files

if (!globalThis.__openvault_cdn_test_overrides) {
  globalThis.__openvault_cdn_test_overrides = new Map();
}

// Provide local zod for CDN mock
const { z } = await import('zod');
globalThis.__openvault_cdn_test_overrides.set('zod', { z });

// --- 2. Import schemas from browser-accessible source files ---

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
  // ... other schemas
} = await import('../src/store/schemas.js');

// --- 3. Map: Type Name → Zod Schema ---

const typeMappings = [
  { name: 'Memory', schema: MemorySchema },
  { name: 'GraphNode', schema: GraphNodeSchema },
  { name: 'GraphEdge', schema: GraphEdgeSchema },
  { name: 'GraphData', schema: GraphDataSchema },
  { name: 'ScoreBreakdown', schema: ScoreBreakdownSchema },
  { name: 'ScoredMemory', schema: ScoredMemorySchema },
  { name: 'Entity', schema: BaseEntitySchema },      // Use base schema for types
  { name: 'Relationship', schema: BaseRelationshipSchema },
  { name: 'ExtractedEvent', schema: EventSchema },
  // ... other types
];

// --- 4. Generate the .d.ts file ---

const OUTPUT_PATH = path.resolve(__dirname, '../src/types.d.ts');

async function generateTypes() {
  const timestamp = new Date().toISOString();
  let dtsContent = `// AUTO-GENERATED BY scripts/generate-types.js
// Generated at: ${timestamp}
// DO NOT EDIT DIRECTLY. Update src/store/schemas.js instead.

`;

  for (const { name, schema } of typeMappings) {
    const { node } = zodToTs(schema, name);
    const typeDef = printNode(node);
    dtsContent += `export type ${name} = ${typeDef};\n\n`;
  }

  // Add type-only export marker
  dtsContent += `// End of generated types\n`;

  await fs.writeFile(OUTPUT_PATH, dtsContent, 'utf-8');
  console.log(`✅ Generated ${typeMappings.length} types in ${OUTPUT_PATH}`);
}

generateTypes().catch(err => {
  console.error('❌ Type generation failed:', err.message);
  process.exit(1);
});
```

**How the CDN mock works:**

1. Before importing any source files, we populate `globalThis.__openvault_cdn_test_overrides`
2. When `src/store/schemas.js` calls `cdnImport('zod')`, the util returns the local Node.js zod
3. Same pattern used in `tests/setup.js`—proven, battle-tested approach

### Step 4: Update package.json

Add scripts to automate type generation:

```json
{
  "scripts": {
    "generate-types": "node scripts/generate-types.js",
    "pretest": "npm run generate-types",
    "typecheck": "npm run generate-types && tsc --noEmit"
  }
}
```

### Step 5: Update Pre-commit Hook

Edit `.githooks/pre-commit`:

```bash
#!/bin/sh
# Generate types from Zod schemas
npm run generate-types

# Stage the generated file if it changed
git diff --quiet src/types.d.ts || git add src/types.d.ts

# Run existing checks
npm run lint
```

### Step 6: Update Source File Imports

Change all imports from `types.js` to `types.d.ts`:

**Before:**
```javascript
/** @typedef {import('../types.js').Memory} Memory */
```

**After:**
```javascript
/** @typedef {import('../types.d.ts').Memory} Memory */
```

Files to update (after Phases 1-3 complete):
- `src/extraction/extract.js`
- `src/extraction/structured.js` (keep using Zod directly for validation)
- `src/graph/graph.js`
- `src/retrieval/scoring.js`
- `src/retrieval/math.js`
- `src/store/chat-data.js`
- All other files with `@typedef {import('../types.js')...` imports

---

## Migration Timeline

### Phase 4.1: Setup (Parallel with Phase 3)
- [ ] Install `zod-to-ts` dev dependency
- [ ] Create `src/store/schemas.js` with core schemas (browser-accessible, CDN imports)
- [ ] Create `scripts/generate-types.js` with CDN mock pattern
- [ ] Add npm scripts

### Phase 4.2: Validation
- [ ] Run generator with CDN mock, verify `src/types.d.ts` output
- [ ] Compare generated types with manual JSDoc—ensure parity
- [ ] Test that `structured.js` can extend base schemas with `.catch()`
- [ ] Run full test suite with generated types

### Phase 4.3: Cutover
- [ ] Update all `import('../types.js')` to `import('../types.d.ts')`
- [ ] Run typecheck: `npm run typecheck`
- [ ] Run tests: `npm run test`
- [ ] Delete `src/types.js` (or keep as re-export for backward compat)

### Phase 4.4: Automation
- [ ] Verify pre-commit hook regenerates types
- [ ] Verify pretest hook regenerates types
- [ ] Document in CLAUDE.md: "types are generated from Zod schemas"

---

## Type Coverage Strategy

### What Gets Zod Schemas (in src/store/schemas.js)

| Type Category | Example Types | Rationale |
|--------------|---------------|-----------|
| Core data | `Memory`, `Entity`, `Relationship` | Stored in chatMetadata, type safety critical |
| Graph | `GraphData`, `GraphNode`, `GraphEdge` | Complex nested structures |
| Scoring | `ScoredMemory`, `ScoreBreakdown` | Math-heavy, catches calculation errors |
| Config | `ScoringConfig`, `QueryConfig` | Settings injection, catch config drift |
| LLM I/O (base) | `BaseEntitySchema`, `BaseRelationshipSchema` | Extended in structured.js with .catch() |
| LLM I/O (complete) | `EventSchema`, `EventExtractionSchema` | Re-exported directly if no fallbacks needed |

### Schema Inheritance Pattern

**Base schema** (`src/store/schemas.js`): Strict validation, generates clean types
```javascript
export const BaseEntitySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['PERSON', 'PLACE', 'ORGANIZATION', 'OBJECT', 'CONCEPT']),
  description: z.string(),
});
```

**Extended schema** (`src/extraction/structured.js`): Runtime forgiveness for LLM
```javascript
export const EntitySchema = z.object({
  name: BaseEntitySchema.shape.name.catch('Unknown'),
  type: BaseEntitySchema.shape.type.catch('OBJECT'),
  description: BaseEntitySchema.shape.description.catch('No description'),
});
```

**Generated type** (`src/types.d.ts`): Clean, no `| 'Unknown'` pollution
```typescript
export type Entity = {
  name: string;
  type: "PERSON" | "PLACE" | "ORGANIZATION" | "OBJECT" | "CONCEPT";
  description: string;
};
```

### What Stays as JSDoc (no Zod schema needed)

| Type Category | Example Types | Rationale |
|--------------|---------------|-----------|
| UI callbacks | `onProgress`, `onComplete` | Function signatures, not data shapes |
| DOM/jQuery | `$element`, `event` | External types, no validation needed |
| Internal helpers | `BM25Context`, `IDFCache` | Simple objects, low complexity |
| Test types | Mock types, fixtures | Only used in tests |

---

## Benefits

1. **Single Source of Truth**
   - Change a field in Zod schema → types regenerate automatically
   - No risk of JSDoc and Zod getting out of sync

2. **Better Editor Experience**
   - `.d.ts` files provide cleaner IntelliSense than JSDoc
   - Hover info shows exact property types, not just `@property` comments

3. **Catches Real Bugs**
   - Zod `.optional()` becomes TypeScript `?:`—catches missing field access
   - Zod `.default()` preserved in type—knows fallback values

4. **Zero Runtime Cost**
   - `.d.ts` files are not loaded by browser
   - Runtime validation still only where needed (LLM responses)

5. **Gradual Migration**
   - Can keep `types.js` as fallback during transition
   - Individual files migrate independently

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `zod-to-ts` doesn't support some Zod feature | Test all schemas before migration; use `z.preprocess()` workaround or file issue |
| Generated types include `.catch()` fallbacks as unions | Use Base schema pattern—generator uses base, runtime uses extended with `.catch()` |
| Forgot to regenerate, types are stale | Pre-commit and pretest hooks ensure freshness |
| CDN mock fails in generator | Use proven `_setTestOverride` pattern from existing tests |
| Schema changes break runtime | All schemas remain browser-tested via existing test suite |

### Single Source of Truth Verification

To verify we achieved true SSOT:

```bash
# 1. Search for any manual JSDoc type definitions
grep -r "@typedef" src/types.js

# 2. Should return nothing (or only function/callback types)
# All data types should be imported from types.d.ts

# 3. Verify generator uses base schemas (not extended with .catch())
grep "BaseEntitySchema\|BaseRelationshipSchema" scripts/generate-types.js
```

---

## Success Criteria

- [ ] `npm run generate-types` creates valid `src/types.d.ts`
- [ ] `npm run typecheck` passes with generated types
- [ ] All `@typedef {import('../types.js')...` changed to `types.d.ts`
- [ ] Pre-commit hook auto-generates and stages types
- [ ] Pre-test hook generates types before running tests
- [ ] Deleting `src/types.js` doesn't break build
- [ ] No regression in test pass rate
- [ ] IntelliSense shows Zod-derived types in VS Code

---

## Future Extensions (Out of Scope)

- **zod-to-json-schema**: For APIs requiring JSON Schema (not just Zod)
- **OpenAPI generation**: If exposing REST endpoints
- **Documentation generation**: Auto-generate DATA_SCHEMA.md from Zod

---

## Summary

This design completes the type safety initiative by establishing Zod as the single source of truth. After Phases 1-3 provide manual coverage, Phase 4 automates the synchronization, eliminating the maintenance burden while preserving all benefits of `@ts-check` and adding the precision of Zod-derived types.

The architecture remains zero-bundler, zero-transpile at runtime—the `.d.ts` generation is pure development tooling.
