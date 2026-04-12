import { ENTITY_TYPES } from '../../constants.js';

/**
 * JSON output schemas for graph extraction and edge consolidation.
 */

export const GRAPH_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "entities": [
    {
      "name": "Entity Name",
      "type": "PERSON",
      "description": "Brief description of this entity based on what is known"
    }
  ],
  "relationships": [
    {
      "source": "Entity A",
      "target": "Entity B",
      "description": "How A relates to B"
    }
  ]
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. BOTH keys ("entities", "relationships") MUST always be present. If nothing found: empty arrays. Do not just stop generating.
3. Do NOT wrap in markdown code blocks.
4. "type" MUST be one of: ${Object.values(ENTITY_TYPES).join(', ')}.
5. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;

export const EDGE_CONSOLIDATION_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "consolidated_description": "string - unified relationship summary that captures the evolution"
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "consolidated_description" must be a single string under 100 tokens.
3. Do NOT wrap in markdown code blocks.
4. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;
