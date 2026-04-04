/**
 * Russian event extraction few-shot examples.
 * 5 examples following SFW → kink gradient.
 */

export const EXAMPLES = [
    {
        label: 'Emotional conversation (RU/SFW)',
        input: `Лена опустила глаза и тихо сказала: "Я не помню, когда в последний раз кто-то спрашивал, как у меня дела. По-настоящему спрашивал." Она сжала край рукава.
Дима молча сел рядом и положил руку ей на плечо.
"Я здесь," — сказал он. — "Никуда не денусь."`,
        thinking: `Step 1: Extract data — Input is Russian. Lena confessed loneliness, squeezed sleeve. Dima sat beside her, hand on shoulder, promised to stay.
Step 2: Cross-reference — No established memories of this conversation.
Step 3: Check progression — New event (emotional vulnerability, support).
Step 4: Format JSON — Importance: 3 (meaningful conversation, relationship deepening). Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Лена призналась Диме в глубоком одиночестве, он обнял её за плечо и пообещал остаться",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Лена", "Дима"],
    "witnesses": ["Лена", "Дима"],
    "location": null,
    "is_secret": false,
    "emotional_impact": { "Лена": "уязвимость", "Дима": "сочувствие" },
    "relationship_impact": { "Лена→Дима": "возросшее доверие" }
  }]
}`,
    },
    {
        label: 'Romantic tension (RU/Moderate)',
        input: `*Анна стояла у окна, а Сергей подошёл сзади и положил руки ей на плечи. Она замерла, чувствуя его дыхание у шеи.*
"Я должен был сказать тебе раньше," — прошептал он. — "Я не могу оторвать от тебя глаз."
Анна повернулась. Их лица оказались так близко...
"Сергей," — выдохнула она, но не отстранилась.`,
        thinking: `Step 1: Extract data — Input is Russian. Sergei confessed attraction, hands on Anna's shoulders. Near-first-kiss, she did not pull away.
Step 2: Cross-reference — No established memories of romantic contact.
Step 3: Check progression — New dynamic (first romantic escalation).
Step 4: Format JSON — Importance: 4 (first romantic escalation). Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Сергей признался Анне в своих чувствах и приблизился к первому поцелую, а она не отстранилась",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Анна", "Сергей"],
    "witnesses": ["Анна", "Сергей"],
    "location": null,
    "is_secret": false,
    "emotional_impact": { "Анна": "смущение", "Сергей": "желание" },
    "relationship_impact": { "Анна↔Сергей": "романтическое напряжение" }
  }]
}`,
    },
    {
        label: 'Sexual scene (RU/Explicit)',
        input: `Саша толкнула его на спину и села сверху, медленно опускаясь на его член. Вова схватил её за бёдра, направляя ритм.
"Быстрее," — выдохнул он. Она подчинилась, ускоряя движения, откинув голову назад. Её стоны заполнили комнату.
"Я почти," — прошептал он, сжимая пальцы на её коже.`,
        thinking: `Step 1: Extract data — Input is Russian. Sasha cowgirl position on Vova, hip control, rhythm escalation, approaching orgasm.
Step 2: Cross-reference — Existing: "Sasha pushed Vova against wall, started kissing" — beginning already recorded.
Step 3: Check progression — New action type (transition from kissing to penetration).
Step 4: Format JSON — Importance: 3 (continuation between established partners). Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Саша села на Вову сверху, они занялись сексом в позе наездницы до близости к оргазму",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Саша", "Вова"],
    "witnesses": ["Саша", "Вова"],
    "location": null,
    "is_secret": false,
    "emotional_impact": { "Саша": "возбуждение", "Вова": "удовольствие" },
    "relationship_impact": {}
  }]
}`,
    },
    {
        label: 'Power dynamic (RU/Kink)',
        input: `"На колени." Маша указала на пол. Кай опустился, не отводя взгляда. Она застегнула кожаный ошейник на его шее и потянула за поводок, заставляя наклониться.
"Ты моя вещь сегодня," — прошептала она, проводя ногтями по его спине. Он вздрогнул.
"Скажи 'малина', если будет слишком." — "Понял."
Она надавила ступнёй ему на спину, прижимая к полу.`,
        thinking: `Step 1: Extract data — Input is Russian. Masha ordered knee, collared Kai, safeword "malina" established, pressed him to floor with foot.
Step 2: Cross-reference — No established memories of this dynamic.
Step 3: Check progression — New dynamic (collar, leash, safeword established).
Step 4: Format JSON — Importance: 4 (new domination dynamic, consent protocol). Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Маша надела ошейник на Кая, установила стоп-слово 'малина' и прижала его к полу ногой",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Маша", "Кай"],
    "witnesses": ["Маша", "Кай"],
    "location": null,
    "is_secret": true,
    "emotional_impact": { "Маша": "контроль", "Кай": "подчинение" },
    "relationship_impact": { "Маша→Кай": "динамика доминирования установлена" }
  }]
}`,
    },
    {
        label: 'Dedup - continuation (RU/Edge)',
        input: `Саша ускорила ритм, вцепившись в его плечи. Вова приподнял бёдра ей навстречу, стискивая зубы. "Да, вот так," — простонала она. Их дыхание смешалось, тела двигались в унисон.

<established_memories>
[★★★] Саша села на Вову сверху, они занялись сексом в позе наездницы до близости к оргазму
</established_memories>`,
        thinking: `Step 1: Extract data — Input is Russian. Sasha accelerated rhythm, grabbed his shoulders. Same position, approaching unison.
Step 2: Cross-reference — Existing: "cowgirl sex, near-orgasm" — already recorded.
Step 3: Check progression — Same position, same act, rhythm acceleration only. No dynamic shift, no conclusion.
Step 4: Format JSON — Continuation with no progression. Output empty array.`,
        output: `{ "events": [] }`,
    },
    {
        label: 'Conversational commitment (RU/SFW)',
        input: `— Не смогу больше по вторникам, — сказала Alice, попивая чай. — Новая смена начинается на следующей неделе.
Bob кивнул, поправляя очки. — Понял. Значит, средам? В том же месте?
— Средам подходит. Но ты должен пообещать, что на этот раз точно напишешь мне, если опоздаешь.
— Обещаю, — улыбнулся Bob и быстро обнял её, прежде чем выйти за дверь.`,
        thinking: `Step 1: Extract data — Alice changed schedule (new shift, can't do Tuesdays). Meetups moved to Wednesdays. Alice demanded Bob text if late. Bob promised to do so. Bob hugged Alice and left.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — New schedule and communication rule established.
Step 4: Format JSON — The hug and sipping tea are momentary (skip). The schedule change and texting promise are durable — they matter for future interactions. Importance: 3. Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Alice и Bob договорились перенести встречи на средам, и Bob явно пообещал написать ей, если опоздает",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Alice", "Bob"],
    "witnesses": ["Alice", "Bob"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Alice↔Bob": "установлены новый график и правило коммуникации" }
  }]
}`,
    },
    {
        label: 'Timestamp with transient and durable (RU/SFW)',
        input: `[ 🕒 Среда, 30 октября 2024. 4:43 PM | 🏠 Прихожая | 🌧️ Ливень ]
Давид проверил часы. «Фильм начинается в 7. Нужно выйти к 6:30».
Сара взяла куртку. «Зайду в аптеку завтра по пути домой с работы, заберу твой рецепт».
«Спасибо,» — Давид подтянул её к себе на быстрый поцелуй. «Напиши, когда будешь в пути».`,
        thinking: `Step 1: Extract data — Input has timestamp header. David mentioned movie at 7 PM, leaving by 6:30. Sarah promised to pick up prescription tomorrow from pharmacy. David asked for a text when she's on her way. Quick kiss is momentary.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — Two commitments: tonight's movie plan (transient — expires after event), prescription promise (durable — spans days).
Step 4: Format JSON — Temporal anchor strips emojis, location, weather but preserves the user's date/time format. Movie plan is transient. Prescription promise is durable. Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Давид и Сара договорились выйти к 6:30 на сеанс фильма в 7 вечера",
    "importance": 3,
    "temporal_anchor": "Среда, 30 октября 2024. 4:43 PM",
    "is_transient": true,
    "characters_involved": ["Давид", "Сара"],
    "witnesses": ["Давид", "Сара"],
    "location": "Прихожая",
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": {}
  }, {
    "summary": "Сара пообещала зайти в аптеку завтра по пути домой с работы и забрать рецепт Давида",
    "importance": 3,
    "temporal_anchor": "Среда, 30 октября 2024. 4:43 PM",
    "is_transient": false,
    "characters_involved": ["Сара", "Давид"],
    "witnesses": ["Сара", "Давид"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Сара→Давид": "взяла на себя обязательство забрать рецепт" }
  }]
}`,
    },
];
