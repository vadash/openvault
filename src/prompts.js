/**
 * OpenVault Prompts
 *
 * All LLM prompts centralized in one file.
 */

import { sortMemoriesBySequence } from './utils.js';

// =============================================================================
// SYSTEM PROMPTS (used in llm.js)
// =============================================================================

export const SYSTEM_PROMPTS = {
    extraction: `You extract narrative events from roleplay messages into structured JSON.

Your task: Identify significant events (actions, revelations, emotional shifts, relationship changes) and record them as past-tense factual summaries. Skip mundane dialogue and already-recorded events.

Output valid JSON only. No markdown, no explanatory text.`,

    retrieval: `You select which memories a character would naturally recall given the current scene.

Prioritize: high-importance events, direct relevance to current topics, relationship history with present characters, emotional continuity, and recent context.

Output valid JSON only. No markdown, no explanatory text.`
};

// =============================================================================
// EXTRACTION PROMPT
// =============================================================================

/**
 * Build the extraction prompt
 * @param {Object} options - Extraction prompt options
 * @param {string} options.messages - Formatted messages to analyze
 * @param {Object} options.names - Character names
 * @param {string} options.names.char - Main character name
 * @param {string} options.names.user - User character name
 * @param {Object} [options.context] - Additional context
 * @param {Object[]} [options.context.memories] - Recent memories for context
 * @param {string} [options.context.charDesc] - Character card description
 * @param {string} [options.context.personaDesc] - User persona description
 * @returns {string} The extraction prompt
 */
