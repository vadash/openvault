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
// EXTRACTION PROMPT - Private Helpers
// =============================================================================

function _extractionRole() {
    return `<role>
You are a senior narrative analyst with 10+ years experience in interactive fiction, character psychology, and adult-themed roleplay. You specialize in extracting significant story events that capture emotional depth, relationship dynamics, and meaningful character interactions.

You excel at distinguishing story-significant moments from mundane dialogue. You output valid JSON only - no markdown fences, no explanatory text.
</role>`;
}

function _extractionMessages(messages) {
    return `<messages>
${messages}
</messages>`;
}

function _extractionMemories(existingMemories) {
    if (!existingMemories?.length) return null;

    const memorySummaries = sortMemoriesBySequence(existingMemories, true)
        .map((m, i) => `${i + 1}. [${m.event_type || 'event'}] ${m.summary}`)
        .join('\n');

    return `<established_memories>
${memorySummaries}
</established_memories>`;
}

function _extractionCharacters(characterName, userName, characterDescription, personaDescription) {
    if (characterDescription || personaDescription) {
        const parts = ['<characters>'];
        if (characterDescription) {
            parts.push(`<character name="${characterName}" role="main">\n${characterDescription}\n</character>`);
        }
        if (personaDescription) {
            parts.push(`<character name="${userName}" role="user">\n${personaDescription}\n</character>`);
        }
        parts.push('</characters>');
        return parts.join('\n');
    }

    return `<characters>
<character name="${characterName}" role="main"/>
<character name="${userName}" role="user"/>
</characters>`;
}

function _extractionSchema() {
    return `<schema>
<event_types>
<type name="action">Physical actions, movements, combat, significant gestures (e.g., intimate touch, sexual acts, physical restraint)</type>
<type name="revelation">New information disclosed, secrets shared, backstory revealed (e.g., deep desires, past intimate experiences, hidden vulnerabilities)</type>
<type name="emotion_shift">Significant emotional changes, mood shifts, reactions (e.g., arousal, vulnerability, ecstasy, shyness, dominant/submissive feelings, consent/discomfort)</type>
<type name="relationship_change">Trust gained/lost, bonds formed/broken, status changes (e.g., deepening intimacy, negotiation of consent, establishment/testing of boundaries, shift in power dynamics, commitment)</type>
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
</schema>`;
}

function _extractionExamples() {
    return `<examples>
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

<example type="action_intimacy">
<input>[Liam]: *leans in, a slow smile playing on his lips, then gently brushes his thumb over her cheek, trailing it down to her jawline* You're exquisite, Anya. May I kiss you?
[Anya]: *her breath hitches, eyes fluttering* Yes... oh god, yes.</input>
<output>[
  {
    "event_type": "action",
    "importance": 3,
    "summary": "Liam caressed Anya's cheek and requested a kiss, which she eagerly accepted.",
    "characters_involved": ["Liam", "Anya"],
    "witnesses": ["Liam", "Anya"],
    "location": null,
    "is_secret": true,
    "emotional_impact": {"Liam": "desire, tender", "Anya": "aroused, eager"},
    "relationship_impact": {"Liam->Anya": "desire expressed", "Anya->Liam": "consent given"}
  }
]</output>
</example>

<example type="revelation_vulnerability">
<input>[Zoe]: *whispering against his skin, after a moment of intense passion* I... I've never felt this safe with anyone before, Kai. Not like this.</input>
<output>[
  {
    "event_type": "revelation",
    "importance": 4,
    "summary": "Zoe confessed feeling unprecedented safety and vulnerability with Kai.",
    "characters_involved": ["Zoe"],
    "witnesses": ["Zoe", "Kai"],
    "location": null,
    "is_secret": true,
    "emotional_impact": {"Zoe": "vulnerable, trusting", "Kai": "tender, moved"},
    "relationship_impact": {"Zoe->Kai": "intimacy deepened"}
  }
]</output>
</example>

<example type="emotion_shift_consent">
<input>[Jax]: *After she pulls away slightly, a flicker of uncertainty in her eyes* Is this okay? Truly? We can stop anytime.
[Chloe]: *reaches out, pulling him back closer with a soft moan* More than okay. Don't stop. Please.</input>
<output>[
  {
    "event_type": "emotion_shift",
    "importance": 4,
    "summary": "Jax sought confirmation of consent, and Chloe reaffirmed her desire for intimacy.",
    "characters_involved": ["Jax", "Chloe"],
    "witnesses": ["Jax", "Chloe"],
    "location": null,
    "is_secret": true,
    "emotional_impact": {"Jax": "concerned, relieved", "Chloe": "reassured, desirous"},
    "relationship_impact": {"Jax->Chloe": "respect shown", "Chloe->Jax": "trust confirmed"}
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
</examples>`;
}

