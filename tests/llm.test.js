import { describe, it, expect } from 'vitest';
import { LLM_CONFIGS } from '../src/llm.js';

describe('LLM_CONFIGS after smart retrieval removal', () => {
    it('does not have a retrieval config', () => {
        expect(LLM_CONFIGS.retrieval).toBeUndefined();
    });

    it('still has extraction config', () => {
        expect(LLM_CONFIGS.extraction).toBeDefined();
        expect(LLM_CONFIGS.extraction.profileSettingKey).toBe('extractionProfile');
    });
});

describe('LLM_CONFIGS reflection configs', () => {
    it('has reflection_questions config', () => {
        expect(LLM_CONFIGS.reflection_questions).toBeDefined();
        expect(LLM_CONFIGS.reflection_questions.profileSettingKey).toBe('extractionProfile');
        expect(LLM_CONFIGS.reflection_questions.maxTokens).toBe(2000);
    });

    it('has reflection_insights config', () => {
        expect(LLM_CONFIGS.reflection_insights).toBeDefined();
        expect(LLM_CONFIGS.reflection_insights.profileSettingKey).toBe('extractionProfile');
        expect(LLM_CONFIGS.reflection_insights.maxTokens).toBe(2000);
    });
});
