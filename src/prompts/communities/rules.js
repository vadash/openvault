/**
 * Task-specific rules for community summarization and global synthesis.
 */

export const COMMUNITY_RULES = `1. Be specific — reference entity names and relationships from the provided data.
2. Capture the narrative significance of the group.
3. Describe power dynamics, alliances, conflicts, and dependencies.
4. Use EXACT entity names from the input data — do NOT transliterate, abbreviate, or translate entity names. If the input shows "Vova", use "Vova" — not "Во", "Вова", or any other variant.

<draft_process>
Think step by step, but only keep a minimal draft for each step, with 8 words at most per step. Use symbols: -> for causation/actions, + for conjunction, != for contrast. Write your work inside <think/> tags BEFORE outputting the JSON:

Step 1: Entity inventory -> list Entity(type) from data.
Step 2: Relationship map -> Entity + Entity; rel: nature/direction.
Step 3: Dynamics -> power + alliances + conflicts + dependencies.
Step 4: Output -> title + summary + findings.
</draft_process>`;

export const GLOBAL_SYNTHESIS_RULES = `1. Synthesize ALL provided communities into a cohesive narrative.
2. Focus on connections between communities (shared characters, causal links, thematic parallels).
3. Capture the current trajectory: where is the story heading? What tensions are building?
4. Keep the summary under ~300 tokens (approximately 225 words).
5. Reference community titles to ground your synthesis in specific details.

<draft_process>
Think step by step, but only keep a minimal draft for each step, with 8 words at most per step. Use symbols: -> for causation/actions, + for conjunction, != for contrast. Write your work inside <think/> tags BEFORE outputting the JSON:

Step 1: Community scan -> core conflict + key entities per group.
Step 2: Cross-links -> shared chars + causal + thematic parallels.
Step 3: Narrative arc -> trajectory + tensions + convergence points.
</draft_process>`;
