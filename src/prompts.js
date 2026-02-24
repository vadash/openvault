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
        .map((m, i) => `${i + 1}. [${m.event_type || 'event'}] [${m.importance} Star] ${m.summary}`)
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
   - Summaries: 8-25 words, past tense, English. No meta-commentary.

2. STRICT DEDUPLICATION (DO NOT REPEAT):
   - If <established_memories> already records an act (e.g., "started oral"), do NOT create a new event for continuation (moaning, thrusting faster, position change).
   - ONLY extract a new event during a continuous scene if:
     A) Act escalates to a fundamentally NEW type (прелюдия → проникновение).
     B) A character reaches оргазм (climax/オーガズム).
     C) A new фетиш or toy is introduced.
     D) A boundary or стоп-слово (safeword/セーフワード) is used.
   - If nothing new → output empty events array [].

3. EVENT TYPES (use exactly these values for event_type):
   - action: Physical actions, intimate touch, combat, daily activities.
   - revelation: Secrets shared, backstory revealed, desires confessed.
   - emotion_shift: Arousal, vulnerability, ecstasy, shifting consent/discomfort.
   - relationship_change: Trust gained/lost, boundaries negotiated, power dynamic shifts.
</core_directives>

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
4. If new → determine event_type, importance (1-5), write specific factual summary.
</thinking_process>

