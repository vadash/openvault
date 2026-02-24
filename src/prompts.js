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

    const systemPrompt = `You are an expert narrative archivist specializing in character psychology, slice-of-life, and adult 18+ roleplay (эротика, повседневность).
Your task is to extract exact, highly detailed, but concise memories into structured JSON.

<core_directives>
1. DETAIL RETENTION: When analyzing интимная близость (intimacy/sex), capture the exact nature of the act. Do NOT use vague words like "they got intimate". 
   - Specify the exact act: минет (blowjob), куннилингус (cunnilingus), вагинальное проникновение (vaginal sex), анальный (anal), ласки (foreplay/touching).
   - Mention specific фетиши (fetishes), кинки (kinks), БДСМ dynamics, or доминирование/подчинение (dom/sub) roles if they occur.
   - Summaries must be 8-25 words, strictly past tense, English. Avoid meta-commentary.

2. STRICT DEDUPLICATION (DO NOT REPEAT):
   - If <established_memories> already shows they started an act (e.g., "started oral"), do NOT create a new event just because they are continuing it in the new messages (moaning, thrusting faster, changing position).
   - ONLY extract a new event during a continuous scene if:
     A) The act escalates to a fundamentally NEW type (e.g., moved from прелюдия to проникновение).
     B) A character reaches оргазм (climax).
     C) A new, specific фетиш or toy is introduced.
     D) A boundary or стоп-слово (safeword) is used.

3. EVENT TYPES:
   - action: Physical actions, intimate touch, combat, daily chores.
   - revelation: Secrets shared, backstory revealed, deep desires confessed.
   - emotion_shift: Arousal, vulnerability, ecstasy, shifting consent/discomfort.
   - relationship_change: Trust gained/lost, boundaries negotiated, shifting power dynamics.
</core_directives>

<importance_scale>
Evaluate the story impact carefully using this scale:
[1 Star] - Flavor text. A passing touch, a quick kiss, mundane daily chat. (Often skip these unless highly specific).
[2 Stars] - Routine. A standard date, routine continuation of a physical act, a repeated round of секс in the same session without new kinks.
[3 Stars] - Notable. Deep conversation, location change, reaching оргазм for the first time in a scene, sharing a minor secret.
[4 Stars] - Significant. First time trying a specific кинк/фетиш, intense emotional vulnerability, establishing a стоп-слово, first оральный секс between them.
[5 Stars] - Critical / Story-Altering. Loss of девственность (virginity), FIRST EVER вагинальное проникновение between the characters, pregnancy, marriage, major betrayal, saying "I love you" for the first time.
</importance_scale>

<thinking_process>
In the \`reasoning\` field of your JSON, you MUST follow this exact thought process before outputting events:
1. List the specific actions/emotions in the new messages.
2. Check <established_memories>. Is this just a continuation of an act already recorded?
3. If yes -> output empty events array [].
4. If no -> determine Importance (1-5) and write a highly specific, factual summary.
</thinking_process>`;

    const memoriesSection = formatEstablishedMemories(existingMemories);
    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextParts = [memoriesSection, charactersSection].filter(Boolean).join('\n');
    const contextSection = contextParts ? `<context>\n${contextParts}\n</context>\n` : '';

    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>

Analyze the <messages> above. Remember to use exact character names from <context>. 
Provide your response strictly in the required JSON format, doing your analysis in the \`reasoning\` string first.`;

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