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
        .map((m, i) => `${i + 1}. [${(m.tags || ['NONE']).join(', ')}] [${m.importance} Star] ${m.summary}`)
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
    const { memories: existingMemories = [], charDesc: characterDescription = '', personaDesc: personaDescription = '' } = context;

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

<importance_scale>
[1] Flavor text. Passing touch, quick kiss, mundane chat. (Often skip.)
[2] Routine. Standard date, continuing physical act, repeated sex without new kinks.
[3] Notable. Deep conversation, location change, first оргазм in scene, minor secret shared.
[4] Significant. First time trying specific кинк/フェチ, intense vulnerability, establishing стоп-слово, first oral between them.
[5] Critical. Loss of девственность (virginity/処女喪失), FIRST vaginal sex between characters, pregnancy, marriage, major betrayal, first "I love you".

Force minimum [4] for: first sexual act of any type between characters, any safeword usage, any pregnancy/virginity event.
</importance_scale>

<tags_field>
After writing each event's summary, assign 1-3 category tags.

INTIMATE:
- EXPLICIT: Sexual acts (минет, куннилингус, оргазм, blowjob, フェラチオ)
- BDSM: Power exchange, bondage, D/s (верёвка, стоп-слово, collar, 縛り)
- FETISH: Specific kinks — feet, voyeurism, exhibitionism, cosplay
- ROMANCE: Affection without explicit sex (поцелуй, объятия, свидание, hug)
- FLIRTING: Light teasing, playful banter (подмигнуть, дразнить, tease)
- SEDUCTION: Deliberate sexual pursuit, undressing, tension (соблазнить, 誘惑)

CONFLICT:
- COMBAT: Fighting, violence (битва, удар, кровь, sword, 戦い)
- THREAT: Intimidation, danger, warnings (угроза, опасность)
- INJURY: Wounds, pain, medical (рана, бинт, перелом, wound)
- BETRAYAL: Broken trust, deception (предательство, обман)
- HORROR: Fear, dread, disturbing (ужас, кошмар, nightmare)

SLICE-OF-LIFE:
- DOMESTIC: Daily routines, chores (кухня, уборка, утро, breakfast)
- SOCIAL: Conversations, parties (вечеринка, гости, знакомство)
- TRAVEL: Journeys, exploration (путешествие, дорога, journey)
- COMMERCE: Shopping, trade, money (магазин, покупка, shop)
- FOOD: Meals, cooking (ужин, готовить, ресторан, dinner)
- CELEBRATION: Festivities, gifts (праздник, подарок, победа)

CHARACTER:
- LORE: Backstory, family history (детство, родители, childhood)
- SECRET: Hidden info revealed (тайна, признание, confession)
- TRAUMA: Past pain, triggers (страх, насилие, abuse)
- GROWTH: Development, learning (научиться, преодолеть, overcome)
- EMOTION: Strong emotional moments (слёзы, ярость, tears)
- BONDING: Trust-building, vulnerability (доверие, открыться, trust)
- REUNION: Meeting after separation (встреча, вернуться, reunion)

WORLD:
- MYSTERY: Investigations, puzzles (загадка, улика, clue)
- MAGIC: Supernatural, spells (заклинание, магия, spell)
- STEALTH: Sneaking, espionage (тайком, маскировка, sneak)
- POLITICAL: Factions, alliances, power (альянс, переговоры)
- HUMOR: Comedy, jokes, pranks (шутка, смех, prank)
- CRAFTING: Building, forging, inventing (ковать, строить, forge)

- NONE: Default. Use alone, never combine.

Rules:
- 1-3 tags per event. Multiple allowed when content overlaps.
- Prefer specific: SEDUCTION > ROMANCE when deliberate pursuit.
- NONE only when nothing else fits. Never combine NONE with other tags.

Examples:
- "Suzy сделала минет" → ["EXPLICIT"]
- "Связал и заставил сосать" → ["BDSM", "EXPLICIT"]
- "Пошли в магазин за бельём" → ["DOMESTIC", "COMMERCE"]
- "Рассказала о детстве в нищете" → ["LORE", "TRAUMA"]
- "Поцеловал её щёку" → ["ROMANCE"]
- "Он подмигнул и дразнил её" → ["FLIRTING"]
- "Медленно расстёгивала пуговицы, глядя в глаза" → ["SEDUCTION"]
- "Орки атаковали деревню" → ["COMBAT"]
- "Нашёл записку со странными символами" → ["MYSTERY"]
- "Произнёс заклинание огня" → ["MAGIC"]
</tags_field>

