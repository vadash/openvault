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
    extraction: 'You are a helpful assistant that extracts structured data from roleplay conversations. Always respond with valid JSON only, no markdown formatting.',
    retrieval: 'You are a helpful assistant that analyzes memories for relevance. Always respond with valid JSON only, no markdown formatting.'
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
        characterContextSection = '\n## Character Context\n';
        if (characterDescription) {
            characterContextSection += `### ${characterName} (AI Character)\n${characterDescription}\n\n`;
        }
        if (personaDescription) {
            characterContextSection += `### ${userName} (User's Persona)\n${personaDescription}\n\n`;
        }
    }

    // Build memory context section if we have existing memories
    let memoryContextSection = '';
    if (existingMemories && existingMemories.length > 0) {
        const memorySummaries = sortMemoriesBySequence(existingMemories, true)
            .map((m, i) => `${i + 1}. [${m.event_type || 'event'}] ${m.summary}`)
            .join('\n');

        memoryContextSection = `
## Previously Established Memories
The following events have already been recorded. Use this context to:
- Avoid duplicating already-recorded events
- Maintain consistency with established facts
- Build upon existing character developments

${memorySummaries}

`;
    }

    return `You are analyzing roleplay messages to extract structured memory events.

## Characters
- Main character: ${characterName}
- User's character: ${userName}
${characterContextSection}${memoryContextSection}
## Messages to analyze:
${messagesText}

## Task
Extract NEW significant events from these messages. Use the Character Context (if provided) to better understand motivations, personality traits, and relationship dynamics. For each event, identify:
1. **event_type**: One of: "action", "revelation", "emotion_shift", "relationship_change"
2. **importance**: 1-5 scale (1=minor detail, 2=notable, 3=significant, 4=major event, 5=critical/story-changing)
3. **summary**: Brief description of what happened (1-2 sentences)
4. **characters_involved**: List of character names directly involved
5. **witnesses**: List of character names who observed this (important for POV filtering)
6. **location**: Where this happened (if mentioned, otherwise "unknown")
7. **is_secret**: Whether this information should only be known by witnesses
8. **emotional_impact**: Object mapping character names to emotional changes (e.g., {"${characterName}": "growing trust", "${userName}": "surprised"})
9. **relationship_impact**: Object describing relationship changes (e.g., {"${characterName}->${userName}": "trust increased"})

Only extract events that are significant for character memory and story continuity. Skip mundane exchanges.
${existingMemories.length > 0 ? 'Do NOT duplicate events from the "Previously Established Memories" section.' : ''}

Respond with a JSON array of events:
\`\`\`json
[
  {
    "event_type": "...",
    "importance": 3,
    "summary": "...",
    "characters_involved": [...],
    "witnesses": [...],
    "location": "...",
    "is_secret": false,
    "emotional_impact": {...},
    "relationship_impact": {...}
  }
]
\`\`\`

If no significant events, respond with an empty array: []`;
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
    return `You are a narrative memory analyzer. Given the current roleplay scene and a list of available memories, select which memories are most relevant for the AI to reference in its response.

CURRENT SCENE:
${recentContext}

AVAILABLE MEMORIES (numbered):
${numberedList}

[Task]: Select up to ${limit} memories that would be most useful for ${characterName} to know for the current scene. Consider:
- Importance level (★ to ★★★★★) - higher importance events are more critical to the story
- Direct relevance to current conversation topics
- Character relationships being discussed
- Background context that explains current situations
- Emotional continuity
- Secrets the character knows

[Return]: JSON object with selected memory numbers (1-indexed) and brief reasoning:
{"selected": [1, 4, 7], "reasoning": "Brief explanation of why these memories are relevant"}

Only return valid JSON, no markdown formatting.`;
}
