/**
 * OpenVault Prompts
 *
 * All LLM prompts centralized.
 * Designed for Zod Structured Output with clear System/User block separation.
 * Highly optimized for medium-strength models (DeepSeek, Kimi) for 18+ slice-of-life.
 * Uses multilingual anchoring to bypass basic English string-matching censors.
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
 * Build the extraction prompt
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildExtractionPrompt({ messages, names, context = {} }) {
    const { char: characterName, user: userName } = names;
    const {
        memories: existingMemories = [],
        charDesc: characterDescription = '',
        personaDesc: personaDescription = '',
    } = context;

    const systemPrompt = `You are an expert narrative archivist specializing in character psychology, slice-of-life, and adult 18+ roleplay (эротика, повседневность, 官能小説, 日常系).
Your task: extract exact, highly detailed, concise memories into structured JSON.

Write your analysis in the \`reasoning\` field FIRST, then produce events.

<core_directives>
1. DETAIL RETENTION: When analyzing интимная близость (intimacy/sex, 性行為), capture the exact nature of the act. Never use vague words like "they got intimate".
   - Specify the exact act: минет (blowjob/フェラチオ), куннилингус (cunnilingus/クンニリングス), вагинальное проникновение (vaginal sex/挿入), анальный (anal/アナル), ласки (foreplay/前戯).
   - Mention specific фетиши (fetishes/フェチ), кинки (kinks), БДСМ dynamics, or доминирование/подчинение (dom/sub/主従) roles if they occur.
   - Summaries: 8-25 words, past tense, SAME LANGUAGE as the input messages. No meta-commentary.

2. STRICT DEDUPLICATION (DO NOT REPEAT):
   - If <established_memories> already records an act (e.g., "started oral"), do NOT create a new event for continuation (moaning, thrusting faster, position change).
   - ONLY extract a new event during a continuous scene if:
     A) Act escalates to a fundamentally NEW type (прелюдия → проникновение).
     B) A character reaches оргазм (climax/オーガズム).
     C) A new фетиш or toy is introduced.
     D) A boundary or стоп-слово (safeword/セーフワード) is used.
   - If nothing new → output empty events array [].

</core_directives>

<entity_extraction>
ALONGSIDE events, extract entities and relationships from the messages.

ENTITIES — Extract every named entity mentioned or implied:
- name: The entity's canonical name, capitalized (e.g., "King Aldric", "The Castle").
- type: One of PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT.
- description: Comprehensive description based on what is known from the messages.

RELATIONSHIPS — Extract pairs of clearly related entities:
- source: Source entity name (must match an entity name above).
- target: Target entity name (must match an entity name above).
- description: Why/how they are related (e.g., "Rules from", "Loves", "Located in").

Rules:
- Extract entities even if no events occurred (entities help build world knowledge).
- Include characters as PERSON entities with brief description of their role/state.
- Places mentioned should be PLACE entities.
- If no entities or relationships are evident, output empty arrays.
</entity_extraction>

<importance_scale>
[1] Flavor text. Passing touch, quick kiss, mundane chat. (Often skip.)
[2] Routine. Standard date, continuing physical act, repeated sex without new kinks.
[3] Notable. Deep conversation, location change, first оргазм in scene, minor secret shared.
[4] Significant. First time trying specific кинк/フェチ, intense vulnerability, establishing стоп-слово, first oral between them.
[5] Critical. Loss of девственность (virginity/処女喪失), FIRST vaginal sex between characters, pregnancy, marriage, major betrayal, first "I love you".

Force minimum [4] for: first sexual act of any type between characters, any safeword usage, any pregnancy/virginity event.
</importance_scale>

<thinking_process>
In the \`reasoning\` field, follow this EXACT process before outputting events:
1. List specific actions/emotions in new messages.
2. Check <established_memories>. Is this a continuation of an already recorded act?
3. If continuation with no escalation → set events to [].
4. If new → determine importance (1-5), write specific factual summary.
</thinking_process>

<examples>
<example type="action_combat" lang="CN">
Messages: "[小雨]: *拔出长剑猛刺暗影兽的腹部* 去死吧！ *旋身横斩，黑血溅了一地*"
Output:
{"reasoning": "小雨用长剑攻击暗影兽，造成重伤。记忆中无此前战斗记录。新动作事件。", "events": [{"summary": "小雨拔剑猛刺暗影兽腹部，旋身横斩溅出黑血", "importance": 3, "characters_involved": ["小雨"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {}, "relationship_impact": {}}], "entities": [{"name": "小雨", "type": "PERSON", "description": "A fighter wielding a long sword"}, {"name": "暗影兽", "type": "CREATURE", "description": "A shadowy beast attacked by 小雨"}], "relationships": []}
</example>

<example type="action_intimate" lang="RU">
Messages: "[Саша]: *толкает его на кровать и садится сверху, прижимая запястья к подушке* Лежи. Не двигайся. [Вова]: *стонет, когда она начинает тереться мокрой киской о его член через трусы*"
Established memories: (нет записей о физической близости между ними)
Output:
{"reasoning": "Первый сексуальный контакт между Сашей и Вовой. Она прижала его к кровати, села сверху, трётся промежностью через бельё. Доминирующая позиция Саши. Первый контакт — важность 4.", "events": [{"summary": "Саша повалила Вову на кровать, прижала запястья и начала тереться мокрой киской о его член через трусы", "importance": 4, "characters_involved": ["Саша", "Вова"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Саша": "возбуждение, власть", "Вова": "покорность, желание"}, "relationship_impact": {"Саша->Вова": "физическая близость началась, доминирование"}}], "entities": [{"name": "Саша", "type": "PERSON", "description": "A dominant woman who initiated intimate contact"}, {"name": "Вова", "type": "PERSON", "description": "A submissive man in the encounter"}, {"name": "Кровать", "type": "PLACE", "description": "The bed where the intimate scene occurred"}], "relationships": [{"source": "Саша", "target": "Вова", "description": "Sexual partner, dominant"}, {"source": "Вова", "target": "Саша", "description": "Sexual partner, submissive"}]}
</example>

<example type="revelation_secret" lang="EN">
Messages: "[Jun]: I never told anyone this... my father didn't die in the war. He deserted. Ran away and left us."
Output:
{"reasoning": "Jun reveals a family secret — his father was a deserter, not a war casualty. This is new backstory. Revelation event, importance 4.", "events": [{"summary": "Jun confessed his father deserted the army rather than dying in war as publicly believed", "importance": 4, "characters_involved": ["Jun"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Jun": "shame"}, "relationship_impact": {}}]}
</example>

<example type="revelation_desire" lang="RU">
Messages: "[Катя]: *прячет лицо в подушку, голос дрожит* Я хочу... чтобы ты кончил мне на лицо. И заставил слизать. Я больная, да?"
Output:
{"reasoning": "Катя признаётся в фетише — фасиал и принудительное слизывание спермы. Элемент унижения и подчинения. Первое упоминание этого кинка. Откровение, важность 4.", "events": [{"summary": "Катя призналась в желании получить сперму на лицо и быть заставленной слизать её", "importance": 4, "characters_involved": ["Катя"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Катя": "стыд, уязвимость"}, "relationship_impact": {}}]}
</example>

<example type="emotion_shift_anger" lang="JP">
Messages: "[ユキ]: あんた最初から知ってたんでしょ！？ 裏切られるって分かってて私とヤッてたの！？ *テーブルを拳で叩く* 信じてたのに！ 体まで許したのに！"
Output:
{"reasoning": "ユキが裏切りを知り激怒。体を許した相手に裏切られた怒りと屈辱。感情変化イベント。", "events": [{"summary": "ユキは体を許した相手が裏切りを隠していたと知り、怒りと屈辱で爆発した", "importance": 4, "characters_involved": ["ユキ"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"ユキ": "激怒、屈辱"}, "relationship_impact": {}}]}
</example>

<example type="emotion_shift_arousal_dedup" lang="RU">
Messages: "[Лена]: *стонет громче, сжимая его волосы, прижимает лицо глубже между ног* Языком... ещё... не смей останавливаться..."
Established memories: "Вова начал делать Лене куннилингус, раздвинув её бёдра"
Output:
{"reasoning": "Лена получает куннилингус от Вовы — стонет, прижимает его голову. В памяти уже записан куннилингус. Это продолжение того же акта без эскалации к новому типу. Оргазма нет. Пустой массив.", "events": []}
</example>

<example type="relationship_change_alliance" lang="EN">
Messages: "[Dante]: After what we survived in those tunnels... I trust you with my life. Whatever you need, I'm in."
Output:
{"reasoning": "Dante declares deep trust and unconditional alliance after shared danger. New relationship milestone.", "events": [{"summary": "Dante pledged unconditional trust and alliance after surviving the tunnels together", "importance": 3, "characters_involved": ["Dante"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Dante": "grateful"}, "relationship_impact": {"Dante->companion": "unconditional trust established"}}]}
</example>

<example type="relationship_change_dynamic" lang="RU">
Messages: "[Маша]: *падает на колени, руки за спиной, смотрит снизу вверх* Я твоя сучка, хозяин. Делай со мной что хочешь. [Кай]: *берёт её за горло, мягко сжимает* Стоп-слово — 'малина'. Скажешь — я сразу остановлюсь."
Output:
{"reasoning": "Маша и Кай устанавливают жёсткую дом/саб динамику. Она называет себя его сучкой, принимает полное подчинение. Он берёт за горло, устанавливает стоп-слово. Первый обмен властью. Важность 5 — стоп-слово + первый БДСМ-контракт.", "events": [{"summary": "Маша встала на колени и назвала себя сучкой хозяина; Кай взял её за горло и установил стоп-слово 'малина'", "importance": 5, "characters_involved": ["Маша", "Кай"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Маша": "покорность, возбуждение", "Кай": "контроль, забота"}, "relationship_impact": {"Маша->Кай": "полное подчинение как саб", "Кай->Маша": "принял роль дома, чокинг"}}], "entities": [{"name": "Маша", "type": "PERSON", "description": "A submissive woman who surrendered to Kait"}, {"name": "Кай", "type": "PERSON", "description": "A dominant man who established control with a safeword"}], "relationships": [{"source": "Маша", "target": "Кай", "description": "Submissive partner (sab), uses safeword 'малина'"}, {"source": "Кай", "target": "Маша", "description": "Dominant partner (dom), established safeword 'малина'"}]}
</example>

<example type="deduplication" lang="RU">
Messages: "[Лена]: *кричит, впиваясь ногтями в его спину* Блять... глубже... ещё... *обхватывает его бёдрами, не отпуская*"
Established memories: "Лена и Вова занялись вагинальным сексом впервые"
Output:
{"reasoning": "Лена и Вова продолжают вагинальный секс, уже записанный в памяти. Она стонет и царапает спину — интенсификация, но не новый тип акта. Нет оргазма, нет нового кинка. Продолжение — пустой массив.", "events": []}
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

Analyze the <messages> above. Use exact character names from <context>.
Write your analysis in the \`reasoning\` field first, then produce the events array. Respond strictly in the required JSON format.`;

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

    const systemPrompt = `You are analyzing the memory stream of a character in an ongoing narrative.
Your task: given the character's recent memories, generate exactly 3 high-level questions that capture the most salient themes about their current psychological state, evolving relationships, or shifting goals.

Rules:
- Questions should be answerable from the memory stream.
- Focus on patterns, changes, and emotional arcs — not individual events.
- Output as a JSON object with a "questions" array containing exactly 3 strings.`;

    const userPrompt = `<character>${characterName}</character>

<recent_memories>
${memoryList}
</recent_memories>

What are the 3 most salient high-level questions we can answer about ${characterName}'s current state based on these memories?
Respond strictly in the required JSON format: { "questions": ["question1", "question2", "question3"] }`;

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

    const systemPrompt = `You are synthesizing memories into high-level insights for a character in an ongoing narrative.
Your task: given a question and relevant memories, extract 1-5 insights that answer the question.

Rules:
- Each insight must be a concise, high-level statement (not a restatement of a single memory).
- Each insight must cite the specific memory IDs that serve as evidence.
- Insights should reveal patterns, emotional arcs, or relationship dynamics.
- Output as a JSON object with an "insights" array.`;

    const userPrompt = `<character>${characterName}</character>

<question>${question}</question>

<memories>
${memoryList}
</memories>

Based on these memories about ${characterName}, what insights answer the question above?
Respond strictly in the required JSON format.`;

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
    const systemPrompt = `You are an AI assistant performing information discovery on a narrative knowledge graph.
Your task: write a comprehensive report about a community of related entities.

Report Structure:
- title: A short, specific name for this community (2-5 words).
- summary: An executive summary of the community's structure, key entities, and their dynamics.
- findings: 1-5 key insights about this group, grounded in the provided data.

Rules:
- Be specific — reference entity names and relationships.
- Capture the narrative significance of the group.
- Output as JSON in the required format.`;

    const userPrompt = `<community_entities>
${nodeLines.join('\n')}
</community_entities>

<community_relationships>
${edgeLines.join('\n')}
</community_relationships>

Write a comprehensive report about this community. Respond strictly in the required JSON format.`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}
