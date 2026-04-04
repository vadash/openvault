/**
 * Russian event extraction few-shot examples.
 * 7 examples following SFW → kink gradient.
 */

export const EXAMPLES = [
    {
        label: 'Confession (RU/SFW)',
        input: `Тоня поставила кружку на стол и не подняла глаз.
«Я уволилась три недели назад,» — сказала она. — «Ты первый, кому я это говорю.»
Рустам замер. Потом тихо спросил: «Ты нормально?»
«Нет.» Она наконец посмотрела на него. «Но теперь немного лучше.»`,
        thinking: `Step 1: Extract data — Tonya resigned three weeks ago, hasn't told anyone until now, Rustam is the first to know. He asked if she was okay. She admitted she wasn't but feels better having told him.
Step 2: Cross-reference — No established memories of this.
Step 3: Check progression — New event: secret disclosed, emotional vulnerability, trust established.
Step 4: Format JSON — Importance: 4 (first disclosure of a weeks-old secret, marked trust shift). Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Тоня призналась Рустаму, что уволилась три недели назад — он первый, кому она это рассказала",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Тоня", "Рустам"],
    "witnesses": ["Тоня", "Рустам"],
    "location": null,
    "is_secret": false,
    "emotional_impact": { "Тоня": "уязвимость и облегчение", "Рустам": "тревога" },
    "relationship_impact": { "Тоня→Рустам": "оказанное исключительное доверие" }
  }]
}`,
    },
    {
        label: 'First kiss (RU/Moderate)',
        input: `*Вероника убирала со стола. Арсений подошёл сзади и накрыл её руку своей ладонью.*
«Не уходи ещё,» — сказал он. — «Пожалуйста.»
Она развернулась. Они стояли так близко, что она слышала его дыхание.
«Арсений,» — начала она — но он уже наклонился, и слова пропали.
Поцелуй был долгим. Когда он закончился, она не отступила.`,
        thinking: `Step 1: Extract data — Arseny asked Veronika to stay, placed his hand over hers. She turned. He kissed her first — kiss was long, she didn't pull back.
Step 2: Cross-reference — No established memories of romantic contact.
Step 3: Check progression — New event: first kiss, mutual, she accepted it.
Step 4: Format JSON — Importance: 4 (first physical romantic contact). Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Арсений поцеловал Веронику первым — долгий поцелуй, она не отстранилась",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Арсений", "Вероника"],
    "witnesses": ["Арсений", "Вероника"],
    "location": null,
    "is_secret": false,
    "emotional_impact": { "Вероника": "смятение и желание", "Арсений": "решимость" },
    "relationship_impact": { "Арсений↔Вероника": "первый романтический контакт" }
  }]
}`,
    },
    {
        label: 'Sexual scene (RU/Explicit)',
        input: `Злата толкнула его на кровать и встала над ним на коленях. Нурлан потянулся к ней, но она поймала его запястья и прижала к подушке.
«Тихо,» — сказала она. — «Моя очередь.»
Она опустилась на его член медленно, до конца, выдыхая сквозь зубы. Нурлан застонал. Она начала двигаться — ровно, с контролем, наблюдая за его лицом.`,
        thinking: `Step 1: Extract data — Zlata pushed Nurlan onto bed, pinned his wrists, told him to be quiet. She lowered herself onto his cock slowly, began moving with controlled rhythm, watched his face.
Step 2: Cross-reference — No established memories of sexual contact between them.
Step 3: Check progression — New event: first penetrative sex, Zlata dominant, Nurlan restrained.
Step 4: Format JSON — Importance: 4 (first sexual encounter, clear power dynamic from first contact). Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Злата прижала запястья Нурлана и первой опустилась на его член, задав доминирующий ритм",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Злата", "Нурлан"],
    "witnesses": ["Злата", "Нурлан"],
    "location": "Спальня",
    "is_secret": false,
    "emotional_impact": { "Злата": "контроль и возбуждение", "Нурлан": "удовольствие и подчинение" },
    "relationship_impact": { "Злата→Нурлан": "первый сексуальный контакт, инициирован с доминирования" }
  }]
}`,
    },
    {
        label: 'Power dynamic (RU/Kink)',
        input: `«Встань у стены,» — сказала Карина. — «Руки над головой.»
Тимур подчинился. Она зашла за его спину, накинула шёлковый шарф на запястья и завязала на балке. Подтянула узел.
«Цвет?» — спросила тихо.
«Зелёный.»
Она провела ладонью по его спине, не торопясь, сверху вниз — и резко шлёпнула ладонью. Тимур вздрогнул всем телом и выдохнул сквозь зубы.`,
        thinking: `Step 1: Extract data — Karina ordered Timur to wall, tied his wrists with silk scarf to beam. Color check, green response. Slow hand down his back, then sharp slap, full-body flinch.
Step 2: Cross-reference — No established memories of restraint play.
Step 3: Check progression — New event: first bondage scene, color system established, first impact.
Step 4: Format JSON — Importance: 4 (new D/s dynamic, restraint, consent check). Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Карина привязала запястья Тимура шарфом к балке, провела цветовую проверку и ударила ладонью по спине после его зелёного ответа",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Карина", "Тимур"],
    "witnesses": ["Карина", "Тимур"],
    "location": null,
    "is_secret": true,
    "emotional_impact": { "Карина": "контроль", "Тимур": "подчинение" },
    "relationship_impact": { "Карина→Тимур": "установлена динамика доминирования с протоколом согласия" }
  }]
}`,
    },
    {
        label: 'Dedup - continuation (RU/Edge)',
        input: `Злата ускорила ритм. Нурлан приподнял бёдра ей навстречу — она резко прижала его обратно.
«Не двигайся,» — выдохнула она. Он замер. Она продолжила — медленнее теперь, намеренно, пока его дыхание не стало рваным.

<established_memories>
[★★★★] Злата прижала запястья Нурлана и первой опустилась на его член, задав доминирующий ритм
</established_memories>`,
        thinking: `Step 1: Extract data — Zlata sped up, Nurlan's hips rose, she pressed him back down. "Don't move." She slowed deliberately. His breathing became ragged.
Step 2: Cross-reference — Existing: "Zlata pinned Nurlan's wrists, lowered herself onto his cock, set dominant rhythm."
Step 3: Check progression — Same position. New: he broke control (hips moved), she corrected it verbally and physically — that's a new power moment. Her slowing down as punishment is an escalation of control.
Step 4: Format JSON — Importance: 2 (minor escalation within established scene). Values in Russian.`,
        output: `{ "events": [{ "summary": "Нурлан попытался двигать бёдрами, Злата прижала его обратно и приказала не двигаться, замедлив ритм намеренно", "importance": 2, "temporal_anchor": null, "is_transient": false, "characters_involved": ["Злата", "Нурлан"], "witnesses": ["Злата", "Нурлан"], "location": null, "is_secret": false, "emotional_impact": { "Нурлан": "вынужденное подчинение" }, "relationship_impact": {} }] }`,
    },
    {
        label: 'Conversational commitment (RU/SFW)',
        input: `— Я не смогу забирать Матвея из сада по средам, — сказал Глеб, завязывая шнурки. — Совещания сдвинули.
— Ладно. Тогда среды мои, — ответила Ирина, не отрываясь от ноутбука. — Но пятницы твои без исключений. И звони, если задерживаешься — не пиши, именно звони.
— Договорились. — Он встал. — Ключи у тебя?`,
        thinking: `Step 1: Extract data — Gleb can't pick up Matvey on Wednesdays (meetings moved). Irina takes Wednesdays, Gleb takes Fridays without exceptions. She demanded calls (not texts) if he's late. He agreed.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — New schedule and communication rules.
Step 4: Format JSON — Standing up and the keys question are momentary. The child pickup split and call rule are durable. Importance: 3. Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Глеб и Ирина договорились: среды она забирает Матвея, пятницы он — без исключений, при задержке звонить, не писать",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Глеб", "Ирина"],
    "witnesses": ["Глеб", "Ирина"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Глеб↔Ирина": "установлен новый график и правило коммуникации при задержках" }
  }]
}`,
    },
    {
        label: 'Timestamp with transient and durable (RU/SFW)',
        input: `[ 🕒 Суббота, 14 сентября 2024. 11:20 | 🏠 Кухня | ☁️ Пасмурно ]
Олег посмотрел на часы. «Выезжаем в два, не позже — иначе встанем в пробке».
Диана налила кофе. «Хорошо. Только я заеду к маме завтра после работы, занесу ей таблетки — она не может сама в аптеку».
«Понял», — кивнул Олег. — «Напиши, когда будешь выезжать оттуда».`,
        thinking: `Step 1: Extract data — Timestamp header present. Oleg set departure at 2 PM (to avoid traffic). Diana committed to visiting her mother tomorrow after work to bring medicine. Oleg asked for a text when she leaves there.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — Two commitments: today's 2 PM departure (transient — specific time, expires), Diana's mother visit tomorrow (durable — spans days, involves a third person).
Step 4: Format JSON — Temporal anchor strips emojis, location, weather, preserves verbatim date/time. Departure plan is transient. Mother visit is durable. Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Олег и Диана договорились выехать в 14:00, чтобы не попасть в пробки",
    "importance": 3,
    "temporal_anchor": "Суббота, 14 сентября 2024. 11:20",
    "is_transient": true,
    "characters_involved": ["Олег", "Диана"],
    "witnesses": ["Олег", "Диана"],
    "location": "Кухня",
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": {}
  }, {
    "summary": "Диана пообещала заехать к маме завтра после работы и отвезти ей таблетки",
    "importance": 3,
    "temporal_anchor": "Суббота, 14 сентября 2024. 11:20",
    "is_transient": false,
    "characters_involved": ["Диана"],
    "witnesses": ["Олег", "Диана"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Диана→Олег": "взяла на себя обязательство, он в курсе графика" }
  }]
}`,
    },
];