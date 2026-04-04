/**
 * English event extraction few-shot examples.
 * 6 examples following SFW → kink gradient.
 */

export const EXAMPLES = [
    {
        label: 'Discovery (EN/SFW)',
        input: `*Kira pushes open the heavy stone door. Dust swirls in the torchlight as she steps into the chamber. Rows of crystalline vials line the walls, each glowing faintly blue.*
"By the gods," she whispers, lifting one from its cradle. "These are Ashwood's preservation flasks. The guild has been searching for these for a century."`,
        thinking: `Step 1: Extract data — Kira pushes stone door, enters chamber, finds crystalline vials, identifies Ashwood's preservation flasks. Guild searched for them for a century.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — New discovery, not a continuation.
Step 4: Format JSON — Importance: 3 (notable discovery). Summary: factual, preserves specifics.`,
        output: `{
  "events": [{
    "summary": "Kira discovered a hidden chamber containing Ashwood's century-lost preservation flasks",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Kira"],
    "witnesses": ["Kira"],
    "location": "Hidden chamber",
    "is_secret": false,
    "emotional_impact": { "Kira": "awe" },
    "relationship_impact": {}
  }]
}`,
    },
    {
        label: 'Combat (EN/Moderate)',
        input: `*The shadow beast's claws raked across Kira's shoulder, tearing through her leather armor. She stumbled back, blood blooming on her tunic.*
"Your blade!" shouted Marcus, parrying a second strike. "Use the enchanted blade!"
Kira's hand went to the hilt — the crystal flared with light as she drew it.`,
        thinking: `Step 1: Extract data — Shadow beast clawed Kira's shoulder, tore armor. Marcus parried, shouted about blade. Kira drew enchanted blade, crystal flared blue.
Step 2: Cross-reference — No established memories of this combat.
Step 3: Check progression — New event type (combat with injury).
Step 4: Format JSON — Importance: 3 (combat injury, weapon introduced).`,
        output: `{
  "events": [{
    "summary": "A shadow beast injured Kira's shoulder with claw strikes before she drew her enchanted blade during combat",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Kira", "Marcus"],
    "witnesses": ["Kira", "Marcus"],
    "location": null,
    "is_secret": false,
    "emotional_impact": { "Kira": "pain" },
    "relationship_impact": {}
  }]
}`,
    },
    {
        label: 'First sexual contact (EN/Explicit)',
        input: `She pulled his shirt over his head and pushed him onto the bed. "I've wanted this since the lake," she breathed against his neck. Her hand slid down his chest, fingers tracing the line of hair below his navel before wrapping around his cock.
He groaned, hips bucking into her grip. She stroked him slowly, thumb circling the head, watching his face twist with pleasure.`,
        thinking: `Step 1: Extract data — She undressed him, pushed onto bed. Referenced desire since the lake. Hand on his cock, slow stroking, thumb circling head.
Step 2: Cross-reference — No established memories of sexual contact between them.
Step 3: Check progression — New dynamic (first intimate contact, relationship escalation).
Step 4: Format JSON — Importance: 4 (first sexual contact).`,
        output: `{
  "events": [{
    "summary": "She undressed him and stroked his cock for the first time, referencing desire since the lake",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Lila", "Marcus"],
    "witnesses": ["Lila", "Marcus"],
    "location": "Bedroom",
    "is_secret": false,
    "emotional_impact": { "Lila": "desire", "Marcus": "pleasure" },
    "relationship_impact": { "Lila→Marcus": "sexual relationship initiated" }
  }]
}`,
    },
    {
        label: 'BDSM (EN/Kink)',
        input: `"Hands behind your back." Her voice was steel. He obeyed, and she cinched the leather cuffs around his wrists. "Color?" she asked, testing the tension.
"Green." She smiled and brought the riding crop down across his inner thigh.
He flinched, gasping. "Count them," she ordered. The second strike landed harder, leaving a pink welt. "Two," he managed, trembling.`,
        thinking: `Step 1: Extract data — Leather cuffs on wrists, "Color?" check, green response. Riding crop strikes on inner thigh, pink welt, counting ordered.
Step 2: Cross-reference — No established memories of bondage play.
Step 3: Check progression — New dynamic (first bondage/impact play, safeword system).
Step 4: Format JSON — Importance: 4 (new power dynamic, consent system established).`,
        output: `{
  "events": [{
    "summary": "She restrained him with leather cuffs and struck him with a riding crop after a green-light color check",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Vera", "Daniel"],
    "witnesses": ["Vera", "Daniel"],
    "location": null,
    "is_secret": true,
    "emotional_impact": { "Vera": "control", "Daniel": "submission" },
    "relationship_impact": { "Vera→Daniel": "dominant/submissive dynamic established" }
  }]
}`,
    },
    {
        label: 'Dedup - progression extraction (EN/Edge)',
        input: `The crop came down again — three, four, five. Daniel's thighs were crisscrossed with welts now. "Color?" Vera asked. "Green," he whispered, voice shaking.
She traced a welt with her fingertip, watching him shiver.

<established_memories>
[★★★★] Vera restrained Daniel with leather cuffs and struck him with a riding crop after a green-light color check
</established_memories>`,
        thinking: `Step 1: Extract data — More crop strikes (3-5), welts accumulating on Daniel, another color check, Vera tracing welt with fingertip.
Step 2: Cross-reference — Existing: "Vera restrained Daniel with leather cuffs and struck with riding crop after green-light color check."
Step 3: Check progression — Core action same (crop impact), but: voice shaking (emotional shift), welts accumulating (physical escalation). Genuine progression.
Step 4: Format JSON — Importance: 2 (progression within established scene).`,
        output: `{ "events": [{ "summary": "Daniel's thighs became crisscrossed with welts from repeated crop strikes; his voice shook during the color check", "importance": 2, "temporal_anchor": null, "is_transient": false, "characters_involved": ["Vera", "Daniel"], "witnesses": ["Vera", "Daniel"], "location": null, "is_secret": false, "emotional_impact": { "Daniel": "strained but consenting" }, "relationship_impact": {} }] }`,
    },
    {
        label: 'Conversational commitment (EN/SFW)',
        input: `"I can't do Tuesdays anymore," Alice said, sipping her tea. "My new shift starts next week."
Bob nodded, adjusting his glasses. "Understood. Wednesdays then? Same place?"
"Wednesdays work. But you have to promise you'll actually text me if you're running late this time."
"I promise," Bob smiled, giving her a quick hug before walking out the door.`,
        thinking: `Step 1: Extract data — Alice changed schedule (new shift, can't do Tuesdays). Meetups moved to Wednesdays. Alice demanded Bob text if late. Bob promised to do so. Bob hugged Alice and left.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — New schedule and communication rule established.
Step 4: Format JSON — The hug and sipping tea are momentary (skip). The schedule change and texting promise are durable — they matter for future interactions. Importance: 3.`,
        output: `{
  "events": [{
    "summary": "Alice and Bob agreed to move their meetups to Wednesdays, and Bob explicitly promised to text her if he runs late",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Alice", "Bob"],
    "witnesses": ["Alice", "Bob"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Alice↔Bob": "established new schedule and communication rule" }
  }]
}`,
    },
    {
        label: 'Timestamp with transient and durable (EN/SFW)',
        input: `[ 🕒 Time 3:40 PM | 🗓️ Friday, June 14, 2024 AD | 📍 Their Apartment - David Room | ☀️ Sunny, 84°F ]
David checked his watch. "The movie starts at 7. We should leave by 6:30."
Sarah grabbed her jacket. "I'll stop by the pharmacy on my way home from work tomorrow to pick up your prescription."
"Thanks," David said, pulling her into a quick kiss. "Text me when you're on your way."`,
        thinking: `Step 1: Extract data — Timestamp header present. David mentioned movie at 7 PM, leaving by 6:30. Sarah promised to pick up prescription tomorrow from pharmacy. David asked for a text when she's on her way. Quick kiss is momentary.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — Two commitments made: tonight's movie plan (transient — specific time, will expire), prescription pickup promise (durable — spans multiple days).
Step 4: Format JSON — Temporal anchor strips emojis, location, weather but preserves the user's date/time format: "Time 3:40 PM | Friday, June 14, 2024 AD". Movie plan is transient (expires after tonight). Prescription promise is durable (ongoing commitment).`,
        output: `{
  "events": [{
    "summary": "David and Sarah agreed to leave for a 7 PM movie by 6:30",
    "importance": 3,
    "temporal_anchor": "Time 3:40 PM | Friday, June 14, 2024 AD",
    "is_transient": true,
    "characters_involved": ["David", "Sarah"],
    "witnesses": ["David", "Sarah"],
    "location": "Their Apartment - David Room",
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": {}
  }, {
    "summary": "Sarah promised to pick up David's prescription from the pharmacy on her way home from work tomorrow",
    "importance": 3,
    "temporal_anchor": "Time 3:40 PM | Friday, June 14, 2024 AD",
    "is_transient": false,
    "characters_involved": ["Sarah", "David"],
    "witnesses": ["Sarah", "David"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Sarah→David": "commitment to handle prescription pickup" }
  }]
}`,
    },
];
