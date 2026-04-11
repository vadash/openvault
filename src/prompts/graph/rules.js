import { ENTITY_TYPES } from '../../constants.js';

/**
 * Task-specific rules for graph extraction and edge consolidation.
 */

export const GRAPH_RULES = `Extract named entities mentioned or clearly implied in the messages. Focus on NEW entities or CHANGES to existing ones:
- ${ENTITY_TYPES.PERSON}: Named characters, NPCs, people mentioned by name, and fictional identities presented as characters (includes personas, alter-egos, avatars)
- ${ENTITY_TYPES.PLACE}: Named locations, buildings, rooms, cities, regions
- ${ENTITY_TYPES.ORGANIZATION}: Named groups, factions, guilds, companies
- ${ENTITY_TYPES.OBJECT}: Highly significant unique items, weapons, or plot devices.
  PROHIBITED: Do not extract food, meals, cleaning supplies, mundane furniture,
  temporary clothing states, consumables, or scene props unless they are permanent,
  story-defining artifacts (e.g., "The One Ring", "Cursed Sword").
  Do NOT extract fluids, temporary body states, or transient physical descriptions.
- ${ENTITY_TYPES.CONCEPT}: Named abilities, spells, diseases, prophecies, or strict dietary/lifestyle requirements (e.g., "Peanut Allergy", "Veganism"). Do NOT extract temporary physical states (e.g., "soreness", "arousal") as concepts.

Also extract relationships between pairs of entities when the connection is stated or clearly implied. Do NOT re-describe existing static relationships unless a specific progression or change occurred in this batch.

IMPORTANT: Capture durable character preferences as relationships (e.g., Character -> CONCEPT: "Strongly dislikes").

IMPORTANT: Extract entities and relationships even when no events are extracted. Entity data builds world knowledge over time and is always valuable. Limit output to the most significant updates per batch.

<draft_process>
Think step by step, but only keep a minimal draft for each step, with 8 words at most per step. Use symbols: -> for causation/actions, + for conjunction, != for contrast. Write your work inside<think> tags BEFORE outputting the JSON:

Step 1: Scan -> list Entity(type) mentioned or implied.
Step 2: Validate types (${Object.values(ENTITY_TYPES).join(', ')}); skip mundane.
Step 3: Map Entity(type) + Entity(type); rel: nature/direction.
Step 4: Verify every source/target in relationships matches Entity name.
Step 5: Count entities + relationships -> output JSON.
</draft_process>`;

export const EDGE_CONSOLIDATION_RULES = `1. Summarize the CURRENT dynamic, but preserve critical historical shifts.
2. For example: "Started as enemies, but allied after the dragon incident; now close friends."
3. If the relationship has evolved significantly, capture that trajectory concisely.
4. Keep the description under 100 tokens.
5. Use EXACT entity names from the input data — do NOT transliterate, abbreviate, or translate names.
6. Output JSON immediately — do NOT include reasoning or analysis before the JSON block.`;
