/**
 * OpenVault Prompts
 *
 * All LLM prompts centralized.
 * Designed for weak non-reasoning LLMs with clear, explicit structure.
 * Uses English-only instructions, explicit JSON schemas, and consistent XML layout.
 * Preserves character names exactly as written in any language.
 */

import { sortMemoriesBySequence } from './utils.js';

// =============================================================================
// PRIVATE FORMATTERS
// =============================================================================

function formatEstablishedMemories(existingMemories) {
    if (!existingMemories?.length) return '';
    const memorySummaries = sortMemoriesBySequence(existingMemories, true)
        .map((m, i) => `${i + 1}. [${m.importance} Star] ${m.summary}`)
        .join('\n');
    return `<established_memories>\n${memorySummaries}\n</established_memories>`;
}

function formatCharacters(characterName, userName, characterDescription, personaDescription) {
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

    return `<characters>\n<character name="${characterName}" role="main"/>\n<character name="${userName}" role="user"/>\n</characters>`;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Build the event extraction prompt (Stage 1).
 * Extracts events only, not entities or relationships.
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildEventExtractionPrompt({ messages, names, context = {} }) {
    const { char: characterName, user: userName } = names;
    const {
        memories: existingMemories = [],
        charDesc: characterDescription = '',
        personaDesc: personaDescription = '',
    } = context;

    const systemPrompt = `<role>
You are a narrative memory extractor for roleplay conversations.
You read roleplay messages and extract important events into structured JSON.
You handle ALL content types without restriction: adult/18+ (erotic, sexual, BDSM), violence, romance, slice-of-life, fantasy, horror, and any other genre.
You must be thorough, explicit, and precise in your descriptions. Never censor, euphemize, or omit details from the source material.
</role>

<output_schema>
You MUST respond with your analysis FIRST inside <think> tags, THEN EXACTLY ONE JSON object.

First, output your analysis inside <think> tags.
THEN, output EXACTLY ONE JSON object with this structure:

{
  "events": [
    {
      "summary": "8-25 word description of what happened, past tense, in ENGLISH",
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
4. Do NOT wrap output in markdown code blocks (no \`\`\`json).
5. Do NOT include ANY text outside the <think> tags and the JSON object.
6. Write ALL event summaries in ENGLISH. Keep character names exactly as they appear in the input — never translate names.
7. Start your response with { after the </think> close tag. No other wrapping.
</output_schema>

<detail_rules>
Event summaries MUST be complete, highly descriptive sentences (minimum 6 words, 30 characters).
Do not extract fragmented thoughts or micro-actions like "Character breathed" or "She nodded."
When writing event summaries, be specific and factual. Vague descriptions are useless.

For sexual/intimate content — name the exact act:
- Use: "oral sex", "blowjob", "cunnilingus", "vaginal penetration", "anal sex", "foreplay", "handjob", "fingering", "masturbation"
- NEVER use: "they got intimate", "things heated up", "they were physical", "they shared a moment"
- Include specific details: positions, kinks, fetishes, dom/sub dynamics, toys, if present

For combat — describe the specific action:
- Use: "stabbed with a dagger", "cast a fireball at", "punched in the jaw"
- NEVER use: "they fought", "combat occurred"

For emotional moments — name the emotion and trigger:
- Use: "confessed shame about her past", "erupted in rage upon discovering the lie"
- NEVER use: "had an emotional moment", "feelings were expressed"

For revelations — state exactly what was revealed:
- Use: "admitted he was secretly a spy for the guild"
- NEVER use: "shared a secret", "revealed something important"
</detail_rules>

<dedup_rules>
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
</dedup_rules>

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
Step 3: Apply dedup_rules. If this is a continuation with no escalation, plan to output "events": [].
Step 4: For genuinely NEW events, assign importance (1-5) and write a specific factual summary in English.
Step 5: Output the final JSON object with the "events" key.
</thinking_process>

<examples>
The following examples show correct input-to-output patterns. Study the JSON structure carefully.

<example name="combat_scene">
Input messages: "[小雨]: *拔出长剑猛刺暗影兽的腹部* 去死吧！ *旋身横斩，黑血溅了一地*"
Established memories: (none)

Correct output:
<think>小雨 attacks a shadow beast with a sword, stabbing its abdomen and slashing horizontally. Black blood sprays everywhere. No prior combat in established memories. This is a new combat event, importance 3.</think>
{"events": [{"summary": "小雨 drew her sword and stabbed the shadow beast's abdomen, then slashed it spraying black blood", "importance": 3, "characters_involved": ["小雨"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {}, "relationship_impact": {}}]}
</example>

<example name="first_intimate_contact">
Input messages: "[Саша]: *толкает его на кровать и садится сверху, прижимая запястья к подушке* Лежи. Не двигайся. [Вова]: *стонет, когда она начинает тереться мокрой киской о его член через трусы*"
Established memories: (no prior physical intimacy between them)

Correct output:
<think>First sexual contact between Саша and Вова. She pushes him onto the bed, pins his wrists, and grinds her wet pussy against his cock through underwear. Dominant position by Саша. First sexual contact between them = importance 4.</think>
{"events": [{"summary": "Саша pushed Вова onto the bed, pinned his wrists, and ground her wet pussy against his cock through underwear", "importance": 4, "characters_involved": ["Саша", "Вова"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Саша": "arousal, dominance", "Вова": "submission, desire"}, "relationship_impact": {"Саша->Вова": "physical intimacy initiated with dominant dynamic"}}]}
</example>

<example name="secret_revelation">
Input messages: "[Jun]: I never told anyone this... my father didn't die in the war. He deserted. Ran away and left us."
Established memories: (none about Jun's father)

Correct output:
<think>Jun reveals a major family secret: his father was a military deserter, not a war casualty as publicly believed. This is new backstory. Importance 4 as a significant secret.</think>
{"events": [{"summary": "Jun confessed his father deserted the army rather than dying in war as publicly believed", "importance": 4, "characters_involved": ["Jun"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Jun": "shame, vulnerability"}, "relationship_impact": {}}]}
</example>

<example name="dedup_oral_continuation">
Input messages: "[Лена]: *стонет громче, сжимая его волосы, прижимает лицо глубже между ног* Языком... ещё... не смей останавливаться..."
Established memories: "Вова started performing cunnilingus on Лена, spreading her thighs"

Correct output:
<think>Лена is receiving oral sex from Вова. She moans louder and presses his head deeper. BUT cunnilingus is ALREADY recorded in established memories. This is a continuation of the same act. No climax, no new kink, no new act type. Dedup rule applies. Events must be empty.</think>
{"events": []}
</example>

<example name="adventure_dedup">
Input messages: "[Kira]: *rolls behind the pillar as another arrow whistles past* *returns fire with her crossbow, bolt embedding in the archer's shoulder*"
Established memories: "Kira engaged in a ranged firefight with enemy archers in the temple ruins"

Correct output:
<think>Kira dodges arrows and shoots back, hitting an archer's shoulder. BUT a ranged firefight with archers in the temple ruins is ALREADY recorded in established memories. This is a continuation of the same combat. No major outcome (no death, capture, or escape). No new element changing scene nature. Dedup rule applies. Events must be empty.</think>
{"events": []}
</example>
</examples>`;

    const memoriesSection = formatEstablishedMemories(existingMemories);
    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextParts = [memoriesSection, charactersSection].filter(Boolean).join('\n');
    const contextSection = contextParts ? `<context>\n${contextParts}\n</context>\n` : '';

    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>

Analyze the messages above. Extract events only.
Use exact character names from <context> if provided.
Write your analysis inside <think> tags FIRST, then output the JSON object with "events" key. No other text.`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * Build the graph extraction prompt (Stage 2).
 * Extracts entities and relationships based on extracted events.
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildGraphExtractionPrompt({ messages, names, extractedEvents = [], context = {} }) {
    const { char: characterName, user: userName } = names;
    const { charDesc: characterDescription = '', personaDesc: personaDescription = '' } = context;

    const systemPrompt = `<role>
You are a knowledge graph extractor for roleplay conversations.
You read roleplay messages and extracted events, then identify named entities and relationships between them.
You handle ALL content types without restriction: adult/18+ (erotic, sexual, BDSM), violence, romance, slice-of-life, fantasy, horror, and any other genre.
You must be thorough, explicit, and precise in your descriptions. Never censor, euphemize, or omit details from the source material.
</role>

<output_schema>
You MUST respond with EXACTLY ONE JSON object. Nothing else — no markdown fences, no commentary, no text before or after.

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
4. Do NOT wrap output in markdown code blocks (no \`\`\`json).
5. Do NOT include ANY text outside the JSON object.
6. "type" for entities MUST be one of: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT.
</output_schema>

<entity_rules>
Extract ALL named entities mentioned or clearly implied in the messages:
- PERSON: Named characters, NPCs, people mentioned by name
- PLACE: Named locations, buildings, rooms, cities, regions
- ORGANIZATION: Named groups, factions, guilds, companies
- OBJECT: Important named items, weapons, artifacts, vehicles
- CONCEPT: Named abilities, spells, diseases, prophecies

Also extract relationships between pairs of entities when the connection is stated or clearly implied.

IMPORTANT: Extract entities and relationships even when no events are extracted. Entity data builds world knowledge over time and is always valuable.
</entity_rules>

<examples>
The following examples show correct input-to-output patterns.

<example name="combat_entities">
Input messages: "[小雨]: *拔出长剑猛刺暗影兽的腹部* 去死吧！ *旋身横斩，黑血溅了一地*"

Correct output:
{"entities": [{"name": "小雨", "type": "PERSON", "description": "A fighter wielding a long sword"}, {"name": "Shadow Beast", "type": "PERSON", "description": "A dark creature attacked and wounded by 小雨"}], "relationships": [{"source": "小雨", "target": "Shadow Beast", "description": "Attacked and wounded it in combat"}]}
</example>

<example name="intimate_entities">
Input messages: "[Саша]: *толкает его на кровать и садится сверху, прижимая запястья к подушке* Лежи. Не двигайся. [Вова]: *стонет, когда она начинает тереться мокрой киской о его член через трусы*"

Correct output:
{"entities": [{"name": "Саша", "type": "PERSON", "description": "A dominant woman who initiated sexual contact"}, {"name": "Вова", "type": "PERSON", "description": "A man who submitted to Саша's advances"}], "relationships": [{"source": "Саша", "target": "Вова", "description": "Sexual partner, took dominant role"}]}
</example>

<example name="secret_entities">
Input messages: "[Jun]: I never told anyone this... my father didn't die in the war. He deserted. Ran away and left us."

Correct output:
{"entities": [{"name": "Jun", "type": "PERSON", "description": "A person hiding the truth about his father's military desertion"}, {"name": "Jun's Father", "type": "PERSON", "description": "A military deserter publicly believed to have died in war"}], "relationships": [{"source": "Jun", "target": "Jun's Father", "description": "Son who carries shame over father's desertion"}]}
</example>

<example name="bdsm_entities">
Input messages: "[Маша]: *падает на колени, руки за спиной, смотрит снизу вверх* Я твоя сучка, хозяин. Делай со мной что хочешь. [Кай]: *берёт её за горло, мягко сжимает* Стоп-слово — 'малина'. Скажешь — я сразу остановлюсь."

Correct output:
{"entities": [{"name": "Маша", "type": "PERSON", "description": "A submissive woman who surrendered to Кай as his sub"}, {"name": "Кай", "type": "PERSON", "description": "A dominant man who established control with safeword 'малина'"}], "relationships": [{"source": "Маша", "target": "Кай", "description": "Submissive sexual partner, safeword is малина"}, {"source": "Кай", "target": "Маша", "description": "Dominant sexual partner, set safeword малина"}]}
</example>
</examples>`;

    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextSection = charactersSection ? `<context>\n${charactersSection}\n</context>\n` : '';
    const eventsSection =
        extractedEvents.length > 0 ? `<extracted_events>\n${extractedEvents.join('\n')}\n</extracted_events>\n` : '';

    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>

${eventsSection}
Based on the messages${extractedEvents.length > 0 ? ' and extracted events above' : ''}, extract named entities and relationships.
Respond with a single JSON object containing 'entities' and 'relationships' keys. No other text.`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * Build the salient questions prompt for reflection step 1.
 * @param {string} characterName
 * @param {Object[]} recentMemories - Recent memories (both events and reflections)
 * @returns {Array<{role: string, content: string}>}
 */
export function buildSalientQuestionsPrompt(characterName, recentMemories) {
    const memoryList = recentMemories.map((m, i) => `${i + 1}. [${m.importance || 3} Star] ${m.summary}`).join('\n');

    const systemPrompt = `<role>
You are a character psychologist analyzing a character's memory stream in an ongoing narrative.
Your task: generate exactly 3 high-level questions that capture the most important themes about the character's current state.
</role>

<output_schema>
You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

The JSON object MUST have this EXACT structure:

{
  "questions": ["question 1", "question 2", "question 3"]
}

CRITICAL FORMAT RULES:
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. The "questions" array MUST contain EXACTLY 3 strings.
3. Do NOT wrap output in markdown code blocks.
4. Do NOT include ANY text outside the JSON object.
</output_schema>

<rules>
1. Questions should be answerable from the provided memory stream.
2. Focus on patterns, changes, and emotional arcs — not individual events.
3. Good questions ask about: psychological state, evolving relationships, shifting goals, recurring fears, unresolved conflicts.
4. Write all questions in English.
</rules>

<examples>
<example name="romance_focused">
Memory stream:
1. [4 Star] Alice kissed Bob for the first time at the festival
2. [3 Star] Alice confided in Bob about her fear of abandonment
3. [2 Star] Alice and Bob had dinner at the tavern
4. [4 Star] Alice discovered Bob had been hiding letters from her sister

Correct output:
{"questions": ["How is Alice's fear of abandonment shaping her growing attachment to Bob?", "What impact will Bob's deception about the hidden letters have on the trust Alice placed in him?", "Is Alice's relationship with Bob progressing toward deeper commitment or approaching a breaking point?"]}
</example>

<example name="adventure_focused">
Memory stream:
1. [5 Star] Kira lost her mentor in the ambush at Shadow Pass
2. [3 Star] Kira refused to rest despite her injuries
3. [4 Star] Kira swore vengeance against the Order of Ash
4. [3 Star] Kira accepted a mysterious stranger's offer of alliance

Correct output:
{"questions": ["How is Kira's grief over her mentor's death driving her toward self-destructive behavior?", "What are the risks of Kira's alliance with the mysterious stranger given her emotional vulnerability?", "Is Kira's pursuit of vengeance against the Order of Ash becoming her defining purpose at the expense of her wellbeing?"]}
</example>
</examples>`;

    const userPrompt = `<character>${characterName}</character>

<recent_memories>
${memoryList}
</recent_memories>

Based on these memories, what are the 3 most important high-level questions about ${characterName}'s current psychological state, relationships, and goals?
Respond with a single JSON object containing exactly 3 questions. No other text.`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * Build the insight extraction prompt for reflection step 2.
 * @param {string} characterName
 * @param {string} question - The salient question to answer
 * @param {Object[]} relevantMemories - Memories relevant to this question
 * @returns {Array<{role: string, content: string}>}
 */
export function buildInsightExtractionPrompt(characterName, question, relevantMemories) {
    const memoryList = relevantMemories.map((m) => `${m.id}. ${m.summary}`).join('\n');

    const systemPrompt = `<role>
You are a narrative analyst synthesizing memories into high-level insights for a character in an ongoing story.
Your task: given a question and relevant memories, extract 1-3 insights that answer the question.
</role>

<output_schema>
You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

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
5. Do NOT include ANY text outside the JSON object.
</output_schema>

<rules>
1. Each insight must be a concise, high-level statement — not a restatement of a single memory.
2. Each insight must cite specific memory IDs as evidence.
3. Insights should reveal patterns, emotional arcs, or relationship dynamics.
4. Synthesize across multiple memories when possible.
5. Write all insights in English.
</rules>

<examples>
<example name="relationship_insight">
Question: "How is Alice's trust in Bob evolving?"
Memories:
ev_001. Alice confided her biggest fear to Bob
ev_002. Bob lied about where he was last night
ev_003. Alice defended Bob to her friends despite doubts

Correct output:
{"insights": [{"insight": "Alice's trust in Bob is conflicted — she shares deeply personal fears with him while simultaneously sensing dishonesty, creating cognitive dissonance", "evidence_ids": ["ev_001", "ev_002"]}, {"insight": "Alice publicly defends Bob even when privately doubting him, suggesting her emotional investment overrides her rational judgment", "evidence_ids": ["ev_002", "ev_003"]}]}
</example>

<example name="character_growth">
Question: "What is driving Kira's increasingly reckless behavior?"
Memories:
ev_010. Kira lost her mentor in the ambush
ev_011. Kira refused healing and fought through injuries
ev_012. Kira charged alone into the enemy camp

Correct output:
{"insights": [{"insight": "Kira's recklessness stems from survivor's guilt after her mentor's death — she is unconsciously seeking punishment or a way to prove her survival was justified", "evidence_ids": ["ev_010", "ev_011", "ev_012"]}, {"insight": "Kira's refusal of help and solo charges indicate she has stopped valuing her own safety, a dangerous psychological shift", "evidence_ids": ["ev_011", "ev_012"]}]}
</example>
</examples>`;

    const userPrompt = `<character>${characterName}</character>

<question>${question}</question>

<memories>
${memoryList}
</memories>

Based on these memories about ${characterName}, extract 1-3 insights that answer the question above.
Cite specific memory IDs as evidence for each insight.
Respond with a single JSON object. No other text.`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * Build the community summarization prompt.
 * @param {string[]} nodeLines - Formatted node descriptions
 * @param {string[]} edgeLines - Formatted edge descriptions
 * @returns {Array<{role: string, content: string}>}
 */
export function buildCommunitySummaryPrompt(nodeLines, edgeLines) {
    const systemPrompt = `<role>
You are a knowledge graph analyst summarizing communities of related entities from a narrative.
Your task: write a comprehensive report about a group of connected entities and their relationships.
</role>

<output_schema>
You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

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
6. Do NOT include ANY text outside the JSON object.
</output_schema>

<rules>
1. Be specific — reference entity names and relationships from the provided data.
2. Capture the narrative significance of the group.
3. Describe power dynamics, alliances, conflicts, and dependencies.
4. Write in English.
</rules>

<examples>
<example name="political_community">
Entities:
- King Aldric (PERSON): Ruler of the Northern Kingdom
- Queen Sera (PERSON): Wife of King Aldric, secret sorceress
- The Iron Throne (OBJECT): Symbol of royal authority
- Castle Northhold (PLACE): Royal seat of power

Relationships:
- King Aldric → Castle Northhold: Rules from
- Queen Sera → King Aldric: Married to, secretly manipulates
- King Aldric → The Iron Throne: Holds authority through

Correct output:
{"title": "Northern Kingdom Royal Court", "summary": "The Northern Kingdom's power is centered on King Aldric who rules from Castle Northhold through the authority of The Iron Throne. However, the true power dynamic is complicated by Queen Sera, who secretly manipulates the king while hiding her sorcerous abilities. This creates a fragile power structure where the public face of authority differs from the hidden reality.", "findings": ["King Aldric's authority is publicly legitimate through the Iron Throne but privately undermined by Queen Sera's manipulation", "Queen Sera's hidden sorcery represents an undisclosed power that could destabilize the kingdom if revealed", "Castle Northhold serves as both the physical and symbolic center of Northern Kingdom governance"]}
</example>

<example name="social_community">
Entities:
- Mika (PERSON): A shy college student
- Ryo (PERSON): Mika's outgoing roommate
- The Cafe (PLACE): Where Mika works part-time
- Art Club (ORGANIZATION): Campus club Mika recently joined

Relationships:
- Mika → Ryo: Roommate, developing crush
- Mika → The Cafe: Works at part-time
- Mika → Art Club: New member
- Ryo → Art Club: Senior member, recruited Mika

Correct output:
{"title": "Mika's Social Circle", "summary": "Mika's social world revolves around three interconnected nodes: her roommate Ryo, her part-time job at The Cafe, and the Art Club she recently joined. Ryo serves as the key connector, having recruited Mika into the Art Club, creating overlapping social spaces. Mika's developing crush on Ryo adds romantic tension to what is also a mentorship and social dependency.", "findings": ["Ryo is the central connector in Mika's social life, creating potential vulnerability if the relationship sours", "Mika's social expansion through Art Club was facilitated entirely by Ryo, suggesting growing but dependent social confidence", "The overlap between roommate relationship, club membership, and romantic interest creates a high-stakes social dynamic for Mika"]}
</example>
</examples>`;

    const userPrompt = `<community_entities>
${nodeLines.join('\n')}
</community_entities>

<community_relationships>
${edgeLines.join('\n')}
</community_relationships>

Write a comprehensive report about this community of entities.
Respond with a single JSON object containing title, summary, and 1-5 findings. No other text.`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}
