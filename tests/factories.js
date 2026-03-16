// tests/factories.js

let _counter = 0;

/**
 * Build a valid mock memory object with sensible defaults.
 * Override any field via the overrides parameter.
 * @param {Object} overrides - Fields to override
 * @returns {Object} A complete memory object
 */
export function buildMockMemory(overrides = {}) {
    _counter++;
    return {
        id: `mem_${_counter}`,
        type: 'event',
        summary: `Default memory summary ${_counter}`,
        importance: 3,
        sequence: _counter * 1000,
        characters_involved: ['Alice', 'Bob'],
        witnesses: ['Alice', 'Bob'],
        message_ids: [_counter],
        is_secret: false,
        ...overrides,
    };
}

/**
 * Build a valid mock graph node.
 * @param {Object} overrides - Fields to override
 * @returns {Object} A complete graph node
 */
export function buildMockGraphNode(overrides = {}) {
    return {
        name: 'Default Node',
        type: 'PERSON',
        description: 'Default description',
        mentions: 1,
        ...overrides,
    };
}

/**
 * Build a minimal OpenVault data structure.
 * @param {Object} overrides - Fields to override
 * @returns {Object} A valid openvault data object
 */
export function buildMockData(overrides = {}) {
    return {
        memories: [],
        character_states: {},
        last_processed_message_id: -1,
        processed_message_ids: [],
        ...overrides,
    };
}

/**
 * Reset the counter (call in afterEach if IDs must be deterministic).
 */
export function resetFactoryCounter() {
    _counter = 0;
}
