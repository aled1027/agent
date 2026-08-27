# Reliable bulk Anki changes with AnkiConnect

Use this procedure for imports, migrations, bulk edits, and any collection change affecting more than 10 notes. The goal is an **auditable import**: its source, requested change, and verified result agree before the task ends.

## When to use it

Use Python and the local AnkiConnect HTTP API for bulk work. It exposes the full request and response, so the agent can validate note IDs, deck placement, tags, and retries. Use the Anki MCP tools for a single note or a small, interactive change.

Keep Anki running. AnkiConnect normally listens only on `http://127.0.0.1:8765`; do not expose that endpoint to a network.

## Import procedure

1. **Prepare a source file.** Write and validate a UTF-8 CSV with a header matching the target note type's fields. Keep the source file after import.
   - **Done:** the row count, headers, and required field values are known.
2. **Inspect the target collection.** Query the deck and model fields before creating notes. Choose a unique, import-specific tag, such as `import_spanish_b1_2026_08_27`.
   - **Done:** the deck, model, fields, tag, and expected note count are explicit.
3. **Send complete note objects.** With AnkiConnect `addNotes`, every note must include its own `deckName`, `modelName`, `fields`, and tags. Do not rely on a batch-level deck setting.
   - **Done:** every response position has a non-null note ID, or the failed rows are identified.
4. **Verify the result.** Query the unique import tag, inspect the resulting notes, and confirm the expected count and deck placement.
   - **Done:** the verified count equals the source-row count and every card is in the requested deck.
5. **Handle retries deliberately.** Never resend an entire batch after an uncertain timeout. First query the import tag and compare its notes with the source. Add only the missing rows.
   - **Done:** every source row has exactly one corresponding note.
6. **Correct only proven mistakes.** If a new import created duplicates or placed notes in the wrong deck, identify the generated notes by the unique tag, move the intended cards with `changeDeck`, then remove only the confirmed duplicate note IDs with `deleteNotes`.
   - **Done:** the final tagged-note count and deck placement are correct.

## Python request helper

```python
import json
from urllib.request import Request, urlopen

ANKI_CONNECT = "http://127.0.0.1:8765"


def invoke(action, **params):
    request = Request(
        ANKI_CONNECT,
        data=json.dumps({"action": action, "version": 5, "params": params}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=30) as response:
        body = json.load(response)
    if body.get("error") is not None:
        raise RuntimeError(f"{action}: {body['error']}")
    return body["result"]
```

## CSV import skeleton

```python
import csv

DECK = "Spanish"
MODEL = "Basic"
IMPORT_TAG = "import_spanish_b1_2026_08_27"

with open("spanish_b1_verbs.csv", encoding="utf-8-sig", newline="") as file:
    rows = list(csv.DictReader(file))

if not rows or set(rows[0]) != {"Front", "Back"}:
    raise ValueError("CSV must have Front and Back columns")
if any(not row["Front"] or not row["Back"] for row in rows):
    raise ValueError("CSV has an empty required field")

notes = [
    {
        "deckName": DECK,
        "modelName": MODEL,
        "fields": {"Front": row["Front"], "Back": row["Back"]},
        "tags": ["spanish", "b1", "verbs", IMPORT_TAG],
    }
    for row in rows
]

# Use bounded batches. Store the returned IDs; a null value marks a rejected note.
created_ids = []
for offset in range(0, len(notes), 100):
    result = invoke("addNotes", notes=notes[offset : offset + 100])
    if any(note_id is None for note_id in result):
        raise RuntimeError(f"Rejected note in batch starting at row {offset + 1}")
    created_ids.extend(result)

verified_ids = invoke("findNotes", query=f"deck:{DECK} tag:{IMPORT_TAG}")
if len(verified_ids) != len(rows):
    raise RuntimeError(
        f"Expected {len(rows)} imported notes; found {len(verified_ids)}"
    )
```

For non-Basic note types, obtain the exact field names first and replace the CSV validation and `fields` mapping accordingly.

## References

- [AnkiConnect README](https://github.com/amikey/anki-connect)
- [AnkiConnect API endpoints](https://github.com/amikey/anki-connect/blob/master/_autodocs/api-reference/endpoints.md)
- [AnkiConnect Context7 reference](https://context7.com/amikey/anki-connect)
