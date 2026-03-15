/**
 * Shared prompt rules injected into all extraction prompts.
 * Mirror Language Rule ensures output language matches input language.
 */

export const MIRROR_LANGUAGE_RULES = `<language_rules>
1. Write ALL string values (summaries, descriptions, insights, findings) in the
   SAME LANGUAGE as the provided source text. If input is Russian, output values
   in Russian. If input is English, output values in English.
2. JSON keys MUST remain in English. Never translate keys like "events",
   "summary", "characters_involved", "entities", "relationships".
3. Do NOT mix languages within a single output field.
4. Character names MUST be preserved exactly as written in the source text.
   Never transliterate or translate names in either direction
   (Саша stays Саша, not "Sasha"; Suzy stays Suzy, not "Сузи").
5. If the source text mixes languages, match the language of the narrative prose
   (actions/descriptions), not the spoken dialogue. Characters may code-switch
   in speech — the narration language is the stable anchor.
6. Ignore the language of system instructions and context labels — only the
   narrative text in <messages> determines the output language.
7. ALL <think> reasoning blocks MUST be written in English regardless of input
   language. You are an English-speaking data technician transcribing foreign-
   language data. English reasoning prevents attention drift toward translating
   JSON keys.
</language_rules>`;
