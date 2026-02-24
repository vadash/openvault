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

// Tag configuration (replaces EVENT_TYPES)
export const TAG_LIST = [
    'EXPLICIT', 'BDSM', 'FETISH', 'ROMANCE', 'FLIRTING', 'SEDUCTION',
    'COMBAT', 'THREAT', 'INJURY', 'BETRAYAL', 'HORROR',
    'DOMESTIC', 'SOCIAL', 'TRAVEL', 'COMMERCE', 'FOOD', 'CELEBRATION',
    'LORE', 'SECRET', 'TRAUMA', 'GROWTH', 'EMOTION', 'BONDING', 'REUNION',
    'MYSTERY', 'MAGIC', 'STEALTH', 'POLITICAL', 'HUMOR', 'CRAFTING',
    'NONE'
];

export const TAG_ICONS = {
    // Intimate
    EXPLICIT: 'fa-solid fa-fire',
    BDSM: 'fa-solid fa-link',
    FETISH: 'fa-solid fa-mask',
    ROMANCE: 'fa-solid fa-heart',
    FLIRTING: 'fa-solid fa-face-smile-wink',
    SEDUCTION: 'fa-solid fa-wine-glass',
    // Conflict
    COMBAT: 'fa-solid fa-bolt',
    THREAT: 'fa-solid fa-triangle-exclamation',
    INJURY: 'fa-solid fa-band-aid',
    BETRAYAL: 'fa-solid fa-heart-crack',
    HORROR: 'fa-solid fa-skull',
    // Slice-of-life
    DOMESTIC: 'fa-solid fa-house',
    SOCIAL: 'fa-solid fa-comments',
    TRAVEL: 'fa-solid fa-route',
    COMMERCE: 'fa-solid fa-cart-shopping',
    FOOD: 'fa-solid fa-utensils',
    CELEBRATION: 'fa-solid fa-champagne-glasses',
    // Character
    LORE: 'fa-solid fa-book',
    SECRET: 'fa-solid fa-user-secret',
    TRAUMA: 'fa-solid fa-cloud-rain',
    GROWTH: 'fa-solid fa-seedling',
    EMOTION: 'fa-solid fa-face-sad-tear',
    BONDING: 'fa-solid fa-handshake',
    REUNION: 'fa-solid fa-people-arrows',
    // World
    MYSTERY: 'fa-solid fa-magnifying-glass',
    MAGIC: 'fa-solid fa-wand-sparkles',
    STEALTH: 'fa-solid fa-eye-slash',
    POLITICAL: 'fa-solid fa-landmark',
    HUMOR: 'fa-solid fa-face-laugh',
    CRAFTING: 'fa-solid fa-hammer',
    // Fallback
    NONE: 'fa-solid fa-bookmark',
    default: 'fa-solid fa-bookmark'
};
