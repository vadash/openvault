/**
 * OpenVault Prompts
 *
 * All LLM prompts centralized in one file.
 * Follows Claude prompt engineering best practices:
 * - XML tags for structure
 * - Long data at top, instructions below
 * - Multiple diverse examples
 * - Clear sequential steps
 * - Single user message block per request
 */

import { sortMemoriesBySequence } from './utils.js';

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

    // === SECTION 1: ROLE DEFINITION ===
    let prompt = `<role>
You are an expert narrative analyst extracting significant story events from roleplay conversations into structured JSON.

You excel at distinguishing story-significant moments from mundane dialogue. You output valid JSON only - no markdown fences, no explanatory text.
</role>

`;

    // === SECTION 2: LONG DATA AT TOP (per Claude guide: improves performance 30%) ===

    // Messages to analyze - primary data
    prompt += `<messages>
${messages}
</messages>

`;

    // Established memories (if any) - deduplication reference
    if (existingMemories && existingMemories.length > 0) {
        const memorySummaries = sortMemoriesBySequence(existingMemories, true)
            .map((m, i) => `${i + 1}. [${m.event_type || 'event'}] ${m.summary}`)
            .join('\n');

        prompt += `<established_memories>
${memorySummaries}
</established_memories>

`;
    }

    // === SECTION 2: CONTEXT ===

    // Character definitions
    if (characterDescription || personaDescription) {
        prompt += '<characters>\n';
        if (characterDescription) {
            prompt += `<character name="${characterName}" role="main">\n${characterDescription}\n</character>\n`;
        }
        if (personaDescription) {
            prompt += `<character name="${userName}" role="user">\n${personaDescription}\n</character>\n`;
        }
        prompt += '</characters>\n\n';
    } else {
        prompt += `<characters>
<character name="${characterName}" role="main"/>
<character name="${userName}" role="user"/>
</characters>

`;
    }

    // === SECTION 3: SCHEMA DEFINITIONS ===

    prompt += `<schema>
<event_types>
<type name="action">Physical actions, movements, combat, significant gestures</type>
<type name="revelation">New information disclosed, secrets shared, backstory revealed</type>
<type name="emotion_shift">Significant emotional changes, mood shifts, reactions</type>
<type name="relationship_change">Trust gained/lost, bonds formed/broken, status changes</type>
</event_types>

<importance_scale>
<level value="1">Minor detail - passing mention, flavor text</level>
<level value="2">Notable - worth remembering for continuity</level>
<level value="3">Significant - affects ongoing story</level>
<level value="4">Major - turning point or key development</level>
<level value="5">Critical - story-changing, cannot be forgotten</level>
</importance_scale>

<output_format>
{
  "event_type": "action|revelation|emotion_shift|relationship_change",
  "importance": 1-5,
  "summary": "8-24 words, past tense, English, factual",
  "characters_involved": ["exact names from <characters>"],
  "witnesses": ["names who observed this event"],
  "location": "where it happened or null",
  "is_secret": true/false,
  "emotional_impact": {"CharacterName": "1-3 word emotion"},
  "relationship_impact": {"A->B": "1-3 word change description"}
}
</output_format>
</schema>

`;

    // === SECTION 4: EXAMPLES (3-5 diverse examples per Claude guide) ===

    prompt += `<examples>
<example type="revelation_confession">
<input>[Elena]: *She finally breaks down, tears streaming* I killed him. My own brother. He was going to betray us all to the Empire.</input>
<output>[
  {
    "event_type": "revelation",
    "importance": 5,
    "summary": "Elena confessed to killing her brother to prevent Empire betrayal.",
    "characters_involved": ["Elena"],
    "witnesses": ["Elena", "Marcus"],
    "location": null,
    "is_secret": true,
    "emotional_impact": {"Elena": "guilt, grief"},
    "relationship_impact": {"Elena->Marcus": "trust deepened"}
  }
]</output>
</example>

<example type="action_combat">
<input>[Marcus]: *draws his sword and lunges at the assassin, blade catching moonlight* You won't touch her!</input>
<output>[
  {
    "event_type": "action",
    "importance": 4,
    "summary": "Marcus attacked the assassin with his sword to protect Elena.",
    "characters_involved": ["Marcus"],
    "witnesses": ["Marcus", "Elena", "Assassin"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {"Marcus": "protective fury"},
    "relationship_impact": {"Marcus->Elena": "devotion shown"}
  }
]</output>
</example>

<example type="relationship_change">
<input>[Sarah]: *extends her hand slowly* I know we've been rivals, but... maybe we don't have to be enemies. Alliance?
[Tom]: *hesitates, then clasps her hand firmly* Alliance. But I'm watching you.</input>
<output>[
  {
    "event_type": "relationship_change",
    "importance": 4,
    "summary": "Sarah and Tom formed an uneasy alliance despite their rivalry.",
    "characters_involved": ["Sarah", "Tom"],
    "witnesses": ["Sarah", "Tom"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {"Sarah": "cautious hope", "Tom": "wary"},
    "relationship_impact": {"Sarah->Tom": "rivals to allies", "Tom->Sarah": "grudging cooperation"}
  }
]</output>
</example>

<example type="non_latin_names">
<input>[Катя]: *краснея* Я видела твой дневник... Ты писал обо мне.</input>
<output>[
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
]</output>
</example>

<example type="empty_result">
<input>[Alice]: Hey, how's it going?
[Bob]: Not bad, just got back from lunch. You?
[Alice]: Same old, same old. Weather's nice today.</input>
<output>[]</output>
<note>No significant events - just small talk</note>
</example>
</examples>

`;

    // === SECTION 5: INSTRUCTIONS (numbered steps at end per Claude guide) ===

    prompt += `<instructions>
Extract significant events from <messages> following these steps:

1. SCAN messages for story-significant moments:
   - Actions with consequences
   - Information reveals or secrets shared
   - Emotional turning points
   - Relationship status changes

2. FILTER OUT mundane content:
   - Greetings and small talk
   - Internal thoughts without external action
   - Events only implied, not shown
   - Anything already in <established_memories>

3. For each significant event, COMPOSE output:
   - Use exact character names from <characters> (no transliteration)
   - Write summary in PAST TENSE, 8-24 words, English
   - Put emotions in emotional_impact, NOT in summary
   - Assign importance 1-5 based on story impact

4. DEDUPLICATE against <established_memories>:
   - Same core action + same characters = SKIP
   - Progression of recorded event = SKIP
   - Only extract if fundamentally NEW action occurred

Return a JSON array of events. Return [] if no significant new events found.
</instructions>`;

    return prompt;
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
    return `<role>
You are a memory curator selecting which memories a character would naturally recall in a given moment.

You understand how human memory works - triggered by association, emotion, and relevance. You output valid JSON only - no markdown fences, no explanatory text.
</role>

<scene>
${recentContext}
</scene>

<memories>
${numberedList}
</memories>

<character>${characterName}</character>

<schema>
<output_format>
{
  "selected": [1, 4, 7],
  "reasoning": "1-2 sentence explanation of why these memories are relevant"
}
</output_format>

<selection_criteria>
<criterion priority="1">High importance events (★★★★★) over low importance</criterion>
<criterion priority="2">Direct relevance to current conversation topics</criterion>
<criterion priority="3">Relationship history with characters in scene</criterion>
<criterion priority="4">Emotional continuity with current mood/situation</criterion>
<criterion priority="5">Secrets or private knowledge relevant to situation</criterion>
<criterion priority="6">Recent events providing immediate context</criterion>
</selection_criteria>
</schema>

<examples>
<example type="topic_relevance">
<scene_summary>Elena asks about the old castle's history</scene_summary>
<available_memories>
1. [★★] Visited the market yesterday
2. [★★★★] Discovered a hidden passage in the castle's east wing
3. [★] Had breakfast at the inn
</available_memories>
<output>{"selected": [2], "reasoning": "The hidden passage discovery is directly relevant to discussing the castle"}</output>
</example>

<example type="relationship_history">
<scene_summary>Marcus appears after months away; tension is palpable</scene_summary>
<available_memories>
1. [★★★] Marcus and Elena argued about the mission
2. [★★] Bought supplies for the journey
3. [★★★★★] Marcus betrayed the group's location to enemies
4. [★★★] Elena saved Marcus from drowning
</available_memories>
<output>{"selected": [3, 1, 4], "reasoning": "The betrayal is critical context for tension; their argument and rescue show relationship complexity"}</output>
</example>

<example type="emotional_continuity">
<scene_summary>Walking through the forest where her mother died</scene_summary>
<available_memories>
1. [★★★★★] Mother was killed by bandits in this forest
2. [★★] Learned to track animals here as a child
3. [★★★] Promised mother to become a healer
4. [★] Found edible berries yesterday
</available_memories>
<output>{"selected": [1, 3, 2], "reasoning": "Mother's death is primary emotional trigger; the promise and childhood memory provide depth"}</output>
</example>

<example type="secret_knowledge">
<scene_summary>The king asks who can be trusted among the advisors</scene_summary>
<available_memories>
1. [★★★★] Overheard Advisor Crane plotting with enemy agents
2. [★★] Attended the royal banquet
3. [★★★] Duke promised loyalty in exchange for land
4. [★★★★★] Discovered Crane is the spy through stolen letters
</available_memories>
<output>{"selected": [4, 1, 3], "reasoning": "Secret knowledge of Crane's treachery is critical; Duke's conditional loyalty also relevant"}</output>
</example>
</examples>

<instructions>
Select up to ${limit} memories that ${characterName} would naturally recall for this scene.

1. ANALYZE the scene for:
   - Topics being discussed
   - Characters present or mentioned
   - Emotional tone and context
   - Questions being asked or decisions being made

2. MATCH memories that:
   - Connect directly to scene topics
   - Involve characters present
   - Explain current emotional state
   - Provide relevant secrets or knowledge

3. PRIORITIZE by:
   - Importance rating (more ★ = higher priority)
   - Direct relevance over tangential connection
   - Recent events when recency matters

Return JSON with selected memory numbers (1-indexed) and brief reasoning.
</instructions>`;
}
