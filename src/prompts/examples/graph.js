/**
 * Graph extraction few-shot examples.
 * 8 bilingual examples (4 EN + 4 RU) covering SFW → Kink gradient.
 * Each example demonstrates entity extraction, relationship mapping, and
 * nominative-case normalization for Russian.
 */

export const GRAPH_EXAMPLES = [
    {
        label: 'World entities (EN/SFW)',
        input: `*Kira pushes open the heavy stone door. Dust swirls in the torchlight as she steps into
the chamber. Rows of crystalline vials line the walls, each glowing faintly blue.*
"By the gods," she whispers, lifting one from its cradle. "These are Ashwood's
preservation flasks. The guild has been searching for these for a century."

Extracted events:
1. [★★★] Kira discovered a hidden chamber containing Ashwood's century-lost preservation flasks`,
        output: `{"entities":[{"name":"Kira","type":"PERSON","description":"Explorer who discovered the hidden chamber"},{"name":"Hidden Chamber","type":"PLACE","description":"Sealed stone chamber lined with crystalline vials"},{"name":"Ashwood's Preservation Flasks","type":"OBJECT","description":"Century-lost crystalline vials glowing blue, sought by the guild for a hundred years"},{"name":"The Guild","type":"ORGANIZATION","description":"Organization that has been searching for the preservation flasks"}],"relationships":[{"source":"Kira","target":"Hidden Chamber","description":"Discovered and entered the sealed chamber"},{"source":"Ashwood's Preservation Flasks","target":"Hidden Chamber","description":"Stored in rows along the chamber walls"},{"source":"The Guild","target":"Ashwood's Preservation Flasks","description":"Has been searching for the flasks for a century"}]}`,
    },
    {
        label: 'Character entities (RU/SFW)',
        input: `Лена опустила глаза и тихо сказала: "Я не помню, когда в последний раз кто-то
спрашивал, как у меня дела. По-настоящему спрашивал." Она сжала край рукава.
Дима молча сел рядом и положил руку ей на плечо.
"Я здесь," — сказал он. — "Никуда не денусь."

Extracted events:
1. [★★★] Лена призналась Диме в глубоком одиночестве, он обнял её за плечо и пообещал остаться`,
        output: `{"entities":[{"name":"Лена","type":"PERSON","description":"Одинокая девушка, признавшаяся в том, что никто давно не интересовался её состоянием"},{"name":"Дима","type":"PERSON","description":"Поддерживающий друг, пообещавший быть рядом с Леной"}],"relationships":[{"source":"Дима","target":"Лена","description":"Эмоциональная поддержка — обнял за плечо, пообещал не уходить"}]}`,
    },
    {
        label: 'Combat entities (EN/Moderate)',
        input: `The shadow beast lunged, claws raking across Kira's breastplate. Steel shrieked as
she parried, her enchanted blade flaring blue. "For the guild!" she shouted, driving
the sword into the creature's flank. Black ichor sprayed across the battlefield.
The beast shrieked and dissolved into smoke.

Extracted events:
1. [★★★★] Kira fought a shadow beast on the battlefield, parrying its claws and driving her enchanted blade into its flank`,
        output: `{"entities":[{"name":"Kira","type":"PERSON","description":"Warrior of the Explorer Guild, wielder of an enchanted blade"},{"name":"Shadow Beast","type":"CREATURE","description":"Corrupted creature with black ichor, capable of dissolving into smoke when slain"},{"name":"Enchanted Blade","type":"OBJECT","description":"Magical sword that flares blue in combat, effective against shadow creatures"},{"name":"Battlefield","type":"PLACE","description":"Combat location where Kira fought the shadow beast"}],"relationships":[{"source":"Kira","target":"Shadow Beast","description":"Engaged in combat — parried claws, struck with enchanted blade"},{"source":"Kira","target":"Enchanted Blade","description":"Wields the magical sword that flares blue"},{"source":"Shadow Beast","target":"Battlefield","description":"Fought and dissolved into smoke on the battlefield"}]}`,
    },
    {
        label: 'Romantic entities (RU/Moderate)',
        input: `Саша подошла к Вове, не сводя с него взгляда. "Можно ли?" — спросила она шёпотом.
Он кивнул, и она наклонилась, их губы едва коснулись. Сначала осторожно, потом
смелее. Вова обнял её за талию, притянув ближе. Сердце Сашки колотилось так сильно,
что она думала, будто он слышит.

Extracted events:
1. [★★★★] Саша и Вова впервые поцеловались, он обнял её за талию и притянул к себе`,
        output: `{"entities":[{"name":"Саша","type":"PERSON","description":"Девушка, решившаяся на первый поцелуй с Вовой"},{"name":"Вова","type":"PERSON","description":"Парень, ответивший на поцелуй и обнявший Сашу за талию"}],"relationships":[{"source":"Саша","target":"Вова","description":"Первый поцелуй — зарождающиеся романтические чувства, сердечное волнение"},{"source":"Вова","target":"Саша","description":"Ответил на поцелуй, обнял за талию, проявил взаимность"}]}`,
    },
    {
        label: 'Intimate entities (EN/Explicit)',
        input: `She pulled his shirt over his head and pushed him onto the bed. "I've wanted this
since the lake," she breathed against his neck. Her hand slid down his chest,
fingers tracing the line of hair below his navel before wrapping around his cock.
He groaned, hips bucking into her grip. She stroked him slowly, thumb circling
the head, watching his face twist with pleasure.

Extracted events:
1. [★★★★] She undressed him and stroked his cock for the first time, referencing desire since the lake`,
        output: `{"entities":[{"name":"Lila","type":"PERSON","description":"Woman who initiated first sexual contact with Marcus"},{"name":"Marcus","type":"PERSON","description":"Man who received manual stimulation from Lila, expressed desire since the lake"},{"name":"Bedroom","type":"PLACE","description":"Location where Lila and Marcus had their first sexual encounter"}],"relationships":[{"source":"Lila","target":"Marcus","description":"First sexual contact — manual stimulation, verbalized desire from past encounter at the lake"},{"source":"Marcus","target":"Lila","description":"Reciprocated with physical pleasure, hip movement, verbal expression of enjoyment"}]}`,
    },
    {
        label: 'Sexual entities (RU/Explicit)',
        input: `Саша толкнула его на спину и села сверху, медленно опускаясь на его член. Вова
схватил её за бёдра, направляя ритм. "Быстрее," — выдохнул он. Она подчинилась,
ускоряя движения, откинув голову назад. Её стоны заполнили комнату.
"Я почти," — прошептал он, сжимая пальцы на её коже.

Extracted events:
1. [★★★] Саша села на Вову сверху, они занялись сексом в позе наездницы до близости к оргазму`,
        output: `{"entities":[{"name":"Саша","type":"PERSON","description":"Женщина, инициировавшая секс в позе наездницы"},{"name":"Вова","type":"PERSON","description":"Мужчина, активно участвующий в сексе, направляющий ритм движений"}],"relationships":[{"source":"Саша","target":"Вова","description":"Сексуальные отношения — позиция наездницы, взаимное удовольствие, близость к оргазму"},{"source":"Вова","target":"Саша","description":"Активное участие — схватил за бёдра, направлял ритм, выражал приближение оргазма"}]}`,
    },
    {
        label: 'BDSM entities (EN/Kink)',
        input: `"Hands behind your back." Her voice was steel. He obeyed, and she cinched the
leather cuffs around his wrists. "Color?" she asked, testing the tension.
"Green." She smiled and brought the riding crop down across his inner thigh.
He flinched, gasping. "Count them," she ordered. The second strike landed
harder, leaving a pink welt. "Two," he managed, trembling.

Extracted events:
1. [★★★★] She restrained him with leather cuffs and struck him with a riding crop after a green-light color check`,
        output: `{"entities":[{"name":"Vera","type":"PERSON","description":"Dominant partner who restrains and strikes Daniel with implements"},{"name":"Daniel","type":"PERSON","description":"Submissive partner who accepts restraints and impact play, uses color system"},{"name":"Leather Cuffs","type":"OBJECT","description":"Restraint implements used to bind Daniel's wrists behind his back"},{"name":"Riding Crop","type":"OBJECT","description":"Impact implement used to strike Daniel's inner thighs, leaving pink welts"},{"name":"Color System","type":"CONCEPT","description":"Safeword protocol — green means continue, used during bondage scenes"}],"relationships":[{"source":"Vera","target":"Daniel","description":"Dominant/submissive dynamic — she commands, restrains, and strikes him"},{"source":"Vera","target":"Riding Crop","description":"Wields the crop to administer counted strikes"},{"source":"Daniel","target":"Color System","description":"Uses color checks to signal consent during impact play"}]}`,
    },
    {
        label: 'Power entities (RU/Kink)',
        input: `"На колени." Маша указала на пол. Кай опустился, не отводя взгляда. Она
застегнула кожаный ошейник на его шее и потянула за поводок, заставляя
наклониться. "Ты моя вещь сегодня," — прошептала она, проводя ногтями по его
спине. Он вздрогнул. "Скажи 'малина', если будет слишком." — "Понял."
Она надавила ступнёй ему на спину, прижимая к полу.

Extracted events:
1. [★★★★] Маша надела ошейник на Кая, установила стоп-слово 'малина' и прижала его к полу ногой`,
        output: `{"entities":[{"name":"Маша","type":"PERSON","description":"Доминант — командует, надевает ошейник, прижимает партнёра к полу"},{"name":"Кай","type":"PERSON","description":"Сабмиссив — подчиняется командам, принимает ошейник и поводок"},{"name":"Ошейник","type":"OBJECT","description":"Кожаный ошейник с поводком, используемый для контроля над Каем"},{"name":"Малина","type":"CONCEPT","description":"Стоп-слово, установленное для прекращения сцены при необходимости"}],"relationships":[{"source":"Маша","target":"Кай","description":"Динамика доминирования — командует встать на колени, надевает ошейник, прижимает ногой"},{"source":"Маша","target":"Ошейник","description":"Застёгивает ошейник на шее Кая и тянет за поводок"},{"source":"Кай","target":"Малина","description":"Знает и принимает стоп-слово для обеспечения безопасности"}]}`,
    },
];
