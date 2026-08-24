---
name: grill-me
description: Relentlessly stress-test an idea or design in dependency-aware rounds. Use ordinary mode anywhere, or engineering/docs mode to align a repository and maintain its glossary and ADRs.
disable-model-invocation: true
---

# Grill Me

Run one design-tree interview. This is a Pi-native, self-contained skill: **never invoke a `Skill` tool** or ask another skill to run. Use the available filesystem and other tools directly.

## Choose the mode before the interview

There are two modes:

- **Ordinary**: works for any idea, plan, decision, or design. It writes no project documents.
- **Engineering/docs**: use for a design tied to the current repository when the user wants codebase alignment, vocabulary, `CONTEXT.md`, or ADRs. It reads the repository and maintains domain-model artifacts during the interview.

Infer the mode when the request makes it clear. Explicit requests to document the repo, create or update `CONTEXT.md`, create ADRs, or align a codebase select engineering/docs mode. A general or non-repository idea selects ordinary mode. If both modes are plausible, ask this one question before starting: **“Should this be an ordinary, conversation-only grill, or an engineering/docs grill that may update this repository's glossary and ADRs?”** Do not begin substantive grilling until it is settled.

In engineering/docs mode, identify the repository root and read any applicable `CONTEXT-MAP.md`, `CONTEXT.md`, and relevant ADRs before relying on their vocabulary. If there is no writable repository, use ordinary mode rather than creating artifacts elsewhere.

## Interview loop

Map the topic as a **design tree**: each settled decision exposes the decisions that depend on it.

1. Identify the **frontier**: every unresolved decision whose prerequisites are settled.
2. Ask the entire frontier as one round. Do not put two questions in the same round when one answer could change the other.
3. Give a recommendation, but leave every decision to the user. Wait for their answers.
4. Incorporate the answers, expand and recompute the frontier, then run the next round.
5. Finish only when the frontier is empty: every relevant branch has been visited and nothing material is silently assumed. Ask the user to confirm that the shared understanding is complete. Do not implement or otherwise act on the design without that confirmation. In engineering/docs mode, the inline glossary updates described below are the sole permitted artifact changes during the interview.

Format each round exactly like this (separate questions with `---`):

```md
**Q1 — <question title>:** <question body, including choices where useful>

**Recommendation:** <your recommended answer>

---

**Q2 — <question title>:** <question body, including choices where useful>

**Recommendation:** <your recommended answer>
```

Facts are the agent's job; decisions are the user's. When a frontier question needs a fact available from the repository, environment, documentation, or another available tool, look it up rather than asking the user. Do not stall unrelated frontier questions while research is in progress; hold only questions that depend on the missing fact. If a question needs evidence or a prototype rather than a decision, say so, propose the smallest useful experiment, and wait rather than guessing it into a decision.

## Engineering/docs mode: active domain modeling

Apply these rules throughout the interview, not as a final documentation pass:

- Challenge terminology that conflicts with the relevant `CONTEXT.md`. Sharpen vague or overloaded language into a precise canonical term, and use concrete edge-case scenarios to test domain boundaries.
- When the user describes existing behavior, inspect relevant code. Surface contradictions for the user to resolve; do not silently prefer the code or the new statement.
- As soon as a domain-specific term is resolved, update the relevant `CONTEXT.md`. Create it lazily: normally at the repository root; when `CONTEXT-MAP.md` exists, use the context it identifies, asking which context applies only when it cannot be inferred. Follow [the CONTEXT.md format](references/CONTEXT-FORMAT.md).
- Keep `CONTEXT.md` a glossary: tight definitions of what a term is, canonical wording, and rejected synonyms. Exclude implementation details, specifications, scratch notes, and general programming concepts.
- Consider an ADR only for a decision that is all three: hard to reverse, surprising without context, and the result of a real trade-off. Offer it rather than assuming it is wanted. Once accepted, create `docs/adr/` lazily, use the next sequential `NNNN-slug.md` name, and follow [the ADR format](references/ADR-FORMAT.md).

Ordinary mode remains conversation-only: do not create or update `CONTEXT.md`, ADRs, or other project documentation.