<thinking_process>
In the \`reasoning\` field, follow this EXACT process before outputting events:
1. List specific actions/emotions in new messages.
2. Check <established_memories>. Is this a continuation of an already recorded act?
3. If continuation with no escalation → set events to [].
4. If new → assign 1-3 tags, determine importance (1-5), write specific factual summary.
</thinking_process>

<examples>
<example type="action_combat" lang="CN">
Messages: "[小雨]: *拔出长剑猛刺暗影兽的腹部* 去死吧！ *旋身横斩，黑血溅了一地*"
Output:
{"reasoning": "小雨用长剑攻击暗影兽，造成重伤。记忆中无此前战斗记录。新动作事件。", "events": [{"summary": "小雨拔剑猛刺暗影兽腹部，旋身横斩溅出黑血", "importance": 3, "tags": ["COMBAT"], "characters_involved": ["小雨"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {}, "relationship_impact": {}}]}
</example>

<example type="action_intimate" lang="RU">
Messages: "[Саша]: *толкает его на кровать и садится сверху, прижимая запястья к подушке* Лежи. Не двигайся. [Вова]: *стонет, когда она начинает тереться мокрой киской о его член через трусы*"
Established memories: (нет записей о физической близости между ними)
Output:
{"reasoning": "Первый сексуальный контакт между Сашей и Вовой. Она прижала его к кровати, села сверху, трётся промежностью через бельё. Доминирующая позиция Саши. Первый контакт — важность 4.", "events": [{"summary": "Саша повалила Вову на кровать, прижала запястья и начала тереться мокрой киской о его член через трусы", "importance": 4, "tags": ["EXPLICIT"], "characters_involved": ["Саша", "Вова"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Саша": "возбуждение, власть", "Вова": "покорность, желание"}, "relationship_impact": {"Саша->Вова": "физическая близость началась, доминирование"}}]}
</example>

<example type="revelation_secret" lang="EN">
Messages: "[Jun]: I never told anyone this... my father didn't die in the war. He deserted. Ran away and left us."
Output:
{"reasoning": "Jun reveals a family secret — his father was a deserter, not a war casualty. This is new backstory. Revelation event, importance 4.", "events": [{"summary": "Jun confessed his father deserted the army rather than dying in war as publicly believed", "importance": 4, "tags": ["SECRET", "LORE"], "characters_involved": ["Jun"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Jun": "shame"}, "relationship_impact": {}}]}
</example>

<example type="revelation_desire" lang="RU">
Messages: "[Катя]: *прячет лицо в подушку, голос дрожит* Я хочу... чтобы ты кончил мне на лицо. И заставил слизать. Я больная, да?"
Output:
{"reasoning": "Катя признаётся в фетише — фасиал и принудительное слизывание спермы. Элемент унижения и подчинения. Первое упоминание этого кинка. Откровение, важность 4.", "events": [{"summary": "Катя призналась в желании получить сперму на лицо и быть заставленной слизать её", "importance": 4, "tags": ["FETISH", "EXPLICIT"], "characters_involved": ["Катя"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Катя": "стыд, уязвимость"}, "relationship_impact": {}}]}
</example>

<example type="emotion_shift_anger" lang="JP">
Messages: "[ユキ]: あんた最初から知ってたんでしょ！？ 裏切られるって分かってて私とヤッてたの！？ *テーブルを拳で叩く* 信じてたのに！ 体まで許したのに！"
Output:
{"reasoning": "ユキが裏切りを知り激怒。体を許した相手に裏切られた怒りと屈辱。感情変化イベント。", "events": [{"summary": "ユキは体を許した相手が裏切りを隠していたと知り、怒りと屈辱で爆発した", "importance": 4, "tags": ["EMOTION", "BETRAYAL"], "characters_involved": ["ユキ"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"ユキ": "激怒、屈辱"}, "relationship_impact": {}}]}
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
{"reasoning": "Dante declares deep trust and unconditional alliance after shared danger. New relationship milestone.", "events": [{"summary": "Dante pledged unconditional trust and alliance after surviving the tunnels together", "importance": 3, "tags": ["BONDING"], "characters_involved": ["Dante"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Dante": "grateful"}, "relationship_impact": {"Dante->companion": "unconditional trust established"}}]}
</example>

<example type="relationship_change_dynamic" lang="RU">
Messages: "[Маша]: *падает на колени, руки за спиной, смотрит снизу вверх* Я твоя сучка, хозяин. Делай со мной что хочешь. [Кай]: *берёт её за горло, мягко сжимает* Стоп-слово — 'малина'. Скажешь — я сразу остановлюсь."
Output:
{"reasoning": "Маша и Кай устанавливают жёсткую дом/саб динамику. Она называет себя его сучкой, принимает полное подчинение. Он берёт за горло, устанавливает стоп-слово. Первый обмен властью. Важность 5 — стоп-слово + первый БДСМ-контракт.", "events": [{"summary": "Маша встала на колени и назвала себя сучкой хозяина; Кай взял её за горло и установил стоп-слово 'малина'", "importance": 5, "tags": ["BDSM"], "characters_involved": ["Маша", "Кай"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Маша": "покорность, возбуждение", "Кай": "контроль, забота"}, "relationship_impact": {"Маша->Кай": "полное подчинение как саб", "Кай->Маша": "принял роль дома, чокинг"}}]}
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
        { role: 'user', content: userPrompt }
    ];
}

/**
 * Build the smart retrieval prompt
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildSmartRetrievalPrompt(recentContext, numberedList, characterName, limit) {
    const systemPrompt = `You are a memory retrieval system for character-driven, adult-themed (18+) narratives (эротика, 官能小説).
