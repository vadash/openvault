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
    extraction: `You are an expert narrative analyst specializing in roleplay and interactive fiction. Your expertise includes:
- Understanding character motivations and emotional dynamics
- Tracking relationship developments and story continuity
- Identifying significant plot events vs mundane exchanges
- Recognizing secrets, revelations, and character growth moments

Extract structured memory events from roleplay messages. Respond with valid JSON only, no markdown formatting or additional text.`,

    retrieval: `You are a narrative memory curator for interactive fiction. Your role is to select the most relevant memories a character would recall based on the current scene.

Consider what information the character would naturally remember given the conversation topics, relationships involved, and emotional context. Respond with valid JSON only, no markdown formatting or additional text.`
};

// =============================================================================
// EXTRACTION PROMPT
// =============================================================================

/**
 * Build the extraction prompt
 * @param {string} messagesText - Formatted messages to analyze
 * @param {string} characterName - Main character name
 * @param {string} userName - User character name
 * @param {Object[]} existingMemories - Recent memories for context (optional)
 * @param {string} characterDescription - Character card description (optional)
 * @param {string} personaDescription - User persona description (optional)
 * @returns {string} The extraction prompt
 */
export function buildExtractionPrompt(messagesText, characterName, userName, existingMemories = [], characterDescription = '', personaDescription = '') {
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
The following events have already been recorded. Do NOT duplicate these.
${memorySummaries}
</established_memories>\n\n`;
    }

    return `${characterContextSection}${memoryContextSection}<messages>
${messagesText}
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

<output_schema>
{
  "event_type": "action|revelation|emotion_shift|relationship_change",
  "importance": 1-5,
  "summary": "Brief 1-2 sentence description",
  "characters_involved": ["names directly involved"],
  "witnesses": ["names who observed this"],
  "location": "where it happened or 'unknown'",
  "is_secret": true/false,
  "emotional_impact": {"CharacterName": "emotional change"},
  "relationship_impact": {"CharA->CharB": "how relationship changed"}
}
</output_schema>

<example>
Input: "[Elena]: *She finally breaks down, tears streaming* I killed him. My own brother. He was going to betray us all to the Empire."
Output:
[
  {
    "event_type": "revelation",
    "importance": 5,
    "summary": "Elena confesses to killing her brother to prevent his betrayal to the Empire.",
    "characters_involved": ["Elena"],
    "witnesses": ["Elena", "Marcus"],
    "location": "unknown",
    "is_secret": true,
    "emotional_impact": {"Elena": "overwhelming guilt and grief"},
    "relationship_impact": {"Elena->Marcus": "deepened trust through vulnerability"}
  }
]
</example>

Instructions:
1. Only extract events significant for character memory and story continuity
2. Skip mundane exchanges and small talk
3. Use witnesses field to track who knows about each event${existingMemories.length > 0 ? '\n4. Do NOT duplicate events from <established_memories>' : ''}

Respond with a JSON array. If no significant events, respond with: []
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
Available: 1. [★★] Visited market yesterday, 2. [★★★★] Discovered hidden passage in castle, 3. [★] Ate breakfast
Output: {"selected": [2], "reasoning": "The hidden passage discovery is directly relevant to discussing the castle"}
</example>

Return only the JSON object with selected memory numbers (1-indexed) and reasoning.
</task>`;
}
