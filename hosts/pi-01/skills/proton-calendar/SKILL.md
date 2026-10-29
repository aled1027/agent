---
name: proton-calendar
description: >
  (pi-01 only.) Read Alex's Proton Calendar and send calendar invitations (to Alex, and to people like Cat).
  Use for schedule or availability questions ("what's on Friday?", "am I free?") and for
  creating, updating or adding people to events ("make an invite", "add Cat", "invite Cat too").
---

# Proton Calendar

> **Only on pi-01.** This skill lives in `hosts/pi-01/skills/` of the agent repo, outside `skills/`, so other
> machines never load it. pi-01 loads it through `skills` in its local `~/.pi/agent/settings.json`. It needs
> pi-01's `~/.pi/agent/calendar.json` (secrets, not in git). Don't move it into `skills/`.

Proton Calendar has no API. This skill reads the calendar's secret share link, and creates events by emailing
iCalendar invitations from a Gmail account (`from` in the config) to Alex's Proton address. An event shows in Proton
once Alex accepts it.

Run the script with node (it uses `node_modules` next to it):

```sh
cal=~/git/agent/hosts/pi-01/skills/proton-calendar/cal.mjs
node $cal events 2026-10-29 2026-11-02 [query]       # list events; end is exclusive; recurrences expanded
node $cal invite --title "Dinner" --start 2026-11-06T19:00 [--end 2026-11-06T21:00] \
  [--location "..."] [--description "..."] [--with cat] [--with someone@example.com]
node $cal update <uid> --with cat                     # add people / change fields of a sent invite
node $cal sent [query]                                # sent invites (latest version of each), to find a UID
```

- Times are wall-clock in the configured zone, America/Los_Angeles (Pacific): `YYYY-MM-DDTHH:MM`. A bare
  `YYYY-MM-DD` start makes an all-day event; `--end` is then the last day (inclusive). Default length: 1 hour.
- Alex is always invited. `--with` adds guests by name from `people` in the config (e.g. `cat`) or by email address. Repeat it for several guests.
- **Alex rarely invites other people, except Cat, who he invites often.** A name in the request ("pickleball with
  Wes") usually belongs in the title, not on the guest list. Invite only Cat, or someone Alex explicitly asks to
  invite. If unsure, ask.
- When Alex says "invite Cat", "with Cat", "add Cat", use `--with cat`. To add Cat
  (or anyone) to an invite already sent, find it with `sent` and use `update <uid> --with cat`: it resends the
  same event with a higher sequence, so calendars update it instead of duplicating it.
- `update` keeps fields you don't pass. It can only update invites in the sent log, not events Alex created
  in Proton directly.
- Confirm title, date and time with Alex before sending unless they gave them explicitly. Keep pasted details
  (directions, notes) in `--description`.
- Sending retries timeouts up to 3 times.

## Files

- `~/.pi/agent/calendar.json` (mode 600, secret): `icsUrl`, `timeZone`, `to` (Alex), `from`, `smtp`
  (Gmail, port 587 — this host cannot reach 465), and `people` (name → email). To add a regular guest, add
  them to `people`.
- `~/.pi/agent/calendar-sent.jsonl`: every invite sent, one JSON line per version.
