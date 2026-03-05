import { describe, expect, it } from 'vitest';
import { LLM_CONFIGS } from '../src/llm.js';

describe('LLM_CONFIGS after smart retrieval removal', () => {
    it('does not have a retrieval config', () => {
        expect(LLM_CONFIGS.retrieval).toBeUndefined();
    });

    it('does not have legacy extraction config', () => {
        expect(LLM_CONFIGS.extraction).toBeUndefined();
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

describe('LLM_CONFIGS community config', () => {
    it('has community config', () => {
        expect(LLM_CONFIGS.community).toBeDefined();
        expect(LLM_CONFIGS.community.profileSettingKey).toBe('extractionProfile');
        expect(LLM_CONFIGS.community.maxTokens).toBe(2000);
        expect(LLM_CONFIGS.community.errorContext).toBe('Community summarization');
        expect(LLM_CONFIGS.community.timeoutMs).toBe(90000);
        expect(LLM_CONFIGS.community.getJsonSchema).toBeInstanceOf(Function);
    });
});

describe('LLM_CONFIGS split extraction', () => {
    it('has extraction_events config', () => {
        expect(LLM_CONFIGS.extraction_events).toBeDefined();
        expect(LLM_CONFIGS.extraction_events.maxTokens).toBe(4000);
    });

    it('has extraction_graph config', () => {
        expect(LLM_CONFIGS.extraction_graph).toBeDefined();
        expect(LLM_CONFIGS.extraction_graph.maxTokens).toBe(2000);
    });
});
