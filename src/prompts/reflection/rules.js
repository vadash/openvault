/**
 * Task-specific rules for reflection, question, and insight prompts.
 */

export const UNIFIED_REFLECTION_RULES = `1. Generate 1-3 salient high-level questions about the character's psychological state, relationships, goals, or unresolved conflicts.
2. For each question, provide a deep insight that synthesizes patterns across multiple memories.
3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown in the input.
4. Quality over quantity — generate only as many reflections as you can support with strong evidence.

<thinking_process>
Follow these steps IN ORDER. Write your work inside <think> tags BEFORE outputting the JSON:

Step 1: Pattern scan — Identify recurring themes, emotional patterns, and behavioral clusters. Note a MAXIMUM of 5 relevant memory IDs. Do NOT list every ID.
Step 2: Causal chains — Trace cause-effect sequences linking memories together.
Step 3: Synthesis — For each question, formulate a high-level insight that connects multiple memories.
Step 4: Evidence — Assign specific memory IDs as evidence for each insight.
</thinking_process>`;

export const QUESTIONS_RULES = `1. Questions should be answerable from the provided memory stream.
2. Focus on patterns, changes, and emotional arcs — not individual events.
3. Good questions ask about: psychological state, evolving relationships, shifting goals, recurring fears, unresolved conflicts.`;

export const INSIGHTS_RULES = `1. Each insight must be a concise, high-level statement — not a restatement of a single memory.
2. Each insight must cite specific memory IDs as evidence.
3. Insights should reveal patterns, emotional arcs, or relationship dynamics.
4. Synthesize across multiple memories when possible.`;
