/**
 * JSON output schemas for graph extraction and edge consolidation.
 */

export const GRAPH_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. Nothing else — no markdown fences, no commentary, no text before or after.

The JSON object MUST have this EXACT structure with BOTH top-level keys present:

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

CRITICAL FORMAT RULES — violating ANY of these will cause a system error:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ]. NEVER wrap your entire response in [ ].
2. BOTH keys ("entities", "relationships") MUST always be present.
3. If nothing was found, use empty arrays: "entities": [], "relationships": [].
4. Do NOT wrap output in markdown code blocks (no \`\`\`json).
5. You MAY use <thinking> tags for reasoning before providing the JSON.
   The JSON object must still be valid and parseable.
6. "type" for entities MUST be one of: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT.`;

export const EDGE_CONSOLIDATION_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

The JSON object MUST have this EXACT structure:

{
  "consolidated_description": "string - unified relationship summary that captures the evolution"
}

CRITICAL FORMAT RULES:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "consolidated_description" must be a single string under 100 tokens.
3. Do NOT wrap output in markdown code blocks.
4. You MAY use <thinking> tags for reasoning before providing the JSON.
   The JSON object must still be valid and parseable.`;
