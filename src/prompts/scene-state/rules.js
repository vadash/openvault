/**
 * Task-specific rules for scene state extraction.
 */

export const SCENE_STATE_RULES = `1. State Inertia (Preservation): Carry forward unchanged fields from the previous state. If location/time is not explicitly mentioned as changing, preserve it. If a character's clothing is not described as changing, keep the previous clothing list. Characters not mentioned in the new messages remain in the state unchanged.

2. Stale Character Eviction: If a character has not been mentioned or referenced for 3+ message turns, remove them from the characters map. This prevents accumulating characters who have left the scene.

3. Clothing Transition: When clothing changes are described, replace the entire clothing array for that character. Do not merge or append — a change of outfit means the previous outfit is gone.

4. Prop Eviction: Props that are used, consumed, discarded, or removed from the immediate scene should be removed from active_props. Only track props currently present and relevant to the immediate physical environment.

<draft_process>
Think step by step, but only keep a minimal draft for each step, with 8 words at most per step. Use symbols: -> for causation/actions, + for conjunction, != for contrast. Write your work inside <think/> tags BEFORE outputting the JSON:

Step 1: Location/Time -> unchanged OR new value.
Step 2: Characters mentioned -> update posture/clothing/status.
Step 3: Characters unmentioned -> carry OR evict (>3 turns).
Step 4: Props -> present props only, evict used/consumed.
Step 5: Output -> JSON with all current state fields.
</draft_process>`;