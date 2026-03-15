/**
 * Task-specific rules for graph extraction and edge consolidation.
 */

export const GRAPH_RULES = `Extract ALL named entities mentioned or clearly implied in the messages:
- PERSON: Named characters, NPCs, people mentioned by name
- PLACE: Named locations, buildings, rooms, cities, regions
- ORGANIZATION: Named groups, factions, guilds, companies
- OBJECT: Highly significant unique items, weapons, or plot devices. Do NOT extract mundane furniture, clothing, or food unless they are critical to the scene's dynamic
- CONCEPT: Named abilities, spells, diseases, prophecies

Also extract relationships between pairs of entities when the connection is stated or clearly implied.

IMPORTANT: Extract entities and relationships even when no events are extracted. Entity data builds world knowledge over time and is always valuable.`;

export const EDGE_CONSOLIDATION_RULES = `1. Summarize the CURRENT dynamic, but preserve critical historical shifts.
2. For example: "Started as enemies, but allied after the dragon incident; now close friends."
3. If the relationship has evolved significantly, capture that trajectory concisely.
4. Keep the description under 100 tokens.
5. Use EXACT entity names from the input data — do NOT transliterate, abbreviate, or translate names.`;