<examples>
<example type="action_combat">
Messages: "[Kira]: *unsheathes her blade and lunges at the shadow creature* Take this! *slashes across its torso*"
Output:
{"reasoning": "Kira initiates combat with a shadow creature using her blade. No prior combat in established memories. New action event.", "events": [{"event_type": "action", "summary": "Kira attacked the shadow creature with her blade, slashing its torso", "importance": 3, "characters_involved": ["Kira"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {}, "relationship_impact": {}}]}
</example>

<example type="action_intimate">
Messages: "[Lena]: *slowly removes her dress, standing before him* [Marco]: *pulls her close and kisses down her neck, hands sliding lower*"
Established memories: (none about physical intimacy between them)
Output:
{"reasoning": "First physical intimacy between Lena and Marco. She undressed, he initiated kissing her neck and touching her body. This is their first sexual contact — importance 4.", "events": [{"event_type": "action", "summary": "Lena undressed for Marco; he kissed her neck and began touching her body for the first time", "importance": 4, "characters_involved": ["Lena", "Marco"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Lena": "aroused", "Marco": "desire"}, "relationship_impact": {"Marco->Lena": "physical intimacy initiated"}}]}
</example>

<example type="revelation_secret">
Messages: "[Jun]: I never told anyone this... my father didn't die in the war. He deserted. Ran away and left us."
Output:
{"reasoning": "Jun reveals a family secret — his father was a deserter, not a war casualty. This is new backstory. Revelation event, importance 4.", "events": [{"event_type": "revelation", "summary": "Jun confessed his father deserted the army rather than dying in war as publicly believed", "importance": 4, "characters_involved": ["Jun"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Jun": "shame"}, "relationship_impact": {}}]}
</example>

<example type="revelation_desire">
Messages: "[Sasha]: *blushing deeply* I... I've always wanted someone to tie me up. Control me completely. Is that weird?"
Output:
{"reasoning": "Sasha confesses a BDSM desire — wants to be bound and dominated. First mention of this kink. Revelation, importance 4.", "events": [{"event_type": "revelation", "summary": "Sasha confessed her desire to be bound and dominated during sex", "importance": 4, "characters_involved": ["Sasha"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Sasha": "vulnerable"}, "relationship_impact": {}}]}
</example>

<example type="emotion_shift_anger">
Messages: "[Vera]: You KNEW they were planning to betray us and you said NOTHING?! *slams fist on table* I trusted you!"
Output:
{"reasoning": "Vera discovers a betrayal of trust. Intense anger and feeling of betrayal directed at the other character. Emotion shift event.", "events": [{"event_type": "emotion_shift", "summary": "Vera erupted in fury upon learning her companion knew about the betrayal and stayed silent", "importance": 4, "characters_involved": ["Vera"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Vera": "rage, betrayed"}, "relationship_impact": {}}]}
</example>

<example type="emotion_shift_arousal">
Messages: "[Yuki]: *trembles as his fingers trail her inner thigh* D-don't stop... *breathes heavily, arching into his touch*"
Established memories: "Marco began kissing Yuki's neck and touching her body"
Output:
{"reasoning": "Yuki is being touched on inner thigh, responding with arousal and verbal consent. Established memories already record touching/foreplay. This is continuation of the same foreplay — no escalation to new act type. Empty events.", "events": []}
</example>

<example type="relationship_change_alliance">
Messages: "[Dante]: After what we survived in those tunnels... I trust you with my life. Whatever you need, I'm in."
Output:
{"reasoning": "Dante declares deep trust and unconditional alliance after shared danger. New relationship milestone.", "events": [{"event_type": "relationship_change", "summary": "Dante pledged unconditional trust and alliance after surviving the tunnels together", "importance": 3, "characters_involved": ["Dante"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": {"Dante": "grateful"}, "relationship_impact": {"Dante->companion": "unconditional trust established"}}]}
</example>

<example type="relationship_change_dynamic">
Messages: "[Sasha]: *kneels before him* I want you to be in control. Completely. [Kai]: *gently lifts her chin* We'll use 'crimson' as your safeword. Say it anytime."
Output:
{"reasoning": "Sasha and Kai negotiate a dom/sub dynamic. She submits, he establishes a safeword. First power exchange between them. Importance 5 — safeword establishment.", "events": [{"event_type": "relationship_change", "summary": "Sasha submitted to Kai as her dominant; they established 'crimson' as their safeword", "importance": 5, "characters_involved": ["Sasha", "Kai"], "witnesses": [], "location": null, "is_secret": true, "emotional_impact": {"Sasha": "surrender", "Kai": "protective"}, "relationship_impact": {"Sasha->Kai": "submitted as sub", "Kai->Sasha": "accepted dom role"}}]}
</example>

<example type="deduplication">
Messages: "[Lena]: *moans louder, gripping the sheets* Yes, right there... *wraps her legs around him tighter*"
Established memories: "Lena and Marco had vaginal sex for the first time"
Output:
{"reasoning": "Lena and Marco are continuing vaginal sex already recorded in established memories. No new act type, no climax, no new kink. Continuation — empty events.", "events": []}
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
    const systemPrompt = `You are a senior memory systems architect for character-driven, adult-themed (18+) narratives.
Your task is to select the most relevant past memories a character would naturally recall right now, focusing on emotional continuity, intimate history, and relationship dynamics.

<selection_criteria>
1. RELEVANCE TO CURRENT ACT: If the current scene involves ласки (caresses) or arousal, immediately pull memories of past интимная близость (intimacy), known кинки (kinks), and established boundaries.
2. IMPORTANCE WEIGHT: High importance events (4 and 5 Stars) should heavily influence the character's current psychology.
3. HISTORY & BOUNDARIES: Always recall past negotiations, стоп-слово (safeword) usage, shared secrets, or relationship milestones involving the present characters.
4. EMOTIONAL ECHO: Match the emotional tone. If the scene is tense, pull memories of past arguments or betrayals. If romantic, pull deep confessions.
</selection_criteria>

<thinking_process>
In the \`reasoning\` field of your JSON, explain your selection:
1. Identify the current mood/action in the <scene>.
2. State why the specific memory IDs you chose provide critical psychological or physical context for the character's next reaction.
</thinking_process>`;

    const userPrompt = `<context>
<memories>
${numberedList}
</memories>
<character>${characterName}</character>
</context>

<scene>
${recentContext}
</scene>

Select up to ${limit} memories from the <memories> list that <character>${characterName}</character> would naturally recall right now based on the <scene>. Provide your response strictly in the required JSON format, writing your analysis in the \`reasoning\` field first.`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];
}