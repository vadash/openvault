/**
 * Community summary few-shot examples for the community detection prompt.
 * 6 bilingual examples: 3 English + 3 Russian.
 * Progresses from SFW → Moderate → Explicit content.
 */

export const COMMUNITY_EXAMPLES = [
    {
        label: 'Political faction (EN/SFW)',
        input: `Entities:
- Kira (PERSON): Explorer who discovered the hidden chamber
- Guild Master Aldric (PERSON): Leader of the Explorer Guild
- The Explorer Guild (ORGANIZATION): Organization seeking Ashwood's artifacts
- Ashwood's Preservation Flasks (OBJECT): Century-lost artifacts with resurrection formula

Relationships:
- Kira → Guild Master Aldric: Lied about number of flasks found
- Kira → Ashwood's Flasks: Secretly kept two flasks, practicing resurrection formula
- Guild Master Aldric → The Explorer Guild: Commands operations and assigns missions
- The Explorer Guild → Ashwood's Flasks: Has been searching for a century`,
        output: `{
  "title": "Explorer Guild Flask Conflict",
  "summary": "A brewing internal conflict centered on Ashwood's preservation flasks. Kira, a guild member, has stolen two flasks and is secretly experimenting with a resurrection formula, directly deceiving Guild Master Aldric. The guild has invested a century into finding these artifacts, making Kira's betrayal a critical threat to the organization's trust structure.",
  "findings": [
    "Kira is a mole within the guild — she has the artifacts they've sought for a century and is hiding them",
    "Guild Master Aldric is unaware of the deception, creating an unstable power dynamic that will likely escalate",
    "The resurrection formula is the true prize — the flasks are means to an undisclosed personal goal for Kira",
    "Discovery of the theft would likely result in Kira's expulsion or worse, given the century-long search investment"
  ]
}`,
    },
    {
        label: 'Social circle (RU/SFW)',
        input: `Сущности:
- Лена (PERSON): Одинокая девушка, живущая в общежитии
- Дима (PERSON): Поддерживающий друг, проявляющий заботу
- Соседки (ORGANIZATION): Группа девушек, обсуждающих Лену за спиной
- Общежитие (PLACE): Общежитие, где живут Лена и соседки

Связи:
- Лена → Дима: Эмоциональная зависимость — единственный источник поддержки
- Дима → Лена: Эмоциональная поддержка, обнимал за плечо, обещал быть рядом
- Лена → Соседки: Избегает после слухов и сплетен
- Соседки → Лена: Обсуждают за спиной, создают атмосферу отчуждения`,
        output: `{
  "title": "Социальный круг Лены в общежитии",
  "summary": "Изолированная социальная структура с одним сильным позитивным связью и токсичным фоном. Лена cutoff от коллектива соседок из-за сплетен и испытывает глубокое одиночество. Единственный якорь — Дима, который становится её главным источником эмоциональной поддержки. Риск паттерна: полная зависимость от одного человека при отсутствии альтернативных связей.",
  "findings": [
    "Лена переживает социальную изоляцию — избегает общей кухни и коллектива соседок",
    "Дима — единственная позитивная связь Лены, что создаёт дисбаланс в её социальной сети",
    "Соседки выступают источником токсичного давления через сплетни и обсуждение за спиной",
    "Отношение Лены к Диме формируется на фоне уязвимости и отсутствия альтернатив — основа для потенциальной созависимости"
  ]
}`,
    },
    {
        label: 'Combat alliance (EN/Moderate)',
        input: `Entities:
- Captain Harlan (PERSON): Battle-hardened mercenary leader
- Lyra (PERSON): Young mage with healing magic
- Thorne (PERSON): Heavily armored tank fighter
- Shadowbeast Pack (ORGANIZATION): Hostile creature group attacking the party
- Enchanted Blade (OBJECT): Harlan's magical sword

Relationships:
- Harlan → Lyra: Protective mentor relationship, pushes her to use magic despite fear
- Harlan → Thorne: Bickering allies who respect each other's combat roles
- Lyra → Thorne: Healing support during battles
- Thorne → Shadowbeast Pack: Frontline defender taking damage
- Harlan → Enchanted Blade: Wields with expert skill against multiple enemies`,
        output: `{
  "title": "Mercenary Combat Party",
  "summary": "A three-person combat unit with defined roles and interpersonal tensions. Harlan leads with experience, Thorne absorbs damage, and Lyra provides healing support. The party faces external threat from Shadowbeast Pack while internal dynamics include mentorship, bickering camaraderie, and Lyra's struggle with combat fear. Harlan's protective but demanding approach to Lyra creates both growth and pressure.",
  "findings": [
    "Clear role division: Harlan (leader/damage), Thorne (tank), Lyra (healer) — functional combat synergy",
    "Harlan's mentorship of Lyra is supportive but potentially overbearing — he pushes her past comfort zones",
    "Thorne and Harlan's bickering suggests mutual respect tested by stress of constant combat",
    "Lyra is the emotional center and potential vulnerability — her healing is essential but her fear creates risk",
    "External threat (Shadowbeast Pack) binds the party together despite internal friction"
  ]
}`,
    },
    {
        label: 'Romantic triangle (RU/Moderate)',
        input: `Сущности:
- Андрей (PERSON): Молодой человек, испытывающий чувства к обеим девушкам
- Елена (PERSON): Девушка Андрея, стабильные отношения
- Мария (PERSON): Новая знакомая, вызвавшая романтический интерес
- Общая компания (ORGANIZATION): Друзья, где все трое проводят время

Связи:
- Андрей → Елена: Долгосрочные отношения, привязанность, привычка
- Андрей → Мария: Влечение, флирт, эмоциональный конфликт
- Елена → Андрей: Любовь, подозрения об измене
- Мария → Андрей: Взаимный интерес, провокационное поведение
- Елена → Мария: Ревность, напряжённость в совместных встречах`,
        output: `{
  "title": "Романтический треугольник Андрея, Елены и Марии",
  "summary": "Классический любовный треугольник с центральным конфликтом вокруг Андрея. Долгосрочная стабильность с Еленой конкурирует с новым влечением к Марии. Елена чувствует угрозу и проявляет ревность, Мария активно флиртует, Андрей колеблется между привязанностью и желанием. Ситуация усугубляется тем, что все трое вынуждены общаться в общей компании.",
  "findings": [
    "Андрей находится в центре конфликта и должен сделать выбор между стабильностью (Елена) и новизной (Мария)",
    "Елена воспринимает Марию как реальную угрозу — её ревность обоснована поведением Андрея",
    "Мария ведёт себя провокационно, не уважая границы существующих отношений",
    "Общая компания становится полем битвы — вынужденное общение усиливает напряжение",
    "Отсутствие честного разговора ведёт к эскалации — ревность Елены и флирт Марии столкнутся"
  ]
}`,
    },
    {
        label: 'Intimate network (EN/Explicit)',
        input: `Entities:
- Lila (PERSON): Woman exploring dominant sexuality with Marcus
- Marcus (PERSON): Man becoming sexually submissive to Lila
- Julia (PERSON): Lila's close friend who knows about the dynamic
- Bedroom (PLACE): Private space where their encounters occur
- Hair Pulling (CONCEPT): Sexual act Lila introduced and enjoys

Relationships:
- Lila → Marcus: Sexual dominance, hair-pulling, requests for rougher treatment
- Marcus → Lila: Sexual submission, compliance with her requests, escalating intensity
- Lila → Julia: Confides about sexual encounters, discusses desires
- Julia → Lila: Supportive listener, validates her exploration
- Marcus → Hair Pulling: Initially resisted, now accepts and responds to`,
        output: `{
  "title": "Lila and Marcus Intimate Circle",
  "summary": "A sexual dynamic between Lila and Marcus where traditional roles are reversed — Lila dominates and Marcus submits. Their encounters have escalated from first sexual contact to rough play including hair-pulling and requests for feeling 'owned.' Julia serves as Lila's confidant outside the bedroom. Marcus shows increasing comfort with submission while Lila explores her dominant desires.",
  "findings": [
    "Power dynamic has inverted: Lila directs the sexual encounters and makes requests",
    "Marcus accepts submission — initial resistance to hair-pulling transformed into response",
    "Lila uses Julia as emotional outlet to process her dominant sexuality",
    "Escalation pattern: from first contact to hair-pulling to requests for 'feeling owned' suggests deepening exploration",
    "Julia's role as confidant provides Lila validation but also creates secrecy from Marcus about their discussions"
  ]
}`,
    },
    {
        label: 'Power hierarchy (RU/Explicit)',
        input: `Сущности:
- Маша (PERSON): Доминант — командует, контролирует сцены с ошейником и поводком
- Кай (PERSON): Сабмиссив — подчиняется, носит ошейник, переносит динамику в быт
- Ошейник (OBJECT): Кожаный ошейник с поводком для контроля
- Малина (CONCEPT): Стоп-слово для прекращения сцены

Связи:
- Маша → Кай: Динамика доминирования — команды, ошейник, физический контроль
- Кай → Маша: Эмоциональная зависимость — чувствует себя спокойнее под её контролем
- Маша → Ошейник: Застёгивает на Кае как инструмент власти
- Кай → Малина: Знает стоп-слово, но ни разу не использовал
- Маша → Кай (забота): Выразила беспокойство о потере его воли за пределами сцен`,
        output: `{
  "title": "Динамика власти Маши и Кая",
  "summary": "Замкнутая система из двух человек с выраженной иерархией доминирования. Маша выступает полным контролёром — от сцен с ошейником и поводком до бытовых решений. Кай добровольно расширяет подчинение за пределы оговорённых сцен (ужин на коленях, просьба не снимать ошейник). Критический сигнал: Маша сама обеспокоена стиранием границ, но Кай воспринимает подчинение как источник психологического комфорта.",
  "findings": [
    "Стоп-слово 'малина' существует, но Кай ни разу его не использовал — неясно, способен ли он им воспользоваться при реальной необходимости",
    "Динамика вышла за пределы сцен: Кай подчиняется в быту без запроса Маши, что указывает на психологическую зависимость",
    "Маша — единственный сдерживающий фактор в системе, её беспокойство о потере воли Кая — ключевой конфликт",
    "Если Маша отдалится или устанет от роли контролёра, у Кая нет альтернативных источников эмоциональной стабильности"
  ]
}`,
    },
];
