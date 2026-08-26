---
name: anki
description: Create, revise, or evaluate Anki cards and decks, especially language-learning cards. Use when turning material into flashcards, diagnosing difficult cards, or choosing effective prompts, answers, and note fields.
---

# Make effective Anki cards

Treat Anki as **retrieval practice**, not note storage. Design each card as a small simulation of a future moment when the learner needs the knowledge.

## Workflow

1. **Understand the source first.** Identify its meaning, the reason it works, and any distinction the learner needs. Research or ask rather than encoding uncertain material.
   - **Done:** The target knowledge and any important caveat are clear.
2. **Select material worth reviewing.** Prefer recurring, useful, personally relevant material: things from reading, listening, lessons, conversations, or repeated mistakes. Each new card creates future review work.
   - **Done:** The card has a plausible future use.
3. **Choose the retrieval channel.** Decide whether the learner needs recognition while reading, spoken/written production, pronunciation, a grammatical choice, or conceptual understanding.
   - **Done:** State the future situation and the desired recall in one sentence.
4. **Make the smallest useful test.** Test one main decision with a short, gradable answer. Put explanations, examples, sources, and related knowledge in an Extra field.
   - **Done:** A reviewer can tell correct from incorrect quickly.
5. **Add discriminating context.** Constrain the prompt until the intended answer is clear. Context should identify the answer, not turn the card into a full-sentence translation exercise.
   - **Done:** A competent learner would not reasonably supply several different answers.
6. **Choose the requested output format.** Use the learner's note type, fields, and direction. If none is specified, provide a compact table with `Front`, `Back`, and optional `Extra`; group reverse cards with their source card.
   - **Done:** Every card is ready to import or enter without interpretation.
7. **Use review failures as design evidence.** Repeated failure usually means the cue is vague, the answer is oversized, several facts compete, the distinction is not understood, or the card has too little context. Add context, expose the contrast, split the task, or delete a low-value card.
   - **Done:** Each persistent failure has a specific redesign, not merely more repetitions.

## Card design rules

### Atomic retrieval

One card may reinforce several connected facts, but it must require one answer. Train a decision, not a chapter summary.

- Strong: `No creo que ___ razón. [tener, tú]` → `tengas`
- Weak: “Explain all uses of the subjunctive.”

Keep occasional **integrative** cards for a broad model after concrete examples are established. They preserve understanding; atomic cards should dominate routine review.

### Clear cues and short answers

A card should be effortful but tractable. Avoid prompts with many equally correct responses, exact long translations, or answers that bundle unrelated facts.

- Weak: `to become` → `ponerse`
- Strong: `She became nervous. Se ___ nerviosa.` → `puso`

Cloze cards are useful for a targeted word, form, preposition, agreement, or chunk. Vary the sentence or add contrast cards if recognition of the surrounding text makes the answer automatic.

### Contextual, usable knowledge

Move beyond dictionary pairs when possible. Learn words in the phrases, collocations, and situations in which they are used.

- Dictionary start: `aprovechar` → `make good use of; take advantage of`
- Usable production: `take advantage of an opportunity` → `aprovechar una oportunidad`
- Contextual recall: `Hay que ___ el tiempo que tenemos.` → `aprovechar`

Build a **network** around important words with separate cards for genuinely different uses; do not create one giant definition card.

### Match direction to the skill

Recognition and production are distinct. Add both only when both matter.

- Reading recognition: `aunque` → `although / even though`
- Production: `although / even though` → `aunque`

Do not reverse a card whose prompt permits many valid answers. Add contextual constraints instead. Use English when it is the clearest cue; use target-language definitions, paraphrases, and contrasts when they better represent advanced distinctions.

### Use images selectively

Use images for meanings that are naturally visual and precise; use sentences, definitions, or translations for abstract meanings. Pronunciation cards can target a recurring contrast, but they complement real speaking practice.

## Language-learning cards

### Chunks before isolated words

Treat frequent multiword units as vocabulary.

- `tener ganas de + infinitive`
- `darse cuenta de`
- `estar de acuerdo con`
- `hacer caso a`

A fill-in-the-blank can target one part of a chunk: `No tengo ganas ___ salir.` → `de`.

### Nouns and agreement

Include the article with nouns when gender matters, especially exceptions and confusing nouns.

- `map` → `el mapa`
- `hand` → `la mano`

For troublesome nouns, add an agreement card: `una pared ___ [white]` → `blanca`.

### Grammar as decisions and contrasts

Make grammar cards require the choice made in a real sentence. Contrast nearby alternatives directly.

- `Cuando era niño, ___ al parque todos los días. [ir]` → `iba`
- `Ayer ___ al supermercado. [ir]` → `fui`
- `Gracias ___ venir.` → `por`
- `Salimos ___ Madrid mañana.` → `para`

Use a contextual form rather than an abstract conjugation label when possible. Add an occasional explanation card for the governing idea only after several concrete instances.

### Variety and register

For production cards, reinforce one primary target variety and register. Recognition cards may note common regional alternatives, but do not make the learner produce conflicting defaults without a context that chooses one.

## Note structure

Keep the tested answer distinct from supporting material.

| Field | Include |
| --- | --- |
| Front | One precise retrieval cue; an image when it is the intended cue. |
| Back | The minimal correct answer. |
| Extra | Translation, brief explanation, full example, source, related expressions, or a contrast. |

Example:

- **Front:** `I realized that I was wrong. Me ___ de que estaba equivocado.`
- **Back:** `di cuenta`
- **Extra:** `darse cuenta de = to realize; related: notar, percatarse de`

## Quality check

Before finalizing cards, verify every card:

- encodes understood, accurate knowledge;
- serves a likely future use;
- states one retrieval target;
- has an unambiguous cue and a small answer;
- tests the intended channel and direction;
- teaches a natural expression or a meaningful contextual choice;
- contains an article for a relevant gendered noun;
- keeps explanation and source material out of the graded answer; and
- has a clear redesign path if it becomes difficult.

Anki reinforces exposure, reading, listening, speaking, writing, and conversation; it does not replace them.
