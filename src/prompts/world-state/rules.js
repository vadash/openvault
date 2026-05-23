/**
 * Task-specific rules for global world state synthesis.
 */

export const WORLD_STATE_RULES = `1. Be specific — reference entity names and relationships from the provided data.
2. Capture the narrative significance of the world state.
3. Describe power dynamics, alliances, conflicts, and dependencies.
4. Use EXACT entity names from the input data — do NOT transliterate, abbreviate, or translate entity names. If the input shows "Vova", use "Vova" — not "Во", "Вова", or any other variant.
5. Focus on macro-level patterns, not exhaustive detail.
6. STRICTLY PROHIBIT METADATA LEAKAGE: Do not reference technical database metrics, graph terminology, or numerical values from the input (e.g., do NOT mention terms like "weights", "mentions", "nodes", "edges", "connection weight (13)", "closed system of links"). Translate these numbers into qualitative narrative terms instead (e.g., instead of "connection weight 13", describe it as "exceptionally frequent, high-intensity interactions" or a "deeply recurring habit"). The final summary must read as a purely in-universe story overview.

<draft_process>
Think step by step, but only keep a minimal draft for each step, with 8 words at most per step. Use symbols: -> for causation/actions, + for conjunction, != for contrast. Write your work inside <think/> tags BEFORE outputting the JSON:

Step 1: Entity inventory -> list Entity(type) from data.
Step 2: Relationship map -> Entity + Entity; rel: nature/direction.
Step 3: Dynamics -> power + alliances + conflicts + dependencies.
Step 4: Output -> title + summary + findings.
</draft_process>`;
