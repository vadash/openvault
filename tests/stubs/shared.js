/**
 * Stub for SillyTavern shared.js
 * Used by vitest tests to resolve shared dependencies.
 */

export class ConnectionManagerRequestService {
    async request() {
        return { choices: [{ message: { content: '{}' } }] };
    }
}
