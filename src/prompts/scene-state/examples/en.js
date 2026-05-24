/**
 * English scene state few-shot examples.
 * 5 examples following SFW → kink gradient.
 */

export const SCENE_STATE = [
    {
        label: 'Cold start — first extraction (EN/SFW)',
        input: `<previous_state>
No previous state — this is the first extraction.
</previous_state>

<new_messages>
<message fingerprint="msg-001" sender="Kira">
Kira pushes through the tavern door, shaking rain off her cloak. The common room is half-full — fireplace blazing, a bard plucking something slow in the corner. She scans the tables and spots Dael nursing an ale near the back wall.
</message>
<message fingerprint="msg-002" sender="Dael">
Dael lifts his mug in greeting. "You look like a drowned cat." He kicks the chair opposite him out from under the table. His sword is propped against the wall beside him, still in its scabbard.
</message>
<message fingerprint="msg-003" sender="Kira">
"Charming." Kira drops into the chair and waves the barkeep over. She unclasps her cloak and drapes it over the chair back, revealing the leather armor underneath. "What have you heard?"
</message>
</new_messages>`,
        thinking: `1. Location -> Tavern common room; cold start
2. Time -> evening implied (rain, fireplace, bard)
3. Kira -> cloak removed(draped on chair) + leather armor; seated
4. Dael -> unchanged clothing implied; seated; sword by wall
5. Props -> ale mug, sword(scabbard), wet cloak(chair)
6. Output -> establish full state from scratch`,
        output: `{
  "location": "Tavern — Common Room",
  "time": "Evening, rainy",
  "environment": "Half-full common room, fireplace blazing, bard playing",
  "characters": {
    "Kira": {
      "clothing": ["leather armor"],
      "posture": "seated at table",
      "physical_status": ["damp from rain"],
      "mental_status": ["alert"]
    },
    "Dael": {
      "clothing": [],
      "posture": "seated at table, back to wall",
      "physical_status": [],
      "mental_status": ["relaxed"]
    }
  },
  "active_props": ["ale mug", "sword in scabbard (against wall)", "wet cloak (draped on chair)"],
  "source_fp": "msg-003"
}`,
    },
    {
        label: 'Living room scene transition (EN/SFW)',
        input: `<previous_state>
{
  "location": "Living Room",
  "time": "Friday evening, around 6 PM",
  "environment": "warm lighting, soft music playing",
  "characters": {
    "Alice": {
      "clothing": ["blue sweater", "jeans"],
      "posture": "sitting on the couch",
      "physical_status": ["relaxed"],
      "mental_status": ["content"]
    },
    "Bob": {
      "clothing": ["t-shirt", "shorts"],
      "posture": "standing near the fireplace",
      "physical_status": [],
      "mental_status": ["thoughtful"]
    }
  },
  "active_props": ["wine glass", "book"],
  "source_fp": "msg-001"
}
</previous_state>

<new_messages>
<message fingerprint="msg-002" sender="Alice">
Alice stands up from the couch and walks to the kitchen. "I'm going to make some tea," she says, leaving her book on the coffee table.
</message>
<message fingerprint="msg-003" sender="Bob">
Bob nods and remains by the fireplace, watching the flames. He picks up the wine glass Alice left behind and takes a sip.
</message>
</new_messages>`,
        thinking: `1. Location -> Living Room still (Alice walking to kitchen, not arrived)
2. Alice -> posture: walking to kitchen; book left on table
3. Bob -> unchanged posture, picked up wine glass
4. Props -> wine glass with Bob, book on table (still present)
5. Output -> JSON with Alice posture updated, same location`,
        output: `{
  "location": "Living Room",
  "time": "Friday evening, around 6 PM",
  "environment": "warm lighting, soft music playing",
  "characters": {
    "Alice": {
      "clothing": ["blue sweater", "jeans"],
      "posture": "walking toward the kitchen",
      "physical_status": ["relaxed"],
      "mental_status": ["content"]
    },
    "Bob": {
      "clothing": ["t-shirt", "shorts"],
      "posture": "standing near the fireplace",
      "physical_status": [],
      "mental_status": ["thoughtful"]
    }
  },
  "active_props": ["wine glass", "book"],
  "source_fp": "msg-003"
}`,
    },
    {
        label: 'Location change and clothing update (EN/Moderate)',
        input: `<previous_state>
{
  "location": "Bedroom",
  "time": "Saturday morning",
  "characters": {
    "Lena": {
      "clothing": ["nightgown"],
      "posture": "lying in bed",
      "physical_status": ["sleepy"],
      "mental_status": ["drowsy"]
    }
  },
  "active_props": [],
  "source_fp": "msg-010"
}
</previous_state>

<new_messages>
<message fingerprint="msg-011" sender="Lena">
Lena stretches and sits up in bed. She pulls on a robe and heads to the bathroom to shower.
</message>
<message fingerprint="msg-012" sender="Lena">
After her shower, Lena towels off and puts on a casual blouse and skirt. She walks downstairs to the kitchen.
</message>
</new_messages>`,
        thinking: `1. Location -> Kitchen (after msg-012)
2. Time -> still Saturday morning (implied)
3. Lena -> clothing: blouse, skirt (complete outfit change); posture: walking
4. Props -> empty (robe/towel transient)
5. Output -> new location, new clothing, standing posture`,
        output: `{
  "location": "Kitchen",
  "time": "Saturday morning",
  "characters": {
    "Lena": {
      "clothing": ["casual blouse", "skirt"],
      "posture": "walking in the kitchen",
      "physical_status": [],
      "mental_status": ["refreshed"]
    }
  },
  "active_props": [],
  "source_fp": "msg-012"
}`,
    },
    {
        label: 'Clothing removal and prop migration (EN/Explicit)',
        input: `<previous_state>
{
  "location": "Apartment — Bedroom",
  "time": "Saturday, 11:40 PM",
  "environment": "Dim lamplight, window cracked open, cool night air",
  "characters": {
    "Sable": {
      "clothing": ["black lace bra", "unbuttoned jeans"],
      "posture": "straddling Kai on the bed",
      "physical_status": ["flushed", "elevated heart rate"],
      "mental_status": ["aroused", "in control"]
    },
    "Kai": {
      "clothing": ["boxer briefs"],
      "posture": "on his back, hands on Sable's hips",
      "physical_status": ["erect", "sweating"],
      "mental_status": ["submissive", "eager"]
    }
  },
  "active_props": ["leather belt (on floor)", "silk blindfold (on nightstand)"],
  "source_fp": "msg-040"
}
</previous_state>

<new_messages>
<message fingerprint="msg-041" sender="Sable">
Sable reaches back and unhooks her bra in one motion, tossing it off the side of the bed. She takes Kai's wrists and pins them above his head. "Don't move those."
She picks up the silk blindfold from the nightstand and ties it over his eyes, pulling the knot snug.
</message>
<message fingerprint="msg-042" sender="Kai">
Kai's breath hitches as the fabric settles over his eyes. He keeps his hands where she put them, fingers curling against the headboard. "Yes ma'am."
She shifts her weight and pulls his briefs down. He lifts his hips to help.
</message>
<message fingerprint="msg-043" sender="Sable">
Sable kicks out of her jeans and drops them over the side. She lowers herself onto him slowly, one hand braced on his chest, watching his jaw clench.
</message>
</new_messages>`,
        thinking: `1. Location/Time -> unchanged
2. Sable -> bra removed(tossed off bed) + jeans removed(dropped over side); now naked
3. Kai -> briefs removed; now naked; blindfolded + wrists pinned
4. Blindfold moved nightstand -> worn by Kai
5. Bra/jeans/briefs off bed -> not in scene area
6. Props -> belt still on floor; blindfold now worn(not prop)`,
        output: `{
  "location": "Apartment — Bedroom",
  "time": "Saturday, 11:40 PM",
  "environment": "Dim lamplight, window cracked open, cool night air",
  "characters": {
    "Sable": {
      "clothing": ["naked"],
      "posture": "on top of Kai, one hand on his chest",
      "physical_status": ["flushed", "elevated heart rate"],
      "mental_status": ["dominant", "aroused"]
    },
    "Kai": {
      "clothing": ["naked", "silk blindfold (worn)"],
      "posture": "on his back, hands pinned above head against headboard",
      "physical_status": ["erect", "sweating", "penetrated"],
      "mental_status": ["submissive", "overwhelmed"]
    }
  },
  "active_props": ["leather belt (on floor)"],
  "source_fp": "msg-043"
}`,
    },
    {
        label: 'Character eviction after departure (EN/Moderate)',
        input: `<previous_state>
{
  "location": "Office — Conference Room",
  "time": "Wednesday, 2:15 PM",
  "environment": "Fluorescent lighting, whiteboard with diagrams, coffee cups on table",
  "characters": {
    "Marcus": {
      "clothing": ["dress shirt", "slacks", "loosened tie"],
      "posture": "standing at the whiteboard",
      "physical_status": ["tired"],
      "mental_status": ["frustrated"]
    },
    "Jenna": {
      "clothing": ["blazer", "pencil skirt"],
      "posture": "seated at the table",
      "physical_status": [],
      "mental_status": ["focused"]
    },
    "Director Hayes": {
      "clothing": ["navy suit"],
      "posture": "seated at head of table",
      "physical_status": [],
      "mental_status": ["impatient"]
    }
  },
  "active_props": ["laptop", "stack of reports", "coffee cups"],
  "source_fp": "msg-050"
}
</previous_state>

<new_messages>
<message fingerprint="msg-051" sender="Director Hayes">
Director Hayes stands abruptly. "I've seen enough. Get me a revised proposal by Friday." He gathers his folder and walks out, letting the door swing shut behind him.
</message>
<message fingerprint="msg-052" sender="Marcus">
Marcus stares at the closed door for a long moment, then drops the marker on the table. "Well. That went great."
</message>
<message fingerprint="msg-053" sender="Jenna">
Jenna leans back in her chair and rubs her temples. "We need to rethink the whole approach. The numbers don't support his timeline."
</message>
<message fingerprint="msg-054" sender="Marcus">
Marcus slumps into the chair next to Jenna and loosens his tie further. "Pull up the Q3 projections. Let's see what we're actually working with."
</message>
</new_messages>`,
        thinking: `1. Location/Time -> unchanged
2. Hayes -> explicitly left the room; evict
3. Marcus -> dropped marker; slumped into chair; tie loosened further
4. Jenna -> leaning back, rubbing temples
5. Props -> laptop, reports, coffee; marker added(dropped on table)
6. Output -> remove Hayes, update postures`,
        output: `{
  "location": "Office — Conference Room",
  "time": "Wednesday, 2:15 PM",
  "environment": "Fluorescent lighting, whiteboard with diagrams, coffee cups on table",
  "characters": {
    "Marcus": {
      "clothing": ["dress shirt", "slacks", "loosened tie"],
      "posture": "slumped in chair next to Jenna",
      "physical_status": ["tired"],
      "mental_status": ["frustrated", "resigned"]
    },
    "Jenna": {
      "clothing": ["blazer", "pencil skirt"],
      "posture": "leaning back in chair",
      "physical_status": ["tension headache"],
      "mental_status": ["focused", "concerned"]
    }
  },
  "active_props": ["laptop", "stack of reports", "coffee cups", "marker (on table)"],
  "source_fp": "msg-054"
}`,
    },
];
