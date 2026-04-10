import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/constants.js';

describe('reflection toggle settings', () => {
    it('should have reflectionGenerationEnabled defaulting to true', () => {
        expect(defaultSettings.reflectionGenerationEnabled).toBe(true);
    });

    it('should have reflectionInjectionEnabled defaulting to true', () => {
        expect(defaultSettings.reflectionInjectionEnabled).toBe(true);
    });
});
