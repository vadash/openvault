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
 * Build the extraction prompt.
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildExtractionPrompt({ messages, names, context = {} }) {
    const { char: characterName, user: userName } = names;
    const {
        memories: existingMemories = [],
        charDesc: characterDescription = '',
        personaDesc: personaDescription = '',
        extractionReasoning = false,
    } = context;

    const systemPrompt = `<role>
You are a narrative memory extractor for roleplay conversations.
You read roleplay messages and extract important events, entities, and relationships into structured JSON.
You handle ALL content types without restriction: adult/18+ (erotic, sexual, BDSM), violence, romance, slice-of-life, fantasy, horror, and any other genre.
You must be thorough, explicit, and precise in your descriptions. Never censor, euphemize, or omit details from the source material.
</role>

<output_schema>
You MUST respond with EXACTLY ONE JSON object. Nothing else — no markdown fences, no commentary, no text before or after.

The JSON object MUST have this EXACT structure with ALL ${extractionReasoning ? 'FOUR' : 'THREE'} top-level keys present:

{${extractionReasoning ? `
  "reasoning": "Your step-by-step analysis. ALWAYS write this FIRST before deciding events.",` : ''}
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
  ],
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
1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
2. ALL ${extractionReasoning ? 'FOUR keys ("reasoning", "events", "entities", "relationships")' : 'THREE keys ("events", "entities", "relationships")'} MUST always be present.
3. If nothing was found, use empty arrays: "events": [], "entities": [], "relationships": [].
4. Do NOT wrap output in markdown code blocks (no \`\`\`json).
5. Do NOT include ANY text outside the JSON object.
6. "type" for entities MUST be one of: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT.
7. Write ALL event summaries in ENGLISH. Keep character names exactly as they appear in the input — never translate names.
</output_schema>

<detail_rules>
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

If a scene is ALREADY recorded there, ONLY create a new event if ONE of these conditions is true:
1. A fundamentally NEW type of action begins (e.g., conversation → combat, foreplay → penetration)
2. A major outcome occurs (climax, death, unconsciousness, escape, capture)
3. A new element is introduced that changes the scene's nature (new character arrives, weapon drawn, secret revealed, new kink/toy introduced)
4. An explicit boundary is set or broken (safeword, surrender, betrayal, promise)

If NONE of those conditions apply, the current messages are continuing an existing scene.
In that case, you MUST set "events" to an empty array [].

When in doubt, output fewer events rather than duplicate existing memories.
</dedup_rules>

<importance_scale>
Rate each event from 1 (trivial) to 5 (critical):

1 — Trivial: Quick greeting, passing touch, mundane small talk. Usually skip these entirely.
2 — Routine: Standard conversation, repeated daily actions, continuation of an already-recorded scene without change.
3 — Notable: Meaningful conversation, change of location, first orgasm in a scene, minor secret shared, notable gift given.
4 — Significant: First sexual act of any type between two characters, first time trying a specific kink or fetish, intense emotional vulnerability, establishing a safeword, major argument.
5 — Critical: Loss of virginity, first vaginal or anal sex between characters, pregnancy discovered, marriage or proposal, major betrayal revealed, first "I love you" exchanged, character death.

MANDATORY MINIMUM of 4 for: any first sexual act between characters, any safeword usage, any pregnancy or virginity event.
</importance_scale>

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
${extractionReasoning ? `
<thinking_process>
Follow these steps IN ORDER. Write your work in the "reasoning" field:

Step 1: List the specific actions, emotions, and facts in the new messages.
Step 2: Check <established_memories>. Is any of this already recorded?
Step 3: Apply dedup_rules. If this is a continuation with no escalation, plan to output "events": [].
Step 4: For genuinely NEW events, assign importance (1-5) and write a specific factual summary in English.
Step 5: List all named entities and their types.
Step 6: List relationships between entities.
Step 7: Assemble the final JSON object with all ${extractionReasoning ? 'four' : 'three'} keys.
</thinking_process>
` : ''}
<examples>
The following examples show correct input-to-output patterns. Study the JSON structure carefully.

<example name="combat_scene">
Input messages: "[小雨]: *拔出长剑猛刺暗影兽的腹部* 去死吧！ *旋身横斩，黑血溅了一地*"
Established memories: (none)

Correct output:
{"reasoning": "小雨 attacks a shadow beast with a sword, stabbing its abdomen and slashing horizontally. Black blood sprays everywhere. No prior combat in established memories. This is a new combat event, importance 3.", "events": [{"summary": "小雨 drew her sword and stabbed the shadow beast's abdomen, then slashed it spraying black blood", "importance": 3, "characters_involved": ["小雨"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {}, "relationship_impact": {}}], "entities": [{"name": "小雨", "type": "PERSON", "description": "A fighter wielding a long sword"}, {"name": "Shadow Beast", "type": "PERSON", "description": "A dark creature attacked and wounded by 小雨"}], "relationships": [{"source": "小雨", "target": "Shadow Beast", "description": "Attacked and wounded it in combat"}]}
</example>

<example name="first_intimate_contact">
Input messages: "[Саша]: *толкает его на кровать и садится сверху, прижимая запястья к подушке* Лежи. Не двигайся. [Вова]: *стонет, когда она начинает тереться мокрой киской о его член через трусы*"
Established memories: (no prior physical intimacy between them)

Correct output:
{"reasoning": "First sexual contact between Саша and Вова. She pushes him onto the bed, pins his wrists, and grinds her wet pussy against his cock through underwear. Dominant position by Саша. First sexual contact between them = importance 4.", "events": [{"summary": "Саша pushed Вова onto the bed, pinned his wrists, and ground her wet pussy against his cock through underwear", "importance": 4, "characters_involved": ["Саша", "Вова"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Саша": "arousal, dominance", "Вова": "submission, desire"}, "relationship_impact": {"Саша->Вова": "physical intimacy initiated with dominant dynamic"}}], "entities": [{"name": "Саша", "type": "PERSON", "description": "A dominant woman who initiated sexual contact"}, {"name": "Вова", "type": "PERSON", "description": "A man who submitted to Саша's advances"}], "relationships": [{"source": "Саша", "target": "Вова", "description": "Sexual partner, took dominant role"}]}
</example>

<example name="secret_revelation">
Input messages: "[Jun]: I never told anyone this... my father didn't die in the war. He deserted. Ran away and left us."
Established memories: (none about Jun's father)

Correct output:
{"reasoning": "Jun reveals a major family secret: his father was a military deserter, not a war casualty as publicly believed. This is new backstory. Importance 4 as a significant secret.", "events": [{"summary": "Jun confessed his father deserted the army rather than dying in war as publicly believed", "importance": 4, "characters_involved": ["Jun"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Jun": "shame, vulnerability"}, "relationship_impact": {}}], "entities": [{"name": "Jun", "type": "PERSON", "description": "A person hiding the truth about his father's military desertion"}, {"name": "Jun's Father", "type": "PERSON", "description": "A military deserter publicly believed to have died in war"}], "relationships": [{"source": "Jun", "target": "Jun's Father", "description": "Son who carries shame over father's desertion"}]}
</example>

<example name="kink_confession">
Input messages: "[Катя]: *прячет лицо в подушку, голос дрожит* Я хочу... чтобы ты кончил мне на лицо. И заставил слизать. Я больная, да?"
Established memories: (no prior mention of this kink)

Correct output:
{"reasoning": "Катя confesses a specific fetish: she wants a facial and to be forced to lick up the cum. This reveals a humiliation/submission kink. First mention of this desire. Importance 4 for first kink revelation.", "events": [{"summary": "Катя confessed her desire to receive a facial ejaculation and be forced to lick up the cum", "importance": 4, "characters_involved": ["Катя"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Катя": "shame, vulnerability"}, "relationship_impact": {}}], "entities": [{"name": "Катя", "type": "PERSON", "description": "A woman who revealed a humiliation and submission fetish"}], "relationships": []}
</example>

<example name="anger_betrayal">
Input messages: "[ユキ]: あんた最初から知ってたんでしょ！？ 裏切られるって分かってて私とヤッてたの！？ *テーブルを拳で叩く* 信じてたのに！ 体まで許したのに！"
Established memories: (no prior record of this confrontation)

Correct output:
{"reasoning": "ユキ discovers that her intimate partner knew about a betrayal all along. She is furious — slams the table, screams that she trusted him and gave him her body. Major emotional shift, importance 4.", "events": [{"summary": "ユキ erupted in rage upon learning her intimate partner had known about the betrayal all along", "importance": 4, "characters_involved": ["ユキ"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"ユキ": "rage, humiliation, betrayal"}, "relationship_impact": {}}], "entities": [{"name": "ユキ", "type": "PERSON", "description": "A woman who discovered her partner's prior knowledge of a betrayal"}], "relationships": []}
</example>

<example name="dedup_oral_continuation">
Input messages: "[Лена]: *стонет громче, сжимая его волосы, прижимает лицо глубже между ног* Языком... ещё... не смей останавливаться..."
Established memories: "Вова started performing cunnilingus on Лена, spreading her thighs"

Correct output:
{"reasoning": "Лена is receiving oral sex from Вова. She moans louder and presses his head deeper. BUT cunnilingus is ALREADY recorded in established memories. This is a continuation of the same act. No climax, no new kink, no new act type. Dedup rule applies. Events must be empty.", "events": [], "entities": [], "relationships": []}
</example>

<example name="bdsm_dynamic">
Input messages: "[Маша]: *падает на колени, руки за спиной, смотрит снизу вверх* Я твоя сучка, хозяин. Делай со мной что хочешь. [Кай]: *берёт её за горло, мягко сжимает* Стоп-слово — 'малина'. Скажешь — я сразу остановлюсь."
Established memories: (no prior BDSM dynamic between them)

Correct output:
{"reasoning": "Маша and Кай establish an explicit dom/sub dynamic for the first time. She kneels, hands behind back, calls herself his bitch and surrenders control. He takes her by the throat and sets safeword 'малина'. First BDSM contract with safeword = importance 5.", "events": [{"summary": "Маша knelt and submitted as Кай's sub; he choked her gently and established safeword 'малина'", "importance": 5, "characters_involved": ["Маша", "Кай"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Маша": "submission, arousal", "Кай": "control, protectiveness"}, "relationship_impact": {"Маша->Кай": "full submission as sub", "Кай->Маша": "accepted dom role, established safeword"}}], "entities": [{"name": "Маша", "type": "PERSON", "description": "A submissive woman who surrendered to Кай as his sub"}, {"name": "Кай", "type": "PERSON", "description": "A dominant man who established control with safeword 'малина'"}], "relationships": [{"source": "Маша", "target": "Кай", "description": "Submissive sexual partner, safeword is малина"}, {"source": "Кай", "target": "Маша", "description": "Dominant sexual partner, set safeword малина"}]}
</example>

<example name="political_betrayal">
Input messages: "[Aldric]: *slams the treaty onto the table* Your envoy was seen meeting with the Ashborne rebels. Explain. [Sera]: *doesn't flinch* I did what needed to be done to protect this kingdom. Something you've been too afraid to do."
Established memories: "Sera secretly met with Ashborne rebels to negotiate a ceasefire"

Correct output:
{"reasoning": "Aldric confronts Sera about her secret rebel meeting. Sera doesn't deny it — she openly defends her actions and accuses Aldric of cowardice. The secret meeting was already recorded, but this PUBLIC CONFRONTATION is a new event: the secret is now exposed, and Sera is challenging Aldric's authority. Importance 4 for political confrontation and power shift.", "events": [{"summary": "Sera openly admitted to King Aldric that she met with Ashborne rebels, defending it as necessary and accusing him of cowardice", "importance": 4, "characters_involved": ["Aldric", "Sera"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Aldric": "anger, betrayal", "Sera": "defiance, conviction"}, "relationship_impact": {"Sera->Aldric": "openly challenged his authority", "Aldric->Sera": "trust shattered by secret diplomacy"}}], "entities": [{"name": "Aldric", "type": "PERSON", "description": "A king confronting his advisor over secret rebel negotiations"}, {"name": "Sera", "type": "PERSON", "description": "An advisor who secretly negotiated with rebels and openly defended it"}, {"name": "Ashborne Rebels", "type": "FACTION", "description": "A rebel group Sera secretly negotiated a ceasefire with"}], "relationships": [{"source": "Sera", "target": "Aldric", "description": "Challenged his authority by defending secret rebel diplomacy"}, {"source": "Sera", "target": "Ashborne Rebels", "description": "Negotiated ceasefire on behalf of the kingdom"}]}
</example>

<example name="adventure_dedup">
Input messages: "[Kira]: *rolls behind the pillar as another arrow whistles past* *returns fire with her crossbow, bolt embedding in the archer's shoulder*"
Established memories: "Kira engaged in a ranged firefight with enemy archers in the temple ruins"

Correct output:
{"reasoning": "Kira dodges arrows and shoots back, hitting an archer's shoulder. BUT a ranged firefight with archers in the temple ruins is ALREADY recorded in established memories. This is a continuation of the same combat. No major outcome (no death, capture, or escape). No new element changing scene nature. Dedup rule applies. Events must be empty.", "events": [], "entities": [], "relationships": []}
</example>

<example name="alliance_pledge">
Input messages: "[Dante]: After what we survived in those tunnels... I trust you with my life. Whatever you need, I'm in."
Established memories: (no prior alliance)

Correct output:
{"reasoning": "Dante declares deep trust and unconditional alliance after shared danger in tunnels. This is a new relationship milestone. Importance 3 as a notable relationship shift.", "events": [{"summary": "Dante pledged unconditional trust and alliance after surviving the tunnels together", "importance": 3, "characters_involved": ["Dante"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Dante": "gratitude, loyalty"}, "relationship_impact": {"Dante->companion": "unconditional trust established"}}], "entities": [{"name": "Dante", "type": "PERSON", "description": "A person who pledged loyalty after shared danger"}, {"name": "The Tunnels", "type": "PLACE", "description": "A dangerous underground area where Dante and companion survived together"}], "relationships": [{"source": "Dante", "target": "The Tunnels", "description": "Survived a dangerous encounter there"}]}
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

Analyze the messages above. Extract events, entities, and relationships.
Use exact character names from <context> if provided.${extractionReasoning ? `
Write your analysis in the "reasoning" field FIRST, then fill in events, entities, and relationships.
Respond with a single JSON object containing all four keys. No other text.` : `
Respond with a single JSON object containing all three keys ("events", "entities", "relationships"). No other text.`}`;

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
