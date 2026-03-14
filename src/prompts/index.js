/**
 * OpenVault Prompts — Public API
 *
 * All LLM prompt builders centralized in src/prompts/.
 * Designed for mid-tier non-reasoning LLMs with clear, explicit structure.
 *
 * Universal prompt format (all builders):
 *   <role> → <language_rules> → <output_schema> → <rules> → <examples>
 *
 * Anti-refusal design: mechanical/pipeline framing, positive accuracy language,
 * no jailbreak-signature phrases, safe examples before harder ones.
 */

import { COMMUNITY_EXAMPLES } from './examples/communities.js';
import { EVENT_EXAMPLES } from './examples/events.js';
import { GRAPH_EXAMPLES } from './examples/graph.js';
import { INSIGHT_EXAMPLES } from './examples/insights.js';
import { QUESTION_EXAMPLES } from './examples/questions.js';
import { UNIFIED_REFLECTION_EXAMPLES } from './examples/reflections.js';
import { GLOBAL_SYNTHESIS_EXAMPLES } from './examples/global-synthesis.js';
import {
    assembleSystemPrompt,
    buildMessages,
    formatCharacters,
    formatEstablishedMemories,
    resolveLanguageInstruction,
} from './formatters.js';
import {
    PREFILL_PRESETS,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
} from './preambles.js';
import { COMMUNITIES_ROLE, EVENT_ROLE, GRAPH_ROLE, INSIGHTS_ROLE, QUESTIONS_ROLE, UNIFIED_REFLECTION_ROLE } from './roles.js';

// Re-export public API from submodules
export {
    PREFILL_PRESETS,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
};

// =============================================================================
// SCHEMAS (per-prompt JSON output definitions)
// =============================================================================

const EVENT_SCHEMA = `You MUST respond with your analysis FIRST inside <think> tags, THEN EXACTLY ONE JSON object.

First, output your analysis inside <think> tags.
THEN, output EXACTLY ONE JSON object with this structure:

{
  "events": [
    {
      "summary": "8-25 word description of what happened, past tense",
      "importance": 3,
      "characters_involved": ["CharacterName"],
      "witnesses": [],
      "location": null,
      "is_secret": false,
      "emotional_impact": {"CharacterName": "emotion description"},
      "relationship_impact": {"CharacterA->CharacterB": "how relationship changed"}
    }
  ]
}

CRITICAL FORMAT RULES — violating ANY of these will cause a system error:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ]. NEVER wrap your entire response in [ ].
2. The key "events" MUST always be present.
3. If nothing was found, use empty array: "events": [].
4. Do NOT wrap output in markdown code blocks (no \\\`\\\`\\\`json).
5. Do NOT include ANY text outside the <think> tags and the JSON object.
6. Keep character names exactly as they appear in the input.
7. Start your response with { after the </think> close tag. No other wrapping.`;

const GRAPH_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. Nothing else — no markdown fences, no commentary, no text before or after.

The JSON object MUST have this EXACT structure with BOTH top-level keys present:

{
  "entities": [
    {
      "name": "Entity Name",
      "type": "PERSON",
      "description": "Brief description of this entity based on what is known"
    }
  ],
  "relationships": [
    {
      "source": "Entity A",
      "target": "Entity B",
      "description": "How A relates to B"
    }
  ]
}

