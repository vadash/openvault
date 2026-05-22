/**
 * JSON output schema for global world state synthesis.
 */

export const WORLD_STATE_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "title": "Short name for this world state (2-5 words)",
  "summary": "Executive summary of the world state's structure, key entities, and dynamics",
  "findings": ["finding 1", "finding 2"]
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "title": short specific name (2-5 words). "summary": comprehensive paragraph. "findings": 1-5 strings.
3. Do NOT wrap in markdown code blocks.
4. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;