export function buildExtractionPrompt({ messages, names, context = {} }) {
    const { char: characterName, user: userName } = names;
    const { memories: existingMemories = [], charDesc: characterDescription = '', personaDesc: personaDescription = '' } = context;

    // Build character context section if we have descriptions
    let characterContextSection = '';
    if (characterDescription || personaDescription) {
        characterContextSection = '<characters>\n';
        if (characterDescription) {
            characterContextSection += `<character name="${characterName}" role="main">\n${characterDescription}\n</character>\n`;
        }
        if (personaDescription) {
            characterContextSection += `<character name="${userName}" role="user">\n${personaDescription}\n</character>\n`;
        }
        characterContextSection += '</characters>\n\n';
    } else {
        characterContextSection = `<characters>
<character name="${characterName}" role="main"/>
<character name="${userName}" role="user"/>
</characters>\n\n`;
    }

    // Build memory context section if we have existing memories
    let memoryContextSection = '';
    if (existingMemories && existingMemories.length > 0) {
        const memorySummaries = sortMemoriesBySequence(existingMemories, true)
            .map((m, i) => `${i + 1}. [${m.event_type || 'event'}] ${m.summary}`)
            .join('\n');

        memoryContextSection = `<established_memories>
Events already recorded - DO NOT extract duplicates.
A duplicate is any event with the SAME core action, even if worded differently.

${memorySummaries}

DEDUPLICATION RULES:
- Same action + same characters = SKIP even if new details mentioned
- Progression of same event = SKIP, don't create new entry
- Only extract if fundamentally NEW action occurred
</established_memories>\n\n`;
    }

    return `${characterContextSection}${memoryContextSection}<messages>
${messages}
</messages>

<task>
Extract NEW significant events from the messages above. For each event, provide:

<event_types>
<type name="action">Physical actions, movements, combat, significant gestures</type>
<type name="revelation">New information disclosed, secrets shared, backstory revealed</type>
<type name="emotion_shift">Significant emotional changes, mood shifts, reactions</type>
<type name="relationship_change">Trust gained/lost, bonds formed/broken, status changes</type>
</event_types>

<importance_scale>
1 = Minor detail (passing mention)
2 = Notable (worth remembering)
3 = Significant (affects story)
4 = Major event (turning point)
5 = Critical (story-changing moment)
</importance_scale>

<summary_guidelines>
Write summaries that are:
- Maximum 24 words, typically 12
- English only (more token-efficient)
- Past tense ALWAYS: describe what HAPPENED, not what is happening
  BAD: "Elena confesses to the crime." (present tense - implies occurring now)
  GOOD: "Elena confessed to the crime during the interrogation." (past tense)
- Temporal context: anchor the event when possible
  BAD: "Elena killed her brother."
  GOOD: "Elena killed her brother to prevent Empire betrayal."
- Action-focused: describe WHAT happened, not feelings
- Non-redundant: don't repeat event_type in summary
  BAD: "Elena reveals she killed her brother" (redundant "reveals")
  GOOD: "Elena killed her brother to prevent Empire betrayal"
- Factual: emotions go in emotional_impact, not summary
  BAD: "Elena breaks down crying, overwhelmed with guilt, confessing..."
  GOOD: "Elena confessed to killing her brother"
</summary_guidelines>

<character_name_rules>
CRITICAL: Use EXACTLY the character names from <characters> section above.
- Never transliterate names (keep original language/spelling)
- Never use nicknames, aliases, or personas - always use main character name
- For witnesses/involved: use exact names, not descriptions like "shoppers" or "staff"

Example - if <characters> defines names as "Катя" and "Дима":
CORRECT: "characters_involved": ["Катя", "Дима"]
WRONG: "characters_involved": ["Katya", "Dima"] (transliterated)
WRONG: "characters_involved": ["Kate", "shoppers"] (anglicized, unnamed NPC)

Example - if character "Дима" adopts persona "Лили":
CORRECT: "characters_involved": ["Дима"] (always use main name)
WRONG: "characters_involved": ["Лили"] (alias - use main name instead)
WRONG: "characters_involved": ["Дима/Лили"] (don't combine names)
</character_name_rules>

<output_schema>
{
  "event_type": "action|revelation|emotion_shift|relationship_change",
  "importance": 1-5,
  "summary": "24 words max, factual, English only",
  "characters_involved": ["names"],
  "witnesses": ["names who observed"],
  "location": "where or null",
  "is_secret": true/false,
  "emotional_impact": {"Name": "1-3 word emotion"},
  "relationship_impact": {"A->B": "1-3 word change"}
}
</output_schema>

<example>
Input: "[Elena]: *She finally breaks down, tears streaming* I killed him. My own brother. He was going to betray us all to the Empire."

Output:
[
  {
    "event_type": "revelation",
    "importance": 5,
    "summary": "Elena confessed to killing her brother to prevent betrayal.",
    "characters_involved": ["Elena"],
    "witnesses": ["Elena", "Marcus"],
    "location": null,
    "is_secret": true,
    "emotional_impact": {"Elena": "guilt, grief"},
    "relationship_impact": {"Elena->Marcus": "trust deepened"}
  }
]
</example>

<example>
Input: "[Катя]: *краснея* Я видела твой дневник... Ты писал обо мне."

Output:
[
  {
    "event_type": "revelation",
    "importance": 4,
    "summary": "Катя admitted to reading Дима's diary entries about her.",
    "characters_involved": ["Катя"],
    "witnesses": ["Катя", "Дима"],
    "location": null,
    "is_secret": true,
    "emotional_impact": {"Катя": "embarrassed"},
    "relationship_impact": {"Катя->Дима": "vulnerability shown"}
  }
]
</example>

<negative_examples>
DO NOT extract:
- Mundane dialogue: greetings, small talk, filler
- Already-recorded events with minor new details
- Internal thoughts without external action
- Events implied but not explicitly shown

BAD summary examples:
- "Elena finally breaks down, tears streaming as she confesses..." (too long, emotional)
- "A shocking revelation occurs when Elena admits..." (meta-commentary)
- "Elena reveals important information about..." (vague, redundant with event_type)
</negative_examples>

Instructions:
1. Extract only significant events for story continuity
2. Skip mundane exchanges, small talk, and internal monologue
3. Write summaries in PAST TENSE, English, 8-24 words, action-focused
4. Include temporal context when possible (during X, after Y)
5. Put emotions in emotional_impact field, not summary
6. Use witnesses field to track who knows about each event${existingMemories.length > 0 ? '\n7. Check <established_memories> - skip semantic duplicates' : ''}

Return JSON array. Empty array [] if no significant NEW events.
</task>`;
}

// =============================================================================
// SMART RETRIEVAL PROMPT
// =============================================================================

/**
 * Build the smart retrieval prompt
 * @param {string} recentContext - Recent chat context
 * @param {string} numberedList - Numbered list of memories
 * @param {string} characterName - POV character name
 * @param {number} limit - Maximum memories to select
 * @returns {string} The smart retrieval prompt
 */
export function buildSmartRetrievalPrompt(recentContext, numberedList, characterName, limit) {
    return `<scene>
${recentContext}
</scene>

<memories>
${numberedList}
</memories>

<task>
Select up to ${limit} memories that ${characterName} would most naturally recall for this scene.

<selection_criteria>
- High importance (★★★★★) events take priority over low importance ones
- Direct relevance to current conversation topics or characters mentioned
- Relationship history with characters present in the scene
- Emotional continuity (past feelings toward people/places being discussed)
- Secrets or private knowledge relevant to the situation
- Recent events that provide immediate context
</selection_criteria>

<output_format>
{"selected": [1, 4, 7], "reasoning": "Brief explanation"}
</output_format>

<example>
Scene mentions: Elena asking about the old castle
Available: 1. [★★] Visited market yesterday, 2. [★★★★] Discovered hidden passage in castle, 3. [★] Had breakfast
Output: {"selected": [2], "reasoning": "The hidden passage discovery is directly relevant to discussing the castle"}
</example>

Return only the JSON object with selected memory numbers (1-indexed) and reasoning.
</task>`;
}
