/**
 * English event extraction few-shot examples.
 * 7 examples following SFW → kink gradient.
 */

export const EXAMPLES = [
    {
        label: 'Discovery (EN/SFW)',
        input: `*Ranger Mireille crouches over the cold fire pit and presses her palm flat to the ash. Still warm. She sweeps her torch across the shelter — sleeping roll shoved aside, a pack left open, half-eaten rations scattered like someone left in a hurry.*
"Someone was here within the hour," she says, pulling a scrap of cloth from the entrance post. The color matches the expedition uniform.`,
        thinking: `Step 1: Extract data — Mireille found warm ash, disturbed sleeping roll, abandoned open pack, scattered rations, expedition-colored cloth on entrance post. Concluded presence within the last hour.
Step 2: Cross-reference — No established memories of this shelter or the expedition's route.
Step 3: Check progression — New discovery. First physical evidence the expedition reached this location.
Step 4: Format JSON — Importance 3 (significant find, shifts the investigation's direction). Not transient — physical evidence persists.`,
        output: `{
  "events": [{
    "summary": "Ranger Mireille found a recently abandoned shelter with warm ash, scattered rations, and an expedition-colored cloth — evidence someone was present within the last hour",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Mireille"],
    "witnesses": ["Mireille"],
    "location": "Abandoned shelter",
    "is_secret": false,
    "emotional_impact": { "Mireille": "urgency" },
    "relationship_impact": {}
  }]
}`,
    },
    {
        label: 'Combat injury (EN/Moderate)',
        input: `The attacker came out of the alley fast — blade already drawn. Corin caught the first slash on his forearm and threw himself back against the wall. The second strike got him below the ribs.
*Petra yanked him by the collar and hauled him around the corner before the man could follow.*
"How deep?" she demanded, pressing her hand over the wound.
"Keep moving," Corin said. His voice was steady. His legs weren't.`,
        thinking: `Step 1: Extract data — Unknown attacker struck Corin twice: slash on forearm, stab below ribs. Petra pulled him to safety. Corin told her to keep moving; visibly weakened. Wound depth unknown.
Step 2: Cross-reference — No established memories of this attacker or this confrontation.
Step 3: Check progression — New event. First injury recorded for Corin; new threat introduced.
Step 4: Format JSON — Importance 4 (significant physical injury, severity unknown). Relationship impact: Petra physically protected Corin under lethal threat.`,
        output: `{
  "events": [{
    "summary": "An unidentified attacker stabbed Corin below the ribs and slashed his forearm in an alley ambush before Petra pulled him to safety; wound depth is unknown",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Corin", "Petra"],
    "witnesses": ["Corin", "Petra"],
    "location": "Alley",
    "is_secret": false,
    "emotional_impact": { "Corin": "pain", "Petra": "alarm" },
    "relationship_impact": { "Petra→Corin": "physically protected Corin under lethal threat" }
  }]
}`,
    },
    {
        label: 'First sexual contact (EN/Explicit)',
        input: `Sabine pushed him down by the chest and climbed over him, knees bracketing his hips. She pulled her hair tie loose without looking away.
"Tell me if you want me to stop," she said. Not a question.
She rocked forward slowly, taking him in inch by inch, watching his mouth fall open. His hands came up to her hips — not to stop her, just to hold on. She set the pace, low and deliberate, learning what made his breath catch.`,
        thinking: `Step 1: Extract data — Sabine pushed Theo down, removed her hair tie, issued explicit consent check. Began penetrative sex controlling pace and position. Theo's hands on her hips, responsive and compliant.
Step 2: Cross-reference — No established memories of sexual contact between Sabine and Theo.
Step 3: Check progression — New dynamic: first penetrative encounter; Sabine controlling pace, initiating the consent check herself.
Step 4: Format JSON — Importance 4 (first sexual contact; relationship threshold). Sabine dominant in both initiation and pace.`,
        output: `{
  "events": [{
    "summary": "Sabine initiated penetrative sex with Theo for the first time, setting the pace from above and issuing an explicit consent check before proceeding",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Sabine", "Theo"],
    "witnesses": ["Sabine", "Theo"],
    "location": null,
    "is_secret": false,
    "emotional_impact": { "Sabine": "control", "Theo": "pleasure" },
    "relationship_impact": { "Sabine→Theo": "sexual relationship initiated with Sabine directing pace and position" }
  }]
}`,
    },
    {
        label: 'Restraint scene (EN/Kink)',
        input: `"Wrists." Inara held up the silk cord and waited.
*Rook extended both hands without hesitation. She looped and knotted in two passes — secure but not punishing — then tested the tension with a firm tug.*
"Word?" she asked.
"Copper."
She walked slowly around behind him, let her fingers trail up the back of his neck. He didn't turn his head. "Good. Kneel."
He went down. She felt the quality of his attention shift — the particular stillness that meant he was inside the scene now, fully.`,
        thinking: `Step 1: Extract data — Inara bound Rook's wrists with silk cord. Safeword "copper" confirmed. Positional command (kneel) issued and obeyed. Inara noted Rook's attention shift into scene headspace.
Step 2: Cross-reference — No established memories of any restraint or D/s dynamic between them.
Step 3: Check progression — New dynamic: first physical restraint, consent infrastructure (safeword) established, first positional command.
Step 4: Format JSON — Importance 4 (new power dynamic, safeword system on record). is_secret true.`,
        output: `{
  "events": [{
    "summary": "Inara bound Rook's wrists with silk cord, confirmed safeword 'copper', and commanded him to kneel — establishing their first physical restraint scene",
    "importance": 4,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Inara", "Rook"],
    "witnesses": ["Inara", "Rook"],
    "location": null,
    "is_secret": true,
    "emotional_impact": { "Inara": "control", "Rook": "submission" },
    "relationship_impact": { "Inara→Rook": "dominant/submissive dynamic established; safeword 'copper' on record" }
  }]
}`,
    },
    {
        label: 'Dedup - scene progression (EN/Edge)',
        input: `Inara crouched in front of him and tilted his chin up with two fingers. His eyes were glassy — not distress, that softer thing.
"Copper?" she asked quietly.
"Green," he said. Voice noticeably thicker than before.
She studied his face for a long moment, then stood and stepped back.

<established_memories>Inara bound Rook's wrists with silk cord, confirmed safeword 'copper', and commanded him to kneel — establishing their first physical restraint scene</established_memories>`,
        thinking: `Step 1: Extract data — Inara issued welfare check mid-scene; Rook confirmed green. Voice noticeably thicker. Inara paused to assess his face before continuing. Still kneeling, wrists still bound.
Step 2: Cross-reference — Existing: Inara restrained Rook, safeword confirmed, kneel commanded. Core action (restraint scene) same.
Step 3: Check progression — Same dynamic, but: voice thicker = physiological shift toward subspace. Inara stopping to read his face = calibration behavior, not scripted. Genuine state change, not a repeat.
Step 4: Format JSON — Importance 2 (progression within established scene). Subspace deepening worth recording at low weight.`,
        output: `{
  "events": [{
    "summary": "Inara checked Rook mid-scene; he confirmed green with a noticeably thicker voice indicating subspace deepening",
    "importance": 2,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Inara", "Rook"],
    "witnesses": ["Inara", "Rook"],
    "location": null,
    "is_secret": false,
    "emotional_impact": { "Rook": "deepening submission" },
    "relationship_impact": {}
  }]
}`,
    },
    {
        label: 'Conversational commitment (EN/SFW)',
        input: `"I can't keep covering Tuesday shifts," Yolanda said, dropping into the chair across from Marcus. "It's been three months."
Marcus looked up from his laptop. "You're right. I'll talk to Chen this week — I'll get you off the rotation."
"I need that in writing. Last time you said 'this week' it took six weeks."
"Fair." He pulled out his phone. "Logging it right now. Tuesday rotation, removed. Done."
Yolanda watched him type. "Thank you."`,
        thinking: `Step 1: Extract data — Yolanda raised three-month Tuesday shift grievance. Marcus committed to speaking with Chen this week. Yolanda demanded written documentation; Marcus immediately logged a calendar entry on the spot.
Step 2: Cross-reference — No established memories of this shift arrangement or previous broken commitment.
Step 3: Check progression — New commitment: Marcus has a logged item to resolve Yolanda's rotation. Concrete action taken (calendar entry) makes this durable. The prior broken promise is backstory but not an event to extract.
Step 4: Format JSON — Importance 3. The chair-drop and thanks are transient. The logged commitment is durable — spans future actions across multiple days.`,
        output: `{
  "events": [{
    "summary": "Marcus committed to removing Yolanda from Tuesday shift rotation by speaking to Chen this week, and logged it in his calendar on the spot when she demanded documented follow-through",
    "importance": 3,
    "temporal_anchor": null,
    "is_transient": false,
    "characters_involved": ["Marcus", "Yolanda"],
    "witnesses": ["Marcus", "Yolanda"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Marcus→Yolanda": "explicit commitment to resolve three-month schedule grievance, calendar-logged" }
  }]
}`,
    },
    {
        label: 'Timestamp — transient and durable (EN/SFW)',
        input: `Time: 8:45 AM — Thursday, March 6, 2025
Kitchen — Nadia's Apartment — Overcast, 38°F

Lev grabbed his jacket from the back of the chair. "I'll be at the studio until eight, maybe nine."
"I'll save you dinner," Nadia said, not looking up from the stove.
"You don't have to."
"I know." She finally looked at him. "Also — I made the appointment. Couples counseling. First session is the 14th at six."
Lev went still. "Okay," he said, after a moment. "I'll be there."`,
        thinking: `Step 1: Extract data — Timestamp present. Lev announced studio until 8–9 PM tonight. Nadia offered to save dinner. Nadia revealed she booked couples counseling — first session March 14, 6 PM. Lev committed to attend after a visible pause.
Step 2: Cross-reference — No established memories of either plan.
Step 3: Check progression — Two commitments with different lifespans. Studio/dinner: tonight only (transient). Counseling appointment: durable — spans days, emotionally significant relationship threshold.
Step 4: Format JSON — Two events. Temporal anchor: strip location and weather, preserve exact datetime format. Studio plan = importance 2, transient. Counseling = importance 4, durable, relationship impact.`,
        output: `{
  "events": [
    {
      "summary": "Lev told Nadia he would be at the studio until 8 or 9 PM; she offered to save him dinner",
      "importance": 2,
      "temporal_anchor": "Time: 8:45 AM — Thursday, March 6, 2025",
      "is_transient": true,
      "characters_involved": ["Lev", "Nadia"],
      "witnesses": ["Lev", "Nadia"],
      "location": "Nadia's Apartment",
      "is_secret": false,
      "emotional_impact": {},
      "relationship_impact": {}
    },
    {
      "summary": "Nadia booked their first couples counseling session for March 14 at 6 PM; Lev committed to attend after a moment's pause",
      "importance": 4,
      "temporal_anchor": "Time: 8:45 AM — Thursday, March 6, 2025",
      "is_transient": false,
      "characters_involved": ["Nadia", "Lev"],
      "witnesses": ["Nadia", "Lev"],
      "location": null,
      "is_secret": false,
      "emotional_impact": { "Nadia": "resolve", "Lev": "guarded acceptance" },
      "relationship_impact": { "Nadia→Lev": "initiated couples counseling; Lev agreed — first concrete step toward addressing the relationship" }
    }
  ]
}`,
    },
];