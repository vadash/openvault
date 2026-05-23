/**
 * Stub for SillyTavern's lib.js in tests
 * Exports lodash for testing
 */

// Simple stub implementations for lodash methods used in tests
const stubLodash = {
    merge: (target, ...sources) => {
        const result = { ...target };
        for (const source of sources) {
            for (const key in source) {
                if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = stubLodash.merge(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        return result;
    },
    get: (obj, path, defaultValue) => {
        const keys = Array.isArray(path) ? path : path.split('.');
        let result = obj;
        for (const key of keys) {
            result = result?.[key];
            if (result === undefined) return defaultValue;
        }
        return result === undefined ? defaultValue : result;
    },
    set: (obj, path, value) => {
        const keys = Array.isArray(path) ? path : path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        current[keys[keys.length - 1]] = value;
        return obj;
    },
    has: (obj, path) => {
        const keys = Array.isArray(path) ? path : path.split('.');
        let current = obj;
        for (const key of keys) {
            if (current == null || !(key in current)) return false;
            current = current[key];
        }
        return true;
    },
};

export { stubLodash as lodash };
export default { lodash: stubLodash };
