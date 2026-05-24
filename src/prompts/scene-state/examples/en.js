/**
 * English scene state few-shot examples.
 */

export const SCENE_STATE = [
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
];
