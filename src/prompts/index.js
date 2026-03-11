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
5. Do NOT include ANY text outside the JSON object.
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
5. Do NOT include ANY text outside the JSON object.

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
6. Do NOT include ANY text outside the JSON object.`;

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

If an intimate, combat, or social scene is ALREADY recorded there, DO NOT extract every new physical action (e.g., position changes, new implements, individual gestures, routine dialogue). ONLY create a new event if ONE of these conditions is true:
1. The scene concludes (e.g., climax, falling asleep, location change, combat ends).
2. The power dynamic fundamentally reverses (e.g., submissive takes control, ambush turns into retreat).
3. A safeword is explicitly used to halt the scene.
4. A fundamentally NEW type of action begins (e.g., conversation → combat, foreplay → penetration).
5. A new element changes the scene's nature (new character arrives, weapon drawn, secret revealed).

If NONE of those conditions apply, the current messages are continuing an existing scene.
In that case, you MUST set "events" to an empty array [].

When in doubt, output fewer events rather than duplicate existing memories.
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
Step 3: Apply dedup rules. If this is a continuation with no escalation, plan to output "events": [].
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
    outputLanguage = 'auto',
}) {
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

    return buildMessages(systemPrompt, userPrompt, '{', preamble);
}

/**
 * Build the salient questions prompt for reflection step 1.
 * @param {string} characterName
 * @param {Object[]} recentMemories - Recent memories (both events and reflections)
 * @returns {Array<{role: string, content: string}>}
 */
export function buildSalientQuestionsPrompt(characterName, recentMemories, preamble, outputLanguage = 'auto') {
    const memoryList = recentMemories.map((m, i) => `${i + 1}. [${m.importance || 3} Star] ${m.summary}`).join('\n');

    const systemPrompt = assembleSystemPrompt({
        role: QUESTIONS_ROLE,
        schema: QUESTIONS_SCHEMA,
        rules: QUESTIONS_RULES,
        examples: QUESTION_EXAMPLES,
        outputLanguage,
    });

    const languageInstruction = resolveLanguageInstruction(memoryList, outputLanguage);
    const userPrompt = `<character>${characterName}</character>

<recent_memories>
${memoryList}
</recent_memories>
${languageInstruction}
Based on these memories, what are the 3 most important high-level questions about ${characterName}'s current psychological state, relationships, and goals?
Respond with a single JSON object containing exactly 3 questions. No other text.`;

    return buildMessages(systemPrompt, userPrompt, '{', preamble);
}

/**
 * Build the insight extraction prompt for reflection step 2.
 * @param {string} characterName
 * @param {string} question - The salient question to answer
 * @param {Object[]} relevantMemories - Memories relevant to this question
 * @returns {Array<{role: string, content: string}>}
 */
export function buildInsightExtractionPrompt(
    characterName,
    question,
    relevantMemories,
    preamble,
    outputLanguage = 'auto'
) {
    const memoryList = relevantMemories.map((m) => `${m.id}. ${m.summary}`).join('\n');

    const systemPrompt = assembleSystemPrompt({
        role: INSIGHTS_ROLE,
        schema: INSIGHTS_SCHEMA,
        rules: INSIGHTS_RULES,
        examples: INSIGHT_EXAMPLES,
        outputLanguage,
    });

    const languageInstruction = resolveLanguageInstruction(memoryList, outputLanguage);
    const userPrompt = `<character>${characterName}</character>

<question>${question}</question>

<memories>
${memoryList}
</memories>
${languageInstruction}
Based on these memories about ${characterName}, extract 1-3 insights that answer the question above.
Cite specific memory IDs as evidence for each insight.
Respond with a single JSON object. No other text.`;

    return buildMessages(systemPrompt, userPrompt, '{', preamble);
}

/**
 * Build the unified reflection prompt.
 * Combines question generation and insight extraction into a single call.
 * @param {string} characterName
 * @param {Array} recentMemories - Top 100 recent memories
 * @param {string} preamble
 * @param {string} outputLanguage
 * @returns {object} { system, user } prompt object
 */
export function buildUnifiedReflectionPrompt(characterName, recentMemories, preamble, outputLanguage = 'auto') {
    const memoryList = recentMemories.map((m) =>
        `${m.id}. [${'★'.repeat(m.importance || 3)}] ${m.summary}`
    ).join('\n');

    const systemPrompt = assembleSystemPrompt({
        role: UNIFIED_REFLECTION_ROLE,
        schema: UNIFIED_REFLECTION_SCHEMA,
        rules: UNIFIED_REFLECTION_RULES,
        examples: UNIFIED_REFLECTION_EXAMPLES,
        outputLanguage,
    });

    const languageInstruction = resolveLanguageInstruction(memoryList, outputLanguage);
    const userPrompt = `<character>${characterName}</character>

<recent_memories>
${memoryList}
</recent_memories>

${languageInstruction}
Based on these memories about ${characterName}:
1. Generate 1-3 salient high-level questions about their current psychological state, relationships, goals, or unresolved conflicts.
2. For each question, provide a deep insight that synthesizes patterns across the memories.
3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown above.

Respond with a single JSON object containing a "reflections" array with 1-3 items. No other text.`;

    return buildMessages(systemPrompt, userPrompt, '{', preamble);
}

/**
 * Build the community summarization prompt.
 * @param {string[]} nodeLines - Formatted node descriptions
 * @param {string[]} edgeLines - Formatted edge descriptions
 * @returns {Array<{role: string, content: string}>}
 */
export function buildCommunitySummaryPrompt(nodeLines, edgeLines, preamble, outputLanguage = 'auto') {
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

    return buildMessages(systemPrompt, userPrompt, '{', preamble);
}
