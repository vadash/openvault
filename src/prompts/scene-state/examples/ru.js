/**
 * Russian scene state few-shot examples.
 */

export const SCENE_STATE = [
    {
        label: 'Сцена в гостиной (RU/SFW)',
        input: `<previous_state>
{
  "location": "Гостиная",
  "time": "Пятница, вечер, около 6 часов",
  "environment": "мягкий свет, тихая музыка",
  "characters": {
    "Алиса": {
      "clothing": ["синий свитер", "джинсы"],
      "posture": "сидит на диване",
      "physical_status": ["расслабленная"],
      "mental_status": ["довольная"]
    },
    "Борис": {
      "clothing": ["футболка", "шорты"],
      "posture": "стоит у камина",
      "physical_status": [],
      "mental_status": ["задумчивый"]
    }
  },
  "active_props": ["бокал вина", "книга"],
  "source_fp": "msg-001"
}
</previous_state>

<new_messages>
<message fingerprint="msg-002" sender="Алиса">
Алиса встает с дивана и идет на кухню. "Я приготовлю чай", — говорит она, оставляя книгу на столике.
</message>
<message fingerprint="msg-003" sender="Борис">
Борис кивает и остается у камина, глядя на огонь. Он берет бокал, который оставила Алиса, и делает глоток.
</message>
</new_messages>`,
        thinking: `1. Location -> Гостиная (Алиса идет, но не прибыла)
2. Алиса -> posture: идет на кухню; книга на столике
3. Борис -> unchanged, взял бокал
4. Props -> бокал у Бориса, книга на столике
5. Output -> JSON с обновленной позой Алисы`,
        output: `{
  "location": "Гостиная",
  "time": "Пятница, вечер, около 6 часов",
  "environment": "мягкий свет, тихая музыка",
  "characters": {
    "Алиса": {
      "clothing": ["синий свитер", "джинсы"],
      "posture": "идет на кухню",
      "physical_status": ["расслабленная"],
      "mental_status": ["довольная"]
    },
    "Борис": {
      "clothing": ["футболка", "шорты"],
      "posture": "стоит у камина",
      "physical_status": [],
      "mental_status": ["задумчивый"]
    }
  },
  "active_props": ["бокал вина", "книга"],
  "source_fp": "msg-003"
}`,
    },
];
