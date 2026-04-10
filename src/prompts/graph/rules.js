import { ENTITY_TYPES } from '../../constants.js';

/**
 * Task-specific rules for graph extraction and edge consolidation.
 */

export const GRAPH_RULES = `Extract named entities mentioned or clearly implied in the messages. Focus on NEW entities or CHANGES to existing ones:
- ${ENTITY_TYPES.PERSON}: Named characters, NPCs, people mentioned by name, and fictional identities presented as characters (includes personas, alter-egos, avatars)
- ${ENTITY_TYPES.PLACE}: Named locations, buildings, rooms, cities, regions
- ${ENTITY_TYPES.ORGANIZATION}: Named groups, factions, guilds, companies
- ${ENTITY_TYPES.OBJECT}: Highly significant unique items, weapons, or plot devices. Do NOT extract mundane items, clothing, food, cups, phones, or daily objects UNLESS they are enchanted, unique, or become permanent fixtures of the story. Do NOT extract body parts, anatomical features, or bodily fluids UNLESS they act as unique plot devices, evidence, or specific permanent anchors for the narrative.
- ${ENTITY_TYPES.CONCEPT}: Named abilities, spells, diseases, prophecies, or strict dietary/lifestyle requirements (e.g., "Peanut Allergy", "Veganism"). Do NOT extract temporary physical states (e.g., "soreness", "arousal") as concepts.

Also extract relationships between pairs of entities when the connection is stated or clearly implied. Do NOT re-describe existing static relationships unless a specific progression or change occurred in this batch.

IMPORTANT: Capture durable character preferences as relationships (e.g., Character -> CONCEPT: "Strongly dislikes").

IMPORTANT: Extract entities and relationships even when no events are extracted. Entity data builds world knowledge over time and is always valuable. Limit output to the most significant updates per batch.

<thinking_process>
Follow these steps IN ORDER. Write your work inside <think> tags BEFORE outputting the JSON:

Step 1: Entity scan — List every named entity mentioned or implied. Include type (${Object.values(ENTITY_TYPES).join(', ')}).
Step 2: Type validation — Verify each entity type against the allowed set. Skip mundane objects unless plot-critical.
Step 3: Relationship map — For each entity pair with a stated or implied connection, note the direction and nature.
Step 4: VALIDATION — Verify every 'source' and 'target' in your relationships array
  exactly matches a 'name' defined in your entities array. If a relationship references
  an entity not in your list, either add that entity or remove the relationship.
Step 5: Output — Count entities and relationships, then produce the final JSON.
</thinking_process>`;

export const EDGE_CONSOLIDATION_RULES = `1. Summarize the CURRENT dynamic, but preserve critical historical shifts.
2. For example: "Started as enemies, but allied after the dragon incident; now close friends."
3. If the relationship has evolved significantly, capture that trajectory concisely.
4. Keep the description under 100 tokens.
5. Use EXACT entity names from the input data — do NOT transliterate, abbreviate, or translate names.
6. Output JSON immediately — do NOT include reasoning or analysis before the JSON block.`;
