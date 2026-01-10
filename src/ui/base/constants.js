/**
 * DOM Selectors and Constants
 *
 * Single source of truth for all DOM references.
 * Change CSS classes/IDs in one place.
 */

// DOM element selectors
export const SELECTORS = {
    // Containers
    MEMORY_LIST: '#openvault_memory_list',
    PAGE_INFO: '#openvault_page_info',
    PREV_BTN: '#openvault_prev_page',
    NEXT_BTN: '#openvault_next_page',
    SEARCH_INPUT: '#openvault_memory_search',
    FILTER_TYPE: '#openvault_filter_type',
    FILTER_CHARACTER: '#openvault_filter_character',
    CHARACTER_STATES: '#openvault_character_states',

    // Dynamic elements (for event delegation)
    MEMORY_CARD: '.openvault-memory-card',
    DELETE_BTN: '.openvault-delete-memory',
    EDIT_BTN: '.openvault-edit-memory',
    CANCEL_EDIT_BTN: '.openvault-cancel-edit',
    SAVE_EDIT_BTN: '.openvault-save-edit',
    EDIT_TEXTAREA: '.openvault-edit-textarea',
    EDIT_FIELD: '[data-field]',
};

// CSS class constants
export const CLASSES = {
    MEMORY_CARD: 'openvault-memory-card',
    PLACEHOLDER: 'openvault-placeholder',
    CHARACTER_TAG: 'openvault-character-tag',
    MEMORY_CHARACTERS: 'openvault-memory-characters',
};

// Custom event names
export const EVENTS = {
    MEMORY_DELETED: 'openvault:memory:deleted',
    MEMORY_UPDATED: 'openvault:memory:updated',
    FILTER_CHANGED: 'openvault:filter:changed',
};

// Event type configuration
export const EVENT_TYPES = ['action', 'revelation', 'emotion_shift', 'relationship_change'];

export const EVENT_TYPE_ICONS = {
    action: 'fa-solid fa-bolt',
    revelation: 'fa-solid fa-lightbulb',
    emotion_shift: 'fa-solid fa-heart',
    relationship_change: 'fa-solid fa-people-arrows',
    default: 'fa-solid fa-bookmark'
};