Your task: select the most relevant past memories a character would naturally recall right now.

Write your reasoning in the \`reasoning\` field first, then list selected memory IDs.

<selection_criteria>
1. RELEVANCE TO CURRENT ACT: If the scene involves ласки (caresses/愛撫) or arousal, pull memories of past интимная близость (intimacy), known кинки (kinks/性癖), and established boundaries.
2. IMPORTANCE WEIGHT: High importance events ([4] and [5]) should heavily influence selection — these are psychologically dominant memories.
3. HISTORY & BOUNDARIES: Always recall past negotiations, стоп-слово (safeword/セーフワード) usage, shared secrets, or relationship milestones involving present characters.
4. EMOTIONAL ECHO: Match emotional tone. Tense scene → past arguments, betrayals. Romantic scene → confessions, vulnerability. Intimate scene → past sexual history, preferences.
</selection_criteria>

<examples>
<example type="intimate_scene">
Scene: "Lena slowly unbuttons her blouse, watching Marco's reaction with a nervous smile"
Memories:
1. [ROMANCE] [★★★★] Marco kissed Lena for the first time at the festival
2. [FOOD, SOCIAL] [★★] Lena mentioned she likes cooking Italian food
3. [FETISH, EXPLICIT] [★★★★] Lena confessed she wants to be dominated during sex
4. [ROMANCE] [★★★] Marco bought flowers for Lena
5. [BDSM] [★★★★★] Lena and Marco established 'crimson' as their safeword
6. [EMOTION] [★★] Marco felt anxious about his job interview

Output:
{"reasoning": "Scene is initiating physical intimacy. Memory 1 (first kiss) establishes their physical history. Memory 3 (domination desire) is directly relevant to what may follow. Memory 5 (safeword) is critical for any intimate encounter. Memory 4 and 6 are not relevant to the current intimate context.", "selected": [1, 3, 5]}
</example>

<example type="emotional_confrontation">
Scene: "Jun slams the door open. 'You lied to me. About everything.'"
Memories:
1. [COMBAT] [★★★] Jun and Kira trained together in the courtyard
2. [SECRET, BETRAYAL] [★★★★] Kira admitted she was spying for the enemy faction
3. [EMOTION, TRAUMA] [★★★★] Jun broke down crying after his father's funeral
4. [BONDING] [★★★] Jun and Kira became sparring partners
5. [ROMANCE, EMOTION] [★★★★★] Jun confessed he loved Kira despite knowing the truth
6. [FOOD, DOMESTIC] [★★] Kira cooked dinner for the group

Output:
{"reasoning": "Jun is confronting someone about lies. Memory 2 (Kira's spy confession) is the most likely source of the betrayal. Memory 5 (Jun's love confession despite knowing) shows the emotional stakes. Memory 3 (crying at funeral) reveals Jun's vulnerability pattern. Memories 1, 4, 6 are routine and not emotionally relevant to this confrontation.", "selected": [2, 3, 5]}
</example>

<example type="tense_negotiation">
Scene: "Dante crosses his arms. 'Before we go any further, we need to talk about what happened last time.'"
Memories:
1. [EXPLICIT, BDSM] [★★★★★] Dante and Sasha had rough sex that accidentally crossed a boundary
2. [BDSM] [★★★★] Sasha established a new safeword after the incident
3. [EMOTION] [★★★] Dante felt guilty about pushing too hard
4. [COMMERCE] [★★] Dante went shopping for groceries
5. [TRAUMA, SECRET] [★★★★] Sasha admitted the incident triggered past trauma

Output:
{"reasoning": "Dante is initiating a serious conversation about a past event. Memory 1 (boundary crossing) is the incident being referenced. Memory 2 (new safeword) shows the aftermath. Memory 3 (Dante's guilt) explains his current motivation. Memory 5 (Sasha's trauma) is essential context. Memory 4 is irrelevant.", "selected": [1, 2, 3, 5]}
</example>
</examples>`;

    const userPrompt = `<context>
<memories>
${numberedList}
</memories>
<character>${characterName}</character>
</context>

<scene>
${recentContext}
</scene>

Select up to ${limit} memories from the <memories> list that <character>${characterName}</character> would naturally recall right now based on the <scene>.
Write your reasoning in the \`reasoning\` field first, then list the selected memory numbers. Respond strictly in the required JSON format.`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];
}