function _extractionInstructions() {
    return `<instructions>
Extract significant events from <messages> following these steps:

1. SCAN messages for story-significant moments, paying close attention to:
   - Actions with consequences, especially intimate physical contact or sexual acts
   - Information reveals or secrets shared, including personal desires or vulnerabilities
   - Emotional turning points, such as shifts in arousal, consent, or emotional intimacy
   - Relationship status changes, including deepening bonds or boundary adjustments

2. FILTER OUT mundane content:
   - Greetings and small talk
   - Internal thoughts without external action
   - Events only implied, not shown
   - Anything already in <established_memories>

3. For each significant event, COMPOSE output:
   - Use exact character names from <characters> (no transliteration)
   - Write summary in PAST TENSE, 8-24 words, English, factual and concise (avoid suggestive language)
   - Put emotions in emotional_impact, NOT in summary
   - Assign importance 1-5 based on story impact
   - Ensure summary and impacts accurately reflect consent, character agency, and any established boundaries

4. DEDUPLICATE against <established_memories>:
   - Same core action + same characters = SKIP
   - Progression of recorded event = SKIP
   - Only extract if fundamentally NEW action occurred

<avoid>
DO NOT extract:
- Events that merely rephrase existing memories
- Internal monologue without observable action or change
- Events implied but not explicitly shown in the text
- Mundane actions (walking, sitting, basic greetings without significance)
</avoid>

<analysis_process>
Before outputting JSON, briefly reason in <reasoning> tags:
1. What story-significant moments occurred?
2. Are any potential extractions duplicates of existing memories?
3. What importance level fits each event?
Then output your JSON array.
</analysis_process>

Return a JSON array of events. Return [] if no significant new events found.
</instructions>`;
}

// =============================================================================
// SMART RETRIEVAL PROMPT - Private Helpers
// =============================================================================

function _retrievalRole() {
    return `<role>
You are a senior memory systems architect specializing in character-driven narratives and emotional continuity. You understand how human memory works - triggered by association, emotion, and relevance to current situations.

You select memories a character would naturally recall in a given moment, especially considering emotional intimacy and relationship dynamics. You output valid JSON only - no markdown fences, no explanatory text.
</role>`;
}

function _retrievalScene(recentContext) {
    return `<scene>
${recentContext}
</scene>`;
}

function _retrievalMemories(numberedList) {
    return `<memories>
${numberedList}
</memories>`;
}

function _retrievalCharacter(characterName) {
    return `<character>${characterName}</character>`;
}

function _retrievalSchema() {
    return `<schema>
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
</schema>`;
}

