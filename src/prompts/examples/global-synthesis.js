/**
 * Global synthesis few-shot examples.
 * 4 bilingual examples: 2 English + 2 Russian.
 * Demonstrates map-reduce over community summaries.
 */

export const GLOBAL_SYNTHESIS_EXAMPLES = [
    {
        label: 'Political intrigue (EN)',
        input: `Communities:
- Explorer Guild Flask Conflict: Kira has stolen two of Ashwood's preservation flasks and is secretly experimenting with a resurrection formula, deceiving Guild Master Aldric.
- Royal Court Politics: Queen Elena navigates treacherous court politics while hiding her alliance with the northern rebels.
- Merchant Trade Network: The eastern merchants have formed an embargo against the kingdom, threatening economic collapse.`,
        output: `{
  "global_summary": "The kingdom faces internal collapse on three fronts. Kira's theft of the resurrection flasks threatens the Explorer Guild's century-long mission and will likely trigger a leadership crisis when discovered. Queen Elena secretly supports northern rebels while maintaining court appearance, creating a powder keg if exposed. Simultaneously, the eastern merchant embargo has begun economic strangulation. These threads connect through the resurrection formula—Kira's goal likely involves reviving someone central to either the court intrigue or the rebellion, making her deception the linchpin holding the entire fragile state together."
}`,
    },
    {
        label: 'Social evolution (RU)',
        input: `Сообщества:
- Социальный круг Лены в общежитии: Лена переживает социальную изоляцию из-за сплетен соседок, единственная поддержка — Дима.
- Рабочая коллектива офиса: Дима работает в конкурентной среде, его успехи вызывают зависть коллег.
- Семья Лены: Родители Лены оказывают давление наchoice of partner, не одобряя Диму.`,
        output: `{
  "global_summary": "История разворачивается вокруг двух изолированных людей, находящих друг друга в враждебном окружении. Лена вытеснена в социальную изоляцию сплетнями соседок и давлением родителей, Дима — завистью коллег на работе. Их связь становится единственным якорем стабильности, что создаёт риск патологической созависимости. Внешнее давление (родители Лены, коллеги Дима, соседки) усиливается, превращая их отношения в осаждённую крепость. Конфликт приближается: либо внешние силы разрушат союз, либо пара изолируется от всех окружающих полностью."
}`,
    },
    {
        label: 'War narrative (EN)',
        input: `Communities:
- Mercenary Combat Party: Harlan, Lyra, and Thorne fight Shadowbeast Pack with defined roles but internal tension.
- Northern Rebellion: Rebels prepare to overthrow the monarchy, secretly allied with Queen Elena.
- Ancient Magic Order: Preserves knowledge of Ashwood's resurrection formula, seeking to prevent its misuse.`,
        output: `{
  "global_summary": "A kingdom on the brink of transformation through war and forbidden magic. The mercenary party serves as the ground-level lens, their survival against Shadowbeasts tied to the larger conflict. Above them, Queen Elena's secret alliance with rebels suggests the monarchy will fall from within, not from external attack. The Ancient Magic Order holds the true power—the resurrection formula—that both sides will likely seek. Harlan's mentorship of Lyra parallels the kingdom's generational transition, with both the party and the nation undergoing identity crises. The narrative trajectory points toward a revelation of the queen's betrayal, a scramble for the resurrection artifact, and the mercenaries caught in the center as survivors of a regime collapse."
}`,
    },
    {
        label: 'Romantic drama (RU)',
        input: `Сообщества:
- Романтический треугольник: Андрей колеблется между стабильными отношениями с Еленой и влечением к Марии.
- Семья Андрея: Родители оказывают pressure on settling down, не зная о конфликте.
- Друзья-общие знакомые: Компания вынуждена наблюдать напряжённость, стороны принимают позиции.`,
        output: `{
  "global_summary": "Классический предразводный сценарий с ускоряющимся коллапсом. Андрей находится в центре треугольника, его нерешительность — топливо для эскалации. Елена чувствует угрозу интуитивно и правота на её стороне усиливает напряжение. Мария ведёт себя провокационно, игнорируя границы. Семья и друзья превращаются в поле битвы: родители Андрея толкают к стабилизации (давление на Елену), общая компания раскалывается на лагеря. Траектория неизбежна: либо Андрей сделает выбор с максимальным ущербом для проигравшей стороны, либо ситуация взорвётся публичным разоблачением. Отсутствие honest conversation гарантирует, что разрешение будет травматическим для всех involved."
}`,
    },
];