CRITICAL FORMAT RULES — violating ANY of these will cause a system error:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ]. NEVER wrap your entire response in [ ].
2. BOTH keys ("entities", "relationships") MUST always be present.
3. If nothing was found, use empty arrays: "entities": [], "relationships": [].
4. Do NOT wrap output in markdown code blocks (no \\\`\\\`\\\`json).
5. You MAY use <thinking> tags for reasoning before providing the JSON.
   The JSON object must still be valid and parseable.
6. "type" for entities MUST be one of: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT.`;

const QUESTIONS_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

The JSON object MUST have this EXACT structure:

{
  "questions": ["question 1", "question 2", "question 3"]
}

CRITICAL FORMAT RULES:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. The "questions" array MUST contain EXACTLY 3 strings.
3. Do NOT wrap output in markdown code blocks.
4. Do NOT include ANY text outside the JSON object.`;

const UNIFIED_REFLECTION_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

The JSON object MUST have this EXACT structure:

{
  "reflections": [
    {
      "question": "A salient high-level question about the character",
      "insight": "A deep psychological insight answering the question",
      "evidence_ids": ["id1", "id2"]
    }
  ]
}

CRITICAL FORMAT RULES:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. The "reflections" array MUST contain 1 to 3 reflection objects.
3. Each reflection MUST have "question", "insight" (strings) and "evidence_ids" (array of strings).
4. Do NOT wrap output in markdown code blocks.
5. You MAY use <thinking> tags for reasoning before providing the JSON.
   The JSON object must still be valid and parseable.

CRITICAL ID GROUNDING RULE:
For "evidence_ids", you MUST ONLY use the exact IDs shown in the <recent_memories> list.
Do NOT invent, hallucinate, or modify IDs. If you cannot find the exact ID in the list, use an empty array [].`;

const INSIGHTS_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

The JSON object MUST have this EXACT structure:

{
  "insights": [
    {
      "insight": "A concise high-level statement about the character",
      "evidence_ids": ["memory_id_1", "memory_id_2"]
    }
  ]
}

CRITICAL FORMAT RULES:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. The "insights" array MUST contain 1 to 3 insight objects.
3. Each insight MUST have both "insight" (string) and "evidence_ids" (array of strings).
4. Do NOT wrap output in markdown code blocks.
5. Do NOT include ANY text outside the JSON object.`;

const COMMUNITY_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

The JSON object MUST have this EXACT structure:

{
  "title": "Short name for this community (2-5 words)",
  "summary": "Executive summary of the community's structure, key entities, and dynamics",
  "findings": ["finding 1", "finding 2"]
}

CRITICAL FORMAT RULES:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "title" must be a short, specific name (2-5 words).
3. "summary" must be a comprehensive paragraph.
4. "findings" must be an array of 1-5 strings, each a key insight about the community.
5. Do NOT wrap output in markdown code blocks.
6. You MAY use <thinking> tags for reasoning before providing the JSON.
   The JSON object must still be valid and parseable.`;

const GLOBAL_SYNTHESIS_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

The JSON object MUST have this EXACT structure:

{
  "global_summary": "A 300-token overarching summary of the current story state"
}

CRITICAL FORMAT RULES:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "global_summary" must be a single comprehensive string.
3. Do NOT wrap output in markdown code blocks.
4. You MAY use <thinking> tags for reasoning before providing the JSON.
   The JSON object must still be valid and parseable.`;

// =============================================================================
// RULES (per-prompt task-specific rules)
// =============================================================================

const EVENT_RULES = `<precision>
Event summaries MUST be complete, highly descriptive sentences (minimum 6 words, 30 characters).
Do not extract fragmented thoughts or micro-actions like "Character breathed" or "She nodded."

Core principle: Name the exact action, emotion, or revelation. The output summary must preserve the source text's level of specificity. A vague generalization where the source has a concrete event is an extraction error.

- Physical actions: specify the exact act, method, and participants as described in the source
- Emotional events: name the specific emotion and its cause
- Revelations: state the exact information that was disclosed
- Combat: name the weapon, target, and outcome

A correct extraction preserves all source specificity.
An incorrect extraction loses detail through generalization.

These are all WRONG — information destroyed by vagueness:
✗ "they got intimate" ✗ "combat occurred" ✗ "feelings were expressed" ✗ "a secret was shared" ✗ "things escalated"
</precision>

<dedup>
This is the MOST IMPORTANT rule. Duplicating memories already in established_memories is the worst error.

BEFORE creating ANY event, you MUST check the <established_memories> section in the user message.

If a scene is already recorded there, DO NOT repeat the same actions. Instead, look for the NEWEST change within that scene:
1. A shift in emotional state (e.g., confidence → vulnerability, pleasure → discomfort).
2. A new phase or escalation (e.g., foreplay → penetration, sparring → real fight).
3. The scene concluding (e.g., climax, falling asleep, location change, combat ends).
4. A power dynamic reversal (e.g., submissive takes control, ambush turns into retreat).
5. A new element changing the scene's nature (new character arrives, weapon drawn, secret revealed).
6. A safeword explicitly used to halt the scene.

If the messages contain ONLY a continuation of the exact same action with no shift, escalation, or conclusion — then output "events": [].

When in doubt, extract a brief progression event rather than output nothing. The system will automatically filter true duplicates.
</dedup>

<importance_scale>
Rate each event from 1 (trivial) to 5 (critical):

1 — Trivial: Quick greeting, passing touch, mundane small talk. Usually skip these entirely.
2 — Minor: Standard continuation of an established dynamic. Routine intimate acts between characters already in a sexual relationship. Repeated daily actions.
3 — Notable: Meaningful conversation, change of location or scene, new emotional context, minor secret shared, notable gift.
4 — Significant: A major narrative shift, deep emotional vulnerability, first use of a safeword, establishing a new relationship dynamic, a major argument or confrontation.
     Do NOT rate every intimate act as 4. If characters already have an established intimate relationship, routine acts are 2 or 3. Reserve 4 for narrative milestones.
5 — Critical: Life-changing events — first "I love you", pregnancy discovery, major betrayal revealed, permanent relationship change, character death.
</importance_scale>

<thinking_process>
Follow these steps IN ORDER. Write your work inside <think> tags BEFORE outputting the JSON:

Step 1: List the specific actions, emotions, and facts in the new messages.
Step 2: Check <established_memories>. Is any of this already recorded?
Step 3: Apply dedup rules. If this is a continuation, look for the newest progression. If there is none at all, plan to output "events": [].
Step 4: For genuinely NEW events, assign importance (1-5) and write a specific factual summary.
Step 5: Output the final JSON object with the "events" key.
</thinking_process>`;

const GRAPH_RULES = `Extract ALL named entities mentioned or clearly implied in the messages:
- PERSON: Named characters, NPCs, people mentioned by name
- PLACE: Named locations, buildings, rooms, cities, regions
- ORGANIZATION: Named groups, factions, guilds, companies
- OBJECT: Highly significant unique items, weapons, or plot devices. Do NOT extract mundane furniture, clothing, or food unless they are critical to the scene's dynamic
- CONCEPT: Named abilities, spells, diseases, prophecies

Also extract relationships between pairs of entities when the connection is stated or clearly implied.

IMPORTANT: Extract entities and relationships even when no events are extracted. Entity data builds world knowledge over time and is always valuable.`;

const QUESTIONS_RULES = `1. Questions should be answerable from the provided memory stream.
2. Focus on patterns, changes, and emotional arcs — not individual events.
3. Good questions ask about: psychological state, evolving relationships, shifting goals, recurring fears, unresolved conflicts.`;

const UNIFIED_REFLECTION_RULES = `1. Generate 1-3 salient high-level questions about the character's psychological state, relationships, goals, or unresolved conflicts.
2. For each question, provide a deep insight that synthesizes patterns across multiple memories.
3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown in the input.
4. Quality over quantity — generate only as many reflections as you can support with strong evidence.`;

const INSIGHTS_RULES = `1. Each insight must be a concise, high-level statement — not a restatement of a single memory.
2. Each insight must cite specific memory IDs as evidence.
3. Insights should reveal patterns, emotional arcs, or relationship dynamics.
4. Synthesize across multiple memories when possible.`;

const COMMUNITY_RULES = `1. Be specific — reference entity names and relationships from the provided data.
2. Capture the narrative significance of the group.
3. Describe power dynamics, alliances, conflicts, and dependencies.
4. Use EXACT entity names from the input data — do NOT transliterate, abbreviate, or translate entity names. If the input shows "Vova", use "Vova" — not "Во", "Вова", or any other variant.`;

// =============================================================================
// GLOBAL SYNTHESIS (New for Phase 2)
// =============================================================================

const GLOBAL_SYNTHESIS_ROLE = `You are a narrative synthesis expert. Your task is to weave multiple community summaries into a single, coherent global narrative that captures the current state of the story.

Focus on:
- Macro-level relationships and tensions between communities
- Overarching plot trajectory and unresolved conflicts
- Thematic connections across different story threads
- The "big picture" of what is happening in the world

Write in a storytelling style that emphasizes patterns, evolution, and cause-effect relationships across communities. Your summary should feel like a narrator stepping back to describe the forest rather than individual trees.`;

const GLOBAL_SYNTHESIS_RULES = `1. Synthesize ALL provided communities into a cohesive narrative.
2. Focus on connections between communities (shared characters, causal links, thematic parallels).
3. Capture the current trajectory: where is the story heading? What tensions are building?
4. Keep the summary under ~300 tokens (approximately 225 words).
5. Reference community titles to ground your synthesis in specific details.`;

// =============================================================================
// EDGE CONSOLIDATION
// =============================================================================

const EDGE_CONSOLIDATION_ROLE = `You are a relationship state synthesizer for a knowledge graph.
Combine multiple relationship description segments into a single, coherent summary that preserves narrative depth.`;

const EDGE_CONSOLIDATION_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

The JSON object MUST have this EXACT structure:

{
  "consolidated_description": "string - unified relationship summary that captures the evolution"
}

CRITICAL FORMAT RULES:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "consolidated_description" must be a single string under 100 tokens.
3. Do NOT wrap output in markdown code blocks.
4. You MAY use <thinking> tags for reasoning before providing the JSON.
   The JSON object must still be valid and parseable.`;

const EDGE_CONSOLIDATION_RULES = `1. Summarize the CURRENT dynamic, but preserve critical historical shifts.
2. For example: "Started as enemies, but allied after the dragon incident; now close friends."
3. If the relationship has evolved significantly, capture that trajectory concisely.
4. Keep the description under 100 tokens.
5. Use EXACT entity names from the input data — do NOT transliterate, abbreviate, or translate names.`;

// =============================================================================
// PUBLIC API — PROMPT BUILDERS
// =============================================================================

/**
 * Build the event extraction prompt (Stage 1).
 * Extracts events only, not entities or relationships.
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildEventExtractionPrompt({
    messages,
    names,
    context = {},
    preamble,
    prefill,
    outputLanguage = 'auto',
}) {
    const { char: characterName, user: userName } = names;
    const {
        memories: existingMemories = [],
        charDesc: characterDescription = '',
        personaDesc: personaDescription = '',
    } = context;

    const systemPrompt = assembleSystemPrompt({
        role: EVENT_ROLE,
        schema: EVENT_SCHEMA,
        rules: EVENT_RULES,
        examples: EVENT_EXAMPLES,
        outputLanguage,
    });

    const memoriesSection = formatEstablishedMemories(existingMemories);
    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextParts = [memoriesSection, charactersSection].filter(Boolean).join('\n');
    const contextSection = contextParts ? `<context>\n${contextParts}\n</context>\n` : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>
${languageInstruction}
Analyze the messages above. Extract events only.
Use EXACT character names: ${characterName}, ${userName}. Never transliterate these names into another script.
Write your analysis inside <think> tags FIRST, then output the JSON object with "events" key. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill ?? '<think>\n', preamble);
}

/**
 * Build the graph extraction prompt (Stage 2).
 * Extracts entities and relationships based on extracted events.
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildGraphExtractionPrompt({
    messages,
    names,
    extractedEvents = [],
    context = {},
    preamble,
    prefill,
    outputLanguage = 'auto',
}) {
    if (!prefill) {
        throw new Error('buildGraphExtractionPrompt: prefill is required');
    }
    const { char: characterName, user: userName } = names;
    const { charDesc: characterDescription = '', personaDesc: personaDescription = '' } = context;

    const systemPrompt = assembleSystemPrompt({
        role: GRAPH_ROLE,
        schema: GRAPH_SCHEMA,
        rules: GRAPH_RULES,
        examples: GRAPH_EXAMPLES,
        outputLanguage,
    });

    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextSection = charactersSection ? `<context>\n${charactersSection}\n</context>\n` : '';
    const eventsSection =
        extractedEvents.length > 0 ? `<extracted_events>\n${extractedEvents.join('\n')}\n</extracted_events>\n` : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>

${eventsSection}${languageInstruction}
Based on the messages${extractedEvents.length > 0 ? ' and extracted events above' : ''}, extract named entities and relationships.
Use EXACT character names: ${characterName}, ${userName}. Never transliterate these names into another script.
Respond with a single JSON object containing 'entities' and 'relationships' keys. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

/**
 * Build the unified reflection prompt.
 * Combines question generation and insight extraction into a single call.
 * @param {string} characterName
 * @param {Array} recentMemories - Top 100 recent memories
 * @param {string} preamble
 * @param {string} outputLanguage
 * @param {string} prefill - Required prefill for assistant message
 * @returns {object} { system, user } prompt object
 */
export function buildUnifiedReflectionPrompt(characterName, recentMemories, preamble, outputLanguage = 'auto', prefill) {
    // Validate prefill parameter
    if (!prefill) {
        throw new Error('buildUnifiedReflectionPrompt: prefill is required');
    }

    // Detect if candidate set contains existing reflections (for level-aware synthesis)
    const hasOldReflections = recentMemories.some(m => m.type === 'reflection' && (m.level || 1) >= 1);

    // Format memories with level indicator for reflections
    const memoryList = recentMemories.map((m) => {
        const importance = '★'.repeat(m.importance || 3);
        const levelIndicator = m.type === 'reflection' ? ` [Ref L${m.level || 1}]` : '';
        return `${m.id}. [${importance}]${levelIndicator} ${m.summary}`;
    }).join('\n');

    // Use level-aware rules if old reflections are present
    const rules = hasOldReflections
        ? UNIFIED_REFLECTION_RULES + '\n\nLEVEL-AWARE SYNTHESIS:\n' +
          '5. Some candidate memories are existing reflections (marked [Ref L1], [Ref L2], etc.).\n' +
          '6. You may synthesize multiple existing reflections into higher-level insights (Level 2+).\n' +
          '7. Level 2 reflections should distill common patterns across multiple Level 1 reflections.\n' +
          '8. When synthesizing reflections, cite the reflection IDs as evidence_ids.'
        : UNIFIED_REFLECTION_RULES;

    const systemPrompt = assembleSystemPrompt({
        role: UNIFIED_REFLECTION_ROLE,
        schema: UNIFIED_REFLECTION_SCHEMA,
        rules,
        examples: UNIFIED_REFLECTION_EXAMPLES,
        outputLanguage,
    });

    const languageInstruction = resolveLanguageInstruction(memoryList, outputLanguage);

    // Add level-aware instruction to user prompt if old reflections present
    const levelAwareInstruction = hasOldReflections
        ? `\n\nLEVEL-AWARE SYNTHESIS MODE:\nSome memories are existing reflections (marked [Ref L1], [Ref L2]). You may synthesize them into higher-level meta-insights.\n- Level 2 insights should distill common patterns across multiple Level 1 reflections.\n- When synthesizing reflections, cite the reflection IDs as evidence_ids.\n`
        : '';

    const userPrompt = `<character>${characterName}</character>

<recent_memories>
${memoryList}
</recent_memories>

${languageInstruction}${levelAwareInstruction}
Based on these memories about ${characterName}:
1. Generate 1-3 salient high-level questions about their current psychological state, relationships, goals, or unresolved conflicts.
2. For each question, provide a deep insight that synthesizes patterns across the memories.
3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown above.

Respond with a single JSON object containing a "reflections" array with 1-3 items. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

/**
 * Build the edge consolidation prompt.
 * @param {Object} edgeData - Edge object with source, target, description, weight
 * @param {string} [preamble] - System preamble (anti-refusal framing)
 * @param {string} [outputLanguage='auto'] - Output language setting
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildEdgeConsolidationPrompt(edgeData, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildEdgeConsolidationPrompt: prefill is required');
    }

    const systemPrompt = assembleSystemPrompt({
        role: EDGE_CONSOLIDATION_ROLE,
        schema: EDGE_CONSOLIDATION_SCHEMA,
        rules: EDGE_CONSOLIDATION_RULES,
        examples: [],
        outputLanguage,
    });

    const segments = edgeData.description.split(' | ');
    const segmentText = segments.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const languageInstruction = resolveLanguageInstruction(segmentText, outputLanguage);
    const userPrompt = `<edge_data>
Source: ${edgeData.source}
Target: ${edgeData.target}
Weight: ${edgeData.weight}

Timeline segments:
${segmentText}
</edge_data>
${languageInstruction}
Synthesize these relationship developments into ONE unified description.
Respond with a single JSON object containing "consolidated_description". No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

/**
 * Build the community summarization prompt.
 * @param {string[]} nodeLines - Formatted node descriptions
 * @param {string[]} edgeLines - Formatted edge descriptions
 * @param {string} preamble - System preamble (anti-refusal framing)
 * @param {string} outputLanguage - Output language setting
 * @param {string} prefill - Required prefill for assistant message
 * @returns {Array<{role: string, content: string}>}
 */
export function buildCommunitySummaryPrompt(nodeLines, edgeLines, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildCommunitySummaryPrompt: prefill is required');
    }
    const systemPrompt = assembleSystemPrompt({
        role: COMMUNITIES_ROLE,
        schema: COMMUNITY_SCHEMA,
        rules: COMMUNITY_RULES,
        examples: COMMUNITY_EXAMPLES,
        outputLanguage,
    });

    const entityText = nodeLines.join('\n');
    const languageInstruction = resolveLanguageInstruction(entityText, outputLanguage);
    const userPrompt = `<community_entities>
${entityText}
</community_entities>

<community_relationships>
${edgeLines.join('\n')}
</community_relationships>
${languageInstruction}
Write a comprehensive report about this community of entities.
Respond with a single JSON object containing title, summary, and 1-5 findings. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

/**
 * Build the global synthesis prompt for Map-Reduce over communities.
 * @param {Object[]} communities - Array of community objects with { title, summary, findings }
 * @param {string} preamble - System preamble (anti-refusal framing)
 * @param {string} outputLanguage - Output language setting ('auto'|'en'|'ru')
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildGlobalSynthesisPrompt(communities, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildGlobalSynthesisPrompt: prefill is required');
    }

    const systemPrompt = assembleSystemPrompt({
        role: GLOBAL_SYNTHESIS_ROLE,
        schema: GLOBAL_SYNTHESIS_SCHEMA,
        rules: GLOBAL_SYNTHESIS_RULES,
        examples: GLOBAL_SYNTHESIS_EXAMPLES,
        outputLanguage,
    });

    const communityText = communities.map((c, i) =>
        `${i + 1}. ${c.title}\n${c.summary}${c.findings?.length ? '\nKey findings: ' + c.findings.join('; ') : ''}`
    ).join('\n\n');

    const languageInstruction = resolveLanguageInstruction(communityText, outputLanguage);
    const userPrompt = `<communities>
${communityText}
</communities>

${languageInstruction}
Synthesize these community summaries into a single global narrative (max ~300 tokens).
Focus on macro-relationships, overarching tensions, and plot trajectory.

Respond with a single JSON object containing "global_summary". No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