function _retrievalExamples() {
    return `<examples>
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

<example type="intimate_context">
<scene_summary>After a tender kiss, Kai gently holds Zoe's hand, looking into her eyes.</scene_summary>
<available_memories>
1. [★★★] Zoe shared her fear of abandonment with Kai.
2. [★★★★★] Kai confessed his deep feelings for Zoe during an intimate moment.
3. [★★] They discussed their favorite books last week.
4. [★★★★] Zoe previously expressed a strong physical attraction to Kai.
5. [★★★] Kai helped Zoe with a difficult task.
</available_memories>
<output>{"selected": [2, 1, 4], "reasoning": "The intimate scene naturally triggers memories of their mutual confessions of feelings, Zoe's vulnerabilities shared with Kai, and her explicit attraction, which all provide crucial context for their deepening bond."}</output>
</example>

<example type="boundary_testing">
<scene_summary>Liam teases Anya about a past boundary she set, a playful smirk on his face.</scene_summary>
<available_memories>
1. [★★★★] Anya explicitly stated her discomfort with public displays of affection.
2. [★★★] Liam once brought Anya flowers after an argument.
3. [★★] They explored a new part of the city together.
4. [★★★★★] Anya established a clear 'safe word' with Liam during a scene.
5. [★★★] Liam expressed his dominant tendencies to Anya.
</available_memories>
<output>{"selected": [1, 4, 5], "reasoning": "Liam's teasing about boundaries immediately makes Anya recall her explicit discomforts, their agreed-upon safe word, and Liam's expressed tendencies, all relevant to the current dynamic."}</output>
</example>
</examples>`;
}

function _retrievalInstructions(limit, characterName) {
    return `<instructions>
Select up to ${limit} memories that ${characterName} would naturally recall for this scene.

1. ANALYZE the scene for:
   - Topics being discussed
   - Characters present or mentioned
   - Emotional tone and context, including any intimate or sexual undertones
   - Questions being asked or decisions being made
   - Any implied or explicit physical contact or expressions of desire

2. MATCH memories that:
   - Connect directly to scene topics
   - Involve characters present
   - Explain current emotional state
   - Provide relevant secrets or knowledge
   - Illuminate the history of intimacy, consent, or boundaries between characters

3. PRIORITIZE by:
   - Importance rating (more ★ = higher priority)
   - Direct relevance over tangential connection
   - Recent events when recency matters

<grounding>
When explaining your selection, quote specific phrases from <scene> that triggered each memory association.
</grounding>

<analysis_process>
Before outputting JSON, briefly reason in <reasoning> tags:
1. What key triggers exist in the scene (emotions, topics, characters)?
2. Which memories directly connect to these triggers?
3. Why would ${characterName} recall these specific memories now?
Then output your JSON.
</analysis_process>

Return JSON with selected memory numbers (1-indexed) and brief reasoning.
</instructions>`;
}

// =============================================================================
// PUBLIC API
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

    // Build context wrapper for memories and characters
    const memoriesSection = _extractionMemories(existingMemories);
    const charactersSection = _extractionCharacters(characterName, userName, characterDescription, personaDescription);
    const contextSection = `<context>\n${[memoriesSection, charactersSection].filter(Boolean).join('\n')}\n</context>`;

    const sections = [
        _extractionRole(),
        _extractionMessages(messages),
        contextSection,
        _extractionSchema(),
        _extractionExamples(),
        _extractionInstructions(),
    ].filter(Boolean);

    return sections.join('\n\n');
}

/**
 * Build the smart retrieval prompt
 * @param {string} recentContext - Recent chat context
 * @param {string} numberedList - Numbered list of memories
 * @param {string} characterName - POV character name
 * @param {number} limit - Maximum memories to select
 * @returns {string} The smart retrieval prompt
 */
export function buildSmartRetrievalPrompt(recentContext, numberedList, characterName, limit) {
    // Build context wrapper for memories and character
    const contextSection = `<context>\n${_retrievalMemories(numberedList)}\n${_retrievalCharacter(characterName)}\n</context>`;

    const sections = [
        _retrievalRole(),
        _retrievalScene(recentContext),
        contextSection,
        _retrievalSchema(),
        _retrievalExamples(),
        _retrievalInstructions(limit, characterName),
    ];

    return sections.join('\n\n');
}
