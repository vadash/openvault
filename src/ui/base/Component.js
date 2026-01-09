/**
 * Base Component Class
 *
 * Lightweight component base for UI organization without framework overhead.
 * Provides DOM querying, event delegation with cleanup, and simple state management.
 */

export class Component {
    /**
     * @param {Object} options
     * @param {string|jQuery} options.container - jQuery selector or jQuery object
     * @param {Object} options.selectors - Logical selector keys to DOM strings
     * @param {Object} options.initialState - Initial state object
     */
    constructor({ container, selectors = {}, initialState = {} }) {
        this.$container = typeof container === 'string'
            ? $(container)
            : container;
        this.selectors = selectors;
        this.state = { ...initialState };
        this.eventHandlers = new Map();
    }

    /**
     * Get jQuery element by logical selector key
     * @param {string} key - Selector key from this.selectors
     * @returns {jQuery} jQuery element
     */
    $(key) {
        const selector = this.selectors[key];
        if (!selector) throw new Error(`Unknown selector key: ${key}`);
        return this.$container.find(selector);
    }

    /**
     * Delegate event to container, tracked for cleanup
     * @param {string} event - Event name (e.g., 'click', 'change')
     * @param {string} selector - CSS selector for delegation
     * @param {Function} handler - Event handler
     * @returns {Component} this for chaining
     */
    on(event, selector, handler) {
        this.$container.on(event, selector, handler);
        this.eventHandlers.set(`${event}:${selector}`, handler);
        return this;
    }

    /**
     * Simple state merge - no reactivity or diffing
     * @param {Object} updates - State updates to merge
     * @returns {Component} this for chaining
     */
    setState(updates) {
        this.state = { ...this.state, ...updates };
        return this;
    }

    /**
     * Render component - must be implemented by subclass
     */
    render() {
        throw new Error('Component must implement render()');
    }

    /**
     * Clean up event handlers
     */
    destroy() {
        this.eventHandlers.forEach((handler, key) => {
            const [event, selector] = key.split(':');
            this.$container.off(event, selector, handler);
        });
        this.eventHandlers.clear();
    }
}
