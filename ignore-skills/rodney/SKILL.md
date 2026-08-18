---
name: rodney
description: Chrome browser automation via the `rodney` CLI. Use for web browsing, scraping, screenshots, form filling, clicking, and any browser interaction tasks.
---

# Rodney – Chrome Automation

## Quick Reference

Run `rodney --help` for the full command list.

## Workflow

1. **Start the browser:** `rodney start`
2. **Navigate:** `rodney open <url>`
3. **Inspect the page:** use `rodney ax-tree`, `rodney text <selector>`, or `rodney html <selector>` to understand page content
4. **Interact:** `rodney click`, `rodney input`, `rodney select`, `rodney submit`, etc.
5. **Wait as needed:** `rodney wait <selector>`, `rodney waitload`, `rodney waitidle`
6. **Capture results:** `rodney screenshot`, `rodney pdf`, `rodney text`, `rodney html`
7. **Stop when done:** `rodney stop`

## Tips

- Prefer `rodney ax-tree` to understand page structure accessibly before crafting selectors.
- Use `rodney wait <selector>` after navigation or clicks before reading content.
- Use `rodney js <expr>` for anything the built-in commands don't cover.
- Check `rodney status` if commands fail — the browser may not be running.
