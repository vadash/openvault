import { z } from 'https://esm.sh/zod@4';

/**
 * Schema for smart retrieval LLM response
 * Reasoning first to enable chain-of-thought before selection.
 */
export const RetrievalResponseSchema = z.object({
    reasoning: z.string().nullable().default(null),
    selected: z.array(z.number().int().min(1)),
});
