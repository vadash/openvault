/**
 * OpenVault Graph Module
 *
 * Flat-JSON graph CRUD for entity and relationship storage.
 * All data stored in chatMetadata.openvault.graph as { nodes, edges }.
 */

/**
 * Normalize an entity name to a consistent key.
 * @param {string} name
 * @returns {string}
 */
function normalizeKey(name) {
    return name.toLowerCase().trim();
}

/**
 * Upsert an entity node into the flat graph structure.
 * Merges descriptions and increments mentions on duplicates.
 * @param {Object} graphData - The graph object { nodes, edges } (mutated in place)
 * @param {string} name - Entity name (original casing preserved on first insert)
 * @param {string} type - PERSON | PLACE | ORGANIZATION | OBJECT | CONCEPT
 * @param {string} description - Entity description
 */
export function upsertEntity(graphData, name, type, description) {
    const key = normalizeKey(name);
    const existing = graphData.nodes[key];

    if (existing) {
        if (!existing.description.includes(description)) {
            existing.description = existing.description + ' | ' + description;
        }
        existing.mentions += 1;
    } else {
        graphData.nodes[key] = {
            name: name.trim(),
            type,
            description,
            mentions: 1,
        };
    }
}
