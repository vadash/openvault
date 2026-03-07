/**
 * Salient question few-shot examples for question generation.
 * 6 bilingual examples (3 EN + 3 RU) progressing SFW → explicit.
 */

export const QUESTION_EXAMPLES = [
    {
        label: 'Adventure psychology (EN/SFW)',
        input: `Recent memories for Kira:
1. [★★★] Kira discovered a hidden chamber containing Ashwood's century-lost preservation flasks
2. [★★] Kira argued with guild master about sharing the flask discovery
3. [★★★★] Kira lied to the guild about finding only three flasks, secretly keeping two
4. [★★★] Kira decoded ancient text on the flask labels revealing a resurrection formula
5. [★★] Kira practiced the formula alone at night, burning her fingertips on failed attempts`,
        output: `{
  "questions": [
    "Why is Kira hiding flasks from the guild she pledged loyalty to, and what does this deception reveal about her shifting priorities?",
    "How is Kira's obsession with the resurrection formula connected to her unresolved grief, and is it driving her toward self-destruction?",
    "What will happen to Kira's position in the guild if her theft and secret experiments are discovered?"
  ]
}`,
    },
    {
        label: 'Isolation patterns (RU/SFW)',
        input: `Последние воспоминания для Лены:
1. [★★★] Лена призналась Диме в глубоком одиночестве, он обнял её за плечо и пообещал остаться
2. [★★] Лена избегала общей кухни в общежитии три дня подряд
3. [★★★] Лена впервые улыбнулась за неделю, когда Дима принёс ей чай
4. [★★] Лена услышала, как соседки обсуждают её за спиной
5. [★★★★] Лена рассказала Диме о буллинге в школе, впервые упомянув об этом вслух`,
        output: `{
  "questions": [
    "Как детский опыт буллинга формирует нынешнюю изоляцию Лены и её неспособность доверять окружающим?",
    "Становится ли зависимость Лены от Димы как единственного источника поддержки здоровой привязанностью или опасной созависимостью?",
    "Что произойдёт с эмоциональным состоянием Лены, если Дима отдалится или разочарует её?"
  ]
}`,
    },
    {
        label: 'Trauma coping (EN/Moderate)',
        input: `Recent memories for Mara:
1. [★★★★] Mara killed three raiders in ambush, suffering a shoulder wound
2. [★★★] Mara refused healing from the village priest, preferring to bind the wound herself
3. [★★] Mara woke screaming from nightmare about the raid
4. [★★★] Mara flinched when a merchant reached for her sword arm
5. [★★★] Mara confessed to her companion that she feels numb during fights, not brave`,
        output: `{
  "questions": [
    "Is Mara's refusal of healing and self-isolation after combat a sign of resilience or deepening trauma?",
    "How is the combat numbness Mara describes affecting her ability to form trusting relationships outside of life-or-death situations?",
    "What triggered the raid nightmare, and is Mara processing the violence or suppressing it?"
  ]
}`,
    },
    {
        label: 'Romantic vulnerability (RU/Moderate)',
        input: `Последние воспоминания для Ани:
1. [★★★★] Аня впервые поцеловала Сергея на крыше, дрожа от страха и возбуждения
2. [★★★] Аня провела ночь, размышляя о поцелуе, и не смогла уснуть
3. [★★] Аня избегала взгляда Сергея на следующее утро, краснея при встрече
4. [★★★] Аня написала в дневнике, что боится ruin everything if she admits her feelings
5. [★★] Аня спросила подругу, как понять, что это любовь, а не просто влюблённость`,
        output: `{
  "questions": [
    "Почему Аня так боится признаться в своих чувствах Сергею, даже после взаимного поцелуя?",
    "Является ли смешение языков в мыслях Ани признаком внутренней борьбы между логикой и эмоциями?",
    "Что стоит за страхом Ани 'всё испортить' — прошлый опыт или неуверенность в себе?"
  ]
}`,
    },
    {
        label: 'Intimacy patterns (EN/Explicit)',
        input: `Recent memories for Lila:
1. [★★★★] Lila initiated sex with Marcus for the first time, stroking his cock while referencing desire since the lake
2. [★★★] Lila asked Marcus to pull her hair during sex, testing his reaction
3. [★★] Lila told Marcus she doesn't want gentle — she wants to feel owned
4. [★★★★] Lila broke down crying after an intense session, saying she doesn't know why
5. [★★★] Lila refused to discuss the crying incident the next morning, deflecting with humor`,
        output: `{
  "questions": [
    "What psychological need is Lila fulfilling by escalating physical intensity and requesting dominance from Marcus?",
    "Is Lila's post-sex breakdown a sign of unprocessed trauma surfacing through intimacy, or emotional overwhelm from vulnerability?",
    "How will Lila's refusal to process her emotional reactions affect the sustainability of her sexual relationship with Marcus?"
  ]
}`,
    },
    {
        label: 'Submission psychology (RU/Explicit)',
        input: `Последние воспоминания для Кая:
1. [★★★★] Маша надела ошейник на Кая, установила стоп-слово 'малина' и прижала его к полу ногой
2. [★★★] Кай попросил Машу не снимать ошейник после сцены — хотел носить его весь вечер
3. [★★] Кай приготовил ужин для Маши, не дожидаясь просьбы, стоя на коленях пока она ела
4. [★★★★] Кай признался, что чувствует себя спокойнее, когда Маша принимает все решения за него
5. [★★★] Маша выразила беспокойство, что Кай теряет собственную волю за пределами сцен`,
        output: `{
  "questions": [
    "Является ли стремление Кая к постоянному подчинению здоровым выражением его натуры или попыткой избежать ответственности за собственную жизнь?",
    "Как размывание границ между сценами и повседневной жизнью влияет на равноправие отношений Маши и Кая?",
    "Что стоит за потребностью Кая в том, чтобы Маша принимала все решения — доверие, травма или страх самостоятельности?"
  ]
}`,
    },
];
